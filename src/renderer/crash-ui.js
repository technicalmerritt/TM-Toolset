'use strict';

// Crash Analysis tab — decodes Windows bug-check (BSOD) codes into plain English
// with likely causes and what to try, BlueScreenView-style.
(function () {
  const els = {};
  let loaded = false;
  let loading = false;
  let lastCrash = null;

  function $(s) { return document.querySelector(s); }
  function arr(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString(); } catch { return iso || ''; }
  }

  // Bug-check lookup, keyed by numeric stop code.
  const COMMON_DRIVER = 'A device driver (graphics, network, storage, chipset or a third-party filter such as antivirus) is the usual culprit.';
  const FIX_DRIVERS = 'Update — or if it started recently, roll back — graphics, chipset, network and storage drivers. Note any driver named on the blue screen.';
  const FIX_RAM = 'Test the memory (Windows Memory Diagnostic, or MemTest86 for a thorough pass); reseat the sticks.';
  const FIX_DISK = 'Check the drive — SMART/Drive Health tab, a surface scan, and the SATA/NVMe cable or slot; run chkdsk.';
  const FIX_SFC = 'Repair Windows files: DISM /Online /Cleanup-Image /RestoreHealth then sfc /scannow.';

  const CODES = {
    0x0A: { name: 'IRQL_NOT_LESS_OR_EQUAL', plain: 'Something (almost always a driver) tried to touch memory it was not allowed to.', causes: [COMMON_DRIVER, 'Faulty RAM.'], fixes: [FIX_DRIVERS, FIX_RAM] },
    0xD1: { name: 'DRIVER_IRQL_NOT_LESS_OR_EQUAL', plain: 'A driver accessed invalid memory at too high a priority level.', causes: ['A specific driver — very often the network or graphics driver.'], fixes: [FIX_DRIVERS, FIX_RAM] },
    0x1E: { name: 'KMODE_EXCEPTION_NOT_HANDLED', plain: 'The kernel hit an error no driver dealt with.', causes: [COMMON_DRIVER, 'Faulty hardware.'], fixes: [FIX_DRIVERS, FIX_RAM] },
    0x3B: { name: 'SYSTEM_SERVICE_EXCEPTION', plain: 'A system service or driver crashed while running kernel code.', causes: [COMMON_DRIVER, 'Corrupt system files.'], fixes: [FIX_DRIVERS, FIX_SFC] },
    0x50: { name: 'PAGE_FAULT_IN_NONPAGED_AREA', plain: 'The system referenced memory that does not exist.', causes: ['Faulty RAM (most common).', 'A buggy driver or antivirus filter.'], fixes: [FIX_RAM, FIX_DRIVERS] },
    0x7E: { name: 'SYSTEM_THREAD_EXCEPTION_NOT_HANDLED', plain: 'A system thread threw an error that was not handled.', causes: [COMMON_DRIVER], fixes: [FIX_DRIVERS, FIX_SFC] },
    0x1A: { name: 'MEMORY_MANAGEMENT', plain: 'Windows memory management detected a serious inconsistency.', causes: ['Faulty RAM (most common).', 'A driver, or disk corruption.'], fixes: [FIX_RAM, FIX_DISK, FIX_SFC] },
    0x24: { name: 'NTFS_FILE_SYSTEM', plain: 'A problem occurred inside the NTFS file-system driver.', causes: ['A failing or corrupt disk.', 'A bad cable/connection.'], fixes: [FIX_DISK, FIX_SFC] },
    0x7A: { name: 'KERNEL_DATA_INPAGE_ERROR', plain: 'Windows could not read a page of data back from the disk.', causes: ['A failing drive or bad cable (most common).', 'Faulty RAM.'], fixes: [FIX_DISK, FIX_RAM] },
    0x77: { name: 'KERNEL_STACK_INPAGE_ERROR', plain: 'Windows could not read kernel data from the disk.', causes: ['A failing drive or bad cable.', 'Faulty RAM.'], fixes: [FIX_DISK, FIX_RAM] },
    0x7B: { name: 'INACCESSIBLE_BOOT_DEVICE', plain: 'Windows lost access to the drive it boots from.', causes: ['Storage controller mode changed in BIOS (AHCI/RAID/Intel VMD).', 'A failing boot drive or missing storage driver.'], fixes: ['Check the SATA/NVMe/VMD mode in BIOS matches what Windows was installed with.', FIX_DISK] },
    0xED: { name: 'UNMOUNTABLE_BOOT_VOLUME', plain: 'The boot volume could not be mounted.', causes: ['Disk corruption or a failing boot drive.', 'A bad cable.'], fixes: [FIX_DISK] },
    0xF4: { name: 'CRITICAL_OBJECT_TERMINATION', plain: 'A process Windows needs to run ended unexpectedly.', causes: ['Often a failing system drive.', 'Corrupt system files.'], fixes: [FIX_DISK, FIX_SFC] },
    0xEF: { name: 'CRITICAL_PROCESS_DIED', plain: 'A critical Windows process stopped.', causes: ['Corrupt system files or a bad update.', 'Disk corruption.'], fixes: [FIX_SFC, FIX_DISK] },
    0x9F: { name: 'DRIVER_POWER_STATE_FAILURE', plain: 'A driver did not handle a sleep/wake power transition.', causes: ['A driver mishandling sleep — commonly network, GPU or a USB device.'], fixes: [FIX_DRIVERS, 'If it happens on sleep/resume, update or disable the suspect device, and update the chipset driver.'] },
    0x133: { name: 'DPC_WATCHDOG_VIOLATION', plain: 'A device or driver held the processor too long.', causes: ['Old SSD firmware (classic cause).', 'A storage/USB driver or incompatible device.'], fixes: ['Update the SSD firmware and storage (AHCI/NVMe) driver.', FIX_DRIVERS] },
    0x124: { name: 'WHEA_UNCORRECTABLE_ERROR', plain: 'The CPU reported a hardware error it could not correct — this is hardware, not Windows.', causes: ['Overheating, an unstable overclock, CPU/motherboard, PSU, or failing RAM.'], fixes: ['Clear any overclock/XMP to defaults, check cooling and temperatures, test RAM, and check the PSU.', FIX_RAM] },
    0xC2: { name: 'BAD_POOL_CALLER', plain: 'A driver misused a memory pool.', causes: [COMMON_DRIVER], fixes: [FIX_DRIVERS, FIX_RAM] },
    0x19: { name: 'BAD_POOL_HEADER', plain: 'A memory pool structure was corrupt.', causes: ['A driver (often antivirus or a filter), or faulty RAM.'], fixes: [FIX_DRIVERS, FIX_RAM] },
    0xC5: { name: 'DRIVER_CORRUPTED_EXPOOL', plain: 'A driver corrupted the system memory pool.', causes: [COMMON_DRIVER, 'Faulty RAM.'], fixes: [FIX_DRIVERS, FIX_RAM] },
    0xBE: { name: 'ATTEMPTED_WRITE_TO_READONLY_MEMORY', plain: 'A driver tried to write to read-only memory.', causes: [COMMON_DRIVER], fixes: [FIX_DRIVERS] },
    0xFC: { name: 'ATTEMPTED_EXECUTE_OF_NOEXECUTE_MEMORY', plain: 'A driver tried to run code from a non-executable area.', causes: [COMMON_DRIVER, 'Faulty RAM.'], fixes: [FIX_DRIVERS, FIX_RAM] },
    0x139: { name: 'KERNEL_SECURITY_CHECK_FAILURE', plain: 'Windows caught a corrupted data structure and stopped to stay safe.', causes: ['A driver, or faulty RAM.', 'Disk corruption.'], fixes: [FIX_DRIVERS, FIX_RAM, FIX_SFC] },
    0x4A: { name: 'IRQL_GT_ZERO_AT_SYSTEM_SERVICE', plain: 'A thread returned to user mode at the wrong priority level.', causes: [COMMON_DRIVER], fixes: [FIX_DRIVERS] },
    0xDEADDEAD: { name: 'MANUALLY_INITIATED_CRASH', plain: 'This crash was triggered on purpose (e.g. the keyboard CrashOnCtrlScroll test).', causes: ['Someone forced it deliberately.'], fixes: ['No action needed unless it was unexpected.'] },
  };

  function decode(codeHex) {
    const num = parseInt(codeHex, 16);
    const info = CODES[num];
    if (info) return info;
    return {
      name: 'Bug check ' + codeHex,
      plain: 'A kernel-level stop that is less common. The code and parameters below identify it.',
      causes: [COMMON_DRIVER, 'Faulty RAM or a failing disk.'],
      fixes: [FIX_DRIVERS, FIX_RAM, FIX_DISK],
    };
  }

  const DUMP_TYPES = { 0: 'No dump is written', 1: 'Complete memory dump', 2: 'Kernel memory dump', 3: 'Small memory dump (Minidump)', 7: 'Automatic memory dump' };

  async function load() {
    if (loading) return;
    loading = true;
    loaded = true;
    els.status.hidden = false;
    els.error.hidden = true;
    els.content.hidden = true;
    try {
      const res = await window.crash.list();
      if (!res || res.ok !== true) { showError(res ? res.error : 'Unknown error'); return; }
      render(res.data || {});
    } catch (e) {
      showError((e && e.message) || String(e));
    } finally {
      loading = false;
    }
  }

  function showError(msg) {
    els.status.hidden = true;
    els.content.hidden = true;
    els.errorDetail.textContent = msg || '(no detail)';
    els.error.hidden = false;
  }

  function list(items) {
    const ul = el('ul', 'crash-list');
    for (const it of items) ul.appendChild(el('li', null, it));
    return ul;
  }

  function dumpCard(d) {
    const info = d.bugcheckCode ? decode(d.bugcheckCode) : null;
    const card = el('section', 'crash-card');

    const head = el('div', 'crash-card__head');
    const left = el('div');
    left.appendChild(el('h3', null, info ? info.name : (d.name || 'Crash dump')));
    left.appendChild(el('div', 'crash-sub', fmtTime(d.time)));
    head.appendChild(left);
    if (d.bugcheckCode) {
      const badge = el('div', 'crash-code');
      badge.appendChild(el('span', 'crash-code__hex', d.bugcheckCode));
      head.appendChild(badge);
    }
    card.appendChild(head);

    if (info) card.appendChild(el('p', 'crash-plain', info.plain));

    if (d.parseError) {
      card.appendChild(el('p', 'muted', 'Dump header could not be read (' + d.parseError + '). The event timeline below still applies.'));
    }

    if (info) {
      const grid = el('div', 'crash-grid');
      const c1 = el('div', 'crash-col');
      c1.appendChild(el('h4', 'crash-col__h', 'Likely causes'));
      c1.appendChild(list(info.causes));
      const c2 = el('div', 'crash-col');
      c2.appendChild(el('h4', 'crash-col__h', 'What to try'));
      c2.appendChild(list(info.fixes));
      grid.append(c1, c2);
      card.appendChild(grid);
    }

    // Technical detail
    const meta = el('div', 'crash-meta');
    const addMeta = (k, v) => { if (v == null || v === '') return; meta.append(el('span', 'crash-meta__k', k), el('span', 'crash-meta__v', String(v))); };
    addMeta('Stop code', d.bugcheckCode);
    if (arr(d.params).length) addMeta('Parameters', arr(d.params).join('  '));
    addMeta('Dump file', d.name);
    addMeta('Size', d.sizeKB != null ? d.sizeKB + ' KB' : null);
    if (meta.children.length) card.appendChild(meta);

    return card;
  }

  function buildSyncroHtml() {
    const e = window.tmEsc || ((s) => s);
    const data = lastCrash || {};
    const dumps = arr(data.dumps), events = arr(data.events);
    const out = ['<p><strong>TM Toolset — Crash Analysis</strong><br>' + e(new Date().toLocaleString()) + '</p>'];
    if (!dumps.length && !events.length) {
      out.push('<p>No crash dumps or bug-check / unexpected-restart events on record. Clean recent history.</p>');
    } else {
      if (dumps.length) {
        out.push('<p><strong>' + dumps.length + ' crash dump(s):</strong></p><ul>');
        for (const d of dumps) {
          const info = d.bugcheckCode ? decode(d.bugcheckCode) : null;
          out.push('<li><strong>' + e(info ? info.name : (d.name || 'dump')) + '</strong>' +
            (d.bugcheckCode ? ' (' + e(d.bugcheckCode) + ')' : '') + ' — ' + e(fmtTime(d.time)) +
            (info ? '<br>' + e(info.plain) : '') + '</li>');
        }
        out.push('</ul>');
      }
      if (events.length) {
        out.push('<p><strong>Event history (most recent ' + Math.min(events.length, 10) + '):</strong></p><ul>');
        for (const ev of events.slice(0, 10)) {
          out.push('<li>' + e(fmtTime(ev.time)) + ' — ' + e(ev.kind === 'power' ? 'Unexpected restart' : 'Bug check') + '</li>');
        }
        out.push('</ul>');
      }
    }
    out.push('<p><em>Generated by TM Toolset · Technical Merritt Computer Services</em></p>');
    return out.join('\n');
  }

  function render(data) {
    lastCrash = data;
    els.status.hidden = true;
    els.error.hidden = true;
    els.content.hidden = false;
    els.content.innerHTML = '';

    const dumps = arr(data.dumps);
    const events = arr(data.events);

    // Summary banner
    const summary = el('section', 'crash-summary');
    if (!dumps.length && !events.length) {
      summary.classList.add('crash-summary--good');
      summary.appendChild(el('h2', null, 'No crashes found'));
      summary.appendChild(el('p', 'muted', 'No crash dumps and no bug-check or unexpected-restart events were recorded. This PC has a clean recent history.'));
    } else {
      const n = dumps.length;
      summary.appendChild(el('h2', null, n ? `${n} crash dump${n === 1 ? '' : 's'} on record` : 'Crash events on record'));
      const bits = [];
      if (data.dumpTypeCode != null) bits.push('Dump setting: ' + (DUMP_TYPES[data.dumpTypeCode] || ('code ' + data.dumpTypeCode)));
      if (data.isAdmin === false) bits.push('Running without admin — some dumps/events may be hidden.');
      summary.appendChild(el('p', 'muted', bits.join('  ·  ') || 'Most recent first. Each card decodes the stop code with likely causes and fixes.'));
      if (data.dumpTypeCode === 0) {
        summary.appendChild(el('p', 'crash-warn', 'Crash dumps are turned OFF on this PC, so new blue screens will not leave a dump to analyse. Turn on "Automatic memory dump" under System → Advanced → Startup and Recovery to capture the next one.'));
      }
    }
    els.content.appendChild(summary);

    for (const d of dumps) els.content.appendChild(dumpCard(d));

    if (events.length) {
      els.content.appendChild(el('h3', 'crash-section', 'Event-log history'));
      const tl = el('div', 'crash-timeline');
      for (const e of events) {
        const row = el('div', 'crash-ev crash-ev--' + (e.kind || 'other'));
        row.appendChild(el('div', 'crash-ev__time', fmtTime(e.time)));
        const body = el('div', 'crash-ev__body');
        body.appendChild(el('div', 'crash-ev__tag', e.kind === 'power' ? 'Unexpected restart' : 'Bug check'));
        body.appendChild(el('div', 'crash-ev__msg', e.message || ''));
        row.appendChild(body);
        tl.appendChild(row);
      }
      els.content.appendChild(tl);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.status = $('#crashStatus');
    els.error = $('#crashError');
    els.errorDetail = $('#crashErrorDetail');
    els.content = $('#crashContent');
    els.refresh = $('#crashRefresh');
    els.syncro = $('#crashSyncro');
    if (!els.content) return;
    els.refresh && els.refresh.addEventListener('click', load);
    els.syncro && els.syncro.addEventListener('click', () => {
      if (!loaded) { load().then(() => window.tmSyncroPost(els.syncro, 'TM Toolset — Crash Analysis', buildSyncroHtml())); }
      else window.tmSyncroPost(els.syncro, 'TM Toolset — Crash Analysis', buildSyncroHtml());
    });
    const tab = document.querySelector('.tab[data-tab="crash"]');
    if (tab) tab.addEventListener('click', () => { if (!loaded) load(); });
  });
})();
