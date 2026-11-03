'use strict';

// Debloat tab: list installed software, flag bloat, uninstall selected.
(function () {
  const els = {};
  let apps = [];
  let busy = false;
  let loadedOnce = false;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('toast--show'); setTimeout(() => t.classList.remove('toast--show'), 3200); }

  function scan() {
    if (busy) { toast('Busy — wait for the current job.'); return; }
    els.status.hidden = false; els.list.hidden = true; els.total.textContent = ''; els.uninstall.hidden = true;
    window.debloat.list().then((res) => {
      els.status.hidden = true;
      const d = (res && res.data) || {};
      if (!res || !res.ok || d.ok !== true) { toast('Scan failed.'); return; }
      apps = d.apps || [];
      render();
    }).catch(() => { els.status.hidden = true; toast('Scan failed.'); });
  }

  function render() {
    els.list.hidden = false;
    els.list.innerHTML = '';
    const flaggedOnly = els.flaggedOnly.checked;
    const shown = apps.filter((a) => !flaggedOnly || a.bloat);
    els.total.textContent = apps.length + ' apps · ' + apps.filter((a) => a.bloat).length + ' flagged';
    // flagged first, then by size
    shown.sort((a, b) => (b.bloat ? 1 : 0) - (a.bloat ? 1 : 0) || (b.sizeMB || 0) - (a.sizeMB || 0));
    if (!shown.length) { els.list.appendChild(el('p', 'muted', 'Nothing to show.')); return; }
    for (const a of shown) {
      const row = el('label', 'db-row' + (a.bloat ? ' db-row--bloat' : ''));
      const cb = el('input'); cb.type = 'checkbox'; cb.dataset.kind = a.kind; cb.dataset.key = a.key;
      cb.addEventListener('change', updateBtn);
      row.appendChild(cb);
      const info = el('div', 'db-row__info');
      const title = el('div', 'db-row__name', a.name);
      if (a.kind === 'appx') title.appendChild(el('span', 'db-tag', 'Store app'));
      if (a.bloat) title.appendChild(el('span', 'db-tag db-tag--bloat', 'Bloat'));
      info.appendChild(title);
      const meta = [a.publisher, a.version, (a.sizeMB ? a.sizeMB + ' MB' : '')].filter(Boolean).join('  ·  ');
      info.appendChild(el('div', 'db-row__meta muted', meta));
      if (a.bloat) info.appendChild(el('div', 'db-row__why', a.bloat));
      row.appendChild(info);
      els.list.appendChild(row);
    }
    updateBtn();
  }

  function selected() {
    return Array.from(els.list.querySelectorAll('input[type=checkbox]:checked')).map((c) => ({ kind: c.dataset.kind, key: c.dataset.key }));
  }
  function updateBtn() {
    const n = selected().length;
    els.uninstall.hidden = n === 0;
    els.uninstall.textContent = n ? ('Uninstall selected (' + n + ')') : 'Uninstall selected';
  }

  async function uninstall() {
    if (busy) return;
    const sel = selected();
    if (!sel.length) return;
    if (!window.confirm('Uninstall ' + sel.length + ' app(s)?\n\nStore apps go quietly; traditional programs may pop up their own uninstaller. This cannot be undone.')) return;
    busy = true; els.uninstall.disabled = true; els.scan.disabled = true;
    els.runner.hidden = false; els.log.textContent = ''; els.state.textContent = 'Running…'; els.state.className = 'repairs-state repairs-state--run';
    let done = 0, failed = 0;
    for (const s of sel) {
      const nm = (apps.find((a) => a.key === s.key) || {}).name || s.key;
      appendLog('\n>>> ' + nm);
      try {
        const res = await window.debloat.uninstall(s.kind, s.key);
        const d = (res && res.data) || {};
        if (res && res.ok && d.ok) { appendLog('   removed.'); done++; }
        else { appendLog('   [failed] ' + ((d && d.error) || (res && res.error) || 'error')); failed++; }
      } catch (e) { appendLog('   [failed] ' + ((e && e.message) || e)); failed++; }
    }
    els.state.textContent = failed ? ('Done — ' + done + ' removed, ' + failed + ' failed') : ('Done — ' + done + ' removed');
    els.state.className = 'repairs-state ' + (failed ? 'repairs-state--warn' : 'repairs-state--good');
    busy = false; els.uninstall.disabled = false; els.scan.disabled = false;
    scan();
  }
  function appendLog(l) { els.log.textContent += String(l).replace(/\s+$/, '') + '\n'; els.log.scrollTop = els.log.scrollHeight; }

  window.addEventListener('DOMContentLoaded', () => {
    els.scan = $('#dbScan'); els.flaggedOnly = $('#dbFlaggedOnly'); els.uninstall = $('#dbUninstall'); els.total = $('#dbTotal');
    els.status = $('#dbStatus'); els.list = $('#dbList'); els.runner = $('#dbRunner'); els.state = $('#dbState'); els.log = $('#dbLog');
    if (!els.list) return;
    els.scan.addEventListener('click', scan);
    els.flaggedOnly.addEventListener('change', () => { if (apps.length) render(); });
    els.uninstall.addEventListener('click', uninstall);
    if (window.debloat && window.debloat.onProgress) window.debloat.onProgress((m) => { if (busy) appendLog('   ' + m); });
    const tab = document.querySelector('.tab[data-tab="debloat"]');
    if (tab) tab.addEventListener('click', () => { if (!loadedOnce) { loadedOnce = true; scan(); } });
  });
})();
