'use strict';

// Minimal Syncro REST client (main process). Posts Issue Scanner results as a
// comment on an existing ticket. Uses a Bearer API token (Syncro: Admin → API
// Tokens). All requests run here, not in the renderer, so no CSP concerns.

function normalizeBase(subdomain) {
  let s = String(subdomain || '').trim();
  s = s.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!s) return null;
  const host = s.includes('.') ? s.split('/')[0] : s + '.syncromsp.com';
  return `https://${host}/api/v1`;
}

async function apiRequest(base, token, pathname, options = {}) {
  return fetch(base + pathname, {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function testConnection({ subdomain, token }) {
  const base = normalizeBase(subdomain);
  if (!base) return { ok: false, message: 'Enter your Syncro subdomain.' };
  if (!token) return { ok: false, message: 'Enter your Syncro API token.' };
  try {
    const res = await apiRequest(base, token, '/tickets?per_page=1');
    if (res.status === 200) return { ok: true, message: 'Connected to ' + base.replace('/api/v1', '') + '.' };
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Token rejected — check the API token and that it has ticket permissions.' };
    if (res.status === 404) return { ok: false, message: 'Not found — check the subdomain is correct.' };
    return { ok: false, message: `Syncro returned HTTP ${res.status}.` };
  } catch (e) {
    return { ok: false, message: 'Could not reach Syncro: ' + e.message };
  }
}

// Resolve a human ticket NUMBER to its internal id (+ customer) via search.
async function lookupTicket({ subdomain, token, number }) {
  const base = normalizeBase(subdomain);
  if (!base) return { ok: false, message: 'Syncro subdomain is not set.' };
  if (!token) return { ok: false, message: 'Syncro API token is not set.' };
  const num = String(number || '').trim().replace(/^#/, '');
  if (!/^\d+$/.test(num)) return { ok: false, message: 'Enter a numeric ticket number.' };
  try {
    const res = await apiRequest(base, token, `/tickets?number=${encodeURIComponent(num)}`);
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Token rejected — the API token needs Tickets permission.' };
    if (res.status !== 200) return { ok: false, message: `Syncro returned HTTP ${res.status}.` };
    let j = {};
    try { j = await res.json(); } catch { /* ignore */ }
    const list = (j && (j.tickets || j.data)) || [];
    const t = list.find((x) => String(x.number) === num) || list[0];
    if (!t) return { ok: false, message: `No ticket #${num} found.` };
    const customerName =
      t.customer_business_then_name ||
      t.customer_full_name ||
      t.customer_fullname ||
      (t.customer && (t.customer.business_name || [t.customer.firstname, t.customer.lastname].filter(Boolean).join(' ').trim())) ||
      (t.customer_id ? 'Customer ' + t.customer_id : 'Unknown customer');
    return {
      ok: true,
      ticket: { id: t.id, number: t.number, subject: t.subject || '(no subject)', customerId: t.customer_id, customerName },
    };
  } catch (e) {
    return { ok: false, message: 'Could not reach Syncro: ' + e.message };
  }
}

// List the account's asset types (so the user can pick a real one).
async function listAssetTypes({ subdomain, token }) {
  const base = normalizeBase(subdomain);
  if (!base) return { ok: false, message: 'Syncro subdomain is not set.' };
  if (!token) return { ok: false, message: 'Syncro API token is not set.' };
  try {
    let res = await apiRequest(base, token, '/customer_asset_types');
    if (res.status === 404) res = await apiRequest(base, token, '/asset_types');
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Token rejected — the API token needs Assets permission.' };
    if (res.status !== 200) return { ok: false, message: `Syncro returned HTTP ${res.status}.` };
    let j = {};
    try { j = await res.json(); } catch { /* ignore */ }
    const raw = (j && (j.asset_types || j.customer_asset_types || j.data || j.types)) || [];
    const types = raw.map((t) => ({ id: t.id, name: t.name })).filter((t) => t.id && t.name);
    return { ok: true, types };
  } catch (e) {
    return { ok: false, message: 'Could not reach Syncro: ' + e.message };
  }
}

// Create a customer asset from this machine's details.
async function createAsset({ subdomain, token, customerId, name, assetTypeId, properties }) {
  const base = normalizeBase(subdomain);
  if (!base) return { ok: false, message: 'Syncro subdomain is not set.' };
  if (!token) return { ok: false, message: 'Syncro API token is not set.' };
  if (!customerId) return { ok: false, message: 'No customer selected — set a ticket first so the asset attaches to the right customer.' };
  if (!assetTypeId) return { ok: false, message: 'Choose an asset type.' };
  try {
    const res = await apiRequest(base, token, '/customer_assets', {
      method: 'POST',
      body: { name: name || 'PC', customer_id: customerId, asset_type_id: assetTypeId, properties: properties || {} },
    });
    if (res.status >= 200 && res.status < 300) {
      let id = null;
      try {
        const j = await res.json();
        id = (j && j.asset && j.asset.id) || (j && j.customer_asset && j.customer_asset.id) || (j && j.id) || null;
      } catch {
        /* ignore */
      }
      return { ok: true, message: `Asset created${id ? ` (#${id})` : ''}.`, assetId: id };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Token rejected — the API token needs permission to create assets.' };
    let txt = '';
    try { txt = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    return { ok: false, message: `Syncro returned HTTP ${res.status}. ${txt}`.trim() };
  } catch (e) {
    return { ok: false, message: 'Could not reach Syncro: ' + e.message };
  }
}

async function postComment({ subdomain, token, ticketId, subject, body, hidden }) {
  const base = normalizeBase(subdomain);
  if (!base) return { ok: false, message: 'Syncro subdomain is not set.' };
  if (!token) return { ok: false, message: 'Syncro API token is not set.' };
  const id = String(ticketId || '').trim().replace(/^#/, '');
  if (!/^\d+$/.test(id)) return { ok: false, message: 'Enter a numeric ticket number.' };
  try {
    const res = await apiRequest(base, token, `/tickets/${id}/comment`, {
      method: 'POST',
      body: {
        subject: subject || 'TM Toolset Issue Scan',
        body: body || '',
        hidden: hidden !== false,
        do_not_email: true,
      },
    });
    if (res.status >= 200 && res.status < 300) {
      let commentId = null;
      try {
        const j = await res.json();
        commentId = (j && j.comment && j.comment.id) || (j && j.id) || null;
      } catch {
        /* ignore body parse */
      }
      return { ok: true, message: `Posted to ticket #${id}.`, commentId };
    }
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Token rejected — the API token needs permission to comment on tickets.' };
    if (res.status === 404) return { ok: false, message: `Ticket id ${id} was not found.` };
    let txt = '';
    try { txt = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    return { ok: false, message: `Syncro returned HTTP ${res.status}. ${txt}`.trim() };
  } catch (e) {
    return { ok: false, message: 'Could not reach Syncro: ' + e.message };
  }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildFindingsComment(result) {
  const r = result || {};
  const sys = (r.data && r.data.system) || {};
  const counts = r.counts || {};
  const when = new Date(r.generatedAt || Date.now()).toLocaleString();
  const out = [];
  out.push(`<p><strong>TM Toolset &mdash; Issue Scan</strong><br>${esc(when)}</p>`);
  out.push(`<p><strong>Health score: ${esc(r.score)}/100</strong> &mdash; ${esc(counts.critical || 0)} critical, ${esc(counts.warning || 0)} warning, ${esc(counts.info || 0)} info</p>`);
  out.push(`<p>${esc(sys.manufacturer || '')} ${esc(sys.model || '')} &middot; ${esc(sys.caption || '')} ${esc(sys.displayVersion || '')} &middot; ${esc(sys.cpu || '')} &middot; ${esc(sys.ramGB || '?')} GB RAM</p>`);

  const bySev = {};
  for (const f of r.findings || []) (bySev[f.severity] = bySev[f.severity] || []).push(f);
  for (const sev of ['critical', 'warning', 'info']) {
    const list = bySev[sev] || [];
    if (!list.length) continue;
    out.push(`<p><strong>${sev.toUpperCase()} (${list.length})</strong></p><ul>`);
    for (const f of list) {
      let li = `<li><strong>${esc(f.title)}</strong> &mdash; ${esc(f.summary)}`;
      if (f.recommendation) li += `<br><em>Recommended:</em> ${esc(f.recommendation)}`;
      li += '</li>';
      out.push(li);
    }
    out.push('</ul>');
  }
  out.push('<p><em>Generated by TM Toolset &middot; Technical Merit</em></p>');
  return out.join('\n');
}

module.exports = { testConnection, lookupTicket, postComment, listAssetTypes, createAsset, buildFindingsComment, normalizeBase };
