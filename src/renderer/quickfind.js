'use strict';

// Quick-find / command palette: Ctrl+K (or the header button) to jump to any
// tab or a specific tool/task (which also opens the right sub-tab).
(function () {
  const els = {};
  let items = [];
  let shown = [];
  let sel = 0;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  // tab, optional [subAttr, subVal], keywords
  const INDEX = [
    ['Overview', 'overview', null, 'home dashboard health passport'],
    ['Industry News', 'news', null, 'news headlines'],
    ['Issue Scanner', 'scanner', null, 'scan health problems check'],
    ['Diagnose', 'diagnose', null, 'troubleshoot guided'],
    ['Drive Health', 'drives', null, 'smart disk ssd hdd temperature wear surface speed'],
    ['Battery', 'battery', null, 'battery wear cycles laptop'],
    ['Devices', 'devices', null, 'device manager driver problems'],
    ['Crash Analysis', 'crash', null, 'bsod blue screen dump bugcheck'],
    ['Networking', 'network', null, 'network wifi ip dns gateway'],
    ['Information', 'information', null, 'system info inventory specs'],
    ['Startup Items', 'startup', null, 'startup autoruns boot logon'],
    ['BIOS / UEFI', 'bios', null, 'bios uefi firmware chip programmer'],
    ['Repairs', 'repairs', null, 'sfc dism chkdsk repair fix windows update network reset'],
    ['Disk Tools', 'disktools', null, 'cleanup junk disk usage space'],
    ['Debloat', 'debloat', null, 'bloatware uninstall remove apps crapware'],
    ['Board Repair', 'board', null, 'soldering micro board schematic repair'],
    ['Backup & Imaging', 'backup', null, 'backup image clone partition restore'],
    ['Drivers', 'drivers', null, 'drivers driverpacks offline update'],
    ['Customer Report', 'report', null, 'report customer pdf print'],
    ['Activity Log', 'logs', null, 'log audit history what did i do'],
    ['Tools', 'tools', null, 'tools launcher recommended download'],
    ['Settings', 'settings', null, 'settings syncro api token'],

    // tasks -> tab (+ subtab)
    ['Fake / counterfeit drive capacity test', 'drives', null, 'fake counterfeit capacity usb sd card h2testw'],
    ['Surface / speed test a drive', 'drives', null, 'surface speed read write'],
    ['Build Health Passport', 'overview', null, 'passport report summary customer'],
    ['Analyze a BIOS dump', 'bios', ['data-bbsub', 'dump'], 'analyze dump read bin'],
    ['Clean the Intel ME region', 'bios', ['data-bbsub', 'dump'], 'me intel clean cleaner'],
    ['Find a clean BIOS file', 'bios', ['data-bbsub', 'get'], 'download bios badcaps oem'],
    ['Firmware diff / pre-flash check', 'bios', ['data-bbsub', 'compare'], 'diff compare preflight verify'],
    ['BitLocker recovery key', 'bios', ['data-bbsub', 'safeguards'], 'bitlocker key encryption recovery'],
    ['Identity vault (serial / UUID / MAC)', 'bios', ['data-bbsub', 'vault'], 'serial uuid mac identity restore'],
    ['SPI chip helper', 'bios', ['data-bbsub', 'tools'], 'spi chip w25q voltage'],
    ['Extract an OEM BIOS download', 'bios', ['data-bbsub', 'get'], 'hp dell lenovo extract unpack'],
    ['Boardview viewer', 'board', ['data-brsub', 'lib'], 'boardview brd fz openboardview'],
    ['Open a schematic / datasheet (PDF)', 'board', ['data-brsub', 'lib'], 'pdf schematic datasheet viewer'],
    ['Import my schematics', 'board', ['data-brsub', 'lib'], 'import schematics library folder'],
    ['Component testing (MOSFET, caps…)', 'board', ['data-brsub', 'testing'], 'mosfet test diode capacitor fet'],
    ['Heat & tips guide (861DW / Aixun)', 'board', ['data-brsub', 'heat'], 'temperature airflow hot air tip soldering'],
    ['Circuit explainers', 'board', ['data-brsub', 'circuits'], 'buck boost ldo pd charger rail'],
    ['Repair jobs (HDMI, USB-C…)', 'board', ['data-brsub', 'jobs'], 'hdmi usb-c port battery backlight'],
    ["Won't power on playbook", 'board', ['data-brsub', 'fault'], 'no power short to ground injection'],
    ['iFixit guides', 'board', ['data-brsub', 'guides'], 'ifixit guide teardown'],
    ['Network driverpacks (offline)', 'drivers', ['data-dsub', 'packs'], 'driverpacks network offline torrent storage'],
    ['Scan & fix drivers', 'drivers', ['data-dsub', 'scan'], 'driver scan fix match'],
    ['Offline driver library', 'drivers', ['data-dsub', 'library'], 'library harvest import'],
    ['Disk / USB speed test', 'disktools', ['data-sub', 'speed'], 'speed usb sd benchmark'],
    ["Disk usage (what's using space)", 'disktools', ['data-sub', 'usage'], 'usage space windirstat treemap'],
    ['Clean junk files', 'disktools', ['data-sub', 'cleanup'], 'cleanup junk temp ccleaner'],
    ['Recent problems (event log)', 'diagnose', ['data-dgsub', 'events'], 'event log errors whea shutdown'],
    ['Component authenticity (RAM)', 'diagnose', ['data-dgsub', 'auth'], 'ram counterfeit fake spd'],
    ['Create a disk image', 'backup', ['data-bsub', 'create'], 'image wim system backup'],
    ['Partition map / tools', 'backup', ['data-bsub', 'map'], 'partition resize format letter'],
    ['Restore / clone a drive', 'backup', ['data-bsub', 'restore'], 'restore clone apply'],
    ['Internet speed test', 'network', ['data-nsub', 'speed'], 'speed internet download upload'],
    ['Network gotchas / set Private', 'network', ['data-nsub', 'status'], 'public private sharing printer gotcha'],
    ['Ping / scan my network', 'network', ['data-nsub', 'lan'], 'ping lan devices discover'],
  ];

  function build() {
    items = INDEX.map(([label, tab, sub, kw]) => ({ label, tab, sub, kw: (label + ' ' + (kw || '')).toLowerCase() }));
  }

  function open() {
    els.wrap.hidden = false;
    els.input.value = '';
    filter('');
    els.input.focus();
  }
  function close() { els.wrap.hidden = true; }
  function isOpen() { return !els.wrap.hidden; }

  function filter(q) {
    q = (q || '').trim().toLowerCase();
    const toks = q.split(/\s+/).filter(Boolean);
    shown = !toks.length ? items.slice(0, 14) : items.filter((it) => toks.every((t) => it.kw.indexOf(t) >= 0)).slice(0, 14);
    sel = 0;
    render();
  }
  function render() {
    els.results.innerHTML = '';
    if (!shown.length) { els.results.appendChild(el('div', 'qf__empty', 'No matches.')); return; }
    shown.forEach((it, i) => {
      const r = el('div', 'qf__row' + (i === sel ? ' qf__row--sel' : ''));
      r.appendChild(el('span', 'qf__label', it.label));
      r.appendChild(el('span', 'qf__tab', tabName(it.tab)));
      r.addEventListener('click', () => go(it));
      r.addEventListener('mousemove', () => { if (sel !== i) { sel = i; render(); } });
      els.results.appendChild(r);
    });
  }
  // Drive Health, Disk Tools and Backup now live under the Storage hub.
  const STORAGE_SUB = { drives: 'health', disktools: 'disktools', backup: 'backup' };
  const STORAGE_NAME = { drives: 'Drive Health', disktools: 'Disk Tools', backup: 'Backup & Clone' };
  function tabName(tab) {
    if (STORAGE_NAME[tab]) return STORAGE_NAME[tab];
    const b = document.querySelector('.tab[data-tab="' + tab + '"]');
    return b ? b.textContent.trim() : tab;
  }
  function clickSub(it) {
    if (!it.sub) return;
    setTimeout(() => {
      const sb = document.querySelector('#panel-' + it.tab + ' [' + it.sub[0] + '="' + it.sub[1] + '"]');
      if (sb) sb.click();
    }, 40);
  }
  function go(it) {
    close();
    if (STORAGE_SUB[it.tab] && window.tmStorage) {
      const s = document.querySelector('.tab[data-tab="storage"]');
      if (s) s.click();
      window.tmStorage.show(STORAGE_SUB[it.tab]);
      clickSub(it);
      return;
    }
    const b = document.querySelector('.tab[data-tab="' + it.tab + '"]');
    if (b) b.click();
    clickSub(it);
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.wrap = $('#quickFind'); els.input = $('#qfInput'); els.results = $('#qfResults');
    const btn = $('#quickFindBtn');
    if (!els.wrap) return;
    build();
    btn && btn.addEventListener('click', open);
    els.input.addEventListener('input', () => filter(els.input.value));
    els.wrap.addEventListener('click', (e) => { if (e.target === els.wrap) close(); });
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[sel]) go(shown[sel]); }
      else if (e.key === 'Escape') { close(); }
    });
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); isOpen() ? close() : open(); }
      else if (e.key === 'Escape' && isOpen()) { close(); }
    });
  });
})();
