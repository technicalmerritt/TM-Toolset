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
const TIMEOUT_MS = 25000;        // quick reads (coupons, test connection)
const CREATE_TIMEOUT_MS = 60000; // workspace create provisions + emails an invite — allow longer
const LINKS_TIMEOUT_MS = 55000;  // policy-group / install-token / workspace-list — Emsisoft is often slow here

// Product editions offered in the deploy popup (trialProduct enum is EAM/EBS/EES;
// EBS/EES are the business editions). Adjust labels freely.
const PRODUCTS = [
  { code: 'EAM', label: 'Anti-Malware (Home)' },
  { code: 'EBS', label: 'Business Security' },
  { code: 'EES', label: 'Enterprise Security' },
];

// Confirmed endpoints/fields (from the live OpenAPI spec).
const API = {
  listLicences: { path: '/v1/partner/coupons', query: { Used: 'false' } },     // GET
  createWorkspace: '/v1/partner/workspaces',                                    // POST
  listWorkspaces: '/v1/workspaces',                                            // GET (guid fallback)
  install: (guid) => `/v1/workspaces/${encodeURIComponent(guid)}/install`,     // GET (hangs on a brand-new workspace — avoided; use set-install-token)
  protectionGroups: (guid) => `/v1/workspaces/${encodeURIComponent(guid)}/protection-groups`, // GET (find the default policy group)
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
  if (Array.isArray(opts.trace)) opts.trace.push({ method, pathname: pathname, status: out.status, ms: out.ms, aborted: out.aborted, networkError: out.networkError, body: String(out.text || '').slice(0, 600) });
  return out;
}

function traceLines(trace) {
  return (trace || []).map((e) => {
    const s = (e.ms / 1000).toFixed(1) + 's';
    let head;
    if (e.aborted) head = `${e.method} ${e.pathname} → timed out (${s})`;
    else if (e.networkError) head = `${e.method} ${e.pathname} → network error (${s})`;
    else head = `${e.method} ${e.pathname} → HTTP ${e.status} (${s})`;
    if (e.body) head += '  ::  ' + e.body;
    return head;
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

function wsList(json) {
  return (json && (json.data || json.workspaces || json.items)) || (Array.isArray(json) ? json : []);
}
function wsGuid(w) { return String((w && (w.guid || w.workspaceGuid || w.id)) || ''); }

// Fallback: find a workspace's GUID by its (unique) name.
async function findWorkspaceGuid({ key, name, trace }) {
  const r = await request(key, 'GET', API.listWorkspaces, { timeoutMs: LINKS_TIMEOUT_MS, trace });
  if (!r.ok) return '';
  const hit = wsList(r.json).find((w) => String(w.name || '').trim() === String(name).trim());
  return hit ? wsGuid(hit) : '';
}

// Look up whether a workspace with this (customer) name already exists, so the
// deploy popup can offer its install links instead of creating a duplicate.
async function findWorkspace({ key, name, trace }) {
  if (!key) return { ok: false, message: 'Emsisoft API key is not set.' };
  if (!name || !String(name).trim()) return { ok: true, found: false };
  const r = await request(key, 'GET', API.listWorkspaces, { timeoutMs: LINKS_TIMEOUT_MS, trace });
  if (!r.ok) return { ok: false, message: describeFail(r, 'Checking existing workspaces') };
  const want = String(name).trim().toLowerCase();
  const matches = wsList(r.json).filter((w) => String(w.name || '').trim().toLowerCase() === want);
  if (!matches.length) return { ok: true, found: false };
  return { ok: true, found: true, guid: wsGuid(matches[0]), name: String(matches[0].name || name), count: matches.length };
}

// Get install links for a workspace already known by guid (or resolved by name).
// Used by the deploy popup's "workspace already exists → get its links" path.
async function getLinks({ key, name, guid }) {
  const trace = [];
  let g = guid || '';
  if (!g && name) { const f = await findWorkspace({ key, name, trace }); if (f.ok && f.found) g = f.guid; }
  if (!g) return { ok: false, message: 'No matching workspace was found to get links for.', trace: traceLines(trace) };
  const r = await getInstall({ key, guid: g, trace });
  r.trace = traceLines(trace);
  r.guid = g;
  return r;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ZERO_GUID = '00000000-0000-0000-0000-000000000000';

// Flatten the (nested) protection-group tree into a flat list.
function flattenGroups(groups, out) {
  out = out || [];
  (Array.isArray(groups) ? groups : []).forEach((g) => {
    if (g && g.guid) out.push(g);
    if (g && Array.isArray(g.childrenList) && g.childrenList.length) flattenGroups(g.childrenList, out);
  });
  return out;
}

// Find a REAL protection group guid to attach the install token to. The
// workspace-ROOT group has an all-zeros placeholder guid and set-install-token
// rejects it (HTTP 401), so we use the first real (non-zero) group — the default
// device group (e.g. "New computers"). A freshly created workspace can take a
// moment to provision it, so retry briefly.
async function findPolicyGroupGuid({ key, guid, trace }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await request(key, 'GET', API.protectionGroups(guid), { timeoutMs: LINKS_TIMEOUT_MS, trace });
    if (!r.ok) return { ok: false, message: describeFail(r, 'Listing protection groups') };
    const raw = Array.isArray(r.json) ? r.json : ((r.json && (r.json.data || r.json.items)) || []);
    const real = flattenGroups(raw).find((g) => g.guid && String(g.guid) !== ZERO_GUID);
    if (real) return { ok: true, pgGuid: String(real.guid) };
    if (attempt < 2) await sleep(2000); // provisioning lag — wait and retry
  }
  return { ok: false, message: 'The workspace has no usable protection group yet. Give it a moment and try “Get links” again, or open MyEmsisoft.' };
}

// Get the installer download links + token for a workspace.
//
// NOTE: GET /v1/workspaces/{guid}/install hangs on a brand-new workspace (no
// token yet), so we do NOT use it. Instead we find the default policy group and
// PUT a new install token — that call CREATES the token and returns the full set
// of download links in one go.
async function getInstall({ key, guid, trace }) {
  if (!key) return { ok: false, message: 'Emsisoft API key is not set.' };
  if (!guid) return { ok: false, message: 'No workspace GUID.' };

  const pg = await findPolicyGroupGuid({ key, guid, trace });
  if (!pg.ok) return { ok: false, message: pg.message };

  // Create the install token (this call also returns all the download links).
  // Emsisoft's server is often slow here, so allow a long timeout and retry once
  // on a timeout / 5xx. Re-issuing is safe: it just creates/replaces the token.
  const tokenBody = { tokenTerm: 'Never', isAutoRenewEnabled: true };
  let p = await request(key, 'PUT', API.setInstallToken(pg.pgGuid), { body: tokenBody, timeoutMs: LINKS_TIMEOUT_MS, trace });
  if (!p.ok && (p.aborted || p.networkError || (p.status >= 500 && p.status < 600))) {
    await sleep(2500);
    p = await request(key, 'PUT', API.setInstallToken(pg.pgGuid), { body: tokenBody, timeoutMs: LINKS_TIMEOUT_MS, trace });
  }
  if (!p.ok) return { ok: false, message: describeFail(p, 'Creating the install token') };

  const links = pickLinks(p.json || {});
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

  let guid = '';
  let wsName = (created && created.name) || name;
  let recovered = false;

  if (created.ok) {
    guid = created.guid;
  } else {
    // A gateway timeout (504/502/503/524) or an aborted request is AMBIGUOUS —
    // Emsisoft's server may have created the workspace anyway. Before reporting
    // failure, wait a moment and look it up by name; if it exists, carry on.
    const ambiguous = created.status === 0 || (created.status >= 500 && created.status < 600);
    if (ambiguous) {
      await sleep(3000);
      const existing = await findWorkspace({ key, name, trace });
      if (existing.ok && existing.found && existing.guid) {
        guid = existing.guid;
        wsName = existing.name || wsName;
        recovered = true;
      }
    }
    if (!guid) {
      created.trace = traceLines(trace);
      if (ambiguous) {
        created.message = 'Emsisoft’s server was too slow and timed out before creating the workspace (HTTP ' + (created.status || 'timeout') + ' — their side, not yours). It may not have been created. Wait a moment and click Deploy again; if it did get created, you’ll be offered its install links instead of a duplicate.';
      }
      return created;
    }
  }

  if (!guid) guid = await findWorkspaceGuid({ key, name: wsName, trace });

  const out = { ok: true, name: wsName, guid: guid || '', guidResolved: !!guid, licence, recovered };

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
  findWorkspace,
  getInstall,
  getLinks,
  assignLicence,
  deploy,
};
