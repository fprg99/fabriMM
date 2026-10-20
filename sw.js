// Service worker de My Money: permite abrir la app sin conexión.
// Estrategia: primero la red (para tener siempre la última versión) y, si no hay
// conexión, lo último que se guardó. La sincronización nunca pasa por la caché.
var CACHE = 'my-money-v9';
var BASICOS = ['./', './index.html'];

self.addEventListener('install', function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(BASICOS); }).then(function(){ return self.skipWaiting(); }));
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(ks){
      return Promise.all(ks.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  var propio = url.origin === self.location.origin;
  var fuentes = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!propio && !fuentes) return; // la API de sincronización y todo lo demás va directo a la red

  e.respondWith(
    fetch(req).then(function(res){
      if (res && (res.ok || res.type === 'opaque')) {
        var copia = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copia); });
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(r){
        // si piden una página que no está guardada, devolver la app
        return r || (req.mode === 'navigate' ? caches.match('./index.html') : undefined) || Response.error();
      });
    })
  );
});
