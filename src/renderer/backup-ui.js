'use strict';

// Backup, Imaging & Cloning tab controller.
(function () {
  const els = {};
  let mapData = null;
  let loadedOnce = false;
  let busy = false;
  let activeLog = null;           // <pre> the live PowerShell output is routed to
  const mounted = [];             // currently-mounted images for the Mount & Browse list

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmt(bytes) {
    const b = Number(bytes);
    if (!isFinite(b) || b <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
  }
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('toast--show');
    setTimeout(() => t.classList.remove('toast--show'), 3200);
  }

  // ---------- generic modal ----------
  function closeModal() { els.modal.hidden = true; els.modalFields.innerHTML = ''; els.modalOk.onclick = null; }
  function openModal(opts) {
    els.modalTitle.textContent = opts.title || '';
    els.modalMsg.textContent = opts.msg || '';
    els.modalMsg.hidden = !opts.msg;
    els.modalFields.innerHTML = '';
    const inputs = {};
    for (const f of (opts.fields || [])) {
      const wrap = el('label', 'field');
      wrap.appendChild(el('span', null, f.label));
      let input;
      if (f.type === 'select') {
        input = el('select', 'select');
        for (const o of (f.options || [])) {
          const opt = el('option', null, o.label != null ? o.label : o);
          opt.value = o.value != null ? o.value : o;
          input.appendChild(opt);
        }
        if (f.value != null) input.value = f.value;
      } else {
        input = el('input');
        input.type = f.type || 'text';
        if (f.value != null) input.value = f.value;
        if (f.placeholder) input.placeholder = f.placeholder;
      }
      inputs[f.key] = input;
      const row = el('div', 'field__row');
      row.appendChild(input);
      wrap.appendChild(row);
      if (f.hint) { const h = el('p', 'muted bk-hint', f.hint); wrap.appendChild(h); }
      els.modalFields.appendChild(wrap);
    }
    els.modalOk.textContent = opts.okText || 'OK';
    els.modalOk.className = 'btn ' + (opts.danger ? 'btn--primary btn--danger' : 'btn--primary');
    els.modalOk.onclick = () => {
      const values = {};
      for (const k of Object.keys(inputs)) values[k] = inputs[k].value;
      if (opts.validate) {
        const msg = opts.validate(values);
        if (msg) { toast(msg); return; }
      }
      closeModal();
      if (opts.onOk) opts.onOk(values);
    };
    els.modal.hidden = false;
    const first = els.modalFields.querySelector('input,select');
    if (first) first.focus();
  }

  // ---------- disk map ----------
  function volumeList(includeProtected) {
    const vols = [];
    if (!mapData || !mapData.disks) return vols;
    for (const d of mapData.disks) {
      for (const p of (d.partitions || [])) {
        if (!p.letter || !p.fs) continue;
        if (!includeProtected && p.protected) continue;
        vols.push({
          letter: p.letter,
          label: p.label,
          fs: p.fs,
          size: p.sizeBytes,
          disk: d.number,
          part: p.number,
          protected: p.protected,
        });
      }
    }
    return vols;
  }

  function fillVolumeSelects() {
    // Source (any real volume) and apply-destination (non-protected only).
    const src = els.srcVol, dest = els.applyDest;
    if (src) {
      src.innerHTML = '';
      for (const v of volumeList(true)) {
        const o = el('option', null, v.letter + '  ' + (v.label || v.fs) + '  (' + fmt(v.size) + ')');
        o.value = v.letter;
        src.appendChild(o);
      }
    }
    if (dest) {
      dest.innerHTML = '';
      const list = volumeList(false);
      if (!list.length) {
        const o = el('option', null, 'No eligible (non-system) volume found');
        o.value = '';
        dest.appendChild(o);
      }
      for (const v of list) {
        const o = el('option', null, v.letter + '  ' + (v.label || v.fs) + '  (' + fmt(v.size) + ')');
        o.value = v.letter;
        dest.appendChild(o);
      }
    }
  }

  function partColor(p) {
    const f = p.flags || [];
    if (f.indexOf('Recovery') >= 0) return 'bk-seg--rec';
    if (f.indexOf('System') >= 0 || p.protected && !p.letter) return 'bk-seg--efi';
    if (p.protected) return 'bk-seg--sys';
    return 'bk-seg--data';
  }

  function renderDiskBar(d) {
    const bar = el('div', 'bk-bar');
    const total = Number(d.sizeBytes) || 1;
    let used = 0;
    for (const p of (d.partitions || [])) {
      const pct = Math.max(0.6, (Number(p.sizeBytes) / total) * 100);
      used += Number(p.sizeBytes) || 0;
      const seg = el('div', 'bk-seg ' + partColor(p));
      seg.style.width = pct + '%';
      seg.title = (p.letter ? p.letter + ' ' : '') + (p.label || p.type || '') + ' — ' + fmt(p.sizeBytes);
      seg.appendChild(el('span', 'bk-seg__lbl', p.letter || (p.flags && p.flags.length ? p.flags[0] : '')));
      bar.appendChild(seg);
    }
    const freeSpace = total - used;
    if (freeSpace > total * 0.01) {
      const seg = el('div', 'bk-seg bk-seg--free');
      seg.style.width = ((freeSpace / total) * 100) + '%';
      seg.title = 'Unallocated — ' + fmt(freeSpace);
      seg.appendChild(el('span', 'bk-seg__lbl', 'Unalloc'));
      bar.appendChild(seg);
    }
    return bar;
  }

  function partActions(d, p) {
    const wrap = el('div', 'bk-pacts');
    if (p.protected) {
      wrap.appendChild(el('span', 'bk-lock', '🔒 protected'));
      return wrap;
    }
    const mk = (label, fn, danger) => {
      const b = el('button', 'btn btn--ghost btn--xs' + (danger ? ' btn--danger' : ''), label);
      b.type = 'button';
      b.addEventListener('click', fn);
      wrap.appendChild(b);
    };
    mk('Letter', () => actLetter(d, p));
    if (p.letter) mk('Label', () => actLabel(d, p));
    mk('Resize', () => actResize(d, p));
    if (p.letter) mk('Format', () => actFormat(d, p), true);
    return wrap;
  }

  function renderDisks() {
    const host = els.disks;
    host.innerHTML = '';
    if (!mapData || !mapData.disks || !mapData.disks.length) {
      host.appendChild(el('p', 'muted', 'No disks detected.'));
      return;
    }
    if (mapData.isAdmin === false) {
      const warn = el('div', 'bk-adminwarn', 'Running without administrator rights — imaging, restore and partition changes are disabled. Use the “Run as administrator” banner above for full access.');
      host.appendChild(warn);
    }
    for (const d of mapData.disks) {
      const card = el('section', 'bk-disk');
      const head = el('div', 'bk-disk__head');
      const title = el('div', 'bk-disk__title');
      title.appendChild(el('span', 'bk-disk__model', (d.model || ('Disk ' + d.number))));
      const meta = [];
      meta.push('Disk ' + d.number);
      if (d.busType) meta.push(d.busType);
      if (d.mediaType) meta.push(d.mediaType);
      if (d.partStyle) meta.push(d.partStyle);
      meta.push(fmt(d.sizeBytes));
      title.appendChild(el('span', 'bk-disk__meta', meta.join('  •  ')));
      head.appendChild(title);
      const badges = el('div', 'bk-disk__badges');
      if (d.isSystem || d.isBoot) badges.appendChild(el('span', 'bk-badge bk-badge--sys', 'System disk'));
      if (d.health && d.health !== 'Healthy') badges.appendChild(el('span', 'bk-badge bk-badge--warn', d.health));
      if (d.isOffline) badges.appendChild(el('span', 'bk-badge bk-badge--warn', 'Offline'));
      head.appendChild(badges);
      card.appendChild(head);

      card.appendChild(renderDiskBar(d));

      const table = el('table', 'bk-ptable');
      const thead = el('tr');
      ['#', 'Vol', 'Label', 'FS', 'Size', 'Free', 'Flags', ''].forEach((h) => thead.appendChild(el('th', null, h)));
      table.appendChild(thead);
      for (const p of (d.partitions || [])) {
        const tr = el('tr');
        tr.appendChild(el('td', null, String(p.number)));
        tr.appendChild(el('td', 'bk-mono', p.letter || '—'));
        tr.appendChild(el('td', null, p.label || (p.type || '')));
        tr.appendChild(el('td', null, p.fs || '—'));
        tr.appendChild(el('td', null, fmt(p.sizeBytes)));
        tr.appendChild(el('td', null, p.freeBytes != null ? fmt(p.freeBytes) : '—'));
        const flags = (p.flags || []).slice();
        if (p.bitlocker && p.bitlocker !== 'Off' && p.bitlocker !== '0') flags.push('BitLocker');
        tr.appendChild(el('td', 'bk-flags', flags.join(', ')));
        const act = el('td');
        act.appendChild(partActions(d, p));
        tr.appendChild(act);
        table.appendChild(tr);
      }
      card.appendChild(table);
      host.appendChild(card);
    }
  }

  function loadMap() {
    els.mapStatus.hidden = false;
    els.mapError.hidden = true;
    els.disks.hidden = true;
    return window.backup.map().then((res) => {
      els.mapStatus.hidden = true;
      if (!res || !res.ok) {
        els.mapError.hidden = false;
        els.mapErrorDetail.textContent = (res && res.error) || 'Unknown error.';
        return;
      }
      mapData = res.data || {};
      fillVolumeSelects();
      renderDisks();
      els.disks.hidden = false;
    }).catch((e) => {
      els.mapStatus.hidden = true;
      els.mapError.hidden = false;
      els.mapErrorDetail.textContent = (e && e.message) || String(e);
    });
  }

  // ---------- partition actions ----------
  function runPartition(args, okMsg) {
    if (busy) { toast('Another operation is running.'); return; }
    busy = true;
    window.backup.partition(args).then((res) => {
      const d = (res && res.data) || {};
      if (!res || !res.ok || d.ok !== true) {
        toast('Failed: ' + explainErr(d.error || (res && res.error)));
        return;
      }
      toast(okMsg || 'Done.');
      loadMap();
    }).catch((e) => toast('Failed: ' + ((e && e.message) || e)))
      .finally(() => { busy = false; });
  }

  function explainErr(code) {
    const map = {
      admin: 'needs administrator rights',
      protected: 'that volume is protected (system/boot/recovery)',
      'dest-is-system': 'the destination is the Windows drive',
      'dest-protected': 'the destination is a protected volume',
      'confirm-mismatch': 'the typed confirmation did not match',
      'image-missing': 'the image file was not found',
      'target-exists': 'that output file already exists — pick a new name',
      'no-volume': 'that partition has no drive letter',
      'bad-letter': 'that drive letter is not valid',
      'no-target': 'no target selected',
      'no-source': 'no source selected',
      'no-dest': 'no destination selected',
      'unknown-mode': 'internal error (mode)',
      'unknown-action': 'internal error (action)',
    };
    return map[code] || (code || 'unknown error');
  }

  function actLetter(d, p) {
    openModal({
      title: 'Change drive letter',
      msg: 'Assign a new drive letter to ' + (p.letter || 'this partition') + ' on disk ' + d.number + '.',
      fields: [{ key: 'letter', label: 'New drive letter (A–Z)', type: 'text', value: (p.letter || '').replace(':', ''), placeholder: 'E' }],
      okText: 'Change letter',
      validate: (v) => (!/^[A-Za-z]$/.test((v.letter || '').trim()) ? 'Enter a single letter A–Z.' : ''),
      onOk: (v) => runPartition({ action: 'letter', disk: d.number, part: p.number, newLetter: v.letter.trim() }, 'Drive letter changed.'),
    });
  }
  function actLabel(d, p) {
    openModal({
      title: 'Rename volume label',
      fields: [{ key: 'label', label: 'New label', type: 'text', value: p.label || '', placeholder: 'e.g. Backup' }],
      okText: 'Rename',
      onOk: (v) => runPartition({ action: 'label', disk: d.number, part: p.number, newLabel: v.label }, 'Label updated.'),
    });
  }
  function actResize(d, p) {
    const curMB = Math.round(Number(p.sizeBytes) / (1024 * 1024));
    openModal({
      title: 'Resize partition',
      msg: 'Current size: ' + fmt(p.sizeBytes) + '. Enter a new size in MB, or 0 to grow into all free space after it. Shrinking is limited by data already on the volume.',
      fields: [{ key: 'mb', label: 'New size (MB, 0 = maximum)', type: 'number', value: String(curMB) }],
      okText: 'Resize',
      validate: (v) => (isNaN(Number(v.mb)) || Number(v.mb) < 0 ? 'Enter a number.' : ''),
      onOk: (v) => runPartition({ action: 'resize', disk: d.number, part: p.number, sizeMB: Math.round(Number(v.mb)) }, 'Partition resized.'),
    });
  }
  function actFormat(d, p) {
    const expected = p.letter || 'FORMAT';
    openModal({
      title: 'Format volume ' + (p.letter || ''),
      msg: 'This ERASES everything on ' + (p.letter || 'this volume') + ' (' + (p.label || p.fs || '') + ', ' + fmt(p.sizeBytes) + '). This cannot be undone.',
      danger: true,
      fields: [
        { key: 'fs', label: 'File system', type: 'select', options: ['NTFS', 'exFAT', 'FAT32'], value: 'NTFS' },
        { key: 'label', label: 'New label (optional)', type: 'text', value: p.label || '' },
        { key: 'confirm', label: 'Type "' + expected + '" to confirm', type: 'text', placeholder: expected },
      ],
      okText: 'Erase & format',
      validate: (v) => ((v.confirm || '').trim().toUpperCase() !== expected.toUpperCase() ? 'Type ' + expected + ' exactly to confirm.' : ''),
      onOk: (v) => runPartition({ action: 'format', disk: d.number, part: p.number, fsType: v.fs, newLabel: v.label, confirm: v.confirm }, 'Volume formatted.'),
    });
  }

  // ---------- create image ----------
  function currentMode() {
    const r = document.querySelector('input[name="bkMode"]:checked');
    return r ? r.value : 'systemimage';
  }
  function syncCreateMode() {
    const mode = currentMode();
    if (mode === 'systemimage') {
      els.targetLabel.textContent = 'Target drive (where the image is written)';
      els.target.placeholder = 'Choose a drive with free space…';
      els.createHint.textContent = 'Images the whole PC. The target must be a different drive with enough free space.';
    } else {
      els.targetLabel.textContent = 'Save image as (.wim file)';
      els.target.placeholder = 'Choose where to save the .wim…';
      els.createHint.textContent = 'Captures the selected volume into one .wim file.';
    }
    els.target.value = '';
  }
  function pickCreateTarget() {
    const mode = currentMode();
    if (mode === 'systemimage') {
      window.backup.pickFolder().then((p) => {
        if (!p) return;
        // wbadmin wants a drive root like E:
        const drive = (p.match(/^[A-Za-z]:/) || [''])[0].toUpperCase();
        els.target.value = drive || p;
        els.target.dataset.full = p;
      });
    } else {
      const name = (els.name.value || 'TM-image').trim();
      window.backup.pickSaveWim({ name }).then((p) => { if (p) els.target.value = p; });
    }
  }
  function startCreate() {
    if (busy) { toast('Another operation is running.'); return; }
    const mode = currentMode();
    const source = els.srcVol.value;
    const target = els.target.value;
    const name = els.name.value.trim();
    if (!source) { toast('Pick a source volume.'); return; }
    if (!target) { toast('Choose where to write the image.'); return; }
    const human = mode === 'systemimage'
      ? 'Create a full bootable system image of this PC onto ' + target + '?\n\nThe PC stays usable while it runs. This can take a while and needs plenty of free space.'
      : 'Capture volume ' + source + ' into:\n' + target + '?\n\nThe source volume is not changed.';
    if (!window.confirm(human)) return;

    busy = true;
    els.createRunner.hidden = false;
    els.createTitle.textContent = mode === 'systemimage' ? 'Creating system image…' : 'Capturing volume…';
    els.createState.textContent = 'Running…';
    els.createState.className = 'repairs-state repairs-state--run';
    els.createLog.textContent = '';
    activeLog = els.createLog;
    appendLog(activeLog, 'Starting…');
    els.createRunner.scrollIntoView({ behavior: 'smooth', block: 'start' });

    window.backup.image({ mode, source, target, name }).then((res) => {
      const d = (res && res.data) || {};
      if (!res || !res.ok) { finishRun(els.createState, false, 'Failed: ' + ((res && res.error) || 'error')); return; }
      if (d.error) { finishRun(els.createState, false, errLine(d)); return; }
      finishRun(els.createState, d.ok, d.ok ? 'Completed.' : ('Finished (exit ' + d.exitCode + ').'));
    }).catch((e) => finishRun(els.createState, false, 'Failed: ' + ((e && e.message) || e)))
      .finally(() => { busy = false; activeLog = null; });
  }

  // ---------- apply / restore ----------
  function startApply() {
    if (busy) { toast('Another operation is running.'); return; }
    const img = els.applyImg.value;
    const dest = els.applyDest.value;
    const index = parseInt(els.applyIndex.value, 10) || 1;
    if (!img) { toast('Choose a .wim image first.'); return; }
    if (!dest) { toast('Pick a destination volume.'); return; }
    openModal({
      title: 'Restore image onto ' + dest,
      msg: 'This ERASES and overwrites everything on ' + dest + ' with the contents of the image. This cannot be undone.',
      danger: true,
      fields: [{ key: 'confirm', label: 'Type "' + dest + '" to confirm', type: 'text', placeholder: dest }],
      okText: 'Overwrite & restore',
      validate: (v) => ((v.confirm || '').trim().toUpperCase() !== dest.toUpperCase() ? 'Type ' + dest + ' exactly to confirm.' : ''),
      onOk: (v) => {
        busy = true;
        els.applyRunner.hidden = false;
        els.applyTitle.textContent = 'Restoring image onto ' + dest + '…';
        els.applyState.textContent = 'Running…';
        els.applyState.className = 'repairs-state repairs-state--run';
        els.applyLog.textContent = '';
        activeLog = els.applyLog;
        appendLog(activeLog, 'Starting…');
        els.applyRunner.scrollIntoView({ behavior: 'smooth', block: 'start' });
        window.backup.image({ mode: 'apply', target: img, applyTo: dest, index, confirm: v.confirm.trim() }).then((res) => {
          const d = (res && res.data) || {};
          if (!res || !res.ok) { finishRun(els.applyState, false, 'Failed: ' + ((res && res.error) || 'error')); return; }
          if (d.error) { finishRun(els.applyState, false, errLine(d)); return; }
          finishRun(els.applyState, d.ok, d.ok ? 'Restore complete.' : ('Finished (exit ' + d.exitCode + ').'));
          if (d.ok) loadMap();
        }).catch((e) => finishRun(els.applyState, false, 'Failed: ' + ((e && e.message) || e)))
          .finally(() => { busy = false; activeLog = null; });
      },
    });
  }

  function errLine(d) {
    if (d.error === 'admin') return 'This needs administrator rights. Use the “Run as administrator” banner, then retry.';
    return 'Error: ' + explainErr(d.error) + (d.line ? ' (line ' + d.line + ')' : '');
  }
  function appendLog(pre, line) {
    if (!pre || line == null) return;
    pre.textContent += String(line).replace(/\s+$/, '') + '\n';
    pre.scrollTop = pre.scrollHeight;
  }
  function finishRun(stateEl, ok, msg) {
    appendLog(activeLog, '\n' + msg);
    stateEl.textContent = ok ? 'Completed' : 'Failed';
    stateEl.className = 'repairs-state ' + (ok ? 'repairs-state--good' : 'repairs-state--bad');
  }

  // ---------- mount & browse ----------
  function renderMounts() {
    els.mounts.innerHTML = '';
    if (!mounted.length) return;
    const h = el('h4', 'info-sub', 'Mounted images');
    els.mounts.appendChild(h);
    mounted.forEach((m, i) => {
      const row = el('div', 'bk-mountrow');
      const info = el('div', 'bk-mountrow__info');
      info.appendChild(el('span', 'bk-mono', m.name));
      info.appendChild(el('span', 'muted', m.kind === 'wim' ? ('mounted at ' + m.mountDir) : ('drive ' + (m.letters.join(', ') || '—'))));
      row.appendChild(info);
      const acts = el('div', 'bk-actions');
      const openBtn = el('button', 'btn btn--ghost btn--sm', 'Open');
      openBtn.addEventListener('click', () => {
        const path = m.kind === 'wim' ? m.mountDir : (m.letters[0] ? m.letters[0] + '\\' : '');
        if (path) window.backup.openPath(path);
      });
      const umBtn = el('button', 'btn btn--ghost btn--sm', 'Unmount');
      umBtn.addEventListener('click', () => {
        umBtn.disabled = true;
        window.backup.mount({ action: 'unmount', imagePath: m.path, mountDir: m.mountDir }).then((res) => {
          const d = (res && res.data) || {};
          if (res && res.ok && d.ok) { mounted.splice(i, 1); renderMounts(); toast('Unmounted.'); }
          else { toast('Unmount failed: ' + explainErr(d.error || (res && res.error))); umBtn.disabled = false; }
        }).catch((e) => { toast('Unmount failed: ' + ((e && e.message) || e)); umBtn.disabled = false; });
      });
      acts.appendChild(openBtn);
      acts.appendChild(umBtn);
      row.appendChild(acts);
      els.mounts.appendChild(row);
    });
  }
  function doMount() {
    const p = els.mountPath.value;
    if (!p) return;
    if (busy) { toast('Another operation is running.'); return; }
    busy = true;
    els.mountGo.disabled = true;
    els.mountGo.textContent = 'Mounting…';
    window.backup.mount({ action: 'mount', imagePath: p, index: 1 }).then((res) => {
      const d = (res && res.data) || {};
      if (!res || !res.ok || d.ok !== true) { toast('Mount failed: ' + explainErr(d.error || (res && res.error))); return; }
      mounted.push({ path: p, name: p.split(/[\\/]/).pop(), kind: d.kind, letters: d.letters || [], mountDir: d.mountDir || '' });
      renderMounts();
      toast('Mounted read-only.');
    }).catch((e) => toast('Mount failed: ' + ((e && e.message) || e)))
      .finally(() => { busy = false; els.mountGo.disabled = false; els.mountGo.textContent = 'Mount'; });
  }

  // ---------- sub-nav ----------
  function showSub(name) {
    for (const b of document.querySelectorAll('#panel-backup .subtab')) {
      b.classList.toggle('subtab--active', b.dataset.bsub === name);
    }
    const sections = { map: 'bk-map', create: 'bk-create', mount: 'bk-mount', restore: 'bk-restore' };
    for (const key of Object.keys(sections)) {
      const s = document.getElementById(sections[key]);
      if (s) s.hidden = key !== name;
    }
  }

  function wire() {
    els.disks = $('#bkDisks');
    els.mapStatus = $('#bkMapStatus');
    els.mapError = $('#bkMapError');
    els.mapErrorDetail = $('#bkMapErrorDetail');
    els.srcVol = $('#bkSrcVol');
    els.target = $('#bkTarget');
    els.targetLabel = $('#bkTargetLabel');
    els.name = $('#bkName');
    els.createHint = $('#bkCreateHint');
    els.createRunner = $('#bkCreateRunner');
    els.createTitle = $('#bkCreateTitle');
    els.createState = $('#bkCreateState');
    els.createLog = $('#bkCreateLog');
    els.mountPath = $('#bkMountPath');
    els.mountGo = $('#bkMountGo');
    els.mounts = $('#bkMounts');
    els.applyImg = $('#bkApplyImg');
    els.applyDest = $('#bkApplyDest');
    els.applyIndex = $('#bkApplyIndex');
    els.applyRunner = $('#bkApplyRunner');
    els.applyTitle = $('#bkApplyTitle');
    els.applyState = $('#bkApplyState');
    els.applyLog = $('#bkApplyLog');
    els.modal = $('#bkModal');
    els.modalTitle = $('#bkModalTitle');
    els.modalMsg = $('#bkModalMsg');
    els.modalFields = $('#bkModalFields');
    els.modalOk = $('#bkModalOk');
    els.modalCancel = $('#bkModalCancel');
    if (!els.disks) return;

    for (const b of document.querySelectorAll('#panel-backup .subtab')) {
      b.addEventListener('click', () => showSub(b.dataset.bsub));
    }
    $('#bkRefresh').addEventListener('click', loadMap);
    for (const r of document.querySelectorAll('input[name="bkMode"]')) r.addEventListener('change', syncCreateMode);
    $('#bkTargetPick').addEventListener('click', pickCreateTarget);
    $('#bkCreateStart').addEventListener('click', startCreate);
    $('#bkMountPick').addEventListener('click', () => window.backup.pickImage().then((p) => { if (p) { els.mountPath.value = p; els.mountGo.disabled = false; } }));
    $('#bkMountGo').addEventListener('click', doMount);
    $('#bkApplyPick').addEventListener('click', () => window.backup.pickImage().then((p) => { if (p) els.applyImg.value = p; }));
    $('#bkApplyStart').addEventListener('click', startApply);
    $('#bkBootRecovery').addEventListener('click', () => {
      if (window.confirm('Reboot this PC into the Windows Recovery Environment now?\n\nSave your work first — the PC will restart in a few seconds.')) {
        window.backup.bootRecovery().then((r) => { if (!r || !r.ok) toast('Could not trigger a reboot to recovery.'); });
      }
    });
    for (const b of document.querySelectorAll('#panel-backup [data-openurl]')) {
      b.addEventListener('click', () => window.sys && window.sys.openUrl(b.dataset.openurl));
    }
    els.modalCancel.addEventListener('click', closeModal);
    els.modal.addEventListener('click', (e) => { if (e.target === els.modal) closeModal(); });

    if (window.backup && window.backup.onProgress) {
      window.backup.onProgress((msg) => { if (activeLog) appendLog(activeLog, msg); });
    }
    syncCreateMode();

    const tab = document.querySelector('.tab[data-tab="backup"]');
    if (tab) tab.addEventListener('click', () => { if (!loadedOnce) { loadedOnce = true; loadMap(); } });
  }

  window.addEventListener('DOMContentLoaded', wire);
})();
