'use strict';

// Board-Level Repair tab: sub-nav, built-in viewers, reference library.
(function () {
  const els = {};
  let loadedOnce = false;
  const BOARD_EXT = ['brd', 'brd2', 'bdv', 'bvr', 'fz', 'cad', 'cst', 'asc', 'bv', 'obv', 'gcad'];

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('toast--show'); setTimeout(() => t.classList.remove('toast--show'), 3200); }
  function fmtBytes(b) { b = Number(b) || 0; if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB'; if (b >= 1024) return (b / 1024).toFixed(0) + ' KB'; return b + ' B'; }

  function openByExt(path) {
    const ext = (path.split('.').pop() || '').toLowerCase();
    if (ext === 'pdf') window.board.openPdf(path).then((r) => { if (!r || !r.ok) toast('Could not open the PDF viewer.'); });
    else if (BOARD_EXT.indexOf(ext) >= 0) window.board.openBoardview(path).then((r) => { if (!r || !r.ok) toast('Could not open the boardview viewer.'); });
    else window.board.openPdf(path); // best effort
  }

  let libFiles = [];
  function loadLib() {
    window.board.list().then((res) => {
      libFiles = (res && res.ok && res.files) || [];
      renderLib();
    }).catch(() => {});
  }
  function renderLib() {
    els.libList.innerHTML = '';
    const q = (els.search && els.search.value || '').trim().toLowerCase();
    const files = q ? libFiles.filter((f) => (f.name + ' ' + f.group).toLowerCase().indexOf(q) >= 0) : libFiles;
    if (els.libCount) els.libCount.textContent = files.length + ' / ' + libFiles.length + ' file(s)';
    if (!libFiles.length) { els.libList.appendChild(el('p', 'muted', 'Your library is empty — import schematics, boardviews or datasheets above (a single file, or a whole folder at once).')); return; }
    if (!files.length) { els.libList.appendChild(el('p', 'muted', 'No files match that filter.')); return; }
    const groups = {};
    for (const f of files) { (groups[f.group] = groups[f.group] || []).push(f); }
    for (const g of Object.keys(groups).sort()) {
      els.libList.appendChild(el('h4', 'info-sub', g + '  (' + groups[g].length + ')'));
      for (const f of groups[g]) {
        const row = el('div', 'drv-pkg');
        const info = el('div', 'drv-pkg__info');
        const ext = (f.ext || '').toLowerCase();
        const icon = ext === 'pdf' ? '📄' : '🔲';
        info.appendChild(el('span', 'drv-pkg__prov', icon + ' ' + f.name));
        info.appendChild(el('span', 'muted drv-pkg__meta', (f.ext || '').toUpperCase() + '  ·  ' + fmtBytes(f.size)));
        row.appendChild(info);
        const open = el('button', 'btn btn--primary btn--sm', 'Open');
        open.type = 'button';
        open.addEventListener('click', () => openByExt(f.path));
        row.appendChild(open);
        els.libList.appendChild(row);
      }
    }
  }

  function showSub(name) {
    for (const b of document.querySelectorAll('#panel-board .subtab')) b.classList.toggle('subtab--active', b.dataset.brsub === name);
    const map = { guides: 'br-guides', circuits: 'br-circuits', testing: 'br-testing', heat: 'br-heat', jobs: 'br-jobs', fault: 'br-fault', power: 'br-power', lib: 'br-lib' };
    for (const k of Object.keys(map)) { const s = document.getElementById(map[k]); if (s) s.hidden = k !== name; }
    if (name === 'lib' && !els.libList.dataset.loaded) { els.libList.dataset.loaded = '1'; loadLib(); }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.libList = $('#brLibList'); els.model = $('#brModel'); els.search = $('#brSearch'); els.libCount = $('#brLibCount');
    if (!els.libList) return;
    for (const b of document.querySelectorAll('#panel-board .subtab')) b.addEventListener('click', () => showSub(b.dataset.brsub));
    const ifixit = () => { const q = ($('#brIfixitQ').value || '').trim(); window.sys.openUrl(q ? ('https://www.ifixit.com/Search?query=' + encodeURIComponent(q) + '&doctype=guide') : 'https://www.ifixit.com/Guide'); };
    $('#brIfixitGo').addEventListener('click', ifixit);
    $('#brIfixitQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') ifixit(); });
    $('#brBoardGo').addEventListener('click', () => window.board.pick('board').then((p) => { if (p) window.board.openBoardview(p).then((r) => { if (!r || !r.ok) toast(r && r.error === 'tool-missing' ? 'Boardview viewer missing from the app.' : 'Could not open.'); }); }));
    $('#brPdfGo').addEventListener('click', () => window.board.pick('pdf').then((p) => { if (p) window.board.openPdf(p).then((r) => { if (!r || !r.ok) toast('Could not open.'); }); }));
    $('#brImport').addEventListener('click', () => window.board.importRef(els.model.value.trim()).then((r) => { if (r && r.ok) { toast('Added ' + r.count + ' file(s).'); loadLib(); } else if (r && !r.cancelled) toast('Import failed.'); }));
    $('#brImportFolder').addEventListener('click', () => window.board.importFolder(els.model.value.trim()).then((r) => { if (r && r.ok) { toast('Imported ' + r.count + ' file(s) into "' + r.group + '".'); loadLib(); } else if (r && !r.cancelled) toast('Import failed.'); }));
    els.search.addEventListener('input', () => { if (libFiles.length) renderLib(); });
    $('#brRefresh').addEventListener('click', loadLib);
    $('#brOpenLib').addEventListener('click', () => window.board.openLibDir());
    for (const b of document.querySelectorAll('#panel-board [data-openurl]')) b.addEventListener('click', () => window.sys && window.sys.openUrl(b.dataset.openurl));
    const tab = document.querySelector('.tab[data-tab="board"]');
    if (tab) tab.addEventListener('click', () => { loadedOnce = true; });
  });
})();
