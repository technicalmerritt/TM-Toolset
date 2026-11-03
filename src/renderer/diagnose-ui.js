'use strict';

// Diagnose tab: guided "won't power on / POST" troubleshooter + component
// authenticity check.
(function () {
  const els = {};

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function openTab(tab) { const b = document.querySelector('.tab[data-tab="' + tab + '"]'); if (b) b.click(); }

  // ----- guided flow (decision tree) -----
  const NODES = {
    start: {
      q: 'What is the machine doing?',
      opts: [
        ['No power at all — no lights, no fans', 'power'],
        ['Powers on (fans/lights) but no display / no POST', 'post'],
        ['POSTs but won’t boot Windows', 'boot'],
        ['Powers on then shuts off or reboots in a loop', 'loop'],
      ],
    },
    power: {
      q: 'Press power — any reaction at all (a twitch of the fans, an LED flash)?',
      opts: [
        ['Absolutely nothing', 'power_dead'],
        ['A brief twitch, then dead', 'power_short'],
      ],
    },
    power_dead: {
      advice: 'No power at all',
      steps: [
        'Desktop: confirm the wall socket + the PSU switch; try a known-good cable. Test the PSU (PSU tester or the paperclip jumpstart) — a dead PSU is the #1 cause.',
        'Check the front-panel POWER SW header is on the right pins (or jump the two power pins with a screwdriver to rule out the case button).',
        'Reseat the 24-pin and the CPU 4/8-pin — a missing CPU power connector gives exactly “no power / no post”.',
        'Laptop: try the charger (check the LED), hold power 30s with battery out, then power on charger-only. No charge LED → DC jack / charger / battery.',
        'Still dead with a known-good PSU → suspect the motherboard (shorted rail / failed VRM).',
      ],
    },
    power_short: {
      advice: 'Powers for a split second then dies (short / overload)',
      steps: [
        'Strip to minimal: CPU + one RAM stick, no drives, no GPU (use onboard), no USB. If it now posts, add parts back one at a time.',
        'Reseat the CPU power and inspect the socket for bent pins / debris.',
        'Look/smell for a shorted component or a bulged capacitor near the VRM.',
        'A dead short that kills power instantly often means a failed MOSFET or a shorted cap — a board-level repair.',
      ],
    },
    post: {
      advice: 'Powers on but no display / no POST',
      steps: [
        'Reseat RAM — try ONE stick in the primary slot (check the manual for which). Bad/unseated RAM is the most common no-POST.',
        'Clear CMOS (jumper or pull the coin battery for 2 min) to drop a bad overclock/setting.',
        'Try the onboard display output as well as the GPU — swap which you’re plugged into.',
        'Look for POST/debug LEDs (CPU / DRAM / VGA / BOOT) or listen for beep codes — note which one stays lit.',
        'If the DRAM or BOOT LED stays stuck, suspect corrupt firmware → read the chip with your T76 and run it through Analyze a Dump (BIOS tab).',
      ],
      links: [['Open BIOS tab', 'bios']],
    },
    boot: {
      advice: 'POSTs but won’t boot Windows',
      steps: [
        'In BIOS, is the SSD/HDD even detected? If not → dead drive or a storage-controller driver issue (RST/VMD). Check Drive Health, and keep storage-controller driverpacks on your USB.',
        'Check boot order / that Secure Boot + the right boot mode (UEFI vs Legacy) match the install.',
        'If it prompts for a BitLocker recovery key, grab it from the Safeguards tab (or the customer’s Microsoft account) before going further.',
        'Try Windows Startup Repair / bootrec (rebuild BCD).',
      ],
      links: [['Open Drive Health', 'drives'], ['Open BIOS → Safeguards', 'bios']],
    },
    loop: {
      advice: 'Powers on then shuts down / reboots repeatedly',
      steps: [
        'Overheating: is the CPU cooler seated and the fan spinning? Re-paste if it shuts off within seconds under load.',
        'Marginal PSU or RAM — test with a known-good PSU and one RAM stick.',
        'If it’s a Windows BSOD reboot loop (gets into Windows briefly), read the crash dumps in Crash Analysis.',
        'Repeated instant power-off with no POST → VRM / board fault (board-level repair).',
      ],
      links: [['Open Crash Analysis', 'crash']],
    },
  };

  function renderNode(key) {
    const node = NODES[key] || NODES.start;
    els.postBox.innerHTML = '';
    if (node.q) {
      els.postBox.appendChild(el('h3', 'dg-q', node.q));
      const opts = el('div', 'dg-opts');
      for (const [label, next] of node.opts) {
        const b = el('button', 'btn btn--ghost dg-opt', label);
        b.type = 'button';
        b.addEventListener('click', () => renderNode(next));
        opts.appendChild(b);
      }
      els.postBox.appendChild(opts);
    } else {
      const v = el('div', 'bios-verdict bios-verdict--warn');
      v.appendChild(el('div', 'bios-verdict__txt', node.advice));
      els.postBox.appendChild(v);
      const ol = el('ol', 'bios-steps');
      for (const s of node.steps) ol.appendChild(el('li', null, s));
      els.postBox.appendChild(ol);
      const bar = el('div', 'bk-actions');
      for (const [label, tab] of (node.links || [])) { const b = el('button', 'btn btn--ghost btn--sm', label); b.type = 'button'; b.addEventListener('click', () => openTab(tab)); bar.appendChild(b); }
      const restart = el('button', 'btn btn--primary btn--sm', 'Start over');
      restart.type = 'button'; restart.addEventListener('click', () => renderNode('start'));
      bar.appendChild(restart);
      els.postBox.appendChild(bar);
    }
  }

  // ----- authenticity -----
  function runAuth() {
    els.authResult.innerHTML = '';
    els.authResult.appendChild(el('p', 'muted', 'Reading components…'));
    window.diag.authenticity().then((res) => {
      const d = (res && res.data) || {}; els.authResult.innerHTML = '';
      if (!res || !res.ok || d.ok !== true) { els.authResult.appendChild(el('p', 'test-err', 'Check failed.')); return; }
      for (const f of (d.flags || [])) {
        const w = el('div', 'net-warn net-warn--warn'); const b = el('div', 'net-warn__body');
        b.appendChild(el('div', 'net-warn__title', '⚠ ' + f)); w.appendChild(b); els.authResult.appendChild(w);
      }
      if (d.ram && d.ram.length) {
        els.authResult.appendChild(el('h4', 'info-sub', 'Memory (as reported)'));
        for (const m of d.ram) {
          const row = el('div', 'drv-pkg'); const info = el('div', 'drv-pkg__info');
          info.appendChild(el('span', 'drv-pkg__prov', (m.slot || 'DIMM') + ' — ' + (m.capacityGB || '?') + ' GB ' + (m.manufacturer || 'Unknown')));
          info.appendChild(el('span', 'muted drv-pkg__meta', 'Part ' + (m.part || '?') + '  ·  ' + (m.configuredMHz || '?') + '/' + (m.ratedMHz || '?') + ' MHz'));
          row.appendChild(info); els.authResult.appendChild(row);
        }
      }
      if (d.disks && d.disks.length) {
        els.authResult.appendChild(el('h4', 'info-sub', 'Storage (as reported)'));
        for (const dk of d.disks) {
          const row = el('div', 'drv-pkg'); const info = el('div', 'drv-pkg__info');
          info.appendChild(el('span', 'drv-pkg__prov', (dk.model || 'Disk') + ' — ' + (dk.sizeGB || '?') + ' GB'));
          info.appendChild(el('span', 'muted drv-pkg__meta', (dk.interface || '') + '  ·  SN ' + (dk.serial || '?')));
          row.appendChild(info); els.authResult.appendChild(row);
        }
      }
      els.authResult.appendChild(el('p', 'muted bk-note', 'This reads what the hardware reports. To prove real storage capacity/speed use Drive Health → Capacity test and Disk Tools → Drive Speed.'));
    }).catch(() => { els.authResult.innerHTML = ''; els.authResult.appendChild(el('p', 'test-err', 'Check failed.')); });
  }

  // ----- recent problems (event log) -----
  const EV_ICON = { power: '⚡', disk: '💽', whea: '⚙', bsod: '💥', service: '🔧', appcrash: '🐞', other: 'ℹ' };
  function runEvents() {
    els.eventsResult.innerHTML = '';
    els.eventsResult.appendChild(el('p', 'muted', 'Reading event logs…'));
    window.diag.events().then((res) => {
      const d = (res && res.data) || {}; els.eventsResult.innerHTML = '';
      if (!res || !res.ok || d.ok !== true) { els.eventsResult.appendChild(el('p', 'test-err', 'Could not read the event logs.')); return; }
      const cats = (d.categories || []).filter((c) => c.count > 0);
      if (!cats.length) { els.eventsResult.appendChild(el('div', 'net-ok', '✓ No critical or error events in the last ' + d.days + ' days.')); return; }
      els.eventsResult.appendChild(el('p', 'muted', d.total + ' problem event(s) in the last ' + d.days + ' days:'));
      for (const c of cats) {
        const card = el('div', 'drv-panel');
        const h = el('div', 'bios-id__head');
        h.appendChild(el('strong', null, (EV_ICON[c.key] || '') + '  ' + c.meaning.split(' - ')[0]));
        h.appendChild(el('span', 'db-tag db-tag--bloat', String(c.count)));
        if (c.latest) h.appendChild(el('span', 'muted bios-id__date', 'latest ' + c.latest));
        card.appendChild(h);
        card.appendChild(el('p', 'muted', c.meaning));
        if (c.samples && c.samples.length) {
          const pre = el('pre', 'repairs-log'); pre.style.maxHeight = '120px';
          pre.textContent = c.samples.join('\n');
          card.appendChild(pre);
        }
        if (c.key === 'bsod') { const b = el('button', 'btn btn--ghost btn--sm', 'Open Crash Analysis'); b.type = 'button'; b.addEventListener('click', () => openTab('crash')); card.appendChild(b); }
        if (c.key === 'disk') { const b = el('button', 'btn btn--ghost btn--sm', 'Open Drive Health'); b.type = 'button'; b.addEventListener('click', () => openTab('drives')); card.appendChild(b); }
        els.eventsResult.appendChild(card);
      }
    }).catch(() => { els.eventsResult.innerHTML = ''; els.eventsResult.appendChild(el('p', 'test-err', 'Could not read the event logs.')); });
  }

  function showSub(name) {
    for (const b of document.querySelectorAll('#panel-diagnose .subtab')) b.classList.toggle('subtab--active', b.dataset.dgsub === name);
    const map = { post: 'dg-post', events: 'dg-events', auth: 'dg-auth' };
    for (const k of Object.keys(map)) { const s = document.getElementById(map[k]); if (s) s.hidden = k !== name; }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.postBox = $('#dgPostBox');
    els.authResult = $('#dgAuthResult');
    els.eventsResult = $('#dgEventsResult');
    if (!els.postBox) return;
    for (const b of document.querySelectorAll('#panel-diagnose .subtab')) b.addEventListener('click', () => showSub(b.dataset.dgsub));
    $('#dgAuthGo').addEventListener('click', runAuth);
    $('#dgEventsGo').addEventListener('click', runEvents);
    renderNode('start');
  });
})();
