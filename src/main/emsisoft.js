'use strict';

// Emsisoft partner / MSP API client (main process).
//
// Deploys Emsisoft protection for a customer: creates a workspace, assigns a
// licence (an existing coupon key, a monthly MSP seat, or a trial), and pulls
// the installer download links. All requests run here in the main process —
// never the renderer — so the partner API key stays local and there are no
// CORS/CSP concerns.
//
// AUTH: header "Api-Key: <key>" plus "Accept: application/json"; POSTs also send
// "Content-Type: application/json". The key is stored in the portable tools.json
// (see settings.js) exactly like the Syncro token, so it travels on the stick.
// API access must be enabled in the Emsisoft user profile first, and partner
// features (creating workspaces, assigning licences, MSP billing) require a
// registered partner key from your Emsisoft partner manager.
//
// Endpoints/fields below are taken from Emsisoft's live OpenAPI spec
// (https://api.emsisoft.com/swagger/v1.0/swagger.json), not the old 2022 guide.
// Errors come back as { "error": { "code", "target", "message" } }.

const BASE = 'https://api.emsisoft.com';
const TIMEOUT_MS = 25000;        // reads / most calls
const CREATE_TIMEOUT_MS = 60000; // workspace create provisions + emails an invite — allow longer

// Product editions offered in the deploy popup (trialProduct enum is EAM/EBS/EES;
// EBS/EES are the business editions). Adjust labels freely.
const PRODUCTS = [
  { code: 'EBS', label: 'Business Security' },
  { code: 'EES', label: 'Enterprise Security' },
];

// Confirmed endpoints/fields (from the live OpenAPI spec).
const API = {
  listLicences: { path: '/v1/partner/coupons', query: { Used: 'false' } },     // GET
  createWorkspace: '/v1/partner/workspaces',                                    // POST
  listWorkspaces: '/v1/workspaces',                                            // GET (guid fallback)
  install: (guid) => `/v1/workspaces/${encodeURIComponent(guid)}/install`,     // GET
  setInstallToken: (pgGuid) => `/v1/protection-groups/${encodeURIComponent(pgGuid)}/set-install-token`, // PUT (creates token + returns links)
  assignLicence: (guid) => `/v1/workspaces/${encodeURIComponent(guid)}/assign-license`, // POST {key}
  // Default remote-management mode for new workspaces (enum: LocalAndRemote|LocalOnly|RemoteOnly).
  defaultSecurityManagement: 'LocalAndRemote',
};

// ---- low-level request (never throws; records to an optional trace) ----
async function request(key, method, pathname, opts) {
  opts = opts || {};
  let url = BASE + pathname;
  if (opts.query && typeof opts.query === 'object') {
    const qs = Object.keys(opts.query).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(opts.query[k])).join('&');
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }
  const headers = { 'Api-Key': key, Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), opts.timeoutMs || TIMEOUT_MS);
  const started = Date.now();
  const out = { method, pathname, status: 0, ok: false, json: null, text: '', aborted: false, networkError: false, message: '' };
  try {
    const res = await fetch(url, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: ctrl.signal });
    out.status = res.status;
    out.ok = res.status >= 200 && res.status < 300;
    out.text = await res.text().catch(() => '');
    try { out.json = out.text ? JSON.parse(out.text) : null; } catch { /* non-JSON */ }
  } catch (e) {
    out.networkError = true;
    out.aborted = !!(e && (e.name === 'AbortError' || /abort/i.test(String(e && e.message))));
    out.message = (e && e.message) || String(e);
  } finally {
    clearTimeout(to);
  }
  out.ms = Date.now() - started;
  if (Array.isArray(opts.trace)) opts.trace.push({ method, pathname: pathname, status: out.status, ms: out.ms, aborted: out.aborted, networkError: out.networkError });
  return out;
}

function traceLines(trace) {
  return (trace || []).map((e) => {
    const s = (e.ms / 1000).toFixed(1) + 's';
    if (e.aborted) return `${e.method} ${e.pathname} → timed out (${s})`;
    if (e.networkError) return `${e.method} ${e.pathname} → network error (${s})`;
    return `${e.method} ${e.pathname} → HTTP ${e.status} (${s})`;
  });
}

// Pull Emsisoft's real error out of a failed response: { error: { code, target, message } }.
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

// Failure message that names the exact call (method + path) and distinguishes a
// timeout / network error from an HTTP status.
function describeFail(r, verb) {
  const where = (r.method && r.pathname) ? ` for ${r.method} ${r.pathname}` : '';
  if (r.aborted) return `${verb} timed out after ${Math.round((r.ms || 0) / 1000)}s with no reply from Emsisoft${where}.`;
  if (r.networkError) return `${verb} couldn’t reach Emsisoft${where}: ${r.message}`;
  if (r.status === 401) return `Emsisoft rejected the API key (HTTP 401). Check the key and that API access is enabled in your Emsisoft profile.`;
  if (r.status === 403) return `Not permitted (HTTP 403). ${verb} needs a registered Emsisoft partner key.`;
  const detail = readError(r);
  return `${verb} failed — Emsisoft returned HTTP ${r.status}${where}.${detail ? ' ' + detail : ''}`;
}

// ---- public operations ----

// Cheap read to confirm the key works (also used by "Test connection").
async function testConnection({ key }) {
  if (!key) return { ok: false, message: 'Enter your Emsisoft API key.' };
  const r = await request(key, 'GET', API.listLicences.path, { query: API.listLicences.query });
  if (r.ok) return { ok: true, message: 'Connected to Emsisoft.' };
  return { ok: false, message: describeFail(r, 'Test connection') };
}

// List the partner's unused licence coupons for the licence-key dropdown.
async function listLicences({ key, product }) {
  if (!key) return { ok: false, message: 'Emsisoft API key is not set.' };
  const r = await request(key, 'GET', API.listLicences.path, { query: API.listLicences.query });
  if (!r.ok) return { ok: false, message: describeFail(r, 'Listing licences') };
  const data = (r.json && (r.json.data || r.json.coupons || r.json.items)) || (Array.isArray(r.json) ? r.json : []);
  let licences = (Array.isArray(data) ? data : []).map((c) => ({
    key: c.key || '',
    product: c.product || '',
    seats: c.seats != null ? c.seats : null,
    months: c.months != null ? c.months : null,
    expiry: c.expiry || '',
    notes: c.notes || '',
    used: c.used === true,
  })).filter((c) => c.key && !c.used);
  if (product) licences = licences.filter((c) => !c.product || String(c.product).toUpperCase() === String(product).toUpperCase());
  const totalCount = (r.json && (r.json.totalCount != null ? r.json.totalCount : null));
  return { ok: true, licences, totalCount };
}

// Build the create request body for the chosen licence.
// licence = { type: 'coupon', coupon } | { type: 'msp', product, seats } | { type: 'trial', product }
function buildCreateBody({ name, customerEmail, licence }) {
  const lic = licence || {};
  const body = {
    name: String(name).trim(),
    securityManagement: API.defaultSecurityManagement,
    customerRole: 'owner',     // customer is invited as workspace owner
    partnerRole: 'admin',      // you are added as workspace admin (required)
    billingContact: 'Partner', // Emsisoft won't chase your customer for renewals
  };
  if (customerEmail && String(customerEmail).trim()) body.customerEmail = String(customerEmail).trim();
  if (lic.type === 'coupon') body.coupon = lic.coupon;
  else if (lic.type === 'trial') body.trialProduct = lic.product;
  else if (lic.type === 'msp') { body.mspProduct = lic.product; body.mspMaximumSeatsCount = lic.seats; }
  return body;
}

async function createWorkspace({ key, name, customerEmail, licence, trace }) {
  if (!key) return { ok: false, message: 'Emsisoft API key is not set.' };
  if (!name || !String(name).trim()) return { ok: false, message: 'Enter a workspace name.' };
  const lic = licence || {};
  if (!['coupon', 'msp', 'trial'].includes(lic.type)) return { ok: false, message: 'Choose a licence option (licence key, monthly, or trial).' };
  if (lic.type === 'coupon' && !lic.coupon) return { ok: false, message: 'Select a licence key to use.' };
  if ((lic.type === 'msp' || lic.type === 'trial') && !lic.product) return { ok: false, message: 'Choose a product edition.' };
  if (lic.type === 'msp') { const n = parseInt(lic.seats, 10); if (!(n > 0)) return { ok: false, message: 'Enter how many seats for monthly billing.' }; lic.seats = n; }

  const body = buildCreateBody({ name, customerEmail, licence: lic });
  const r = await request(key, 'POST', API.createWorkspace, { body, timeoutMs: CREATE_TIMEOUT_MS, trace });
  if (!r.ok) return { ok: false, message: describeFail(r, 'Creating a workspace'), status: r.status };
  const j = r.json || {};
  const src = (j.workspace && typeof j.workspace === 'object') ? j.workspace : j;
  const guid = String(src.guid || src.workspaceGuid || src.id || '');
  return { ok: true, name: body.name, guid };
}

// Fallback: find a workspace's GUID by its (unique) name.
async function findWorkspaceGuid({ key, name, trace }) {
  const r = await request(key, 'GET', API.listWorkspaces, { trace });
  if (!r.ok) return '';
  const list = (r.json && (r.json.data || r.json.workspaces || r.json.items)) || (Array.isArray(r.json) ? r.json : []);
  const hit = (Array.isArray(list) ? list : []).find((w) => String(w.name || '').trim() === String(name).trim());
  return hit ? String(hit.guid || hit.workspaceGuid || hit.id || '') : '';
}

function pickLinks(j) {
  j = j || {};
  return {
    downloadUrl: j.downloadUrl || '',
    downloadUrlFull: j.downloadUrlFull || '',
    downloadUrlDirect: j.downloadUrlDirect || '',
    downloadUrlDirectFull: j.downloadUrlDirectFull || '',
    downloadUrlMacOsArm: j.downloadUrlMacOsArm || '',
    downloadUrlMacOsX64: j.downloadUrlMacOsX64 || '',
    installToken: j.installToken || '',
    tokenExpiration: j.tokenExpiration || '',
  };
}

// Get the installer download links + token for a workspace. A freshly created
// workspace has no install token yet, so GET /install returns empty links; in
// that case create the token on the default policy group (which both creates it
// and returns the full set of download links) and use those.
async function getInstall({ key, guid, trace }) {
  if (!key) return { ok: false, message: 'Emsisoft API key is not set.' };
  if (!guid) return { ok: false, message: 'No workspace GUID.' };
  const r = await request(key, 'GET', API.install(guid), { trace });
  if (!r.ok) return { ok: false, message: describeFail(r, 'Getting install links') };
  const j = r.json || {};
  let links = pickLinks(j);

  // No token/links yet → create the install token on the default policy group.
  if ((!links.downloadUrl || !links.installToken) && j.policyGroupGuid) {
    const p = await request(key, 'PUT', API.setInstallToken(j.policyGroupGuid), {
      body: { tokenTerm: 'Never', isAutoRenewEnabled: true },
      trace,
    });
    if (!p.ok) return { ok: false, message: describeFail(p, 'Creating the install token') };
    links = pickLinks(p.json || {});
  }

  if (!links.downloadUrl && !links.installToken) {
    return { ok: false, message: 'The workspace was created but Emsisoft returned no install links or token. You can get them from MyEmsisoft.' };
  }
  return { ok: true, links };
}

// Fallback: assign a licence to an existing workspace.
async function assignLicence({ key, guid, licenceKey, trace }) {
  if (!key || !guid || !licenceKey) return { ok: false, message: 'Missing key, workspace or licence.' };
  const r = await request(key, 'POST', API.assignLicence(guid), { body: { key: licenceKey }, trace });
  if (!r.ok) return { ok: false, message: describeFail(r, 'Assigning a licence') };
  return { ok: true };
}

// Orchestrate a full deploy: create the workspace, resolve its GUID, fetch the
// installer links. The caller (UI) has already shown the tech exactly which
// licence will be used and taken an explicit confirm before calling this.
async function deploy({ key, name, customerEmail, licence }) {
  const trace = [];
  const created = await createWorkspace({ key, name, customerEmail, licence, trace });
  if (!created.ok) { created.trace = traceLines(trace); return created; }

  let guid = created.guid;
  if (!guid) guid = await findWorkspaceGuid({ key, name: created.name, trace });

  const out = { ok: true, name: created.name, guid: guid || '', guidResolved: !!guid, licence };

  if (!guid) {
    out.links = null;
    out.message = 'Workspace created, but its GUID wasn’t returned and couldn’t be looked up, so the installer links aren’t available here yet. Open MyEmsisoft to get them.';
    out.trace = traceLines(trace);
    return out;
  }

  const inst = await getInstall({ key, guid, trace });
  if (!inst.ok) {
    out.links = null;
    out.message = 'Workspace created, but fetching the installer links failed: ' + inst.message;
  } else {
    out.links = inst.links;
  }
  out.trace = traceLines(trace);
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
