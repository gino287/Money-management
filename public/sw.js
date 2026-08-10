/**
 * 刻意保守的 service worker。
 *
 * 記帳系統最怕的不是離線，是看到過期的數字還以為那是現況，
 * 所以頁面一律 network-first，只有不會變的靜態檔才走快取優先。
 * 離線時真的拿不到頁面才顯示 /offline。
 *
 * 「離線先記、連線後同步」不在這一版，需要 IndexedDB 佇列，之後單獨做。
 */
const VERSION = 'v1';
const STATIC_CACHE = `static-${VERSION}`;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll([OFFLINE_URL])),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !key.endsWith(VERSION)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只碰 GET。記帳的寫入絕不能被 service worker 攔截或重放
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 建置產物與圖示的檔名帶 hash，快取優先很安全
  const isStatic = url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/icons/');

  if (isStatic) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
  }
});
