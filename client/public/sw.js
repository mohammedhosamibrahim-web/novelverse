/* NovelVerse service worker v2
 * v2: navigation requests are network-first so SITE UPDATES PROPAGATE to
 * the installed app on next launch; hashed assets stay cache-first.
 * - Precache the app shell.
 * - API: network-first (offline → fallback page).
 * - HTML navigations: network-first (fresh version) with offline fallback.
 */
const CACHE = 'novelverse-v2';
const PRECACHE = ['/', '/index.html', '/offline.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API: network-first (fresh data), offline → fallback page
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }

  // HTML navigation: network-first so the installed app always picks up
  // the latest version (this fixes "buttons missing in the app version").
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/offline.html')))
    );
    return;
  }

  // Assets (hashed, immutable): cache-first with runtime caching
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
    ).catch(() => caches.match('/offline.html'))
  );
});
