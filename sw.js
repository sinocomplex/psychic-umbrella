const CACHE_VERSION = 'v3';

const PRECACHE_NAME = `lottery-precache-${CACHE_VERSION}`;
const RUNTIME_NAME  = `lottery-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

const LONG_CACHE_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

const FONT_MAX_AGE = 30 * 24 * 3600;

/* INSTALL */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(PRECACHE_NAME)
      。then(cache => cache.addAll(PRECACHE_URLS))
      。then(() => self.skipWaiting())
  );
});

/* ACTIVATE */
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.registration.navigationPreload?.enable(),
      caches.keys().then(keys =>
        Promise.all(
          keys
            .filter(key =>
              key.startsWith('lottery-') &&
              key !== PRECACHE_NAME &&
              key !== RUNTIME_NAME
            )
            .map(key => caches.delete(key))
        )
      )
    ]).then(() => self.clients.claim())
  );
});

/* FETCH */
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (LONG_CACHE_ORIGINS.some(origin => url.origin === origin)) {
    event.respondWith(staleWhileRevalidate(request, event, FONT_MAX_AGE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, event, true));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkFirst(request, event, false));
});

/* CACHE FIRST */
async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const fresh = await fetch(request);
    if (fresh.ok) await cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return new Response(null, { status: 503 });
  }
}

/* STALE WHILE REVALIDATE */
async function staleWhileRevalidate(request, event, maxAgeSec = 0) {
  const cache = await caches.open(RUNTIME_NAME);
  const cached = await cache.match(request);

  if (cached) {
    event.waitUntil(
      fetch(request)
        .then(async fresh => {
          if (fresh.ok) {
            await cache.put(request, stampResponse(fresh.clone()));
          }
        })
        .catch(() => {})
    );
    return cached;
  }

  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      await cache.put(request, stampResponse(fresh.clone()));
    }
    return fresh;
  } catch {
    return new Response(null, { status: 503 });
  }
}

/* NETWORK FIRST */
async function networkFirst(request, event, isNavigate = false) {
  const cache = await caches.open(RUNTIME_NAME);

  try {
    const preload = await event.preloadResponse;
    if (preload) return preload;

    const fresh = await fetch(request);
    if (fresh.ok) {
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    if (isNavigate) {
      const precached = await caches.match('./index.html');
      if (precached) return precached;

      return new Response(
        `<!doctype html>
         <meta charset="utf-8">
         <title>离线</title>
         <div style="
           display:flex;
           align-items:center;
           justify-content:center;
           height:100vh;
           font-family:system-ui;
           color:#999;
         ">
           📡 当前离线，请连接网络后重试
         </div>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    return new Response(null, { status: 503 });
  }
}

/* UTIL */
function stampResponse(response) {
  const cloned = response.clone();
  const headers = new Headers(cloned.headers);
  headers.set('sw-timestamp', String(Date.now()));
  return new Response(cloned.body, {
    status: cloned.status,
    statusText: cloned.statusText,
    headers,
  });
}
