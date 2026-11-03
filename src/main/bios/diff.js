'use strict';

// Firmware Diff + Pre-flash safety cross-check. Read-only, defensive.
const fs = require('node:fs');
const { parseFirmware } = require('./parse');

function readBuf(p) { try { return fs.readFileSync(p); } catch { return null; } }

// Byte + region diff of two dumps.
function diff(aPath, bPath) {
  const a = readBuf(aPath); const b = readBuf(bPath);
  if (!a) return { ok: false, error: 'Could not read the first file.' };
  if (!b) return { ok: false, error: 'Could not read the second file.' };
  const len = Math.max(a.length, b.length);
  const min = Math.min(a.length, b.length);
  let diffBytes = 0;
  const ranges = [];
  let runStart = -1;
  for (let i = 0; i < min; i++) {
    if (a[i] !== b[i]) { diffBytes++; if (runStart < 0) runStart = i; }
    else if (runStart >= 0) { ranges.push([runStart, i - 1]); runStart = -1; }
  }
  if (runStart >= 0) ranges.push([runStart, min - 1]);
  if (a.length !== b.length) { diffBytes += (len - min); ranges.push([min, len - 1]); }
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] <= 4096) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  const pct = len ? (diffBytes / len * 100) : 0;

  const pa = parseFirmware(aPath);
  const regionChanges = [];
  if (pa.descriptor && pa.descriptor.present) {
    for (const r of pa.descriptor.regions) {
      if (!r.present) continue;
      let changed = 0, tot = 0;
      const end = Math.min(r.limit, min - 1);
      for (let i = r.base; i <= end; i++) { tot++; if (a[i] !== b[i]) changed++; }
      regionChanges.push({ name: r.name, changedPct: tot ? +(changed / tot * 100).toFixed(2) : 0 });
    }
  }

  const summary = [];
  summary.push('A: ' + (a.length / 1048576).toFixed(2) + ' MB   ·   B: ' + (b.length / 1048576).toFixed(2) + ' MB.');
  if (a.length !== b.length) summary.push('Sizes differ — these are not the same chip layout.');
  summary.push(diffBytes === 0 ? 'The two images are IDENTICAL.' : (pct.toFixed(3) + '% of bytes differ (' + diffBytes.toLocaleString() + ' bytes) across ' + merged.length + ' changed region(s).'));
  for (const rc of regionChanges) summary.push('  ' + rc.name + ': ' + rc.changedPct + '% changed' + (rc.changedPct === 0 ? ' (untouched)' : ''));
  if (diffBytes > 0 && regionChanges.length) {
    const biosR = regionChanges.find((r) => r.name === 'BIOS region');
    const meR = regionChanges.find((r) => r.name === 'Intel ME region');
    if (meR && meR.changedPct > 0 && biosR && biosR.changedPct === 0) summary.push('Only the ME region changed — consistent with an ME clean/update.');
    if (biosR && biosR.changedPct > 0 && biosR.changedPct < 2) summary.push('A small BIOS-region change — could be a settings/NVRAM tweak or a targeted modification; inspect in UEFITool.');
  }
  return { ok: true, sizeA: a.length, sizeB: b.length, diffBytes, diffPct: +pct.toFixed(4), identical: diffBytes === 0, ranges: merged.slice(0, 200), rangeCount: merged.length, regionChanges, summary };
}

// Is `candidate` safe to flash onto the board that `target` was read from?
function preflight(targetPath, candidatePath) {
  const t = parseFirmware(targetPath);
  const c = parseFirmware(candidatePath);
  if (!t.ok || !c.ok) return { ok: false, error: 'Could not parse one of the files.' };
  const checks = [];
  const chk = (sev, msg) => checks.push({ sev, msg });

  if (t.size === c.size) chk('good', 'Sizes match (' + t.sizeMB + ' MB).');
  else chk('bad', 'Size MISMATCH — target ' + t.sizeMB + ' MB vs candidate ' + c.sizeMB + ' MB. Never write a different-size image to a full chip.');

  if (t.vendor && c.vendor) chk(t.vendor === c.vendor ? 'good' : 'warn', t.vendor === c.vendor ? ('Same BIOS vendor (' + t.vendor + ').') : ('Vendor differs — target ' + t.vendor + ' vs candidate ' + c.vendor + '.'));

  chk(t.platform === c.platform ? 'good' : 'warn', 'Platform — target ' + t.platform + ' vs candidate ' + c.platform + '.');

  if (t.descriptor.present === c.descriptor.present) chk('good', 'Flash descriptor present on both: ' + (t.descriptor.present ? 'yes' : 'no') + '.');
  else chk('warn', 'Descriptor differs — target ' + (t.descriptor.present ? 'has' : 'no') + ' descriptor, candidate ' + (c.descriptor.present ? 'has' : 'no') + '. OEM updates are often BIOS-region-only; you may need to graft the candidate BIOS into the target’s descriptor + ME before a full-chip write.');

  const tm = (t.identity && t.identity.model) || ''; const cm = (c.identity && c.identity.model) || '';
  if (tm || cm) chk('info', 'Model guess — target: "' + (tm || '?') + '", candidate: "' + (cm || '?') + '". Confirm they are the same board.');

  const bad = checks.filter((x) => x.sev === 'bad').length;
  const warn = checks.filter((x) => x.sev === 'warn').length;
  let verdict, cls;
  if (bad) { verdict = 'DO NOT FLASH as-is — a blocking mismatch was found.'; cls = 'bad'; }
  else if (warn) { verdict = 'Proceed with caution — review the warnings (especially descriptor/ME).'; cls = 'warn'; }
  else { verdict = 'Looks safe — candidate matches the target on the key checks.'; cls = 'good'; }
  return { ok: true, verdict, cls, confidence: bad ? 90 : (warn ? 60 : 85), checks };
}

module.exports = { diff, preflight };
