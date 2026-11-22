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
// List the most recent live/open tickets (not resolved) so the technician can
// pick from a menu instead of typing a number. Returns the same shape as
// lookupTicket's ticket, so the picker can set the active ticket directly.
async function listActiveTickets({ subdomain, token, limit }) {
  const base = normalizeBase(subdomain);
  if (!base) return { ok: false, message: 'Syncro subdomain is not set.' };
  if (!token) return { ok: false, message: 'Syncro API token is not set.' };
  const per = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  try {
    const res = await apiRequest(base, token, `/tickets?per_page=${per}`);
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Token rejected — the API token needs Tickets permission.' };
    if (res.status !== 200) return { ok: false, message: `Syncro returned HTTP ${res.status}.` };
    let j = {};
    try { j = await res.json(); } catch { /* ignore */ }
    const list = (j && (j.tickets || j.data)) || [];
    const tickets = list
      .filter((t) => !/resolved/i.test(String(t.status || '')))
      .map((t) => ({
        id: t.id,
        number: t.number,
        subject: t.subject || '',
        status: t.status || '',
        customerId: t.customer_id,
        customerName:
          t.customer_business_then_name || t.customer_full_name || t.customer_fullname ||
          (t.customer && (t.customer.business_name || [t.customer.firstname, t.customer.lastname].filter(Boolean).join(' ').trim())) ||
          (t.customer_id ? 'Customer ' + t.customer_id : 'Unknown customer'),
      }));
    return { ok: true, tickets };
  } catch (e) {
    return { ok: false, message: 'Could not reach Syncro: ' + e.message };
  }
}

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
async function createAsset({ subdomain, token, customerId, name, assetTypeId, serial, properties }) {
  const base = normalizeBase(subdomain);
  if (!base) return { ok: false, message: 'Syncro subdomain is not set.' };
  if (!token) return { ok: false, message: 'Syncro API token is not set.' };
  if (!customerId) return { ok: false, message: 'No customer selected — set a ticket first so the asset attaches to the right customer.' };
  if (!assetTypeId) return { ok: false, message: 'Choose an asset type.' };
  try {
    const body = { name: name || 'PC', customer_id: customerId, asset_type_id: assetTypeId, properties: properties || {} };
    if (serial) body.asset_serial = serial; // native "Serial Number" field
    const res = await apiRequest(base, token, '/customer_assets', { method: 'POST', body });
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
    const detail = await readError(res);
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `Syncro rejected it (HTTP ${res.status}).${detail ? ' ' + detail : ' The token needs permission to create assets.'}` };
    }
    return { ok: false, message: `Syncro returned HTTP ${res.status}.${detail ? ' ' + detail : ''}` };
  } catch (e) {
    return { ok: false, message: 'Could not reach Syncro: ' + e.message };
  }
}

// Fetch one customer (for their email + name) so the Emsisoft deploy popup can
// pre-fill the invite. Best-effort: returns ok:false with a message on failure.
async function getCustomer({ subdomain, token, customerId }) {
  const base = normalizeBase(subdomain);
  if (!base) return { ok: false, message: 'Syncro subdomain is not set.' };
  if (!token) return { ok: false, message: 'Syncro API token is not set.' };
  const id = String(customerId || '').trim();
  if (!/^\d+$/.test(id)) return { ok: false, message: 'No customer selected.' };
  try {
    const res = await apiRequest(base, token, `/customers/${id}`);
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Token rejected — the API token needs Customers permission.' };
    if (res.status === 404) return { ok: false, message: `Customer ${id} not found.` };
    if (res.status !== 200) return { ok: false, message: `Syncro returned HTTP ${res.status}.` };
    let j = {};
    try { j = await res.json(); } catch { /* ignore */ }
    const c = (j && (j.customer || j.data)) || j || {};
    const name =
      c.business_then_name || c.business_name ||
      [c.firstname, c.lastname].filter(Boolean).join(' ').trim() ||
      c.fullname || c.full_name || '';
    return { ok: true, customer: { id: c.id || Number(id), email: c.email || '', name } };
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
    const detail = await readError(res);
    if (res.status === 404) return { ok: false, message: `Ticket id ${id} was not found.${detail ? ' ' + detail : ''}` };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `Syncro rejected the comment (HTTP ${res.status}).${detail ? ' ' + detail : ' Check the token has ticket edit/comment permission.'}` };
    }
    return { ok: false, message: `Syncro returned HTTP ${res.status}.${detail ? ' ' + detail : ''}` };
  } catch (e) {
    return { ok: false, message: 'Could not reach Syncro: ' + e.message };
  }
}

// Pull Syncro's real error text out of a failed response (JSON {message:[...]}
// or plain text), so we surface the actual reason instead of a guess.
// Add a billable line item to a ticket (POST /tickets/{id}/add_line_item).
// Syncro requires name + description even when a product_id is supplied.
async function addTicketLineItem({ subdomain, token, ticketId, name, description, quantity, price, cost, taxable, productId }) {
  const base = normalizeBase(subdomain);
  if (!base) return { ok: false, message: 'Syncro subdomain is not set.' };
  if (!token) return { ok: false, message: 'Syncro API token is not set.' };
  if (!ticketId) return { ok: false, message: 'No ticket is set in the top bar.' };
  const nm = String(name || '').trim();
  if (!nm) return { ok: false, message: 'The line item needs a name.' };
  try {
    const body = { name: nm, description: String(description || nm), quantity: quantity || 1 };
    if (price != null) body.price = Math.round(Number(price) * 100) / 100;
    if (cost != null) body.cost = Math.round(Number(cost) * 100) / 100;
    if (taxable != null) body.taxable = !!taxable;
    if (productId) body.product_id = productId;
    const res = await apiRequest(base, token, '/tickets/' + ticketId + '/add_line_item', { method: 'POST', body });
    if (res.status >= 200 && res.status < 300) {
      let id = null;
      try { const j = await res.json(); id = (j && j.line_item && j.line_item.id) || (j && j.id) || null; } catch { /* ignore */ }
      return { ok: true, lineItemId: id };
    }
    const detail = await readError(res);
    if (res.status === 401 || res.status === 403) return { ok: false, message: `Syncro rejected it (HTTP ${res.status}).${detail ? ' ' + detail : ' The token needs permission to edit tickets.'}` };
    if (res.status === 404) return { ok: false, message: 'Ticket not found — re-select it in the top bar.' };
    return { ok: false, message: `Syncro returned HTTP ${res.status}.${detail ? ' ' + detail : ''}` };
  } catch (e) {
    return { ok: false, message: 'Could not reach Syncro: ' + e.message };
  }
}

async function readError(res) {
  let bodyText = '';
  try { bodyText = await res.text(); } catch { /* ignore */ }
  let detail = bodyText ? bodyText.slice(0, 400) : '';
  try {
    const j = JSON.parse(bodyText);
    if (j && j.message) detail = Array.isArray(j.message) ? j.message.join('; ') : String(j.message);
    else if (j && j.error) detail = String(j.error);
  } catch {
    /* not JSON — keep raw text */
  }
  return detail;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function gbp(n) { return '£' + (Number(n) || 0).toFixed(2); }

// Create a catalogue product, or update its price if one with the same name
// already exists. Used by the Parts & Quotes tab so a quote can become a
// reusable Syncro product without making duplicates.
async function upsertProduct({ subdomain, token, name, priceRetail, priceCost, description }) {
  const base = normalizeBase(subdomain);
  if (!base) return { ok: false, message: 'Syncro subdomain is not set.' };
  if (!token) return { ok: false, message: 'Syncro API token is not set.' };
  const nm = String(name || '').trim();
  if (!nm) return { ok: false, message: 'The product needs a name.' };
  const retail = priceRetail != null ? Math.round(Number(priceRetail) * 100) / 100 : null;
  const cost = priceCost != null ? Math.round(Number(priceCost) * 100) / 100 : null;
  try {
    // 1) Look for an existing product with the same name.
    let existing = null;
    try {
      const res = await apiRequest(base, token, '/products?query=' + encodeURIComponent(nm) + '&per_page=100');
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: `Token rejected (HTTP ${res.status}) — the API token needs Products permission.` };
      }
      if (res.status === 200) {
        let j = {};
        try { j = await res.json(); } catch { /* ignore */ }
        const list = (j && (j.products || j.data)) || [];
        existing = list.find((p) => String(p.name || '').trim().toLowerCase() === nm.toLowerCase()) || null;
      }
    } catch { /* unreachable search -> fall through and attempt create */ }

    // 2) Update the price if it differs.
    if (existing) {
      const curRetail = Number(existing.price_retail);
      const curCost = Number(existing.price_cost);
      const needRetail = retail != null && Math.abs((curRetail || 0) - retail) >= 0.005;
      const needCost = cost != null && Math.abs((curCost || 0) - cost) >= 0.005;
      if (!needRetail && !needCost) {
        return { ok: true, action: 'unchanged', productId: existing.id, message: `“${nm}” already in Syncro at ${gbp(curRetail)} — no change needed.` };
      }
      const body = {};
      if (needRetail) body.price_retail = retail;
      if (needCost) body.price_cost = cost;
      const up = await apiRequest(base, token, '/products/' + existing.id, { method: 'PUT', body });
      if (up.status >= 200 && up.status < 300) {
        return { ok: true, action: 'updated', productId: existing.id, message: `Updated “${nm}”${needRetail ? ` — price now ${gbp(retail)}` : ''}${needCost ? ` (cost ${gbp(cost)})` : ''}.` };
      }
      const d = await readError(up);
      return { ok: false, message: `Couldn’t update the product (HTTP ${up.status}).${d ? ' ' + d : ''}` };
    }

    // 3) Create a new product.
    const body = { name: nm };
    if (retail != null) body.price_retail = retail;
    if (cost != null) body.price_cost = cost;
    if (description) body.description = description;
    const res = await apiRequest(base, token, '/products', { method: 'POST', body });
    if (res.status >= 200 && res.status < 300) {
      let id = null;
      try { const j = await res.json(); id = (j && j.product && j.product.id) || (j && j.id) || null; } catch { /* ignore */ }
      return { ok: true, action: 'created', productId: id, message: `Created “${nm}” at ${gbp(retail)}.` };
    }
    const d = await readError(res);
    if (res.status === 401 || res.status === 403) return { ok: false, message: `Syncro rejected it (HTTP ${res.status}).${d ? ' ' + d : ' The token needs permission to create products.'}` };
    return { ok: false, message: `Syncro returned HTTP ${res.status}.${d ? ' ' + d : ''}` };
  } catch (e) {
    return { ok: false, message: 'Could not reach Syncro: ' + e.message };
  }
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

module.exports = { testConnection, lookupTicket, listActiveTickets, getCustomer, postComment, listAssetTypes, createAsset, upsertProduct, addTicketLineItem, buildFindingsComment, normalizeBase };
