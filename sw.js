/* ===========================================================================
   SERVICE WORKER
   Cachea ÚNICAMENTE el armazón de la aplicación (HTML, CSS, JS, iconos).
   NUNCA cachea respuestas de Supabase: todos los dispositivos deben leer y
   escribir sobre la misma información centralizada. Una copia local sería
   una segunda base de datos, y eso es exactamente lo que hay que evitar.
   Solo borra cachés propias (adhamar-*): si Ulianov vive en el mismo
   dominio de GitHub Pages, sus cachés no se tocan.
   =========================================================================== */
const VERSION = 'adhamar-v1';
const ARMAZON = [
  './', './index.html', './styles.css', './config.js', './manifest.json',
  './app.js', './core.js', './ui.js', './datos.js', './acceso.js',
  './agenda.js', './registro.js', './catalogo.js', './clientes.js',
  './masajistas.js', './asistencia.js', './caja.js', './reportes.js',
  './admin.js',
  './icono-claro.svg', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARMAZON)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('adhamar-') && k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Cualquier cosa que no sea del propio origen (Supabase, CDN) pasa directo a la red.
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(r => {
        const copia = r.clone();
        caches.open(VERSION).then(c => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
