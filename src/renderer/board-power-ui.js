'use strict';

// Board Repair > Power Signatures. Reads a PLD USB-C meter over Web Serial,
// graphs volts/amps over time, records a capture, classifies the fault from the
// current signature, and keeps a labelled library of good/bad boards.
(function () {
  const $ = (s) => document.querySelector(s);
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function toast(msg, err) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.className = 'toast toast--show' + (err ? ' toast--error' : ''); clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3600); }
  function copyText(text) { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); document.body.removeChild(ta); return ok; } catch { return false; } }

  let port = null, reader = null, keepReading = false;
  let rawBuf = [];            // recent raw bytes for the monitor
  let byteAcc = [];           // parser accumulation buffer
  let gotBytes = false, gotParse = false;
  let byteCount = 0, noDataTimer = null, lastStatusAt = 0;
  let samples = [];           // { t, v, a } since recording started (or imported)
  const markers = [];         // { t, label }
  let recording = false, startT = 0;
  let lastV = null, lastA = null;
  let rafPending = false;

  const els = {};

  // ---------------- serial ----------------
  function portPicker(list) {
    let pick = $('#pwPortPick');
    if (!pick) { pick = el('div', 'pw-portpick'); pick.id = 'pwPortPick'; els.connectCard.appendChild(pick); }
    pick.innerHTML = '';
    pick.appendChild(el('div', 'muted', 'Pick the meter’s port:'));
    for (const p of (list || [])) {
      const b = el('button', 'btn btn--ghost btn--sm', p.display + (p.vendorId ? ('  (' + p.vendorId + ':' + p.productId + ')') : ''));
      b.type = 'button';
      b.addEventListener('click', () => { pick.remove(); window.power.selectPort(p.id); });
      pick.appendChild(b);
    }
    const cancel = el('button', 'btn btn--ghost btn--sm', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', () => { pick.remove(); window.power.cancelPort(); });
    pick.appendChild(cancel);
    if (!list || !list.length) pick.appendChild(el('p', 'muted', 'No serial ports found. Check the meter is plugged in (it shows up as a USB-serial device).'));
  }

  async function connect() {
    if (!('serial' in navigator)) { toast('Web Serial isn’t available in this build.', true); return; }
    const baud = parseInt(els.baud.value, 10) || 9600;
    els.status.textContent = 'Choose the meter’s serial port…';
    let p;
    try { p = await navigator.serial.requestPort({ filters: [] }); }
    catch (e) { els.status.textContent = 'No port selected.'; return; }
    try { await p.open({ baudRate: baud }); }
    catch (e) { els.status.textContent = 'Could not open port: ' + (e.message || e); return; }
    // Many CH340/FTDI devices stay silent until DTR/RTS are asserted.
    try { await p.setSignals({ dataTerminalReady: true, requestToSend: true }); } catch { /* some drivers don't support this */ }
    port = p; keepReading = true; gotBytes = false; gotParse = false; byteAcc = []; byteCount = 0;
    els.connect.hidden = true; els.disconnect.hidden = false;
    els.status.textContent = 'Connected at ' + baud + ' baud — waiting for data…';
    // If nothing arrives in a few seconds, tell the tech what to try.
    clearTimeout(noDataTimer);
    noDataTimer = setTimeout(() => {
      if (byteCount === 0 && port) els.status.textContent = 'Connected, but 0 bytes received. The meter usually only streams while it is measuring — plug the device under test into the meter’s USB-C port so there is voltage/current to report. If still nothing, try a different baud rate.';
    }, 4000);
    readLoop();
  }

  async function disconnect() {
    keepReading = false;
    clearTimeout(noDataTimer);
    try { if (reader) await reader.cancel(); } catch { /* ignore */ }
    try { if (port) await port.close(); } catch { /* ignore */ }
    port = null; reader = null;
    els.connect.hidden = false; els.disconnect.hidden = true;
    els.status.textContent = 'Disconnected.';
  }

  async function readLoop() {
    while (port && port.readable && keepReading) {
      reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length) onBytes(value);
        }
      } catch { /* stream glitch / unplugged */ } finally { try { reader.releaseLock(); } catch { /* ignore */ } }
    }
  }

  function onBytes(u8) {
    gotBytes = true; byteCount += u8.length;
    clearTimeout(noDataTimer);
    // raw monitor buffer (keep last ~256 bytes)
    for (let i = 0; i < u8.length; i++) rawBuf.push(u8[i]);
    if (rawBuf.length > 256) rawBuf = rawBuf.slice(rawBuf.length - 256);
    if (els.rawToggle.checked) renderRaw();
    // parser accumulation
    for (let i = 0; i < u8.length; i++) byteAcc.push(u8[i]);
    if (byteAcc.length > 512) byteAcc = byteAcc.slice(byteAcc.length - 512);
    parseAcc();
    const now = performance.now();
    if (now - lastStatusAt > 350) {
      lastStatusAt = now;
      els.status.textContent = gotParse
        ? ('Connected — reading the meter (' + byteCount + ' bytes).')
        : ('Receiving data (' + byteCount + ' bytes) but I can’t decode the frames yet — tick Raw monitor, let it fill, and send me that capture so I can lock the parser to your meter.');
    }
  }

  // PLD USB-C meter frame: 8 ASCII hex chars, then 0x1C (field separator) and
  // 0x0A (newline). First 4 hex = current in mA, last 4 hex = voltage in mV.
  // (A generic two-floats fallback is kept for other/ASCII meters.)
  function parseAcc() {
    let start = 0;
    for (let i = 0; i < byteAcc.length; i++) {
      if (byteAcc[i] === 0x0A) {
        let s = '';
        for (let j = start; j < i; j++) { const b = byteAcc[j]; if (b === 0x1C || b === 0x0D || b === 0x20 || b === 0x09) continue; if (b >= 33 && b < 127) s += String.fromCharCode(b); }
        decodeLine(s);
        start = i + 1;
      }
    }
    byteAcc = byteAcc.slice(start); // keep the trailing partial frame
    if (byteAcc.length > 4096) byteAcc = byteAcc.slice(byteAcc.length - 4096);
  }
  function decodeLine(s) {
    if (!s) return;
    if (/^[0-9a-fA-F]{8}$/.test(s)) {           // PLD frame
      const cur = parseInt(s.slice(0, 4), 16);  // mA
      const volt = parseInt(s.slice(4, 8), 16); // mV
      const A = cur / 1000, V = volt / 1000;
      if (V >= 0 && V < 60 && A >= 0 && A < 40) { gotParse = true; sample(V, A); }
      return;
    }
    const mm = s.match(/(-?\d+(?:\.\d+)?)\D+(-?\d+(?:\.\d+)?)/);   // ASCII fallback
    if (mm) { const v = parseFloat(mm[1]), a = parseFloat(mm[2]); if (Number.isFinite(v) && Number.isFinite(a) && v < 60 && a < 40) { gotParse = true; sample(v, a); } }
  }

  function renderRaw() {
    if (!rawBuf.length) { els.raw.textContent = 'No bytes received yet (' + byteCount + ' total). If this stays empty, the meter isn’t sending — make sure a device under test is plugged into the meter’s USB-C port so it has something to measure.'; return; }
    const hex = rawBuf.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const asc = rawBuf.map((b) => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.').join('');
    els.raw.textContent = byteCount + ' bytes received (last ' + rawBuf.length + ' shown)\n\nHEX\n' + hex + '\n\nASCII\n' + asc;
  }

  // ---------------- sampling ----------------
  function sample(v, a) {
    lastV = v; lastA = a;
    els.volts.textContent = v.toFixed(3);
    els.amps.textContent = a.toFixed(3);
    els.watts.textContent = (v * a).toFixed(2);
    if (recording) {
      const t = performance.now() - startT;
      samples.push({ t, v, a });
      els.recInfo.textContent = (t / 1000).toFixed(1) + ' s · ' + samples.length + ' samples';
    }
    scheduleDraw();
  }

  // ---------------- chart ----------------
  function scheduleDraw() { if (rafPending) return; rafPending = true; requestAnimationFrame(() => { rafPending = false; draw(); }); }
  function draw() {
    const c = els.chart; if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height, padL = 54, padR = 54, padT = 14, padB = 26;
    ctx.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement);
    const grid = (cs.getPropertyValue('--border') || '#334').trim();
    const txt = (cs.getPropertyValue('--text-dim') || '#99a').trim();
    ctx.strokeStyle = grid; ctx.fillStyle = txt; ctx.lineWidth = 1; ctx.font = '11px system-ui, sans-serif';
    const data = samples.length ? samples : (lastV != null ? [{ t: 0, v: lastV, a: lastA }] : []);
    if (!data.length) { ctx.fillText('No data yet — connect a meter or import a CSV.', padL, H / 2); return; }
    const maxT = Math.max(1, data[data.length - 1].t);
    let maxV = 0, maxA = 0;
    for (const s of data) { if (s.v > maxV) maxV = s.v; if (s.a > maxA) maxA = s.a; }
    maxV = Math.max(maxV * 1.15, 5); maxA = Math.max(maxA * 1.2, 0.1);
    const x = (t) => padL + (t / maxT) * (W - padL - padR);
    const yV = (v) => H - padB - (v / maxV) * (H - padT - padB);
    const yA = (a) => H - padB - (a / maxA) * (H - padT - padB);
    // grid + axes
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();
    for (let i = 0; i <= 4; i++) {
      const gy = padT + (i / 4) * (H - padT - padB);
      ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#ff6b6b'; ctx.fillText((maxV * (1 - i / 4)).toFixed(1), 6, gy + 4);
      ctx.fillStyle = '#f3c84a'; ctx.fillText((maxA * (1 - i / 4)).toFixed(2), W - padR + 6, gy + 4);
    }
    ctx.fillStyle = txt; ctx.fillText((maxT / 1000).toFixed(1) + ' s', W - padR - 26, H - 8); ctx.fillText('0 s', padL, H - 8);
    // lines
    const line = (acc, yf, color) => { ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath(); data.forEach((s, i) => { const px = x(s.t), py = yf(acc(s)); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); };
    line((s) => s.v, yV, '#ff6b6b');
    line((s) => s.a, yA, '#f3c84a');
    // markers
    ctx.strokeStyle = '#8fb3ff'; ctx.fillStyle = '#8fb3ff'; ctx.setLineDash([4, 3]);
    for (const mk of markers) { const px = x(mk.t); ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, H - padB); ctx.stroke(); ctx.fillText(mk.label, px + 3, padT + 10); }
    ctx.setLineDash([]);
    // legend
    ctx.fillStyle = '#ff6b6b'; ctx.fillText('● Volts', padL + 6, padT + 10);
    ctx.fillStyle = '#f3c84a'; ctx.fillText('● Amps', padL + 60, padT + 10);
  }

  // ---------------- recording ----------------
  function toggleRecord() {
    recording = !recording;
    if (recording) {
      samples = []; markers.length = 0; startT = performance.now();
      els.record.textContent = '■ Stop recording'; els.record.classList.add('pw-rec-on');
      els.marker.disabled = false; els.recInfo.textContent = '0.0 s · 0 samples';
    } else {
      els.record.textContent = '● Start recording'; els.record.classList.remove('pw-rec-on');
      els.marker.disabled = true;
    }
  }
  function addMarker() {
    if (!recording) return;
    const t = performance.now() - startT; // capture the moment now, before typing
    showPrompt('Marker label', 'e.g. "hit power", "plugged in"', (name) => {
      if (name == null) return;
      markers.push({ t, label: name || 'mark' });
      draw();
    });
  }
  // Tiny inline prompt (Electron blocks window.prompt).
  function showPrompt(title, placeholder, cb) {
    const host = el('div', 'pw-prompt');
    const box = el('div', 'pw-prompt__box');
    box.appendChild(el('p', null, title));
    const input = el('input', 'pw-in'); input.type = 'text'; input.placeholder = placeholder || '';
    box.appendChild(input);
    const btns = el('div', 'pw-prompt__btns');
    const cancel = el('button', 'btn btn--ghost btn--sm', 'Cancel'); cancel.type = 'button';
    const ok = el('button', 'btn btn--primary btn--sm', 'OK'); ok.type = 'button';
    btns.append(cancel, ok); box.appendChild(btns); host.appendChild(box);
    document.body.appendChild(host);
    setTimeout(() => input.focus(), 30);
    const done = (val) => { host.remove(); cb(val); };
    ok.addEventListener('click', () => done(input.value));
    cancel.addEventListener('click', () => done(null));
    host.addEventListener('click', (e) => { if (e.target === host) done(null); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value); else if (e.key === 'Escape') done(null); });
  }

  function clearCapture() { samples = []; markers.length = 0; els.recInfo.textContent = ''; els.verdict.hidden = true; draw(); }

  // ---------------- analysis ----------------
  function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
  function features(data) {
    if (data.length < 3) return null;
    const vs = data.map((s) => s.v), as = data.map((s) => s.a);
    const n = data.length;
    const aMax = Math.max.apply(null, as);
    // Nominal voltage is the UNLOADED rail: measure it when current is low, so a
    // drive that spends most of the trace under load doesn't hide the sag.
    const lowV = data.filter((s) => s.a < aMax * 0.3).map((s) => s.v).filter((v) => v > 1);
    const vNom = lowV.length >= 3 ? median(lowV) : (vs.length ? Math.max.apply(null, vs) : 0);
    const headN = Math.max(2, Math.floor(n * 0.08)), tailN = Math.max(2, Math.floor(n * 0.12));
    const aStart = median(as.slice(0, headN));
    const aEnd = median(as.slice(n - tailN));
    const aMed = median(as);
    // voltage sag while current is high
    let vUnderLoad = vNom, hiThresh = aMax * 0.6;
    const loadVs = data.filter((s) => s.a >= hiThresh).map((s) => s.v);
    if (loadVs.length) vUnderLoad = median(loadVs);
    const sag = vNom > 0 ? (vNom - vUnderLoad) / vNom : 0;
    // oscillation: count significant peaks in current
    let peaks = 0; const thr = aMax * 0.5;
    for (let i = 1; i < n - 1; i++) { if (as[i] > thr && as[i] >= as[i - 1] && as[i] > as[i + 1]) peaks++; }
    const durMs = data[n - 1].t - data[0].t;
    return { n, aMax, aMed, aStart, aEnd, vNom, vUnderLoad, sag, peaks, durMs };
  }
  function analyse(data) {
    const f = features(data);
    if (!f) return { items: [{ label: 'Not enough data', conf: 0, why: 'Record at least a second or two of a board powering on.' }], f: null };
    const out = [];
    const mA = (x) => Math.round(x * 1000) + ' mA';
    if (f.aMax < 0.004) {
      out.push({ label: 'Open circuit / no current draw', conf: 0.85, why: 'Peak draw is essentially zero (' + mA(f.aMax) + ') with ' + f.vNom.toFixed(1) + ' V present — the board isn’t pulling power. Suspect a blown fuse, broken rail, bad connector, or the board isn’t attempting to turn on.' });
    } else {
      // short: high current from the moment it powers, staying flat with no boot
      // curve. Voltage sag (when measurable) raises confidence.
      if (f.aMax > 0.03 && f.aStart >= f.aMax * 0.55 && f.aEnd >= f.aMax * 0.7 && f.peaks < 3) {
        const conf = f.sag > 0.06 ? 0.85 : 0.6;
        out.push({ label: 'Dead short to ground', conf, why: 'Current is high from the instant it powers (' + mA(f.aMax) + ') and stays flat — no inrush-then-settle boot curve' + (f.sag > 0.06 ? (', and the voltage sags ' + Math.round(f.sag * 100) + '% under load') : '') + '. Classic short: find the hot component (cap/FET/PMIC) or use the short-finder.' });
      } else if (f.sag > 0.05 && f.aMax > f.aMed * 2.5 && f.aEnd > f.aMax * 0.7) {
        out.push({ label: 'Partial short / heavy rail load', conf: 0.55, why: 'Sustained high current (' + mA(f.aMax) + ') with some voltage sag. Something downstream is pulling hard — a leaky rail or a partially shorted component.' });
      }
      // protection trip / brown-out: rises then collapses
      if (f.aEnd < f.aMax * 0.25 && f.aMax > 0.03 && f.aStart < f.aMax * 0.8) {
        out.push({ label: 'Protection trip / brown-out', conf: 0.6, why: 'Current rises to ' + mA(f.aMax) + ' then collapses to ' + mA(f.aEnd) + ' — a rail is coming up and then shutting down (short downstream, bad rail, or the PMIC cutting out).' });
      }
      // boot-loop: repeated peaks
      if (f.peaks >= 3 && f.durMs > 1500) {
        out.push({ label: 'Boot-loop / reset loop', conf: 0.55, why: f.peaks + ' current surges over ' + (f.durMs / 1000).toFixed(0) + ' s — the board keeps restarting. Often a power-rail or storage/firmware fault.' });
      }
      // stuck boot: ramps to a plateau and holds, no completion
      if (f.aEnd > f.aMax * 0.5 && f.aEnd < f.aMax * 0.85 && f.sag < 0.05 && f.peaks < 3) {
        out.push({ label: 'Possibly stuck mid-boot', conf: 0.4, why: 'Current climbs and then holds at a plateau (' + mA(f.aEnd) + ') without settling — may be stalling at a boot stage. Compare the plateau to a known-good board.' });
      }
      // normal: inrush then settles lower, no sag
      if (f.aEnd < f.aMax * 0.7 && f.sag < 0.04 && f.peaks < 3 && f.aMax > 0.02) {
        out.push({ label: 'Looks like a normal boot curve', conf: 0.5, why: 'Inrush to ' + mA(f.aMax) + ' then settling to ' + mA(f.aEnd) + ' with a stable voltage. Save this as a known-good reference for this model.' });
      }
    }
    if (!out.length) out.push({ label: 'No clear signature', conf: 0.2, why: 'Nothing stood out. Record a longer capture through the full power-on, and compare against a known-good board in your library.' });
    out.sort((a, b) => b.conf - a.conf);
    return { items: out, f };
  }
  function renderVerdict(res) {
    els.verdict.hidden = false;
    els.verdict.innerHTML = '';
    els.verdict.appendChild(el('h4', 'pw-verdict__h', 'Signature analysis'));
    for (const it of res.items) {
      const row = el('div', 'pw-finding');
      const bar = el('span', 'pw-finding__conf');
      bar.style.setProperty('--c', Math.round(it.conf * 100));
      const head = el('div', 'pw-finding__head');
      head.append(el('strong', null, it.label), el('span', 'muted', '  ' + Math.round(it.conf * 100) + '% match'));
      row.append(head, el('p', 'pw-finding__why', it.why));
      els.verdict.appendChild(row);
    }
    if (res.f) {
      const f = res.f;
      els.verdict.appendChild(el('p', 'muted pw-feat', 'Peak ' + Math.round(f.aMax * 1000) + ' mA · settled ' + Math.round(f.aEnd * 1000) + ' mA · ' + f.vNom.toFixed(1) + ' V (sag ' + Math.round(f.sag * 100) + '% under load) · ' + f.peaks + ' surge(s)'));
    }
  }

  // ---------------- library ----------------
  function downsample(data, cap) {
    if (data.length <= cap) return data.slice();
    const step = data.length / cap, out = [];
    for (let i = 0; i < cap; i++) out.push(data[Math.floor(i * step)]);
    return out;
  }
  function saveCapture() {
    if (!samples.length) { toast('Nothing to save — record or import a capture first.', true); return; }
    openSaveForm();
  }
  function openSaveForm() {
    let f = $('#pwSaveForm');
    if (f) { f.remove(); return; }
    f = el('div', 'pw-saveform'); f.id = 'pwSaveForm';
    const dev = el('input'); dev.placeholder = 'Device / model (e.g. iPhone 11 logic board)'; dev.className = 'pw-in';
    const fault = el('input'); fault.placeholder = 'Verdict / fault (e.g. good board, or U2 short)'; fault.className = 'pw-in';
    const notes = el('input'); notes.placeholder = 'Notes (optional)'; notes.className = 'pw-in';
    const save = el('button', 'btn btn--primary btn--sm', 'Save'); save.type = 'button';
    const cancel = el('button', 'btn btn--ghost btn--sm', 'Cancel'); cancel.type = 'button';
    save.addEventListener('click', () => {
      const res = analyse(samples);
      const sig = { label: (dev.value || 'Capture') + (fault.value ? (' — ' + fault.value) : ''), device: dev.value || '', fault: fault.value || '', notes: notes.value || '', durationMs: samples.length ? samples[samples.length - 1].t : 0, samples: downsample(samples, 1500), markers: markers.slice(), features: res.f || null };
      window.power.saveSig(sig).then((r) => { if (r && r.ok) { toast('Signature saved.'); f.remove(); loadLib(); } else toast('Could not save.', true); });
    });
    cancel.addEventListener('click', () => f.remove());
    f.append(dev, fault, notes, save, cancel);
    els.lib.parentNode.insertBefore(f, els.lib);
    dev.focus();
  }
  function loadLib() {
    if (!(window.power && window.power.listSigs)) return;
    window.power.listSigs().then((r) => {
      const items = (r && r.items) || [];
      els.lib.innerHTML = '';
      els.libEmpty.hidden = items.length > 0;
      for (const it of items) {
        const row = el('div', 'pw-sig');
        const info = el('div', 'pw-sig__info');
        info.append(el('div', 'pw-sig__name', it.label || it.device || 'Capture'));
        info.append(el('div', 'muted pw-sig__meta', [it.fault, it.samples + ' pts', it.durationMs ? (it.durationMs / 1000).toFixed(1) + ' s' : '', (it.created || '').slice(0, 10)].filter(Boolean).join('  ·  ')));
        const acts = el('div', 'pw-sig__acts');
        const load = el('button', 'btn btn--ghost btn--xs', 'Load'); load.type = 'button';
        load.addEventListener('click', () => window.power.getSig(it.id).then((r2) => { if (r2 && r2.ok) { samples = r2.sig.samples || []; markers.length = 0; (r2.sig.markers || []).forEach((m) => markers.push(m)); draw(); renderVerdict(analyse(samples)); toast('Loaded “' + (it.label || 'capture') + '”.'); } }));
        const del = el('button', 'btn btn--ghost btn--xs', 'Delete'); del.type = 'button';
        del.addEventListener('click', () => { if (window.confirm('Delete this saved signature?')) window.power.deleteSig(it.id).then(loadLib); });
        acts.append(load, del);
        row.append(info, acts);
        els.lib.appendChild(row);
      }
    });
  }
  function matchLibrary() {
    if (!samples.length) { toast('Capture something first, then match it.', true); return; }
    const cur = features(samples); if (!cur) { toast('Not enough data to match.', true); return; }
    window.power.listSigs().then(async (r) => {
      const items = (r && r.items) || [];
      const scored = [];
      for (const it of items) {
        const full = await window.power.getSig(it.id);
        if (!full || !full.ok) continue;
        const f = full.sig.features || features(full.sig.samples || []);
        if (!f) continue;
        scored.push({ it, score: similarity(cur, f), f });
      }
      scored.sort((a, b) => b.score - a.score);
      els.matchOut.hidden = false; els.matchOut.innerHTML = '';
      els.matchOut.appendChild(el('h4', 'pw-verdict__h', 'Closest saved signatures'));
      if (!scored.length) { els.matchOut.appendChild(el('p', 'muted', 'No saved signatures to compare against yet.')); return; }
      for (const s of scored.slice(0, 4)) {
        const row = el('div', 'pw-finding');
        const head = el('div', 'pw-finding__head');
        head.append(el('strong', null, s.it.label || s.it.device || 'Capture'), el('span', 'muted', '  ' + Math.round(s.score * 100) + '% similar'));
        row.append(head, el('p', 'pw-finding__why', [s.it.fault, s.it.notes].filter(Boolean).join(' — ') || 'No notes.'));
        els.matchOut.appendChild(row);
      }
    });
  }
  function similarity(a, b) {
    // Compare normalised current/voltage features; 1 = identical shape.
    const rel = (x, y) => { const m = Math.max(Math.abs(x), Math.abs(y), 1e-3); return 1 - Math.min(1, Math.abs(x - y) / m); };
    const peakShape = (f) => f.aMax > 0 ? f.aEnd / f.aMax : 0;
    let s = 0;
    s += rel(a.aMax, b.aMax) * 0.3;
    s += rel(peakShape(a), peakShape(b)) * 0.3;
    s += rel(a.sag, b.sag) * 0.2;
    s += rel(a.vNom, b.vNom) * 0.1;
    s += rel(Math.min(a.peaks, 6), Math.min(b.peaks, 6)) * 0.1;
    return Math.max(0, Math.min(1, s));
  }

  // ---------------- CSV ----------------
  function exportCsv() {
    if (!samples.length) { toast('Nothing to export.', true); return; }
    const rows = samples.map((s) => ({ t: s.t, v: s.v, a: s.a }));
    for (const mk of markers) { const near = rows.reduce((p, c) => Math.abs(c.t - mk.t) < Math.abs(p.t - mk.t) ? c : p, rows[0]); if (near) near.marker = mk.label; }
    window.power.exportCsv('power-capture', rows).then((r) => { if (r && r.ok) toast('Exported CSV.'); });
  }
  function importCsv() {
    window.power.importCsv().then((r) => {
      if (r && r.cancelled) return;
      if (r && r.ok) { samples = r.rows || []; markers.length = 0; draw(); renderVerdict(analyse(samples)); toast('Imported ' + samples.length + ' samples from ' + (r.name || 'CSV') + '.'); }
      else toast('Could not import that file.', true);
    });
  }

  // ---------------- init ----------------
  window.addEventListener('DOMContentLoaded', () => {
    els.connectCard = $('.pw-connect');
    els.connect = $('#pwConnect'); els.disconnect = $('#pwDisconnect'); els.baud = $('#pwBaud'); els.status = $('#pwStatus');
    els.volts = $('#pwVolts'); els.amps = $('#pwAmps'); els.watts = $('#pwWatts');
    els.rawToggle = $('#pwRawToggle'); els.raw = $('#pwRaw');
    els.chart = $('#pwChart'); els.record = $('#pwRecord'); els.marker = $('#pwMarker'); els.clear = $('#pwClear');
    els.recInfo = $('#pwRecInfo'); els.analyse = $('#pwAnalyse'); els.verdict = $('#pwVerdict');
    els.lib = $('#pwLib'); els.libEmpty = $('#pwLibEmpty'); els.matchOut = $('#pwMatchOut');
    if (!els.chart) return;

    if (window.power && window.power.onPorts) window.power.onPorts(portPicker);
    els.connect.addEventListener('click', connect);
    els.disconnect.addEventListener('click', disconnect);
    const copyBtn = $('#pwCopyRaw');
    els.rawToggle.addEventListener('change', () => { const on = els.rawToggle.checked; els.raw.hidden = !on; if (copyBtn) copyBtn.hidden = !on; if (on) renderRaw(); });
    copyBtn && copyBtn.addEventListener('click', () => { toast(copyText(els.raw.textContent || '') ? 'Raw capture copied — paste it to me.' : 'Could not copy.'); });
    els.record.addEventListener('click', toggleRecord);
    els.marker.addEventListener('click', addMarker);
    els.clear.addEventListener('click', clearCapture);
    els.analyse.addEventListener('click', () => renderVerdict(analyse(samples.length ? samples : (lastV != null ? [{ t: 0, v: lastV, a: lastA }] : []))));
    $('#pwSave').addEventListener('click', saveCapture);
    $('#pwMatch').addEventListener('click', matchLibrary);
    $('#pwExport').addEventListener('click', exportCsv);
    $('#pwImport').addEventListener('click', importCsv);
    $('#pwLibDir').addEventListener('click', () => window.power.openDir());
    draw();
    loadLib();
  });
})();
