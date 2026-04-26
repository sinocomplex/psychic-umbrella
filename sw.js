const CACHE_NAME = 'yaohao-v2';

// 预缓存（核心资源）
const PRECACHE = [
  '/',
  '/lottery.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// ── 安装 ─────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── 激活 ─────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          。filter(key => key !== CACHE_NAME)
          。map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch（核心升级） ─────────────
self.addEventListener('fetch', event => {
  const req = event.request;

  if (req.method !== 'GET') return;

  // HTML：网络优先（保证更新）
  if (req.destination === 'document') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 其他资源：缓存优先
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      return fetch(req).then(res => {
        if (
          res.ok &&
          new URL(req.url).origin === location.origin
        ) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
        }
        return res;
      });
    })
  );
});

// ── 支持主动更新 ───────────────
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {

    // 检测更新
    reg.onupdatefound = () => {
      const newWorker = reg.installing;

      newWorker.onstatechange = () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {

          // 提示用户刷新
          if (confirm('发现新版本，是否更新？')) {
            newWorker.postMessage('SKIP_WAITING');
          }
        }
      };
    };
  });

  // 自动刷新
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    location.reload();
  });
}
