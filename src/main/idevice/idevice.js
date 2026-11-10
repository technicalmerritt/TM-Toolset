'use strict';

// Main-process runner for Apple (iOS/iPadOS) devices over USB.
//
// It shells out to the open-source libimobiledevice tools, which live next to
// this file in ./bin (bundled in the full portable build, never in the
// code-only update). Everything degrades gracefully: if the tools or Apple's
// Mobile Device driver aren't present, status() reports that cleanly instead of
// throwing, so the UI can guide the technician to install them.

const path = require('node:path');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const parse = require('./idevice-parse');

const IS_WIN = process.platform === 'win32';
const TOOL_DIR = path.join(__dirname, 'bin');

function toolPath(name) {
  return path.join(TOOL_DIR, IS_WIN ? name + '.exe' : name);
}

// The tool we treat as the presence signal for the whole kit.
function toolsPresent() {
  try { return fs.existsSync(toolPath('ideviceinfo')); } catch { return false; }
}

// Promise wrapper around execFile with a timeout and tidy result.
function run(name, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let file = toolPath(name);
    if (!IS_WIN && !fs.existsSync(file)) file = name; // dev fallback (PATH)
    execFile(file, args || [], { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        code: err && typeof err.code === 'number' ? err.code : (err ? 1 : 0),
        stdout: stdout ? stdout.toString() : '',
        stderr: stderr ? stderr.toString() : '',
        timedOut: !!(err && err.killed),
        missing: !!(err && err.code === 'ENOENT'),
      });
    });
  });
}

// idevice_id -l  ->  list of connected UDIDs.
async function listDevices() {
  const r = await run('idevice_id', ['-l'], 8000);
  if (!r.ok) return [];
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// ideviceinfo with an optional domain, for a specific device.
async function infoRaw(udid, domain) {
  const args = [];
  if (udid) args.push('-u', udid);
  if (domain) args.push('-q', domain);
  const r = await run('ideviceinfo', args, 15000);
  return r.ok ? r.stdout : '';
}

// Battery ioregistry — class name varies by iOS, so try the known ones.
async function batteryIoreg(udid) {
  for (const cls of ['AppleSmartBattery', 'AppleARMPMUCharger']) {
    const args = [];
    if (udid) args.push('-u', udid);
    args.push('ioregistry', cls);
    const r = await run('idevicediagnostics', args, 12000);
    if (r.ok && /DesignCapacity|AppleRawMaxCapacity|CycleCount/.test(r.stdout)) return r.stdout;
  }
  return '';
}

// Read one device fully and return a structured record + analysis.
async function readDevice(udid) {
  const info = await infoRaw(udid, '');
  if (!info) {
    return { ok: false, reason: 'The device did not respond. Make sure it is unlocked and you have tapped "Trust This Computer".' };
  }
  const [disk, batteryDomain, fmip, ioreg] = await Promise.all([
    infoRaw(udid, 'com.apple.disk_usage'),
    infoRaw(udid, 'com.apple.mobile.battery'),
    infoRaw(udid, 'com.apple.fmip'),
    batteryIoreg(udid),
  ]);
  const built = parse.buildRecord({ info, disk, batteryDomain, fmip, batteryIoreg: ioreg });
  built.ok = true;
  built.udid = udid;
  return built;
}

// Pull recent crash/panic logs to a temp dir and triage any panic text.
async function crashReports(udid, outDir) {
  const args = [];
  if (udid) args.push('-u', udid);
  args.push('-k', outDir); // keep on device; copy out
  const r = await run('idevicecrashreport', ['-u', udid || '', outDir].filter(Boolean), 30000);
  const hits = [];
  try {
    if (fs.existsSync(outDir)) {
      for (const f of fs.readdirSync(outDir)) {
        if (/\.(panic|ips)$/i.test(f)) {
          const txt = fs.readFileSync(path.join(outDir, f), 'utf8');
          const t = parse.triagePanic(txt);
          if (t.length) hits.push({ file: f, hints: t });
        }
      }
    }
  } catch { /* ignore */ }
  return { ok: r.ok, hints: hits };
}

// Overall feature status for the UI's header.
async function status() {
  if (!toolsPresent()) {
    return {
      toolsPresent: false,
      message: 'Apple device tools are not installed in this build yet. They ship in the full portable build.',
      devices: [],
    };
  }
  // idevice_id failing with a driver-ish error is the classic "Apple driver missing" case.
  const idList = await run('idevice_id', ['-l'], 8000);
  if (idList.missing) {
    return { toolsPresent: false, message: 'Apple device tools are missing from this build.', devices: [] };
  }
  const udids = idList.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return {
    toolsPresent: true,
    driverOk: true,
    devices: udids,
    message: udids.length ? '' : 'No device detected. Connect an iPhone/iPad with a cable, unlock it, and tap "Trust".',
  };
}

module.exports = { toolsPresent, status, listDevices, readDevice, crashReports, TOOL_DIR };
