'use strict';

// Emsisoft partner / MSP API client (main process).
//
// Deploys Emsisoft protection for a customer: creates a workspace, assigns a
// licence (an existing coupon key, a monthly MSP seat, or a trial), and pulls
// the installer download links. All requests run here in the main process —
// never the renderer — so the partner API key stays local and there are no
// CORS/CSP concerns.
//
// AUTH: header "Api-Key: <key>". The key is stored in the portable tools.json
// (see settings.js) exactly like the Syncro token, so it travels on the USB
// stick. API access must be enabled in the Emsisoft user profile first
// (MyEmsisoft → profile → API access), and partner features (creating
// workspaces, assigning licences, MSP billing) require a registered partner
// key requested from your Emsisoft partner manager.
//
// ─────────────────────────────────────────────────────────────────────────
//  CONFIRMED vs UNCONFIRMED
//  The create-workspace (coupon path) and install-links endpoints below are
//  confirmed against Emsisoft's own automation guide:
//    https://www.emsisoft.com/en/help/3231/automation-guide-setting-up-new-customer-workspaces-via-api
//  The bits Emsisoft's public docs do NOT cover — the exact field names for a
//  TRIAL and for MONTHLY MSP billing, the "list my unused licences" endpoint,
//  the licence-assignment endpoint, and whether create returns the workspace
//  GUID — are marked UNCONFIRMED and gathered in API_GUESSES. They are
//  best-guesses from the documented naming. When the live API disagrees, the
//  app surfaces Emsisoft's real error ({error:{code,target,message}}); fix the
//  one wrong line in API_GUESSES and nothing else needs to change.
// ─────────────────────────────────────────────────────────────────────────

const BASE = 'https://api.emsisoft.com';
const REQUEST_TIMEOUT_MS = 25000;

// Product editions offered in the deploy popup. Codes are best-guess partner
// codes (Business Security / Enterprise Security); adjust the `code` values if
// the live API expects different strings. (The only product code in the public
// docs is "EAM" for consumer Anti-Malware, which is not a partner edition.)
const PRODUCTS = [
  { code: 'EBS', label: 'Business Security' },
  { code: 'EES', label: 'Enterprise Security' },
];

// Everything the public docs don't pin down. One place to correct.
const API_GUESSES = {
  // List the partner's unused licence coupons. Spec/best-guess.
  listLicences: { path: '/v1/partner/coupons', query: { Used: 'false' } },
  // List the partner's workspaces — used only as a fallback to find the new
  // workspace's GUID when create's response doesn't include it. Best-guess.
  listWorkspaces: { path: '/v1/partner/workspaces' },
  // Assign a licence to an ALREADY-created workspace (fallback path, e.g. if a
  // coupon couldn't be applied inline). Best-guess.
  assignLicence: { path: (guid) => `/v1/workspaces/${guid}/assign-license`, field: 'key' },
  // Body fields that select the licence type on create. `coupon` is CONFIRMED;
  // the trial and MSP fields are best-guess.
  licenceBody: {
    coupon: (v) => ({ coupon: v.coupon }),                                   // CONFIRMED
    trial: (v) => ({ trialProduct: v.product }),                             // UNCONFIRMED
    msp: (v) => ({ mspProduct: v.product, mspMaximumSeatsCount: v.seats }),  // UNCONFIRMED
  },
  // Response fields that may carry the new workspace's GUID on create.
  createGuidFields: ['guid', 'workspaceGuid', 'id', 'workspaceId', 'workspace_guid'],
};

// ---- low-level request ----
async function request(key, method, pathname, { query, body } = {}) {
  let url = BASE + pathname;
  if (query && typeof query === 'object') {
    const qs = Object.keys(query)
      .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(query[k]))
      .join('&');
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  const headers = { 'Api-Key': key, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(to);
  }
  const text = await res.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  return { status: res.status, ok: res.status >= 200 && res.status < 300, json, text, method, pathname };
}

// Pull Emsisoft's real error out of a failed response.
// Format: { "error": { "code", "target", "message" } }.
function readError(r) {
  const e = r && r.json && r.json.error;
  if (e && typeof e === 'object') {
    const parts = [];
    if (e.message) parts.push(String(e.message));
    if (e.target && String(e.target) !== String(e.message)) parts.push('(' + e.target + ')');
    else if (e.code) parts.push('(' + e.code + ')');
    if (parts.length) return parts.join(' ');
  }
  if (r && r.text) return String(r.text).slice(0, 300);
  return '';
}

// Failure message that names the exact call (method + path) so a 404/400 points
// straight at the problem instead of being an anonymous "HTTP 404".
function describeFail(r, verb) {
  if (r.status === 401) return `Emsisoft rejected the API key (HTTP 401). Check the key and that API access is enabled in your Emsisoft profile.`;
  if (r.status === 403) return `Not permitted (HTTP 403). ${verb} needs a registered Emsisoft partner key.`;
  const detail = readError(r);
  const where = (r.method && r.pathname) ? ` for ${r.method} ${r.pathname}` : '';
  return `${verb} failed — Emsisoft returned HTTP ${r.status}${where}.${detail ? ' ' + detail : ''}`;
}
// Back-compat alias.
const authMessage = describeFail;

// ---- public operations ----

// Cheap read to confirm the key works (also used by "Test connection").
async function testConnection({ key }) {
  if (!key) return { ok: false, message: 'Enter your Emsisoft API key.' };
  try {
    const g = API_GUESSES.listLicences;
    const r = await request(key, 'GET', g.path, { query: g.query });
    if (r.ok) return { ok: true, message: 'Connected to Emsisoft.' };
    if (r.status === 401 || r.status === 403) return { ok: false, message: authMessage(r, 'Listing licences') };
    if (r.status === 404) return { ok: false, message: 'Key accepted, but the licences endpoint wasn’t found (HTTP 404) — the path may differ on your account. Deploying can still work.' };
    return { ok: false, message: authMessage(r, 'Test') };
  } catch (e) {
    return { ok: false, message: 'Could not reach Emsisoft: ' + ((e && e.message) || e) };
  }
}

// List the partner's unused licence coupons for the licence-key dropdown.
async function listLicences({ key, product }) {
  if (!key) return { ok: false, message: 'Emsisoft API key is not set.' };
  try {
    const g = API_GUESSES.listLicences;
    const r = await request(key, 'GET', g.path, { query: g.query });
    if (!r.ok) return { ok: false, message: authMessage(r, 'Listing licences') };
    const data = (r.json && (r.json.data || r.json.coupons || r.json.items)) || (Array.isArray(r.json) ? r.json : []);
    let licences = (Array.isArray(data) ? data : []).map((c) => ({
      key: c.key || c.coupon || c.code || '',
      product: c.product || c.productCode || '',
      seats: c.seats != null ? c.seats : (c.seatCount != null ? c.seatCount : null),
      months: c.months != null ? c.months : null,
      expiry: c.expiry || c.expiresAt || c.expires || '',
      notes: c.notes || c.note || '',
      used: c.used === true,
    })).filter((c) => c.key && !c.used);
    if (product) licences = licences.filter((c) => !c.product || String(c.product).toUpperCase() === String(product).toUpperCase());
    const totalCount = (r.json && (r.json.totalCount != null ? r.json.totalCount : null));
    return { ok: true, licences, totalCount };
  } catch (e) {
    return { ok: false, message: 'Could not reach Emsisoft: ' + ((e && e.message) || e) };
  }
}

// Create a workspace for a customer with the chosen licence.
// licence = { type: 'coupon', coupon } | { type: 'msp', product, seats } | { type: 'trial', product }
async function createWorkspace({ key, name, customerEmail, licence }) {
  if (!key) return { ok: false, message: 'Emsisoft API key is not set.' };
  if (!name || !String(name).trim()) return { ok: false, message: 'Enter a workspace name.' };
  const lic = licence || {};
  const body = {
    name: String(name).trim(),
    customerRole: 'owner',   // customer is invited as workspace owner
    partnerRole: 'admin',    // you are added as workspace admin
    billingContact: 'Partner', // Emsisoft won't chase your customer for renewals
  };
  if (customerEmail && String(customerEmail).trim()) body.customerEmail = String(customerEmail).trim();

  const build = API_GUESSES.licenceBody[lic.type];
  if (!build) return { ok: false, message: 'Choose a licence option (licence key, monthly, or trial).' };
  if (lic.type === 'coupon' && !lic.coupon) return { ok: false, message: 'Select a licence key to use.' };
  if ((lic.type === 'msp' || lic.type === 'trial') && !lic.product) return { ok: false, message: 'Choose a product edition.' };
  if (lic.type === 'msp') {
    const n = parseInt(lic.seats, 10);
    if (!(n > 0)) return { ok: false, message: 'Enter how many seats for monthly billing.' };
    lic.seats = n;
  }
  Object.assign(body, build(lic));

  // The 2022 docs use POST /v1/partner/workspaces/create; the modern RESTful
  // path is likely POST /v1/partner/workspaces. Try the documented one first and
  // fall back ONLY on 404 (path not found ⇒ nothing was created, safe to retry).
  // A 400/409/etc. means the path exists but the request was wrong — stop there.
  const CREATE_PATHS = ['/v1/partner/workspaces/create', '/v1/partner/workspaces'];
  try {
    let r = null;
    const tried = [];
    for (let i = 0; i < CREATE_PATHS.length; i++) {
      r = await request(key, 'POST', CREATE_PATHS[i], { body });
      tried.push('POST ' + CREATE_PATHS[i]);
      if (r.status !== 404) break; // 404 only ⇒ try the next candidate path
    }
    if (!r.ok) {
      // Surface Emsisoft's real reason (e.g. WorkspaceNameAlreadyInUse).
      let message = authMessage(r, 'Creating a workspace');
      if (r.status === 404 && tried.length > 1) message = `Creating a workspace failed — HTTP 404 (none of these paths exist: ${tried.join(', ')}). The create endpoint differs on your account.`;
      return { ok: false, message, status: r.status };
    }
    // Try to find the GUID in the create response.
    let guid = '';
    const j = r.json || {};
    const src = (j.workspace && typeof j.workspace === 'object') ? j.workspace : j;
    for (const f of API_GUESSES.createGuidFields) {
      if (src && src[f]) { guid = String(src[f]); break; }
    }
    return { ok: true, name: body.name, guid };
  } catch (e) {
    return { ok: false, message: 'Could not reach Emsisoft: ' + ((e && e.message) || e) };
  }
}

// Fallback: find a workspace's GUID by its (unique) name.
async function findWorkspaceGuid({ key, name }) {
  try {
    const g = API_GUESSES.listWorkspaces;
    const r = await request(key, 'GET', g.path);
    if (!r.ok) return '';
    const list = (r.json && (r.json.data || r.json.workspaces || r.json.items)) || (Array.isArray(r.json) ? r.json : []);
    const hit = (Array.isArray(list) ? list : []).find((w) => String(w.name || '').trim() === String(name).trim());
    if (!hit) return '';
    return String(hit.guid || hit.workspaceGuid || hit.id || hit.workspaceId || '');
  } catch { return ''; }
}

// Get the installer download links + token for a workspace.
async function getInstall({ key, guid }) {
  if (!key) return { ok: false, message: 'Emsisoft API key is not set.' };
  if (!guid) return { ok: false, message: 'No workspace GUID.' };
  try {
    const r = await request(key, 'GET', `/v1/workspaces/${encodeURIComponent(guid)}/install`);
    if (!r.ok) return { ok: false, message: authMessage(r, 'Getting install links') };
    const j = r.json || {};
    return {
      ok: true,
      links: {
        downloadUrl: j.downloadUrl || '',
        downloadX64Url: j.downloadX64Url || '',
        downloadX32Url: j.downloadX32Url || '',
        installToken: j.installToken || '',
      },
    };
  } catch (e) {
    return { ok: false, message: 'Could not reach Emsisoft: ' + ((e && e.message) || e) };
  }
}

// Fallback: assign a licence to an existing workspace (best-guess endpoint).
async function assignLicence({ key, guid, licenceKey }) {
  if (!key || !guid || !licenceKey) return { ok: false, message: 'Missing key, workspace or licence.' };
  try {
    const g = API_GUESSES.assignLicence;
    const r = await request(key, 'POST', g.path(encodeURIComponent(guid)), { body: { [g.field]: licenceKey } });
    if (!r.ok) return { ok: false, message: authMessage(r, 'Assigning a licence') };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: 'Could not reach Emsisoft: ' + ((e && e.message) || e) };
  }
}

// Orchestrate a full deploy: create the workspace, resolve its GUID, fetch the
// installer links. The caller (UI) has already shown the tech exactly which
// licence will be used and taken an explicit confirm before calling this.
async function deploy({ key, name, customerEmail, licence }) {
  const created = await createWorkspace({ key, name, customerEmail, licence });
  if (!created.ok) return created;

  let guid = created.guid;
  let guidResolved = !!guid;
  if (!guid) {
    guid = await findWorkspaceGuid({ key, name: created.name });
    guidResolved = !!guid;
  }

  const out = {
    ok: true,
    name: created.name,
    guid: guid || '',
    guidResolved,
    licence,
  };

  if (!guid) {
    out.links = null;
    out.message = 'Workspace created, but its GUID wasn’t returned and couldn’t be looked up, so the installer links aren’t available here yet. Open MyEmsisoft to get them.';
    return out;
  }

  const inst = await getInstall({ key, guid });
  if (!inst.ok) {
    out.links = null;
    out.message = 'Workspace created, but fetching the installer links failed: ' + inst.message;
    return out;
  }
  out.links = inst.links;
  return out;
}

module.exports = {
  PRODUCTS,
  testConnection,
  listLicences,
  createWorkspace,
  findWorkspaceGuid,
  getInstall,
  assignLicence,
  deploy,
};
