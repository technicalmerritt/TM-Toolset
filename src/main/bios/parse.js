'use strict';

// Plain-English reader for a dumped BIOS/UEFI SPI flash image.
// Best-effort, defensive parsing of: Intel flash descriptor + regions,
// Intel ME ($FPT) presence/partitions, UEFI firmware volumes (_FVH),
// BIOS vendor signatures, readable identity strings, and integrity checks.
// All read-only; never throws (returns notes instead).
const fs = require('node:fs');

function idx(buf, str, from) { return buf.indexOf(Buffer.from(str, 'latin1'), from || 0); }

function parseDescriptor(buf) {
  try {
    if (buf.length < 0x1000) return { present: false };
    if (buf.readUInt32LE(0x10) !== 0x0FF0A55A) return { present: false };
    const flmap0 = buf.readUInt32LE(0x14);
    const frba = ((flmap0 >> 16) & 0xFF) << 4;
    const names = ['Flash Descriptor', 'BIOS region', 'Intel ME region', 'Gigabit LAN (GbE)', 'Platform Data'];
    const regions = [];
    for (let i = 0; i < 5; i++) {
      const off = frba + i * 4;
      if (off + 4 > buf.length) break;
      const reg = buf.readUInt32LE(off);
      const base = (reg & 0x7FFF) << 12;
      const limit = (((reg >> 16) & 0x7FFF) << 12) | 0xFFF;
      const present = !(base > limit) && reg !== 0xFFFFFFFF && reg !== 0;
      regions.push({ name: names[i], base, limit, present, sizeKB: present ? Math.round((limit - base + 1) / 1024) : 0 });
    }
    return { present: true, frba, regions };
  } catch { return { present: false }; }
}

function parseMe(buf, meRegion) {
  const out = { present: false, partitions: [], note: '' };
  try {
    let searchFrom = 0, searchTo = buf.length;
    if (meRegion && meRegion.present) { searchFrom = meRegion.base; searchTo = Math.min(buf.length, meRegion.limit + 1); out.present = true; out.base = meRegion.base; out.sizeKB = meRegion.sizeKB; }
    // $FPT partition table
    let p = idx(buf, '$FPT', searchFrom);
    if (p < 0 || p > searchTo) { if (out.present) out.note = 'ME region present but no $FPT table found (may be cleaned/neutralised).'; return out; }
    out.present = true;
    if (out.base == null) out.base = p;
    const num = buf.readUInt32LE(p + 4);
    const entries = Math.min(num, 40);
    const parts = [];
    let e = p + 0x20;
    for (let i = 0; i < entries; i++) {
      if (e + 32 > buf.length) break;
      const name = buf.slice(e, e + 4).toString('latin1').replace(/\0+$/,'').replace(/[^\x20-\x7E]/g,'');
      if (name) parts.push(name);
      e += 32;
    }
    out.partitions = parts;
  } catch { /* ignore */ }
  return out;
}

function scanFirmwareVolumes(buf) {
  const vols = [];
  try {
    let from = 0;
    for (let n = 0; n < 64; n++) {
      const sig = idx(buf, '_FVH', from);
      if (sig < 0) break;
      const fvStart = sig - 0x28;
      if (fvStart >= 0 && fvStart + 0x30 <= buf.length) {
        let len = 0;
        try { len = Number(buf.readBigUInt64LE(fvStart + 0x20)); } catch { len = 0; }
        if (len > 0 && len < buf.length * 2) vols.push({ offset: fvStart, sizeKB: Math.round(len / 1024) });
      }
      from = sig + 4;
    }
  } catch { /* ignore */ }
  return vols;
}

function detectVendor(buf) {
  const sigs = [
    ['AMI (American Megatrends)', ['American Megatrends', 'AMIBIOS', '_AMIPFAT', 'AMITSE']],
    ['Insyde (InsydeH2O)', ['InsydeH2O', 'INSYDE Corp', '$IBIOSI$']],
    ['Phoenix', ['Phoenix Technologies', 'PhoenixBIOS', 'Phoenix SecureCore']],
    ['Award', ['Award Software', 'Award Modular BIOS']],
  ];
  for (const [label, needles] of sigs) {
    for (const nd of needles) { if (idx(buf, nd) >= 0) return label; }
  }
  return '';
}

function interestingStrings(buf) {
  // Pull readable ASCII runs and surface identity-ish ones.
  const found = new Set();
  try {
    const re = /[\x20-\x7E]{5,40}/g;
    const text = buf.toString('latin1');
    let m;
    const keywords = /(serial|product|version|revision|model|chassis|vendor|manufactur|baseboard|system|notebook|to be filled|default string|o\.e\.m)/i;
    while ((m = re.exec(text)) !== null) {
      const s = m[0].trim();
      if (keywords.test(s) && s.length >= 5) { found.add(s); if (found.size > 60) break; }
    }
  } catch { /* ignore */ }
  return Array.from(found).slice(0, 40);
}

function integrity(buf) {
  const notes = [];
  let ff = 0, zero = 0;
  const step = Math.max(1, Math.floor(buf.length / 200000)); // sample for speed
  let sampled = 0;
  for (let i = 0; i < buf.length; i += step) { const b = buf[i]; if (b === 0xFF) ff++; else if (b === 0x00) zero++; sampled++; }
  const ffPct = Math.round((ff / sampled) * 100);
  const zeroPct = Math.round((zero / sampled) * 100);
  if (ffPct >= 95) notes.push('The chip looks ERASED / blank (almost all 0xFF) — nothing useful to read.');
  else if (ffPct >= 60) notes.push('A large part of the image is blank (0xFF) — the dump may be partial or the chip partly erased.');
  const mb = buf.length / (1024 * 1024);
  if (![1, 2, 4, 8, 16, 32, 64].includes(Math.round(mb))) notes.push('Unusual image size (' + mb.toFixed(2) + ' MB) — a full SPI dump is normally 2/4/8/16/32 MB; this may be truncated.');
  return { ffPct, zeroPct, notes };
}

function detectAmd(buf, descPresent) {
  try {
    if (idx(buf, '$PSP') >= 0 || idx(buf, '$BHD') >= 0) return true;        // AMD PSP / BIOS directories
    if (!descPresent && idx(buf, 'AGESA') >= 0) return true;                // AMD AGESA firmware
  } catch { /* ignore */ }
  return false;
}

function guessModel(strings) {
  for (const s of (strings || [])) {
    if (/[0-9]/.test(s) && s.length >= 4 && s.length <= 24 && !/serial|default string|to be filled|version|revision|o\.e\.m|chassis|^system$|vendor|manufactur/i.test(s)) return s.trim();
  }
  return '';
}

// Onboard NIC MAC is the first 6 bytes of the Intel GbE region, when present.
function extractGbeMac(buf, desc) {
  try {
    if (!desc || !desc.present) return '';
    const g = desc.regions.find((r) => r.name === 'Gigabit LAN (GbE)' && r.present);
    if (!g || g.base + 6 > buf.length) return '';
    const parts = [];
    for (let i = 0; i < 6; i++) parts.push(buf[g.base + i].toString(16).padStart(2, '0'));
    const s = parts.join(':').toUpperCase();
    if (s === 'FF:FF:FF:FF:FF:FF' || s === '00:00:00:00:00:00') return '';
    return s;
  } catch { return ''; }
}

function parseFirmware(filePath) {
  const out = { ok: false, file: filePath };
  let buf;
  try { buf = fs.readFileSync(filePath); } catch (e) { return { ok: false, error: 'Could not read file: ' + e.message }; }
  out.ok = true;
  out.size = buf.length;
  out.sizeMB = +(buf.length / (1024 * 1024)).toFixed(2);

  const desc = parseDescriptor(buf);
  out.descriptor = desc;
  const meRegion = desc.present ? desc.regions.find((r) => r.name === 'Intel ME region') : null;
  out.me = parseMe(buf, meRegion);
  out.vendor = detectVendor(buf);
  out.fvs = scanFirmwareVolumes(buf);
  out.uefi = out.fvs.length > 0;
  out.strings = interestingStrings(buf);
  out.integrity = integrity(buf);
  out.amd = detectAmd(buf, desc.present);
  out.fit = idx(buf, '_FIT_') >= 0;        // Intel Firmware Interface Table (Boot Guard uses it)
  out.platform = desc.present ? 'Intel' : (out.amd ? 'AMD' : (out.me.present ? 'Intel' : 'Unknown'));
  const mb = Math.round(out.sizeMB);
  out.commonSize = [1, 2, 4, 8, 16, 32, 64].includes(mb);
  out.identity = {
    vendor: out.vendor || (out.amd ? 'AMD platform' : ''),
    model: guessModel(out.strings),
    mac: extractGbeMac(buf, desc),
    candidates: (out.strings || []).slice(0, 20),
  };

  // Plain-English summary
  const s = [];
  s.push('Image is ' + out.sizeMB + ' MB (' + out.size.toLocaleString() + ' bytes).');
  if (out.vendor) s.push('BIOS vendor looks like ' + out.vendor + '.');
  s.push(out.uefi ? ('UEFI firmware — ' + out.fvs.length + ' firmware volume(s) found.') : 'No UEFI firmware volumes found — may be a legacy BIOS, a non-UEFI region, or not a full image.');
  if (desc.present) {
    const present = desc.regions.filter((r) => r.present).map((r) => r.name).join(', ');
    s.push('Intel flash descriptor present. Regions: ' + (present || 'none decoded') + '.');
  } else {
    s.push('No Intel flash descriptor (this is normal for AMD boards or a BIOS-region-only dump).');
  }
  if (out.me.present) {
    s.push('Intel ME firmware present' + (out.me.sizeKB ? (' (~' + Math.round(out.me.sizeKB / 1024) + ' MB region)') : '') + (out.me.partitions.length ? (', partitions: ' + out.me.partitions.join(', ')) : '') + '.');
    if (out.me.note) s.push(out.me.note);
    else s.push('You can neutralise/clean this ME region from the Tools section (me_cleaner).');
  } else if (desc.present) {
    s.push('No Intel ME partition table found — the ME region may already be cleaned, or absent.');
  }
  for (const n of out.integrity.notes) s.push(n);
  out.summary = s;
  return out;
}

module.exports = { parseFirmware };
