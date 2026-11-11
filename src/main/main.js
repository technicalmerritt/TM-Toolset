'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const { runPowerShellScript } = require('./ps-runner');
const scanner = require('./scanner/scan');
const inform = require('./inform/inform');
const actions = require('./actions');
const settings = require('./settings');
const syncro = require('./syncro');
const startup = require('./startup/startup');
const drives = require('./drives/drives');
const news = require('./news/news');
const driverpacks = require('./drivers/driverpacks');
const licensing = require('./license/verify');
const idevice = require('./idevice/idevice');
const netspeed = require('./net/speed');
const biosparse = require('./bios/parse');
const biosanalyze = require('./bios/analyze');
const biosdiff = require('./bios/diff');

let mainWindow = null;
let packChild = null;        // current aria2/7za child for the network-pack fetch
let packCancelled = false;
let serialSelectCb = null;   // pending Web Serial port-selection callback

// On Windows, `net session` succeeds only when running elevated.
function isElevated() {
  if (process.platform !== 'win32') return true;
  try {
    execFileSync('net', ['session'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

// Portable data dir: prefer a folder NEXT TO the executable (so a USB stick
// carries the tool list + downloaded tools with it); fall back to userData when
// the app folder isn't writable (e.g. installed under Program Files).
let _dataDir = null;
function getDataDir() {
  if (_dataDir) return _dataDir;
  const candidates = [];
  try { candidates.push(path.join(path.dirname(process.execPath), 'TM-Toolset-Data')); } catch { /* ignore */ }
  try { candidates.push(app.getPath('userData')); } catch { /* ignore */ }
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const probe = path.join(dir, '.writetest');
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      _dataDir = dir;
      return dir;
    } catch { /* not writable, try next */ }
  }
  _dataDir = app.getPath('userData');
  return _dataDir;
}
function getToolkitDir() {
  const d = path.join(getDataDir(), 'Tools');
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  return d;
}
function getConfigPath() {
  return path.join(getDataDir(), 'tools.json');
}

// Direct-download sources for recommended tools we can reliably fetch.
const TOOL_DL = {
  autoruns: { dl: 'https://live.sysinternals.com/Autoruns64.exe', file: 'Autoruns64.exe' },
  procexp: { dl: 'https://live.sysinternals.com/procexp64.exe', file: 'procexp64.exe' },
  procmon: { dl: 'https://live.sysinternals.com/Procmon64.exe', file: 'Procmon64.exe' },
  rufus: { gh: 'pbatard/rufus', match: '^rufus-[0-9.]+\\.exe$' },
  crystaldiskinfo: { dl: 'https://sourceforge.net/projects/crystaldiskinfo/files/latest/download', file: 'CrystalDiskInfo-setup.exe' },
  crystaldiskmark: { dl: 'https://sourceforge.net/projects/crystaldiskmark/files/latest/download', file: 'CrystalDiskMark-setup.exe' },
};

async function resolveDownload(id) {
  const t = TOOL_DL[id];
  if (!t) throw new Error('No direct download configured for this tool.');
  if (t.dl) return { url: t.dl, file: t.file || (id + '.exe') };
  if (t.gh) {
    const res = await fetch('https://api.github.com/repos/' + t.gh + '/releases/latest', {
      headers: { 'User-Agent': 'TM-Toolset', 'Accept': 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error('GitHub API returned ' + res.status);
    const j = await res.json();
    const re = new RegExp(t.match, 'i');
    const asset = (j.assets || []).find((a) => re.test(a.name));
    if (!asset) throw new Error('No matching download in the latest release.');
    return { url: asset.browser_download_url, file: asset.name };
  }
  throw new Error('No direct download available.');
}

async function downloadToFile(url, destPath, onProgress) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'TM-Toolset/1.0' } });
  if (!res.ok) throw new Error('Download failed (HTTP ' + res.status + ').');
  const total = Number(res.headers.get('content-length')) || 0;
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  const out = fs.createWriteStream(destPath);
  const reader = res.body.getReader();
  let received = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      if (onProgress) onProgress(total ? Math.round((received / total) * 100) : -1, received, total);
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  return { bytes: received };
}

// Salvage the first complete top-level JSON object from a string, ignoring any
// trailing junk. Lets us recover a config that an older build corrupted by
// racing writes (which produced "{...}{...}" or a half-written tail).
function recoverFirstJson(raw) {
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}') { depth--; if (depth === 0 && start >= 0) { try { return JSON.parse(raw.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

async function readConfig() {
  let raw;
  try {
    raw = await fsp.readFile(getConfigPath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { tools: [] };
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    // Corrupted file (older build's concurrent-write race). Back it up, then
    // recover the first valid object so licence/settings survive if possible.
    try { await fsp.writeFile(getConfigPath() + '.corrupt-' + Date.now(), raw); } catch { /* ignore */ }
    data = recoverFirstJson(raw);
    if (data && typeof data === 'object') { try { await writeConfig(data); } catch { /* ignore */ } }
    else data = { tools: [] };
  }
  if (!data || typeof data !== 'object') return { tools: [] };
  if (!Array.isArray(data.tools)) data.tools = [];
  return data;
}

// Serialized atomic writes with a unique temp name, so concurrent callers can
// never clobber each other's temp file (the bug that corrupted tools.json).
let _cfgWriteChain = Promise.resolve();
async function writeConfig(config) {
  const run = async () => {
    const file = getConfigPath();
    const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(config, null, 2), 'utf8');
    await fsp.rename(tmp, file);
  };
  _cfgWriteChain = _cfgWriteChain.then(run, run);
  return _cfgWriteChain;
}

// Let the Syncro settings store persist into the portable tools.json (so
// credentials travel on the USB stick) using the serialized atomic writer.
settings.configure({ readConfig, writeConfig });

// Point the Apple-device tool runner at the portable data dir, so installed
// libimobiledevice tools live on the USB stick and travel with it.
idevice.configure({ dataDir: getDataDir() });

// ---- Driver library location (stored in the portable config) ----
async function getDriverLib() {
  try {
    const cfg = await readConfig();
    if (cfg.driverLibrary && typeof cfg.driverLibrary === 'string') return cfg.driverLibrary;
  } catch { /* ignore */ }
  return path.join(getDataDir(), 'DriverLibrary');
}

// ---- Licensing (offline signed keys + machine id + trial) ----
const TRIAL_DAYS = 14;
let _machineId = null;
function getMachineId() {
  if (_machineId) return _machineId;
  let base = '';
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { windowsHide: true }).toString();
    const m = /MachineGuid\s+REG_SZ\s+([\w-]+)/i.exec(out);
    if (m) base = m[1];
  } catch { /* ignore */ }
  if (!base) {
    try {
      const os = require('node:os');
      const ifs = os.networkInterfaces();
      let mac = '';
      for (const k of Object.keys(ifs)) { for (const ni of ifs[k]) { if (ni.mac && ni.mac !== '00:00:00:00:00:00' && !ni.internal) { mac = ni.mac; break; } } if (mac) break; }
      base = os.hostname() + '|' + mac;
    } catch { base = 'unknown-host'; }
  }
  const h = crypto.createHash('sha256').update('TMTS1|' + base).digest('hex').slice(0, 20).toUpperCase();
  _machineId = h.replace(/(.{5})(?=.)/g, '$1-');
  return _machineId;
}
async function licenseStatus() {
  const mid = getMachineId();
  const cfg = await readConfig();
  const lic = cfg.license ? licensing.verifyLicense(cfg.license) : null;
  if (lic) {
    if (lic.expires && Date.now() > Date.parse(lic.expires)) return { state: 'expired', reason: 'Licence expired on ' + lic.expires + '.', name: lic.name, email: lic.email, machineId: mid };
    // Machine binding is optional and only used for special one-off keys. Normal
    // per-user licences carry no `machine`, so they work on every PC the tech uses.
    if (lic.machine && lic.machine !== mid) return { state: 'invalid', reason: 'This licence is locked to a different machine.', machineId: mid };
    return { state: 'licensed', name: lic.name || '', email: lic.email || '', expires: lic.expires || '', seats: lic.seats || 0, machineId: mid };
  }
  let first = cfg.firstRun;
  if (!first) { first = new Date().toISOString(); cfg.firstRun = first; await writeConfig(cfg); }
  const daysLeft = TRIAL_DAYS - Math.floor((Date.now() - Date.parse(first)) / 86400000);
  if (daysLeft > 0) return { state: 'trial', daysLeft, machineId: mid };
  return { state: 'unlicensed', reason: 'The ' + TRIAL_DAYS + '-day trial has ended.', machineId: mid };
}

// ---- Self-update from GitHub Releases (public repo, no secrets needed) ----
// Checks the latest release, and - only while licensed or on trial - downloads
// the code-only update asset, extracts it with the bundled 7za, overwrites the
// app's own source (never the bundled tool binaries), then relaunches.
const UPDATE_REPO = 'technicalmerritt/tm-toolset';
const UPDATE_BRANCH = 'main';
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
async function getUpdateRepo() { try { const c = await readConfig(); return (c.updateRepo && String(c.updateRepo).trim()) || UPDATE_REPO; } catch { return UPDATE_REPO; } }
function sendUpdateProgress(m) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:progress', m); }
async function fetchJsonFresh(repo) {
  // Prefer GitHub's contents API with the raw media type: it reflects a new
  // commit immediately (no CDN lag). Fall back to raw.githubusercontent.com if
  // the API is unreachable or rate-limited (60/hr unauthenticated is plenty for
  // a desktop app, but the fallback keeps it working regardless).
  const apiUrl = 'https://api.github.com/repos/' + repo + '/contents/update/latest.json?ref=' + UPDATE_BRANCH;
  const rawUrl = 'https://raw.githubusercontent.com/' + repo + '/' + UPDATE_BRANCH + '/update/latest.json?t=' + Date.now();
  async function get(url, accept) {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'TM-Toolset', Accept: accept, 'Cache-Control': 'no-cache' } });
      clearTimeout(to);
      if (res.status === 404) throw new Error('No update manifest published yet.');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { clearTimeout(to); throw e; }
  }
  try { return await get(apiUrl, 'application/vnd.github.raw+json'); }
  catch (e) { if (/No update manifest/.test(e.message)) throw e; return await get(rawUrl, 'application/json'); }
}
async function checkForUpdate() {
  const repo = await getUpdateRepo();
  const man = await fetchJsonFresh(repo);
  const latest = man.version || '';
  const current = app.getVersion();
  // The payload is a versioned filename, so the raw CDN can serve it safely
  // (a new version is always a new URL that was never cached).
  const base = 'https://raw.githubusercontent.com/' + repo + '/' + UPDATE_BRANCH + '/update/';
  let assetUrl = man.zip || '';
  if (assetUrl && !/^https?:\/\//i.test(assetUrl)) assetUrl = base + assetUrl.replace(/^\.?\//, '');
  return { current, latest, newer: cmpVer(latest, current) > 0, notes: String(man.notes || '').slice(0, 4000), assetUrl, assetName: 'update', pageUrl: man.page || ('https://github.com/' + repo + '/commits/' + UPDATE_BRANCH) };
}
async function downloadTo(url, destPath, onProgress) {
  const res = await fetch(url, { headers: { 'User-Agent': 'TM-Toolset', Accept: 'application/octet-stream' } });
  if (!res.ok || !res.body) throw new Error('Download failed (HTTP ' + res.status + ').');
  const total = Number(res.headers.get('content-length') || 0);
  let got = 0;
  const out = fs.createWriteStream(destPath);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    out.write(Buffer.from(value));
    if (onProgress) onProgress(total ? Math.round(got / total * 100) : -1, got, total);
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
}
function run7z(args) {
  return new Promise((resolve, reject) => {
    const exe = path.join(__dirname, 'drivers', 'bin', '7za.exe');
    const p = spawn(exe, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Extract failed (7za ' + code + '). ' + err))));
  });
}
// Copy every file from srcDir into dstDir, but never a folder named "bin"
// (those hold the bundled tool executables, which updates must not touch).
async function copyTree(srcDir, dstDir) {
  const entries = await fsp.readdir(srcDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'bin' || e.name === 'node_modules') continue;
    const s = path.join(srcDir, e.name), d = path.join(dstDir, e.name);
    if (e.isDirectory()) { await fsp.mkdir(d, { recursive: true }); await copyTree(s, d); }
    else { await fsp.copyFile(s, d); }
  }
}
async function applyUpdate() {
  const st = await licenseStatus();
  if (st.state !== 'licensed' && st.state !== 'trial') return { ok: false, reason: 'Updating needs an active licence or a running trial.' };
  const appDir = app.getAppPath();
  if (/\.asar$/i.test(appDir)) return { ok: false, reason: 'This build is packed (asar) and cannot self-update in place. Use the full download.' };
  const info = await checkForUpdate();
  if (!info.newer) return { ok: false, reason: 'already-latest', info };
  if (!info.assetUrl) return { ok: false, reason: 'The latest release has no update file attached. Use the full download from the Releases page.' };
  const tmp = path.join(app.getPath('temp'), 'tmts-update-' + Date.now());
  await fsp.mkdir(tmp, { recursive: true });
  const zipPath = path.join(tmp, 'update.zip');
  sendUpdateProgress({ phase: 'download', pct: 0 });
  await downloadTo(info.assetUrl, zipPath, (pct, got, total) => sendUpdateProgress({ phase: 'download', pct, got, total }));
  sendUpdateProgress({ phase: 'extract', pct: -1 });
  const exDir = path.join(tmp, 'x');
  await fsp.mkdir(exDir, { recursive: true });
  await run7z(['x', zipPath, '-o' + exDir, '-y']);
  // Locate the payload root (the folder holding package.json).
  let root = exDir;
  if (!fs.existsSync(path.join(root, 'package.json'))) {
    if (fs.existsSync(path.join(exDir, 'app', 'package.json'))) root = path.join(exDir, 'app');
    else {
      const ds = (await fsp.readdir(exDir, { withFileTypes: true })).filter((d) => d.isDirectory());
      for (const d of ds) { if (fs.existsSync(path.join(exDir, d.name, 'package.json'))) { root = path.join(exDir, d.name); break; } }
    }
  }
  sendUpdateProgress({ phase: 'install', pct: -1 });
  await copyTree(root, appDir);
  try { await fsp.rm(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  tmLog('update', 'applied', 'ok', info.current + ' -> ' + info.latest);
  sendUpdateProgress({ phase: 'done', pct: 100 });
  setTimeout(() => { try { app.relaunch(); } catch { /* ignore */ } app.exit(0); }, 700);
  return { ok: true, info };
}

// ---- Central activity log (audit trail of what the app did) ----
function getLogsDir() { const d = path.join(getDataDir(), 'logs'); try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } return d; }
function tmLog(category, action, status, detail) {
  try {
    const line = '[' + new Date().toISOString() + '] [' + (category || '') + '] ' + (action || '')
      + (status ? ('  ->  ' + status) : '') + (detail ? ('  |  ' + String(detail).replace(/[\r\n]+/g, ' ').slice(0, 400)) : '') + '\n';
    fs.appendFileSync(path.join(getLogsDir(), 'activity.log'), line);
  } catch { /* logging must never break the app */ }
}

// ---- Recommended-tools feed: bundled list, optionally refreshed from a URL ----
async function loadToolsFeed() {
  let feed = { updated: '', tools: [] };
  try { feed = JSON.parse(fs.readFileSync(path.join(__dirname, 'tools', 'feed.json'), 'utf8')); } catch { /* ignore */ }
  let source = 'bundled';
  let url = '';
  try { const cfg = await readConfig(); if (cfg.toolsFeedUrl && typeof cfg.toolsFeedUrl === 'string') url = cfg.toolsFeedUrl.trim(); } catch { /* ignore */ }
  const cachePath = path.join(getDataDir(), 'tools-feed-cache.json');
  if (url) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'TM-Toolset' } });
      clearTimeout(to);
      if (res.ok) {
        const remote = await res.json();
        if (remote && Array.isArray(remote.tools)) { feed = remote; source = 'remote'; try { fs.writeFileSync(cachePath, JSON.stringify(remote)); } catch { /* ignore */ } }
      }
    } catch {
      try { if (fs.existsSync(cachePath)) { const c = JSON.parse(fs.readFileSync(cachePath, 'utf8')); if (c && Array.isArray(c.tools)) { feed = c; source = 'cache'; } } } catch { /* ignore */ }
    }
  }
  return { feed, source };
}

// ---- Microsoft 365 "What's new + training" feed: bundled, optional remote refresh ----
async function loadM365Feed() {
  let feed = { updated: '', updates: [], courses: [], resources: [] };
  try { feed = JSON.parse(fs.readFileSync(path.join(__dirname, 'm365', 'feed.json'), 'utf8')); } catch { /* ignore */ }
  let source = 'bundled';
  let url = '';
  try { const cfg = await readConfig(); if (cfg.m365FeedUrl && typeof cfg.m365FeedUrl === 'string') url = cfg.m365FeedUrl.trim(); } catch { /* ignore */ }
  const cachePath = path.join(getDataDir(), 'm365-feed-cache.json');
  if (url) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'TM-Toolset' } });
      clearTimeout(to);
      if (res.ok) {
        const remote = await res.json();
        if (remote && Array.isArray(remote.updates)) { feed = remote; source = 'remote'; try { fs.writeFileSync(cachePath, JSON.stringify(remote)); } catch { /* ignore */ } }
      }
    } catch {
      try { if (fs.existsSync(cachePath)) { const c = JSON.parse(fs.readFileSync(cachePath, 'utf8')); if (c && Array.isArray(c.updates)) { feed = c; source = 'cache'; } } } catch { /* ignore */ }
    }
  }
  return { feed, source };
}

// Live pull of Microsoft's own public 365 roadmap (no auth). Best-effort: if the
// tech is offline or Microsoft changes the API, we just report that and fall
// back to the curated summaries. Returns the newest items, lightly cleaned.
function stripHtml(s) { return String(s || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim(); }
async function fetchM365Roadmap() {
  const url = 'https://www.microsoft.com/releasecommunications/api/v1/m365';
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 9000);
  let items;
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) TM-Toolset', Accept: 'application/json' } });
    clearTimeout(to);
    if (!res.ok) throw new Error('Roadmap API returned HTTP ' + res.status);
    items = await res.json();
  } catch (e) { clearTimeout(to); throw e; }
  if (!Array.isArray(items)) throw new Error('Unexpected roadmap response.');
  const pickDate = (it) => it.modified || it.created || it.publicDisclosureAvailabilityDate || '';
  const out = items.map((it) => {
    const tags = Array.isArray(it.tags) ? it.tags.map((t) => (t && (t.tagName || t.name)) || '').filter(Boolean) : [];
    const products = tags.filter((t, i) => tags.indexOf(t) === i).slice(0, 6);
    const desc = stripHtml(it.description);
    return {
      id: String(it.id || it.featureId || ''),
      title: stripHtml(it.title),
      desc: desc.length > 320 ? (desc.slice(0, 317) + '...') : desc,
      status: stripHtml(it.status),
      modified: pickDate(it),
      tags: products,
      url: it.id ? ('https://www.microsoft.com/en-us/microsoft-365/roadmap?id=' + it.id) : 'https://www.microsoft.com/en-us/microsoft-365/roadmap'
    };
  }).filter((x) => x.title);
  out.sort((a, b) => Date.parse(b.modified || 0) - Date.parse(a.modified || 0));
  return out.slice(0, 20);
}

function sendDriversProgress(msg) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('drivers:progress', msg);
}
async function reindexDriverLib(lib) {
  await runPowerShellScript({ scriptPath: path.join(__dirname, 'drivers', 'library.ps1'), scriptArgs: ['-Action', 'index', '-Lib', lib], timeoutMs: 1800000 }).catch(() => {});
}
// Remember which driverpack categories the tech has chosen, so the auto-update
// switch knows what to keep current ('*' = everything).
async function addPackScope(cats) {
  const cfg = await readConfig();
  const cur = Array.isArray(cfg.packsScope) ? cfg.packsScope : [];
  const inc = (cats || []).map((c) => ('' + c).toLowerCase());
  let next;
  if (inc.indexOf('*') >= 0 || cur.indexOf('*') >= 0) next = ['*'];
  else next = Array.from(new Set(cur.concat(inc)));
  cfg.packsScope = next;
  await writeConfig(cfg);
  return next;
}

// When the "keep packs up to date" switch is on, quietly fetch any new/updated
// packs in the remembered scope a few seconds after launch, so the offline
// library stays current without the tech doing anything.
function maybeAutoUpdatePacks() {
  setTimeout(async () => {
    try {
      const cfg = await readConfig();
      if (!cfg.packsAuto) return;
      const scope = Array.isArray(cfg.packsScope) ? cfg.packsScope : [];
      if (!scope.length) return;
      const lib = await getDriverLib();
      sendDriversProgress('Auto-update: checking your driverpacks are current…');
      const r = await driverpacks.checkUpdates({ lib, scope, onProgress: sendDriversProgress, onChild: (c) => { packChild = c; } });
      if (r.added) await reindexDriverLib(lib);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('drivers:autoDone', r);
    } catch { /* best-effort; never blocks startup */ } finally { packChild = null; }
  }, 9000);
}

// ---- Microsoft Update Catalog: search + resolve direct download links ----
// Best-effort HTML scrape of the public catalog (no official API exists). The
// layout can change; failures are reported, never fatal.
async function catalogSearch(query) {
  if (!query) return [];
  const url = 'https://www.catalog.update.microsoft.com/Search.aspx?q=' + encodeURIComponent(query);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) TM-Toolset' } });
  if (!res.ok) throw new Error('Catalog returned HTTP ' + res.status);
  const html = await res.text();
  const out = [];
  const seen = new Set();
  const re = /id="([0-9a-fA-F-]{36})_link"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const title = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (title) out.push({ id, title });
  }
  return out;
}

function expandCab(cab, dir) {
  return new Promise((resolve, reject) => {
    const c = spawn('expand.exe', ['-F:*', cab, dir], { windowsHide: true });
    c.on('error', reject);
    c.on('close', (code) => (code === 0 ? resolve() : reject(new Error('expand exit ' + code))));
  });
}

async function catalogDownload(id, title, lib, onProgress) {
  const body = 'updateIDs=' + encodeURIComponent(JSON.stringify([{ size: 0, languages: '', uidInfo: id, updateID: id }]));
  const res = await fetch('https://www.catalog.update.microsoft.com/DownloadDialog.aspx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0) TM-Toolset' },
    body,
  });
  if (!res.ok) throw new Error('Download dialog HTTP ' + res.status);
  const txt = await res.text();
  const urls = [];
  const seen = new Set();
  const re = /(https?:\/\/[^'"\s]+\.(?:cab|exe|msi|msu|zip))/gi;
  let m;
  while ((m = re.exec(txt)) !== null) { if (!seen.has(m[1])) { seen.add(m[1]); urls.push(m[1]); } }
  if (!urls.length) throw new Error('No download link found (the catalog layout may have changed).');
  const safe = (title || id).replace(/[^\w.() -]+/g, '_').slice(0, 80).trim() || id;
  const destDir = path.join(lib, 'catalog_' + safe);
  await fsp.mkdir(destDir, { recursive: true });
  const files = [];
  for (const u of urls) {
    const fname = (decodeURIComponent(u.split('/').pop().split('?')[0]) || 'driver.bin').replace(/[^\w.() -]+/g, '_');
    const dest = path.join(destDir, fname);
    if (onProgress) onProgress('Downloading ' + fname + ' …');
    await downloadToFile(u, dest, (pct) => { if (onProgress && pct >= 0 && pct % 10 === 0) onProgress('Downloading ' + fname + ' … ' + pct + '%'); });
    files.push(dest);
    if (/\.cab$/i.test(dest)) {
      if (onProgress) onProgress('Expanding ' + fname + ' …');
      await expandCab(dest, destDir).catch(() => {});
    }
  }
  return { destDir, files };
}

function sanitizeTool(input) {
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  return {
    id: str(input.id) || crypto.randomUUID(),
    name: str(input.name),
    description: str(input.description),
    path: str(input.path),
    args: str(input.args),
    cwd: str(input.cwd),
    category: str(input.category),
  };
}

// Split an argument string into argv, honouring double quotes.
function parseArgs(argString) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(argString)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return out;
}

// ---- App icon (window + taskbar), can follow the theme or a custom pick ----
// value: '' or 'default' = the bundled TM icon; 'oaklands' = bundled tree icon;
// a data: URL = a custom image; anything else = a path under src/.
function resolveAppIcon(value) {
  try {
    if (!value || value === 'default') return nativeImage.createFromPath(path.join(__dirname, '..', 'icon.png'));
    if (value === 'oaklands') return nativeImage.createFromPath(path.join(__dirname, '..', 'icons', 'oaklands-icon.png'));
    if (/^data:/i.test(value)) return nativeImage.createFromDataURL(value);
    return nativeImage.createFromPath(path.join(__dirname, '..', value));
  } catch { return null; }
}
function applyAppIcon(value) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const img = resolveAppIcon(value);
  if (img && !img.isEmpty()) { try { mainWindow.setIcon(img); } catch { /* ignore */ } }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 540,
    backgroundColor: '#0e1b33',
    show: false,
    title: 'TM Toolset',
    icon: path.join(__dirname, '..', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Apply the saved per-theme app icon (window + taskbar) once we have a window.
  readConfig().then((cfg) => { const t = cfg.theme || {}; if (t.appIcon) applyAppIcon(t.appIcon); }).catch(() => {});
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open any target=_blank / external links in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Allow the microphone (for the Feedback tab's dictation / voice memos) but
  // deny everything else by default.
  try {
    mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'media' || permission === 'audioCapture' || permission === 'serial');
    });
  } catch { /* ignore */ }

  // Web Serial for the PLD USB-C power meter (Board Repair > Power Signatures).
  try {
    const ses = mainWindow.webContents.session;
    ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial' || permission === 'media');
    ses.setDevicePermissionHandler((d) => d.deviceType === 'serial');
    ses.on('select-serial-port', (event, portList, _wc, callback) => {
      event.preventDefault();
      serialSelectCb = callback;
      const list = (portList || []).map((p) => ({ id: p.portId, name: p.portName || '', display: p.displayName || p.portName || ('Port ' + p.portId), vendorId: p.vendorId, productId: p.productId }));
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('power:ports', list);
    });
  } catch { /* ignore */ }
}

function registerIpc() {
  ipcMain.handle('tools:list', async () => {
    const config = await readConfig();
    return config.tools;
  });

  ipcMain.handle('tools:save', async (_evt, toolInput) => {
    const tool = sanitizeTool(toolInput || {});
    if (!tool.name) throw new Error('Tool name is required.');
    if (!tool.path) throw new Error('Executable path is required.');
    const config = await readConfig();
    const idx = config.tools.findIndex((t) => t.id === tool.id);
    if (idx >= 0) config.tools[idx] = tool;
    else config.tools.push(tool);
    await writeConfig(config);
    return tool;
  });

  ipcMain.handle('tools:delete', async (_evt, id) => {
    const config = await readConfig();
    config.tools = config.tools.filter((t) => t.id !== id);
    await writeConfig(config);
    return true;
  });

  ipcMain.handle('tools:launch', async (_evt, id) => {
    const config = await readConfig();
    const tool = config.tools.find((t) => t.id === id);
    if (!tool) throw new Error('Tool not found.');
    if (!tool.path || !fs.existsSync(tool.path)) {
      throw new Error(`Executable not found:\n${tool.path}`);
    }
    const cwd = tool.cwd && fs.existsSync(tool.cwd) ? tool.cwd : path.dirname(tool.path);
    const child = spawn(tool.path, parseArgs(tool.args), {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: false,
    });
    child.on('error', (err) => {
      if (mainWindow) {
        mainWindow.webContents.send('tools:launch-error', { id, message: err.message });
      }
    });
    child.unref();
    return true;
  });

  ipcMain.handle('dialog:pickExe', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select tool executable',
      properties: ['openFile'],
      filters: [
        { name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'com'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select working directory',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  // Where the portable data lives + whether it is next to the exe (USB-portable).
  ipcMain.handle('tools:dataInfo', async () => {
    const dir = getDataDir();
    let portable = false;
    try { portable = path.dirname(dir) === path.dirname(process.execPath); } catch { /* ignore */ }
    return { dir, toolkit: getToolkitDir(), portable };
  });

  // Download a recommended tool directly. dest: 'usb' (into the toolkit + add to
  // My Tools) or 'pc' (into the Downloads folder).
  ipcMain.handle('tools:download', async (_evt, args) => {
    const id = String((args && args.id) || '');
    const name = String((args && args.name) || id);
    const dest = (args && args.dest) === 'pc' ? 'pc' : 'usb';
    const onProgress = (pct, received, total) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('tools:download-progress', { id, pct, received, total });
    };
    try {
      const { url, file } = await resolveDownload(id);
      const safe = name.replace(/[^\w.() -]+/g, '_').trim() || id;
      let destPath;
      if (dest === 'usb') {
        destPath = path.join(getToolkitDir(), safe, file);
      } else {
        destPath = path.join(app.getPath('downloads'), file);
      }
      await downloadToFile(url, destPath, onProgress);
      let tool = null;
      if (dest === 'usb') {
        const config = await readConfig();
        // replace an existing entry with the same name, else add
        tool = sanitizeTool({ name, path: destPath, category: 'Downloaded tools' });
        config.tools = config.tools.filter((t) => (t.path || '').toLowerCase() !== destPath.toLowerCase());
        config.tools.push(tool);
        await writeConfig(config);
      }
      return { ok: true, dest, path: destPath, tool, portable: path.dirname(getDataDir()) === path.dirname(process.execPath) };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // Copy a file the user already downloaded into the portable toolkit + add it.
  ipcMain.handle('tools:importFile', async (_evt, args) => {
    const name = String((args && args.name) || '').trim();
    try {
      const picked = await dialog.showOpenDialog(mainWindow, {
        title: 'Choose the downloaded tool to add',
        properties: ['openFile'],
        filters: [{ name: 'Programs', extensions: ['exe', 'bat', 'cmd', 'com', 'msi'] }, { name: 'All files', extensions: ['*'] }],
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
      const src = picked.filePaths[0];
      const base = path.basename(src);
      const label = name || base.replace(/\.[^.]+$/, '');
      const safe = label.replace(/[^\w.() -]+/g, '_').trim() || 'tool';
      const destPath = path.join(getToolkitDir(), safe, base);
      await fsp.mkdir(path.dirname(destPath), { recursive: true });
      await fsp.copyFile(src, destPath);
      const config = await readConfig();
      const tool = sanitizeTool({ name: label, path: destPath, category: 'Downloaded tools' });
      config.tools = config.tools.filter((t) => (t.path || '').toLowerCase() !== destPath.toLowerCase());
      config.tools.push(tool);
      await writeConfig(config);
      return { ok: true, path: destPath, tool };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Recommended-tools dynamic feed ----
  ipcMain.handle('tools:feed', async () => {
    try {
      const { feed, source } = await loadToolsFeed();
      const tools = Array.isArray(feed.tools) ? feed.tools : [];
      const cfg = await readConfig();
      const seen = Array.isArray(cfg.seenToolIds) ? cfg.seenToolIds : null;
      const allIds = tools.map((t) => String(t.id)).filter(Boolean);
      let newIds = [];
      if (seen === null) { cfg.seenToolIds = allIds; await writeConfig(cfg); } // first run: seed, nothing "new"
      else { newIds = allIds.filter((id) => seen.indexOf(id) < 0); }
      return { ok: true, tools, updated: feed.updated || '', source, newIds };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('tools:markSeen', async (_evt, args) => {
    const ids = Array.isArray(args && args.ids) ? args.ids.map(String) : [];
    const cfg = await readConfig();
    const seen = Array.isArray(cfg.seenToolIds) ? cfg.seenToolIds : [];
    cfg.seenToolIds = Array.from(new Set(seen.concat(ids)));
    await writeConfig(cfg);
    return { ok: true };
  });
  // ---- White-label theme (brand + colours + logo) ----
  ipcMain.handle('theme:get', async () => { const cfg = await readConfig(); return { theme: cfg.theme || null }; });
  ipcMain.handle('theme:set', async (_evt, args) => { const cfg = await readConfig(); cfg.theme = (args && args.theme) || null; await writeConfig(cfg); return { ok: true }; });
  // Apply an app icon (window + taskbar) live when the theme changes.
  ipcMain.handle('theme:appIcon', async (_evt, args) => { applyAppIcon(String((args && args.value) || '')); return { ok: true }; });
  // Let the user choose a custom app icon image; returned as a PNG data URL.
  ipcMain.handle('theme:pickAppIcon', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choose an app icon', properties: ['openFile'], filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'ico', 'bmp', 'gif', 'webp'] }] });
    if (r.canceled || !r.filePaths[0]) return { cancelled: true };
    try {
      const img = nativeImage.createFromPath(r.filePaths[0]);
      if (img.isEmpty()) return { ok: false, error: 'bad-image' };
      // Normalise to a 256px square PNG so it behaves as an icon everywhere.
      const resized = img.resize({ width: 256, height: 256, quality: 'best' });
      return { ok: true, data: resized.toDataURL() };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('theme:pickLogo', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choose a logo image', properties: ['openFile'], filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'] }] });
    if (r.canceled || !r.filePaths[0]) return { cancelled: true };
    try {
      const p = r.filePaths[0];
      const buf = await fsp.readFile(p);
      if (buf.length > 2 * 1024 * 1024) return { ok: false, error: 'too-big' };
      const ext = path.extname(p).slice(1).toLowerCase();
      const mime = ext === 'svg' ? 'image/svg+xml' : (ext === 'jpg' ? 'image/jpeg' : 'image/' + ext);
      return { ok: true, data: 'data:' + mime + ';base64,' + buf.toString('base64') };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('tools:getFeedUrl', async () => { const cfg = await readConfig(); return { url: cfg.toolsFeedUrl || '' }; });
  ipcMain.handle('tools:setFeedUrl', async (_evt, args) => { const cfg = await readConfig(); cfg.toolsFeedUrl = String((args && args.url) || '').trim(); await writeConfig(cfg); return { ok: true }; });

  // ---- Microsoft 365: what's new (curated) + training + live roadmap ----
  ipcMain.handle('m365:feed', async () => {
    try {
      const { feed, source } = await loadM365Feed();
      const updates = Array.isArray(feed.updates) ? feed.updates : [];
      const cfg = await readConfig();
      const seen = Array.isArray(cfg.seenM365Ids) ? cfg.seenM365Ids : null;
      const allIds = updates.map((u) => String(u.id)).filter(Boolean);
      let newIds = [];
      if (seen === null) { cfg.seenM365Ids = allIds; await writeConfig(cfg); }
      else { newIds = allIds.filter((id) => seen.indexOf(id) < 0); }
      return { ok: true, updates, courses: Array.isArray(feed.courses) ? feed.courses : [], resources: Array.isArray(feed.resources) ? feed.resources : [], updated: feed.updated || '', note: feed.note || '', source, newIds };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('m365:markSeen', async (_evt, args) => {
    const ids = Array.isArray(args && args.ids) ? args.ids.map(String) : [];
    const cfg = await readConfig();
    const seen = Array.isArray(cfg.seenM365Ids) ? cfg.seenM365Ids : [];
    cfg.seenM365Ids = Array.from(new Set(seen.concat(ids)));
    await writeConfig(cfg);
    return { ok: true };
  });
  ipcMain.handle('m365:roadmap', async () => {
    try { return { ok: true, items: await fetchM365Roadmap() }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('m365:getFeedUrl', async () => { const cfg = await readConfig(); return { url: cfg.m365FeedUrl || '' }; });
  ipcMain.handle('m365:setFeedUrl', async (_evt, args) => { const cfg = await readConfig(); cfg.m365FeedUrl = String((args && args.url) || '').trim(); await writeConfig(cfg); return { ok: true }; });

  // ---- Feedback log: bugs/ideas the tech jots down, batched for review later ----
  function fbPath() { return path.join(getDataDir(), 'feedback.json'); }
  async function fbRead() { try { return JSON.parse(await fsp.readFile(fbPath(), 'utf8')); } catch { return { items: [] }; } }
  async function fbWrite(d) { await fsp.writeFile(fbPath(), JSON.stringify(d, null, 2)); }
  ipcMain.handle('feedback:list', async () => { const d = await fbRead(); return { ok: true, items: Array.isArray(d.items) ? d.items : [] }; });
  ipcMain.handle('feedback:add', async (_evt, args) => {
    const d = await fbRead(); if (!Array.isArray(d.items)) d.items = [];
    const item = {
      id: 'fb' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type: (args && args.type) === 'idea' ? 'idea' : 'bug',
      text: String((args && args.text) || '').trim(),
      audio: (args && args.audio) ? String(args.audio) : '',
      where: String((args && args.where) || '').trim(),
      status: 'open',
      created: new Date().toISOString()
    };
    if (!item.text && !item.audio) return { ok: false, error: 'empty' };
    d.items.unshift(item); await fbWrite(d);
    tmLog('feedback', 'added', 'ok', item.type + ': ' + item.text.slice(0, 80));
    return { ok: true, item };
  });
  ipcMain.handle('feedback:update', async (_evt, args) => {
    const d = await fbRead(); const it = (d.items || []).find((x) => x.id === (args && args.id));
    if (!it) return { ok: false, error: 'not-found' };
    if (args.text != null) it.text = String(args.text).trim();
    if (args.type) it.type = args.type === 'idea' ? 'idea' : 'bug';
    if (args.status) it.status = args.status === 'done' ? 'done' : 'open';
    await fbWrite(d); return { ok: true, item: it };
  });
  ipcMain.handle('feedback:remove', async (_evt, args) => {
    const d = await fbRead(); const before = (d.items || []).length;
    d.items = (d.items || []).filter((x) => x.id !== (args && args.id));
    await fbWrite(d);
    // Best-effort: drop any linked voice memo.
    try { const it = args && args.audioPath; if (it) await fsp.unlink(it); } catch { /* ignore */ }
    return { ok: true, removed: before - d.items.length };
  });
  ipcMain.handle('feedback:saveAudio', async (_evt, args) => {
    try {
      const dir = path.join(getDataDir(), 'feedback-audio');
      await fsp.mkdir(dir, { recursive: true });
      const b64 = String((args && args.data) || '').replace(/^data:[^,]*,/, '');
      const name = 'memo-' + Date.now() + '.webm';
      const full = path.join(dir, name);
      await fsp.writeFile(full, Buffer.from(b64, 'base64'));
      return { ok: true, path: full };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('feedback:playAudio', async (_evt, args) => {
    const p = String((args && args.path) || '');
    if (p && fs.existsSync(p)) { shell.openPath(p); return { ok: true }; }
    return { ok: false, error: 'missing' };
  });
  ipcMain.handle('feedback:openDir', async () => { shell.openPath(getDataDir()); return { ok: true }; });

  ipcMain.handle('config:reveal', async () => {
    const file = getConfigPath();
    // Ensure the file exists so the OS can highlight it.
    if (!fs.existsSync(file)) await writeConfig(await readConfig());
    shell.showItemInFolder(file);
    return true;
  });

  // ---- Issue Scanner ----
  ipcMain.handle('scan:run', async () => {
    const onProgress = (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan:progress', msg);
    };
    try {
      const result = await scanner.runScan(onProgress);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        cancelled: !!(err && err.cancelled),
        error: (err && err.message) || String(err),
        detail: (err && err.detail) || '',
      };
    }
  });

  ipcMain.handle('scan:cancel', async () => scanner.cancel());

  ipcMain.handle('scan:export', async (_evt, result) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Save health report',
      defaultPath: `TM-Toolset-Health-Report-${stamp}.html`,
      filters: [{ name: 'HTML report', extensions: ['html'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fsp.writeFile(res.filePath, scanner.buildHtmlReport(result), 'utf8');
    return res.filePath;
  });

  // ---- Information (system inventory) ----
  ipcMain.handle('inform:run', async () => {
    const onProgress = (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('inform:progress', msg);
    };
    try {
      const data = await inform.runInform(onProgress);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  ipcMain.handle('inform:export', async (_evt, data) => {
    const stamp = new Date().toISOString().slice(0, 10);
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Export system information',
      defaultPath: `TM-Toolset-System-Info-${stamp}.txt`,
      filters: [{ name: 'Text file', extensions: ['txt'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await fsp.writeFile(res.filePath, inform.buildTextReport(data), 'utf8');
    return res.filePath;
  });

  // ---- Open a whitelisted Windows location / doc link from a finding ----
  ipcMain.handle('action:open', async (_evt, token) => actions.openToken(String(token || '')));
  ipcMain.handle('action:openUrl', async (_evt, url) => actions.openUrl(String(url || '')));

  // ---- Drive health ----
  ipcMain.handle('drives:list', async () => {
    try {
      const data = await drives.runDrives();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Per-drive surface test (sampled raw read across the whole disk) ----
  ipcMain.handle('drives:surface', async (_evt, args) => {
    const disk = String((args && args.disk) != null ? args.disk : 0);
    const onProgress = (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('drives:test-progress', { kind: 'surface', disk, msg });
    };
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'drives', 'surfacetest.ps1'),
        scriptArgs: ['-Disk', disk],
        onProgress,
        timeoutMs: 1800000,
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Per-drive speed test (sequential read, + write to a temp file) ----
  ipcMain.handle('drives:speed', async (_evt, args) => {
    const disk = String((args && args.disk) != null ? args.disk : 0);
    const onProgress = (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('drives:test-progress', { kind: 'speed', disk, msg });
    };
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'drives', 'speedtest.ps1'),
        scriptArgs: ['-Disk', disk],
        onProgress,
        timeoutMs: 300000,
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Fake / counterfeit capacity test (write-verify fill test) ----
  ipcMain.handle('drives:capacity', async (_evt, args) => {
    const p = String((args && args.path) || '');
    const maxGB = Number((args && args.maxGB) || 0) || 0;
    const onProgress = (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('drives:test-progress', { kind: 'capacity', path: p, msg });
    };
    const scriptArgs = ['-Path', p];
    if (maxGB > 0) scriptArgs.push('-MaxGB', String(maxGB));
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'drives', 'capacitytest.ps1'),
        scriptArgs,
        onProgress,
        timeoutMs: 21600000, // up to 6h for a full large-drive test
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  ipcMain.handle('drives:capacityCancel', async () => {
    try {
      const tmp = process.env.TEMP || process.env.TMP || require('node:os').tmpdir();
      await fsp.writeFile(path.join(tmp, 'TM-CAPTEST.cancel'), 'x');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ---- Crash analysis (blue-screen history, plain English) ----
  ipcMain.handle('crash:list', async () => {
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'crash', 'crash.ps1'),
        timeoutMs: 90000,
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Save the customer report as a standalone HTML file ----
  ipcMain.handle('report:saveHtml', async (_evt, args) => {
    const html = String((args && args.html) || '');
    const suggested = String((args && args.name) || 'TM-Toolset-Report') + '.html';
    try {
      const picked = await dialog.showSaveDialog(mainWindow, {
        title: 'Save customer report',
        defaultPath: suggested,
        filters: [{ name: 'HTML page', extensions: ['html'] }],
      });
      if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
      await fsp.writeFile(picked.filePath, html, 'utf8');
      return { ok: true, path: picked.filePath };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Industry news (RSS aggregation) ----
  ipcMain.handle('news:fetch', async () => {
    try {
      return await news.fetchNews();
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Battery health ----
  ipcMain.handle('battery:list', async () => {
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'battery', 'battery.ps1'),
        timeoutMs: 60000,
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Drivers & problem devices ----
  ipcMain.handle('devices:list', async () => {
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'devices', 'devices.ps1'),
        timeoutMs: 60000,
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Disk tools: cleanup (scan/clean) + disk-usage explorer ----
  const dtProgress = (kind) => (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('disktools:progress', { kind, msg });
  };
  ipcMain.handle('cleanup:scan', async () => {
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'disktools', 'cleanup.ps1'),
        scriptArgs: ['-Mode', 'scan'],
        onProgress: dtProgress('cleanup'),
        timeoutMs: 300000,
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
  ipcMain.handle('cleanup:clean', async (_evt, args) => {
    const ids = String((args && args.ids) || '');
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'disktools', 'cleanup.ps1'),
        scriptArgs: ['-Mode', 'clean', '-Ids', ids],
        onProgress: dtProgress('cleanup'),
        timeoutMs: 600000,
      });
      tmLog('cleanup', 'clean junk (' + ids + ')', (data && data.error) ? 'error' : 'ok', (data && data.totalFreed != null) ? ('freed ' + data.totalFreed + ' bytes') : '');
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
  ipcMain.handle('disktools:volumes', async () => {
    try {
      const data = await runPowerShellScript({ scriptPath: path.join(__dirname, 'disktools', 'volumes.ps1'), timeoutMs: 30000 });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
  ipcMain.handle('disktools:usbspeed', async (_evt, args) => {
    const p = String((args && args.path) || '');
    const sizeMB = Number((args && args.sizeMB) || 256) || 256;
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'disktools', 'usbspeed.ps1'),
        scriptArgs: ['-Path', p, '-SizeMB', String(sizeMB)],
        onProgress: dtProgress('usbspeed'),
        timeoutMs: 1800000,
      });
      return { ok: true, data };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('disktools:usbspeedCancel', async () => {
    try {
      const tmp = process.env.TEMP || process.env.TMP || require('node:os').tmpdir();
      await fsp.writeFile(path.join(tmp, 'TM-SPEEDTEST.cancel'), 'x');
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('diskusage:scan', async (_evt, args) => {
    const p = String((args && args.path) || 'C:\\');
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'disktools', 'diskusage.ps1'),
        scriptArgs: ['-Path', p],
        onProgress: dtProgress('usage'),
        timeoutMs: 1200000,
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Backup, Imaging & Cloning ----
  const backupProgress = (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backup:progress', msg);
  };

  ipcMain.handle('backup:map', async () => {
    try {
      const data = await runPowerShellScript({ scriptPath: path.join(__dirname, 'backup', 'map.ps1'), timeoutMs: 90000 });
      return { ok: true, data };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  // Create or apply an image (systemimage / capture / apply) with live output.
  ipcMain.handle('backup:image', async (_evt, args) => {
    const a = args || {};
    const scriptArgs = ['-Mode', String(a.mode || '')];
    if (a.source)  scriptArgs.push('-Source', String(a.source));
    if (a.target)  scriptArgs.push('-Target', String(a.target));
    if (a.name)    scriptArgs.push('-Name', String(a.name));
    if (a.applyTo) scriptArgs.push('-ApplyTo', String(a.applyTo));
    if (a.index != null)   scriptArgs.push('-Index', String(a.index));
    if (a.confirm) scriptArgs.push('-Confirm', String(a.confirm));
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'backup', 'image.ps1'),
        scriptArgs,
        onProgress: backupProgress,
        timeoutMs: 10800000, // up to 3 hours for a large image
      });
      tmLog('backup', String(a.mode || 'image'), (data && data.ok) ? 'ok' : ('err ' + ((data && data.error) || (data && data.exitCode))), a.target || a.applyTo || a.source || '');
      return { ok: true, data };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  ipcMain.handle('backup:mount', async (_evt, args) => {
    const a = args || {};
    const scriptArgs = ['-Action', String(a.action || 'mount')];
    if (a.imagePath) scriptArgs.push('-ImagePath', String(a.imagePath));
    if (a.index != null) scriptArgs.push('-Index', String(a.index));
    if (a.mountDir)  scriptArgs.push('-MountDir', String(a.mountDir));
    try {
      const data = await runPowerShellScript({ scriptPath: path.join(__dirname, 'backup', 'mount.ps1'), scriptArgs, timeoutMs: 300000 });
      return { ok: true, data };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  ipcMain.handle('backup:partition', async (_evt, args) => {
    const a = args || {};
    const scriptArgs = ['-Action', String(a.action || '')];
    if (a.disk != null) scriptArgs.push('-Disk', String(a.disk));
    if (a.part != null) scriptArgs.push('-Part', String(a.part));
    if (a.newLetter)    scriptArgs.push('-NewLetter', String(a.newLetter));
    if (a.newLabel != null) scriptArgs.push('-NewLabel', String(a.newLabel));
    if (a.sizeMB != null)   scriptArgs.push('-SizeMB', String(a.sizeMB));
    if (a.fsType)  scriptArgs.push('-FsType', String(a.fsType));
    if (a.confirm) scriptArgs.push('-Confirm', String(a.confirm));
    try {
      const data = await runPowerShellScript({ scriptPath: path.join(__dirname, 'backup', 'partition.ps1'), scriptArgs, timeoutMs: 1200000 });
      tmLog('partition', String(a.action || ''), (data && data.ok) ? 'ok' : ('err ' + (data && data.error)), 'disk ' + a.disk + ' part ' + a.part);
      return { ok: true, data };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  ipcMain.handle('backup:pickImage', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose an image to mount or restore',
      properties: ['openFile'],
      filters: [{ name: 'Disk images', extensions: ['wim', 'vhdx', 'vhd', 'iso'] }, { name: 'All files', extensions: ['*'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('backup:pickSaveWim', async (_evt, args) => {
    const suggested = (String((args && args.name) || 'TM-image').replace(/[^\w.() -]+/g, '_').trim() || 'TM-image') + '.wim';
    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Save captured image as',
      defaultPath: suggested,
      filters: [{ name: 'Windows image', extensions: ['wim'] }],
    });
    return r.canceled ? null : r.filePath;
  });

  ipcMain.handle('backup:openPath', async (_evt, p) => {
    try { await shell.openPath(String(p || '')); return true; } catch { return false; }
  });

  ipcMain.handle('backup:bootRecovery', async () => {
    try {
      spawn('shutdown.exe', ['/r', '/o', '/t', '8'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ---- Drivers (offline library, scan/match/fix, Windows Update, catalog) ----
  const driversProgress = (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('drivers:progress', msg);
  };

  ipcMain.handle('drivers:getLibrary', async () => ({ path: await getDriverLib() }));
  ipcMain.handle('drivers:setLibrary', async (_evt, args) => {
    const p = String((args && args.path) || '').trim();
    if (!p) return { ok: false };
    const cfg = await readConfig();
    cfg.driverLibrary = p;
    await writeConfig(cfg);
    try { await fsp.mkdir(p, { recursive: true }); } catch { /* ignore */ }
    return { ok: true, path: p };
  });

  ipcMain.handle('drivers:scan', async () => {
    const lib = await getDriverLib();
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'drivers', 'scan.ps1'),
        scriptArgs: ['-Lib', lib],
        timeoutMs: 240000,
      });
      return { ok: true, data };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  ipcMain.handle('drivers:library', async (_evt, args) => {
    const a = args || {};
    const lib = await getDriverLib();
    const scriptArgs = ['-Action', String(a.action || ''), '-Lib', lib];
    if (a.source) scriptArgs.push('-Source', String(a.source));
    if (a.inf)    scriptArgs.push('-Inf', String(a.inf));
    if (a.target) scriptArgs.push('-Target', String(a.target));
    if (a.image)  scriptArgs.push('-Image', String(a.image));
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'drivers', 'library.ps1'),
        scriptArgs,
        onProgress: driversProgress,
        timeoutMs: 3600000, // up to 1h (big libraries / injects)
      });
      return { ok: true, data };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  ipcMain.handle('drivers:wu', async (_evt, args) => {
    const mode = String((args && args.mode) || 'scan');
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'drivers', 'wu.ps1'),
        scriptArgs: ['-Mode', mode],
        onProgress: driversProgress,
        timeoutMs: 1800000,
      });
      return { ok: true, data };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  ipcMain.handle('drivers:catalogSearch', async (_evt, args) => {
    try { return { ok: true, results: await catalogSearch(String((args && args.query) || '')) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  ipcMain.handle('drivers:catalogDownload', async (_evt, args) => {
    const a = args || {};
    const lib = await getDriverLib();
    try {
      const r = await catalogDownload(String(a.id || ''), String(a.title || ''), lib, driversProgress);
      await runPowerShellScript({ scriptPath: path.join(__dirname, 'drivers', 'library.ps1'), scriptArgs: ['-Action', 'index', '-Lib', lib], timeoutMs: 900000 }).catch(() => {});
      return { ok: true, destDir: r.destDir, files: r.files.length };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  ipcMain.handle('drivers:openLibrary', async () => {
    const lib = await getDriverLib();
    try { await fsp.mkdir(lib, { recursive: true }); } catch { /* ignore */ }
    shell.openPath(lib);
    return true;
  });

  ipcMain.handle('drivers:pickFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choose a folder', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  // ---- Snappy Driver Installer integration (bundle + drive via CLI) ----
  ipcMain.handle('drivers:getSdi', async () => {
    const cfg = await readConfig();
    const packs = (cfg.sdioPacks && typeof cfg.sdioPacks === 'string') ? cfg.sdioPacks : path.join(await getDriverLib(), 'SDI-DriverPacks');
    const exe = (cfg.sdioExe && typeof cfg.sdioExe === 'string') ? cfg.sdioExe : '';
    return { exe, packs, exists: !!(exe && fs.existsSync(exe)) };
  });
  ipcMain.handle('drivers:setSdi', async (_evt, args) => {
    const a = args || {};
    const cfg = await readConfig();
    if (typeof a.exe === 'string') cfg.sdioExe = a.exe;
    if (typeof a.packs === 'string') cfg.sdioPacks = a.packs;
    await writeConfig(cfg);
    return { ok: true };
  });
  ipcMain.handle('drivers:pickSdiExe', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Locate SDIO (Snappy Driver Installer) executable',
      properties: ['openFile'],
      filters: [{ name: 'SDIO', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('drivers:launchSdi', async (_evt, args) => {
    const a = args || {};
    const cfg = await readConfig();
    const exe = (a.exe || cfg.sdioExe || '').trim();
    const packs = (a.packs || cfg.sdioPacks || path.join(await getDriverLib(), 'SDI-DriverPacks')).trim();
    if (!exe || !fs.existsSync(exe)) return { ok: false, error: 'not-found' };
    try { await fsp.mkdir(packs, { recursive: true }); } catch { /* ignore */ }
    const sdioArgs = ['-drp_dir:' + packs, '-index_dir:' + path.join(packs, 'indexes')];
    if (a.mode === 'checkupdates') sdioArgs.push('-checkupdates');
    try {
      spawn(exe, sdioArgs, { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false }).unref();
      return { ok: true, packs };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Built-in BitTorrent driverpack fetch (aria2 + 7za) -> extract -> re-index.
  // List the packs available in the torrent (idx / name / category / size).
  ipcMain.handle('drivers:packsList', async () => {
    const lib = await getDriverLib();
    packCancelled = false;
    try {
      const r = await driverpacks.listPacks(lib, driversProgress, (c) => { packChild = c; });
      return { ok: true, files: r.files };
    } catch (err) {
      if (packCancelled) return { ok: false, cancelled: true };
      return { ok: false, error: (err && err.message) || String(err) };
    } finally { packChild = null; }
  });

  // Download every pack in a category scope (['lan','wlan'], ['massstorage'], ['*'] ...).
  ipcMain.handle('drivers:packsFetch', async (_evt, args) => {
    const lib = await getDriverLib();
    const scope = Array.isArray(args && args.scope) ? args.scope : [];
    packCancelled = false;
    try {
      const r = await driverpacks.downloadByScope({ lib, scope, onProgress: driversProgress, onChild: (c) => { packChild = c; } });
      await addPackScope(scope.indexOf('*') >= 0 ? ['*'] : (r.categories || scope));
      driversProgress('Re-indexing the library…');
      await reindexDriverLib(lib);
      return { ok: true, data: r };
    } catch (err) {
      if (packCancelled) return { ok: true, data: { cancelled: true } };
      return { ok: false, error: (err && err.message) || String(err) };
    } finally { packChild = null; }
  });

  // Download a specific set of packs chosen in the picker (by file name).
  ipcMain.handle('drivers:packsDownload', async (_evt, args) => {
    const lib = await getDriverLib();
    const names = Array.isArray(args && args.names) ? args.names : [];
    packCancelled = false;
    try {
      const r = await driverpacks.downloadByNames({ lib, names, onProgress: driversProgress, onChild: (c) => { packChild = c; } });
      await addPackScope(r.categories || []);
      driversProgress('Re-indexing the library…');
      await reindexDriverLib(lib);
      return { ok: true, data: r };
    } catch (err) {
      if (packCancelled) return { ok: true, data: { cancelled: true } };
      return { ok: false, error: (err && err.message) || String(err) };
    } finally { packChild = null; }
  });

  // Check for updates within the remembered scope and fetch anything new.
  ipcMain.handle('drivers:packsUpdate', async () => {
    const lib = await getDriverLib();
    const cfg = await readConfig();
    const scope = Array.isArray(cfg.packsScope) ? cfg.packsScope : [];
    if (!scope.length) return { ok: true, data: { checked: 0, added: 0, noscope: true } };
    packCancelled = false;
    try {
      const r = await driverpacks.checkUpdates({ lib, scope, onProgress: driversProgress, onChild: (c) => { packChild = c; } });
      if (r.added) { driversProgress('Re-indexing the library…'); await reindexDriverLib(lib); }
      return { ok: true, data: r };
    } catch (err) {
      if (packCancelled) return { ok: true, data: { cancelled: true } };
      return { ok: false, error: (err && err.message) || String(err) };
    } finally { packChild = null; }
  });

  ipcMain.handle('drivers:getPacksAuto', async () => {
    const cfg = await readConfig();
    return { auto: !!cfg.packsAuto, scope: Array.isArray(cfg.packsScope) ? cfg.packsScope : [] };
  });
  ipcMain.handle('drivers:setPacksAuto', async (_evt, args) => {
    const cfg = await readConfig();
    cfg.packsAuto = !!(args && args.auto);
    await writeConfig(cfg);
    return { ok: true, auto: cfg.packsAuto };
  });

  ipcMain.handle('drivers:packsCancel', async () => {
    packCancelled = true;
    try { if (packChild) packChild.kill(); } catch { /* ignore */ }
    return { ok: true };
  });

  // ---- Networking (status, gotchas, ping, discovery, speed) ----
  const netProgress = (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('net:progress', msg);
  };
  const netScript = (scriptArgs, onProgress, timeoutMs) => runPowerShellScript({
    scriptPath: path.join(__dirname, 'net', 'net.ps1'), scriptArgs, onProgress, timeoutMs: timeoutMs || 60000,
  });
  ipcMain.handle('net:info', async () => {
    try { return { ok: true, data: await netScript(['-Action', 'info']) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('net:ping', async (_evt, args) => {
    try { return { ok: true, data: await netScript(['-Action', 'ping', '-Target', String((args && args.target) || '')]) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('net:discover', async () => {
    try { return { ok: true, data: await netScript(['-Action', 'discover'], netProgress, 180000) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('net:setprivate', async () => {
    try { return { ok: true, data: await netScript(['-Action', 'setprivate']) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('net:speed', async () => {
    try { return { ok: true, data: await netspeed.speedTest(netProgress) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  // ---- BIOS / UEFI firmware bench ----
  const biosProgress = (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bios:progress', msg);
  };
  function getFirmwareDir() { const d = path.join(getDataDir(), 'Firmware'); try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } return d; }

  ipcMain.handle('bios:info', async () => {
    try {
      const data = await runPowerShellScript({ scriptPath: path.join(__dirname, 'bios', 'info.ps1'), timeoutMs: 60000 });
      return { ok: true, data };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  ipcMain.handle('bios:pickDump', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a BIOS/UEFI dump to read',
      properties: ['openFile'],
      filters: [{ name: 'Firmware images', extensions: ['bin', 'rom', 'fd', 'cap', 'wph', 'fl1'] }, { name: 'All files', extensions: ['*'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('bios:parse', async (_evt, args) => {
    const p = String((args && args.path) || '');
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'no-file' };
    try { return { ok: true, data: biosparse.parseFirmware(p) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  // Parse + expert advisor: verdict, confidence, findings, guided next steps.
  ipcMain.handle('bios:analyze', async (_evt, args) => {
    const p = String((args && args.path) || '');
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'no-file' };
    try {
      const parsed = biosparse.parseFirmware(p);
      return { ok: true, data: { parse: parsed, advice: biosanalyze.analyze(parsed) } };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  // Neutralise / clean the Intel ME region of a dump with bundled me_cleaner.
  ipcMain.handle('bios:cleanME', async (_evt, args) => {
    const inPath = String((args && args.path) || '');
    if (!inPath || !fs.existsSync(inPath)) return { ok: false, error: 'no-input' };
    const py = path.join(__dirname, 'bios', 'bin', 'python', 'python.exe');
    const mc = path.join(__dirname, 'bios', 'bin', 'me_cleaner.py');
    if (!fs.existsSync(py) || !fs.existsSync(mc)) return { ok: false, error: 'tool-missing' };
    const out = inPath.replace(/\.(bin|rom|fd|cap|wph|fl1)$/i, '') + '.cleaned.bin';
    const a = [mc, '-S'];
    if (args && args.truncate) a.push('-t');
    if (args && args.relocate) a.push('-r');
    a.push('-O', out, inPath);
    return new Promise((resolve) => {
      let log = '';
      let child;
      try { child = spawn(py, a, { windowsHide: true }); }
      catch (e) { resolve({ ok: false, error: e.message }); return; }
      const feed = (d) => { const t = d.toString(); log += t; biosProgress(t.replace(/\s+$/, '')); };
      child.stdout.on('data', feed);
      child.stderr.on('data', feed);
      child.on('error', (e) => resolve({ ok: false, error: e.message }));
      child.on('close', (code) => { tmLog('bios', 'clean ME region', code === 0 ? 'ok' : ('exit ' + code), inPath); resolve({ ok: code === 0, code, out: code === 0 ? out : '', log }); });
    });
  });

  // Full firmware tree/report via bundled UEFIExtract, shown in-app.
  ipcMain.handle('bios:uefiReport', async (_evt, args) => {
    const inPath = String((args && args.path) || '');
    if (!inPath || !fs.existsSync(inPath)) return { ok: false, error: 'no-input' };
    const exe = path.join(__dirname, 'bios', 'bin', 'UEFIExtract.exe');
    if (!fs.existsSync(exe)) return { ok: false, error: 'tool-missing' };
    return new Promise((resolve) => {
      let child;
      try { child = spawn(exe, [inPath, 'report'], { cwd: path.dirname(exe), windowsHide: true }); }
      catch (e) { resolve({ ok: false, error: e.message }); return; }
      let err = '';
      child.stderr.on('data', (d) => { err += d.toString(); });
      child.on('error', (e) => resolve({ ok: false, error: e.message }));
      child.on('close', async (code) => {
        const rep = inPath + '.report.txt';
        try {
          if (fs.existsSync(rep)) {
            let txt = await fsp.readFile(rep, 'utf8');
            const cap = 400000;
            const truncated = txt.length > cap;
            if (truncated) txt = txt.slice(0, cap);
            resolve({ ok: true, report: txt, truncated, reportPath: rep });
          } else {
            resolve({ ok: false, error: (err.trim() || ('UEFIExtract produced no report (exit ' + code + ').')) });
          }
        } catch (e) { resolve({ ok: false, error: e.message }); }
      });
    });
  });

  // Firmware diff + pre-flash safety cross-check.
  ipcMain.handle('bios:diff', async (_evt, args) => {
    const a = String((args && args.a) || ''); const b = String((args && args.b) || '');
    if (!fs.existsSync(a) || !fs.existsSync(b)) return { ok: false, error: 'no-file' };
    try { return { ok: true, data: biosdiff.diff(a, b) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('bios:preflight', async (_evt, args) => {
    const t = String((args && args.target) || ''); const c = String((args && args.candidate) || '');
    if (!fs.existsSync(t) || !fs.existsSync(c)) return { ok: false, error: 'no-file' };
    try { return { ok: true, data: biosdiff.preflight(t, c) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('bios:bitlocker', async () => {
    try { return { ok: true, data: await runPowerShellScript({ scriptPath: path.join(__dirname, 'bios', 'bitlocker.ps1'), timeoutMs: 60000 }) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('bios:saveText', async (_evt, args) => {
    const name = String((args && args.name) || 'TM-notes') + '.txt';
    try {
      const picked = await dialog.showSaveDialog(mainWindow, { title: 'Save', defaultPath: name, filters: [{ name: 'Text', extensions: ['txt'] }] });
      if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
      await fsp.writeFile(picked.filePath, String((args && args.text) || ''), 'utf8');
      return { ok: true, path: picked.filePath };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  // Component authenticity (RAM / disk reported specs + heuristic flags).
  ipcMain.handle('diag:authenticity', async () => {
    try { return { ok: true, data: await runPowerShellScript({ scriptPath: path.join(__dirname, 'diagnose', 'authenticity.ps1'), timeoutMs: 60000 }) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('diag:events', async () => {
    try { return { ok: true, data: await runPowerShellScript({ scriptPath: path.join(__dirname, 'diagnose', 'events.ps1'), timeoutMs: 120000 }) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  // ---- Debloat (installed software + bloat flags + uninstall) ----
  const debloatProgress = (msg) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('debloat:progress', msg); };
  ipcMain.handle('debloat:list', async () => {
    try { return { ok: true, data: await runPowerShellScript({ scriptPath: path.join(__dirname, 'debloat', 'list.ps1'), timeoutMs: 120000 }) }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('debloat:uninstall', async (_evt, args) => {
    const kind = String((args && args.kind) || ''); const key = String((args && args.key) || '');
    try {
      const data = await runPowerShellScript({ scriptPath: path.join(__dirname, 'debloat', 'uninstall.ps1'), scriptArgs: ['-Kind', kind, '-Key', key], onProgress: debloatProgress, timeoutMs: 900000 });
      tmLog('debloat', 'uninstall ' + kind, (data && data.ok) ? 'ok' : ('err ' + ((data && data.error) || (data && data.exitCode))), key);
      return { ok: true, data };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  // Launch the bundled UEFITool GUI (optionally on a dump).
  ipcMain.handle('bios:openUefiTool', async (_evt, args) => {
    const inPath = String((args && args.path) || '');
    const exe = path.join(__dirname, 'bios', 'bin', 'UEFITool.exe');
    if (!fs.existsSync(exe)) return { ok: false, error: 'tool-missing' };
    try { spawn(exe, inPath && fs.existsSync(inPath) ? [inPath] : [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref(); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('bios:importFirmware', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Add a firmware file to your library',
      properties: ['openFile'],
      filters: [{ name: 'Firmware images', extensions: ['bin', 'rom', 'fd', 'cap', 'wph', 'fl1', 'exe', 'zip'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    try {
      const src = r.filePaths[0];
      const dest = path.join(getFirmwareDir(), path.basename(src));
      await fsp.copyFile(src, dest);
      return { ok: true, path: dest };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  ipcMain.handle('bios:openFirmwareDir', async () => { shell.openPath(getFirmwareDir()); return true; });

  // Extract an OEM BIOS package (HP/Dell/Lenovo self-extracting exe, zip, cab…)
  // recursively with the bundled 7za, and surface the firmware image(s) inside.
  ipcMain.handle('bios:extractPackage', async () => {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose the OEM BIOS package you downloaded',
      properties: ['openFile'],
      filters: [{ name: 'BIOS packages', extensions: ['exe', 'zip', 'cab', '7z', 'msi', 'rar', 'bin', 'fd', 'cap', 'rom'] }, { name: 'All files', extensions: ['*'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true };
    const src = picked.filePaths[0];
    const sevenZa = path.join(__dirname, 'bios', 'bin', '7za.exe');
    if (!fs.existsSync(sevenZa)) return { ok: false, error: 'tool-missing' };

    const FW = ['.bin', '.fd', '.cap', '.rom', '.fl1', '.fl2', '.wph', '.bio'];
    const ARC = ['.exe', '.zip', '.cab', '.7z', '.msi', '.rar'];
    const base = path.basename(src).replace(/\.[^.]+$/, '').replace(/[^\w.() -]+/g, '_');
    const root = path.join(getFirmwareDir(), 'extracted_' + base + '_' + Date.now());
    await fsp.mkdir(root, { recursive: true });
    const found = [];
    const seen = new Set();

    async function sevenExtract(file, outDir) {
      await fsp.mkdir(outDir, { recursive: true });
      biosProgress('Extracting ' + path.basename(file) + ' …');
      await new Promise((resolve) => {
        let c;
        try { c = spawn(sevenZa, ['x', file, '-o' + outDir, '-y', '-bso0', '-bsp0'], { windowsHide: true }); }
        catch { resolve(); return; }
        c.on('error', () => resolve());
        c.on('close', () => resolve());
      });
    }
    async function walkAndRecurse(dir, depth) {
      let ents = [];
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { await walkAndRecurse(p, depth); continue; }
        const ext = path.extname(e.name).toLowerCase();
        let sz = 0; try { sz = fs.statSync(p).size; } catch { /* ignore */ }
        if (FW.includes(ext) && sz >= 65536) {
          const key = e.name.toLowerCase() + ':' + sz;
          if (!seen.has(key)) { seen.add(key); found.push({ name: e.name, size: sz, path: p }); }
        } else if (ARC.includes(ext) && depth < 3 && sz > 0) {
          const sub = p + '__x';
          await sevenExtract(p, sub);
          await walkAndRecurse(sub, depth + 1);
        }
      }
    }
    try {
      await sevenExtract(src, root);
      await walkAndRecurse(root, 1);
      found.sort((a, b) => b.size - a.size);
      biosProgress('Done — found ' + found.length + ' firmware image(s).');
      return { ok: true, root, files: found };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  // ---- Board Identity Vault (serial / UUID / MAC / asset tag) ----
  function getIdentityDir() { const d = path.join(getDataDir(), 'Identity'); try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } return d; }
  ipcMain.handle('bios:identityCapture', async (_evt, args) => {
    try {
      const data = await runPowerShellScript({ scriptPath: path.join(__dirname, 'bios', 'identity.ps1'), timeoutMs: 60000 });
      if (!data || data.ok !== true) return { ok: false, error: 'capture-failed' };
      data.ticket = String((args && args.note) || '').replace(/[^\x20-\x7E]/g, '').trim();
      const tk = data.ticket ? (data.ticket.replace(/[^\w.() -]+/g, '_').slice(0, 20) + '_') : '';
      const label = (tk + [data.sysVendor, data.sysModel, data.systemSerial].filter(Boolean).join(' ')).replace(/[^\w.() -]+/g, '_').trim().slice(0, 90) || ('identity_' + Date.now());
      data.label = label;
      const file = path.join(getIdentityDir(), label + '.json');
      await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
      data._file = file;
      return { ok: true, card: data };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('bios:identityList', async () => {
    const dir = getIdentityDir();
    try {
      const files = (await fsp.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.json'));
      const cards = [];
      for (const f of files) {
        try { const c = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')); c._file = path.join(dir, f); cards.push(c); } catch { /* skip */ }
      }
      cards.sort((a, b) => ('' + (b.captured || '')).localeCompare('' + (a.captured || '')));
      return { ok: true, cards };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('bios:identityDelete', async (_evt, args) => {
    const file = String((args && args.file) || '');
    try {
      const dir = path.resolve(getIdentityDir());
      const full = path.resolve(file);
      if (!full.startsWith(dir)) return { ok: false, error: 'bad-target' };
      if (fs.existsSync(full)) await fsp.unlink(full);
      return { ok: true };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('bios:identityOpenDir', async () => { shell.openPath(getIdentityDir()); return true; });

  // Save an identity card built from an analysed dump.
  ipcMain.handle('bios:identitySave', async (_evt, args) => {
    const c = (args && args.card) || {};
    const note = String((args && args.note) || '').replace(/[^\x20-\x7E]/g, '').trim();
    const card = {
      ok: true, source: 'firmware dump', captured: new Date().toISOString().slice(0, 19),
      sysVendor: c.vendor || '', sysModel: c.model || '', boardProduct: c.model || '',
      systemSerial: c.serial || '', uuid: c.uuid || '',
      macs: c.mac ? [{ name: 'Onboard NIC (from GbE region)', mac: c.mac }] : [],
      candidates: Array.isArray(c.candidates) ? c.candidates : [], ticket: note,
    };
    const tk = note ? (note.replace(/[^\w.() -]+/g, '_').slice(0, 20) + '_') : '';
    const label = (tk + [card.sysVendor, card.sysModel, card.systemSerial].filter(Boolean).join(' ')).replace(/[^\w.() -]+/g, '_').trim().slice(0, 90) || ('dump_' + Date.now());
    card.label = label;
    try {
      const file = path.join(getIdentityDir(), label + '.json');
      await fsp.writeFile(file, JSON.stringify(card, null, 2), 'utf8');
      card._file = file;
      return { ok: true, card };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });

  // Xgpro (XGecu programmer software) integration — locate + launch.
  ipcMain.handle('bios:getXgpro', async () => {
    const cfg = await readConfig();
    const exe = (cfg.xgproExe && typeof cfg.xgproExe === 'string') ? cfg.xgproExe : '';
    return { exe, exists: !!(exe && fs.existsSync(exe)) };
  });
  ipcMain.handle('bios:pickXgpro', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Locate Xgpro.exe (XGecu programmer software)', properties: ['openFile'], filters: [{ name: 'Xgpro', extensions: ['exe'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const cfg = await readConfig(); cfg.xgproExe = r.filePaths[0]; await writeConfig(cfg);
    return r.filePaths[0];
  });
  ipcMain.handle('bios:launchXgpro', async () => {
    const cfg = await readConfig();
    const exe = (cfg.xgproExe || '').trim();
    if (!exe || !fs.existsSync(exe)) return { ok: false, error: 'not-found' };
    try { spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref(); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  // ---- Licensing ----
  ipcMain.handle('license:status', async () => licenseStatus());
  ipcMain.handle('license:machineId', async () => ({ id: getMachineId() }));
  ipcMain.handle('license:activate', async (_evt, args) => {
    const key = String((args && args.key) || '').trim();
    const email = String((args && args.email) || '').trim();
    const payload = licensing.verifyLicense(key);
    if (!payload) return { ok: false, reason: 'That licence key is not valid. Check you pasted all of it.' };
    // Per-user model: the e-mail typed in must match the one baked into the key.
    if (payload.email && email && payload.email.toLowerCase() !== email.toLowerCase()) {
      return { ok: false, reason: 'That e-mail does not match this licence key.' };
    }
    if (payload.email && !email) return { ok: false, reason: 'Enter the e-mail address your licence was issued to.' };
    const mid = getMachineId();
    if (payload.machine && payload.machine !== mid) return { ok: false, reason: 'This licence is locked to a different machine (ID ' + payload.machine + ').' };
    if (payload.expires && Date.now() > Date.parse(payload.expires)) return { ok: false, reason: 'That licence expired on ' + payload.expires + '.' };
    const cfg = await readConfig();
    cfg.license = key;
    await writeConfig(cfg);
    tmLog('license', 'activated', 'ok', (payload.email || payload.name || ''));
    return { ok: true, status: await licenseStatus() };
  });
  ipcMain.handle('license:deactivate', async () => {
    const cfg = await readConfig();
    delete cfg.license;
    await writeConfig(cfg);
    return { ok: true, status: await licenseStatus() };
  });

  // ---- Power Signatures (PLD USB-C meter): port selection + signature library ----
  // Bring the window to the front when a device is plugged into the meter
  // (opt-in). Respects a minimised window — just flashes the taskbar instead.
  ipcMain.handle('power:focusApp', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
    try {
      if (mainWindow.isMinimized()) { mainWindow.flashFrame(true); return { ok: true, minimized: true }; }
      mainWindow.setAlwaysOnTop(true);
      mainWindow.show();
      mainWindow.focus();
      if (mainWindow.moveTop) mainWindow.moveTop();
      setTimeout(() => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false); } catch { /* ignore */ } }, 500);
    } catch { /* ignore */ }
    return { ok: true };
  });
  ipcMain.handle('power:selectPort', async (_evt, args) => {
    const id = String((args && args.id) || '');
    if (serialSelectCb) { try { serialSelectCb(id); } catch { /* ignore */ } serialSelectCb = null; }
    return { ok: true };
  });
  ipcMain.handle('power:cancelPort', async () => {
    if (serialSelectCb) { try { serialSelectCb(''); } catch { /* ignore */ } serialSelectCb = null; }
    return { ok: true };
  });
  function sigDir() { const d = path.join(getDataDir(), 'power-signatures'); try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } return d; }
  ipcMain.handle('power:listSigs', async () => {
    try {
      const d = sigDir();
      const files = (await fsp.readdir(d)).filter((f) => f.endsWith('.json'));
      const out = [];
      for (const f of files) {
        try { const s = JSON.parse(await fsp.readFile(path.join(d, f), 'utf8')); out.push({ id: s.id, label: s.label, device: s.device, fault: s.fault, created: s.created, durationMs: s.durationMs, samples: Array.isArray(s.samples) ? s.samples.length : 0 }); } catch { /* skip */ }
      }
      out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
      return { ok: true, items: out };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('power:getSig', async (_evt, args) => {
    try { const s = JSON.parse(await fsp.readFile(path.join(sigDir(), String(args.id) + '.json'), 'utf8')); return { ok: true, sig: s }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('power:saveSig', async (_evt, args) => {
    try {
      const s = (args && args.sig) || {};
      s.id = s.id || ('sig' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      s.created = s.created || new Date().toISOString();
      await fsp.writeFile(path.join(sigDir(), s.id + '.json'), JSON.stringify(s));
      tmLog('power', 'saved signature', 'ok', (s.device || '') + ' / ' + (s.fault || s.label || ''));
      return { ok: true, id: s.id };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('power:deleteSig', async (_evt, args) => {
    try { await fsp.unlink(path.join(sigDir(), String(args.id) + '.json')); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('power:openDir', async () => { shell.openPath(sigDir()); return { ok: true }; });
  ipcMain.handle('power:exportCsv', async (_evt, args) => {
    try {
      const name = ((args && args.name) || 'power-capture').replace(/[^\w.-]+/g, '_');
      const r = await dialog.showSaveDialog(mainWindow, { title: 'Export capture as CSV', defaultPath: name + '.csv', filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (r.canceled || !r.filePath) return { cancelled: true };
      const rows = (args && args.rows) || [];
      const n0 = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
      let csv = 'time_ms,volts,amps,marker\n';
      for (const s of rows) csv += [n0(s.t), n0(s.v), n0(s.a), (s.marker ? '"' + String(s.marker).replace(/"/g, '""') + '"' : '')].join(',') + '\n';
      await fsp.writeFile(r.filePath, csv, 'utf8');
      return { ok: true, path: r.filePath };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('power:importCsv', async () => {
    try {
      const r = await dialog.showOpenDialog(mainWindow, { title: 'Import a capture CSV', properties: ['openFile'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
      if (r.canceled || !r.filePaths[0]) return { cancelled: true };
      const txt = await fsp.readFile(r.filePaths[0], 'utf8');
      const rows = [];
      const lines = txt.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i].trim(); if (!ln) continue;
        const parts = ln.split(',');
        const t = parseFloat(parts[0]); const v = parseFloat(parts[1]); const a = parseFloat(parts[2]);
        if (!Number.isFinite(t) || !Number.isFinite(v) || !Number.isFinite(a)) continue; // skips header
        rows.push({ t, v, a });
      }
      return { ok: true, rows, name: path.basename(r.filePaths[0]) };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ---- Self-update ----
  ipcMain.handle('updates:check', async () => { try { return { ok: true, info: await checkForUpdate() }; } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; } });
  ipcMain.handle('updates:apply', async () => { try { return await applyUpdate(); } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; } });
  ipcMain.handle('updates:repo', async () => ({ repo: await getUpdateRepo() }));

  // ---- Activity log viewer ----
  ipcMain.handle('logs:read', async () => {
    try {
      const f = path.join(getLogsDir(), 'activity.log');
      if (!fs.existsSync(f)) return { ok: true, text: '', lines: 0 };
      const t = await fsp.readFile(f, 'utf8');
      const lines = t.split(/\r?\n/).filter(Boolean);
      return { ok: true, text: lines.slice(-1000).reverse().join('\n'), lines: lines.length };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('logs:clear', async () => {
    try { await fsp.writeFile(path.join(getLogsDir(), 'activity.log'), ''); tmLog('app', 'activity log cleared', 'ok'); return { ok: true }; }
    catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('logs:openDir', async () => { shell.openPath(getLogsDir()); return true; });

  // ---- Board-level repair (boardview + PDF viewers, reference library) ----
  function brBin(name) { return path.join(__dirname, 'boardrepair', 'bin', name); }
  function getBoardLibDir() { const d = path.join(getDataDir(), 'BoardRepair'); try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } return d; }
  ipcMain.handle('board:openBoardview', async (_evt, args) => {
    const p = String((args && args.path) || ''); const exe = brBin('openboardview.exe');
    if (!fs.existsSync(exe)) return { ok: false, error: 'tool-missing' };
    try { spawn(exe, (p && fs.existsSync(p)) ? [p] : [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref(); tmLog('board', 'open boardview', 'launched', p); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('board:openPdf', async (_evt, args) => {
    const p = String((args && args.path) || ''); const exe = brBin('SumatraPDF.exe');
    if (!fs.existsSync(exe)) return { ok: false, error: 'tool-missing' };
    try { spawn(exe, (p && fs.existsSync(p)) ? [p] : [], { cwd: path.dirname(exe), detached: true, stdio: 'ignore' }).unref(); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('board:pick', async (_evt, args) => {
    const kind = (args && args.kind) || 'any';
    const filters = kind === 'pdf' ? [{ name: 'PDF', extensions: ['pdf'] }]
      : (kind === 'board' ? [{ name: 'Boardview', extensions: ['brd', 'bdv', 'bvr', 'fz', 'cad', 'cst', 'asc', 'bv', 'obv', 'gcad'] }]
        : [{ name: 'Reference', extensions: ['pdf', 'brd', 'bdv', 'bvr', 'fz', 'cad', 'cst', 'asc', 'bv', 'obv'] }]);
    filters.push({ name: 'All files', extensions: ['*'] });
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choose a file', properties: ['openFile'], filters });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('board:import', async (_evt, args) => {
    const model = String((args && args.model) || '').replace(/[^\w.() -]+/g, '_').trim();
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Add reference file(s)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Reference', extensions: ['pdf', 'brd', 'bdv', 'bvr', 'fz', 'cad', 'cst', 'asc', 'bv', 'obv'] }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths.length) return { ok: false, cancelled: true };
    const dest = model ? path.join(getBoardLibDir(), model) : getBoardLibDir();
    try {
      await fsp.mkdir(dest, { recursive: true });
      let n = 0;
      for (const f of r.filePaths) { try { await fsp.copyFile(f, path.join(dest, path.basename(f))); n++; } catch { /* skip */ } }
      tmLog('board', 'import reference', 'ok', n + ' file(s)' + (model ? (' -> ' + model) : ''));
      return { ok: true, count: n };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('board:importFolder', async (_evt, args) => {
    const model = String((args && args.model) || '').replace(/[^\w.() -]+/g, '_').trim();
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Choose a folder of schematics/boardviews to import', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    const src = r.filePaths[0];
    const group = model || (path.basename(src).replace(/[^\w.() -]+/g, '_').trim()) || 'Imported';
    const dest = path.join(getBoardLibDir(), group);
    const exts = new Set(['.pdf', '.brd', '.brd2', '.bdv', '.bvr', '.fz', '.cad', '.cst', '.asc', '.bv', '.obv', '.gcad']);
    try {
      await fsp.mkdir(dest, { recursive: true });
      let n = 0;
      const stack = [src];
      while (stack.length) {
        const d = stack.pop();
        let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
        for (const e of ents) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) { stack.push(p); continue; }
          if (!exts.has(path.extname(e.name).toLowerCase())) continue;
          let out = path.join(dest, e.name);
          try { if (fs.existsSync(out)) out = path.join(dest, path.parse(e.name).name + '_' + n + path.extname(e.name)); await fsp.copyFile(p, out); n++; } catch { /* skip */ }
          if (n >= 5000) break;
        }
        if (n >= 5000) break;
      }
      tmLog('board', 'import folder', 'ok', n + ' file(s) from ' + src);
      return { ok: true, count: n, group };
    } catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('board:list', async () => {
    const base = getBoardLibDir();
    const out = [];
    (function walk(dir, group) {
      let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, e.name);
        else { let sz = 0; try { sz = fs.statSync(p).size; } catch { /* ignore */ } out.push({ name: e.name, path: p, group: group || '(unfiled)', ext: path.extname(e.name).toLowerCase().replace('.', ''), size: sz }); }
      }
    })(base, '');
    return { ok: true, files: out };
  });
  ipcMain.handle('board:openLibDir', async () => { shell.openPath(getBoardLibDir()); return true; });

  // ---- Startup items (list + toggle) ----
  ipcMain.handle('startup:list', async () => {
    try {
      const data = await startup.runList();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });
  ipcMain.handle('startup:toggle', async (_evt, args) => startup.toggle(args && args.item, args && args.enable));

  // ---- Elevation (administrator) ----
  ipcMain.handle('app:version', async () => {
    try { return app.getVersion(); } catch { return ''; }
  });
  ipcMain.handle('app:isElevated', async () => isElevated());
  ipcMain.handle('app:relaunchElevated', async () => {
    try {
      const exe = process.execPath.replace(/'/g, "''");
      // Launch a fully-detached helper via `cmd /c start`, so it is owned by the
      // shell (not this app) and survives our exit. It waits for us to close
      // (releasing the single-instance lock) then relaunches elevated via UAC.
      const inner = `Start-Sleep -Milliseconds 1000; Start-Process -FilePath '${exe}' -Verb RunAs`;
      spawn(
        'cmd.exe',
        ['/c', 'start', '', '/min', 'powershell.exe', '-NoProfile', '-WindowStyle', 'Hidden', '-Command', inner],
        { detached: true, stdio: 'ignore', windowsHide: true }
      ).unref();
      setTimeout(() => app.quit(), 300);
      return true;
    } catch (e) {
      return false;
    }
  });

  // ---- Surface / file-system scan (online, needs admin) ----
  ipcMain.handle('scan:surface', async () => {
    const onProgress = (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('scan:surface-progress', msg);
    };
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'scanner', 'surface.ps1'),
        onProgress,
        timeoutMs: 1800000, // up to 30 minutes for large drives
      });
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Apple devices (iOS/iPadOS over USB via libimobiledevice) ----
  ipcMain.handle('idevice:status', async () => {
    try { return await idevice.status(); }
    catch (err) { return { toolsPresent: false, message: (err && err.message) || String(err), devices: [] }; }
  });
  ipcMain.handle('idevice:read', async (_evt, args) => {
    try { return await idevice.readDevice((args && args.udid) || ''); }
    catch (err) { return { ok: false, reason: (err && err.message) || String(err) }; }
  });
  ipcMain.handle('idevice:crash', async (_evt, args) => {
    try {
      const out = path.join(app.getPath('temp'), 'tmts-ios-crash-' + Date.now());
      await fsp.mkdir(out, { recursive: true });
      return await idevice.crashReports((args && args.udid) || '', out);
    } catch (err) { return { ok: false, reason: (err && err.message) || String(err) }; }
  });
  // Install the libimobiledevice tools from a zip the technician has downloaded
  // and vetted (we never silently fetch unverified binaries). Extracts and
  // flattens the .exe/.dll into the portable idevice-bin folder.
  ipcMain.handle('idevice:install', async () => {
    try {
      const pick = await dialog.showOpenDialog(mainWindow, {
        title: 'Select the libimobiledevice tools (.zip)',
        properties: ['openFile'],
        filters: [{ name: 'Zip archive', extensions: ['zip'] }, { name: 'All files', extensions: ['*'] }],
      });
      if (pick.canceled || !pick.filePaths || !pick.filePaths[0]) return { ok: false, canceled: true };
      const zip = pick.filePaths[0];
      const tmp = path.join(app.getPath('temp'), 'tmts-idev-' + Date.now());
      await fsp.mkdir(tmp, { recursive: true });
      await run7z(['x', zip, '-o' + tmp, '-y']);
      // Collect every .exe/.dll from the extracted tree (handles nested folders).
      const found = [];
      const walk = async (d) => {
        for (const ent of await fsp.readdir(d, { withFileTypes: true })) {
          const p = path.join(d, ent.name);
          if (ent.isDirectory()) await walk(p);
          else if (/\.(exe|dll)$/i.test(ent.name)) found.push(p);
        }
      };
      await walk(tmp);
      if (!found.length) { try { await fsp.rm(tmp, { recursive: true, force: true }); } catch {} return { ok: false, reason: 'No .exe/.dll files were found in that archive.' }; }
      const dest = idevice.installDir();
      await fsp.mkdir(dest, { recursive: true });
      for (const f of found) await fsp.copyFile(f, path.join(dest, path.basename(f)));
      try { await fsp.rm(tmp, { recursive: true, force: true }); } catch {}
      const verify = idevice.verifyDir(dest);
      tmLog('idevice', 'install', verify.ok ? 'ok' : 'incomplete', 'copied ' + found.length + ' files');
      return { ok: verify.ok, installed: found.length, dest, missing: verify.missing };
    } catch (err) {
      return { ok: false, reason: (err && err.message) || String(err) };
    }
  });
  ipcMain.handle('idevice:openToolsDir', async () => {
    try { const d = idevice.installDir(); await fsp.mkdir(d, { recursive: true }); await shell.openPath(d); return { ok: true, dir: d }; }
    catch (err) { return { ok: false, reason: (err && err.message) || String(err) }; }
  });

  // Lightweight connect/disconnect watcher: poll the UDID list and push changes.
  let _idevTimer = null;
  let _idevLast = '';
  ipcMain.handle('idevice:watch', async (_evt, args) => {
    const on = !!(args && args.on);
    if (_idevTimer) { clearInterval(_idevTimer); _idevTimer = null; }
    if (!on) return { ok: true, watching: false };
    const tick = async () => {
      try {
        const list = await idevice.listDevices();
        const sig = list.join(',');
        if (sig !== _idevLast) {
          _idevLast = sig;
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('idevice:devices', list);
        }
      } catch { /* ignore */ }
    };
    _idevTimer = setInterval(tick, 2500);
    tick();
    return { ok: true, watching: true };
  });

  // ---- Settings (Syncro credentials) ----
  ipcMain.handle('settings:get', async () => settings.getPublic());
  ipcMain.handle('settings:save', async (_evt, payload) => settings.save(payload || {}));
  ipcMain.handle('settings:test', async (_evt, payload) => {
    const stored = await settings.getForApi();
    const subdomain = (payload && payload.subdomain) || stored.subdomain;
    const token = (payload && payload.token) || stored.token;
    return syncro.testConnection({ subdomain, token });
  });

  // ---- Look up a ticket by its human number (→ id + customer) ----
  ipcMain.handle('syncro:lookup', async (_evt, args) => {
    const { subdomain, token } = await settings.getForApi();
    if (!subdomain || !token) return { ok: false, message: 'Configure Syncro in the Settings tab first.' };
    return syncro.lookupTicket({ subdomain, token, number: args && args.number });
  });

  // ---- List recent live tickets so the tech can pick one instead of typing ----
  ipcMain.handle('syncro:listTickets', async (_evt, args) => {
    const { subdomain, token } = await settings.getForApi();
    if (!subdomain || !token) return { ok: false, message: 'Configure Syncro in the Settings tab first.' };
    return syncro.listActiveTickets({ subdomain, token, limit: (args && args.limit) || 50 });
  });

  // ---- Post an Issue Scan as a comment on an existing Syncro ticket ----
  ipcMain.handle('syncro:postScan', async (_evt, args) => {
    const { subdomain, token } = await settings.getForApi();
    if (!subdomain || !token) return { ok: false, message: 'Configure Syncro in the Settings tab first.' };
    const body = syncro.buildFindingsComment(args && args.result);
    return syncro.postComment({
      subdomain,
      token,
      ticketId: args && args.ticketId,
      hidden: !(args && args.hidden === false),
      subject: 'TM Toolset Issue Scan',
      body,
    });
  });

  // ---- Post an arbitrary HTML note (from any tab) to the active ticket ----
  ipcMain.handle('syncro:postNote', async (_evt, args) => {
    const { subdomain, token } = await settings.getForApi();
    if (!subdomain || !token) return { ok: false, message: 'Configure Syncro in the Settings tab first.' };
    return syncro.postComment({
      subdomain,
      token,
      ticketId: args && args.ticketId,
      subject: (args && args.subject) || 'TM Toolset',
      body: (args && args.body) || '',
      hidden: !(args && args.hidden === false),
    });
  });

  // ---- Repairs (DISM/SFC/chkdsk/WU/network/DNS/temp) with live output ----
  ipcMain.handle('repairs:run', async (_evt, args) => {
    const action = String((args && args.action) || '');
    const onProgress = (msg) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('repairs:progress', { action, msg });
    };
    try {
      const data = await runPowerShellScript({
        scriptPath: path.join(__dirname, 'repairs', 'repairs.ps1'),
        scriptArgs: ['-Action', action],
        onProgress,
        timeoutMs: 2400000, // up to 40 min (DISM can be slow)
      });
      tmLog('repairs', action, (data && data.ok) ? 'ok' : ('exit ' + (data && data.exitCode)), (data && data.error) || '');
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) };
    }
  });

  // ---- Asset types + create a customer asset from this machine ----
  ipcMain.handle('syncro:assetTypes', async () => {
    const { subdomain, token } = await settings.getForApi();
    if (!subdomain || !token) return { ok: false, message: 'Configure Syncro in the Settings tab first.' };
    return syncro.listAssetTypes({ subdomain, token });
  });

  ipcMain.handle('syncro:createAsset', async (_evt, args) => {
    const { subdomain, token } = await settings.getForApi();
    if (!subdomain || !token) return { ok: false, message: 'Configure Syncro in the Settings tab first.' };
    return syncro.createAsset({
      subdomain,
      token,
      customerId: args && args.customerId,
      name: args && args.name,
      assetTypeId: args && args.assetTypeId,
      serial: args && args.serial,
      properties: (args && args.properties) || {},
    });
  });
}

// Single-instance: focus the existing window instead of opening a second one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    // Give Windows a stable identity so the taskbar shows our icon/title and
    // groups windows under "TM Toolset" rather than the generic Electron id.
    try { app.setAppUserModelId('com.technicalmerit.tmtoolset'); } catch { /* ignore */ }
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    maybeAutoUpdatePacks();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
