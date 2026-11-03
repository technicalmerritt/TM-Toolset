'use strict';

(function () {
  const els = {};
  let cleaned = false;
  let cleanBusy = false;
  let usageBusy = false;
  let volumesLoaded = false;
  let currentPath = '';
  let rootTotal = 1;
  let treeNodes = [];
  let initialScanning = false;

  function $(s) { return document.querySelector(s); }
  function arr(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
  function num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmtBytes(b) {
    b = num(b);
    if (b >= 1e9) return (b / 1073741824).toFixed(2) + ' GB';
    if (b >= 1e6) return (b / 1048576).toFixed(1) + ' MB';
    if (b >= 1e3) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
  }
  function toast(msg, kind) {
    const t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.className = 'toast toast--show' + (kind === 'error' ? ' toast--error' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3600);
  }

  // ---------------- Clean Up ----------------
  const OFF_BY_DEFAULT = { prefetch: true };

  async function cleanupScan() {
    if (cleanBusy) { toast('A clean-up scan is already running - please wait.', 'error'); return; }
    cleanBusy = true;
    els.cleanScan.disabled = true;
    els.cleanStatus.hidden = false; els.cleanList.hidden = true;
    els.cleanTotal.textContent = ''; els.cleanClean.hidden = true;
    els.cleanStatusText.textContent = 'Measuring...';
    try {
      const res = await window.disktools.cleanupScan();
      if (!res || res.ok !== true) { toast('Scan failed: ' + ((res && res.error) || ''), 'error'); return; }
      renderCats(res.data || {});
    } catch (e) { toast('Scan failed: ' + ((e && e.message) || e), 'error'); }
    finally { cleanBusy = false; els.cleanScan.disabled = false; els.cleanStatus.hidden = true; }
  }

  function renderCats(data) {
    els.cleanList.hidden = false;
    els.cleanList.innerHTML = '';
    const cats = arr(data.categories);
    let selectable = 0;
    for (const c of cats) {
      const row = el('label', 'dt-cat');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.dataset.id = c.id;
      cb.checked = !OFF_BY_DEFAULT[c.id] && num(c.bytes) > 0;
      cb.disabled = num(c.bytes) <= 0;
      if (num(c.bytes) > 0) selectable++;
      cb.addEventListener('change', updateCleanButton);
      const info = el('div', 'dt-cat__info');
      info.appendChild(el('div', 'dt-cat__label', c.label));
      info.appendChild(el('div', 'dt-cat__sub', num(c.count) + ' files'));
      const size = el('div', 'dt-cat__size', fmtBytes(c.bytes));
      row.append(cb, info, size);
      els.cleanList.appendChild(row);
    }
    els.cleanTotal.textContent = 'Reclaimable: ' + fmtBytes(data.totalBytes);
    els.cleanClean.hidden = selectable === 0;
    updateCleanButton();
  }

  function checkedIds() {
    return Array.from(els.cleanList.querySelectorAll('input[type=checkbox]:checked:not(:disabled)')).map((c) => c.dataset.id);
  }
  function updateCleanButton() {
    const ids = checkedIds();
    els.cleanClean.disabled = ids.length === 0;
    els.cleanClean.textContent = ids.length ? 'Clean selected (' + ids.length + ')' : 'Clean selected';
  }

  async function cleanupClean() {
    if (cleanBusy) { toast('A clean-up is already running - please wait.', 'error'); return; }
    const ids = checkedIds();
    if (!ids.length) return;
    if (!window.confirm('Delete the selected junk categories?\n\nThis permanently removes those cached/temporary files (safe, but not undoable). Continue?')) return;
    cleanBusy = true; els.cleanClean.disabled = true; els.cleanScan.disabled = true;
    els.cleanStatus.hidden = false; els.cleanStatusText.textContent = 'Cleaning...';
    try {
      const res = await window.disktools.cleanupClean(ids.join(','));
      if (!res || res.ok !== true) { toast('Clean failed: ' + ((res && res.error) || ''), 'error'); return; }
      const d = res.data || {};
      if (d.error) { toast('Clean error: ' + d.error, 'error'); return; }
      toast('Freed about ' + fmtBytes(d.totalFreed) + '.');
      cleaned = true;
      await cleanupScan(); // refresh sizes
    } catch (e) { toast('Clean failed: ' + ((e && e.message) || e), 'error'); }
    finally { cleanBusy = false; els.cleanScan.disabled = false; els.cleanStatus.hidden = true; }
  }

  // ---------------- Disk Usage ----------------
  async function loadVolumes() {
    if (volumesLoaded) return;
    try {
      const res = await window.disktools.volumes();
      const vols = (res && res.ok && res.data && arr(res.data.volumes)) || [];
      els.usageDrive.innerHTML = '';
      for (const v of vols) {
        const o = el('option', null, `${v.drive}  ${v.label ? '(' + v.label + ') ' : ''}— ${v.freeGB} GB free of ${v.sizeGB} GB`);
        o.value = v.drive;
        els.usageDrive.appendChild(o);
      }
      if (!vols.length) { const o = el('option', null, 'C:\\'); o.value = 'C:\\'; els.usageDrive.appendChild(o); }
      volumesLoaded = true;
    } catch { /* ignore */ }
  }

  // Full (root) scan — streams live, then builds the top level of the tree.
  async function usageScan(path) {
    if (usageBusy) { toast('A disk-usage scan is already running - please wait.', 'error'); return; }
    usageBusy = true; initialScanning = true;
    els.usageScan.disabled = true; els.usageUp.disabled = true;
    els.usageResults.hidden = false; els.usageFilesWrap.hidden = true;
    els.usageFolders.innerHTML = ''; els.usageFiles.innerHTML = '';
    els.usagePac.hidden = false; els.usagePacText.textContent = 'Scanning ' + path + ' ...';
    els.usageCrumb.textContent = path;
    currentPath = path;
    try {
      const res = await window.disktools.usageScan(path);
      if (!res || res.ok !== true) { toast('Scan failed: ' + ((res && res.error) || ''), 'error'); els.usagePac.hidden = true; return; }
      const d = res.data || {};
      if (d.error === 'badpath') { toast('That path could not be read.', 'error'); els.usagePac.hidden = true; return; }
      if (d.error) { toast('Scan error: ' + d.error, 'error'); els.usagePac.hidden = true; return; }
      currentPath = d.path || path;
      rootTotal = num(d.totalBytes) || 1;
      els.usagePac.hidden = true;
      els.usageCrumb.textContent = currentPath + '   -   ' + fmtBytes(d.totalBytes) + ' in ' + num(d.scannedFiles).toLocaleString() + ' items';
      els.usageUp.hidden = /^[A-Za-z]:\\?$/.test(currentPath.replace(/\\+$/, '\\'));
      treeNodes = arr(d.folders).map((f) => makeNode(f, currentPath, 0, rootTotal));
      renderTree();
      els.usageFilesWrap.hidden = false; els.usageFiles.innerHTML = '';
      const files = arr(d.files);
      if (!files.length) els.usageFiles.appendChild(el('p', 'muted', 'No files found.'));
      for (const f of files) els.usageFiles.appendChild(bar(f.path, f.bytes, rootTotal, false));
    } catch (e) { toast('Scan failed: ' + ((e && e.message) || e), 'error'); els.usagePac.hidden = true; }
    finally { usageBusy = false; initialScanning = false; els.usageScan.disabled = false; els.usageUp.disabled = false; }
  }

  // bytes as a share of total; fill width = that share, label shows the %
  function bar(label, bytes, total, clickable) {
    const pct = (num(bytes) / Math.max(1, num(total))) * 100;
    const row = el('div', 'dt-bar' + (clickable ? ' dt-bar--link' : ''));
    const top = el('div', 'dt-bar__top');
    const lab = el('span', 'dt-bar__label', label);
    const right = el('span', 'dt-bar__right');
    right.append(el('span', 'dt-bar__pct', pct.toFixed(1) + '%'), el('span', 'dt-bar__val', fmtBytes(bytes)));
    top.append(lab, right);
    const track = el('div', 'dt-bar__track');
    const fill = el('div', 'dt-bar__fill');
    fill.style.width = Math.max(0.5, Math.min(100, pct)) + '%';
    track.appendChild(fill);
    row.append(top, track);
    return row;
  }

  // ---- expandable tree ----
  function makeNode(folder, parentPath, depth, parentTotal) {
    const isFiles = folder.name === '<Files>';
    return {
      name: folder.name,
      path: (isFiles || !folder.isDir) ? null : joinPath(parentPath, folder.name),
      bytes: num(folder.bytes), isDir: !!folder.isDir, files: num(folder.files), subdirs: num(folder.subdirs),
      lastChange: folder.lastChange || '', attr: folder.attr || '',
      depth: depth, parentTotal: Math.max(1, num(parentTotal)),
      tree: true, expanded: false, loaded: false, loading: false, children: [],
    };
  }

  function flattenTree() {
    const out = [];
    const walk = (nodes) => {
      for (const n of nodes) { out.push(n); if (n.expanded && n.children.length) walk(n.children); }
    };
    walk(treeNodes);
    return out;
  }

  async function toggleNode(node) {
    if (!node || !node.isDir || node.name === '<Files>') return;
    if (node.expanded) { node.expanded = false; renderTree(); return; }
    if (node.loaded) { node.expanded = true; renderTree(); return; }
    if (!node.path) return;
    if (usageBusy) { toast('Wait for the current disk-usage scan to finish first.', 'error'); return; }
    node.loading = true; renderTree();
    usageBusy = true; els.usageScan.disabled = true;
    try {
      const res = await window.disktools.usageScan(node.path);
      const d = (res && res.ok && res.data) || {};
      if (d.error) { toast('Could not open ' + node.name, 'error'); }
      else {
        const pt = num(d.totalBytes) || node.bytes || 1;
        node.children = arr(d.folders).map((f) => makeNode(f, node.path, node.depth + 1, pt));
        node.loaded = true; node.expanded = true;
      }
    } catch (e) { toast('Expand failed: ' + ((e && e.message) || e), 'error'); }
    finally { node.loading = false; usageBusy = false; els.usageScan.disabled = false; renderTree(); }
  }

  function renderTree() { renderRows(flattenTree()); }

  // Render any list of row objects (tree nodes, or flat live-snapshot rows).
  function renderRows(rows) {
    const container = els.usageFolders;
    container.innerHTML = '';
    const t = el('table', 'du-table');
    const thead = el('thead'); const htr = el('tr');
    const cols = [['Name', 0], ['Subtree %', 0], ['%', 1], ['Size', 1], ['Items', 1], ['Files', 1], ['Subdirs', 1], ['Last change', 0], ['Attr', 0]];
    for (const [lab, r] of cols) htr.appendChild(el('th', r ? 'du-r' : null, lab));
    thead.appendChild(htr); t.appendChild(thead);
    const tb = el('tbody');
    for (const row of rows) {
      const isFiles = row.name === '<Files>';
      const canExpand = !!row.tree && row.isDir && !isFiles;
      const total = Math.max(1, num(row.parentTotal) || rootTotal);
      const pct = (num(row.bytes) / total) * 100;
      const tr = el('tr', 'du-row' + (canExpand ? ' du-row--link' : ''));

      const nameTd = el('td', 'du-name');
      nameTd.style.paddingLeft = (10 + num(row.depth) * 18) + 'px';
      let arrow;
      if (row.loading) arrow = el('span', 'du-arrow du-arrow--load');
      else if (canExpand) arrow = el('span', 'du-arrow', row.expanded ? '▼' : '▶');
      else arrow = el('span', 'du-arrow');
      const icon = el('span', 'du-ico', isFiles ? '📄' : (row.isDir ? '📁' : '📄'));
      nameTd.append(arrow, icon, el('span', 'du-nm', row.name));
      tr.appendChild(nameTd);

      const barTd = el('td', 'du-bar');
      const track = el('div', 'du-bar__track'); const fill = el('div', 'du-bar__fill');
      fill.style.width = Math.max(0.5, Math.min(100, pct)) + '%';
      track.appendChild(fill); barTd.appendChild(track); tr.appendChild(barTd);

      tr.appendChild(el('td', 'du-r du-pct', pct.toFixed(1) + '%'));
      tr.appendChild(el('td', 'du-r', fmtBytes(row.bytes)));
      tr.appendChild(el('td', 'du-r', (num(row.files) + num(row.subdirs)).toLocaleString()));
      tr.appendChild(el('td', 'du-r', num(row.files).toLocaleString()));
      tr.appendChild(el('td', 'du-r', num(row.subdirs).toLocaleString()));
      tr.appendChild(el('td', 'du-dim', row.lastChange || ''));
      tr.appendChild(el('td', 'du-dim', row.attr || ''));

      if (canExpand) tr.addEventListener('click', () => toggleNode(row));
      tb.appendChild(tr);
    }
    t.appendChild(tb); container.appendChild(t);
  }

  function renderLive(snap) {
    els.usagePac.hidden = false;
    els.usagePacText.textContent = 'Scanning... ' + num(snap.n).toLocaleString() + ' items, ' + fmtBytes(snap.t) + ' so far';
    rootTotal = num(snap.t) || 1;
    // Build the top level as collapsible tree nodes, so expand arrows show from
    // the start. (Expanding is blocked until the main scan finishes.)
    treeNodes = arr(snap.f).map((f) => makeNode(
      { name: f.n, bytes: f.b, isDir: f.d, files: f.fi, subdirs: f.sd, lastChange: f.lc, attr: f.at },
      currentPath, 0, rootTotal
    ));
    renderTree();
  }

  function joinPath(a, b) {
    return a.replace(/\\+$/, '') + '\\' + b;
  }
  function parentPath(p) {
    const t = p.replace(/\\+$/, '');
    const i = t.lastIndexOf('\\');
    if (i <= 2) return t.slice(0, 3); // keep "C:\"
    return t.slice(0, i);
  }

  // ---------------- Drive / USB speed ----------------
  let speedBusy = false;
  function speedMetric(label, value, cls) {
    const b = el('div', 'metric' + (cls ? ' metric--' + cls : ''));
    b.appendChild(el('div', 'metric__val', value));
    b.appendChild(el('div', 'metric__lbl', label));
    return b;
  }
  async function loadSpeedVolumes() {
    try {
      const res = await window.disktools.volumes();
      const vols = (res && res.ok && res.data && arr(res.data.volumes)) || [];
      els.speedDrive.innerHTML = '';
      for (const v of vols) {
        const o = el('option', null, `${v.drive}  ${v.label ? '(' + v.label + ') ' : ''}— ${v.freeGB} GB free`);
        o.value = v.drive;
        els.speedDrive.appendChild(o);
      }
      if (!vols.length) { const o = el('option', null, 'C:\\'); o.value = 'C:\\'; els.speedDrive.appendChild(o); }
    } catch { /* ignore */ }
  }
  async function runSpeed() {
    if (speedBusy) { toast('A speed test is already running - please wait.', 'error'); return; }
    const path = els.speedDrive.value || 'C:\\';
    const sizeMB = parseInt(els.speedSize.value, 10) || 256;
    speedBusy = true; els.speedGo.disabled = true; els.speedCancel.hidden = false;
    els.speedResult.hidden = true; els.speedStatus.hidden = false; els.speedStatusText.textContent = 'Starting...';
    window.TMActivity && window.TMActivity.start('usbspeed', 'Disk/USB speed test (' + path + ')');
    try {
      const res = await window.disktools.usbSpeed(path, sizeMB);
      if (!res || res.ok !== true) { toast('Speed test failed: ' + ((res && res.error) || ''), 'error'); return; }
      const d = res.data || {};
      if (d.error) {
        const m = { 'no-space': 'not enough free space on that drive', 'bad-path': 'invalid drive', 'not-found': 'drive not found', 'no-path': 'no drive chosen' };
        toast('Speed test error: ' + (m[d.error] || d.error), 'error'); return;
      }
      renderSpeed(d);
    } catch (e) { toast('Speed test failed: ' + ((e && e.message) || e), 'error'); }
    finally { speedBusy = false; window.TMActivity && window.TMActivity.end('usbspeed'); els.speedGo.disabled = false; els.speedCancel.hidden = true; els.speedStatus.hidden = true; }
  }
  function renderSpeed(d) {
    els.speedResult.hidden = false; els.speedResult.innerHTML = '';
    if (d.cancelled) { els.speedResult.appendChild(el('p', 'muted', 'Test cancelled - temp file cleaned up.')); return; }
    els.speedResult.appendChild(speedMetric('Sequential write', d.writeMBps + ' MB/s', d.writeMBps >= 80 ? 'good' : d.writeMBps >= 20 ? 'warn' : 'bad'));
    els.speedResult.appendChild(speedMetric('Sequential read', d.readMBps + ' MB/s', d.readMBps >= 120 ? 'good' : d.readMBps >= 30 ? 'warn' : 'bad'));
    els.speedResult.appendChild(speedMetric('4K random read', d.rand4kIops + ' IOPS', d.rand4kIops >= 2000 ? 'good' : d.rand4kIops >= 400 ? 'warn' : 'bad'));
    els.speedResult.appendChild(speedMetric('4K read rate', d.rand4kMBps + ' MB/s'));
  }
  function cancelSpeed() {
    els.speedCancel.disabled = true; els.speedCancel.textContent = 'Cancelling...';
    window.disktools.usbSpeedCancel().finally(() => { els.speedCancel.disabled = false; els.speedCancel.textContent = 'Cancel'; });
  }

  // ---------------- sub-nav ----------------
  function selectSub(name) {
    els.subtabs.forEach((t) => t.classList.toggle('subtab--active', t.dataset.sub === name));
    els.secCleanup.hidden = name !== 'cleanup';
    els.secUsage.hidden = name !== 'usage';
    els.secSpeed.hidden = name !== 'speed';
    if (name === 'usage') loadVolumes();
    if (name === 'speed') loadSpeedVolumes();
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.subtabs = Array.from(document.querySelectorAll('#panel-disktools .subtab'));
    els.secCleanup = $('#dt-cleanup');
    els.secUsage = $('#dt-usage');
    els.secSpeed = $('#dt-speed');
    els.speedDrive = $('#speedDrive');
    els.speedSize = $('#speedSize');
    els.speedGo = $('#speedGo');
    els.speedCancel = $('#speedCancel');
    els.speedStatus = $('#speedStatus');
    els.speedStatusText = $('#speedStatusText');
    els.speedResult = $('#speedResult');
    els.cleanScan = $('#cleanupScan');
    els.cleanClean = $('#cleanupClean');
    els.cleanTotal = $('#cleanupTotal');
    els.cleanStatus = $('#cleanupStatus');
    els.cleanStatusText = $('#cleanupStatusText');
    els.cleanList = $('#cleanupList');
    els.usageDrive = $('#usageDrive');
    els.usageScan = $('#usageScan');
    els.usageUp = $('#usageUp');
    els.usageCrumb = $('#usageCrumb');
    els.usagePac = $('#usagePac');
    els.usagePacText = $('#usagePacText');
    els.usageResults = $('#usageResults');
    els.usageFolders = $('#usageFolders');
    els.usageFilesWrap = $('#usageFilesWrap');
    els.usageFiles = $('#usageFiles');
    if (!els.secCleanup) return;

    els.subtabs.forEach((t) => t.addEventListener('click', () => selectSub(t.dataset.sub)));
    els.cleanScan.addEventListener('click', cleanupScan);
    els.cleanClean.addEventListener('click', cleanupClean);
    els.usageScan.addEventListener('click', () => usageScan(els.usageDrive.value || 'C:\\'));
    els.usageUp.addEventListener('click', () => { if (currentPath) usageScan(parentPath(currentPath)); });
    els.speedGo.addEventListener('click', runSpeed);
    els.speedCancel.addEventListener('click', cancelSpeed);

    if (window.disktools && window.disktools.onProgress) {
      window.disktools.onProgress((p) => {
        if (!p || p.msg == null) return;
        if (p.kind === 'cleanup' && els.cleanStatusText) { els.cleanStatusText.textContent = p.msg; return; }
        if (p.kind === 'usbspeed' && els.speedStatusText) { els.speedStatusText.textContent = p.msg; window.TMActivity && window.TMActivity.update('usbspeed', p.msg); return; }
        if (p.kind === 'usage' && initialScanning) {
          const m = String(p.msg);
          if (m.indexOf('@@USAGE@@') === 0) {
            try { renderLive(JSON.parse(m.slice(9))); } catch { /* ignore partial */ }
          } else if (els.usagePacText) {
            els.usagePacText.textContent = m;
          }
        }
      });
    }
  });
})();
