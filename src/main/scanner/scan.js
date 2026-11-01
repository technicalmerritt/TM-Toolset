'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const rules = require('./rules');

let active = null; // current child process
let cancelledFlag = false;

class ScanError extends Error {
  constructor(message, detail) {
    super(message);
    this.detail = detail || '';
  }
}

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

// Run the read-only PowerShell collector; stream step markers via onProgress.
function collect(onProgress) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'collect.ps1');
    if (!fs.existsSync(script)) {
      reject(new ScanError('Scanner script is missing.', `Expected: ${script}`));
      return;
    }
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];

    let child;
    try {
      child = spawn(powershellPath(), args, { windowsHide: true });
    } catch (e) {
      reject(new ScanError('Could not start PowerShell.', e.message));
      return;
    }
    active = child;
    cancelledFlag = false;

    let out = '';
    const errLines = [];
    let stderrBuf = '';

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      reject(new ScanError('The scan timed out after 3 minutes.', errLines.join('\n')));
    }, 180000);

    function handleStderrLine(line) {
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
      let idx;
      while ((idx = stderrBuf.indexOf('\n')) >= 0) {
        handleStderrLine(stderrBuf.slice(0, idx).replace(/\r$/, ''));
        stderrBuf = stderrBuf.slice(idx + 1);
      }
    });

    child.on('error', (e) => {
      clearTimeout(timer);
      active = null;
      reject(new ScanError('Could not start PowerShell.', e.message));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (stderrBuf) handleStderrLine(stderrBuf.replace(/\r$/, ''));
      active = null;

      if (cancelledFlag) {
        cancelledFlag = false;
        const e = new ScanError('Scan cancelled.');
        e.cancelled = true;
        reject(e);
        return;
      }

      // Tolerant extraction: take everything between the first { and last }.
      const start = out.indexOf('{');
      const end = out.lastIndexOf('}');
      if (start < 0 || end <= start) {
        reject(
          new ScanError(
            'The scanner did not return any data.',
            errLines.join('\n').trim() || `PowerShell exited with code ${code} and produced no output.`
          )
        );
        return;
      }

      let data;
      try {
        data = JSON.parse(out.slice(start, end + 1));
      } catch (e) {
        reject(new ScanError('The scan data could not be read.', [errLines.join('\n'), e.message].filter(Boolean).join('\n')));
        return;
      }
      resolve(data);
    });
  });
}

async function runScan(onProgress) {
  const data = await collect(onProgress);
  if (data && data.__error__) throw new ScanError('The scanner reported an internal error.', String(data.__error__));
  if (onProgress) onProgress('Analysing results…');
  const evaluated = rules.evaluate(data);
  return { data, ...evaluated, generatedAt: data.generatedAt || new Date().toISOString() };
}

function cancel() {
  if (active) {
    cancelledFlag = true;
    try { active.kill(); } catch { /* ignore */ }
    return true;
  }
  return false;
}

// ---- Standalone HTML report (self-contained, printable) ----

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SEV_LABEL = { critical: 'Critical', warning: 'Warning', info: 'Info', ok: 'OK' };
const SEV_COLOR = { critical: '#ff5c6c', warning: '#f3b23c', info: '#4c8dff', ok: '#3ec07a' };

function buildHtmlReport(result) {
  const r = result || {};
  const sys = (r.data && r.data.system) || {};
  const counts = r.counts || {};
  const when = new Date(r.generatedAt || Date.now());

  const findingsHtml = (r.findings || [])
    .map((f) => {
      const color = SEV_COLOR[f.severity] || '#888';
      const detail = f.detail ? `<pre class="detail">${esc(f.detail)}</pre>` : '';
      const rec = f.recommendation ? `<p class="rec"><strong>Recommended:</strong> ${esc(f.recommendation)}</p>` : '';
      return `<div class="finding" style="border-left-color:${color}">
        <div class="fhead"><span class="sev" style="background:${color}">${SEV_LABEL[f.severity] || f.severity}</span>
        <span class="cat">${esc(f.category)}</span><span class="ftitle">${esc(f.title)}</span></div>
        <p class="summary">${esc(f.summary)}</p>${rec}${detail}</div>`;
    })
    .join('\n');

  const scoreColor = r.score >= 80 ? SEV_COLOR.ok : r.score >= 50 ? SEV_COLOR.warning : SEV_COLOR.critical;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>TM Toolset — PC Health Report</title>
<style>
  :root{color-scheme:light}
  body{font:14px/1.55 system-ui,Segoe UI,Roboto,sans-serif;margin:0;background:#f4f5f7;color:#1b1e26}
  .wrap{max-width:900px;margin:0 auto;padding:28px}
  header{display:flex;align-items:center;gap:18px;margin-bottom:8px}
  .score{width:84px;height:84px;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:26px;font-weight:700;background:${scoreColor};flex:0 0 auto}
  h1{font-size:20px;margin:0}
  .muted{color:#6b7280}
  .counts{margin:14px 0 24px;display:flex;gap:8px;flex-wrap:wrap}
  .count{padding:4px 12px;border-radius:999px;color:#fff;font-size:12px;font-weight:600}
  .sysbox{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:14px 18px;margin-bottom:24px;font-size:13px}
  .sysbox div{display:inline-block;margin-right:22px;color:#374151}
  .finding{background:#fff;border:1px solid #e3e6ea;border-left-width:5px;border-radius:8px;padding:14px 16px;margin-bottom:12px}
  .fhead{display:flex;align-items:center;gap:10px;margin-bottom:6px}
  .sev{color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:5px}
  .cat{font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em}
  .ftitle{font-weight:600}
  .summary{margin:4px 0}
  .rec{margin:6px 0;color:#1f6f43}
  .detail{background:#f0f1f4;border-radius:6px;padding:8px 10px;font:12px ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-x:auto;color:#374151}
  footer{color:#9aa2b1;font-size:12px;margin-top:24px;text-align:center}
  @media print{body{background:#fff}.finding,.sysbox{break-inside:avoid}}
</style></head>
<body><div class="wrap">
  <header>
    <div class="score">${esc(r.score)}</div>
    <div><h1>PC Health Report</h1><div class="muted">${esc(r.summary || '')}</div></div>
  </header>
  <div class="counts">
    <span class="count" style="background:${SEV_COLOR.critical}">${esc(counts.critical || 0)} Critical</span>
    <span class="count" style="background:${SEV_COLOR.warning}">${esc(counts.warning || 0)} Warning</span>
    <span class="count" style="background:${SEV_COLOR.info}">${esc(counts.info || 0)} Info</span>
    <span class="count" style="background:${SEV_COLOR.ok}">${esc(counts.ok || 0)} OK</span>
  </div>
  <div class="sysbox">
    <div><strong>Model:</strong> ${esc(sys.manufacturer || '')} ${esc(sys.model || '')}</div>
    <div><strong>OS:</strong> ${esc(sys.caption || '')} ${esc(sys.displayVersion || '')} (build ${esc(sys.buildNumber || '?')})</div>
    <div><strong>Serial:</strong> ${esc(sys.serial || 'n/a')}</div>
    <div><strong>CPU:</strong> ${esc(sys.cpu || '')}</div>
    <div><strong>RAM:</strong> ${esc(sys.ramGB || '?')} GB</div>
  </div>
  ${findingsHtml || '<p class="muted">No findings.</p>'}
  <footer>TM Toolset · Technical Merit — PC Health Report · ${esc(when.toLocaleString())}</footer>
</div></body></html>`;
}

module.exports = { runScan, cancel, buildHtmlReport };
