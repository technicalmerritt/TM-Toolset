'use strict';

// BIOS / UEFI firmware bench: system info, dump reader, ME cleaner, firmware
// finder, and Xgpro (XGecu T76) launcher.
(function () {
  const els = {};
  let loadedOnce = false;
  let sysInfo = null;
  let dumpPath = '';
  let busy = false;
  let extractBusy = false;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('toast--show'); setTimeout(() => t.classList.remove('toast--show'), 3200); }
  function fmtBytes(b) { b = Number(b) || 0; if (b <= 0) return '0'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0, v = b; while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i]; }

  // ---------- this system ----------
  function loadSys() {
    els.sysBusy.hidden = false;
    els.sysCard.hidden = true;
    return window.bios.info().then((res) => {
      els.sysBusy.hidden = true;
      if (!res || !res.ok) { els.sysCard.hidden = false; els.sysCard.innerHTML = ''; els.sysCard.appendChild(el('p', 'muted', 'Could not read firmware info.')); return; }
      sysInfo = res.data || {};
      renderSys(sysInfo);
      prefillSearch();
    }).catch(() => { els.sysBusy.hidden = true; });
  }
  function renderSys(d) {
    els.sysCard.hidden = false;
    els.sysCard.innerHTML = '';
    const add = (k, v) => { if (v == null || v === '') return; els.sysCard.append(el('div', 'kv__k', k), el('div', 'kv__v', String(v))); };
    add('System', [d.sysVendor, d.sysModel].filter(Boolean).join(' '));
    add('Baseboard', [d.boardVendor, d.boardProduct].filter(Boolean).join(' '));
    add('Board serial', d.boardSerial);
    add('BIOS vendor', d.biosVendor);
    add('BIOS version', d.biosVersion);
    add('BIOS date', d.biosDate);
    add('System serial', d.biosSerial);
    add('UUID', d.uuid);
    add('Firmware type', d.firmwareType);
    add('Secure Boot', d.secureBoot);
    if (d.tpmPresent) add('TPM', (d.tpmVersion || '') + (d.tpmEnabled ? ' (enabled)' : ' (present)'));
    else add('TPM', 'Not detected');
  }

  // ---------- read a dump ----------
  function readDump() {
    if (!dumpPath) return;
    els.report.hidden = false;
    els.report.innerHTML = '';
    els.report.appendChild(el('p', 'muted', 'Reading…'));
    els.mePanel.hidden = true;
    els.uefiActions.hidden = true;
    els.uefiReportBox.hidden = true;
    window.bios.analyze(dumpPath).then((res) => {
      const data = (res && res.data) || {};
      if (!res || !res.ok || !data.parse || data.parse.ok !== true) { els.report.innerHTML = ''; els.report.appendChild(el('p', 'test-err', 'Could not read: ' + ((res && res.error) || 'error'))); return; }
      renderReport(data);
    }).catch((e) => { els.report.innerHTML = ''; els.report.appendChild(el('p', 'test-err', 'Could not read: ' + ((e && e.message) || e))); });
  }
  function renderReport(result) {
    const d = result.parse || {};
    const a = result.advice || {};
    els.report.innerHTML = '';

    // verdict + confidence
    if (a.verdict) {
      const v = el('div', 'bios-verdict bios-verdict--' + a.verdict.cls);
      v.appendChild(el('div', 'bios-verdict__txt', a.verdict.text));
      const meter = el('div', 'bios-conf');
      meter.appendChild(el('span', 'bios-conf__lbl', 'Confidence'));
      const track = el('div', 'bios-conf__track'); const fill = el('div', 'bios-conf__fill'); fill.style.width = (a.verdict.confidence || 0) + '%'; track.appendChild(fill);
      meter.append(track, el('span', 'bios-conf__pct', (a.verdict.confidence || 0) + '%'));
      v.appendChild(meter);
      els.report.appendChild(v);
    }

    // Consolidated actions — everything you'd do next, in one place.
    const bar = el('div', 'bios-actions');
    const act = (label, cls, fn) => { const b = el('button', 'btn btn--sm ' + (cls || 'btn--ghost'), label); b.type = 'button'; b.addEventListener('click', fn); bar.appendChild(b); };
    if (a.search && a.search.query) act('Find a clean BIOS', 'btn--primary', () => { showSub('get'); if (els.searchQ) els.searchQ.value = a.search.query; searchBadcaps(); if (a.search.note) toast(a.search.note); });
    act('Save identity to Vault', 'btn--primary', () => saveDumpIdentity(d.identity));
    if (d.me && d.me.present) act('Clean ME region', 'btn--ghost', () => { els.mePanel.hidden = false; els.mePanel.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    act('Open in UEFITool', 'btn--ghost', () => window.bios.openUefiTool(dumpPath).then((r) => { if (!r || !r.ok) toast('Could not open UEFITool.'); }));
    act('Full UEFI report', 'btn--ghost', uefiReport);
    els.report.appendChild(bar);

    // Identity read straight from this dump.
    if (d.identity && (d.identity.vendor || d.identity.model || d.identity.mac)) {
      els.report.appendChild(el('h4', 'info-sub', 'Identity read from this dump'));
      const box = el('div', 'net-kv');
      const addk = (k, val) => { if (val) box.append(el('div', 'kv__k', k), el('div', 'kv__v bk-mono', val)); };
      addk('Vendor', d.identity.vendor);
      addk('Model (best guess)', d.identity.model);
      addk('Onboard NIC MAC', d.identity.mac);
      els.report.appendChild(box);
      els.report.appendChild(el('p', 'muted bk-note', 'Serial/UUID usually aren’t stored in the firmware image (they live in a protected area), so grab those from the live machine if you need them. "Save identity to Vault" stores what’s here, tagged with the ticket in the top bar if one is loaded.'));
    }

    // findings
    if (a.findings && a.findings.length) {
      els.report.appendChild(el('h4', 'info-sub', 'What I found'));
      const list = el('div', 'bios-findings');
      for (const f of a.findings) {
        const row = el('div', 'bios-finding bios-finding--' + f.sev);
        const head = el('div', 'bios-finding__head');
        head.append(el('span', 'bios-finding__title', f.title), el('span', 'bios-finding__conf', f.confidence + '%'));
        row.appendChild(head);
        row.appendChild(el('div', 'bios-finding__detail muted', f.detail));
        if (f.action) row.appendChild(el('div', 'bios-finding__action', '→ ' + f.action));
        list.appendChild(row);
      }
      els.report.appendChild(list);
    }

    // guided next steps
    if (a.nextSteps && a.nextSteps.length) {
      els.report.appendChild(el('h4', 'info-sub', 'What to do next'));
      const ol = el('ol', 'bios-steps');
      for (const s of a.nextSteps) ol.appendChild(el('li', null, s));
      els.report.appendChild(ol);
    }

    // technical details
    els.report.appendChild(el('h4', 'info-sub', 'Technical details'));
    if (d.summary && d.summary.length) {
      const ul = el('ul', 'bios-bullets');
      for (const line of d.summary) ul.appendChild(el('li', null, line));
      els.report.appendChild(ul);
    }

    // regions
    if (d.descriptor && d.descriptor.present) {
      const t = el('table', 'bk-ptable');
      const head = el('tr'); ['Region', 'Present', 'Offset', 'Size'].forEach((h) => head.appendChild(el('th', null, h))); t.appendChild(head);
      for (const r of d.descriptor.regions) {
        const tr = el('tr');
        tr.appendChild(el('td', null, r.name));
        tr.appendChild(el('td', null, r.present ? 'yes' : '—'));
        tr.appendChild(el('td', 'bk-mono', r.present ? ('0x' + r.base.toString(16)) : '—'));
        tr.appendChild(el('td', null, r.present ? fmtBytes((r.limit - r.base + 1)) : '—'));
        t.appendChild(tr);
      }
      els.report.appendChild(el('h4', 'info-sub', 'Flash regions'));
      els.report.appendChild(t);
    }

    // ME partitions
    if (d.me && d.me.present && d.me.partitions && d.me.partitions.length) {
      els.report.appendChild(el('h4', 'info-sub', 'Intel ME partitions'));
      els.report.appendChild(el('p', 'bk-mono', d.me.partitions.join('  ')));
    }

    // strings
    if (d.strings && d.strings.length) {
      els.report.appendChild(el('h4', 'info-sub', 'Readable identity strings (best-effort)'));
      const box = el('div', 'bios-strings');
      for (const s of d.strings) box.appendChild(el('div', null, s));
      els.report.appendChild(box);
    }

    // (old static action row is superseded by the consolidated actions bar)
    els.uefiActions.hidden = true;
    els.uefiReportBox.hidden = true;
    // reveal the ME cleaner panel below if there is an ME region
    els.mePanel.hidden = !(d.me && d.me.present);
  }

  function saveDumpIdentity(identity) {
    if (!identity || (!identity.vendor && !identity.model && !identity.mac)) { toast('No identity could be read from this dump.'); return; }
    const tkEl = document.getElementById('ticketInput');
    const tk = (tkEl && tkEl.value) ? tkEl.value.trim() : '';
    window.bios.identitySave(identity, tk).then((res) => {
      if (res && res.ok) { toast('Identity saved to the Vault' + (tk ? ' (ticket ' + tk + ')' : '') + '.'); if (els.vaultList) els.vaultList.dataset.loaded = ''; }
      else toast('Save failed: ' + ((res && res.error) || 'error'));
    }).catch((e) => toast('Save failed: ' + ((e && e.message) || e)));
  }

  function uefiReport() {
    if (!dumpPath) return;
    els.uefiReportBox.hidden = false;
    els.uefiReportBox.textContent = 'Generating full firmware report (UEFIExtract)…';
    window.bios.uefiReport(dumpPath).then((res) => {
      if (!res || !res.ok) { els.uefiReportBox.textContent = 'Report failed: ' + ((res && res.error) === 'tool-missing' ? 'UEFIExtract missing from the app.' : ((res && res.error) || 'error')); return; }
      els.uefiReportBox.textContent = (res.report || '(empty report)') + (res.truncated ? '\n\n… (report truncated for display — full copy saved next to the dump as .report.txt)' : '');
      els.uefiReportBox.scrollTop = 0;
    }).catch((e) => { els.uefiReportBox.textContent = 'Report failed: ' + ((e && e.message) || e); });
  }

  function cleanME() {
    if (busy) { toast('Something is already running.'); return; }
    if (!dumpPath) { toast('Open a dump first.'); return; }
    busy = true;
    els.meRunner.hidden = false;
    els.meLog.textContent = '';
    els.meState.textContent = 'Running…';
    els.meState.className = 'repairs-state repairs-state--run';
    appendMe('Cleaning ME region…');
    window.bios.cleanME({ path: dumpPath, truncate: els.meTrunc.checked, relocate: els.meReloc.checked }).then((res) => {
      if (!res || !res.ok) {
        els.meState.textContent = 'Failed'; els.meState.className = 'repairs-state repairs-state--bad';
        appendMe('\n[error] ' + ((res && res.error) === 'tool-missing' ? 'me_cleaner/Python missing from the app.' : ((res && res.error) || 'failed')));
        if (res && res.log) appendMe(res.log);
        return;
      }
      els.meState.textContent = 'Done'; els.meState.className = 'repairs-state repairs-state--good';
      appendMe('\nSaved cleaned image:\n' + res.out + '\n\nFlash this with Xgpro on your T76.');
    }).catch((e) => { els.meState.textContent = 'Failed'; els.meState.className = 'repairs-state repairs-state--bad'; appendMe('\n[error] ' + ((e && e.message) || e)); })
      .finally(() => { busy = false; });
  }
  function appendMe(line) { els.meLog.textContent += String(line).replace(/\s+$/, '') + '\n'; els.meLog.scrollTop = els.meLog.scrollHeight; }

  // ---------- get firmware ----------
  function prefillSearch() {
    if (!sysInfo || !els.searchQ || els.searchQ.value) return;
    const q = [sysInfo.boardVendor || sysInfo.sysVendor, sysInfo.boardProduct || sysInfo.sysModel, 'bios'].filter(Boolean).join(' ');
    els.searchQ.value = q;
    if (els.modelLine) els.modelLine.textContent = 'Detected: ' + ([sysInfo.sysVendor, sysInfo.sysModel].filter(Boolean).join(' ') || 'unknown') + '. Search by board/model — your Bad Caps membership lets you open the threads it finds.';
  }
  function searchBadcaps() {
    const q = els.searchQ.value.trim(); if (!q) { toast('Type something to search.'); return; }
    window.sys.openUrl('https://www.google.com/search?q=' + encodeURIComponent('site:badcaps.net ' + q));
  }
  function searchWeb() {
    const q = els.searchQ.value.trim(); if (!q) { toast('Type something to search.'); return; }
    window.sys.openUrl('https://www.google.com/search?q=' + encodeURIComponent(q + ' bios bin download'));
  }
  function extractPackage() {
    if (extractBusy) { toast('An extraction is already running.'); return; }
    extractBusy = true;
    els.extractList.innerHTML = '';
    els.extractOpen.hidden = true;
    els.extractLog.hidden = false;
    els.extractLog.textContent = 'Choose a file…';
    window.bios.extractPackage().then((res) => {
      if (res && res.cancelled) { els.extractLog.hidden = true; return; }
      if (!res || !res.ok) { els.extractLog.textContent += '\n[error] ' + ((res && res.error) === 'tool-missing' ? '7za missing from the app.' : ((res && res.error) || 'failed')); return; }
      els.extractOpen.hidden = false;
      const files = res.files || [];
      if (!files.length) { els.extractList.appendChild(el('p', 'muted', 'No firmware image found inside. Some installers (InstallShield/encrypted) can’t be unpacked this way — try the vendor’s own extract option, or open the package manually.')); return; }
      els.extractList.appendChild(el('h4', 'info-sub', 'Firmware found'));
      for (const f of files) {
        const row = el('div', 'drv-pkg');
        const info = el('div', 'drv-pkg__info');
        info.appendChild(el('span', 'drv-pkg__prov', f.name));
        info.appendChild(el('span', 'muted drv-pkg__meta', fmtBytes(f.size)));
        row.appendChild(info);
        const an = el('button', 'btn btn--primary btn--sm', 'Analyze');
        an.type = 'button';
        an.addEventListener('click', () => { dumpPath = f.path; els.dumpPath.value = f.path; els.dumpGo.disabled = false; showSub('dump'); readDump(); });
        row.appendChild(an);
        els.extractList.appendChild(row);
      }
    }).catch((e) => { els.extractLog.textContent += '\n[error] ' + ((e && e.message) || e); })
      .finally(() => { extractBusy = false; });
  }

  // ---------- identity vault ----------
  function loadVault() {
    window.bios.identityList().then((res) => {
      els.vaultList.innerHTML = '';
      const cards = (res && res.ok && res.cards) || [];
      if (!cards.length) { els.vaultList.appendChild(el('p', 'muted', 'No identity cards saved yet. Click “Capture this PC”.')); return; }
      for (const c of cards) els.vaultList.appendChild(renderVaultCard(c));
    }).catch(() => {});
  }
  function kvRow(k, v) { const r = el('div', 'bios-id__row'); r.append(el('span', 'bios-id__k', k), el('span', 'bios-id__v bk-mono', v || '—')); return r; }
  function renderVaultCard(c) {
    const card = el('div', 'drv-panel bios-id');
    const head = el('div', 'bios-id__head');
    head.appendChild(el('strong', null, [c.sysVendor, c.sysModel].filter(Boolean).join(' ') || 'Identity card'));
    if (c.ticket) head.appendChild(el('span', 'bios-id__ticket', c.ticket));
    head.appendChild(el('span', 'muted bios-id__date', (c.captured || '').replace('T', ' ')));
    card.appendChild(head);
    card.appendChild(kvRow('System serial', c.systemSerial));
    card.appendChild(kvRow('UUID', c.uuid));
    card.appendChild(kvRow('Baseboard', [c.boardVendor, c.boardProduct].filter(Boolean).join(' ')));
    card.appendChild(kvRow('Board serial', c.boardSerial));
    if (c.assetTag) card.appendChild(kvRow('Asset tag', c.assetTag));
    for (const m of (c.macs || [])) card.appendChild(kvRow('MAC — ' + (m.name || m.desc || 'NIC'), m.mac));
    const acts = el('div', 'bk-actions');
    const post = el('button', 'btn btn--ghost btn--sm', 'Post to Syncro ticket');
    post.type = 'button';
    post.addEventListener('click', () => {
      if (window.tmSyncroPost) window.tmSyncroPost(post, 'TM Toolset — Board Identity', cardSyncroHtml(c));
      else toast('Syncro posting is not available.');
    });
    const del = el('button', 'btn btn--ghost btn--sm btn--danger', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => { if (window.confirm('Delete this identity card?')) window.bios.identityDelete(c._file).then(() => loadVault()); });
    acts.append(post, del);
    card.appendChild(acts);
    return card;
  }
  function cardSyncroHtml(c) {
    const e = window.tmEsc || ((s) => ('' + s));
    const rows = [];
    const add = (k, v) => { if (v) rows.push('<li><strong>' + e(k) + ':</strong> ' + e(v) + '</li>'); };
    add('System', [c.sysVendor, c.sysModel].filter(Boolean).join(' '));
    add('System serial', c.systemSerial); add('UUID', c.uuid);
    add('Baseboard', [c.boardVendor, c.boardProduct].filter(Boolean).join(' ')); add('Board serial', c.boardSerial);
    add('Asset tag', c.assetTag); add('BIOS version', c.biosVersion);
    let macs = '';
    for (const m of (c.macs || [])) macs += '<li>' + e(m.name || m.desc || 'NIC') + ': ' + e(m.mac) + '</li>';
    return '<p><strong>TM Toolset - Board Identity</strong>' + (c.ticket ? (' (' + e(c.ticket) + ')') : '') + '<br>' + e(c.captured || '') + '</p><ul>' + rows.join('') + '</ul>' + (macs ? ('<p><strong>NIC MAC(s):</strong></p><ul>' + macs + '</ul>') : '');
  }
  function captureVault() {
    const note = els.vaultNote.value.trim();
    window.bios.identityCapture(note).then((res) => {
      if (res && res.ok) { toast('Identity captured.'); els.vaultNote.value = ''; loadVault(); }
      else toast('Capture failed: ' + ((res && res.error) || 'error'));
    }).catch((e) => toast('Capture failed: ' + ((e && e.message) || e)));
  }

  // ---------- compare / pre-flash ----------
  let diffA = '', diffB = '', pfT = '', pfC = '';
  function runDiff() {
    if (!diffA || !diffB) { toast('Choose both files.'); return; }
    els.diffResult.innerHTML = ''; els.diffResult.appendChild(el('p', 'muted', 'Comparing…'));
    window.bios.diff(diffA, diffB).then((res) => {
      const d = (res && res.data) || {}; els.diffResult.innerHTML = '';
      if (!res || !res.ok || d.ok !== true) { els.diffResult.appendChild(el('p', 'test-err', 'Compare failed: ' + ((res && res.error) || 'error'))); return; }
      const v = el('div', 'bios-verdict bios-verdict--' + (d.identical ? 'good' : 'warn'));
      v.appendChild(el('div', 'bios-verdict__txt', d.identical ? 'Identical — no differences.' : (d.diffPct + '% of bytes differ across ' + d.rangeCount + ' region(s)')));
      els.diffResult.appendChild(v);
      const ul = el('ul', 'bios-bullets'); for (const s of (d.summary || [])) ul.appendChild(el('li', null, s)); els.diffResult.appendChild(ul);
    }).catch((e) => { els.diffResult.innerHTML = ''; els.diffResult.appendChild(el('p', 'test-err', 'Compare failed: ' + ((e && e.message) || e))); });
  }
  function runPreflight() {
    if (!pfT || !pfC) { toast('Choose target and candidate.'); return; }
    els.pfResult.innerHTML = ''; els.pfResult.appendChild(el('p', 'muted', 'Checking…'));
    window.bios.preflight(pfT, pfC).then((res) => {
      const d = (res && res.data) || {}; els.pfResult.innerHTML = '';
      if (!res || !res.ok || d.ok !== true) { els.pfResult.appendChild(el('p', 'test-err', 'Check failed: ' + ((res && res.error) || 'error'))); return; }
      const v = el('div', 'bios-verdict bios-verdict--' + d.cls);
      v.appendChild(el('div', 'bios-verdict__txt', d.verdict));
      els.pfResult.appendChild(v);
      const list = el('div', 'bios-findings');
      for (const c of (d.checks || [])) { const row = el('div', 'bios-finding bios-finding--' + c.sev); row.appendChild(el('div', 'bios-finding__detail', c.msg)); list.appendChild(row); }
      els.pfResult.appendChild(list);
    }).catch((e) => { els.pfResult.innerHTML = ''; els.pfResult.appendChild(el('p', 'test-err', 'Check failed: ' + ((e && e.message) || e))); });
  }

  // ---------- BitLocker guard ----------
  let blData = null;
  function runBitlocker() {
    els.blResult.innerHTML = ''; els.blResult.appendChild(el('p', 'muted', 'Checking BitLocker…'));
    window.bios.bitlocker().then((res) => {
      const d = (res && res.data) || {}; els.blResult.innerHTML = '';
      if (!res || !res.ok || d.ok !== true) { els.blResult.appendChild(el('p', 'test-err', 'BitLocker check failed.')); return; }
      blData = d;
      if (!d.supported) { els.blResult.appendChild(el('p', 'muted', 'BitLocker is not available on this edition of Windows.')); return; }
      const vols = d.volumes || [];
      if (d.anyEncrypted) {
        const warn = el('div', 'net-warn net-warn--warn');
        const body = el('div', 'net-warn__body');
        body.appendChild(el('div', 'net-warn__title', '⚠ This machine is encrypted — save the recovery key BEFORE any BIOS / TPM / firmware change.'));
        warn.appendChild(body);
        els.blResult.appendChild(warn);
      }
      if (!vols.length) { els.blResult.appendChild(el('p', 'muted', 'No BitLocker volumes found.')); }
      for (const vv of vols) {
        const on = vv.protection === 'On';
        const card = el('div', 'drv-panel bios-id');
        const head = el('div', 'bios-id__head'); head.appendChild(el('strong', null, (vv.mount || '?') + ' — ' + (on ? 'Protected (ON)' : 'Off'))); card.appendChild(head);
        card.appendChild(kvRow('Status', vv.status));
        card.appendChild(kvRow('Encryption', (vv.method || '') + ' ' + (vv.encPct != null ? vv.encPct + '%' : '')));
        if (vv.keys && vv.keys.length) for (const k of vv.keys) card.appendChild(kvRow('Recovery key', k.password));
        else if (on) card.appendChild(el('p', 'muted bk-note', d.isAdmin ? 'No recovery-password protector on this volume.' : 'Run as administrator to read the recovery key.'));
        els.blResult.appendChild(card);
      }
      const hasKeys = vols.some((x) => x.keys && x.keys.length);
      els.blSave.hidden = !hasKeys; els.blSyncro.hidden = !hasKeys;
    }).catch(() => { els.blResult.innerHTML = ''; els.blResult.appendChild(el('p', 'test-err', 'BitLocker check failed.')); });
  }
  function bitlockerText() {
    if (!blData) return '';
    let t = 'TM Toolset - BitLocker recovery keys\n' + (new Date().toLocaleString()) + '\n\n';
    for (const vv of (blData.volumes || [])) { t += (vv.mount || '?') + '  [' + vv.protection + ']\n'; for (const k of (vv.keys || [])) { t += '  ID  ' + k.id + '\n  KEY ' + k.password + '\n'; } t += '\n'; }
    return t;
  }
  function bitlockerHtml() {
    const e = window.tmEsc || ((s) => ('' + s));
    let h = '<p><strong>TM Toolset - BitLocker recovery keys</strong><br>' + e(new Date().toLocaleString()) + '</p>';
    for (const vv of ((blData && blData.volumes) || [])) {
      h += '<p><strong>' + e(vv.mount || '?') + '</strong> [' + e(vv.protection) + ']</p><ul>';
      for (const k of (vv.keys || [])) h += '<li>ID ' + e(k.id) + '<br>KEY ' + e(k.password) + '</li>';
      h += '</ul>';
    }
    return h;
  }

  // ---------- SPI chip helper ----------
  function parseSpi(raw) {
    const s = (raw || '').toUpperCase().replace(/\s+/g, '');
    const vendors = [['W25', 'Winbond'], ['MX25', 'Macronix'], ['GD25', 'GigaDevice'], ['EN25', 'Eon'], ['S25FL', 'Spansion/Cypress'], ['N25Q', 'Micron'], ['MT25', 'Micron'], ['AT25', 'Adesto/Atmel'], ['AT26', 'Adesto/Atmel'], ['IS25', 'ISSI'], ['XM25', 'Wuhan XMC'], ['BY25', 'Boya'], ['ZB25', 'Zbit'], ['25', 'Generic 25-series']];
    let vendor = 'Unknown'; for (const [p, n] of vendors) { if (s.indexOf(p) >= 0) { vendor = n; break; } }
    const dmap = { 512: '512 Mbit = 64 MB', 256: '256 Mbit = 32 MB', 128: '128 Mbit = 16 MB', 64: '64 Mbit = 8 MB', 32: '32 Mbit = 4 MB', 16: '16 Mbit = 2 MB', 80: '8 Mbit = 1 MB', 40: '4 Mbit = 512 KB', 20: '2 Mbit = 256 KB' };
    let cap = 'Unknown — check the datasheet / Xgpro chip ID';
    for (const code of [512, 256, 128, 64, 32, 16, 80, 40, 20]) { if (s.indexOf('' + code) >= 0) { cap = dmap[code]; break; } }
    let voltage = '3.3 V (standard) — verify against the datasheet';
    if (/MX25U/.test(s) || /25U/.test(s) || /FW$|JW$|FW\d|1V8|18V/.test(s)) voltage = '1.8 V — use a 1.8 V adapter, NOT 3.3 V, or you can damage the chip/board';
    const note = '25-series SPI NOR flash. On the T76 use the matching 25xx SOIC-8 / WSON clip or socket. In-circuit: disconnect power first; if reads are unstable, desolder and read in the socket.';
    return { vendor, cap, voltage, note };
  }
  function spiIdentify() {
    const v = (els.spiInput.value || '').trim();
    if (!v) { toast('Type a chip marking.'); return; }
    const r = parseSpi(v);
    els.spiResult.hidden = false; els.spiResult.innerHTML = '';
    const add = (k, val) => { els.spiResult.append(el('div', 'kv__k', k), el('div', 'kv__v', val)); };
    add('Vendor', r.vendor); add('Capacity', r.cap); add('Voltage', r.voltage); add('Approach', r.note);
  }

  // ---------- sub-nav ----------
  function showSub(name) {
    for (const b of document.querySelectorAll('#panel-bios .subtab')) b.classList.toggle('subtab--active', b.dataset.bbsub === name);
    const map = { sys: 'bios-sys', dump: 'bios-dump', compare: 'bios-compare', get: 'bios-get', tools: 'bios-tools', vault: 'bios-vault', safeguards: 'bios-safeguards', guide: 'bios-guide' };
    for (const k of Object.keys(map)) { const s = document.getElementById(map[k]); if (s) s.hidden = k !== name; }
    if (name === 'get' && !sysInfo) loadSys();
    if (name === 'tools' && !els.xgproPath.dataset.loaded) { els.xgproPath.dataset.loaded = '1'; window.bios.getXgpro().then((r) => { if (r && r.exe) els.xgproPath.value = r.exe; }); }
    if (name === 'vault' && !els.vaultList.dataset.loaded) { els.vaultList.dataset.loaded = '1'; loadVault(); }
  }

  function wire() {
    els.sysBusy = $('#biosSysBusy'); els.sysCard = $('#biosSysCard');
    els.dumpPath = $('#biosDumpPath'); els.dumpGo = $('#biosDumpGo'); els.report = $('#biosReport');
    els.mePanel = $('#biosMePanel'); els.meTrunc = $('#biosMeTrunc'); els.meReloc = $('#biosMeReloc');
    els.meRunner = $('#biosMeRunner'); els.meState = $('#biosMeState'); els.meLog = $('#biosMeLog');
    els.searchQ = $('#biosSearchQ'); els.modelLine = $('#biosModelLine');
    els.xgproPath = $('#biosXgproPath');
    els.uefiActions = $('#biosUefiActions'); els.uefiReportBox = $('#biosUefiReportBox');
    els.vaultNote = $('#vaultNote'); els.vaultList = $('#vaultList');
    els.extractGo = $('#biosExtractGo'); els.extractOpen = $('#biosExtractOpen'); els.extractLog = $('#biosExtractLog'); els.extractList = $('#biosExtractList');
    els.diffA = $('#diffA'); els.diffB = $('#diffB'); els.diffResult = $('#diffResult');
    els.pfTarget = $('#pfTarget'); els.pfCand = $('#pfCand'); els.pfResult = $('#pfResult');
    els.blResult = $('#blResult'); els.blSave = $('#blSave'); els.blSyncro = $('#blSyncro');
    els.spiInput = $('#spiInput'); els.spiResult = $('#spiResult');
    if (!els.sysCard) return;

    for (const b of document.querySelectorAll('#panel-bios .subtab')) b.addEventListener('click', () => showSub(b.dataset.bbsub));
    $('#biosDumpPick').addEventListener('click', () => window.bios.pickDump().then((p) => { if (p) { dumpPath = p; els.dumpPath.value = p; els.dumpGo.disabled = false; } }));
    $('#biosDumpGo').addEventListener('click', readDump);
    $('#biosMeGo').addEventListener('click', cleanME);
    $('#biosUefiReport').addEventListener('click', uefiReport);
    $('#biosUefiOpen').addEventListener('click', () => window.bios.openUefiTool(dumpPath).then((r) => { if (!r || !r.ok) toast('Could not open UEFITool.'); }));
    $('#biosUefiOpenBlank').addEventListener('click', () => window.bios.openUefiTool('').then((r) => { if (!r || !r.ok) toast('Could not open UEFITool.'); }));
    $('#biosSearchBadcaps').addEventListener('click', searchBadcaps);
    $('#biosSearchWeb').addEventListener('click', searchWeb);
    els.searchQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchBadcaps(); });
    $('#biosExtractGo').addEventListener('click', extractPackage);
    $('#biosExtractOpen').addEventListener('click', () => window.bios.openFirmwareDir());
    $('#biosImport').addEventListener('click', () => window.bios.importFirmware().then((r) => { if (r && r.ok) toast('Added to library.'); else if (r && !r.cancelled) toast('Import failed.'); }));
    $('#biosOpenLib').addEventListener('click', () => window.bios.openFirmwareDir());
    $('#diffPickA').addEventListener('click', () => window.bios.pickDump().then((p) => { if (p) { diffA = p; els.diffA.value = p; } }));
    $('#diffPickB').addEventListener('click', () => window.bios.pickDump().then((p) => { if (p) { diffB = p; els.diffB.value = p; } }));
    $('#diffGo').addEventListener('click', runDiff);
    $('#pfPickT').addEventListener('click', () => window.bios.pickDump().then((p) => { if (p) { pfT = p; els.pfTarget.value = p; } }));
    $('#pfPickC').addEventListener('click', () => window.bios.pickDump().then((p) => { if (p) { pfC = p; els.pfCand.value = p; } }));
    $('#pfGo').addEventListener('click', runPreflight);
    $('#blGo').addEventListener('click', runBitlocker);
    $('#blSave').addEventListener('click', () => window.bios.saveText('BitLocker-recovery-keys', bitlockerText()).then((r) => { if (r && r.ok) toast('Saved.'); }));
    $('#blSyncro').addEventListener('click', () => { if (window.tmSyncroPost) window.tmSyncroPost($('#blSyncro'), 'TM Toolset — BitLocker recovery keys', bitlockerHtml()); else toast('Syncro not available.'); });
    $('#spiGo').addEventListener('click', spiIdentify);
    els.spiInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') spiIdentify(); });
    $('#vaultCapture').addEventListener('click', captureVault);
    $('#vaultOpenDir').addEventListener('click', () => window.bios.identityOpenDir());
    $('#biosXgproLocate').addEventListener('click', () => window.bios.pickXgpro().then((p) => { if (p) els.xgproPath.value = p; }));
    $('#biosXgproLaunch').addEventListener('click', () => window.bios.launchXgpro().then((r) => { if (!r || !r.ok) toast(r && r.error === 'not-found' ? 'Locate Xgpro.exe first.' : 'Could not launch Xgpro.'); }));
    for (const b of document.querySelectorAll('#panel-bios [data-openurl]')) b.addEventListener('click', () => window.sys && window.sys.openUrl(b.dataset.openurl));

    if (window.bios.onProgress) window.bios.onProgress((msg) => {
      if (extractBusy && els.extractLog) { els.extractLog.textContent += String(msg).replace(/\s+$/, '') + '\n'; els.extractLog.scrollTop = els.extractLog.scrollHeight; }
      else if (busy) appendMe(msg);
    });

    const tab = document.querySelector('.tab[data-tab="bios"]');
    if (tab) tab.addEventListener('click', () => { if (!loadedOnce) { loadedOnce = true; loadSys(); } });
  }

  window.addEventListener('DOMContentLoaded', wire);
})();
