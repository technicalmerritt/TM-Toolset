'use strict';

// Syncro credential store.
//
// PORTABILITY: TM Toolset runs from a USB stick. Credentials must travel WITH
// the stick, so they live in the portable config (tools.json in the data dir
// next to the executable), NOT in the per-machine userData folder.
//
// That rules out OS-keychain encryption (Electron safeStorage / Windows DPAPI):
// DPAPI ciphertext is bound to the Windows user+machine that created it and can
// never be decrypted on a different PC, which would defeat the whole point. So
// the portable token is stored with app-level obfuscation (base64) only — it is
// NOT strong encryption. The USB stick itself is the security boundary; keep it
// physically secure. (Old installs that encrypted the token in userData are
// migrated across on first run, decrypting with safeStorage while still on the
// machine that created them.)

const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

// Injected by main.js at startup so this module reads/writes the SAME portable
// tools.json (and its serialized atomic writer) as the rest of the app.
let _readConfig = null;
let _writeConfig = null;
function configure({ readConfig, writeConfig } = {}) {
  if (typeof readConfig === 'function') _readConfig = readConfig;
  if (typeof writeConfig === 'function') _writeConfig = writeConfig;
}

// ---- portable token obfuscation (travels across machines) ----
function packToken(token) {
  if (!token) return null;
  return { enc: 'portable', v: Buffer.from(String(token), 'utf8').toString('base64') };
}
function unpackToken(t) {
  if (!t || !t.v) return '';
  try {
    // New portable form, and the legacy 'plain' base64 form, decode the same way.
    if (t.enc === 'portable' || t.enc === 'plain') {
      return Buffer.from(t.v, 'base64').toString('utf8');
    }
    // Legacy DPAPI form — only decodes on the machine that created it. Used
    // during migration from the old userData store.
    if (t.enc === 'os' && safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(t.v, 'base64'));
    }
  } catch {
    /* ignore */
  }
  return '';
}

// ---- legacy per-machine store (userData/settings.json) ----
function legacyFile() {
  try { return path.join(app.getPath('userData'), 'settings.json'); } catch { return null; }
}
function readLegacy() {
  const f = legacyFile();
  if (!f) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

// Read the portable config's syncro block, migrating a legacy userData store
// into it on first run if the portable block is empty.
async function readSyncro() {
  if (!_readConfig) return {};
  let cfg;
  try { cfg = await _readConfig(); } catch { cfg = null; }
  cfg = cfg && typeof cfg === 'object' ? cfg : {};
  if (cfg.syncro && typeof cfg.syncro === 'object') return cfg.syncro;

  // No portable creds yet — try to migrate the old per-machine store.
  const legacy = readLegacy();
  if (legacy && (legacy.syncroSubdomain || (legacy.syncroToken && legacy.syncroToken.v))) {
    const migrated = {
      subdomain: String(legacy.syncroSubdomain || '').trim(),
      token: null,
    };
    const tok = unpackToken(legacy.syncroToken); // decrypts DPAPI here, on-machine
    if (tok) migrated.token = packToken(tok); // re-store in portable form
    try {
      cfg.syncro = migrated;
      if (_writeConfig) await _writeConfig(cfg);
    } catch { /* best effort */ }
    return migrated;
  }
  return {};
}

async function getPublic() {
  const s = await readSyncro();
  return { subdomain: (s && s.subdomain) || '', hasToken: !!(s && s.token && s.token.v) };
}

async function getForApi() {
  const s = await readSyncro();
  return { subdomain: (s && s.subdomain) || '', token: unpackToken(s && s.token) };
}

async function save({ subdomain, token } = {}) {
  if (!_readConfig || !_writeConfig) throw new Error('Settings store not initialised.');
  const cfg = (await _readConfig()) || {};
  const cur = (cfg.syncro && typeof cfg.syncro === 'object') ? cfg.syncro : {};
  const next = { subdomain: cur.subdomain || '', token: cur.token || null };
  if (subdomain !== undefined) next.subdomain = String(subdomain || '').trim();
  if (token === null) next.token = null; // explicit clear
  else if (typeof token === 'string' && token.length) next.token = packToken(token);
  cfg.syncro = next;
  await _writeConfig(cfg);
  return { subdomain: next.subdomain || '', hasToken: !!(next.token && next.token.v) };
}

module.exports = { configure, getPublic, getForApi, save };
