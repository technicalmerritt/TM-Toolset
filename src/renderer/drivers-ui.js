'use strict';

// Drivers tab: scan this PC, match against the offline library, fix in one
// click; manage the library (harvest / import / list / remove); and fetch
// drivers from Windows Update and the Microsoft Update Catalog.
(function () {
  const els = {};
  let loadedOnce = false;
  let busy = false;
  let activeLog = null;
  let activeState = null;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmtBytes(b) {
    b = Number(b) || 0;
    if (b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }
  function toast(msg) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('toast--show');
    setTimeout(() => t.classList.remove('toast--show'), 3200);
  }

  const CLASS_LABEL = {
    DISPLAY: 'Display / GPU', NET: 'Network (Ethernet / Wi-Fi)', MEDIA: 'Audio', HDC: 'Storage controllers',
    SCSIADAPTER: 'Storage controllers', USB: 'USB controllers', BLUETOOTH: 'Bluetooth', NETWORK: 'Network',
    SYSTEM: 'System / chipset', MONITOR: 'Monitors', KEYBOARD: 'Keyboards', MOUSE: 'Mice & pointing',
    HIDCLASS: 'Input (HID)', HID: 'Input (HID)', IMAGE: 'Cameras & scanners', PRINTER: 'Printers',
    PRINTQUEUE: 'Printers', FIRMWARE: 'Firmware', BIOMETRIC: 'Biometric', SMARTCARDREADER: 'Smart-card readers',
    PROCESSOR: 'Processor', COMPUTER: 'System', DISKDRIVE: 'Disk drives', CDROM: 'Optical drives',
    USBDEVICE: 'USB devices', CAMERA: 'Cameras', SOFTWARECOMPONENT: 'Software components',
    EXTENSION: 'Driver extensions', UNKNOWN: 'Unknown / no driver', OTHER: 'Other',
  };
  function classLabel(c) {
    c = ('' + c).toUpperCase();
    return CLASS_LABEL[c] || (c ? c.charAt(0) + c.slice(1).toLowerCase() : 'Other');
  }

  // ---------- shared live-log runner ----------
  function startRun(logEl, stateEl, title, titleEl) {
    busy = true;
    activeLog = logEl; activeState = stateEl;
    if (titleEl) titleEl.textContent = title;
    logEl.parentElement.hidden = false;
    logEl.textContent = '';
    stateEl.textContent = 'Running…';
    stateEl.className = 'repairs-state repairs-state--run';
    appendLog('Starting…');
    logEl.parentElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function appendLog(line) {
    if (!activeLog || line == null) return;
    activeLog.textContent += String(line).replace(/\s+$/, '') + '\n';
    activeLog.scrollTop = activeLog.scrollHeight;
    window.TMActivity && window.TMActivity.update('drivers:pack', String(line).replace(/\s+$/, ''));
  }
  function endRun(ok, msg) {
    appendLog('\n' + msg);
    if (activeState) {
      activeState.textContent = ok ? 'Completed' : 'Failed';
      activeState.className = 'repairs-state ' + (ok ? 'repairs-state--good' : 'repairs-state--bad');
    }
    busy = false; activeLog = null; activeState = null;
  }
  function explain(code) {
    const m = {
      admin: 'needs administrator rights — use the “Run as administrator” banner, then retry',
      'no-lib': 'no library location set', 'no-source': 'that folder was not found',
      'inf-missing': 'the driver file was gone', 'image-missing': 'that image folder was not found',
      'bad-target': 'that package is not inside the library', 'unknown-action': 'internal error',
    };
    return m[code] || (code || 'unknown error');
  }

  // ================= THIS PC =================
  function loadScan() {
    els.scanStatus.hidden = false;
    els.scanError.hidden = true;
    els.classes.hidden = true;
    els.summary.hidden = true;
    els.scanActions.hidden = true;
    return window.drivers.scan().then((res) => {
      els.scanStatus.hidden = true;
      if (!res || !res.ok) { els.scanError.hidden = false; els.scanErrorDetail.textContent = (res && res.error) || 'Unknown error.'; return; }
      renderScan(res.data || {});
    }).catch((e) => { els.scanStatus.hidden = true; els.scanError.hidden = false; els.scanErrorDetail.textContent = (e && e.message) || String(e); });
  }

  function renderScan(d) {
    const classes = d.classes || [];
    // Summary
    els.summary.hidden = false;
    els.summary.innerHTML = '';
    const bits = [
      ['Devices', d.deviceCount || 0, ''],
      ['Problems', d.problemCount || 0, (d.problemCount ? 'bad' : 'good')],
      ['Fixable from pack', d.fixableCount || 0, (d.fixableCount ? 'warn' : 'good')],
      ['Library packages', d.libIndexed || 0, ''],
    ];
    for (const [lbl, val, cls] of bits) {
      const b = el('div', 'drv-stat' + (cls ? ' drv-stat--' + cls : ''));
      b.appendChild(el('div', 'drv-stat__val', String(val)));
      b.appendChild(el('div', 'drv-stat__lbl', lbl));
      els.summary.appendChild(b);
    }
    if (d.make || d.model) {
      const mm = el('p', 'muted drv-machine', ('This PC: ' + [d.make, d.model].filter(Boolean).join(' ')).trim());
      els.summary.appendChild(mm);
    }
    if (d.libIndexed === 0) {
      els.summary.appendChild(el('p', 'muted drv-machine', 'Your offline library is empty or not indexed yet — go to Offline Library to harvest or import drivers, then rescan.'));
    }

    els.scanActions.hidden = false;
    els.fixAll.disabled = !(d.fixableCount > 0);
    els.fixAll.textContent = d.fixableCount > 0 ? ('Fix all from library (' + d.fixableCount + ')') : 'Nothing to fix from library';

    // Classes — fixable first
    els.classes.hidden = false;
    els.classes.innerHTML = '';
    const sorted = classes.slice().sort((a, b) => (b.fixable - a.fixable) || (b.problems - a.problems) || a.class.localeCompare(b.class));
    for (const c of sorted) {
      const card = el('section', 'drv-class');
      const head = el('div', 'drv-class__head');
      head.appendChild(el('span', 'drv-class__name', classLabel(c.class)));
      const tags = el('span', 'drv-class__tags');
      if (c.fixable) tags.appendChild(el('span', 'drv-tag drv-tag--fix', c.fixable + ' fixable'));
      if (c.problems) tags.appendChild(el('span', 'drv-tag drv-tag--bad', c.problems + ' problem'));
      tags.appendChild(el('span', 'drv-tag', c.count + ' device' + (c.count === 1 ? '' : 's')));
      head.appendChild(tags);
      card.appendChild(head);

      for (const dev of (c.devices || [])) {
        const row = el('div', 'drv-dev' + (dev.libNewer ? ' drv-dev--fix' : dev.hasProblem ? ' drv-dev--bad' : ''));
        const info = el('div', 'drv-dev__info');
        info.appendChild(el('div', 'drv-dev__name', dev.name || '(unnamed device)'));
        const meta = [];
        if (dev.provider) meta.push(dev.provider);
        if (dev.version) meta.push('v' + dev.version);
        if (dev.date) meta.push(dev.date);
        if (dev.hasProblem) meta.push('⚠ ' + (dev.status || 'problem'));
        info.appendChild(el('div', 'drv-dev__meta muted', meta.join('  ·  ')));
        if (dev.libPresent) {
          const lm = dev.libNewer
            ? ('Pack has v' + dev.libVersion + (dev.libDate ? ' (' + dev.libDate + ')' : '') + ' — newer')
            : ('Pack match: v' + dev.libVersion + (dev.libDate ? ' (' + dev.libDate + ')' : '') + ' — not newer');
          info.appendChild(el('div', 'drv-dev__lib' + (dev.libNewer ? ' drv-dev__lib--fix' : ''), lm));
        }
        row.appendChild(info);
        if (dev.libNewer && dev.libInf) {
          const fix = el('button', 'btn btn--primary btn--sm', dev.hasProblem ? 'Install' : 'Update');
          fix.type = 'button';
          fix.addEventListener('click', () => fixOne(dev));
          row.appendChild(fix);
        }
        card.appendChild(row);
      }
      els.classes.appendChild(card);
    }
  }

  function fixOne(dev) {
    if (busy) { toast('Something is already running.'); return; }
    startRun(els.runnerLog, els.runnerState, 'Installing: ' + (dev.name || 'driver') + '…', els.runnerTitle);
    window.drivers.library({ action: 'install', inf: dev.libInf }).then((res) => {
      const r = (res && res.data) || {};
      if (!res || !res.ok) { endRun(false, 'Failed: ' + ((res && res.error) || 'error')); return; }
      if (r.error) { endRun(false, 'Error: ' + explain(r.error)); return; }
      endRun(r.ok, r.ok ? 'Driver installed.' + (r.restartRecommended ? ' A restart is recommended.' : '') : ('Finished (exit ' + r.exitCode + ').'));
      if (r.ok) loadScan();
    }).catch((e) => endRun(false, 'Failed: ' + ((e && e.message) || e)));
  }

  function fixAll() {
    if (busy) { toast('Something is already running.'); return; }
    if (!window.confirm('Install every library driver that matches this PC and is newer than what’s installed?\n\nWindows installs only better-ranked matches. A restart may be needed afterwards.')) return;
    startRun(els.runnerLog, els.runnerState, 'Installing all matching drivers from the library…', els.runnerTitle);
    window.drivers.library({ action: 'install' }).then((res) => {
      const r = (res && res.data) || {};
      if (!res || !res.ok) { endRun(false, 'Failed: ' + ((res && res.error) || 'error')); return; }
      if (r.error) { endRun(false, 'Error: ' + explain(r.error)); return; }
      endRun(r.ok, r.ok ? 'Done.' + (r.restartRecommended ? ' A restart is recommended.' : '') : ('Finished (exit ' + r.exitCode + ').'));
      if (r.ok) loadScan();
    }).catch((e) => endRun(false, 'Failed: ' + ((e && e.message) || e)));
  }

  function wuScan() {
    if (busy) { toast('Something is already running.'); return; }
    startRun(els.runnerLog, els.runnerState, 'Checking Windows Update for drivers…', els.runnerTitle);
    window.drivers.wu('scan').then((res) => {
      const r = (res && res.data) || {};
      if (!res || !res.ok) { endRun(false, 'Failed: ' + ((res && res.error) || 'error')); return; }
      const list = r.available || [];
      appendLog(list.length ? (list.length + ' driver update(s) available:') : 'No driver updates available — Windows thinks this PC is up to date.');
      for (const u of list) appendLog('  • ' + u.title);
      endRun(true, list.length ? 'Found ' + list.length + '. Use the button below to install.' : 'Nothing to install.');
      if (list.length) {
        const btn = el('button', 'btn btn--primary btn--sm', 'Install ' + list.length + ' from Windows Update');
        btn.type = 'button';
        btn.addEventListener('click', () => { btn.remove(); wuInstall(); });
        els.runnerLog.parentElement.appendChild(btn);
      }
    }).catch((e) => endRun(false, 'Failed: ' + ((e && e.message) || e)));
  }
  function wuInstall() {
    if (busy) { toast('Something is already running.'); return; }
    startRun(els.runnerLog, els.runnerState, 'Downloading & installing from Windows Update…', els.runnerTitle);
    window.drivers.wu('install').then((res) => {
      const r = (res && res.data) || {};
      if (!res || !res.ok) { endRun(false, 'Failed: ' + ((res && res.error) || 'error')); return; }
      if (r.error) { endRun(false, 'Error: ' + explain(r.error)); return; }
      endRun(true, (r.installed || 0) + ' driver(s) processed.' + (r.rebootRequired ? ' A restart is required.' : ''));
      loadScan();
    }).catch((e) => endRun(false, 'Failed: ' + ((e && e.message) || e)));
  }

  // ================= OFFLINE LIBRARY =================
  function refreshLibPath() {
    return window.drivers.getLibrary().then((r) => { if (r && r.path) els.libPath.value = r.path; });
  }
  function loadLib() {
    els.libStatus.hidden = false;
    els.libStatusText.textContent = 'Reading and indexing the library…';
    els.libClasses.hidden = true;
    return window.drivers.library({ action: 'list' }).then((res) => {
      els.libStatus.hidden = true;
      const r = (res && res.data) || {};
      if (!res || !res.ok) { toast('Library read failed: ' + ((res && res.error) || explain(r.error))); return; }
      if (r.error) { toast('Library error: ' + explain(r.error)); return; }
      renderLib(r.summary || {});
    }).catch((e) => { els.libStatus.hidden = true; toast('Library read failed: ' + ((e && e.message) || e)); });
  }
  function renderLib(sum) {
    els.libTotal.textContent = (sum.packageCount || 0) + ' driver packages · ' + fmtBytes(sum.totalBytes || 0);
    els.libClasses.hidden = false;
    els.libClasses.innerHTML = '';
    const classes = sum.classes || [];
    if (!classes.length) {
      els.libClasses.appendChild(el('p', 'muted', 'The library is empty. Harvest this PC’s drivers, import a folder, or download from the Get Drivers tab.'));
      return;
    }
    // class breakdown
    const grid = el('div', 'drv-libgrid');
    for (const c of classes) {
      const cell = el('div', 'drv-libcell');
      cell.appendChild(el('div', 'drv-libcell__cls', classLabel(c.class)));
      cell.appendChild(el('div', 'drv-libcell__n', c.count + ' · ' + fmtBytes(c.sizeBytes)));
      grid.appendChild(cell);
    }
    els.libClasses.appendChild(grid);

    // package list (capped)
    const pkgs = sum.packages || [];
    const cap = 300;
    const head = el('h4', 'info-sub', 'Packages' + (pkgs.length > cap ? ' (showing first ' + cap + ' of ' + pkgs.length + ')' : ''));
    els.libClasses.appendChild(head);
    const list = el('div', 'drv-pkgs');
    pkgs.slice(0, cap).forEach((p) => {
      const row = el('div', 'drv-pkg');
      const info = el('div', 'drv-pkg__info');
      info.appendChild(el('span', 'drv-pkg__prov', (p.provider || classLabel(p.class))));
      const meta = [classLabel(p.class)];
      if (p.version) meta.push('v' + p.version);
      if (p.date) meta.push(p.date);
      meta.push(fmtBytes(p.sizeBytes));
      info.appendChild(el('span', 'muted drv-pkg__meta', meta.join('  ·  ')));
      row.appendChild(info);
      const rm = el('button', 'btn btn--ghost btn--xs btn--danger', 'Remove');
      rm.type = 'button';
      rm.addEventListener('click', () => {
        if (!window.confirm('Remove this driver package from the library folder?\n\n' + p.folder)) return;
        rm.disabled = true;
        window.drivers.library({ action: 'remove', target: p.folder }).then((res) => {
          if (res && res.ok && res.data && res.data.ok) { toast('Removed.'); loadLib(); }
          else { toast('Remove failed.'); rm.disabled = false; }
        });
      });
      row.appendChild(rm);
      list.appendChild(row);
    });
    els.libClasses.appendChild(list);
  }

  function libAction(action, extra, title) {
    if (busy) { toast('Something is already running.'); return Promise.resolve(); }
    startRun(els.libRunnerLog, els.libRunnerState, title, els.libRunnerTitle);
    return window.drivers.library(Object.assign({ action }, extra || {})).then((res) => {
      const r = (res && res.data) || {};
      if (!res || !res.ok) { endRun(false, 'Failed: ' + ((res && res.error) || 'error')); return; }
      if (r.error) { endRun(false, 'Error: ' + explain(r.error)); return; }
      let msg = 'Done.';
      if (action === 'harvest') msg = 'Harvested ' + (r.exported || 0) + ' package(s). Library now holds ' + (r.packageCount || 0) + '.';
      if (action === 'import') msg = 'Imported ' + (r.imported || 0) + ' package(s). Library now holds ' + (r.packageCount || 0) + '.';
      endRun(true, msg);
      loadLib();
    }).catch((e) => endRun(false, 'Failed: ' + ((e && e.message) || e)));
  }

  // ================= GET DRIVERS (catalog) =================
  function catSearch() {
    const q = els.catQuery.value.trim();
    if (!q) { toast('Type a hardware ID or driver name.'); return; }
    els.catStatus.hidden = false;
    els.catResults.innerHTML = '';
    window.drivers.catalogSearch(q).then((res) => {
      els.catStatus.hidden = true;
      if (!res || !res.ok) { els.catResults.appendChild(el('p', 'test-err', 'Search failed: ' + ((res && res.error) || 'error'))); return; }
      const results = res.results || [];
      if (!results.length) { els.catResults.appendChild(el('p', 'muted', 'No matches in the Microsoft Update Catalog.')); return; }
      for (const r of results) {
        const row = el('div', 'drv-catrow');
        row.appendChild(el('div', 'drv-catrow__title', r.title));
        const dl = el('button', 'btn btn--primary btn--sm', 'Download to library');
        dl.type = 'button';
        dl.addEventListener('click', () => catDownload(r, dl));
        row.appendChild(dl);
        els.catResults.appendChild(row);
      }
    }).catch((e) => { els.catStatus.hidden = true; els.catResults.appendChild(el('p', 'test-err', 'Search failed: ' + ((e && e.message) || e))); });
  }
  function catDownload(r, btn) {
    if (busy) { toast('Something is already running.'); return; }
    btn.disabled = true;
    startRun(els.getRunnerLog, els.getRunnerState, 'Downloading: ' + r.title + '…', els.getRunnerTitle);
    window.drivers.catalogDownload({ id: r.id, title: r.title }).then((res) => {
      if (!res || !res.ok) { endRun(false, 'Download failed: ' + ((res && res.error) || 'error')); btn.disabled = false; return; }
      endRun(true, 'Saved ' + (res.files || 0) + ' file(s) to the library and re-indexed. Rescan This PC to match it.');
      btn.textContent = 'Downloaded ✓';
    }).catch((e) => { endRun(false, 'Download failed: ' + ((e && e.message) || e)); btn.disabled = false; });
  }

  // ================= DRIVERPACKS (built-in torrent fetch) =================
  let packFiles = [];              // last-listed torrent packs
  const PACK_CAT_LABEL = {
    lan: 'Network (LAN / Ethernet)', wlan: 'Wi-Fi (WLAN)', massstorage: 'Storage controllers (AHCI/RAID/NVMe/RST)',
    chipset: 'Chipset', video: 'Graphics / GPU', videoserver: 'Graphics (server)', sound: 'Audio', bluetooth: 'Bluetooth',
    touchpad: 'Touchpads', cardreader: 'Card readers', usb: 'USB controllers', monitor: 'Monitors', printer: 'Printers',
    webcam: 'Webcams', modem: 'Modems', tv: 'TV tuners', misc: 'Miscellaneous', phone: 'Phones / mobile', vendor: 'Vendor / OEM',
  };
  function packCatLabel(c) { c = ('' + c).toLowerCase(); return PACK_CAT_LABEL[c] || (c.charAt(0).toUpperCase() + c.slice(1)); }

  function runPack(factory, title, doneMsg) {
    if (busy) { toast('Something is already running.'); return; }
    startRun(els.packsLog, els.packsState, title, els.packsTitle);
    els.packsCancel.hidden = false;
    window.TMActivity && window.TMActivity.start('drivers:pack', title);
    factory().then((res) => {
      const r = (res && res.data) || {};
      if (!res || !res.ok) { endRun(false, 'Failed: ' + ((res && res.error) || 'error')); return; }
      if (r.cancelled) { endRun(false, 'Cancelled.'); return; }
      if (r.noscope) { endRun(true, 'Nothing to update yet — download some packs first.'); return; }
      endRun(true, doneMsg(r));
      loadPacksAuto();
    }).catch((e) => endRun(false, 'Failed: ' + ((e && e.message) || e)))
      .finally(() => { els.packsCancel.hidden = true; window.TMActivity && window.TMActivity.end('drivers:pack'); });
  }

  function fetchScope(scope, label) {
    const big = scope.indexOf('*') >= 0;
    if (!window.confirm('Download the ' + label + ' driverpack(s) over BitTorrent' + (big ? ' — this is the FULL set and can be tens of GB' : '') + ', extract and add them to your library?\n\nYou can cancel any time.')) return;
    runPack(() => window.drivers.packsFetch(scope),
      'Downloading ' + label + ' packs…',
      (r) => 'Done — extracted ' + (r.extracted || 0) + ' of ' + (r.requested || 0) + ' pack(s). Rescan This PC to use them offline.');
  }

  function checkPackUpdates() {
    runPack(() => window.drivers.packsUpdate(),
      'Checking for driverpack updates…',
      (r) => (r.added ? ('Updated — fetched ' + r.added + ' new/updated pack(s) of ' + r.checked + ' in scope.') : ('Up to date — ' + r.checked + ' pack(s) checked, nothing new.')));
  }

  function openPicker() {
    if (busy) { toast('Something is already running.'); return; }
    els.picker.hidden = false;
    els.pickerCats.innerHTML = '';
    els.pickerTotal.textContent = 'Reading the torrent pack list…';
    window.drivers.packsList().then((res) => {
      if (!res || !res.ok) { els.pickerTotal.textContent = 'Could not list packs: ' + ((res && res.error) || 'error'); return; }
      packFiles = res.files || [];
      renderPicker();
    }).catch((e) => { els.pickerTotal.textContent = 'Could not list packs: ' + ((e && e.message) || e); });
  }

  function renderPicker() {
    // group by category
    const cats = {};
    for (const f of packFiles) {
      const c = (f.category || 'Misc').toLowerCase();
      if (!cats[c]) cats[c] = { names: [], size: 0 };
      cats[c].names.push(f.name);
      cats[c].size += Number(f.sizeBytes) || 0;
    }
    els.pickerCats.innerHTML = '';
    Object.keys(cats).sort().forEach((c) => {
      const row = el('label', 'drv-catpick');
      const cb = el('input'); cb.type = 'checkbox'; cb.dataset.cat = c;
      cb.addEventListener('change', updatePickTotal);
      row.appendChild(cb);
      const t = el('span', 'drv-catpick__t', packCatLabel(c));
      row.appendChild(t);
      row.appendChild(el('span', 'muted drv-catpick__n', cats[c].names.length + ' · ' + fmtBytes(cats[c].size)));
      els.pickerCats.appendChild(row);
    });
    els.pickerCats._cats = cats;
    updatePickTotal();
  }
  function checkedNames() {
    const cats = els.pickerCats._cats || {};
    let names = [];
    for (const cb of els.pickerCats.querySelectorAll('input[type=checkbox]')) {
      if (cb.checked && cats[cb.dataset.cat]) names = names.concat(cats[cb.dataset.cat].names);
    }
    return names;
  }
  function updatePickTotal() {
    const cats = els.pickerCats._cats || {};
    let n = 0, size = 0;
    for (const cb of els.pickerCats.querySelectorAll('input[type=checkbox]')) {
      if (cb.checked && cats[cb.dataset.cat]) { n += cats[cb.dataset.cat].names.length; size += cats[cb.dataset.cat].size; }
    }
    els.pickerTotal.textContent = n ? (n + ' pack(s) selected · ' + fmtBytes(size)) : 'Tick the categories you want, then Download selected.';
  }
  function downloadSelected() {
    const names = checkedNames();
    if (!names.length) { toast('Tick at least one category.'); return; }
    if (!window.confirm('Download ' + names.length + ' selected pack(s) over BitTorrent, extract and add to your library?')) return;
    runPack(() => window.drivers.packsDownload(names),
      'Downloading ' + names.length + ' selected pack(s)…',
      (r) => 'Done — extracted ' + (r.extracted || 0) + ' pack(s). Rescan This PC to use them offline.');
  }

  function loadPacksAuto() {
    return window.drivers.getPacksAuto().then((r) => {
      if (!r) return;
      els.packsAuto.checked = !!r.auto;
      const scope = r.scope || [];
      let s = 'Nothing downloaded yet.';
      if (scope.indexOf('*') >= 0) s = 'Maintained scope: all categories.';
      else if (scope.length) s = 'Maintained scope: ' + scope.map(packCatLabel).join(', ') + '.';
      els.packsScope.textContent = s;
    });
  }

  // ================= DRIVERPACKS (SDI integration) =================
  function loadSdi() {
    return window.drivers.getSdi().then((r) => {
      if (!r) return;
      els.sdiExe.value = r.exe || '';
      els.sdiPacks.value = r.packs || '';
      els.sdiHint.textContent = r.exists ? '' : 'Locate SDIO.exe (or Get SDI) to enable launching.';
    });
  }

  // ================= sub-nav =================
  function showSub(name) {
    for (const b of document.querySelectorAll('#panel-drivers .subtab')) b.classList.toggle('subtab--active', b.dataset.dsub === name);
    const map = { scan: 'drv-scan', library: 'drv-library', get: 'drv-get', packs: 'drv-packs' };
    for (const k of Object.keys(map)) { const s = document.getElementById(map[k]); if (s) s.hidden = k !== name; }
    if (name === 'library' && !els.libClasses.dataset.loaded) { els.libClasses.dataset.loaded = '1'; refreshLibPath().then(loadLib); }
    if (name === 'packs' && !els.sdiExe.dataset.loaded) { els.sdiExe.dataset.loaded = '1'; loadSdi(); loadPacksAuto(); }
  }

  function wire() {
    els.scanStatus = $('#drvScanStatus'); els.scanError = $('#drvScanError'); els.scanErrorDetail = $('#drvScanErrorDetail');
    els.summary = $('#drvSummary'); els.classes = $('#drvClasses'); els.scanActions = $('#drvScanActions');
    els.fixAll = $('#drvFixAll'); els.wuBtn = $('#drvWuScan');
    els.runnerLog = $('#drvRunnerLog'); els.runnerState = $('#drvRunnerState'); els.runnerTitle = $('#drvRunnerTitle');
    els.libPath = $('#drvLibPath'); els.libTotal = $('#drvLibTotal');
    els.libStatus = $('#drvLibStatus'); els.libStatusText = $('#drvLibStatusText'); els.libClasses = $('#drvLibClasses');
    els.libRunnerLog = $('#drvLibRunnerLog'); els.libRunnerState = $('#drvLibRunnerState'); els.libRunnerTitle = $('#drvLibRunnerTitle');
    els.catQuery = $('#drvCatQuery'); els.catStatus = $('#drvCatStatus'); els.catResults = $('#drvCatResults');
    els.getRunnerLog = $('#drvGetRunnerLog'); els.getRunnerState = $('#drvGetRunnerState'); els.getRunnerTitle = $('#drvGetRunnerTitle');
    els.sdiExe = $('#drvSdiExe'); els.sdiPacks = $('#drvSdiPacks'); els.sdiHint = $('#drvSdiHint');
    els.packsLog = $('#drvPacksLog'); els.packsState = $('#drvPacksState'); els.packsTitle = $('#drvPacksTitle'); els.packsCancel = $('#drvPacksCancel');
    els.packsAuto = $('#drvPacksAuto'); els.packsScope = $('#drvPacksScope');
    els.picker = $('#drvPicker'); els.pickerCats = $('#drvPickerCats'); els.pickerTotal = $('#drvPickerTotal');
    if (!els.classes) return;

    for (const b of document.querySelectorAll('#panel-drivers .subtab')) b.addEventListener('click', () => showSub(b.dataset.dsub));
    $('#drvRescan').addEventListener('click', loadScan);
    els.fixAll.addEventListener('click', fixAll);
    els.wuBtn.addEventListener('click', wuScan);

    $('#drvLibChange').addEventListener('click', () => window.drivers.pickFolder().then((p) => {
      if (!p) return;
      window.drivers.setLibrary(p).then((r) => { if (r && r.ok) { els.libPath.value = r.path; loadLib(); loadedOnce = false; } });
    }));
    $('#drvLibOpen').addEventListener('click', () => window.drivers.openLibrary());
    $('#drvHarvest').addEventListener('click', () => {
      if (window.confirm('Export every third-party driver installed on THIS PC into the library? Great for building a pack from a known-good machine.')) libAction('harvest', null, 'Harvesting this PC’s drivers…');
    });
    $('#drvImport').addEventListener('click', () => window.drivers.pickFolder().then((p) => { if (p) libAction('import', { source: p }, 'Importing drivers from a folder…'); }));
    $('#drvRefreshLib').addEventListener('click', loadLib);

    els.catQuery.addEventListener('keydown', (e) => { if (e.key === 'Enter') catSearch(); });
    $('#drvCatSearch').addEventListener('click', catSearch);

    $('#drvSdiLocate').addEventListener('click', () => window.drivers.pickSdiExe().then((p) => {
      if (!p) return;
      window.drivers.setSdi({ exe: p }).then(() => loadSdi());
    }));
    $('#drvSdiPacksChange').addEventListener('click', () => window.drivers.pickFolder().then((p) => {
      if (!p) return;
      window.drivers.setSdi({ packs: p }).then(() => loadSdi());
    }));
    $('#drvPacksNet').addEventListener('click', (e) => fetchScope(e.currentTarget.dataset.scope.split(','), e.currentTarget.dataset.label));
    $('#drvPacksStorage').addEventListener('click', (e) => fetchScope(e.currentTarget.dataset.scope.split(','), e.currentTarget.dataset.label));
    $('#drvPacksAll').addEventListener('click', (e) => fetchScope(['*'], 'ALL'));
    $('#drvPacksChoose').addEventListener('click', openPicker);
    $('#drvPacksUpdate').addEventListener('click', checkPackUpdates);
    $('#drvPickAll').addEventListener('click', () => { for (const cb of els.pickerCats.querySelectorAll('input[type=checkbox]')) cb.checked = true; updatePickTotal(); });
    $('#drvPickNone').addEventListener('click', () => { for (const cb of els.pickerCats.querySelectorAll('input[type=checkbox]')) cb.checked = false; updatePickTotal(); });
    $('#drvPickGo').addEventListener('click', downloadSelected);
    els.packsAuto.addEventListener('change', () => window.drivers.setPacksAuto(els.packsAuto.checked).then(() => toast(els.packsAuto.checked ? 'Auto-update on — packs refresh on startup.' : 'Auto-update off.')));
    $('#drvPacksCancel').addEventListener('click', () => { els.packsCancel.disabled = true; els.packsCancel.textContent = 'Cancelling…'; window.drivers.packsCancel().finally(() => { els.packsCancel.disabled = false; els.packsCancel.textContent = 'Cancel'; }); });
    if (window.drivers.onAutoDone) window.drivers.onAutoDone((r) => { if (r && r.added) toast('Driverpacks auto-updated: ' + r.added + ' new pack(s).'); });
    $('#drvSdiLaunch').addEventListener('click', () => {
      window.drivers.launchSdi({}).then((r) => {
        if (r && r.ok) toast('Snappy Driver Installer launched — packs will go to ' + (r.packs || 'your folder') + '.');
        else if (r && r.error === 'not-found') toast('Set the SDIO.exe location first (Locate…, or Get SDI to download it).');
        else toast('Could not launch SDI: ' + ((r && r.error) || 'unknown'));
      });
    });

    for (const b of document.querySelectorAll('#panel-drivers [data-openurl]')) b.addEventListener('click', () => window.sys && window.sys.openUrl(b.dataset.openurl));

    if (window.drivers && window.drivers.onProgress) window.drivers.onProgress((msg) => appendLog(msg));

    const tab = document.querySelector('.tab[data-tab="drivers"]');
    if (tab) tab.addEventListener('click', () => { if (!loadedOnce) { loadedOnce = true; refreshLibPath().then(loadScan); } });
  }

  window.addEventListener('DOMContentLoaded', wire);
})();
