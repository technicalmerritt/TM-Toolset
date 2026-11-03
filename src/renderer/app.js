'use strict';

// Tab controller: toggles the Information / Scanner / Tools panels.
window.addEventListener('DOMContentLoaded', () => {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = {
    overview: document.getElementById('panel-overview'),
    news: document.getElementById('panel-news'),
    m365: document.getElementById('panel-m365'),
    feedback: document.getElementById('panel-feedback'),
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
    repairs: document.getElementById('panel-repairs'),
    disktools: document.getElementById('panel-disktools'),
    debloat: document.getElementById('panel-debloat'),
    board: document.getElementById('panel-board'),
    logs: document.getElementById('panel-logs'),
    backup: document.getElementById('panel-backup'),
    drivers: document.getElementById('panel-drivers'),
    report: document.getElementById('panel-report'),
    tools: document.getElementById('panel-tools'),
    settings: document.getElementById('panel-settings'),
  };

  function select(name) {
    tabs.forEach((t) => t.classList.toggle('tab--active', t.dataset.tab === name));
    Object.entries(panels).forEach(([key, el]) => {
      if (el) el.hidden = key !== name;
    });
  }

  tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.tab)));

  // Show the running build number so the installed version is always verifiable.
  const verEl = document.getElementById('appVersion');
  if (verEl && window.appInfo && window.appInfo.version) {
    window.appInfo.version().then((v) => { if (v) verEl.textContent = 'v' + v; }).catch(() => {});
  }
});
