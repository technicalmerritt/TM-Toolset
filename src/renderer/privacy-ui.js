'use strict';

// Privacy & telemetry tab: scan Windows privacy/telemetry/ad settings, show each
// as Private or Exposed, and apply the chosen hardening (restore point first).
(function () {
  const els = {};
  let items = [];
  let busy = false, loadedOnce = false;
  let lastApplied = [], lastRestore = false;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('toast--show'); setTimeout(() => t.classList.remove('toast--show'), 3200); }

  function scan() {
    if (busy) { toast('Busy — wait for the current job.'); return Promise.resolve(); }
    els.status.hidden = false; els.list.hidden = true; els.tools.hidden = true; els.applyRow.hidden = true;
    return window.privacy.scan().then((res) => {
      els.status.hidden = true;
      const d = (res && res.data) || {};
      if (!res || !res.ok || d.ok !== true) {
        els.summary.hidden = false; els.summary.textContent = (res && res.error) || 'Scan failed. Run TM Toolset as administrator and try again.';
        return;
      }
      items = d.items || [];
      render();
    }).catch((e) => { els.status.hidden = true; els.summary.hidden = false; els.summary.textContent = 'Scan failed: ' + ((e && e.message) || e); });
  }

  function stateChip(state) {
    if (state === 'private') return el('span', 'db-tag pv-chip--ok', 'Private');
    if (state === 'na') return el('span', 'db-tag', 'Not applicable');
    return el('span', 'db-tag db-tag--bloat', 'Exposed');
  }

  function render() {
    els.list.hidden = false; els.tools.hidden = false; els.applyRow.hidden = false;
    els.list.innerHTML = '';
    const exposedOnly = els.exposedOnly.checked;
    const exposed = items.filter((i) => i.state === 'exposed').length;
    els.summary.hidden = false;
    els.summary.textContent = exposed ? (exposed + ' setting(s) are not private yet. Recommended ones are pre-ticked.') : 'All scanned settings are already private. 👍';
    els.count.textContent = items.length + ' settings · ' + exposed + ' not private';

    const cats = [], byCat = {};
    for (const it of items) { if (!byCat[it.cat]) { byCat[it.cat] = []; cats.push(it.cat); } byCat[it.cat].push(it); }
    for (const cat of cats) {
      const group = byCat[cat].filter((i) => !exposedOnly || i.state === 'exposed');
      if (!group.length) continue;
      els.list.appendChild(el('div', 'pv-cat', cat));
      for (const it of group) {
        const row = el('label', 'db-row' + (it.warn ? ' pv-row--warn' : ''));
        const cb = el('input'); cb.type = 'checkbox'; cb.dataset.id = it.id;
        if (it.state === 'na') cb.disabled = true;
        else if (it.rec && it.state === 'exposed') cb.checked = true;
        cb.addEventListener('change', updateApply);
        row.appendChild(cb);
        const info = el('div', 'db-row__info');
        const title = el('div', 'db-row__name', it.name);
        title.appendChild(stateChip(it.state));
        if (it.rec) title.appendChild(el('span', 'db-tag', 'Recommended'));
        if (it.warn) title.appendChild(el('span', 'db-tag pv-chip--warn', '⚠ Check first'));
        info.appendChild(title);
        info.appendChild(el('div', 'db-row__meta muted', it.desc));
        if (it.warn) info.appendChild(el('div', 'pv-warn', '⚠ ' + it.warn));
        row.appendChild(info);
        els.list.appendChild(row);
      }
    }
    els.syncro.hidden = !(lastApplied && lastApplied.length);
    updateApply();
  }

  function selected() { return Array.from(els.list.querySelectorAll('input[type=checkbox]:checked')).map((c) => c.dataset.id); }
  function updateApply() { const n = selected().length; els.apply.disabled = n === 0; els.apply.textContent = n ? ('Apply selected (' + n + ')') : 'Apply selected'; }

  async function apply() {
    if (busy) return;
    const ids = selected();
    if (!ids.length) { toast('Tick the settings to apply.'); return; }
    const restore = els.restore.checked;
    if (!window.confirm('Apply ' + ids.length + ' privacy setting(s) to this PC?' +
      (restore ? '\n\nA System Restore point will be created first.' : '\n\nNo restore point will be created.') +
      '\n\nPer-user settings apply to signed-in Windows users. Some changes take effect after sign-out or restart.')) return;
    busy = true; els.apply.disabled = true; els.scan.disabled = true;
    els.runner.hidden = false; els.log.textContent = ''; els.state.textContent = 'Working…'; els.state.className = 'repairs-state repairs-state--run';
    try {
      const res = await window.privacy.apply({ ids: ids, restorePoint: restore });
      const d = (res && res.data) || {};
      if (res && res.ok && d.ok) {
        const ap = (d.applied || []).length, fa = (d.failed || []).length;
        appendLog((d.restorePoint ? 'Restore point created.\n' : (restore ? 'Restore point could not be created — continued without it.\n' : '')) +
          'Applied ' + ap + ' setting(s)' + (fa ? (', ' + fa + ' failed') : '') + '.');
        els.state.textContent = fa ? ('Done — ' + ap + ' applied, ' + fa + ' failed') : ('Done — ' + ap + ' applied');
        els.state.className = 'repairs-state ' + (fa ? 'repairs-state--warn' : 'repairs-state--good');
        lastApplied = (d.applied || []).slice(); lastRestore = !!d.restorePoint;
      } else {
        appendLog('[failed] ' + ((d && d.error) || (res && res.error) || 'error'));
        els.state.textContent = 'Failed'; els.state.className = 'repairs-state repairs-state--warn';
      }
    } catch (e) {
      appendLog('[failed] ' + ((e && e.message) || e)); els.state.textContent = 'Failed'; els.state.className = 'repairs-state repairs-state--warn';
    }
    busy = false; els.scan.disabled = false;
    scan(); // refresh the Private/Exposed states
  }
  function appendLog(l) { els.log.textContent += String(l).replace(/\s+$/, '') + '\n'; els.log.scrollTop = els.log.scrollHeight; }

  function postSyncro() {
    const e = window.tmEsc || ((s) => s);
    const names = lastApplied.map((id) => { const it = items.find((x) => x.id === id); return it ? it.name : id; });
    const out = ['<p><strong>TM Toolset &mdash; Privacy &amp; telemetry hardening</strong><br>' + e(new Date().toLocaleString()) + '</p>'];
    if (lastRestore) out.push('<p>A System Restore point was created first.</p>');
    out.push('<p>' + names.length + ' setting(s) hardened:</p><ul>');
    for (const n of names) out.push('<li>' + e(n) + '</li>');
    out.push('</ul><p><em>Generated by TM Toolset &middot; Technical Merritt</em></p>');
    if (window.tmSyncroPost) window.tmSyncroPost(els.syncro, 'TM Toolset — Privacy hardening', out.join('\n'));
    else toast('Set a ticket in the top bar first.');
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.scan = $('#pvScan'); els.status = $('#pvStatus'); els.summary = $('#pvSummary'); els.tools = $('#pvTools');
    els.list = $('#pvList'); els.applyRow = $('#pvApplyRow'); els.apply = $('#pvApply'); els.restore = $('#pvRestore');
    els.exposedOnly = $('#pvExposedOnly'); els.selRec = $('#pvSelRec'); els.selNone = $('#pvSelNone'); els.count = $('#pvCount');
    els.runner = $('#pvRunner'); els.state = $('#pvState'); els.log = $('#pvLog'); els.syncro = $('#pvSyncro');
    if (!els.list) return;
    els.scan.addEventListener('click', scan);
    els.apply.addEventListener('click', apply);
    els.exposedOnly.addEventListener('change', () => { if (items.length) render(); });
    els.selRec.addEventListener('click', () => { items.forEach((it) => { const cb = els.list.querySelector('input[data-id="' + it.id + '"]'); if (cb && !cb.disabled) cb.checked = !!(it.rec && it.state === 'exposed'); }); updateApply(); });
    els.selNone.addEventListener('click', () => { els.list.querySelectorAll('input[type=checkbox]').forEach((c) => { c.checked = false; }); updateApply(); });
    els.syncro.addEventListener('click', postSyncro);
    if (window.privacy && window.privacy.onProgress) window.privacy.onProgress((m) => { if (busy) appendLog(m); });
    const tab = document.querySelector('.tab[data-tab="privacy"]');
    if (tab) tab.addEventListener('click', () => { if (!loadedOnce) { loadedOnce = true; scan(); } });
  });
})();
