'use strict';

// Storage hub: one top-level "Storage" tab that hosts the existing Drive Health,
// Disk Tools and Backup & Clone panels under a sub-nav. The real panels stay
// exactly where they are in the DOM; this module just shows/hides them and lets
// quick-find / Overview jump straight to a sub-area. Loaded AFTER app.js so that
// entering the tab (app.js hides every panel) is followed by re-showing the
// current sub-panel here.
(function () {
  const SUBS = { health: 'panel-drives', disktools: 'panel-disktools', backup: 'panel-backup' };
  let current = 'health';

  function setPanels(sub) {
    for (const key of Object.keys(SUBS)) { const el = document.getElementById(SUBS[key]); if (el) el.hidden = key !== sub; }
  }
  function show(sub) {
    if (!SUBS[sub]) sub = 'health';
    current = sub;
    const nav = document.getElementById('storageSub');
    if (nav) nav.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('subtab--active', b.dataset.sub === sub));
    setPanels(sub);
    // Let the underlying module lazy-load its data the first time it's shown.
    window.dispatchEvent(new CustomEvent('tm-storage-show', { detail: sub }));
    try { localStorage.setItem('tmStorageSub', sub); } catch { /* ignore */ }
  }
  // Called when the Storage top-tab is opened: app.js has just hidden the three
  // sub-panels, so re-show whichever sub was last used.
  function enter() { show(current); }

  // Exposed so quick-find and Overview can jump into a specific sub-area.
  window.tmStorage = { show, enter };

  window.addEventListener('DOMContentLoaded', () => {
    const nav = document.getElementById('storageSub');
    if (!nav) return;
    try { const s = localStorage.getItem('tmStorageSub'); if (s && SUBS[s]) current = s; } catch { /* ignore */ }
    nav.querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => show(b.dataset.sub)));
    const tab = document.querySelector('.tab[data-tab="storage"]');
    if (tab) tab.addEventListener('click', enter);
  });
})();
