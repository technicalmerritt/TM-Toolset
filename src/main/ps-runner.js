'use strict';

// Shared, robust PowerShell-script runner used by both the scanner and the
// information collectors. Fixes the Windows hang where a child's output pipe
// stays open after the process exits (so 'close' never fires): we finalise on
// 'exit' after a short grace period as well. A hard timeout always resolves the
// promise and reports which step it stalled on.

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

function runPowerShellScript(opts) {
  const { scriptPath, onProgress, onChild, timeoutMs = 120000, scriptArgs } = opts || {};
  return new Promise((resolve, reject) => {
    if (!scriptPath || !fs.existsSync(scriptPath)) {
      reject(new Error('Script not found: ' + scriptPath));
      return;
    }
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    if (Array.isArray(scriptArgs)) {
      for (const a of scriptArgs) args.push(String(a));
    }

    let child;
    try {
      child = spawn(powershellPath(), args, { windowsHide: true });
    } catch (e) {
      reject(new Error('Could not start PowerShell: ' + e.message));
      return;
    }
    if (onChild) {
      try { onChild(child); } catch { /* ignore */ }
    }

    let out = '';
    let stderrBuf = '';
    const errLines = [];
    let lastStep = '';
    let done = false;
    let graceTimer = null;

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      settle(() => reject(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s` + (lastStep ? ` (stalled while: ${lastStep})` : '') + '.')));
    }, timeoutMs);

    function settle(fn) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      fn();
    }

    function handleLine(line) {
      if (!line) return;
      if (line.startsWith('@@STEP@@')) {
        lastStep = line.slice(8).trim();
        if (onProgress) onProgress(lastStep);
      } else if (line.startsWith('@@FATAL@@')) {
        errLines.push(line.slice(9).trim());
      } else {
        errLines.push(line);
      }
    }

    function finalize(code) {
      if (stderrBuf) {
        handleLine(stderrBuf.replace(/\r$/, ''));
        stderrBuf = '';
      }
      const start = out.indexOf('{');
      const end = out.lastIndexOf('}');
      if (start < 0 || end <= start) {
        settle(() => reject(new Error(errLines.join('\n').trim() || `No data returned (exit code ${code}; last step: ${lastStep || 'n/a'}).`)));
        return;
      }
      let data;
      try {
        data = JSON.parse(out.slice(start, end + 1));
      } catch (e) {
        // Surface the exact region so a malformed value is diagnosable.
        let extra = '';
        const mp = /position (\d+)/.exec(e.message || '');
        if (mp) {
          const p = start + Number(mp[1]);
          extra = '  ←near: ' + JSON.stringify(out.slice(Math.max(0, p - 70), p + 30));
        }
        settle(() => reject(new Error('Could not read data: ' + e.message + extra)));
        return;
      }
      settle(() => resolve(data));
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
    child.on('error', (e) => settle(() => reject(new Error('Could not start PowerShell: ' + e.message))));
    child.on('close', (code) => finalize(code));
    // Fallback: if stdio pipes stay open after the process exits, finalise anyway.
    child.on('exit', (code) => {
      if (done) return;
      graceTimer = setTimeout(() => finalize(code), 1200);
    });
  });
}

module.exports = { runPowerShellScript };
