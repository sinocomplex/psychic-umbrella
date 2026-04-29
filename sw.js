/**
 * 摇号机 · Service Worker
 *
 * 缓存策略
 * ─────────────────────────────────────────────
 * 同源导航 (HTML)     → Network First  确保拿到最新版本
 * Google Fonts        → Cache First    30 天后台刷新
 * 其他同源静态资源     → Cache First    永不过期
 * 其余请求             → Network First  回退缓存
 *
 * 版本更新：修改下方 CACHE_VERSION，activate 自动清理旧缓存
 */

const CACHE_VERSION = 'v1';

const PRECACHE_NAME = `lottery-precache-${CACHE_VERSION}`;
const RUNTIME_NAME  = 'lottery-runtime';

/* 预缓存：仅核心 HTML，确保离线首屏可用 */
const PRECACHE_URLS = [
  './',
  './index.html',
];

/* 需要长期缓存的第三方域名 */
const LONG_CACHE_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

/* ═══════════════════════════════════════════════
   Install — 预缓存核心资源，立即激活
   ═══════════════════════════════════════════════ */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(PRECACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

/* ═══════════════════════════════════════════════
   Activate — 清理旧版本缓存，立即接管所有页面
   ═══════════════════════════════════════════════ */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('lottery-') && !key.includes(CACHE_VERSION))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/* ═══════════════════════════════════════════════
   Fetch — 按请求类型分发缓存策略
   ═══════════════════════════════════════════════ */
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /* Google Fonts：Cache First，30 天过期后后台刷新 */
  if (LONG_CACHE_ORIGINS.some(origin => url.origin === origin)) {
    event.respondWith(cacheFirst(request, 30 * 24 * 3600));
    return;
  }

  /* 同源导航请求（HTML 文档）：Network First */
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  /* 其他同源资源（如果后续拆分了 CSS/JS）：Cache First */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* 兜底：Network First */
  event.respondWith(networkFirst(request));
});

/* ═══════════════════════════════════════════════
   策略实现
   ═══════════════════════════════════════════════ */

/**
 * Cache First
 * 优先返回缓存；缓存不存在时走网络并写入缓存。
 * maxAgeSec > 0 时，过期后尝试后台刷新，失败仍返回旧缓存。
 */
async function cacheFirst(request, maxAgeSec = 0) {
  const cache = await caches.open(RUNTIME_NAME);
  const cached = await cache.match(request);

  if (cached) {
    if (maxAgeSec > 0) {
      const ts = cached.headers.get('sw-timestamp');
      if (ts && (Date.now() - Number(ts)) / 1000 > maxAgeSec) {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            const stamped = stampResponse(fresh);
            await cache.put(request, stamped.clone());
            return stamped;
          }
        } catch {
          /* 网络不通，返回过期缓存 */
        }
      }
    }
    return cached;
  }

  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const stamped = stampResponse(fresh);
      await cache.put(request, stamped.clone());
      return stamped;
    }
    return fresh;
  } catch {
    return new Response('离线不可用', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/**
 * Network First
 * 优先走网络；失败时回退缓存。
 */
async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_NAME);

  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('离线不可用', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

/**
 * 给缓存的 Response 附加时间戳头，
 * 用于 cacheFirst 的 maxAge 过期判断。
 * 原始 Response 的 body 通过 clone 分给缓存和返回，避免一次性消费。
 */
function stampResponse(response) {
  const headers = new Headers(response.headers);
  headers.set('sw-timestamp', String(Date.now()));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
