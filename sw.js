// ============================================================
// SERVICE WORKER — E-Kantin Cerdas
// Menyimpan file aplikasi (app shell) di cache supaya bisa dibuka
// tanpa internet. Data transaksi disimpan terpisah di IndexedDB
// (lihat db.js) dan disinkronkan lewat sync.js saat online.
//
// PENTING: strategi NETWORK-FIRST dipakai untuk file aplikasi sendiri
// (bukan cache-first) supaya update kode langsung terlihat begitu
// online, tanpa perlu hapus cache manual. Kalau offline, baru dipakai
// versi tersimpan di cache sebagai cadangan.
// ============================================================

const CACHE_VERSION = 'v3'; // NAIKKAN nomor ini setiap kali file frontend diupdate
const CACHE_NAME = 'ekantin-cerdas-' + CACHE_VERSION;
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

self.addEventListener('fetch', function (event) {
  const url = event.request.url;
  const isApiCall = url.indexOf('script.google.com') !== -1 || url.indexOf('script.googleusercontent.com') !== -1;
  if (isApiCall || event.request.method !== 'GET') return; // biarkan lewat langsung ke network, jangan pernah di-cache

  // NETWORK-FIRST: coba ambil versi terbaru dari server dulu. Kalau berhasil,
  // simpan salinannya ke cache (untuk cadangan offline) lalu tampilkan.
  // Kalau gagal (offline), baru pakai yang tersimpan di cache.
  event.respondWith(
    fetch(event.request).then(function (res) {
      if (res && res.status === 200 && res.type === 'basic') {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
      }
      return res;
    }).catch(function () {
      return caches.match(event.request).then(function (cached) {
        if (cached) return cached;
        if (event.request.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
