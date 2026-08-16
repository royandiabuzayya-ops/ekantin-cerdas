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

  function activeBarang() { return (state.data.barang || []).filter(function (b) { return String(b.aktif) !== 'false' && String(b.aktif) !== 'FALSE'; }); }
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
    setInterval(refreshQueueCount, 8000);
  }

  function showOnboardingConnError(msg) {
    document.getElementById('screen-onboarding').classList.remove('hidden');
    document.getElementById('main-app').classList.add('hidden');
    document.getElementById('bottomnav').classList.add('hidden');
    document.getElementById('onb-conn-status').textContent = msg;
  }

  function decideEntryScreen() {
    const setupDone = String(state.data.settings.setup_selesai) === 'TRUE';
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
        '<input type="number" placeholder="Stok fisik" class="opn-fisik" style="text-align:center;">' +
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

    Sync.queueAction('stokOpname', { tanggal: tanggal, keterangan: catatan, items: items }).then(function () {
      toast('Hasil opname disimpan' + (Sync.isOnline() ? '' : ' (offline, menunggu sinkron)'));
      renderAll();
      switchScreen('dashboard');
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }

  // ---------- render: restok ----------
  function renderRestokScreen() {
    document.getElementById('rst-tanggal').value = todayStr();
    const sel = document.getElementById('rst-barang');
    sel.innerHTML = activeBarang().map(function (b) { return '<option value="' + b.kode_barang + '">' + b.nama_barang + ' (stok: ' + b.stok_sistem + ')</option>'; }).join('');
    renderBarangListInto('rst-barang-list');
    renderPenitipListInto('rst-penitip-list');
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
    const hargaInput = document.getElementById('rst-harga').value;
    const tanggal = document.getElementById('rst-tanggal').value || todayStr();
    const sumber = document.getElementById('rst-sumber').value;
    const ket = document.getElementById('rst-ket').value;
    if (!kode || jumlah <= 0) { toast('Pilih barang dan isi jumlah'); return; }

    const b = state.data.barang.find(function (x) { return x.kode_barang === kode; });
    const hargaBeli = hargaInput !== '' ? Number(hargaInput) : Number(b.harga_beli || 0);
    b.stok_sistem = Number(b.stok_sistem || 0) + jumlah;
    if (sumber === 'kas_kantin') state.data.saldoKas = Number(state.data.saldoKas) - hargaBeli * jumlah;
    persistCache();

    Sync.queueAction('restok', {
      kode: kode, jumlah: jumlah, hargaBeli: hargaInput !== '' ? Number(hargaInput) : undefined,
      tanggal: tanggal, sumberDana: sumber, keterangan: ket
    }).then(function () {
      toast('Restok disimpan' + (Sync.isOnline() ? '' : ' (offline)'));
      document.getElementById('rst-jumlah').value = '';
      document.getElementById('rst-harga').value = '';
      document.getElementById('rst-ket').value = '';
      renderAll();
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
    Sync.queueAction('biayaOperasional', { tanggal: tanggal, kategori: kategori, jumlah: jumlah, keterangan: ket }).then(function () {
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
    Sync.queueAction('bayarPenitip', { idPenitip: idPenitip, tanggal: tanggal, jumlah: jumlah, keterangan: ket }).then(function () {
      toast('Pembayaran dicatat' + (Sync.isOnline() ? '' : ' (offline)'));
      document.getElementById('byr-jumlah').value = '';
      renderAll();
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }

  // ---------- render: barang & penitip ----------
  function renderBarangPenitipScreen() {
    const el1 = document.getElementById('bp-barang-list');
    const items = activeBarang();
    el1.innerHTML = items.length ? items.map(function (b) {
      return '<div class="list-item"><div><div class="li-title">' + b.nama_barang + '</div><div class="li-sub">' + b.kode_barang + ' · ' + (b.jenis === 'titipan' ? 'Titipan' : 'Milik sendiri') + ' · stok ' + b.stok_sistem + '</div></div><span class="li-val">' + rp(b.harga_jual) + '</span></div>';
    }).join('') : '<div class="empty">Belum ada barang</div>';

    const el2 = document.getElementById('bp-penitip-list');
    const pen = state.data.penitip || [];
    el2.innerHTML = pen.length ? pen.map(function (p) {
      const h = (state.data.hutangPenitip || {})[p.id_penitip] || 0;
      return '<div class="list-item"><div><div class="li-title">' + p.nama + '</div><div class="li-sub">' + (p.kontak || '-') + '</div></div><span class="li-val">' + rp(h) + '</span></div>';
    }).join('') : '<div class="empty">Belum ada penitip</div>';
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
      '<div class="field"><label>Jenis</label><select class="onb-i-jenis"><option value="milik_sendiri">Milik Sendiri</option><option value="titipan">Titipan</option></select></div>' +
      '<div class="row2"><div class="field"><label>Harga Beli/Titip</label><input type="number" class="onb-i-hb"></div><div class="field"><label>Harga Jual</label><input type="number" class="onb-i-hj"></div></div>' +
      '<div class="field"><label>Stok Awal</label><input type="number" class="onb-i-stok"></div>';
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
        jenis: row.querySelector('.onb-i-jenis').value,
        hargaBeli: Number(row.querySelector('.onb-i-hb').value) || 0,
        hargaJual: Number(row.querySelector('.onb-i-hj').value) || 0,
        stok: Number(row.querySelector('.onb-i-stok').value) || 0
      };
    }).filter(function (i) { return i.kode && i.nama; });

    if (!Sync.isOnline()) { toast('Sambungkan internet untuk setup awal pertama kali'); return; }
    toast('Menyimpan setup awal...');
    Sync.fetchInitialData().catch(function () {}); // pastikan koneksi terbaca
    fetch(Sync.getApiUrl(), {
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

  // ---------- modal barang / penitip ----------
  function openModalBarang() {
    document.getElementById('mb-penitip').innerHTML = (state.data.penitip || []).map(function (p) { return '<option value="' + p.id_penitip + '">' + p.nama + '</option>'; }).join('');
    document.getElementById('modal-barang').classList.remove('hidden');
  }
  function closeModalBarang() { document.getElementById('modal-barang').classList.add('hidden'); }
  function saveModalBarang() {
    const jenis = document.getElementById('mb-jenis').value;
    const payload = {
      kode: document.getElementById('mb-kode').value,
      nama: document.getElementById('mb-nama').value,
      kategori: document.getElementById('mb-kategori').value,
      satuan: document.getElementById('mb-satuan').value || 'pcs',
      jenis: jenis,
      idPenitip: jenis === 'titipan' ? document.getElementById('mb-penitip').value : '',
      hargaBeli: Number(document.getElementById('mb-harga-beli').value) || 0,
      hargaJual: Number(document.getElementById('mb-harga-jual').value) || 0,
      stok: Number(document.getElementById('mb-stok').value) || 0,
      stokMinimum: Number(document.getElementById('mb-stok-min').value) || 0
    };
    if (!payload.kode || !payload.nama) { toast('Isi kode dan nama barang'); return; }
    state.data.barang.push({
      kode_barang: payload.kode, nama_barang: payload.nama, kategori: payload.kategori, jenis: payload.jenis,
      id_penitip: payload.idPenitip, harga_beli: payload.hargaBeli, harga_jual: payload.hargaJual,
      satuan: payload.satuan, stok_sistem: payload.stok, stok_minimum: payload.stokMinimum, aktif: true
    });
    persistCache();
    Sync.queueAction('addBarang', payload).then(function () {
      toast('Barang ditambahkan');
      closeModalBarang(); clearModalBarang(); renderAll();
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }
  function clearModalBarang() {
    ['mb-kode', 'mb-nama', 'mb-kategori', 'mb-satuan', 'mb-harga-beli', 'mb-harga-jual', 'mb-stok', 'mb-stok-min'].forEach(function (id) { document.getElementById(id).value = ''; });
  }

  function openModalPenitip() { document.getElementById('modal-penitip').classList.remove('hidden'); }
  function closeModalPenitip() { document.getElementById('modal-penitip').classList.add('hidden'); }
  function saveModalPenitip() {
    const payload = {
      nama: document.getElementById('mp-nama').value,
      kontak: document.getElementById('mp-kontak').value,
      noRekening: document.getElementById('mp-rekening').value,
      catatan: document.getElementById('mp-catatan').value
    };
    if (!payload.nama) { toast('Isi nama penitip'); return; }
    const tempId = 'PTP-TEMP-' + Date.now();
    state.data.penitip.push({ id_penitip: tempId, nama: payload.nama, kontak: payload.kontak, no_rekening: payload.noRekening, catatan: payload.catatan, aktif: true });
    persistCache();
    Sync.queueAction('addPenitip', payload).then(function () {
      toast('Penitip ditambahkan');
      closeModalPenitip();
      ['mp-nama', 'mp-kontak', 'mp-rekening', 'mp-catatan'].forEach(function (id) { document.getElementById(id).value = ''; });
      renderAll();
    }).catch(function (err) { toast('Gagal: ' + err.message); });
  }

  // ---------- pengaturan actions ----------
  function saveSettings() {
    const payload = { nama_kantin: document.getElementById('set-nama').value, fee_default_persen: Number(document.getElementById('set-fee').value) || 10 };
    state.data.settings.nama_kantin = payload.nama_kantin;
    state.data.settings.fee_default_persen = payload.fee_default_persen;
    persistCache();
    Sync.queueAction('updateSettings', payload).then(function () { toast('Pengaturan disimpan'); renderAll(); }).catch(function (err) { toast('Gagal: ' + err.message); });
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
    document.getElementById('onb-submit').addEventListener('click', submitOnboarding);
    document.getElementById('onb-test-connection').addEventListener('click', function () {
      const url = document.getElementById('onb-api-url').value.trim();
      if (url) Sync.setApiUrl(url);
      document.getElementById('onb-conn-status').textContent = 'Menghubungi server...';
      fetch(Sync.getApiUrl() + '?action=ping').then(function (r) { return r.json(); }).then(function (j) {
        document.getElementById('onb-conn-status').textContent = j.ok ? '✅ Terhubung ke server.' : '❌ ' + j.error;
      }).catch(function (err) { document.getElementById('onb-conn-status').textContent = '❌ Gagal terhubung: ' + err.message; });
    });
    addOnbItem();

    document.getElementById('opn-submit').addEventListener('click', submitOpname);
    document.getElementById('rst-submit').addEventListener('click', submitRestok);
    document.getElementById('bia-submit').addEventListener('click', submitBiaya);
    document.getElementById('byr-submit').addEventListener('click', submitBayar);
    document.getElementById('set-save').addEventListener('click', saveSettings);
    document.getElementById('set-save-url').addEventListener('click', function () {
      Sync.setApiUrl(document.getElementById('set-api-url').value.trim());
      toast('URL disimpan');
    });
    document.getElementById('set-sync-now').addEventListener('click', function () { Sync.syncNow().then(function () { toast('Sinkronisasi selesai'); }).catch(function (err) { toast('Gagal sinkron: ' + err.message); }); });
    document.getElementById('set-refresh-cache').addEventListener('click', function () {
      Sync.fetchInitialData().then(function (d) { state.data = d; renderAll(); toast('Data diperbarui'); }).catch(function (err) { toast('Gagal: ' + err.message); });
    });

    document.getElementById('rst-open-add-barang').addEventListener('click', openModalBarang);
    document.getElementById('rst-open-add-penitip').addEventListener('click', openModalPenitip);
    document.getElementById('bp-add-barang').addEventListener('click', openModalBarang);
    document.getElementById('bp-add-penitip').addEventListener('click', openModalPenitip);
    document.getElementById('mb-save').addEventListener('click', saveModalBarang);
    document.getElementById('mb-cancel').addEventListener('click', closeModalBarang);
    document.getElementById('mp-save').addEventListener('click', saveModalPenitip);
    document.getElementById('mp-cancel').addEventListener('click', closeModalPenitip);
    document.getElementById('mb-jenis').addEventListener('change', function () {
      document.getElementById('mb-penitip-wrap').classList.toggle('hidden', this.value !== 'titipan');
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
}
