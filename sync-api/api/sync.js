// Servicio de sincronización de My Money.
// Guarda UN bloque cifrado por usuario en Vercel Blob (almacenamiento privado).
// El servidor nunca ve tus datos: la app los cifra con tu frase antes de enviarlos,
// y el id se deriva de esa misma frase, así que acá solo hay texto ilegible.
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';

const ORIGENES = ['https://fprg99.github.io', 'http://127.0.0.1:8765', 'http://localhost:8765'];
const MAX_BYTES = 2 * 1024 * 1024;

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

export function OPTIONS(req) {
  return new Response(null, { status: 204, headers: cabeceras(req) });
}

export async function GET(req) {
  const p = ruta(req);
  if (!p) return json(req, 400, { error: 'id inválido' });
  try {
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
