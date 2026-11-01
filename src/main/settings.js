'use strict';

// Local settings store. The Syncro API token is encrypted at rest with the OS
// keychain (Electron safeStorage / Windows DPAPI) when available, and never
// handed back to the renderer — only a hasToken flag is exposed.

const { app, safeStorage } = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readRaw() {
  try {
    return JSON.parse(await fsp.readFile(file(), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function writeRaw(obj) {
  const f = file();
  const tmp = `${f}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fsp.rename(tmp, f);
}

function encToken(token) {
  if (!token) return null;
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return { enc: 'os', v: safeStorage.encryptString(token).toString('base64') };
    }
  } catch {
    /* fall through to plain */
  }
  return { enc: 'plain', v: Buffer.from(token, 'utf8').toString('base64') };
}

function decToken(t) {
  if (!t || !t.v) return '';
  try {
    if (t.enc === 'os' && safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(t.v, 'base64'));
    }
    if (t.enc === 'plain') return Buffer.from(t.v, 'base64').toString('utf8');
  } catch {
    /* ignore */
  }
  return '';
}

async function getPublic() {
  const s = await readRaw();
  return { subdomain: s.syncroSubdomain || '', hasToken: !!(s.syncroToken && s.syncroToken.v) };
}

async function getForApi() {
  const s = await readRaw();
  return { subdomain: s.syncroSubdomain || '', token: decToken(s.syncroToken) };
}

async function save({ subdomain, token } = {}) {
  const s = await readRaw();
  if (subdomain !== undefined) s.syncroSubdomain = String(subdomain || '').trim();
  if (token === null) delete s.syncroToken; // explicit clear
  else if (typeof token === 'string' && token.length) s.syncroToken = encToken(token);
  await writeRaw(s);
  return getPublic();
}

module.exports = { getPublic, getForApi, save };
