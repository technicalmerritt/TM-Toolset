'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { runPowerShellScript } = require('../ps-runner');

function psExe() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
  const full = path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    if (fs.existsSync(full)) return full;
  } catch {
    /* ignore */
  }
  return 'powershell.exe';
}

function runList() {
  return runPowerShellScript({ scriptPath: path.join(__dirname, 'list.ps1'), timeoutMs: 60000 });
}

function toggle(item, enable) {
  return new Promise((resolve) => {
    if (!item || !item.type) {
      resolve({ ok: false, message: 'Nothing to toggle.' });
      return;
    }
    const script = path.join(__dirname, 'toggle.ps1');
    if (!fs.existsSync(script)) {
      resolve({ ok: false, message: 'toggle.ps1 is missing.' });
      return;
    }
    let payload;
    try {
      payload = Buffer.from(JSON.stringify(Object.assign({}, item, { enable: !!enable })), 'utf8').toString('base64');
    } catch (e) {
      resolve({ ok: false, message: 'Could not encode the item.' });
      return;
    }

    let child;
    try {
      child = spawn(psExe(), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Payload', payload], { windowsHide: true });
    } catch (e) {
      resolve({ ok: false, message: 'Could not start PowerShell: ' + e.message });
      return;
    }

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      resolve({ ok: false, message: 'Timed out changing that item.' });
    }, 30000);

    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, message: e.message });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const s = out.indexOf('{');
      const e2 = out.lastIndexOf('}');
      if (s < 0 || e2 <= s) {
        resolve({ ok: false, message: err.trim() || 'No response — machine-wide items need administrator rights.' });
        return;
      }
      try {
        resolve(JSON.parse(out.slice(s, e2 + 1)));
      } catch {
        resolve({ ok: false, message: 'Could not read the response.' });
      }
    });
  });
}

module.exports = { runList, toggle };
