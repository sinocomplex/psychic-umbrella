// ======================= 摇号机 Service Worker =======================
// 缓存版本号——每次发版时递增，触发旧缓存清理
const CACHE_VERSION = 'v1';
const CACHE_NAME = `yaohaoji-${CACHE_VERSION}`;

// 需要预缓存的静态资源（安装阶段缓存）
const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
];

// 运行时缓存的策略分组
const RUNTIME_CACHE = 'yaohaoji-runtime';

// 安装：预缓存核心资源，跳过等待立即激活
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧版本缓存，立即接管所有客户端
self.addEventListener('activate', event => {
  const allowedCaches = new Set([CACHE_NAME, RUNTIME_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => !allowedCaches.has(key))
            .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// 请求拦截：根据资源类型选择缓存策略
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 仅处理同源请求
  if (url.origin !== location.origin) {
    // 外域资源（Google Fonts 等）：Stale-While-Revalidate
    if (url.hostname === 'fonts.googleapis.com' ||
        url.hostname === 'fonts.gstatic.com') {
      event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    }
    return;
  }

  // 导航请求（HTML）：Network First，离线时回退缓存
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 静态资源：Cache First，未命中时网络请求并缓存
  event.respondWith(cacheFirst(request));
});

// ======================= 缓存策略 =======================

// Cache First：优先从缓存读取，未命中则网络请求并写入缓存
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // 离线且无缓存：返回简化离线页面
    if (request.destination === 'document') {
      return new Response(
        '<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>摇号机 · 离线</title><style>body{background:#0b0b0c;color:#f5f5f7;font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;text-align:center}h1{font-size:24px;margin-bottom:8px}p{color:#8e8e93;font-size:14px}</style></head><body><div><h1>📶 网络不可用</h1><p>请检查网络连接后刷新页面</p></div></body></html>',
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

// Network First：优先网络，失败时回退缓存
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
    if (cached) return cached;
    return new Response(
      '<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>摇号机 · 离线</title><style>body{background:#0b0b0c;color:#f5f5f7;font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;text-align:center}h1{font-size:24px;margin-bottom:8px}p{color:#8e8e93;font-size:14px}</style></head><body><div><h1>📶 网络不可用</h1><p>请检查网络连接后刷新页面</p></div></body></html>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

// Stale-While-Revalidate：先返回缓存，后台更新
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}
