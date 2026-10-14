// Offline support. Files are served from the cache straight away and refreshed in the
// background, so an update shows up the second time the app is opened after deploying.
// New files must be added to ASSETS.

const CACHE = 'gym-log-v1';
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/chart.js',
  'js/db.js',
  'js/export.js',
  'js/import.js',
  'js/nav.js',
  'js/store.js',
  'js/util.js',
  'js/views/common.js',
  'js/views/history.js',
  'js/views/more.js',
  'js/views/picker.js',
  'js/views/progress.js',
  'js/views/session.js',
  'js/views/workout.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    const fresh = fetch(request, { cache: 'no-cache' }).then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    });
    if (!cached) return fresh;
    event.waitUntil(fresh.catch(() => {}));
    return cached;
  })());
});
