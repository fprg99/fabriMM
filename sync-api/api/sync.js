// Servicio de sincronización de My Money.
// Guarda UN bloque cifrado por usuario en Vercel Blob (almacenamiento privado).
// El servidor nunca ve tus datos: la app los cifra con tu frase antes de enviarlos,
// y el id se deriva de esa misma frase, así que acá solo hay texto ilegible.
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

const ORIGENES = ['https://fprg99.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const MAX_BYTES = 2 * 1024 * 1024;

// ---- Dueño del servicio ----
// El servicio es de una sola persona. El primer id que sube datos queda registrado como dueño
// (en sync/_dueno.json) y cualquier otro id se rechaza ANTES de tocar el almacenamiento, así
// nadie puede gastar el cupo creando archivos. SYNC_IDS (separados por coma) fija la lista a
// mano y reemplaza al dueño registrado; sirve para cambiar de frase sin borrar nada.
// Para empezar de cero: borrar sync/_dueno.json del Blob store.
const MARCA = process.env.SYNC_MARCA || 'sync/_dueno.json'; // SYNC_MARCA solo para pruebas locales
let duenoEnMemoria = null;

function idsFijos() {
  return (process.env.SYNC_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
}
async function leerDueno() {
  if (duenoEnMemoria) return duenoEnMemoria;
  const r = await get(MARCA, { access: 'private' }); // con caché: las lecturas repetidas no gastan cupo
  if (!r || r.statusCode !== 200) return null;
  duenoEnMemoria = JSON.parse(await new Response(r.stream).text()).id;
  return duenoEnMemoria;
}
// 'si' = es el dueño · 'no' = otro id · 'libre' = todavía no hay dueño
async function permiso(id) {
  const fijos = idsFijos();
  if (fijos.length) return fijos.includes(id) ? 'si' : 'no';
  const d = await leerDueno();
  if (!d) return 'libre';
  return d === id ? 'si' : 'no';
}
async function registrarDueno(id) {
  try {
    await put(MARCA, JSON.stringify({ id, at: Date.now() }), {
      access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false,
      cacheControlMaxAge: 60, // caché corta: si se borra el registro, se libera en un minuto
    });
    duenoEnMemoria = id;
    return true;
  } catch {
    // otro se registró en el mismo instante: vale solo si fue este mismo id
    const r = await get(MARCA, { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return false;
    duenoEnMemoria = JSON.parse(await new Response(r.stream).text()).id;
    return duenoEnMemoria === id;
  }
}

function cabeceras(req, extra = {}) {
  const h = { 'Vary': 'Origin', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...extra };
  const origen = req.headers.get('origin');
  if (origen && ORIGENES.includes(origen)) {
    h['Access-Control-Allow-Origin'] = origen;
    h['Access-Control-Allow-Methods'] = 'GET, PUT, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, If-Match, If-None-Match';
    h['Access-Control-Expose-Headers'] = 'ETag, X-MM-Version';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}
// Vercel comprime las respuestas grandes y eso convierte el ETag en débil (W/"...");
// por eso la versión viaja también en X-MM-Version, que nadie toca, y se limpia el W/ al recibirla.
const limpiar = (v) => (v ? v.replace(/^W\//, '') : v);
const version = (etag) => ({ ETag: etag, 'X-MM-Version': etag });

const json = (req, status, obj, extra) =>
  new Response(JSON.stringify(obj), { status, headers: cabeceras(req, { 'Content-Type': 'application/json', ...extra }) });

// el id son 64 caracteres hex derivados de la frase; cualquier otra cosa se rechaza
function ruta(req) {
  const id = new URL(req.url).searchParams.get('id') || '';
  return /^[0-9a-f]{64}$/.test(id) ? `sync/${id}.json` : null;
}
const idDe = (req) => new URL(req.url).searchParams.get('id');
const ajeno = (req) => json(req, 403, { error: 'este servicio es de otra frase' });

export function OPTIONS(req) {
  return new Response(null, { status: 204, headers: cabeceras(req) });
}

export async function GET(req) {
  const p = ruta(req);
  if (!p) return json(req, 400, { error: 'id inválido' });
  try {
    const quien = await permiso(idDe(req));
    if (quien === 'no') return ajeno(req);
    if (quien === 'libre') return json(req, 404, { error: 'no existe' }); // sin dueño todavía no hay datos
    const r = await get(p, { access: 'private', useCache: false, ifNoneMatch: limpiar(req.headers.get('if-none-match')) || undefined });
    if (!r) return json(req, 404, { error: 'no existe' });
    if (r.statusCode === 304) return new Response(null, { status: 304, headers: cabeceras(req, version(r.blob.etag)) });
    const cuerpo = await new Response(r.stream).text();
    return new Response(cuerpo, { status: 200, headers: cabeceras(req, { 'Content-Type': 'application/json', ...version(r.blob.etag) }) });
  } catch (e) {
    console.error('GET', e);
    return json(req, 500, { error: 'no se pudo leer' });
  }
}

export async function PUT(req) {
  const p = ruta(req);
  if (!p) return json(req, 400, { error: 'id inválido' });
  const txt = await req.text();
  if (txt.length > MAX_BYTES) return json(req, 413, { error: 'demasiado grande' });
  let d;
  try { d = JSON.parse(txt); } catch { return json(req, 400, { error: 'json inválido' }); }
  if (!d || d.v !== 1 || typeof d.iv !== 'string' || typeof d.ct !== 'string') return json(req, 400, { error: 'formato inválido' });

  // If-Match con el ETag que tenía el dispositivo: si otro lo cambió en el medio, no se pisa.
  // Sin If-Match es la primera subida: solo funciona si todavía no existe.
  const siCoincide = limpiar(req.headers.get('if-match'));
  try {
    const quien = await permiso(idDe(req));
    if (quien === 'no') return ajeno(req);
    if (quien === 'libre' && !(await registrarDueno(idDe(req)))) return ajeno(req);
    const r = await put(p, txt, {
      access: 'private', contentType: 'application/json', addRandomSuffix: false,
      allowOverwrite: !!siCoincide, ifMatch: siCoincide || undefined, cacheControlMaxAge: 60,
    });
    return json(req, 200, { ok: true }, version(r.etag));
  } catch (e) {
    if (e instanceof BlobPreconditionFailedError || /already exists/i.test(String(e && e.message))) {
      return json(req, 412, { error: 'cambió en otro dispositivo' });
    }
    console.error('PUT', e);
    return json(req, 500, { error: 'no se pudo guardar' });
  }
}
