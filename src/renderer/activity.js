'use strict';

// Global background-activity indicator in the top bar. Any long-running task
// calls TMActivity.start(id, label) when it begins and TMActivity.end(id) when
// it finishes (optionally TMActivity.update(id, text) for live detail). The
// widget shows a spinner + count no matter which tab is open, so work running
// in the background is always visible.
(function () {
  const tasks = new Map(); // id -> { label, text }
  const els = {};

  function render() {
    if (!els.root) return;
    const n = tasks.size;
    els.root.hidden = n === 0;
    if (n === 0) { if (els.menu) els.menu.hidden = true; return; }
    els.count.textContent = String(n);
    els.label.textContent = n === 1 ? 'running' : 'running';
    els.btn.title = n + (n === 1 ? ' task running' : ' tasks running');
    if (!els.menu) return;
    els.menu.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'activity__head';
    head.textContent = n === 1 ? '1 background task' : n + ' background tasks';
    els.menu.appendChild(head);
    for (const [, t] of tasks) {
      const row = document.createElement('div'); row.className = 'activity__row';
      const dot = document.createElement('span'); dot.className = 'activity__dot';
      const txt = document.createElement('div'); txt.className = 'activity__rowtext';
      const lab = document.createElement('div'); lab.className = 'activity__rowlabel'; lab.textContent = t.label;
      txt.appendChild(lab);
      if (t.text) { const sub = document.createElement('div'); sub.className = 'activity__rowsub'; sub.textContent = t.text; txt.appendChild(sub); }
      row.append(dot, txt);
      els.menu.appendChild(row);
    }
  }

  const API = {
    start(id, label) { if (!id) return id; tasks.set(id, { label: label || 'Working…', text: '' }); render(); return id; },
    update(id, text) { const t = tasks.get(id); if (t) { t.text = text || ''; render(); } },
    end(id) { if (tasks.delete(id)) render(); },
    has(id) { return tasks.has(id); },
    count() { return tasks.size; }
  };
  window.TMActivity = API;

  window.addEventListener('DOMContentLoaded', () => {
    els.root = document.getElementById('activity');
    els.btn = document.getElementById('activityBtn');
    els.count = document.getElementById('activityCount');
    els.label = document.getElementById('activityLabel');
    els.menu = document.getElementById('activityMenu');
    if (els.btn) els.btn.addEventListener('click', (e) => { e.stopPropagation(); if (els.menu) els.menu.hidden = !els.menu.hidden; });
    document.addEventListener('click', (e) => { if (els.root && els.menu && !els.root.contains(e.target)) els.menu.hidden = true; });
    render();
  });
})();
