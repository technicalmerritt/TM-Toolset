'use strict';

// Opens a small, fixed whitelist of Windows locations on request from a finding.
// The renderer can only ask for a known token — never an arbitrary command.

const { shell } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

function sys32(file) {
  return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', file);
}

function runExe(file, args) {
  try {
    const c = spawn(file, args || [], { detached: true, stdio: 'ignore', windowsHide: false });
    c.unref();
    return true;
  } catch {
    return false;
  }
}

async function openToken(token) {
  switch (token) {
    case 'startup-apps':
      await shell.openExternal('ms-settings:startupapps');
      return true;
    case 'task-manager':
      return runExe(sys32('taskmgr.exe'));
    case 'services':
      await shell.openPath(sys32('services.msc'));
      return true;
    case 'task-scheduler':
      await shell.openPath(sys32('taskschd.msc'));
      return true;
    case 'device-manager':
      await shell.openPath(sys32('devmgmt.msc'));
      return true;
    case 'event-viewer':
      await shell.openPath(sys32('eventvwr.msc'));
      return true;
    case 'reliability':
      return runExe(sys32('perfmon.exe'), ['/rel']);
    case 'disk-cleanup':
      return runExe(sys32('cleanmgr.exe'));
    case 'storage-settings':
      await shell.openExternal('ms-settings:storagesense');
      return true;
    case 'windows-update':
      await shell.openExternal('ms-settings:windowsupdate');
      return true;
    case 'windows-security':
      await shell.openExternal('windowsdefender:');
      return true;
    case 'firewall':
      await shell.openPath(sys32('Firewall.cpl'));
      return true;
    case 'programs':
      await shell.openPath(sys32('appwiz.cpl'));
      return true;
    case 'restore-settings':
      return runExe(sys32('SystemPropertiesProtection.exe'));
    case 'power-settings':
      // Classic Power Options applet — lets the technician switch the active
      // plan directly (the modern Settings page hides the plan chooser).
      await shell.openPath(sys32('powercfg.cpl'));
      return true;
    case 'hosts-file':
      return runExe(sys32('notepad.exe'), [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts')]);
    default:
      return false;
  }
}

async function openUrl(url) {
  try {
    const u = new URL(String(url));
    // Only ever hand https/http links to the system browser (never file:, etc.).
    if (u.protocol === 'https:' || u.protocol === 'http:') {
      await shell.openExternal(u.href);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

module.exports = { openToken, openUrl };
