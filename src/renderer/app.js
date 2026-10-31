'use strict';

// Tab controller: toggles the Scanner / Tools panels.
window.addEventListener('DOMContentLoaded', () => {
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = {
    scanner: document.getElementById('panel-scanner'),
    tools: document.getElementById('panel-tools'),
  };

  function select(name) {
    tabs.forEach((t) => t.classList.toggle('tab--active', t.dataset.tab === name));
    Object.entries(panels).forEach(([key, el]) => {
      if (el) el.hidden = key !== name;
    });
  }

  tabs.forEach((t) => t.addEventListener('click', () => select(t.dataset.tab)));
});
