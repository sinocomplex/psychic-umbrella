// sw.js — Service Worker
// 缓存版本号：每次更新资源时修改这个值，旧缓存会自动清除
const CACHE_NAME = 'yaohao-v1';

// 需要离线缓存的资源列表
const PRECACHE = [
  './lottery.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// ── 安装：预缓存所有资源 ──────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // 字体来自 Google，网络失败时跳过（不影响核心功能）
      return cache.addAll(PRECACHE).catch(() => {});
    })
  );
  // 跳过等待，立即激活新版本
  self.skipWaiting();
});

// ── 激活：清理旧版本缓存 ─────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── 拦截请求：Cache First，回退到网络 ───────────────────────
self.addEventListener('fetch', event => {
  // 只处理 GET 请求
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      // 未命中缓存：去网络取，并顺手缓存
      return fetch(event.request).then(response => {
        // 只缓存同源的成功响应（避免缓存 CDN opaque 响应）
        if (
          response.ok &&
          new URL(event.request.url).origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // 完全离线且未缓存时，返回离线提示页
        if (event.request.destination === 'document') {
          return caches.match('./lottery.html');
        }
      });
    })
  );
});
