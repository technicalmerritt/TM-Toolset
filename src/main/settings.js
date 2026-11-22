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

// ─────────────────────────────────────────────────────────────────────────
//  Emsisoft partner API key + non-secret deploy defaults.
//  Stored in the SAME portable tools.json, obfuscated the same way as the
//  Syncro token, so it travels on the USB stick. `defaults` holds no secrets
//  (preferred product, seat count, which licence option is pre-selected).
// ─────────────────────────────────────────────────────────────────────────

async function readEmsisoft() {
  if (!_readConfig) return {};
  let cfg;
  try { cfg = await _readConfig(); } catch { cfg = null; }
  cfg = cfg && typeof cfg === 'object' ? cfg : {};
  return (cfg.emsisoft && typeof cfg.emsisoft === 'object') ? cfg.emsisoft : {};
}

function cleanDefaults(d) {
  d = d && typeof d === 'object' ? d : {};
  const option = ['coupon', 'msp', 'trial'].includes(d.option) ? d.option : 'coupon';
  const product = (typeof d.product === 'string' && d.product.trim()) ? d.product.trim() : 'EAM'; // Home by default
  let seats = parseInt(d.seats, 10);
  if (!(seats > 0)) seats = 1;
  const logToTicket = d.logToTicket !== false; // default on
  const pt = (d.policyTemplate && typeof d.policyTemplate === 'object')
    ? { guid: String(d.policyTemplate.guid || ''), name: String(d.policyTemplate.name || '') }
    : { guid: '', name: '' };
  return { option, product, seats, logToTicket, policyTemplate: pt };
}

async function getEmsisoftPublic() {
  const e = await readEmsisoft();
  return { hasKey: !!(e && e.key && e.key.v), defaults: cleanDefaults(e && e.defaults) };
}

async function getEmsisoftForApi() {
  const e = await readEmsisoft();
  return { key: unpackToken(e && e.key) };
}

async function saveEmsisoft({ key, defaults } = {}) {
  if (!_readConfig || !_writeConfig) throw new Error('Settings store not initialised.');
  const cfg = (await _readConfig()) || {};
  const cur = (cfg.emsisoft && typeof cfg.emsisoft === 'object') ? cfg.emsisoft : {};
  const next = { key: cur.key || null, defaults: cleanDefaults(cur.defaults) };
  if (key === null) next.key = null; // explicit clear
  else if (typeof key === 'string' && key.length) next.key = packToken(key);
  if (defaults !== undefined) next.defaults = cleanDefaults({ ...next.defaults, ...defaults });
  cfg.emsisoft = next;
  await _writeConfig(cfg);
  return { hasKey: !!(next.key && next.key.v), defaults: next.defaults };
}

// ─────────────────────────────────────────────────────────────────────────
//  eBay developer API credentials (App ID / Cert ID) for live price lookups.
//  Stored obfuscated in the portable tools.json, same as the other secrets.
// ─────────────────────────────────────────────────────────────────────────
async function readEbay() {
  if (!_readConfig) return {};
  let cfg;
  try { cfg = await _readConfig(); } catch { cfg = null; }
  cfg = cfg && typeof cfg === 'object' ? cfg : {};
  return (cfg.ebay && typeof cfg.ebay === 'object') ? cfg.ebay : {};
}
async function getEbayPublic() {
  const e = await readEbay();
  return { hasKeys: !!(e && e.appId && e.appId.v && e.certId && e.certId.v) };
}
async function getEbayForApi() {
  const e = await readEbay();
  return { appId: unpackToken(e && e.appId), certId: unpackToken(e && e.certId) };
}
async function saveEbay({ appId, certId } = {}) {
  if (!_readConfig || !_writeConfig) throw new Error('Settings store not initialised.');
  const cfg = (await _readConfig()) || {};
  const cur = (cfg.ebay && typeof cfg.ebay === 'object') ? cfg.ebay : {};
  const next = { appId: cur.appId || null, certId: cur.certId || null };
  if (appId === null) next.appId = null;
  else if (typeof appId === 'string' && appId.length) next.appId = packToken(appId.trim());
  if (certId === null) next.certId = null;
  else if (typeof certId === 'string' && certId.length) next.certId = packToken(certId.trim());
  cfg.ebay = next;
  await _writeConfig(cfg);
  return { hasKeys: !!(next.appId && next.appId.v && next.certId && next.certId.v) };
}

// ─────────────────────────────────────────────────────────────────────────
//  GitHub token (fine-grained PAT) for syncing the shared part-number database.
// ─────────────────────────────────────────────────────────────────────────
async function readGithub() {
  if (!_readConfig) return {};
  let cfg; try { cfg = await _readConfig(); } catch { cfg = null; }
  cfg = cfg && typeof cfg === 'object' ? cfg : {};
  return (cfg.github && typeof cfg.github === 'object') ? cfg.github : {};
}
async function getGithubPublic() { const g = await readGithub(); return { hasToken: !!(g && g.token && g.token.v) }; }
async function getGithubForApi() { const g = await readGithub(); return { token: unpackToken(g && g.token) }; }
async function saveGithub({ token } = {}) {
  if (!_readConfig || !_writeConfig) throw new Error('Settings store not initialised.');
  const cfg = (await _readConfig()) || {};
  const cur = (cfg.github && typeof cfg.github === 'object') ? cfg.github : {};
  const next = { token: cur.token || null };
  if (token === null) next.token = null;
  else if (typeof token === 'string' && token.length) next.token = packToken(token.trim());
  cfg.github = next;
  await _writeConfig(cfg);
  return { hasToken: !!(next.token && next.token.v) };
}

module.exports = {
  configure, getPublic, getForApi, save,
  getEmsisoftPublic, getEmsisoftForApi, saveEmsisoft,
  getEbayPublic, getEbayForApi, saveEbay,
  getGithubPublic, getGithubForApi, saveGithub,
};
