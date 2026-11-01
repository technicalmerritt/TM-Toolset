'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

function powershellPath() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const full = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    if (fs.existsSync(full)) return full;
  } catch {
    /* ignore */
  }
  return 'powershell.exe';
}

function runInform(onProgress) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'collect-inform.ps1');
    if (!fs.existsSync(script)) {
      reject(new Error(`Inform script missing: ${script}`));
      return;
    }
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];

    let child;
    try {
      child = spawn(powershellPath(), args, { windowsHide: true });
    } catch (e) {
      reject(new Error('Could not start PowerShell: ' + e.message));
      return;
    }

    let out = '';
    const errLines = [];
    let stderrBuf = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error('Gathering system information timed out after 3 minutes.'));
    }, 180000);

    function handleLine(line) {
      if (!line) return;
      if (line.startsWith('@@STEP@@')) {
        if (onProgress) onProgress(line.slice(8).trim());
      } else if (line.startsWith('@@FATAL@@')) {
        errLines.push(line.slice(9).trim());
      } else {
        errLines.push(line);
      }
    }

    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => {
      stderrBuf += d.toString();
      let i;
      while ((i = stderrBuf.indexOf('\n')) >= 0) {
        handleLine(stderrBuf.slice(0, i).replace(/\r$/, ''));
        stderrBuf = stderrBuf.slice(i + 1);
      }
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error('Could not start PowerShell: ' + e.message));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (stderrBuf) handleLine(stderrBuf.replace(/\r$/, ''));
      const start = out.indexOf('{');
      const end = out.lastIndexOf('}');
      if (start < 0 || end <= start) {
        reject(new Error(errLines.join('\n').trim() || `No data returned (exit code ${code}).`));
        return;
      }
      try {
        resolve(JSON.parse(out.slice(start, end + 1)));
      } catch (e) {
        reject(new Error('Could not read system information: ' + e.message));
      }
    });
  });
}

// ---- Plain-text export (like the original Inform "Export to Text File") ----

function arr(v) {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function buildTextReport(d) {
  d = d || {};
  const L = [];
  const rule = '='.repeat(66);
  const sub = '-'.repeat(40);
  const section = (t) => {
    L.push('', rule, t, rule);
  };
  const kv = (k, v) => {
    if (v === null || v === undefined || v === '') return;
    L.push('    ' + (k + ':').padEnd(20) + ' ' + v);
  };

  L.push('TM Toolset — System Information', 'Generated ' + new Date().toLocaleString());

  const os = d.os || {};
  section('Operating System');
  kv('Name', os.name);
  kv('Edition/Version', [os.displayVersion, os.version].filter(Boolean).join('  '));
  kv('Build', os.build);
  kv('Architecture', os.arch);
  kv('Install date', os.installDate);
  kv('Last boot', os.lastBoot);
  kv('Uptime (hours)', os.uptimeHours);
  kv('Boot mode', os.bootMode);
  kv('Registered user', os.registeredUser);
  kv('Logged-in user', os.loggedInUser);
  kv('Activation', os.activation);

  const c = d.computer || {};
  const cpu = d.cpu || {};
  const b = d.board || {};
  const mem = d.memory || {};
  section('Hardware');
  kv('Manufacturer', c.manufacturer);
  kv('Model', c.model);
  kv('Type', c.systemType);
  kv('Serial', c.serial);
  kv('CPU', cpu.name);
  kv('Cores / threads', [cpu.cores, cpu.logical].filter((x) => x != null).join(' / '));
  kv('Motherboard', [b.manufacturer, b.product].filter(Boolean).join(' '));
  kv('BIOS', [b.biosVersion, b.biosDate].filter(Boolean).join('  '));
  kv('Secure Boot', b.secureBoot === true ? 'On' : b.secureBoot === false ? 'Off' : null);
  kv('TPM present', b.tpm === true ? 'Yes' : b.tpm === false ? 'No' : null);
  kv('Memory', mem.totalGB != null ? mem.totalGB + ' GB' : null);
  for (const m of arr(mem.modules)) {
    L.push('    ' + sub);
    kv('  Slot', m.slot);
    kv('  Capacity', m.capacityGB != null ? m.capacityGB + ' GB' : null);
    kv('  Speed', m.speedMHz ? m.speedMHz + ' MHz' : null);
    kv('  Part', m.partNumber);
  }
  for (const g of arr(d.graphics)) {
    kv('GPU', g.name);
    kv('  Driver', [g.driverVersion, g.driverDate].filter(Boolean).join('  '));
    kv('  Display', [g.resolution, g.refreshHz ? g.refreshHz + ' Hz' : null].filter(Boolean).join('  '));
  }

  section('Disks');
  for (const dk of arr(d.disks)) {
    kv('Drive', [dk.model, dk.media, dk.bus].filter(Boolean).join('  ·  '));
    kv('  Size', dk.sizeGB ? dk.sizeGB + ' GB' : null);
    kv('  Health', dk.health);
    kv('  Wear', dk.wearPct != null ? dk.wearPct + '%' : null);
  }
  for (const v of arr(d.volumes)) {
    kv('Volume', `${v.drive} ${v.label || ''}`.trim());
    kv('  Capacity', `${v.freeGB} GB free of ${v.sizeGB} GB (${v.freePct}%)`);
    kv('  File system', v.fs);
  }

  section('Security');
  const s = d.security || {};
  kv('UAC', s.uac === true ? 'Enabled' : s.uac === false ? 'Disabled' : null);
  kv('Defender real-time', s.defenderRTP === true ? 'On' : s.defenderRTP === false ? 'Off' : null);
  kv('Definitions age', s.defenderSigAge != null ? s.defenderSigAge + ' days' : null);
  for (const f of arr(s.firewall)) kv('Firewall ' + f.profile, f.enabled ? 'On' : 'Off');
  for (const a of arr(s.avProducts)) kv('AV', a.name + (a.active ? ' (active)' : ' (inactive)'));
  kv('BitLocker (system)', s.bitlocker);

  section('Network');
  const n = d.network || {};
  kv('Status', n.status);
  kv('Proxy', n.proxy);
  kv('Hosts entries', n.hostsCount);
  for (const a of arr(n.adapters)) {
    kv('Adapter', a.name);
    kv('  Description', a.desc);
    kv('  Status', a.status);
    kv('  IPv4', a.ipv4);
    kv('  MAC', a.mac);
    kv('  DHCP', a.dhcp);
  }

  section('History');
  const h = d.history || {};
  kv('Restore points', h.restorePoints);
  kv('Shadow copies', h.shadowCopies);
  kv('Crash dumps (BSOD)', h.bsodDumps);
  kv('Unexpected shutdowns (30d)', h.unexpectedShutdowns);
  for (const u of arr(h.usbDevices)) kv('USB device', u);

  const progs = arr(d.programs);
  section(`Installed Programs (${progs.length})`);
  for (const p of progs) {
    L.push('    ' + (p.name || '').toString().slice(0, 50).padEnd(52) + ' ' + [p.version, p.publisher].filter(Boolean).join('  '));
  }

  return L.join('\r\n');
}

module.exports = { runInform, buildTextReport };
