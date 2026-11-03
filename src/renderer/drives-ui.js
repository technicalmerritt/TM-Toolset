'use strict';

(function () {
  const els = {};
  let loaded = false;
  let loading = false;
  let lastDrives = [];
  const progressNodes = {}; // `${disk}:${kind}` -> text node for live test progress
  const surfaceByDisk = {}; // disk number -> last surface-scan summary, feeds the health verdict
  const cardRefreshers = {}; // disk number -> () => re-evaluate that card's health ring

  function $(s) { return document.querySelector(s); }
  function arr(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
  function num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmtBytes(b) {
    b = Number(b) || 0;
    if (b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }

  // ---- SMART attribute names (common ATA set) ----
  const SMART_NAMES = {
    1: 'Read error rate', 3: 'Spin-up time', 4: 'Start/stop count', 5: 'Reallocated sectors',
    7: 'Seek error rate', 9: 'Power-on hours', 10: 'Spin retry count', 11: 'Recalibration retries',
    12: 'Power cycle count', 171: 'Program fail count', 172: 'Erase fail count', 173: 'Wear levelling count',
    174: 'Unexpected power loss', 175: 'Program fail (worst)', 177: 'Wear levelling', 179: 'Used reserved blocks',
    181: 'Program fail total', 182: 'Erase fail total', 183: 'SATA downshift errors', 184: 'End-to-end error',
    187: 'Reported uncorrectable', 188: 'Command timeout', 189: 'High fly writes', 190: 'Airflow temperature',
    191: 'G-sense error rate', 192: 'Power-off retract count', 193: 'Load/unload cycles', 194: 'Temperature',
    195: 'Hardware ECC recovered', 196: 'Reallocation events', 197: 'Current pending sectors',
    198: 'Offline uncorrectable', 199: 'UDMA CRC error count', 200: 'Multi-zone error rate',
    201: 'Soft read error rate', 231: 'SSD life left', 232: 'Available reserved space', 233: 'Media wear-out',
    234: 'Thermal throttle', 241: 'Total LBAs written', 242: 'Total LBAs read', 249: 'NAND writes',
  };
  // Attributes where a non-zero RAW value is a bad sign.
  const RAW_BAD = new Set([5, 10, 184, 187, 188, 196, 197, 198, 199, 201, 171, 172, 181, 182]);

  function attrMap(dr) {
    const m = {};
    for (const a of arr(dr.smartAttributes)) if (a && a.id != null) m[a.id] = a;
    return m;
  }
  function rawOf(m, id) { return m[id] ? num(m[id].raw) : 0; }
  function hasAttr(m, id) { return !!m[id]; }

  // ---- Health %: data-integrity focused ----
  function healthPct(dr, m) {
    const nv = dr.nvme;
    if (nv) {
      let h = 100 - num(nv.percentageUsed);
      if (num(nv.availableSpare) > 0 && num(nv.spareThreshold) > 0 && num(nv.availableSpare) <= num(nv.spareThreshold)) h = Math.min(h, 20);
      if (num(nv.mediaErrors) > 0) h -= Math.min(45, 10 + num(nv.mediaErrors));
      if (num(nv.criticalWarning) !== 0) h = Math.min(h, 25);
      const hs = (dr.health || '').toLowerCase();
      if (hs && hs !== 'healthy') h = Math.min(h, 40);
      return Math.max(1, Math.min(100, Math.round(h)));
    }
    let h = 100;
    const re = rawOf(m, 5), pend = rawOf(m, 197), unc = rawOf(m, 198) + rawOf(m, 187), crc = rawOf(m, 199);
    if (re > 0) h -= Math.min(55, 8 + re * 2);
    if (pend > 0) h -= Math.min(45, 12 + pend * 3);
    if (unc > 0) h -= Math.min(55, 15 + unc * 3);
    if (crc > 0) h -= Math.min(12, 2 + crc);
    // Normalised value vs prefail threshold
    for (const a of arr(dr.smartAttributes)) {
      if (a.threshold != null && a.value != null && a.threshold > 0) {
        if (a.value <= a.threshold) h = Math.min(h, 10);
        else if (a.value - a.threshold <= 12) h -= 12;
      }
    }
    h -= num(dr.wearPct);
    const hs = (dr.health || '').toLowerCase();
    if (hs && hs !== 'healthy') h = Math.min(h, 40);
    return Math.max(1, Math.min(100, Math.round(h)));
  }

  // ---- Performance %: responsiveness focused ----
  function performancePct(dr, m) {
    const nv = dr.nvme;
    if (nv) {
      let p = 100;
      if (num(nv.temperatureC) >= 70) p -= 15;
      if ((num(nv.criticalWarning) & 0x02) !== 0) p -= 20; // temperature warning
      if (num(nv.mediaErrors) > 0) p -= 10;
      return Math.max(1, Math.min(100, Math.round(p)));
    }
    let p = 100;
    const crc = rawOf(m, 199);
    if (crc > 0) p -= Math.min(45, 5 + crc * 2);
    if (rawOf(m, 10) > 0) p -= Math.min(20, rawOf(m, 10) * 2);
    if (rawOf(m, 188) > 0) p -= Math.min(20, rawOf(m, 188));
    if (rawOf(m, 5) > 0) p -= 10;
    if (rawOf(m, 197) > 0) p -= 10;
    for (const id of [1, 7]) {
      const a = m[id];
      if (a && a.value != null && a.threshold != null && a.threshold > 0 && a.value - a.threshold <= 20) p -= 8;
    }
    return Math.max(1, Math.min(100, Math.round(p)));
  }

  // Does this drive actually report SMART we can trust? USB enclosures usually
  // don't, so we must NOT present a confident "100%" built on nothing.
  function smartIsKnown(dr) {
    if (dr.nvme) return true;
    if (arr(dr.smartAttributes).length > 0) return true;
    const src = (dr.smartSource || '').toLowerCase();
    if (src === 'nvme-log' || src === 'ata-passthrough') return true;
    if (src === 'reliability-counter' && (dr.temperatureC != null || dr.powerOnHours != null || dr.wearPct != null)) return true;
    return false;
  }
  function summariseSurface(d) {
    return {
      readErrors: num(d.readErrors),
      slow: arr(d.slowRegions).length,
      maxMs: num(d.maxMsPerBlock),
      avgMs: num(d.avgMsPerBlock),
      tested: num(d.regionsTested),
    };
  }
  // The single source of truth for a drive's health. Combines SMART (when the
  // drive actually reports it) with any surface scan that's been run, so slow or
  // unreadable regions can't sit behind a green "100%".
  function assess(dr, m) {
    const surf = surfaceByDisk[dr.number];
    const known = smartIsKnown(dr);
    let pct = known ? healthPct(dr, m) : null;
    let basis = known ? 'SMART' : 'no SMART data';
    const reasons = [];

    if (surf) {
      basis = known ? 'SMART + surface scan' : 'surface scan';
      const base = known ? pct : 100;
      if (surf.readErrors > 0) {
        pct = Math.min(base, 10);
        reasons.push(surf.readErrors + ' unreadable region(s) in the surface scan — the drive is failing.');
      } else if (surf.maxMs >= 1200 || surf.slow >= 10) {
        pct = Math.min(base, 42);
        reasons.push('Slow/failing regions in the surface scan (slowest ' + Math.round(surf.maxMs) + ' ms, ' + surf.slow + ' slow spot' + (surf.slow === 1 ? '' : 's') + ') — a classic sign of a weak or dying drive.');
      } else if (surf.maxMs >= 600 || surf.slow >= 3) {
        pct = Math.min(base, 66);
        reasons.push(surf.slow + ' slow region' + (surf.slow === 1 ? '' : 's') + ' in the surface scan (slowest ' + Math.round(surf.maxMs) + ' ms) — worth watching / backing up.');
      } else if (surf.slow >= 1) {
        pct = Math.min(base, 82);
        reasons.push('A couple of mildly slow spots in the surface scan (slowest ' + Math.round(surf.maxMs) + ' ms) — minor, keep an eye on it.');
      } else {
        if (!known) pct = 90;
        reasons.push('Surface scan found no read errors or slow regions.');
      }
    }

    if (pct == null) {
      return {
        pct: null, cls: 'warn', label: 'Unknown', basis,
        reasons: ['This drive doesn’t report SMART data (common for USB enclosures and some adapters), so its condition can’t be read electronically. Run a Surface test below to actually check the media.'],
      };
    }
    pct = Math.max(1, Math.min(100, Math.round(pct)));
    const label = pct >= 85 ? 'Healthy' : pct >= 55 ? 'Caution' : 'Failing';
    if (known && !surf) reasons.push('Based on SMART only. Run a Surface test to confirm the physical media is actually reading well.');
    return { pct, cls: healthClass(pct), label, basis, reasons };
  }

  function fmtHours(h) {
    h = num(h);
    if (h <= 0) return null;
    const years = Math.floor(h / 8760);
    const days = Math.floor((h % 8760) / 24);
    if (years > 0) return `${years} yr ${days} d  (${h.toLocaleString()} h)`;
    return `${days} d  (${h.toLocaleString()} h)`;
  }

  // Total Bytes Written — NVMe Data Units Written (×512000), else SMART 241 (×512).
  function lifetimeWrites(dr, m) {
    let bytes = 0;
    if (dr.nvme && dr.nvme.dataUnitsWritten != null) bytes = num(dr.nvme.dataUnitsWritten) * 512000;
    else if (m[241] && m[241].raw != null) bytes = num(m[241].raw) * 512;
    if (bytes <= 0) return null;
    const tb = bytes / 1e12;
    if (tb >= 1) return tb.toFixed(2) + ' TB';
    return (bytes / 1e9).toFixed(1) + ' GB';
  }

  function remainingLife(dr, m) {
    const poh = num(dr.powerOnHours);
    const isSSD = dr.nvme != null || /ssd/i.test(dr.mediaType || '') || dr.wearPct != null || hasAttr(m, 231) || hasAttr(m, 233) || hasAttr(m, 177);
    if (isSSD) {
      let used = num(dr.wearPct);
      if (dr.nvme && dr.nvme.percentageUsed != null) used = num(dr.nvme.percentageUsed);
      if (!used && m[233]) used = 100 - num(m[233].value); // media wear-out normalised
      if (!used && m[231]) used = 100 - num(m[231].value); // life-left normalised
      if (used > 0 && poh > 0) {
        const remH = poh * (100 - used) / used;
        const yrs = remH / 8760;
        return { text: `~${yrs.toFixed(1)} yr left`, note: `estimate from ${used}% life used at the current write rate` };
      }
      if (used === 0) return { text: '> 5 yr (minimal wear)', note: 'SSD reports essentially no wear yet' };
      return { text: 'n/a', note: 'drive does not report wear' };
    }
    // HDD: compare against a typical 5-year design life.
    if (poh > 0) {
      const designH = 43800;
      const remH = designH - poh;
      if (remH > 0) return { text: `~${(remH / 8760).toFixed(1)} yr left`, note: 'rough estimate vs a typical 5-yr design life' };
      return { text: 'past typical design life', note: 'beyond a typical 5-yr design life — monitor closely' };
    }
    return null;
  }

  function healthClass(p) { return p >= 85 ? 'good' : p >= 55 ? 'warn' : 'bad'; }
  function tempClass(t) { return t >= 60 ? 'bad' : t >= 50 ? 'warn' : 'good'; }

  async function load() {
    if (loading) return;
    loading = true;
    loaded = true;
    els.status.hidden = false;
    els.error.hidden = true;
    els.list.hidden = true;
    try {
      const res = await window.drives.list();
      if (!res || res.ok !== true) { showError(res ? res.error : 'Unknown error'); return; }
      render(arr(res.data && res.data.drives));
    } catch (e) {
      showError((e && e.message) || String(e));
    } finally {
      loading = false;
    }
  }

  function showError(msg) {
    els.status.hidden = true;
    els.list.hidden = true;
    els.errorDetail.textContent = msg || '(no detail)';
    els.error.hidden = false;
  }

  function bar(label, value, max, cls, valueText) {
    const wrap = el('div', 'gauge');
    const top = el('div', 'gauge__top');
    top.append(el('span', 'gauge__label', label), el('span', 'gauge__val', valueText));
    const track = el('div', 'gauge__track');
    const fill = el('div', 'gauge__fill ' + (cls || ''));
    fill.style.width = Math.max(0, Math.min(100, (value / max) * 100)) + '%';
    track.appendChild(fill);
    wrap.append(top, track);
    return wrap;
  }

  function metric(label, value, cls) {
    const b = el('div', 'metric' + (cls ? ' metric--' + cls : ''));
    b.appendChild(el('div', 'metric__val', value));
    b.appendChild(el('div', 'metric__lbl', label));
    return b;
  }

  function smartTable(dr) {
    const attrs = arr(dr.smartAttributes).filter((a) => a && a.id != null);
    if (!attrs.length) return null;
    attrs.sort((a, b) => a.id - b.id);
    const t = el('table', 'smart-table');
    const thead = el('thead');
    const htr = el('tr');
    for (const h of ['ID', 'Attribute', 'Value', 'Worst', 'Thresh', 'Raw', '']) htr.appendChild(el('th', null, h));
    thead.appendChild(htr);
    t.appendChild(thead);
    const tb = el('tbody');
    for (const a of attrs) {
      const tr = el('tr');
      tr.appendChild(el('td', 'smart-id', String(a.id)));
      tr.appendChild(el('td', null, SMART_NAMES[a.id] || ('Attribute ' + a.id)));
      tr.appendChild(el('td', null, a.value != null ? String(a.value) : '—'));
      tr.appendChild(el('td', null, a.worst != null ? String(a.worst) : '—'));
      tr.appendChild(el('td', null, a.threshold != null ? String(a.threshold) : '—'));
      tr.appendChild(el('td', 'smart-raw', String(num(a.raw))));
      let status = 'OK', cls = 'ok';
      const prefail = a.threshold != null && a.value != null && a.threshold > 0 && a.value <= a.threshold;
      if (prefail) { status = 'FAIL'; cls = 'bad'; }
      else if (RAW_BAD.has(a.id) && num(a.raw) > 0) { status = 'Watch'; cls = 'warn'; }
      const st = el('td', 'smart-st smart-st--' + cls, status);
      tr.appendChild(st);
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    return t;
  }

  function nvmeTable(dr) {
    const nv = dr.nvme;
    if (!nv) return null;
    const rows = [
      ['Percentage used', num(nv.percentageUsed) + ' %', num(nv.percentageUsed) >= 80 ? 'bad' : num(nv.percentageUsed) >= 50 ? 'warn' : 'ok'],
      ['Available spare', num(nv.availableSpare) + ' %', num(nv.availableSpare) > 0 && num(nv.availableSpare) <= num(nv.spareThreshold) ? 'bad' : 'ok'],
      ['Spare threshold', num(nv.spareThreshold) + ' %', 'ok'],
      ['Media / data errors', String(num(nv.mediaErrors)), num(nv.mediaErrors) > 0 ? 'bad' : 'ok'],
      ['Unsafe shutdowns', String(num(nv.unsafeShutdowns)), 'ok'],
      ['Critical warning flags', '0x' + (num(nv.criticalWarning)).toString(16), num(nv.criticalWarning) !== 0 ? 'bad' : 'ok'],
      ['Data units written', (num(nv.dataUnitsWritten) * 512000 / 1e12).toFixed(2) + ' TB', 'ok'],
      ['Data units read', (num(nv.dataUnitsRead) * 512000 / 1e12).toFixed(2) + ' TB', 'ok'],
    ];
    const t = el('table', 'smart-table');
    const tb = el('tbody');
    for (const [k, v, cls] of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', null, k));
      tr.appendChild(el('td', 'smart-raw', v));
      tr.appendChild(el('td', 'smart-st smart-st--' + cls, cls === 'bad' ? 'Attention' : 'OK'));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    return t;
  }

  const SOURCE_LABEL = {
    'ata-passthrough': 'Live ATA SMART (direct pass-through)',
    'nvme-log': 'Live NVMe SMART / health log',
    'reliability-counter': 'Windows reliability counters (limited — no sector-level SMART)',
    'none': 'No SMART source available',
    'error': 'SMART read error',
  };

  // ---- Surface / speed test UI per drive ----
  function runTest(dr, kind, btn, box) {
    const disk = dr.number;
    const key = disk + ':' + kind;
    box.innerHTML = '';
    box.hidden = false;
    const prog = el('div', 'test-prog');
    prog.appendChild(el('div', 'spinner spinner--sm', ''));
    const txt = el('span', 'test-prog__txt', kind === 'surface' ? 'Starting surface scan…' : 'Starting speed test…');
    prog.appendChild(txt);
    box.appendChild(prog);
    progressNodes[key] = txt;
    btn.disabled = true;
    const other = btn.parentNode.querySelectorAll('button');
    other.forEach((b) => (b.disabled = true));
    window.TMActivity && window.TMActivity.start(key, (kind === 'surface' ? 'Surface scan' : 'Drive speed test') + ' (disk ' + disk + ')');

    const call = kind === 'surface' ? window.drives.surfaceTest(disk) : window.drives.speedTest(disk);
    call.then((res) => {
      delete progressNodes[key];
      box.innerHTML = '';
      if (!res || res.ok !== true) { box.appendChild(el('p', 'test-err', 'Test failed: ' + ((res && res.error) || 'unknown'))); return; }
      const d = res.data || {};
      if (d.error === 'admin') { box.appendChild(el('p', 'test-err', 'This test needs administrator rights. Use “Run as administrator”, then try again.')); return; }
      if (d.error === 'size') { box.appendChild(el('p', 'test-err', 'Could not read this disk’s size.')); return; }
      if (d.error === 'open') { box.appendChild(el('p', 'test-err', 'Could not open the disk for testing (' + (d.detail || '') + ').')); return; }
      if (kind === 'surface') {
        renderSurface(box, d);
        // Feed the result back into the health verdict so slow/unreadable
        // regions can't sit behind a green percentage.
        surfaceByDisk[dr.number] = summariseSurface(d);
        if (cardRefreshers[dr.number]) cardRefreshers[dr.number]();
        box.appendChild(el('p', 'muted test-note', 'Health re-evaluated using this scan — see the Health ring above.'));
      } else renderSpeed(box, d);
    }).catch((e) => {
      delete progressNodes[key];
      box.innerHTML = '';
      box.appendChild(el('p', 'test-err', 'Test failed: ' + ((e && e.message) || String(e))));
    }).finally(() => {
      window.TMActivity && window.TMActivity.end(key);
      other.forEach((b) => (b.disabled = false));
    });
  }

  function renderSurface(box, d) {
    const errs = num(d.readErrors);
    const slow = arr(d.slowRegions).length;
    const cls = errs > 0 ? 'bad' : slow > 0 ? 'warn' : 'good';
    const head = el('div', 'test-result test-result--' + cls);
    head.appendChild(el('strong', null, errs > 0 ? `${errs} unreadable region(s) found` : slow > 0 ? 'Readable, but some slow regions' : 'No read errors — surface looks healthy'));
    head.appendChild(el('span', 'muted', `  ${num(d.regionsTested)} regions sampled across the whole disk · avg ${num(d.avgMsPerBlock)} ms/block · slowest ${num(d.maxMsPerBlock)} ms`));
    box.appendChild(head);
    if (arr(d.badRegionsGB).length) {
      box.appendChild(el('p', 'test-detail', 'Unreadable near: ' + arr(d.badRegionsGB).map((g) => g + ' GB').join(', ')));
    }
    if (slow) {
      box.appendChild(el('p', 'test-detail', 'Slow spots: ' + arr(d.slowRegions).slice(0, 12).map((s) => `${s.atGB} GB (${s.ms} ms)`).join(', ')));
    }
    box.appendChild(el('p', 'muted test-note', 'Sampled surface scan (reads 1 MB blocks spread edge-to-edge). For a full sector-by-sector pass use the Surface scan on the Issue Scanner tab or chkdsk /r.'));
  }

  function renderSpeed(box, d) {
    const row = el('div', 'test-speed');
    if (d.readMBps != null) row.appendChild(metric('Sequential read', d.readMBps + ' MB/s', d.readMBps >= 200 ? 'good' : d.readMBps >= 80 ? 'warn' : 'bad'));
    else if (d.readError) row.appendChild(metric('Read', 'error', 'bad'));
    if (d.writeMBps != null) row.appendChild(metric('Sequential write' + (d.writeDrive ? ' (' + d.writeDrive + ')' : ''), d.writeMBps + ' MB/s', d.writeMBps >= 150 ? 'good' : d.writeMBps >= 60 ? 'warn' : 'bad'));
    box.appendChild(row);
    if (d.writeNote) box.appendChild(el('p', 'muted test-note', d.writeNote));
    if (d.writeError) box.appendChild(el('p', 'muted test-note', 'Write test skipped: ' + d.writeError));
    box.appendChild(el('p', 'muted test-note', 'Read is measured straight off the disk; write uses a temporary file flushed to the hardware, then deleted.'));
  }

  // ---- Counterfeit / fake-capacity test (write-verify fill test) ----
  function startCapacityUI(dr, btn, box) {
    box.innerHTML = '';
    box.hidden = false;
    const vols = arr(dr.volumes).filter((v) => v && v.drive && /^[A-Za-z]:/.test(v.drive));
    if (!vols.length) {
      box.appendChild(el('p', 'test-err', 'This drive has no formatted volume with a drive letter. Format it first (Backup & Imaging → Disk Map → Format), then test.'));
      return;
    }
    const warn = el('div', 'cap-warn');
    warn.appendChild(el('strong', null, 'Counterfeit-capacity test'));
    warn.appendChild(el('p', 'muted', 'Writes uniquely-stamped data across the free space and reads it all back. It does not delete your existing files, but it fills free space — best run on an empty or freshly-formatted drive. For certainty, test an amount larger than this PC’s RAM.'));
    box.appendChild(warn);

    const opts = el('div', 'cap-opts');
    let volSel = null;
    if (vols.length > 1) {
      volSel = el('select', 'select');
      for (const v of vols) {
        const o = el('option', null, v.drive + ' ' + (v.label || '') + ' (' + (v.freeGB != null ? v.freeGB + ' GB free' : '') + ')');
        o.value = v.drive.substring(0, 1);
        volSel.appendChild(o);
      }
      const l = el('label', 'field'); l.appendChild(el('span', null, 'Volume'));
      const r = el('div', 'field__row'); r.appendChild(volSel); l.appendChild(r); opts.appendChild(l);
    }
    const amtSel = el('select', 'select');
    [['Full free space (most thorough)', 0], ['Quick — up to 32 GB', 32], ['Up to 64 GB', 64], ['Up to 128 GB', 128]].forEach(([lab, val]) => {
      const o = el('option', null, lab); o.value = String(val); amtSel.appendChild(o);
    });
    const al = el('label', 'field'); al.appendChild(el('span', null, 'Amount to test'));
    const ar = el('div', 'field__row'); ar.appendChild(amtSel); al.appendChild(ar); opts.appendChild(al);
    box.appendChild(opts);

    const actions = el('div', 'cap-actions');
    const start = el('button', 'btn btn--primary btn--sm', 'Start capacity test');
    start.type = 'button';
    start.addEventListener('click', () => {
      const letter = volSel ? volSel.value : vols[0].drive.substring(0, 1);
      runCapacity(dr, letter, parseInt(amtSel.value, 10) || 0, btn, box);
    });
    actions.appendChild(start);
    box.appendChild(actions);
  }

  function runCapacity(dr, letter, maxGB, btn, box) {
    const path = letter.toUpperCase() + ':\\';
    box.innerHTML = '';
    const prog = el('div', 'test-prog');
    prog.appendChild(el('div', 'spinner spinner--sm', ''));
    const txt = el('span', 'test-prog__txt', 'Starting capacity test…');
    prog.appendChild(txt);
    box.appendChild(prog);
    const cancel = el('button', 'btn btn--ghost btn--sm btn--danger', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { cancel.disabled = true; cancel.textContent = 'Cancelling…'; window.drives.capacityCancel(); });
    box.appendChild(cancel);
    progressNodes['capacity:' + path] = txt;

    const sib = btn.parentNode.querySelectorAll('button');
    sib.forEach((b) => (b.disabled = true));
    window.TMActivity && window.TMActivity.start('capacity:' + path, 'Capacity test (' + letter.toUpperCase() + ':)');

    window.drives.capacityTest({ path, maxGB }).then((res) => {
      delete progressNodes['capacity:' + path];
      box.innerHTML = '';
      if (!res || res.ok !== true) { box.appendChild(el('p', 'test-err', 'Test failed: ' + ((res && res.error) || 'unknown'))); return; }
      renderCapacity(box, res.data || {});
    }).catch((e) => {
      delete progressNodes['capacity:' + path];
      box.innerHTML = '';
      box.appendChild(el('p', 'test-err', 'Test failed: ' + ((e && e.message) || String(e))));
    }).finally(() => {
      window.TMActivity && window.TMActivity.end('capacity:' + path);
      sib.forEach((b) => (b.disabled = false));
    });
  }

  function renderCapacity(box, d) {
    if (d.error) {
      const map = {
        'is-system': 'The Windows / system drive can’t be fill-tested.',
        'no-free-space': 'No free space to test — free some space or reformat first.',
        'too-small': 'Not enough free space to run a meaningful test.',
        'not-found': 'That drive was not found.',
        'bad-path': 'Invalid drive.',
        'no-path': 'No drive chosen.',
      };
      box.appendChild(el('p', 'test-err', map[d.error] || ('Test error: ' + d.error)));
      return;
    }
    if (d.cancelled) { box.appendChild(el('p', 'muted test-note', 'Test cancelled. Temporary test files were cleaned up.')); return; }
    const cls = d.fake ? 'bad' : 'good';
    const head = el('div', 'test-result test-result--' + cls);
    if (d.fake) {
      head.appendChild(el('strong', null, 'Fake / mis-reporting drive'));
      head.appendChild(el('span', 'muted', '  Reports ' + fmtBytes(d.claimedSizeBytes) + ', but only about ' + fmtBytes(d.realCapacityBytes) + ' is real.'));
    } else {
      head.appendChild(el('strong', null, 'No fakery detected'));
      const full = d.writtenBytes >= d.targetBytes;
      head.appendChild(el('span', 'muted', '  Verified ' + fmtBytes(d.verifiedBytes) + ' written and read back correctly' + (full ? ' across the whole free space.' : ' (partial test).')));
    }
    box.appendChild(head);

    const row = el('div', 'test-speed');
    row.appendChild(metric('Reported size', fmtBytes(d.claimedSizeBytes)));
    row.appendChild(metric('Real capacity', fmtBytes(d.realCapacityBytes), d.fake ? 'bad' : 'good'));
    row.appendChild(metric('Written', fmtBytes(d.writtenBytes)));
    row.appendChild(metric('Verified', fmtBytes(d.verifiedBytes)));
    box.appendChild(row);

    if (d.fake) {
      let why = 'Data read back did not match what was written.';
      if (d.firstBadOffset >= 0) why = 'Verification first failed at ' + fmtBytes(d.firstBadOffset) + ' — beyond this point the drive wrapped around or returned blank data, so that space does not physically exist.';
      else if (d.writeError) why = 'The drive refused further writes well short of its claimed size (' + d.writeError + ').';
      box.appendChild(el('p', 'test-detail', why));
      box.appendChild(el('p', 'muted test-note', 'Recommendation: this drive cannot safely hold its advertised capacity. Reformat it down to the real size, or return/replace it.'));
    } else if (d.writtenBytes < d.targetBytes) {
      box.appendChild(el('p', 'muted test-note', 'Only part of the drive was tested. For full certainty, run again with “Full free space”.'));
    }
    box.appendChild(el('p', 'muted test-note', 'For a reliable verdict the amount tested should exceed this PC’s RAM, so reads come from the device and not the cache.'));
  }

  function driveCard(dr) {
    const m = attrMap(dr);
    const card = el('section', 'drive-card');
    const perf = performancePct(dr, m);

    // Header
    const head = el('div', 'drive-head');
    const title = el('div', 'drive-title');
    title.appendChild(el('h3', null, dr.model || 'Drive ' + dr.number));
    const sub = el('div', 'drive-sub');
    sub.textContent = [dr.mediaType, dr.interface || dr.busType, dr.sizeGB ? dr.sizeGB + ' GB' : '', 'Disk ' + dr.number]
      .filter(Boolean).join('  ·  ');
    title.appendChild(sub);
    head.appendChild(title);

    const ring = el('div', 'drive-health');
    const ringInner = el('div', 'drive-health__inner');
    const pctEl = el('span', 'drive-health__pct', '');
    const labelEl = el('small', null, 'Health');
    ringInner.append(pctEl, labelEl);
    ring.appendChild(ringInner);
    head.appendChild(ring);
    card.appendChild(head);

    // Metric strip (HD Sentinel-style)
    const strip = el('div', 'metric-strip');
    const healthMetric = metric('Health', '', 'warn');
    const healthMetricVal = healthMetric.querySelector('.metric__val');
    strip.appendChild(healthMetric);
    const perfMetric = metric('Performance', perf + '%', healthClass(perf));
    const perfMetricVal = perfMetric.querySelector('.metric__val');
    strip.appendChild(perfMetric);
    const poh = fmtHours(dr.powerOnHours);
    if (poh) strip.appendChild(metric('Power-on time', poh));
    const rem = remainingLife(dr, m);
    if (rem) strip.appendChild(metric('Est. remaining life', rem.text));
    const tbw = lifetimeWrites(dr, m);
    if (tbw) strip.appendChild(metric('Lifetime writes', tbw));
    if (dr.powerCycles != null) strip.appendChild(metric('Power cycles', String(num(dr.powerCycles))));
    card.appendChild(strip);

    // Combined health verdict (SMART + any surface scan), re-evaluated on demand.
    const verdict = el('div', 'drive-verdict');
    card.appendChild(verdict);
    function applyAssess() {
      const a = assess(dr, m);
      ring.className = 'drive-health drive-health--' + a.cls;
      ring.style.setProperty('--pct', a.pct == null ? 0 : a.pct);
      pctEl.textContent = a.pct == null ? '?' : (a.pct + '%');
      labelEl.textContent = a.pct == null ? 'Unknown' : 'Health';
      healthMetric.className = 'metric metric--' + a.cls;
      healthMetricVal.textContent = a.pct == null ? 'Unknown' : (a.pct + '%');
      // Slow regions also drag performance down, so it can't read 100% next to a failing drive.
      const surf = surfaceByDisk[dr.number];
      let pf = perf;
      if (surf) {
        if (surf.maxMs >= 1200 || surf.slow >= 10) pf = Math.min(pf, 40);
        else if (surf.maxMs >= 600 || surf.slow >= 3) pf = Math.min(pf, 65);
        else if (surf.slow >= 1) pf = Math.min(pf, 85);
      }
      pf = Math.max(1, Math.round(pf));
      perfMetric.className = 'metric metric--' + healthClass(pf);
      perfMetricVal.textContent = pf + '%';
      verdict.className = 'drive-verdict drive-verdict--' + a.cls;
      verdict.innerHTML = '';
      const line = el('div', 'drive-verdict__line');
      line.append(el('strong', null, a.label), el('span', 'muted', '  ·  based on ' + a.basis));
      verdict.appendChild(line);
      for (const r of a.reasons) verdict.appendChild(el('p', 'drive-verdict__reason', r));
    }
    cardRefreshers[dr.number] = applyAssess;
    applyAssess();

    if (rem && rem.note) {
      const n = el('p', 'muted drive-estnote', '“Est. remaining life” is a ' + rem.note + '.');
      card.appendChild(n);
    }

    // Gauges
    const gauges = el('div', 'drive-gauges');
    const temp = num(dr.temperatureC);
    if (temp > 0) gauges.appendChild(bar('Temperature', temp, 70, tempClass(temp), temp + ' °C'));
    if (dr.wearPct != null) gauges.appendChild(bar('Life used (SSD wear)', num(dr.wearPct), 100, num(dr.wearPct) >= 80 ? 'bad' : num(dr.wearPct) >= 50 ? 'warn' : 'good', num(dr.wearPct) + '%'));
    if (gauges.children.length) card.appendChild(gauges);

    // Specs
    const specs = el('div', 'kv drive-specs');
    const add = (k, v) => { if (v == null || v === '') return; specs.append(el('div', 'kv__k', k), el('div', 'kv__v', String(v))); };
    add('Serial', dr.serial);
    add('Firmware', dr.firmware);
    add('Interface', dr.interface || dr.busType);
    add('Media', dr.mediaType);
    if (num(dr.spindleSpeed) > 0) add('Spindle', dr.spindleSpeed + ' RPM');
    add('Reported status', dr.health);
    card.appendChild(specs);

    // Tests (surface + capacity). The read/write SPEED test now lives once, in
    // the Storage hub's Disk Tools > Speed sub-tab (it was duplicated here).
    const testWrap = el('div', 'drive-tests');
    const btnRow = el('div', 'drive-tests__btns');
    const resBox = el('div', 'drive-tests__box');
    resBox.hidden = true;
    const bSurface = el('button', 'btn btn--ghost btn--sm', 'Surface test');
    const bCap = el('button', 'btn btn--ghost btn--sm', 'Capacity test');
    bSurface.type = 'button'; bCap.type = 'button';
    bSurface.addEventListener('click', () => runTest(dr, 'surface', bSurface, resBox));
    bCap.addEventListener('click', () => startCapacityUI(dr, bCap, resBox));
    btnRow.append(bSurface, bCap);
    testWrap.append(btnRow, resBox);
    card.appendChild(testWrap);

    // SMART / NVMe detail
    const nt = nvmeTable(dr);
    const st = smartTable(dr);
    if (nt) {
      card.appendChild(el('h4', 'info-sub', 'NVMe health log'));
      card.appendChild(nt);
    } else if (st) {
      card.appendChild(el('h4', 'info-sub', 'SMART attributes'));
      card.appendChild(st);
    } else {
      const note = el('p', 'muted');
      note.style.fontSize = '12px';
      note.textContent = (dr.smartSource === 'reliability-counter' || dr.smartSource === 'none')
        ? 'Full SMART could not be read directly — run as administrator (and note USB-bridged drives often block SMART). Health is from the Windows reliability counters and the drive’s reported status only.'
        : 'No detailed SMART attributes were returned for this drive.';
      card.appendChild(note);
    }
    // Data-source line, so it is clear where the numbers came from.
    const src = el('p', 'muted drive-source', 'SMART source: ' + (SOURCE_LABEL[dr.smartSource] || dr.smartSource || 'unknown'));
    card.appendChild(src);

    // Volumes
    const vols = arr(dr.volumes);
    if (vols.length) {
      card.appendChild(el('h4', 'info-sub', 'Volumes'));
      for (const v of vols) {
        const pct = v.sizeGB ? (1 - v.freeGB / v.sizeGB) * 100 : 0;
        card.appendChild(bar(`${v.drive} ${v.label || ''}`.trim(), pct, 100, pct >= 90 ? 'bad' : pct >= 85 ? 'warn' : 'good', `${v.freeGB} GB free of ${v.sizeGB} GB`));
      }
    }

    return card;
  }

  function buildSyncroHtml() {
    const e = window.tmEsc || ((s) => s);
    const ds = lastDrives;
    if (!ds.length) return '';
    const out = ['<p><strong>TM Toolset — Drive Health</strong><br>' + e(new Date().toLocaleString()) + '</p>'];
    for (const dr of ds) {
      const m = attrMap(dr);
      const h = healthPct(dr, m), perf = performancePct(dr, m);
      out.push('<p><strong>' + e(dr.model || ('Disk ' + dr.number)) + '</strong> — ' +
        [dr.mediaType, dr.interface || dr.busType, dr.sizeGB ? dr.sizeGB + ' GB' : ''].filter(Boolean).map(e).join(' · ') + '<br>' +
        'Health <strong>' + h + '%</strong> · Performance ' + perf + '%' +
        (dr.temperatureC != null ? ' · ' + e(dr.temperatureC) + ' °C' : '') +
        (dr.powerOnHours != null ? ' · ' + e(dr.powerOnHours) + ' h on' : '') +
        (dr.wearPct != null ? ' · wear ' + e(dr.wearPct) + '%' : '') +
        '<br><em>SMART source:</em> ' + e(dr.smartSource || 'n/a') + '</p>');
    }
    out.push('<p><em>Generated by TM Toolset · Technical Merritt Computer Services</em></p>');
    return out.join('\n');
  }

  function render(ds) {
    lastDrives = ds;
    els.status.hidden = true;
    els.error.hidden = true;
    els.list.hidden = false;
    els.list.innerHTML = '';
    if (!ds.length) {
      els.list.appendChild(el('p', 'muted', 'No drives detected.'));
      return;
    }
    const note = el('p', 'muted drives-note');
    note.textContent = 'SMART is read directly from each drive (ATA pass-through / NVMe health log), the same way smartctl does — run as administrator for this. Health and Performance are TM Toolset’s own weightings of those live values; another tool may weight them differently, but the raw numbers on each card are the drive’s own.';
    els.list.appendChild(note);
    for (const dr of ds) els.list.appendChild(driveCard(dr));
  }

  // Expose the health calc so the Overview tab can reuse it.
  window.tmDriveHealth = (dr) => healthPct(dr, attrMap(dr));

  window.addEventListener('DOMContentLoaded', () => {
    els.status = $('#drivesStatus');
    els.error = $('#drivesError');
    els.errorDetail = $('#drivesErrorDetail');
    els.list = $('#drivesList');
    els.refresh = $('#drivesRefresh');
    els.syncro = $('#drivesSyncro');
    if (!els.list) return;
    els.refresh && els.refresh.addEventListener('click', load);
    els.syncro && els.syncro.addEventListener('click', () => {
      if (!loaded) { load().then(() => window.tmSyncroPost(els.syncro, 'TM Toolset — Drive Health', buildSyncroHtml())); }
      else window.tmSyncroPost(els.syncro, 'TM Toolset — Drive Health', buildSyncroHtml());
    });
    if (window.drives && window.drives.onTestProgress) {
      window.drives.onTestProgress((p) => {
        const key = p.kind === 'capacity' ? ('capacity:' + (p.path || '')) : (p.disk + ':' + p.kind);
        const node = progressNodes[key];
        if (node) node.textContent = p.msg;
        window.TMActivity && window.TMActivity.update(key, p.msg);
      });
    }
    // Loaded lazily when the Storage hub shows the Drive Health sub-tab.
    window.addEventListener('tm-storage-show', (e) => { if (e.detail === 'health' && !loaded) load(); });
  });
})();
