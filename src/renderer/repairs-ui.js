'use strict';

(function () {
  const ACTIONS = [
    { id: 'restorepoint', title: 'Create Restore Point', desc: 'Snapshot the system so later changes can be rolled back.', danger: false },
    { id: 'sfc', title: 'System File Check (SFC)', desc: 'Scan and repair protected Windows system files (sfc /scannow).', danger: true },
    { id: 'dism', title: 'DISM Restore Health', desc: 'Repair the Windows component store. Run this first if SFC can’t fix things. Can take 10–20 min.', danger: true },
    { id: 'chkdsk', title: 'Check Disk (scan)', desc: 'Online, read-only scan of the system drive for file-system errors.', danger: true },
    { id: 'wureset', title: 'Reset Windows Update', desc: 'Clear the Windows Update cache to fix stuck or broken updates. Makes a restore point first.', danger: true },
    { id: 'netreset', title: 'Reset Network Stack', desc: 'Reset Winsock + TCP/IP and flush DNS. A restart is required afterwards.', danger: true },
    { id: 'flushdns', title: 'Flush DNS Cache', desc: 'Clear the DNS resolver cache.', danger: false },
    { id: 'cleartemp', title: 'Clear Temp Files', desc: 'Delete temporary files from the user and Windows temp folders.', danger: false },
  ];

  const els = {};
  const buttons = [];
  let running = false;
  let built = false;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function appendLog(line) {
    if (line == null) return;
    els.log.textContent += (String(line).replace(/\s+$/, '')) + '\n';
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setButtonsDisabled(v) {
    for (const b of buttons) b.disabled = v;
  }

  function run(action, meta, btn) {
    if (running) return;
    if (meta.danger && !window.confirm(meta.title + '\n\n' + meta.desc + '\n\nThis changes the system. Continue?')) return;
    running = true;
    setButtonsDisabled(true);
    els.runner.hidden = false;
    els.title.textContent = meta.title;
    els.state.textContent = 'Running…';
    els.state.className = 'repairs-state repairs-state--run';
    els.log.textContent = '';
    appendLog('Starting ' + meta.title + '…');
    els.runner.scrollIntoView({ behavior: 'smooth', block: 'start' });

    window.repairs.run(action).then((res) => {
      if (!res || res.ok !== true) {
        appendLog('[error] ' + ((res && res.error) || 'failed'));
        els.state.textContent = 'Failed';
        els.state.className = 'repairs-state repairs-state--bad';
        return;
      }
      const d = res.data || {};
      if (d.error === 'admin') {
        appendLog('This action needs administrator rights. Use the “Run as administrator” banner, then try again.');
        els.state.textContent = 'Needs admin';
        els.state.className = 'repairs-state repairs-state--bad';
        return;
      }
      if (d.error) {
        appendLog('[error] ' + d.error + (d.line ? ' (line ' + d.line + ')' : ''));
        els.state.textContent = 'Failed';
        els.state.className = 'repairs-state repairs-state--bad';
        return;
      }
      els.state.textContent = d.ok ? 'Completed' : ('Finished (exit ' + (d.exitCode != null ? d.exitCode : '?') + ')');
      els.state.className = 'repairs-state ' + (d.ok ? 'repairs-state--good' : 'repairs-state--warn');
      if (d.restartRecommended) appendLog('\n⚠  A restart is required/recommended to finish this.');
    }).catch((e) => {
      appendLog('[error] ' + ((e && e.message) || e));
      els.state.textContent = 'Failed';
      els.state.className = 'repairs-state repairs-state--bad';
    }).finally(() => {
      running = false;
      setButtonsDisabled(false);
    });
  }

  function build() {
    if (built) return;
    built = true;
    els.grid.innerHTML = '';
    for (const meta of ACTIONS) {
      const card = el('section', 'repair-card' + (meta.danger ? ' repair-card--danger' : ''));
      card.appendChild(el('h3', 'repair-card__title', meta.title));
      card.appendChild(el('p', 'repair-card__desc', meta.desc));
      const btn = el('button', 'btn btn--primary btn--sm', 'Run');
      btn.type = 'button';
      btn.addEventListener('click', () => run(meta.id, meta, btn));
      buttons.push(btn);
      card.appendChild(btn);
      els.grid.appendChild(card);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.grid = $('#repairsGrid');
    els.runner = $('#repairsRunner');
    els.title = $('#repairsTitle');
    els.state = $('#repairsState');
    els.log = $('#repairsLog');
    if (!els.grid) return;
    build();
    if (window.repairs && window.repairs.onProgress) {
      window.repairs.onProgress((p) => { if (p && p.msg != null) appendLog(p.msg); });
    }
    const tab = document.querySelector('.tab[data-tab="repairs"]');
    if (tab) tab.addEventListener('click', build);
  });
})();
