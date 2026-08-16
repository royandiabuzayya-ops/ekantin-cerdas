// ============================================================
// SYNC — komunikasi ke backend Apps Script + antrian offline
// ============================================================

const Sync = (function () {
  let deviceId = null;
  let syncing = false;
  let listeners = [];

  function getApiUrl() {
    return localStorage.getItem('ekantin_api_url') || APP_CONFIG.API_URL_DEFAULT;
  }
  function setApiUrl(url) {
    localStorage.setItem('ekantin_api_url', url);
  }
  function getDeviceId() {
    if (deviceId) return deviceId;
    deviceId = localStorage.getItem('ekantin_device_id');
    if (!deviceId) {
      deviceId = 'dev-' + Math.random().toString(36).slice(2, 10);
      localStorage.setItem('ekantin_device_id', deviceId);
    }
    return deviceId;
  }

  function onChange(fn) { listeners.push(fn); }
  function emit(evt, data) { listeners.forEach(function (fn) { fn(evt, data); }); }

  function callApiRaw(method, params) {
    const url = getApiUrl();
    if (!url || url.indexOf('GANTI_DENGAN') === 0) {
      return Promise.reject(new Error('URL API belum diatur. Buka menu Pengaturan.'));
    }
    if (method === 'GET') {
      const qs = Object.keys(params || {}).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
      return fetch(url + (qs ? '?' + qs : ''), { method: 'GET' }).then(handleRes);
    }
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // hindari CORS preflight ke Apps Script
      body: JSON.stringify(params)
    }).then(handleRes);
  }

  function handleRes(res) {
    return res.json().then(function (json) {
      if (!json.ok) throw new Error(json.error || 'Gagal memproses permintaan');
      return json.data;
    });
  }

  function isOnline() { return navigator.onLine; }

  function fetchInitialData() {
    return callApiRaw('GET', { action: 'initialData' }).then(function (data) {
      return DB.cacheSet('initialData', data).then(function () { return data; });
    });
  }

  function getCachedInitialData() {
    return DB.cacheGet('initialData');
  }

  function fetchLaporan(jenis, dari, sampai) {
    return callApiRaw('GET', { action: 'laporan', jenis: jenis, dari: dari || '', sampai: sampai || '' });
  }

  // Menambahkan aksi tulis: langsung coba kirim jika online, kalau gagal/offline -> antre.
  function queueAction(action, payload) {
    const localId = action + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const item = { localId: localId, action: action, payload: payload, status: 'pending', createdAt: Date.now() };
    return DB.queueAdd(item).then(function () {
      emit('queue_changed');
      if (isOnline()) return syncNow();
      return { queued: true, localId: localId };
    });
  }

  function syncNow() {
    if (syncing) return Promise.resolve({ skipped: true });
    if (!isOnline()) return Promise.resolve({ offline: true });
    syncing = true;
    emit('sync_start');
    return DB.queuePending().then(function (pending) {
      if (!pending.length) {
        syncing = false;
        emit('sync_done', { synced: 0 });
        return { synced: 0 };
      }
      const queue = pending.map(function (p) { return { localId: p.localId, action: p.action, payload: p.payload }; });
      return callApiRaw('POST', { action: 'syncBatch', deviceId: getDeviceId(), payload: { queue: queue } })
        .then(function (data) {
          const results = data.results || [];
          const removals = results.filter(function (r) { return r.status === 'ok'; }).map(function (r) { return DB.queueRemove(r.localId); });
          const marks = results.filter(function (r) { return r.status === 'error'; }).map(function (r) { return DB.queueUpdateStatus(r.localId, 'error', r.error); });
          return Promise.all(removals.concat(marks)).then(function () {
            return DB.cacheSet('initialData', data.latest).then(function () {
              syncing = false;
              emit('sync_done', { synced: removals.length, errors: marks.length, latest: data.latest });
              return { synced: removals.length, errors: marks.length };
            });
          });
        })
        .catch(function (err) {
          syncing = false;
          emit('sync_error', err.message);
          throw err;
        });
    });
  }

  window.addEventListener('online', function () { emit('online'); syncNow().catch(function () {}); });
  window.addEventListener('offline', function () { emit('offline'); });

  return {
    getApiUrl: getApiUrl, setApiUrl: setApiUrl, getDeviceId: getDeviceId,
    isOnline: isOnline, onChange: onChange,
    fetchInitialData: fetchInitialData, getCachedInitialData: getCachedInitialData,
    fetchLaporan: fetchLaporan, queueAction: queueAction, syncNow: syncNow
  };
})();
