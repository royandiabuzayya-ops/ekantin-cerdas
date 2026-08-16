// ============================================================
// SERVICE WORKER — E-Kantin Cerdas
// Menyimpan file aplikasi (app shell) di cache supaya bisa dibuka
// tanpa internet. Data transaksi disimpan terpisah di IndexedDB
// (lihat db.js) dan disinkronkan lewat sync.js saat online.
// ============================================================

const CACHE_NAME = 'ekantin-cerdas-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './config.js',
  './db.js',
  './sync.js',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(APP_SHELL); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Strategi: app shell (file sendiri) -> cache first, fallback network.
// Panggilan ke Apps Script API -> selalu network (biar data selalu terbaru),
// tidak pernah di-cache oleh service worker ini.
self.addEventListener('fetch', function (event) {
  const url = event.request.url;
  const isApiCall = url.indexOf('script.google.com') !== -1 || url.indexOf('script.googleusercontent.com') !== -1;
  if (isApiCall || event.request.method !== 'GET') return; // biarkan lewat langsung ke network

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
        }
        return res;
      }).catch(function () {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
