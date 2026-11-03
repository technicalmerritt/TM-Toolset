'use strict';

// Activity Log viewer.
(function () {
  const els = {};
  let loadedOnce = false;
  function $(s) { return document.querySelector(s); }

  function load() {
    window.logs.read().then((res) => {
      if (!res || !res.ok) { els.view.textContent = 'Could not read the log.'; return; }
      els.view.textContent = res.text || '(no activity logged yet)';
      els.meta.textContent = (res.lines || 0) + ' entries' + (res.lines > 1000 ? ' (showing newest 1000)' : '');
    }).catch(() => { els.view.textContent = 'Could not read the log.'; });
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.view = $('#logsView'); els.meta = $('#logsMeta');
    if (!els.view) return;
    $('#logsRefresh').addEventListener('click', load);
    $('#logsOpen').addEventListener('click', () => window.logs.openDir());
    $('#logsClear').addEventListener('click', () => { if (window.confirm('Clear the activity log?')) window.logs.clear().then(load); });
    const tab = document.querySelector('.tab[data-tab="logs"]');
    if (tab) tab.addEventListener('click', () => { loadedOnce = true; load(); });
  });
})();
