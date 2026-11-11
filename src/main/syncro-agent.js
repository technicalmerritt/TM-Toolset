'use strict';

// Install the Syncro RMM agent on THIS PC for a chosen customer.
//
// Syncro has no API that returns an installer, but its own "Command Line"
// install option is: one installer for the account, run with
//   SyncroSetup.exe --console --customerid <id> [--folderid <id>]
// The technician pastes that installer link once (Settings). The customer id
// comes from the active ticket, so picking a ticket is enough to install the
// agent for the right customer.

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');

// Only ever download an installer from Syncro's own hosts.
const ALLOWED_HOSTS = /(^|\.)(syncromsp\.com|syncrosecure\.com|kabutoservices\.com)$/i;

// The Authenticode publisher the Syncro agent installer must be signed by.
// (Syncro / RepairTech, Inc.; Kaseya is the parent group.) If a real install is
// refused for an unexpected-but-correct publisher, add it here.
const TRUSTED_SIGNER = /(RepairTech|Syncro|Kaseya)/i;

// Accepts either the bare link or the whole command-line snippet copied from
// Syncro (which contains the link). Returns { ok, url } or { ok:false, message }.
function parseInstallerLink(input) {
  const text = String(input || '').trim();
  if (!text) return { ok: false, message: 'Paste the installer link from Syncro.' };
  const m = /https:\/\/[^\s"'<>)]+/i.exec(text);
  if (!m) return { ok: false, message: 'No https:// link found in what was pasted.' };
  let u;
  try { u = new URL(m[0]); } catch { return { ok: false, message: 'That link is not a valid web address.' }; }
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.test(u.hostname)) {
    return { ok: false, message: 'That link is not on a Syncro address (' + u.hostname + '). Copy it from Syncro: New Asset, Command Line.' };
  }
  return { ok: true, url: u.href };
}

function isId(v) { return /^\d{1,12}$/.test(String(v == null ? '' : v)); }

// Arguments for the installer. Never built from free text: ids are digits only.
function buildArgs(customerId, folderId) {
  if (!isId(customerId)) throw new Error('The ticket has no usable customer id.');
  const args = ['--console', '--customerid', String(customerId)];
  if (folderId != null && String(folderId).trim() !== '') {
    if (!isId(folderId)) throw new Error('Policy folder id must be a number.');
    args.push('--folderid', String(folderId).trim());
  }
  return args;
}

function agentPaths() {
  const pf = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'].filter(Boolean);
  const out = [];
  for (const p of pf) { out.push(path.join(p, 'RepairTech', 'Syncro', 'Syncro.Service.exe')); out.push(path.join(p, 'RepairTech', 'Syncro', 'Syncro.App.Runner.exe')); }
  return out;
}
function isInstalled() {
  for (const p of agentPaths()) { try { if (fs.existsSync(p)) return true; } catch { /* ignore */ } }
  return false;
}

async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'TM-Toolset' } });
  if (!res.ok || !res.body) throw new Error('Syncro refused the download (HTTP ' + res.status + '). The installer link in Settings may be out of date.');
  // A redirect must still land on a Syncro-controlled or signed-storage address over https.
  try { if (new URL(res.url).protocol !== 'https:') throw new Error('insecure'); } catch { throw new Error('The download was redirected somewhere unexpected.'); }
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      if (onProgress && total) onProgress('Downloading the installer… ' + Math.round((got / total) * 100) + '%');
    }
  } finally { await new Promise((r) => out.end(r)); }
  if (got < 100 * 1024) throw new Error('The download was only ' + got + ' bytes, which is not an installer. Check the link in Settings.');
  const head = Buffer.alloc(2);
  const fd = fs.openSync(dest, 'r'); try { fs.readSync(fd, head, 0, 2, 0); } finally { fs.closeSync(fd); }
  if (head.toString('latin1') !== 'MZ') throw new Error('The download is not a Windows program. Use the .exe / Command Line link from Syncro, not the MSI or Mac one.');
  return got;
}

// Authenticode check: the file must carry a valid signature before we run it.
function signature(file) {
  return new Promise((resolve) => {
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = "$s = Get-AuthenticodeSignature -LiteralPath $env:TM_FILE; $n = ''; if ($s.SignerCertificate) { $n = $s.SignerCertificate.Subject }; Write-Output ($s.Status.ToString() + '|' + $n)";
    execFile(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30000, env: Object.assign({}, process.env, { TM_FILE: file }) }, (err, stdout) => {
      if (err) { resolve({ status: 'Unknown', signer: '' }); return; }
      const [status, subject] = String(stdout || '').trim().split('|');
      const cn = /CN=("([^"]+)"|[^,]+)/.exec(subject || '');
      resolve({ status: status || 'Unknown', signer: cn ? (cn[2] || cn[1]).trim() : '' });
    });
  });
}

function runInstaller(exe, args, onProgress) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(exe, args, { windowsHide: true }); }
    catch (e) { resolve({ code: -1, output: '', error: e.message }); return; }
    let output = '';
    const take = (d) => { const t = d.toString(); output += t; const last = t.trim().split(/\r?\n/).pop(); if (last && onProgress) onProgress(last.slice(0, 160)); };
    child.stdout.on('data', take); child.stderr.on('data', take);
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } resolve({ code: -1, output, error: 'The installer did not finish within 10 minutes.' }); }, 600000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, output, error: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code: code == null ? -1 : code, output }); });
  });
}

async function install({ url, customerId, folderId, onProgress }) {
  if (process.platform !== 'win32') return { ok: false, message: 'The Syncro agent installer only runs on Windows.' };
  const link = parseInstallerLink(url);
  if (!link.ok) return link;
  let args;
  try { args = buildArgs(customerId, folderId); } catch (e) { return { ok: false, message: e.message }; }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tm-syncro-'));
  const exe = path.join(dir, 'SyncroSetup.exe');
  try {
    if (onProgress) onProgress('Downloading the installer…');
    await download(link.url, exe, onProgress);
    if (onProgress) onProgress('Checking the installer is signed…');
    const sig = await signature(exe);
    if (sig.status !== 'Valid') return { ok: false, message: 'The downloaded installer is not validly signed (' + sig.status + '), so it was not run.' };
    // Defence in depth: a valid signature alone isn't enough — the download
    // follows redirects (Syncro's CDN), so require the publisher to actually be
    // Syncro/RepairTech. A validly-signed binary from anyone else is refused.
    if (!TRUSTED_SIGNER.test(sig.signer || '')) {
      return { ok: false, message: 'The installer is validly signed, but by an unexpected publisher (' + (sig.signer || 'unknown') + ') — not Syncro/RepairTech — so it was NOT run. If this publisher is correct for your Syncro account, let the developer know to allow it.' };
    }
    if (onProgress) onProgress('Installing (signed by ' + (sig.signer || 'unknown') + ')…');
    const r = await runInstaller(exe, args, onProgress);
    const installed = isInstalled();
    if (r.error) return { ok: false, message: r.error, output: r.output.slice(-2000), signer: sig.signer };
    if (r.code !== 0 && !installed) return { ok: false, message: 'The installer exited with code ' + r.code + '.', output: r.output.slice(-2000), signer: sig.signer };
    return { ok: true, installed, exitCode: r.code, signer: sig.signer, output: r.output.slice(-2000), args: args.join(' ') };
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  } finally {
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

module.exports = { parseInstallerLink, buildArgs, isInstalled, install };
