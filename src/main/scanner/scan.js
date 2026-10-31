'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const rules = require('./rules');

// Run the read-only PowerShell collector and return the parsed data object.
function collect() {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'collect.ps1');
    let cmd = 'powershell.exe';
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];

    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }

    let out = '';
    let err = '';
    const killer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error('The scan timed out after 3 minutes.'));
    }, 180000);

    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(killer);
      reject(new Error(`Could not start PowerShell: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      const text = out.trim();
      if (!text) {
        reject(new Error(err.trim() || `The collector exited (code ${code}) without returning data.`));
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(new Error(`Could not parse scan output: ${e.message}`));
      }
    });
  });
}

async function runScan() {
  const data = await collect();
  const evaluated = rules.evaluate(data);
  return { data, ...evaluated, generatedAt: data.generatedAt || new Date().toISOString() };
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
  <footer>Generated by TM Toolset Issue Scanner · ${esc(when.toLocaleString())}</footer>
</div></body></html>`;
}

module.exports = { runScan, buildHtmlReport };
