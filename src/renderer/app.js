'use strict';

// Tab controller: toggles the Information / Scanner / Tools panels.
window.addEventListener('DOMContentLoaded', () => {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = {
    overview: document.getElementById('panel-overview'),
    news: document.getElementById('panel-news'),
    m365: document.getElementById('panel-m365'),
    feedback: document.getElementById('panel-feedback'),
    storage: document.getElementById('panel-storage'),
    information: document.getElementById('panel-information'),
    scanner: document.getElementById('panel-scanner'),
    startup: document.getElementById('panel-startup'),
    drives: document.getElementById('panel-drives'),
    crash: document.getElementById('panel-crash'),
    network: document.getElementById('panel-network'),
    bios: document.getElementById('panel-bios'),
    diagnose: document.getElementById('panel-diagnose'),
    battery: document.getElementById('panel-battery'),
    devices: document.getElementById('panel-devices'),
    idevice: document.getElementById('panel-idevice'),
    repairs: document.getElementById('panel-repairs'),
    disktools: document.getElementById('panel-disktools'),
    debloat: document.getElementById('panel-debloat'),
    privacy: document.getElementById('panel-privacy'),
    parts: document.getElementById('panel-parts'),
    board: document.getElementById('panel-board'),
    logs: document.getElementById('panel-logs'),
    backup: document.getElementById('panel-backup'),
    drivers: document.getElementById('panel-drivers'),
    report: document.getElementById('panel-report'),
    tools: document.getElementById('panel-tools'),
    settings: document.getElementById('panel-settings'),
  };

  // Some panels share one sidebar entry (e.g. Problem Devices sits under Drivers & Devices).
  const alias = { devices: 'drivers' };
  const ddBtns = Array.from(document.querySelectorAll('[data-dd]'));

  function select(name) {
    const hl = alias[name] || name;
    tabs.forEach((t) => t.classList.toggle('tab--active', t.dataset.tab === hl));
    Object.entries(panels).forEach(([key, el]) => { if (el) el.hidden = key !== name; });
    if (name === 'drivers' || name === 'devices') ddBtns.forEach((b) => b.classList.toggle('dd-switch__btn--active', b.dataset.dd === name));
    expandGroupOf(hl);
  }

  tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.tab)));
  // Drivers / Problem-devices switcher (both panels carry the same bar).
  ddBtns.forEach((b) => b.addEventListener('click', () => select(b.dataset.dd)));

  // ---- Collapsible sidebar groups (remembered) ----
  const labels = Array.from(document.querySelectorAll('.sidebar .nav-label'));
  const CKEY = 'tmNavCollapsed';
  let collapsed = {};
  try { collapsed = JSON.parse(localStorage.getItem(CKEY) || '{}') || {}; } catch (e) { collapsed = {}; }
  function groupKey(label) { return label.dataset.group || label.textContent.trim(); }
  function groupButtons(label) { const out = []; let n = label.nextElementSibling; while (n && !n.classList.contains('nav-label')) { if (n.classList && n.classList.contains('tab')) out.push(n); n = n.nextElementSibling; } return out; }
  function applyCollapse(label) { const c = !!collapsed[groupKey(label)]; label.classList.toggle('nav-label--collapsed', c); groupButtons(label).forEach((b) => b.classList.toggle('tab--hidden', c)); }
  function saveCollapse() { try { localStorage.setItem(CKEY, JSON.stringify(collapsed)); } catch (e) { /* ignore */ } }
  function expandGroupOf(tabKey) {
    const btn = document.querySelector('.tab[data-tab="' + tabKey + '"]'); if (!btn) return;
    let n = btn.previousElementSibling; while (n && !n.classList.contains('nav-label')) n = n.previousElementSibling;
    if (n && collapsed[groupKey(n)]) { collapsed[groupKey(n)] = false; saveCollapse(); applyCollapse(n); }
  }
  labels.forEach((label) => {
    label.classList.add('nav-label--toggle');
    applyCollapse(label);
    label.addEventListener('click', () => { const k = groupKey(label); collapsed[k] = !collapsed[k]; saveCollapse(); applyCollapse(label); });
  });

  // Show the running build number so the installed version is always verifiable.
  const verEl = document.getElementById('appVersion');
  if (verEl && window.appInfo && window.appInfo.version) {
    window.appInfo.version().then((v) => { if (v) verEl.textContent = 'v' + v; }).catch(() => {});
  }
});
