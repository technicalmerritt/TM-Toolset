'use strict';

// Expert advisor for a parsed firmware image. Turns the raw facts into a
// plain-English verdict, confidence levels, ranked findings and a guided
// next-steps list. Pure logic, offline — it's the operator's knowledge baked in.

function clampPct(n) { return Math.max(1, Math.min(99, Math.round(n))); }

function analyze(p) {
  if (!p || !p.ok) return { ok: false };
  const F = [];
  const add = (sev, confidence, title, detail, action) => F.push({ sev, confidence, title, detail, action: action || '' });

  const ff = p.integrity ? p.integrity.ffPct : 0;
  const blank = ff >= 95;
  const partial = ff >= 60 && ff < 95;
  const hasVendor = !!p.vendor;
  const hasFV = !!(p.uefi && p.fvs && p.fvs.length);
  const hasDesc = !!(p.descriptor && p.descriptor.present);
  const biosRegion = hasDesc && p.descriptor.regions.some((r) => r.name === 'BIOS region' && r.present);
  const looksBios = hasVendor || hasFV || biosRegion || p.amd;

  let verdictCls = 'info', verdictText = '', confidence = 50;
  if (blank) {
    verdictCls = 'bad'; confidence = 92;
    verdictText = 'This chip reads blank / erased — there is no usable firmware here.';
  } else if (!looksBios) {
    verdictCls = 'warn'; confidence = 68;
    verdictText = "This doesn't look like a BIOS/UEFI image — no vendor, UEFI volumes or flash descriptor were found.";
  } else {
    let sig = 0;
    if (hasVendor) sig++; if (hasFV) sig++; if (hasDesc) sig++; if (p.commonSize) sig++; if (!partial) sig++;
    confidence = clampPct(45 + sig * 11);
    if (partial || !p.commonSize) { verdictCls = 'warn'; verdictText = 'Looks like a BIOS image, but something is off (see findings) — check it before flashing.'; }
    else { verdictCls = 'good'; verdictText = 'Looks like a healthy, complete ' + (p.platform ? p.platform + ' ' : '') + (hasFV ? 'UEFI' : 'BIOS') + ' image.'; }
  }

  add(p.commonSize ? 'good' : 'warn', p.commonSize ? 90 : 80,
    'Image size ' + p.sizeMB + ' MB',
    p.commonSize ? 'A standard SPI flash size.' : 'Not a usual chip size — a full dump is normally 2/4/8/16/32 MB, so this is likely truncated or a single region.',
    p.commonSize ? '' : 'Re-dump with the correct chip/size selected in Xgpro, or treat this as a partial region only.');

  if (hasVendor) add('good', 85, 'BIOS vendor: ' + p.vendor, 'A recognised firmware vendor signature was found — consistent with a real BIOS.');
  else add('info', 60, 'No BIOS vendor signature', 'Could be an ME/region-only dump, a compressed image, or not a BIOS at all.');

  if (hasDesc) {
    const present = p.descriptor.regions.filter((r) => r.present).map((r) => r.name).join(', ');
    add('good', 88, 'Full Intel flash dump', 'Flash descriptor present with regions: ' + present + '. This is a complete chip image.');
  } else if (p.amd) {
    add('good', 80, 'AMD platform', 'AMD PSP firmware detected — there is no Intel ME on this board, so ME cleaning does not apply here.');
  } else {
    add('info', 60, 'No Intel flash descriptor', 'Normal for a BIOS-region-only dump or some AMD boards.');
  }

  if (hasFV) add('good', 80, p.fvs.length + ' UEFI firmware volume(s)', 'Confirms this is UEFI firmware rather than a legacy BIOS.');

  if (p.me && p.me.present) {
    const intact = p.me.partitions && p.me.partitions.length;
    add('info', intact ? 80 : 65, intact ? 'Intel ME firmware present & intact' : 'Intel ME region present',
      intact ? ('An ME partition table was found (' + p.me.partitions.join(', ') + ').') : 'An ME region exists but no partition table was read — it may already be cleaned, or corrupt.',
      'For a factory-fresh image you can optionally Clean the ME region before flashing.');
  }

  if (p.fit) add('warn', 55, 'Intel FIT present (possible Boot Guard)',
    'A Firmware Interface Table was found. If this board has Intel Boot Guard fused, modifying the firmware — including cleaning ME — can stop it booting.',
    'On a Boot-Guard board, flash an unmodified clean OEM image rather than a cleaned one.');

  if (partial) add('bad', 85, 'Image looks partial', Math.round(ff) + '% of the image is blank (0xFF); a good full dump is mostly non-blank.',
    'Re-read the chip in Xgpro — check the chip ID is right and the whole capacity is selected.');

  const steps = [];
  if (blank) {
    steps.push('This chip is empty — you need a known-good image for THIS exact board/model.');
    steps.push('Use "Get Firmware" to search Bad Caps and the OEM for the matching file.');
    steps.push('Write it to the chip with Xgpro on your T76, then verify.');
  } else if (!looksBios) {
    steps.push('Confirm you dumped the right chip at its full size (set the correct chip ID in Xgpro).');
    steps.push('If it really is firmware, open it in UEFITool to inspect it by hand.');
  } else {
    steps.push('Confirm this image matches the board you are repairing (vendor/model and size).');
    if (p.me && p.me.present && !p.fit) steps.push('Optional: Clean the ME region for a fresh, factory-like state.');
    if (p.fit) steps.push('Boot Guard may be present — prefer flashing the clean image AS-IS, not a modified one.');
    steps.push('Use "Full UEFI report" or "Open in UEFITool" if you want to inspect or edit modules.');
    steps.push('Write the final image to the chip with Xgpro on your T76, then verify the write.');
  }

  const order = { bad: 0, warn: 1, good: 2, info: 3 };
  F.sort((a, b) => order[a.sev] - order[b.sev]);

  // "Find a clean BIOS for this" hint, derived from the dump.
  let modelGuess = '';
  for (const s of (p.strings || [])) {
    if (/[0-9]/.test(s) && s.length >= 4 && s.length <= 24 && !/serial|default string|to be filled|version|revision|o\.e\.m|chassis|system|vendor|manufactur/i.test(s)) { modelGuess = s.trim(); break; }
  }
  const vendorClean = (p.vendor || '').replace(/\(.*\)/, '').trim();
  const query = [vendorClean, modelGuess].filter(Boolean).join(' ').trim();
  const search = {
    query: query || vendorClean || '',
    note: modelGuess ? '' : 'The exact model could not be read from the dump — add the board model printed on the PCB to narrow it down.',
  };

  return { ok: true, verdict: { text: verdictText, cls: verdictCls, confidence }, findings: F, nextSteps: steps, search };
}

module.exports = { analyze };
