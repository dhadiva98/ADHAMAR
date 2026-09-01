/* ══════════════════════════════════════════════════════════════════════
   ADHAMAR — SERVICE WORKER

   Regla dura (§1): aquí se cachea ÚNICAMENTE el armazón de la aplicación
   —HTML, CSS, JS, iconos—. Jamás una respuesta de la API de Supabase.

   El motivo no es técnico, es de negocio: si el dispositivo guardara
   copias de las ventas, existirían dos verdades sobre cuánto se cobró
   hoy, y la del celular estaría desactualizada. Supabase es la única
   fuente de verdad. Sin internet la aplicación abre y avisa que está
   sin conexión; no inventa datos viejos.

   Al publicar cambios: sube VERSION un número. Eso basta para que todos
   los dispositivos descarten el caché anterior.
   ══════════════════════════════════════════════════════════════════════ */

const VERSION = 'adhamar-v1';
const CACHE_ARMAZON = `armazon-${VERSION}`;

/* Todo lo que la aplicación necesita para arrancar. Si añades un módulo
   nuevo, agrégalo aquí y en index.html. */
const ARMAZON = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './app.js',
  './core.js',
  './formato.js',
  './ui.js',
  './datos.js',
  './acceso.js',
  './buscador.js',
  './realtime.js',
  './agenda.js',
  './registro.js',
  './historial.js',
  './clientes.js',
  './catalogo.js',
  './equipo.js',
  './caja.js',
  './reportes.js',
  './admin.js',
  './manifest.json',
  './icono-192.png',
  './icono-512.png',
  './favicon.png'
];

/* Instalación: precargar el armazón. Si un archivo falla no se aborta
   todo: se registra en consola y se sigue, para no dejar la app sin
   service worker por un icono que todavía no se subió. */
self.addEventListener('install', (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(CACHE_ARMAZON);
    await Promise.all(ARMAZON.map(async (ruta) => {
      try {
        await cache.add(new Request(ruta, { cache: 'reload' }));
      } catch (e) {
        console.warn('[sw] No se pudo precargar', ruta, e);
      }
    }));
    self.skipWaiting();
  })());
});

/* Activación: borrar cachés de versiones anteriores. */
self.addEventListener('activate', (evento) => {
  evento.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(
      nombres
        .filter((n) => n !== CACHE_ARMAZON)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

/* ¿Esta petición puede tocar el caché? */
function esDeSupabase(url) {
  return url.hostname.endsWith('.supabase.co') ||
         url.hostname.endsWith('.supabase.in');
}

function esLibreriaSupabase(url) {
  return url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('supabase-js');
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET') return;

  const url = new URL(peticion.url);

  /* 1. Supabase: SIEMPRE red directa. Ni se lee ni se escribe caché.
        Incluye Realtime (websocket) y Auth. */
  if (esDeSupabase(url)) return;

  /* 2. La librería de Supabase desde CDN sí es armazón: caché primero. */
  if (esLibreriaSupabase(url)) {
    evento.respondWith((async () => {
      const cache = await caches.open(CACHE_ARMAZON);
      const guardada = await cache.match(peticion);
      if (guardada) return guardada;
      const respuesta = await fetch(peticion);
      if (respuesta.ok) cache.put(peticion, respuesta.clone());
      return respuesta;
    })());
    return;
  }

  /* 3. Cualquier otro origen externo: red directa, sin caché. */
  if (url.origin !== self.location.origin) return;

  /* 4. Navegación (abrir la app): red primero, para que los cambios
        publicados en GitHub Pages lleguen sin tener que reinstalar.
        Si no hay red, se sirve el index guardado. */
  if (peticion.mode === 'navigate') {
    evento.respondWith((async () => {
      try {
        const respuesta = await fetch(peticion);
        const cache = await caches.open(CACHE_ARMAZON);
        cache.put('./index.html', respuesta.clone());
        return respuesta;
      } catch (e) {
        const cache = await caches.open(CACHE_ARMAZON);
        return (await cache.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  /* 5. Resto del armazón propio: se entrega lo guardado al instante y se
        actualiza por detrás. La app abre rápido y la próxima vez ya tiene
        la versión nueva. */
  evento.respondWith((async () => {
    const cache = await caches.open(CACHE_ARMAZON);
    const guardada = await cache.match(peticion);
    const enRed = fetch(peticion)
      .then((respuesta) => {
        if (respuesta && respuesta.ok) cache.put(peticion, respuesta.clone());
        return respuesta;
      })
      .catch(() => null);
    return guardada || (await enRed) || Response.error();
  })());
});

/* Permite que la app fuerce la actualización sin cerrar la pestaña. */
self.addEventListener('message', (evento) => {
  if (evento.data === 'actualizar-ya') self.skipWaiting();
});
