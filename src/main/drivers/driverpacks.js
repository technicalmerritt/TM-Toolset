'use strict';

// Built-in driverpack fetcher. Lists SDI's freely-distributed driverpacks from
// its public torrent, downloads a chosen subset (or all) over BitTorrent with a
// bundled aria2, extracts the .7z packs with a bundled 7za into the library, and
// leaves the .inf trees for TM Toolset's own scan/match/fix to use offline.
// Incremental: re-running only downloads/extracts packs you don't already have,
// which is how "check for updates" works.
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');

const TORRENT_URL = 'https://sdi-tool.org/SDI_Update.torrent';
const CAT_RE = /^DP_([A-Za-z0-9]+)/i;             // category token right after DP_
const NET_CATS = ['lan', 'wlan'];

function binDir() { return path.join(__dirname, 'bin'); }
function aria2Exe() { return path.join(binDir(), 'aria2c.exe'); }
function sevenZaExe() { return path.join(binDir(), '7za.exe'); }
function categoryOf(name) { const m = CAT_RE.exec(name); return m ? m[1] : 'Misc'; }

function run(exe, args, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    let child;
    try { child = spawn(exe, args, { cwd: opts.cwd || binDir(), windowsHide: true }); }
    catch (e) { resolve({ code: -1, err: e.message }); return; }
    if (opts.onChild) { try { opts.onChild(child); } catch { /* ignore */ } }
    let buf = '';
    const feed = (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (opts.onLine && line.trim()) opts.onLine(line);
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (e) => resolve({ code: -1, err: e.message }));
    child.on('close', (code) => { if (opts.onLine && buf.trim()) opts.onLine(buf.trim()); resolve({ code }); });
  });
}

function dirs(lib) {
  return {
    packsDir: path.join(lib, 'SDI-DriverPacks'),
    torrentDir: path.join(lib, 'SDI-Torrent'),
    extractRoot: path.join(lib, 'extracted'),
  };
}

async function fetchTorrent(lib, onProgress) {
  if (!fs.existsSync(aria2Exe())) throw new Error('aria2c.exe is missing from the app (drivers/bin).');
  const { torrentDir } = dirs(lib);
  await fsp.mkdir(torrentDir, { recursive: true });
  onProgress('Fetching the SDI driverpack torrent metadata…');
  const torrentPath = path.join(torrentDir, 'SDI_Update.torrent');
  const res = await fetch(TORRENT_URL, { redirect: 'follow', headers: { 'User-Agent': 'TM-Toolset/1.0' } });
  if (!res.ok) throw new Error('Could not fetch the SDI torrent (HTTP ' + res.status + ').');
  await fsp.writeFile(torrentPath, Buffer.from(await res.arrayBuffer()));
  return torrentPath;
}

// List the DP_*.7z packs in the torrent with index / name / category / size.
async function listPacks(lib, onProgress, onChild) {
  onProgress = onProgress || (() => {});
  const torrentPath = await fetchTorrent(lib, onProgress);
  onProgress('Reading the torrent file list…');
  const files = [];
  let cur = null;
  await run(aria2Exe(), ['-S', torrentPath], {
    onChild,
    onLine: (l) => {
      const m = /^\s*(\d+)\|(.+)$/.exec(l);
      if (m) {
        const p = m[2].trim();
        if (/\.7z$/i.test(p) && /DP_/i.test(p)) {
          cur = { idx: parseInt(m[1], 10), path: p, name: p.split('/').pop(), category: categoryOf(p.split('/').pop()), sizeBytes: 0 };
          files.push(cur);
        } else { cur = null; }
        return;
      }
      const s = /\(([\d,]+)\)\s*$/.exec(l);
      if (s && cur) { cur.sizeBytes = parseInt(s[1].replace(/,/g, ''), 10); cur = null; }
    },
  });
  if (!files.length) throw new Error('Could not read the torrent contents (its layout may have changed).');
  return { torrentPath, files };
}

function extractedName(packName) { return packName.replace(/\.7z$/i, ''); }

// Extract any downloaded DP_*.7z that isn't already extracted (incremental).
async function extractNew(lib, onProgress, onChild) {
  const { packsDir, extractRoot } = dirs(lib);
  await fsp.mkdir(extractRoot, { recursive: true });
  const packFiles = [];
  (function walk(dir) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.7z$/i.test(e.name) && /DP_/i.test(e.name)) packFiles.push(p);
    }
  })(packsDir);

  let extracted = 0;
  for (const pf of packFiles) {
    const dest = path.join(extractRoot, extractedName(path.basename(pf)));
    if (fs.existsSync(dest)) continue;
    onProgress('Extracting ' + path.basename(pf) + ' …');
    const ex = await run(sevenZaExe(), ['x', pf, '-o' + dest, '-y', '-bso0', '-bsp0'], { onChild });
    if (ex.code === 0) extracted++;
    else { try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* ignore */ } onProgress('  (extract of ' + path.basename(pf) + ' failed, code ' + ex.code + ')'); }
  }
  return extracted;
}

// Download a set of packs (by name) then extract the new ones.
async function downloadByNames(opts) {
  const lib = opts.lib;
  const onProgress = opts.onProgress || (() => {});
  const onChild = opts.onChild || (() => {});
  const wantNames = new Set((opts.names || []).map((n) => ('' + n).toLowerCase()));
  if (!wantNames.size) throw new Error('No packs selected.');

  const { torrentPath, files } = await listPacks(lib, onProgress, onChild);
  const chosen = files.filter((f) => wantNames.has(f.name.toLowerCase()));
  if (!chosen.length) throw new Error('None of the selected packs were found in the current torrent.');

  const { packsDir } = dirs(lib);
  await fsp.mkdir(packsDir, { recursive: true });
  const totalGB = (chosen.reduce((a, f) => a + (f.sizeBytes || 0), 0) / 1e9).toFixed(2);
  onProgress('Downloading ' + chosen.length + ' pack(s), ~' + totalGB + ' GB, over BitTorrent. This can take a while…');

  const dl = await run(aria2Exe(), [
    '--dir=' + packsDir,
    '--select-file=' + chosen.map((f) => f.idx).join(','),
    '--seed-time=0',
    '--bt-stop-timeout=1800',
    '--summary-interval=3',
    '--console-log-level=warn',
    '--file-allocation=none',
    '--enable-dht=true',
    torrentPath,
  ], { onChild, onLine: (l) => { if (/\(\d+%\)/.test(l) || /download completed|errorCode|Exception|not found/i.test(l)) onProgress(l); } });
  if (dl.code !== 0) throw new Error('The download did not complete cleanly (aria2 exit ' + dl.code + ').');

  onProgress('Download finished. Extracting new packs…');
  const extracted = await extractNew(lib, onProgress, onChild);
  return { requested: chosen.length, extracted, categories: Array.from(new Set(chosen.map((f) => f.category.toLowerCase()))) };
}

// Download every pack whose category is in `scope` (array of lowercased
// category tokens, or ['*'] for all).
async function downloadByScope(opts) {
  const scope = (opts.scope || []).map((s) => ('' + s).toLowerCase());
  if (!scope.length) throw new Error('No category selected.');
  const all = scope.indexOf('*') >= 0;
  const { files } = await listPacks(opts.lib, opts.onProgress, opts.onChild);
  const names = files.filter((f) => all || scope.indexOf(f.category.toLowerCase()) >= 0).map((f) => f.name);
  if (!names.length) throw new Error('No matching driverpacks were found inside the torrent for: ' + scope.join(', '));
  return downloadByNames(Object.assign({}, opts, { names }));
}

// Convenience: network packs (LAN + WLAN).
async function downloadNetworkPacks(opts) {
  return downloadByScope(Object.assign({}, opts, { scope: NET_CATS }));
}

// Check for updates within a scope (array of lowercased categories, or ['*']).
// Downloads any in-scope pack we don't already have extracted.
async function checkUpdates(opts) {
  const lib = opts.lib;
  const onProgress = opts.onProgress || (() => {});
  const scope = (opts.scope || []).map((s) => ('' + s).toLowerCase());
  if (!scope.length) return { checked: 0, added: 0 };
  const all = scope.indexOf('*') >= 0;
  const { files } = await listPacks(lib, onProgress, opts.onChild);
  const { extractRoot } = dirs(lib);
  const inScope = files.filter((f) => all || scope.indexOf(f.category.toLowerCase()) >= 0);
  const missing = inScope.filter((f) => !fs.existsSync(path.join(extractRoot, extractedName(f.name))));
  onProgress(inScope.length + ' pack(s) in scope; ' + missing.length + ' new/updated to fetch.');
  if (!missing.length) return { checked: inScope.length, added: 0 };
  const r = await downloadByNames(Object.assign({}, opts, { names: missing.map((f) => f.name) }));
  return { checked: inScope.length, added: r.extracted };
}

module.exports = { listPacks, downloadByNames, downloadByScope, downloadNetworkPacks, checkUpdates, categoryOf };
