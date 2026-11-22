'use strict';

// In-app supplier search for the Parts tab. Runs in the MAIN process (no CORS),
// on the technician's own connection. Shopify stores (e.g. AJ Parts) expose a
// clean JSON search; eBay is a best-effort HTML read; sites that block automated
// reads fall back to an "open on site" link in the renderer.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

async function getText(url, { timeoutMs = 12000, accept } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-GB,en;q=0.9', Accept: accept || 'text/html,application/json;q=0.9,*/*;q=0.8' },
      redirect: 'follow', signal: ac.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally { clearTimeout(t); }
}

function toNum(v) { const n = Number(String(v).replace(/[^0-9.]/g, '')); return isFinite(n) && n > 0 ? n : null; }
function gbp(n) { return '£' + Number(n).toFixed(2); }
function decode(s) { return String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim(); }

// ---- Shopify stores (/search/suggest.json) ----
async function shopify(base, name, query, limit = 12) {
  const root = base.replace(/\/+$/, '');
  const u = root + '/search/suggest.json?q=' + encodeURIComponent(query) + '&resources[type]=product&resources[limit]=' + limit + '&resources[options][unavailable_products]=last';
  const r = await getText(u, { accept: 'application/json' });
  if (!r.ok) return { ok: false, status: r.status };
  let j; try { j = JSON.parse(r.text); } catch { return { ok: false, status: r.status }; }
  const ps = (((j.resources || {}).results || {}).products) || [];
  const items = ps.map((p) => {
    const price = toNum(p.price);
    return {
      supplier: name, title: decode(p.title), priceNum: price, price: price != null ? gbp(price) : '—',
      url: p.url ? (p.url.startsWith('http') ? p.url : root + p.url) : root,
      inStock: p.available !== false, stock: p.available === false ? 'Out of stock' : 'In stock',
      image: p.image || '',
    };
  }).filter((x) => x.title);
  return { ok: true, items };
}

// ---- eBay Browse API (reliable; needs the tech's eBay developer keys) ----
let _ebayTok = { token: '', exp: 0 };
async function ebayToken(appId, certId) {
  if (_ebayTok.token && Date.now() < _ebayTok.exp - 60000) return _ebayTok.token;
  const basic = Buffer.from(appId + ':' + certId).toString('base64');
  const body = 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope');
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 12000);
  try {
    const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
      method: 'POST', headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: ac.signal,
    });
    let j = {}; try { j = await res.json(); } catch { /* ignore */ }
    if (!res.ok || !j.access_token) throw new Error((j && (j.error_description || j.error)) || ('token HTTP ' + res.status));
    _ebayTok = { token: j.access_token, exp: Date.now() + ((j.expires_in || 7200) * 1000) };
    return _ebayTok.token;
  } finally { clearTimeout(t); }
}
async function ebayBrowse(name, query, creds, limit = 15) {
  const token = await ebayToken(creds.appId, creds.certId);
  const u = 'https://api.ebay.com/buy/browse/v1/item_summary/search?q=' + encodeURIComponent(query) + '&limit=' + limit + '&sort=price&filter=' + encodeURIComponent('deliveryCountry:GB');
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 12000);
  let res;
  try { res = await fetch(u, { headers: { Authorization: 'Bearer ' + token, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB', Accept: 'application/json' }, signal: ac.signal }); }
  finally { clearTimeout(t); }
  if (!res.ok) return { ok: false, status: res.status };
  let j = {}; try { j = await res.json(); } catch { /* ignore */ }
  const sums = j.itemSummaries || [];
  const items = sums.map((s) => {
    const pr = s.price && toNum(s.price.value);
    return { supplier: name, title: decode(s.title), priceNum: pr, price: pr != null ? gbp(pr) : '—', url: s.itemWebUrl || 'https://www.ebay.co.uk', inStock: true, stock: s.condition || 'eBay', image: (s.image && s.image.imageUrl) || '' };
  }).filter((x) => x.title);
  return { ok: true, items };
}
async function testEbay(creds) {
  try { await ebayToken(creds.appId, creds.certId); return { ok: true, message: 'eBay keys verified — live prices are on.' }; }
  catch (e) { return { ok: false, message: 'eBay rejected the keys: ' + ((e && e.message) || 'failed') + '. Check the App ID and Cert ID (Production keys).' }; }
}

// ---- eBay UK (best-effort HTML; works best on a residential connection) ----
async function ebay(name, query, limit = 14) {
  const u = 'https://www.ebay.co.uk/sch/i.html?_nkw=' + encodeURIComponent(query) + '&_sop=15'; // lowest price + postage
  const r = await getText(u);
  if (!r.ok) return { ok: false, status: r.status };
  const items = [];
  const segs = r.text.split('s-item__info');
  for (const seg of segs.slice(1)) {
    const tm = seg.match(/s-item__title[^>]*>(?:\s*<[^>]+>)*\s*([^<][\s\S]*?)<\/(?:span|div|h3)/i);
    const pm = seg.match(/s-item__price[^>]*>\s*(?:<[^>]+>)*\s*£\s*([\d,]+\.\d{2})/i);
    const lm = seg.match(/href="(https:\/\/www\.ebay\.co\.uk\/itm\/[^"?]+)/i);
    const title = tm ? decode(tm[1].replace(/<[^>]+>/g, '')) : '';
    if (title && pm && !/shop on ebay|new listing$/i.test(title)) {
      items.push({ supplier: name, title: title.slice(0, 140), priceNum: toNum(pm[1]), price: '£' + pm[1], url: lm ? lm[1] : u, inStock: true, stock: 'eBay listing', image: '' });
    }
    if (items.length >= limit) break;
  }
  if (!items.length) return { ok: false, status: r.status };
  return { ok: true, items };
}

// Per-supplier dispatch. `sup` = { id, name, live, base }.
async function searchOne(sup, query, opts) {
  try {
    if (sup.live === 'shopify' && sup.base) return await shopify(sup.base, sup.name, query);
    if (sup.live === 'ebay') {
      const c = opts && opts.ebay;
      if (c && c.appId && c.certId) { try { return await ebayBrowse(sup.name, query, c); } catch (e) { /* fall through to HTML */ } }
      return await ebay(sup.name, query);
    }
    return { ok: false, status: 0, unsupported: true };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'fetch failed' };
  }
}

// Run every supplier × every term in parallel; aggregate, dedupe, sort by price.
// `queries` may be one string or several (e.g. the compatible panel part numbers).
async function searchAll(suppliers, queries, opts) {
  const terms = (Array.isArray(queries) ? queries : [queries]).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 4);
  if (!terms.length) return { ok: false, items: [], perSupplier: [], message: 'No search term.' };
  const live = (suppliers || []).filter((s) => s.live === 'shopify' || s.live === 'ebay');
  const jobs = [];
  live.forEach((s) => terms.forEach((term) => jobs.push({ s, term })));
  const settled = await Promise.allSettled(jobs.map((j) => searchOne(j.s, j.term, opts || {})));
  const items = []; const perMap = {};
  settled.forEach((res, i) => {
    const { s, term } = jobs[i];
    if (!perMap[s.id]) perMap[s.id] = { id: s.id, name: s.name, status: 'blocked', count: 0 };
    if (res.status === 'fulfilled' && res.value && res.value.ok) {
      perMap[s.id].status = 'ok';
      res.value.items.forEach((it) => { it.supplierId = s.id; it.term = term; items.push(it); });
      perMap[s.id].count += res.value.items.length;
    } else if (res.value && res.value.unsupported && perMap[s.id].status !== 'ok') {
      perMap[s.id].status = 'open';
    }
  });
  const seen = new Set(); const dedup = [];
  for (const it of items) { const k = it.url || (it.supplier + it.title); if (seen.has(k)) continue; seen.add(k); dedup.push(it); }
  dedup.sort((a, b) => (a.inStock === b.inStock ? 0 : a.inStock ? -1 : 1) || ((a.priceNum || 1e9) - (b.priceNum || 1e9)));
  return { ok: true, items: dedup, perSupplier: Object.values(perMap), terms };
}

module.exports = { searchAll, testEbay };
