// ============================================================
// IndexedDB wrapper — cache lokal + antrian sinkronisasi offline
// Tanpa library eksternal supaya PWA tetap ringan & bisa 100% offline.
// ============================================================

const DB = (function () {
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(APP_CONFIG.DB_NAME, APP_CONFIG.DB_VERSION);
      req.onupgradeneeded = function (e) {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('queue')) {
          const qs = db.createObjectStore('queue', { keyPath: 'localId' });
          qs.createIndex('status', 'status', { unique: false });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) { reject(e.target.error); };
    });
    return dbPromise;
  }

  function tx(storeName, mode) {
    return open().then(function (db) { return db.transaction(storeName, mode).objectStore(storeName); });
  }

  // ---- cache (snapshot data master: barang, penitip, settings, saldo, hutang) ----
  function cacheSet(key, value) {
    return tx('cache', 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        const r = store.put({ key: key, value: value, updatedAt: Date.now() });
        r.onsuccess = function () { resolve(); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }
  function cacheGet(key) {
    return tx('cache', 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        const r = store.get(key);
        r.onsuccess = function () { resolve(r.result ? r.result.value : null); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }

  // ---- queue (aksi tulis yang menunggu sinkron) ----
  function queueAdd(item) {
    return tx('queue', 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        const r = store.add(item);
        r.onsuccess = function () { resolve(item); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }
  function queueAll() {
    return tx('queue', 'readonly').then(function (store) {
      return new Promise(function (resolve, reject) {
        const r = store.getAll();
        r.onsuccess = function () { resolve(r.result || []); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }
  function queuePending() {
    return queueAll().then(function (all) { return all.filter(function (i) { return i.status === 'pending' || i.status === 'error'; }); });
  }
  function queueRemove(localId) {
    return tx('queue', 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        const r = store.delete(localId);
        r.onsuccess = function () { resolve(); };
        r.onerror = function () { reject(r.error); };
      });
    });
  }
  function queueUpdateStatus(localId, status, errorMsg) {
    return tx('queue', 'readwrite').then(function (store) {
      return new Promise(function (resolve, reject) {
        const g = store.get(localId);
        g.onsuccess = function () {
          const item = g.result;
          if (!item) return resolve();
          item.status = status;
          if (errorMsg !== undefined) item.error = errorMsg;
          const p = store.put(item);
          p.onsuccess = function () { resolve(); };
          p.onerror = function () { reject(p.error); };
        };
        g.onerror = function () { reject(g.error); };
      });
    });
  }

  return {
    cacheSet: cacheSet, cacheGet: cacheGet,
    queueAdd: queueAdd, queueAll: queueAll, queuePending: queuePending,
    queueRemove: queueRemove, queueUpdateStatus: queueUpdateStatus
  };
})();
