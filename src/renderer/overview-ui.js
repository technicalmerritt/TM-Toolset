'use strict';

// Overview dashboard: runs the quick checks and shows at-a-glance tiles.
(function () {
  const els = {};
  let loaded = false;
  let loading = false;

  function $(s) { return document.querySelector(s); }
  function arr(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
  function num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function safe(p) { return Promise.resolve(p).then((r) => r).catch(() => null); }

  function openTab(t) { const b = document.querySelector('.tab[data-tab="' + t + '"]'); if (b) b.click(); }

  const START = [
    ['First look at any PC', [['Overview (here)', 'overview'], ['Issue Scanner', 'scanner'], ['Guided diagnose', 'diagnose']]],
    ['Storage & fake drives', [['Drive Health', 'drives'], ['Disk Tools', 'disktools']]],
    ['Slow / bloated / junk', [['Debloat', 'debloat'], ['Startup Items', 'startup'], ['Disk Tools', 'disktools']]],
    ["Won't boot / crashes", [['Diagnose', 'diagnose'], ['Crash Analysis', 'crash']]],
    ['Drivers & devices', [['Drivers', 'drivers'], ['Devices', 'devices']]],
    ['Network issues', [['Networking', 'network']]],
    ['Back up before risky work', [['Backup & Imaging', 'backup']]],
    ['BIOS chip / firmware', [['BIOS / UEFI', 'bios']]],
    ['Board-level / soldering', [['Board Repair', 'board']]],
    ['Hand it to the customer', [['Customer Report', 'report']]],
    ['Review & setup', [['Activity Log', 'logs'], ['Tools', 'tools'], ['Settings', 'settings']]],
  ];
  function renderStart() {
    if (!els.start) return;
    els.start.innerHTML = '';
    const head = el('div', 'ov-start__head');
    head.appendChild(el('strong', null, 'Where to start'));
    const x = el('button', 'ov-start__x', '×'); x.type = 'button'; x.title = 'Hide';
    x.addEventListener('click', () => { els.start.hidden = true; try { localStorage.setItem('tmStartHidden', '1'); } catch { /* ignore */ } });
    head.appendChild(x);
    els.start.appendChild(head);
    els.start.appendChild(el('p', 'muted ov-start__sub', 'Big toolkit — here’s the quick map. Click a job to jump to the right tab.'));
    const grid = el('div', 'ov-start__grid');
    for (const [label, items] of START) {
      const row = el('div', 'ov-start__row');
      row.appendChild(el('div', 'ov-start__label', label));
      const chips = el('div', 'ov-start__chips');
      for (const [name, tab] of items) { const c = el('button', 'ov-chip', name); c.type = 'button'; c.addEventListener('click', () => openTab(tab)); chips.appendChild(c); }
      row.appendChild(chips);
      grid.appendChild(row);
    }
    els.start.appendChild(grid);
  }

  function tile(tab, icon, title, val, sub, cls) {
    const t = el('section', 'ov-tile' + (cls ? ' ov-tile--' + cls : ''));
    const head = el('div', 'ov-tile__head');
    head.append(el('span', 'ov-tile__title', title), el('span', 'ov-tile__ico', icon));
    t.append(head, el('div', 'ov-tile__val', val), el('div', 'ov-tile__sub', sub || ''));
    t.addEventListener('click', () => {
      const btn = document.querySelector('.tab[data-tab="' + tab + '"]');
      if (btn) btn.click();
    });
    return t;
  }

  function skeleton() {
    els.headline.className = 'ov-headline';
    els.headline.textContent = 'Running quick checks...';
    els.grid.innerHTML = '';
    const items = [['drives', '💽', 'Drive Health'], ['battery', '🔋', 'Battery'], ['crash', '💥', 'Crashes'], ['devices', '🔌', 'Devices'], ['network', '🌐', 'Network']];
    for (const [tab, icon, title] of items) els.grid.appendChild(tile(tab, icon, title, '…', 'checking...', 'busy'));
  }

  async function load() {
    if (loading) return;
    loading = true; loaded = true;
    skeleton();
    const [dr, bat, cr, dev, net] = await Promise.all([
      safe(window.drives && window.drives.list()),
      safe(window.battery && window.battery.list()),
      safe(window.crash && window.crash.list()),
      safe(window.devices && window.devices.list()),
      safe(window.net && window.net.info()),
    ]);
    render(dr, bat, cr, dev, net);
    loading = false;
  }

  function render(drRes, batRes, crRes, devRes, netRes) {
    const attention = [];
    els.grid.innerHTML = '';

    // Drive health
    if (drRes && drRes.ok && drRes.data) {
      const ds = arr(drRes.data.drives);
      let worst = 100;
      for (const d of ds) { const h = window.tmDriveHealth ? window.tmDriveHealth(d) : 100; if (h < worst) worst = h; }
      if (!ds.length) worst = 0;
      const cls = !ds.length ? '' : worst >= 85 ? 'good' : worst >= 55 ? 'warn' : 'bad';
      if (ds.length && worst < 85) attention.push('a drive at ' + worst + '% health');
      els.grid.appendChild(tile('drives', '💽', 'Drive Health', ds.length ? worst + '%' : 'N/A', ds.length + ' drive' + (ds.length === 1 ? '' : 's') + ' - worst health', cls));
    } else {
      els.grid.appendChild(tile('drives', '💽', 'Drive Health', '—', 'could not read', ''));
    }

    // Battery
    if (batRes && batRes.ok && batRes.data) {
      const d = batRes.data;
      if (!d.hasBattery) {
        els.grid.appendChild(tile('battery', '🔋', 'Battery', 'N/A', 'no battery (desktop)', ''));
      } else {
        const b = arr(d.batteries)[0] || {};
        const wear = num(b.wearPct);
        const cls = wear >= 40 ? 'bad' : wear >= 25 ? 'warn' : 'good';
        if (wear >= 25) attention.push('battery ' + wear + '% worn');
        els.grid.appendChild(tile('battery', '🔋', 'Battery', (100 - Math.round(wear)) + '%', 'health - ' + wear + '% worn', cls));
      }
    } else {
      els.grid.appendChild(tile('battery', '🔋', 'Battery', '—', 'could not read', ''));
    }

    // Crashes
    if (crRes && crRes.ok && crRes.data) {
      const dumps = arr(crRes.data.dumps).length;
      const cls = dumps > 0 ? 'warn' : 'good';
      if (dumps > 0) attention.push(dumps + ' crash dump' + (dumps === 1 ? '' : 's'));
      els.grid.appendChild(tile('crash', '💥', 'Crashes', String(dumps), dumps ? 'recent blue screens' : 'no recent crashes', cls));
    } else {
      els.grid.appendChild(tile('crash', '💥', 'Crashes', '—', 'could not read', ''));
    }

    // Devices
    if (devRes && devRes.ok && devRes.data) {
      const pc = num(devRes.data.problemCount);
      const cls = pc > 0 ? 'bad' : 'good';
      if (pc > 0) attention.push(pc + ' device problem' + (pc === 1 ? '' : 's'));
      els.grid.appendChild(tile('devices', '🔌', 'Devices', String(pc), pc ? 'with driver problems' : 'all drivers OK', cls));
    } else {
      els.grid.appendChild(tile('devices', '🔌', 'Devices', '—', 'could not read', ''));
    }

    // Network
    if (netRes && netRes.ok && netRes.data) {
      const w = arr(netRes.data.warnings);
      const bad = w.filter((x) => x && x.sev === 'bad').length;
      const hasPublic = w.some((x) => x && x.id === 'public');
      const cls = bad > 0 ? 'bad' : w.length > 0 ? 'warn' : 'good';
      if (hasPublic) attention.push('network set to Public');
      else if (w.length) attention.push(w.length + ' network gotcha' + (w.length === 1 ? '' : 's'));
      els.grid.appendChild(tile('network', '🌐', 'Network', w.length ? String(w.length) : 'OK', w.length ? (hasPublic ? 'set to Public - blocks sharing' : 'gotcha(s) to review') : 'no gotchas', cls));
    } else {
      els.grid.appendChild(tile('network', '🌐', 'Network', '—', 'could not read', ''));
    }

    if (attention.length) {
      els.headline.className = 'ov-headline ov-headline--' + (attention.length >= 2 ? 'bad' : 'warn');
      els.headline.textContent = attention.length + ' thing' + (attention.length === 1 ? '' : 's') + ' to look at: ' + attention.join(', ') + '.';
    } else {
      els.headline.className = 'ov-headline ov-headline--good';
      els.headline.textContent = 'All clear - no problems found in the quick checks.';
    }
  }

  function esc(s) { return ('' + (s == null ? '' : s)).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function passportHtml(d) {
    const now = new Date().toLocaleString();
    const row = (k, v) => v ? ('<tr><td>' + esc(k) + '</td><td>' + esc(v) + '</td></tr>') : '';
    let drives = '';
    if (d.dr && d.dr.ok && d.dr.data) {
      for (const dv of arr(d.dr.data.drives)) {
        const h = window.tmDriveHealth ? window.tmDriveHealth(dv) : '';
        drives += row((dv.model || 'Drive'), 'Health ' + h + '%' + (dv.sizeGB ? ' · ' + dv.sizeGB + ' GB' : '') + (dv.temperatureC != null ? ' · ' + dv.temperatureC + '°C' : ''));
      }
    }
    let batt = '';
    if (d.bat && d.bat.ok && d.bat.data && d.bat.data.hasBattery) { const b = arr(d.bat.data.batteries)[0] || {}; batt = row('Battery', (100 - Math.round(num(b.wearPct))) + '% health (' + num(b.wearPct) + '% worn)'); }
    const bios = (d.bios && d.bios.ok && d.bios.data) ? d.bios.data : {};
    const net = (d.net && d.net.ok && d.net.data) ? d.net.data : {};
    const warns = arr(net.warnings).map((w) => '<li>' + esc(w.title) + '</li>').join('');
    const crashes = (d.cr && d.cr.ok && d.cr.data) ? arr(d.cr.data.dumps).length : '—';
    const devProblems = (d.dev && d.dev.ok && d.dev.data) ? num(d.dev.data.problemCount) : '—';
    return '<!doctype html><html><head><meta charset="utf-8"><title>Health Passport</title><style>'
      + 'body{font-family:Segoe UI,Arial,sans-serif;color:#1b2430;max-width:800px;margin:24px auto;padding:0 16px}'
      + 'h1{color:#ff6600;margin:0 0 4px}h2{color:#15294a;border-bottom:2px solid #ff6600;padding-bottom:4px;margin-top:26px}'
      + 'table{width:100%;border-collapse:collapse;margin-top:6px}td{padding:6px 8px;border-bottom:1px solid #e3e7ee;font-size:14px}'
      + 'td:first-child{color:#5a6475;width:38%}.muted{color:#8a93a3;font-size:12px}ul{font-size:14px}</style></head><body>'
      + '<h1>Machine Health Passport</h1><p class="muted">' + esc(now) + ' · Technical Merritt Computer Services</p>'
      + '<h2>System</h2><table>' + row('Make / model', [bios.sysVendor, bios.sysModel].filter(Boolean).join(' ')) + row('BIOS', [bios.biosVendor, bios.biosVersion, bios.biosDate].filter(Boolean).join(' ')) + row('Firmware', bios.firmwareType) + row('Secure Boot', bios.secureBoot) + row('TPM', bios.tpmPresent ? (bios.tpmVersion || 'present') : 'not detected') + '</table>'
      + '<h2>Storage</h2><table>' + (drives || '<tr><td>Drives</td><td>—</td></tr>') + '</table>'
      + '<h2>Power & Stability</h2><table>' + (batt || row('Battery', 'N/A (desktop)')) + row('Recent crashes', crashes) + row('Device problems', devProblems) + '</table>'
      + '<h2>Network</h2><table>' + row('IPv4', net.ipv4) + row('Gateway', net.gateway) + '</table>' + (warns ? ('<ul>' + warns + '</ul>') : '<p class="muted">No network gotchas.</p>')
      + '<p class="muted">Generated by TM Toolset.</p></body></html>';
  }
  async function buildPassport() {
    const btn = els.passport; if (!btn) return;
    btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Gathering…';
    const [dr, bat, cr, dev, net, bios] = await Promise.all([
      safe(window.drives && window.drives.list()), safe(window.battery && window.battery.list()),
      safe(window.crash && window.crash.list()), safe(window.devices && window.devices.list()),
      safe(window.net && window.net.info()), safe(window.bios && window.bios.info()),
    ]);
    const html = passportHtml({ dr, bat, cr, dev, net, bios });
    btn.disabled = false; btn.textContent = orig;
    try {
      const res = await window.report.saveHtml({ name: 'TM-Health-Passport-' + new Date().toISOString().slice(0, 10), html });
      const t = document.getElementById('toast');
      if (t) { t.textContent = (res && res.ok) ? 'Health passport saved.' : ((res && res.cancelled) ? '' : 'Save failed.'); if (t.textContent) { t.classList.add('toast--show'); setTimeout(() => t.classList.remove('toast--show'), 3000); } }
    } catch { /* ignore */ }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.headline = $('#overviewHeadline');
    els.grid = $('#overviewGrid');
    els.refresh = $('#overviewRefresh');
    els.passport = $('#overviewPassport');
    els.start = $('#overviewStart');
    els.startBtn = $('#overviewStartBtn');
    if (!els.grid) return;
    els.refresh && els.refresh.addEventListener('click', () => { loaded = false; load(); });
    els.passport && els.passport.addEventListener('click', buildPassport);
    // "Where to start" map — shown by default until dismissed; button re-opens it.
    renderStart();
    let startHidden = false; try { startHidden = localStorage.getItem('tmStartHidden') === '1'; } catch { /* ignore */ }
    els.start.hidden = startHidden;
    els.startBtn && els.startBtn.addEventListener('click', () => {
      els.start.hidden = !els.start.hidden;
      try { localStorage.setItem('tmStartHidden', els.start.hidden ? '1' : '0'); } catch { /* ignore */ }
    });
    const tab = document.querySelector('.tab[data-tab="overview"]');
    if (tab) tab.addEventListener('click', () => { if (!loaded) load(); });
    // Overview is the default landing view - run the quick checks on startup.
    load();
  });
})();
