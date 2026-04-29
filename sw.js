/**
 * 摇号机 · Service Worker
 *
 * 缓存策略
 * ─────────────────────────────────────────────
 * 同源导航 (HTML)     → Network First  确保拿到最新版本
 * Google Fonts        → Stale While Revalidate  先返回缓存，后台静默刷新
 * 其他同源静态资源     → Cache First    永不过期（版本号控制更新）
 * 其余请求             → Network First  回退缓存
 *
 * 版本更新：修改下方 CACHE_VERSION，activate 自动清理旧缓存
 */

const CACHE_VERSION = 'v1';

const PRECACHE_NAME = `lottery-precache-${CACHE_VERSION}`;
/* 运行时缓存也带版本号，确保旧版本激活时能被正确清理 */
const RUNTIME_NAME  = `lottery-runtime-${CACHE_VERSION}`;

/* 预缓存：只保留 index.html 一个条目，避免 './' 与 './index.html' 形成两个缓存键 */
const PRECACHE_URLS = [
  './index.html',
];

/* 需要长期缓存的第三方域名 */
const LONG_CACHE_ORIGINS = [
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];

/* Fonts 缓存最大年龄（秒） */
const FONT_MAX_AGE = 30 * 24 * 3600;

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
          .filter(key =>
            key.startsWith('lottery-') &&
            key !== PRECACHE_NAME &&
            key !== RUNTIME_NAME
          )
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

  /* Google Fonts：Stale While Revalidate，30 天后后台静默刷新 */
  if (LONG_CACHE_ORIGINS.some(origin => url.origin === origin)) {
    event.respondWith(staleWhileRevalidate(request, FONT_MAX_AGE));
    return;
  }

  /* 同源导航请求（HTML 文档）：Network First */
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, true));
    return;
  }

  /* 其他同源资源（后续若拆分 CSS/JS 文件）：Cache First */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* 兜底：Network First，非导航不返回离线提示页 */
  event.respondWith(networkFirst(request, false));
});

/* ═══════════════════════════════════════════════
   策略实现
   ═══════════════════════════════════════════════ */

/**
 * Cache First
 * 优先返回缓存；缓存不存在时走网络并写入缓存。
 * 仅用于同源静态资源，不处理离线降级（版本号更新时缓存已替换）。
 */
async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch {
    /* 同源静态资源离线不可用时，不返回文本错误页，由浏览器处理 */
    return new Response(null, { status: 503 });
  }
}

/**
 * Stale While Revalidate
 * 有缓存时立即返回，同时在后台发起网络请求刷新缓存。
 * maxAgeSec > 0 时，仅在缓存超过指定时间后才后台刷新。
 * 无缓存时降级为普通 Network First。
 */
async function staleWhileRevalidate(request, maxAgeSec = 0) {
  const cache = await caches.open(RUNTIME_NAME);
  const cached = await cache.match(request);

  /* 判断是否需要后台刷新 */
  const shouldRevalidate = (() => {
    if (!cached) return false;
    if (maxAgeSec <= 0) return true;
    const ts = cached.headers.get('sw-timestamp');
    if (!ts) return true;
    return (Date.now() - Number(ts)) / 1000 > maxAgeSec;
  })();

  if (shouldRevalidate) {
    /* 后台静默刷新，不阻塞当前响应 */
    const revalidatePromise = fetch(request)
      .then(async fresh => {
        if (fresh.ok) {
          await cache.put(request, stampResponse(fresh.clone()));
        }
      })
      .catch(() => { /* 网络不通，忽略，下次再试 */ });

    /* 在 SW 生命周期内保持后台任务不被提前终止 */
    self.registration.waiting
      ? null
      : event => event && event.waitUntil && event.waitUntil(revalidatePromise);
  }

  if (cached) return cached;

  /* 无缓存：等待网络 */
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

/**
 * Network First
 * 优先走网络；失败时回退缓存。
 * isNavigate = true 时离线降级返回中文提示页，否则返回空 503。
 */
async function networkFirst(request, isNavigate = false) {
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

    /* 预缓存的 index.html 作为最终兜底 */
    if (isNavigate) {
      const precached = await caches.match('./index.html');
      if (precached) return precached;
      return new Response(
        '<!doctype html><meta charset=utf-8><title>离线</title><p style="font-family:system-ui;padding:2rem">当前处于离线状态，请连接网络后刷新。</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      );
    }

    return new Response(null, { status: 503 });
  }
}

/* ═══════════════════════════════════════════════
   工具函数
   ═══════════════════════════════════════════════ */

/**
 * 给 Response 附加 sw-timestamp 头，用于 staleWhileRevalidate 的过期判断。
 * 先 clone() 原始响应，再从 clone 构造新 Response，避免 body 流被锁。
 */
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
