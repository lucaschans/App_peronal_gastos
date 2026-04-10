/* ============================================================
   MisCuentas — service-worker.js
   Estrategia: Cache First para assets estáticos,
               Network First para Chart.js CDN.
   ============================================================ */

const CACHE_NAME    = 'miscuentas-v1.0.0';
const CDN_CACHE     = 'miscuentas-cdn-v1.0.0';

/** Archivos core de la app que se cachean en la instalación */
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
];

/** URLs de CDN que se cachean por separado */
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,300&display=swap',
];

/* ==================== INSTALL ==================== */

self.addEventListener('install', event => {
  console.log('[SW] Instalando…');

  event.waitUntil(
    Promise.all([
      // Cache assets estáticos
      caches.open(CACHE_NAME).then(cache => {
        console.log('[SW] Cacheando assets estáticos');
        return cache.addAll(STATIC_ASSETS);
      }),
      // Cache CDN (best-effort, no falla si no hay red)
      caches.open(CDN_CACHE).then(cache => {
        return Promise.allSettled(
          CDN_ASSETS.map(url => cache.add(url).catch(e => console.warn('[SW] CDN no cacheado:', url, e)))
        );
      }),
    ]).then(() => self.skipWaiting())
  );
});

/* ==================== ACTIVATE ==================== */

self.addEventListener('activate', event => {
  console.log('[SW] Activando…');

  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== CDN_CACHE)
          .map(k => {
            console.log('[SW] Eliminando caché antigua:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

/* ==================== FETCH ==================== */

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo manejar GET
  if (request.method !== 'GET') return;

  // Fuentes de Google: Cache First (son estables)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }

  // CDN de Chart.js: Cache First
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }

  // Assets locales de la app: Cache First con fallback de red
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  // Cualquier otra petición: Network First
  event.respondWith(networkFirst(request));
});

/* ==================== ESTRATEGIAS ==================== */

/**
 * Cache First: sirve desde caché, si no existe va a la red y guarda.
 */
async function cacheFirst(request, cacheName) {
  const cache    = await caches.open(cacheName);
  const cached   = await cache.match(request);

  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] Cache First — sin red y sin caché:', request.url);
    return offlineFallback();
  }
}

/**
 * Network First: intenta la red, si falla sirve desde caché.
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || offlineFallback();
  }
}

/**
 * Respuesta offline para cuando no hay nada disponible.
 */
function offlineFallback() {
  return new Response(
    `<!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Sin conexión — MisCuentas</title>
      <style>
        body {
          background: #0f0f1a; color: #f0f0ff;
          font-family: sans-serif;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          min-height: 100vh; margin: 0; text-align: center;
          padding: 24px;
        }
        .icon { font-size: 64px; margin-bottom: 20px; }
        h1 { font-size: 24px; margin-bottom: 8px; }
        p  { color: rgba(240,240,255,0.5); font-size: 15px; }
        button {
          margin-top: 24px; padding: 14px 28px;
          background: #7c6fff; color: #fff;
          border: none; border-radius: 14px;
          font-size: 15px; cursor: pointer;
        }
      </style>
    </head>
    <body>
      <div class="icon">📡</div>
      <h1>Sin conexión</h1>
      <p>No se pudo cargar la página.<br>Comprueba tu conexión a internet.</p>
      <button onclick="location.reload()">Reintentar</button>
    </body>
    </html>`,
    {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}

/* ==================== MENSAJES ==================== */

/** Escuchar mensajes desde la app principal (ej: forzar actualización) */
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
