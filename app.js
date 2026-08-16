// ============================================================
// APP.JS — UI & alur kerja E-Kantin Cerdas
// ============================================================

const App = (function () {
  let state = {
    data: { settings: {}, barang: [], penitip: [], saldoKas: 0, hutangPenitip: {} },
    queueCount: 0
  };

  // ---------- util ----------
  function rp(n) {
    n = Number(n) || 0;
    return 'Rp ' + n.toLocaleString('id-ID', { maximumFractionDigits: 0 });
  }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  // Mencegah tombol diklik berkali-kali (double submit) selama proses menyimpan berjalan.
  function guardedClick(buttonEl, handler) {
    buttonEl.addEventListener('click', function () {
      if (buttonEl.disabled) return;
      const original = buttonEl.textContent;
      buttonEl.disabled = true;
      buttonEl.style.opacity = '0.6';
      buttonEl.textContent = 'Menyimpan...';
      Promise.resolve()
        .then(handler)
        .catch(function (err) { console.error(err); })
        .finally(function () {
          buttonEl.disabled = false;
          buttonEl.style.opacity = '1';
          buttonEl.textContent = original;
        });
    });
  }

  function isActive(v) { return v !== false && String(v).toUpperCase() !== 'FALSE'; }
  function activeBarang() { return (state.data.barang || []).filter(function (b) { return isActive(b.aktif); }); }
  function inactiveBarang() { return (state.data.barang || []).filter(function (b) { return !isActive(b.aktif); }); }
  function activePenitip() { return (state.data.penitip || []).filter(function (p) { return isActive(p.aktif); }); }
  function inactivePenitip() { return (state.data.penitip || []).filter(function (p) { return !isActive(p.aktif); }); }
  function penitipById(id) { return (state.data.penitip || []).find(function (p) { return p.id_penitip === id; }); }

  // ---------- persist local cache ----------
  function persistCache() { return DB.cacheSet('initialData', state.data); }

  // ---------- init ----------
  function init() {
    document.getElementById('about-version').textContent = APP_CONFIG.APP_VERSION;
    document.getElementById('onb-api-url').value = Sync.getApiUrl().indexOf('GANTI_DENGAN') === 0 ? '' : Sync.getApiUrl();
    document.getElementById('onb-tanggal').value = todayStr();

    Sync.onChange(handleSyncEvent);
    updateOnlinePill();
    updateQueuePill();

    Sync.getCachedInitialData().then(function (cached) {
      if (cached) {
        state.data = cached;
        renderAll();
        decideEntryScreen();
      }
      // coba refresh dari server di belakang layar
      if (Sync.isOnline()) {
        Sync.fetchInitialData().then(function (fresh) {
          state.data = fresh;
          renderAll();
          decideEntryScreen();
        }).catch(function (err) {
          if (!cached) showOnboardingConnError(err.message);
        });
      } else if (!cached) {
        showOnboardingConnError('Sedang offline dan belum ada data tersimpan. Sambungkan internet untuk memulai pertama kali.');
      }
    });

    bindEvents();
    Sync.syncNow().catch(function () {});
    refreshQueueCount();
    setInterval(function () {
      refreshQueueCount();
      if (Sync.isOnline()) Sync.syncNow().catch(function () {}); // jaring pengaman: coba sinkron ulang item yang mungkin masih tertunda
    }, 15000);
  }

  function showOnboardingConnError(msg) {
    document.getElementById('screen-onboarding').classList.remove('hidden');
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('bottomnav').classList.add('hidden');
    document.getElementById('onb-conn-status').textContent = msg;
  }

  function isSettingTrue(v) {
    return v === true || String(v).trim().toUpperCase() === 'TRUE';
  }

  function decideEntryScreen() {
    const setupDone = isSettingTrue(state.data.settings.setup_selesai);
    if (setupDone) {
      document.getElementById('screen-onboarding').classList.add('hidden');
      document.getElementById('main-app').classList.remove('hidden');
      document.getElementById('bottomnav').classList.remove('hidden');
    } else {
      document.getElementById('screen-onboarding').classList.remove('hidden');
      document.getElementById('main-app').classList.add('hidden');
      document.getElementById('bottomnav').classList.add('hidden');
    }
  }

  // ---------- sync status UI ----------
  function updateOnlinePill() {
    const pill = document.getElementById('pill-online');
    const txt = document.getElementById('pill-online-text');
    if (Sync.isOnline()) { pill.className = 'pill online'; txt.textContent = 'Online'; }
    else { pill.className = 'pill offline'; txt.textContent = 'Offline'; }
  }
  function refreshQueueCount() {
    DB.queuePending().then(function (items) {
      state.queueCount = items.length;
      updateQueuePill();
    });
  }
  function updateQueuePill() {
    const pill = document.getElementById('pill-pending');
    if (state.queueCount > 0) {
      pill.classList.remove('hidden');
      pill.textContent = state.queueCount + ' menunggu sinkron';
    } else {
      pill.classList.add('hidden');
    }
  }
  function handleSyncEvent(evt, data) {
    updateOnlinePill();
    if (evt === 'queue_changed') refreshQueueCount();
    if (evt === 'sync_done') {
      refreshQueueCount();
      if (data && data.latest) { state.data = data.latest; renderAll(); }
      if (data && data.synced) toast(data.synced + ' data berhasil disinkronkan');
    }
    if (evt === 'online') toast('Kembali online, menyinkronkan data...');
    if (evt === 'offline') toast('Sedang offline — data akan disimpan di HP dahulu');
  }

  // ---------- navigasi ----------
  function switchScreen(name) {
    $all('.screen[data-screen]').forEach(function (s) { s.classList.add('hidden'); });
    const target = document.querySelector('.screen[data-screen="' + name + '"]');
    if (target) target.classList.remove('hidden');
    $all('.nav-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.nav === name); });
    if (name === 'opname') renderOpnameScreen();
    if (name === 'restok') renderRestokScreen();
    if (name === 'biaya') { document.getElementById('bia-tanggal').value = todayStr(); }
    if (name === 'bayar') renderBayarScreen();
    if (name === 'barangpenitip') renderBarangPenitipScreen();
    if (name === 'pengaturan') renderPengaturanScreen();
    if (name === 'dashboard') renderDashboard();
    window.scrollTo(0, 0);
  }

  // ---------- render: dashboard ----------
  function renderDashboard() {
    document.getElementById('app-kantin-name').textContent = state.data.settings.nama_kantin || 'E-Kantin Cerdas';
    document.getElementById('db-saldo-kas').textContent = rp(state.data.saldoKas);
    const totalHutang = Object.values(state.data.hutangPenitip || {}).reduce(function (a, b) { return a + Number(b || 0); }, 0);
    document.getElementById('db-hutang').textContent = rp(totalHutang);
    document.getElementById('db-laba').textContent = '—';

    if (Sync.isOnline()) {
      const dari = new Date(); dari.setDate(dari.getDate() - 30);
      Sync.fetchLaporan('ringkasan', dari.toISOString().slice(0, 10), todayStr()).then(function (r) {
        document.getElementById('db-laba').textContent = rp(r.totalLabaBersih);
      }).catch(function () {});
    }

    const menipis = activeBarang().filter(function (b) { return Number(b.stok_minimum) > 0 && Number(b.stok_sistem) <= Number(b.stok_minimum); });
    const wrap = document.getElementById('db-stok-menipis');
    wrap.innerHTML = '';
    if (!menipis.length) { wrap.innerHTML = '<div class="empty">Semua stok aman 👍</div>'; }
    else {
      menipis.forEach(function (b) {
        wrap.innerHTML += '<div class="list-item"><div><div class="li-title">' + b.nama_barang + '</div><div class="li-sub">Sisa ' + b.stok_sistem + ' ' + (b.satuan || '') + '</div></div><span class="badge gold">Restok</span></div>';
      });
    }

    const act = document.getElementById('db-aktivitas');
    DB.queueAll().then(function (all) {
      const recent = all.sort(function (a, b) { return b.createdAt - a.createdAt; }).slice(0, 6);
      if (!recent.length) { act.innerHTML = '<div class="empty">Belum ada aktivitas tersimpan di HP ini</div>'; return; }
      act.innerHTML = recent.map(function (i) {
        const label = { restok: 'Restok barang', stokOpname: 'Stok opname', biayaOperasional: 'Biaya operasional', bayarPenitip: 'Bayar penitip', addBarang: 'Tambah barang', addPenitip: 'Tambah penitip', setupModalAwal: 'Setup modal awal' }[i.action] || i.action;
        const st = i.status === 'pending' ? '<span class="badge gold">Menunggu</span>' : (i.status === 'error' ? '<span class="badge" style="background:var(--red-soft);color:var(--red);">Gagal</span>' : '<span class="badge">Tersimpan</span>');
        return '<div class="list-item"><div><div class="li-title">' + label + '</div><div class="li-sub">' + new Date(i.createdAt).toLocaleString('id-ID') + '</div></div>' + st + '</div>';
      }).join('');
    });
  }

  // ---------- render: opname ----------
  function renderOpnameScreen() {
    document.getElementById('opn-tanggal').value = todayStr();
    const wrap = document.getElementById('opn-items');
    const items = activeBarang();
    if (!items.length) { wrap.innerHTML = '<div class="empty">Belum ada barang. Tambahkan di menu Lainnya &gt; Kelola Barang.</div>'; return; }
    wrap.innerHTML = items.map(function (b) {
      return '<div class="opname-row" data-kode="' + b.kode_barang + '">' +
        '<div><div class="nm">' + b.nama_barang + '</div><div class="sub">Sistem: ' + b.stok_sistem + ' ' + (b.satuan || '') + ' · ' + (b.jenis === 'titipan' ? 'Titipan' : 'Milik sendiri') + '</div><div class="opname-preview" data-preview></div></div>' +
        '<input type="number" inputmode="numeric" placeholder="Stok fisik" class="opn-fisik" style="text-align:center;">' +
        '<div style="text-align:right; font-size:11px; color:var(--ink-soft);">' + rp(b.harga_jual) + '/unit</div>' +
        '</div>';
    }).join('');
    $all('.opn-fisik').forEach(function (inp) { inp.addEventListener('input', recomputeOpnamePreview); });
    recomputeOpnamePreview();
  }

  function recomputeOpnamePreview() {
    const feeDefault = Number(state.data.settings.fee_default_persen || 10) / 100;
    let totalPendapatan = 0, totalLaba = 0, totalTitip = 0;
    $all('.opname-row').forEach(function (row) {
      const kode = row.dataset.kode;
      const b = activeBarang().find(function (x) { return x.kode_barang === kode; });
      const input = row.querySelector('.opn-fisik');
      const preview = row.querySelector('[data-preview]');
      if (input.value === '') { preview.textContent = ''; return; }
      const stokFisik = Number(input.value) || 0;
      const stokSebelum = Number(b.stok_sistem) || 0;
      const terjual = Math.max(0, stokSebelum - stokFisik);
      const pendapatan = terjual * Number(b.harga_jual || 0);
      let laba = 0, danaPenitip = 0;
      if (b.jenis === 'titipan') {
        const feeKantin = pendapatan * feeDefault;
        danaPenitip = pendapatan - feeKantin;
        laba = feeKantin;
      } else {
        laba = pendapatan - terjual * Number(b.harga_beli || 0);
      }
      preview.textContent = 'Terjual ' + terjual + ' · ' + rp(pendapatan);
      totalPendapatan += pendapatan; totalLaba += laba; totalTitip += danaPenitip;
    });
    document.getElementById('opn-sum-pendapatan').textContent = rp(totalPendapatan);
    document.getElementById('opn-sum-laba').textContent = rp(totalLaba);
    document.getElementById('opn-sum-titip').textContent = rp(totalTitip);
  }

  function submitOpname() {
    const tanggal = document.getElementById('opn-tanggal').value || todayStr();
    const catatan = document.getElementById('opn-catatan').value;
    const items = [];
    $all('.opname-row').forEach(function (row) {
      const input = row.querySelector('.opn-fisik');
      if (input.value === '') return;
      items.push({ kode: row.dataset.kode, stokFisik: Number(input.value) });
    });
    if (!items.length) { toast('Isi minimal satu stok fisik barang'); return; }

    // optimistic local update
    const feeDefault = Number(state.data.settings.fee_default_persen || 10) / 100;
    let totalPendapatan = 0;
    items.forEach(function (it) {
      const b = state.data.barang.find(function (x) { return x.kode_barang === it.kode; });
      if (!b) return;
      const stokSebelum = Number(b.stok_sistem) || 0;
      const terjual = Math.max(0, stokSebelum - it.stokFisik);
      const pendapatan = terjual * Number(b.harga_jual || 0);
      totalPendapatan += pendapatan;
      if (b.jenis === 'titipan') {
        const dana = pendapatan - pendapatan * feeDefault;
        state.data.hutangPenitip[b.id_penitip] = (state.data.hutangPenitip[b.id_penitip] || 0) + dana;
      }
      b.stok_sistem = it.stokFisik;
    });
    state.data.saldoKas = Number(state.data.saldoKas) + totalPendapatan;
    persistCache();

    return Sync.queueAction('stokOpname', { tanggal: tanggal, keterangan: catatan, items: items }).then(function () {
      toast('Hasil opname disimpan' + (Sync.isOnline() ? '' : ' (offline, menunggu sinkron)'));
      renderAll();
      switchScreen('dashboard');
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }

  // ---------- render: restok ----------
  function renderRestokScreen() {
    document.getElementById('rst-tanggal').value = todayStr();
    const sel = document.getElementById('rst-barang');
    sel.innerHTML = activeBarang().map(function (b) { return '<option value="' + b.kode_barang + '">' + b.nama_barang + ' (stok: ' + b.stok_sistem + ')' + (b.jenis === 'titipan' ? ' · Titipan' : '') + '</option>'; }).join('');
    toggleRestokFieldsForSelected();
    renderBarangListInto('rst-barang-list');
    renderPenitipListInto('rst-penitip-list');
    document.getElementById('rst-jumlah').focus();
  }
  function toggleRestokFieldsForSelected() {
    const kode = document.getElementById('rst-barang').value;
    const b = (state.data.barang || []).find(function (x) { return x.kode_barang === kode; });
    const isTitipan = b && b.jenis === 'titipan';
    document.getElementById('rst-harga-wrap').classList.toggle('hidden', !!isTitipan);
    document.getElementById('rst-sumber-wrap').classList.toggle('hidden', !!isTitipan);
  }

  function renderBarangListInto(elId) {
    const el = document.getElementById(elId);
    const items = activeBarang();
    if (!items.length) { el.innerHTML = '<div class="empty">Belum ada barang</div>'; return; }
    el.innerHTML = items.map(function (b) {
      return '<div class="list-item"><div><div class="li-title">' + b.nama_barang + '</div><div class="li-sub">' + (b.jenis === 'titipan' ? 'Titipan · ' + (penitipById(b.id_penitip) ? penitipById(b.id_penitip).nama : '-') : 'Milik sendiri') + ' · stok ' + b.stok_sistem + '</div></div><span class="li-val">' + rp(b.harga_jual) + '</span></div>';
    }).join('');
  }
  function renderPenitipListInto(elId) {
    const el = document.getElementById(elId);
    const items = state.data.penitip || [];
    if (!items.length) { el.innerHTML = '<div class="empty">Belum ada penitip</div>'; return; }
    el.innerHTML = items.map(function (p) {
      const hutang = (state.data.hutangPenitip || {})[p.id_penitip] || 0;
      return '<div class="list-item"><div><div class="li-title">' + p.nama + '</div><div class="li-sub">' + (p.kontak || '-') + '</div></div><span class="li-val">' + rp(hutang) + '</span></div>';
    }).join('');
  }

  function submitRestok() {
    const kode = document.getElementById('rst-barang').value;
    const jumlah = Number(document.getElementById('rst-jumlah').value) || 0;
    const tanggal = document.getElementById('rst-tanggal').value || todayStr();
    const ket = document.getElementById('rst-ket').value;
    if (!kode || jumlah <= 0) { toast('Pilih barang dan isi jumlah'); return Promise.resolve(); }

    const b = state.data.barang.find(function (x) { return x.kode_barang === kode; });
    const isTitipan = b.jenis === 'titipan';
    const hargaInput = isTitipan ? '' : document.getElementById('rst-harga').value;
    const sumber = isTitipan ? 'luar' : document.getElementById('rst-sumber').value;
    const hargaBeli = hargaInput !== '' ? Number(hargaInput) : Number(b.harga_beli || 0);
    b.stok_sistem = Number(b.stok_sistem || 0) + jumlah;
    if (!isTitipan && sumber === 'kas_kantin') state.data.saldoKas = Number(state.data.saldoKas) - hargaBeli * jumlah;
    persistCache();

    return Sync.queueAction('restok', {
      kode: kode, jumlah: jumlah, hargaBeli: (!isTitipan && hargaInput !== '') ? Number(hargaInput) : undefined,
      tanggal: tanggal, sumberDana: sumber, keterangan: ket
    }).then(function () {
      toast('Restok disimpan' + (Sync.isOnline() ? '' : ' (offline)'));
      document.getElementById('rst-jumlah').value = '';
      document.getElementById('rst-harga').value = '';
      document.getElementById('rst-ket').value = '';
      renderAll();
      renderRestokScreen();
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }

  // ---------- render: biaya ----------
  function submitBiaya() {
    const tanggal = document.getElementById('bia-tanggal').value || todayStr();
    const kategori = document.getElementById('bia-kategori').value;
    const jumlah = Number(document.getElementById('bia-jumlah').value) || 0;
    const ket = document.getElementById('bia-ket').value;
    if (jumlah <= 0) { toast('Isi jumlah biaya'); return; }
    state.data.saldoKas = Number(state.data.saldoKas) - jumlah;
    persistCache();
    return Sync.queueAction('biayaOperasional', { tanggal: tanggal, kategori: kategori, jumlah: jumlah, keterangan: ket }).then(function () {
      toast('Biaya dicatat' + (Sync.isOnline() ? '' : ' (offline)'));
      document.getElementById('bia-jumlah').value = '';
      document.getElementById('bia-ket').value = '';
      renderAll();
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }

  // ---------- render: bayar penitip ----------
  function renderBayarScreen() {
    document.getElementById('byr-tanggal').value = todayStr();
    const sel = document.getElementById('byr-penitip');
    sel.innerHTML = (state.data.penitip || []).map(function (p) { return '<option value="' + p.id_penitip + '">' + p.nama + '</option>'; }).join('');
    updateHutangInfo();
    sel.onchange = updateHutangInfo;

    const listEl = document.getElementById('byr-list-hutang');
    const rows = (state.data.penitip || []).map(function (p) {
      const h = (state.data.hutangPenitip || {})[p.id_penitip] || 0;
      return '<div class="list-item"><span class="li-title">' + p.nama + '</span><span class="li-val">' + rp(h) + '</span></div>';
    });
    listEl.innerHTML = rows.length ? rows.join('') : '<div class="empty">Belum ada penitip</div>';
  }
  function updateHutangInfo() {
    const id = document.getElementById('byr-penitip').value;
    const h = (state.data.hutangPenitip || {})[id] || 0;
    document.getElementById('byr-hutang-info').textContent = 'Sisa hutang saat ini: ' + rp(h);
  }
  function submitBayar() {
    const idPenitip = document.getElementById('byr-penitip').value;
    const tanggal = document.getElementById('byr-tanggal').value || todayStr();
    const jumlah = Number(document.getElementById('byr-jumlah').value) || 0;
    const ket = document.getElementById('byr-ket').value;
    if (!idPenitip || jumlah <= 0) { toast('Pilih penitip dan isi jumlah'); return; }
    state.data.hutangPenitip[idPenitip] = (state.data.hutangPenitip[idPenitip] || 0) - jumlah;
    state.data.saldoKas = Number(state.data.saldoKas) - jumlah;
    persistCache();
    return Sync.queueAction('bayarPenitip', { idPenitip: idPenitip, tanggal: tanggal, jumlah: jumlah, keterangan: ket }).then(function () {
      toast('Pembayaran dicatat' + (Sync.isOnline() ? '' : ' (offline)'));
      document.getElementById('byr-jumlah').value = '';
      renderAll();
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }

  // ---------- render: barang & penitip (CRUD) ----------
  function renderBarangPenitipScreen() {
    renderBarangCrudList();
    renderPenitipCrudList();
  }

  function barangCrudRow(b, isInactive) {
    const kodeEsc = b.kode_barang.replace(/"/g, '&quot;');
    return '<div class="list-item"><div>' +
      '<div class="li-title">' + b.nama_barang + (isInactive ? ' <span class="badge" style="background:var(--red-soft);color:var(--red);">Nonaktif</span>' : '') + '</div>' +
      '<div class="li-sub">' + b.kode_barang + ' · ' + (b.jenis === 'titipan' ? 'Titipan' : 'Milik sendiri') + ' · stok ' + b.stok_sistem + ' · ' + rp(b.harga_jual) + '</div>' +
      '</div><div style="display:flex; gap:6px;">' +
      (isInactive
        ? '<button class="btn btn-outline btn-sm" data-restore-barang="' + kodeEsc + '">Aktifkan</button>'
        : '<button class="btn btn-ghost btn-sm" data-edit-barang="' + kodeEsc + '">Edit</button><button class="btn btn-danger btn-sm" data-del-barang="' + kodeEsc + '">Nonaktifkan</button>')
      + '</div></div>';
  }
  function renderBarangCrudList() {
    const el = document.getElementById('bp-barang-list');
    const active = activeBarang(), inactive = inactiveBarang();
    let html = active.length ? active.map(function (b) { return barangCrudRow(b, false); }).join('') : '<div class="empty">Belum ada barang</div>';
    if (inactive.length) {
      html += '<div class="section-title" style="margin:16px 0 4px;">Nonaktif <span class="tag">' + inactive.length + '</span></div>';
      html += inactive.map(function (b) { return barangCrudRow(b, true); }).join('');
    }
    el.innerHTML = html;
    $all('[data-edit-barang]').forEach(function (btn) { btn.addEventListener('click', function () { openModalBarang(state.data.barang.find(function (b) { return b.kode_barang === btn.dataset.editBarang; })); }); });
    $all('[data-del-barang]').forEach(function (btn) { btn.addEventListener('click', function () { if (confirm('Nonaktifkan barang ini? Riwayat transaksi tetap tersimpan.')) toggleBarangAktif(btn.dataset.delBarang, false); }); });
    $all('[data-restore-barang]').forEach(function (btn) { btn.addEventListener('click', function () { toggleBarangAktif(btn.dataset.restoreBarang, true); }); });
  }

  function penitipCrudRow(p, isInactive) {
    const idEsc = p.id_penitip.replace(/"/g, '&quot;');
    const h = (state.data.hutangPenitip || {})[p.id_penitip] || 0;
    return '<div class="list-item"><div>' +
      '<div class="li-title">' + p.nama + (isInactive ? ' <span class="badge" style="background:var(--red-soft);color:var(--red);">Nonaktif</span>' : '') + '</div>' +
      '<div class="li-sub">' + (p.kontak || '-') + ' · hutang ' + rp(h) + '</div>' +
      '</div><div style="display:flex; gap:6px;">' +
      (isInactive
        ? '<button class="btn btn-outline btn-sm" data-restore-penitip="' + idEsc + '">Aktifkan</button>'
        : '<button class="btn btn-ghost btn-sm" data-edit-penitip="' + idEsc + '">Edit</button><button class="btn btn-danger btn-sm" data-del-penitip="' + idEsc + '">Nonaktifkan</button>')
      + '</div></div>';
  }
  function renderPenitipCrudList() {
    const el = document.getElementById('bp-penitip-list');
    const active = activePenitip(), inactive = inactivePenitip();
    let html = active.length ? active.map(function (p) { return penitipCrudRow(p, false); }).join('') : '<div class="empty">Belum ada penitip</div>';
    if (inactive.length) {
      html += '<div class="section-title" style="margin:16px 0 4px;">Nonaktif <span class="tag">' + inactive.length + '</span></div>';
      html += inactive.map(function (p) { return penitipCrudRow(p, true); }).join('');
    }
    el.innerHTML = html;
    $all('[data-edit-penitip]').forEach(function (btn) { btn.addEventListener('click', function () { openModalPenitip(penitipById(btn.dataset.editPenitip)); }); });
    $all('[data-del-penitip]').forEach(function (btn) { btn.addEventListener('click', function () { if (confirm('Nonaktifkan penitip ini?')) togglePenitipAktif(btn.dataset.delPenitip, false); }); });
    $all('[data-restore-penitip]').forEach(function (btn) { btn.addEventListener('click', function () { togglePenitipAktif(btn.dataset.restorePenitip, true); }); });
  }

  // ---------- render: pengaturan ----------
  function renderPengaturanScreen() {
    document.getElementById('set-nama').value = state.data.settings.nama_kantin || '';
    document.getElementById('set-fee').value = state.data.settings.fee_default_persen || 10;
    document.getElementById('set-api-url').value = Sync.getApiUrl().indexOf('GANTI_DENGAN') === 0 ? '' : Sync.getApiUrl();
  }

  // ---------- laporan ----------
  let currentLapTab = 'labarugi';
  function renderLaporan() {
    const dari = document.getElementById('lap-dari').value;
    const sampai = document.getElementById('lap-sampai').value;
    const el = document.getElementById('lap-content');
    if (!Sync.isOnline()) { el.innerHTML = '<div class="empty">Perlu koneksi internet untuk memuat laporan dari Spreadsheet.</div>'; return; }
    el.innerHTML = '<div class="empty">Memuat...</div>';
    Sync.fetchLaporan(currentLapTab, dari, sampai).then(function (r) {
      if (currentLapTab === 'labarugi') {
        el.innerHTML = [
          row('Total Pendapatan Kotor', r.totalPendapatanKotor),
          row('Laba Kotor Barang Sendiri', r.labaKotorBarangSendiri),
          row('Fee dari Barang Titipan', r.feeDariBarangTitipan),
          row('Total Biaya Operasional', -r.totalBiayaOperasional),
          rowBold('Laba Bersih', r.labaBersih)
        ].join('');
      } else if (currentLapTab === 'arus_kas') {
        el.innerHTML = [
          row('Total Kas Masuk', r.totalMasuk),
          row('Total Kas Keluar', -r.totalKeluar),
          rowBold('Arus Kas Bersih', r.arusBersih),
          rowBold('Saldo Kas Akhir', r.saldoAkhir)
        ].join('');
      } else if (currentLapTab === 'hutang_penitip') {
        const keys = Object.keys(r.hutang || {});
        el.innerHTML = keys.length ? keys.map(function (id) {
          const p = penitipById(id);
          return row(p ? p.nama : id, r.hutang[id]);
        }).join('') : '<div class="empty">Belum ada hutang penitip</div>';
      } else if (currentLapTab === 'stok') {
        el.innerHTML = rowBold('Total Nilai Stok (harga beli)', r.totalNilaiStok) +
          (r.barang || []).map(function (b) { return row(b.nama_barang, Number(b.stok_sistem) * Number(b.harga_beli)); }).join('');
      }
    }).catch(function (err) { el.innerHTML = '<div class="empty">Gagal memuat: ' + err.message + '</div>'; });
  }
  function row(label, val) { return '<div class="list-item"><span class="li-title">' + label + '</span><span class="li-val">' + rp(val) + '</span></div>'; }
  function rowBold(label, val) { return '<div class="list-item" style="border-top:1.5px solid var(--line); margin-top:4px; padding-top:12px;"><span class="li-title" style="font-family:var(--font-display);font-size:14px;">' + label + '</span><span class="li-val" style="color:var(--green-800);font-size:15px;">' + rp(val) + '</span></div>'; }

  // ---------- onboarding: items ----------
  let onbItemCounter = 0;
  function addOnbItem() {
    onbItemCounter++;
    const wrap = document.getElementById('onb-items');
    const div = document.createElement('div');
    div.className = 'item-row';
    div.dataset.idx = onbItemCounter;
    div.innerHTML =
      '<div class="item-row-head"><span class="idx">Barang #' + onbItemCounter + '</span><button class="remove-x" data-remove>×</button></div>' +
      '<div class="row2"><div class="field"><label>Kode</label><input type="text" class="onb-i-kode" placeholder="SNK00' + onbItemCounter + '"></div><div class="field"><label>Nama Barang</label><input type="text" class="onb-i-nama"></div></div>' +
      '<div class="row2"><div class="field"><label>Harga Beli</label><input type="number" inputmode="numeric" class="onb-i-hb"></div><div class="field"><label>Harga Jual</label><input type="number" inputmode="numeric" class="onb-i-hj"></div></div>' +
      '<div class="field"><label>Stok Awal</label><input type="number" inputmode="numeric" class="onb-i-stok"></div>';
    wrap.appendChild(div);
    div.querySelector('[data-remove]').addEventListener('click', function () { div.remove(); updateOnbCount(); });
    updateOnbCount();
  }
  function updateOnbCount() {
    document.getElementById('onb-item-count').textContent = document.querySelectorAll('#onb-items .item-row').length + ' barang';
  }

  function submitOnboarding() {
    const apiUrl = document.getElementById('onb-api-url').value.trim();
    if (apiUrl) Sync.setApiUrl(apiUrl);
    const tanggal = document.getElementById('onb-tanggal').value || todayStr();
    const kasAwal = Number(document.getElementById('onb-kas-awal').value) || 0;
    const items = $all('#onb-items .item-row').map(function (row) {
      return {
        kode: row.querySelector('.onb-i-kode').value,
        nama: row.querySelector('.onb-i-nama').value,
        jenis: 'milik_sendiri',
        hargaBeli: Number(row.querySelector('.onb-i-hb').value) || 0,
        hargaJual: Number(row.querySelector('.onb-i-hj').value) || 0,
        stok: Number(row.querySelector('.onb-i-stok').value) || 0
      };
    }).filter(function (i) { return i.kode && i.nama; });

    if (!Sync.isOnline()) { toast('Sambungkan internet untuk setup awal pertama kali'); return Promise.resolve(); }
    if (!items.length) { toast('Tambahkan minimal satu barang'); return Promise.resolve(); }
    const kodeSet = {};
    for (let i = 0; i < items.length; i++) {
      if (kodeSet[items[i].kode]) { toast('Kode barang "' + items[i].kode + '" dipakai lebih dari sekali, ubah dulu'); return Promise.resolve(); }
      kodeSet[items[i].kode] = true;
    }
    toast('Menyimpan setup awal...');
    return fetch(Sync.getApiUrl(), {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'setupModalAwal', deviceId: Sync.getDeviceId(), payload: { tanggal: tanggal, kasAwal: kasAwal, items: items } })
    }).then(function (r) { return r.json(); }).then(function (json) {
      if (!json.ok) throw new Error(json.error);
      toast('Setup awal berhasil!');
      return Sync.fetchInitialData();
    }).then(function (fresh) {
      state.data = fresh; renderAll(); decideEntryScreen();
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }

  // ---------- modal barang / penitip (mendukung mode Tambah & Edit) ----------
  let editingBarangKode = null; // null = mode tambah, terisi = mode edit
  let editingPenitipId = null;

  function openModalBarang(existing) {
    document.getElementById('mb-penitip').innerHTML = (state.data.penitip || []).map(function (p) { return '<option value="' + p.id_penitip + '">' + p.nama + '</option>'; }).join('');
    const title = document.querySelector('#modal-barang h3');
    const kodeInput = document.getElementById('mb-kode');
    if (existing) {
      editingBarangKode = existing.kode_barang;
      title.textContent = 'Edit Barang';
      kodeInput.value = existing.kode_barang; kodeInput.disabled = true;
      document.getElementById('mb-nama').value = existing.nama_barang || '';
      document.getElementById('mb-kategori').value = existing.kategori || '';
      document.getElementById('mb-satuan').value = existing.satuan || 'pcs';
      document.getElementById('mb-jenis').value = existing.jenis || 'milik_sendiri';
      document.getElementById('mb-penitip-wrap').classList.toggle('hidden', existing.jenis !== 'titipan');
      document.getElementById('mb-harga-beli-wrap').classList.toggle('hidden', existing.jenis === 'titipan');
      document.getElementById('mb-penitip').value = existing.id_penitip || '';
      document.getElementById('mb-harga-beli').value = existing.harga_beli || '';
      document.getElementById('mb-harga-jual').value = existing.harga_jual || '';
      document.getElementById('mb-stok').value = existing.stok_sistem || '';
      document.getElementById('mb-stok').disabled = true;
      document.getElementById('mb-stok-wrap-label').textContent = 'Stok Saat Ini';
      document.getElementById('mb-stok-hint').textContent = 'Ubah stok lewat menu Restok atau Stok Opname, bukan di sini.';
      document.getElementById('mb-stok-min').value = existing.stok_minimum || '';
    } else {
      editingBarangKode = null;
      title.textContent = 'Tambah Barang';
      kodeInput.disabled = false;
      document.getElementById('mb-stok').disabled = false;
      document.getElementById('mb-stok-wrap-label').textContent = 'Stok Awal';
      document.getElementById('mb-stok-hint').textContent = '';
      document.getElementById('mb-harga-beli-wrap').classList.remove('hidden');
      clearModalBarang();
    }
    document.getElementById('modal-barang').classList.remove('hidden');
  }
  function closeModalBarang() { document.getElementById('modal-barang').classList.add('hidden'); editingBarangKode = null; document.getElementById('mb-kode').disabled = false; }
  function saveModalBarang() {
    const jenis = document.getElementById('mb-jenis').value;
    if (jenis === 'titipan' && !activePenitip().length) {
      toast('Tambahkan data Penitip dulu sebelum membuat barang titipan');
      document.getElementById('mb-jenis').value = 'milik_sendiri';
      document.getElementById('mb-penitip-wrap').classList.add('hidden');
      document.getElementById('mb-harga-beli-wrap').classList.remove('hidden');
      return Promise.resolve();
    }
    const payload = {
      kode: document.getElementById('mb-kode').value,
      nama: document.getElementById('mb-nama').value,
      kategori: document.getElementById('mb-kategori').value,
      satuan: document.getElementById('mb-satuan').value || 'pcs',
      jenis: jenis,
      idPenitip: jenis === 'titipan' ? document.getElementById('mb-penitip').value : '',
      hargaBeli: jenis === 'titipan' ? 0 : (Number(document.getElementById('mb-harga-beli').value) || 0),
      hargaJual: Number(document.getElementById('mb-harga-jual').value) || 0,
      stok: Number(document.getElementById('mb-stok').value) || 0,
      stokMinimum: Number(document.getElementById('mb-stok-min').value) || 0
    };
    if (!payload.kode || !payload.nama) { toast('Isi kode dan nama barang'); return Promise.resolve(); }
    if (jenis === 'titipan' && !payload.idPenitip) { toast('Pilih penitip untuk barang titipan ini'); return Promise.resolve(); }

    if (editingBarangKode) {
      const b = state.data.barang.find(function (x) { return x.kode_barang === editingBarangKode; });
      if (b) {
        b.nama_barang = payload.nama; b.kategori = payload.kategori; b.jenis = payload.jenis; b.id_penitip = payload.idPenitip;
        b.harga_beli = payload.hargaBeli; b.harga_jual = payload.hargaJual; b.satuan = payload.satuan; b.stok_minimum = payload.stokMinimum;
      }
      persistCache();
      return Sync.queueAction('updateBarang', payload).then(function () {
        toast('Barang diperbarui');
        closeModalBarang(); renderAll();
      }).catch(function (err) { toast('Gagal: ' + err.message); });
    }

    if ((state.data.barang || []).some(function (b) { return b.kode_barang === payload.kode; })) { toast('Kode barang sudah dipakai'); return Promise.resolve(); }
    state.data.barang.push({
      kode_barang: payload.kode, nama_barang: payload.nama, kategori: payload.kategori, jenis: payload.jenis,
      id_penitip: payload.idPenitip, harga_beli: payload.hargaBeli, harga_jual: payload.hargaJual,
      satuan: payload.satuan, stok_sistem: payload.stok, stok_minimum: payload.stokMinimum, aktif: true
    });
    persistCache();
    return Sync.queueAction('addBarang', payload).then(function () {
      toast('Barang ditambahkan');
      closeModalBarang(); clearModalBarang(); renderAll();
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }
  function clearModalBarang() {
    ['mb-kode', 'mb-nama', 'mb-kategori', 'mb-harga-beli', 'mb-harga-jual', 'mb-stok', 'mb-stok-min'].forEach(function (id) { document.getElementById(id).value = ''; });
    document.getElementById('mb-satuan').value = 'pcs';
    document.getElementById('mb-jenis').value = 'milik_sendiri';
    document.getElementById('mb-penitip-wrap').classList.add('hidden');
  }
  function toggleBarangAktif(kode, aktifBaru) {
    const b = state.data.barang.find(function (x) { return x.kode_barang === kode; });
    if (b) b.aktif = aktifBaru;
    persistCache();
    Sync.queueAction(aktifBaru ? 'restoreBarang' : 'deleteBarang', { kode: kode }).then(function () {
      toast(aktifBaru ? 'Barang diaktifkan kembali' : 'Barang dinonaktifkan');
      renderAll();
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }

  function openModalPenitip(existing) {
    const title = document.querySelector('#modal-penitip h3');
    if (existing) {
      editingPenitipId = existing.id_penitip;
      title.textContent = 'Edit Penitip';
      document.getElementById('mp-nama').value = existing.nama || '';
      document.getElementById('mp-kontak').value = existing.kontak || '';
      document.getElementById('mp-rekening').value = existing.no_rekening || '';
      document.getElementById('mp-catatan').value = existing.catatan || '';
    } else {
      editingPenitipId = null;
      title.textContent = 'Tambah Penitip';
      ['mp-nama', 'mp-kontak', 'mp-rekening', 'mp-catatan'].forEach(function (id) { document.getElementById(id).value = ''; });
    }
    document.getElementById('modal-penitip').classList.remove('hidden');
  }
  function closeModalPenitip() { document.getElementById('modal-penitip').classList.add('hidden'); editingPenitipId = null; }
  function saveModalPenitip() {
    const payload = {
      nama: document.getElementById('mp-nama').value,
      kontak: document.getElementById('mp-kontak').value,
      noRekening: document.getElementById('mp-rekening').value,
      catatan: document.getElementById('mp-catatan').value
    };
    if (!payload.nama) { toast('Isi nama penitip'); return Promise.resolve(); }

    if (editingPenitipId) {
      payload.id = editingPenitipId;
      const p = penitipById(editingPenitipId);
      if (p) { p.nama = payload.nama; p.kontak = payload.kontak; p.no_rekening = payload.noRekening; p.catatan = payload.catatan; }
      persistCache();
      return Sync.queueAction('updatePenitip', payload).then(function () {
        toast('Penitip diperbarui');
        closeModalPenitip(); renderAll();
      }).catch(function (err) { toast('Gagal: ' + err.message); });
    }

    const newId = 'PTP-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    payload.id = newId;
    state.data.penitip.push({ id_penitip: newId, nama: payload.nama, kontak: payload.kontak, no_rekening: payload.noRekening, catatan: payload.catatan, aktif: true });
    persistCache();
    return Sync.queueAction('addPenitip', payload).then(function () {
      toast('Penitip ditambahkan');
      closeModalPenitip();
      renderAll();
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }
  function togglePenitipAktif(id, aktifBaru) {
    const p = penitipById(id);
    if (p) p.aktif = aktifBaru;
    persistCache();
    Sync.queueAction(aktifBaru ? 'restorePenitip' : 'deletePenitip', { id: id }).then(function () {
      toast(aktifBaru ? 'Penitip diaktifkan kembali' : 'Penitip dinonaktifkan');
      renderAll();
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }

  // ---------- pengaturan actions ----------
  function saveSettings() {
    const payload = { nama_kantin: document.getElementById('set-nama').value, fee_default_persen: Number(document.getElementById('set-fee').value) || 10 };
    state.data.settings.nama_kantin = payload.nama_kantin;
    state.data.settings.fee_default_persen = payload.fee_default_persen;
    persistCache();
    return Sync.queueAction('updateSettings', payload).then(function () { toast('Pengaturan disimpan'); renderAll(); }).catch(function (err) { toast('Gagal: ' + err.message); });
  }

  // ---------- render all ----------
  function renderAll() {
    renderDashboard();
    document.getElementById('app-kantin-name').textContent = state.data.settings.nama_kantin || 'E-Kantin Cerdas';
  }

  // ---------- events ----------
  function bindEvents() {
    $all('[data-nav]').forEach(function (el) { el.addEventListener('click', function () { switchScreen(el.dataset.nav === 'barangpenitip' ? 'barangpenitip' : el.dataset.nav); }); });

    document.getElementById('onb-add-item').addEventListener('click', addOnbItem);
    document.getElementById('onb-test-connection').addEventListener('click', function () {
      const url = document.getElementById('onb-api-url').value.trim();
      if (url) Sync.setApiUrl(url);
      document.getElementById('onb-conn-status').textContent = 'Menghubungi server...';
      fetch(Sync.getApiUrl() + '?action=ping').then(function (r) { return r.json(); }).then(function (j) {
        document.getElementById('onb-conn-status').textContent = j.ok ? '✅ Terhubung ke server.' : '❌ ' + j.error;
      }).catch(function (err) { document.getElementById('onb-conn-status').textContent = '❌ Gagal terhubung: ' + err.message; });
    });
    addOnbItem();

    guardedClick(document.getElementById('opn-submit'), submitOpname);
    guardedClick(document.getElementById('rst-submit'), submitRestok);
    document.getElementById('rst-barang').addEventListener('change', toggleRestokFieldsForSelected);
    guardedClick(document.getElementById('bia-submit'), submitBiaya);
    guardedClick(document.getElementById('byr-submit'), submitBayar);
    document.getElementById('bia-jumlah').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('bia-submit').click(); } });
    document.getElementById('byr-jumlah').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('byr-submit').click(); } });
    document.getElementById('rst-jumlah').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('rst-submit').click(); } });
    guardedClick(document.getElementById('set-save'), saveSettings);
    guardedClick(document.getElementById('onb-submit'), submitOnboarding);
    guardedClick(document.getElementById('mb-save'), saveModalBarang);
    guardedClick(document.getElementById('mp-save'), saveModalPenitip);
    document.getElementById('set-save-url').addEventListener('click', function () {
      Sync.setApiUrl(document.getElementById('set-api-url').value.trim());
      toast('URL disimpan');
    });
    document.getElementById('set-sync-now').addEventListener('click', function () { Sync.syncNow().then(function () { toast('Sinkronisasi selesai'); }).catch(function (err) { toast('Gagal sinkron: ' + err.message); }); });
    document.getElementById('set-refresh-cache').addEventListener('click', function () {
      Sync.fetchInitialData().then(function (d) { state.data = d; renderAll(); toast('Data diperbarui'); }).catch(function (err) { toast('Gagal: ' + err.message); });
    });

    document.getElementById('rst-open-add-barang').addEventListener('click', function () { openModalBarang(); });
    document.getElementById('rst-open-add-penitip').addEventListener('click', function () { openModalPenitip(); });
    document.getElementById('bp-add-barang').addEventListener('click', function () { openModalBarang(); });
    document.getElementById('bp-add-penitip').addEventListener('click', function () { openModalPenitip(); });
    document.getElementById('mb-cancel').addEventListener('click', closeModalBarang);
    document.getElementById('mp-cancel').addEventListener('click', closeModalPenitip);
    document.getElementById('mb-jenis').addEventListener('change', function () {
      const isTitipan = this.value === 'titipan';
      if (isTitipan && !activePenitip().length) {
        toast('Tambahkan data Penitip dulu sebelum membuat barang titipan');
        this.value = 'milik_sendiri';
        return;
      }
      document.getElementById('mb-penitip-wrap').classList.toggle('hidden', !isTitipan);
      document.getElementById('mb-harga-beli-wrap').classList.toggle('hidden', isTitipan);
    });
    document.getElementById('mb-kode-auto').addEventListener('click', function () {
      const nama = document.getElementById('mb-nama').value.trim();
      if (!nama) { toast('Isi nama barang dulu'); return; }
      const initials = nama.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(' ').filter(Boolean).map(function (w) { return w.slice(0, 3); }).join('').slice(0, 6) || 'BRG';
      let n = 1, kode;
      const existingKodes = (state.data.barang || []).map(function (b) { return b.kode_barang; });
      do { kode = initials + String(n).padStart(2, '0'); n++; } while (existingKodes.indexOf(kode) !== -1 && n < 100);
      document.getElementById('mb-kode').value = kode;
    });

    $all('[data-mtab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $all('[data-mtab]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.getElementById('rst-barang-list').classList.toggle('hidden', btn.dataset.mtab !== 'barang');
        document.getElementById('rst-penitip-list').classList.toggle('hidden', btn.dataset.mtab !== 'penitip');
      });
    });
    $all('[data-btab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $all('[data-btab]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.getElementById('bp-barang').classList.toggle('hidden', btn.dataset.btab !== 'barang');
        document.getElementById('bp-penitip').classList.toggle('hidden', btn.dataset.btab !== 'penitip');
      });
    });
    $all('[data-ltab]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $all('[data-ltab]').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentLapTab = btn.dataset.ltab;
        renderLaporan();
      });
    });
    document.getElementById('lap-refresh').addEventListener('click', renderLaporan);
    document.getElementById('lap-dari').value = (function () { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); })();
    document.getElementById('lap-sampai').value = todayStr();

    window.addEventListener('online', updateOnlinePill);
    window.addEventListener('offline', updateOnlinePill);
  }

  return { init: init };
})();

document.addEventListener('DOMContentLoaded', App.init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  });
  // Saat versi Service Worker baru aktif menggantikan yang lama, reload sekali
  // secara otomatis supaya file terbaru (app.js, index.html, dst) langsung
  // terlihat tanpa Roy harus hapus cache manual.
  let swRefreshed = false;
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (swRefreshed) return;
    swRefreshed = true;
    window.location.reload();
  });
}
