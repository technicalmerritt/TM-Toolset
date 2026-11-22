'use strict';

// Parts & Quotes tab: iPhone / iPad screen + battery and laptop-screen finder
// with instant customer quotes. Trade prices and supplier links are editable and
// saved to the portable tools.json (travel on the stick). Each part can be copied,
// quoted onto the active Syncro ticket as a note, or added to it as a billable
// line item (which also keeps the matching catalogue product in sync).
(function () {
  const D = window.TM_PARTS || {};
  const els = {};
  let store = { settings: { shopFee: 35, markupValue: 15, markupType: 'amount', includeVat: true }, prices: {}, urls: {}, laptopCost: {}, laptopSuppliers: {} };
  let sub = 'phone', tier = 'preferred', lq = '', lkind = 'screen', ptype = 'screen';
  function ptDef() { return (D.partTypes || []).find((t) => t.id === ptype) || { id: ptype, label: ptype, short: 'Part', search: ptype, gotchas: '' }; }
  function isDb() { return ptype === 'screen' || ptype === 'battery'; }
  function setPtype(v) { ptype = v; lkind = (v === 'screen') ? 'screen' : 'battery'; }
  let partsDb = { entries: {} };
  function pinnedFor(rm) { if (!rm) return []; const e = partsDb.entries[rm.id + '|' + ptype]; return (e && e.numbers) ? e.numbers : []; }
  let detect = null; // last "this PC" detection, for the banner
  let liveResults = null; // { query, loading, items, perSupplier } for in-app price compare
  const EDID_MAKERS = { AUO: 'AU Optronics', BOE: 'BOE', LGD: 'LG Display', SHP: 'Sharp', CMN: 'Innolux', CMO: 'Innolux', INL: 'Innolux', SDC: 'Samsung', SEC: 'Samsung', SAM: 'Samsung', IVO: 'InfoVision', PnP: '', APP: 'Apple', LEN: 'Lenovo' };
  let phoneModel = '14pm';
  let ipadModel = (D.ipads && D.ipads[0] ? D.ipads[0].id : '');
  let loaded = false;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function money(n) { return '£' + (Number(n) || 0).toFixed(2); }
  function toast(m) { const t = $('#toast'); if (!t) return; t.textContent = m; t.classList.add('toast--show'); setTimeout(() => t.classList.remove('toast--show'), 2800); }
  function persist(patch) { if (window.parts && window.parts.save) window.parts.save(patch).catch(() => {}); }
  function openUrl(u) { if (window.sys && window.sys.openUrl) window.sys.openUrl(u); }
  function copyText(txt, msg) { try { navigator.clipboard.writeText(txt).then(() => toast(msg || 'Copied.')).catch(() => {}); } catch (e) { /* ignore */ } }

  // ---- device helpers (iPhone + iPad share one engine) ----
  function deviceById(id) { return (D.iphones || []).find((x) => x.id === id) || (D.ipads || []).find((x) => x.id === id); }
  function isIpad(id) { return !!(D.ipads || []).find((x) => x.id === id); }
  function baseScreen(i) { return 42 + ((D.iphones.length - 1 - (i < 0 ? 8 : i)) * 5); }
  function baseBattery(i) { return 16 + ((D.iphones.length - 1 - (i < 0 ? 8 : i)) * 1.5); }
  function screenBaseOf(id) { const ip = (D.ipads || []).find((x) => x.id === id); if (ip) return ip.screenBase; return baseScreen((D.iphones || []).findIndex((x) => x.id === id)); }
  function batteryBaseOf(id) { const ip = (D.ipads || []).find((x) => x.id === id); if (ip) return ip.batteryBase; return baseBattery((D.iphones || []).findIndex((x) => x.id === id)); }
  function screenSuppliersAll(id) { return isIpad(id) ? (D.ipadScreenSuppliers || []) : (D.screenSuppliers || []); }
  function batterySuppliersAll(id) { return isIpad(id) ? (D.ipadBatterySuppliers || []) : (D.batterySuppliers || []); }

  // ---- pricing maths ----
  function basePrice(trade) { // customer price EXCLUDING VAT (part + fee + markup)
    const s = store.settings;
    let v = (Number(trade) || 0) + (Number(s.shopFee) || 0);
    if (s.markupType === 'amount') v += (Number(s.markupValue) || 0);
    else v += v * ((Number(s.markupValue) || 0) / 100);
    return v;
  }
  function quote(trade) { let v = basePrice(trade); if (store.settings.includeVat) v *= 1.2; return v; }
  function sTrade(id, sup) { const k = 's:' + id + '_' + sup.supplier; return store.prices[k] != null ? Number(store.prices[k]) : Math.max(12, screenBaseOf(id) + sup.off); }
  function bTrade(id, sup) { const k = 'b:' + id + '_' + sup.supplier; return store.prices[k] != null ? Number(store.prices[k]) : Math.max(8, batteryBaseOf(id) + sup.off); }
  function isCustom(prefix, id, supplier) { return store.prices[prefix + ':' + id + '_' + supplier] != null; }

  function cardSearchTerm(kind, dev, sup) {
    if (kind === 's') { const t = sup && sup.type ? (' ' + sup.type) : ''; return (dev.name || '') + t + ' screen'; }
    return (dev.name || '') + ' battery';
  }
  function buyUrl(kind, dev, sup, term) {
    const u = store.urls[kind + 'u:' + dev.id + '_' + sup.supplier];
    if (u) return u;
    const b = D.searchUrl[sup.supplier];
    return b ? b(term) : 'https://www.google.co.uk/search?q=' + encodeURIComponent(sup.supplier + ' ' + term);
  }

  // ---- inline edits ----
  function editPrice(kind, id, sup, curr, redraw) {
    const v = window.prompt('Trade price (£) for ' + sup.supplier + ' — ' + (kind === 's' ? 'screen' : 'battery') + '.\nLeave blank to reset to the estimate.', curr.toFixed(2));
    if (v === null) return;
    const k = kind + ':' + id + '_' + sup.supplier;
    if (!v.trim()) delete store.prices[k]; else store.prices[k] = parseFloat(v) || 0;
    persist({ prices: store.prices }); redraw();
  }
  function editUrl(kind, id, supplier, curr, redraw) {
    const v = window.prompt('Direct product link for ' + supplier + '.\nLeave blank to reset to a catalogue search.', curr);
    if (v === null) return;
    const k = kind + 'u:' + id + '_' + supplier;
    if (!v.trim()) delete store.urls[k]; else store.urls[k] = v.trim();
    persist({ urls: store.urls }); redraw();
  }

  // ---- Syncro: add a part to the active ticket (billable line item + product sync) ----
  async function addPartToTicket(dev, partLabel, sup, trade) {
    const t = window.activeTicket && window.activeTicket.get();
    if (!t || !t.id) { toast('Set a ticket in the top bar first.'); return; }
    if (!(window.syncro && window.syncro.addTicketPart)) { toast('Update the app to use this.'); return; }
    const name = (dev.name || 'Device') + ' — ' + partLabel;
    const exVat = Math.round(basePrice(trade) * 100) / 100;
    const desc = partLabel + ' — ' + (sup.supplier || '') + (sup.product ? (' ' + sup.product) : '') + ' (fitting included)';
    toast('Adding to ticket…');
    try {
      const r = await window.syncro.addTicketPart({ ticketId: t.id, name, description: desc, price: exVat, cost: Math.round(Number(trade) * 100) / 100, taxable: !!store.settings.includeVat });
      if (r && r.ok) {
        const act = r.productAction === 'created' ? ' · product created' : r.productAction === 'updated' ? ' · product price updated' : '';
        toast('Added to ticket #' + t.number + ' — ' + money(quote(trade)) + act);
      } else toast('Syncro: ' + ((r && r.message) || 'failed'));
    } catch (e) { toast('Syncro error.'); }
  }

  // ---- pricing settings bar ----
  function renderPricing() {
    const s = store.settings;
    els.pricing.innerHTML = '';
    function field(label, node) { const w = el('label', 'parts-field'); w.appendChild(el('span', null, label)); w.appendChild(node); return w; }
    const fee = el('input'); fee.type = 'number'; fee.step = '0.50'; fee.value = s.shopFee; fee.className = 'parts-input';
    fee.addEventListener('change', () => { s.shopFee = parseFloat(fee.value) || 0; persist({ settings: { shopFee: s.shopFee } }); renderBody(); });
    const mv = el('input'); mv.type = 'number'; mv.step = '0.50'; mv.value = s.markupValue; mv.className = 'parts-input';
    mv.addEventListener('change', () => { s.markupValue = parseFloat(mv.value) || 0; persist({ settings: { markupValue: s.markupValue } }); renderBody(); });
    const mt = el('select'); mt.className = 'parts-input';
    [['amount', '£ fixed'], ['percent', '% of cost']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; if (s.markupType === v) o.selected = true; mt.appendChild(o); });
    mt.addEventListener('change', () => { s.markupType = mt.value; persist({ settings: { markupType: s.markupType } }); renderPricing(); renderBody(); });
    const vat = el('input'); vat.type = 'checkbox'; vat.checked = s.includeVat !== false;
    const vatLabel = el('label', 'parts-field parts-field--check'); vatLabel.appendChild(vat); vatLabel.appendChild(el('span', null, 'Add 20% VAT'));
    vat.addEventListener('change', () => { s.includeVat = vat.checked; persist({ settings: { includeVat: s.includeVat } }); renderBody(); });

    els.pricing.appendChild(field('Shop / fitting fee (£)', fee));
    els.pricing.appendChild(field('Markup', mv));
    els.pricing.appendChild(field('Markup type', mt));
    els.pricing.appendChild(vatLabel);
    els.pricing.appendChild(el('span', 'muted parts-pricing__hint', 'Customer price = part + fee + markup' + (s.includeVat ? ' + VAT' : '') + '. Saved on the stick. Syncro gets the ex-VAT price and adds tax itself.'));
  }

  function gotchaBox(title, text) {
    const b = el('div', 'parts-gotcha');
    b.appendChild(el('span', 'parts-gotcha__ico', '⚠'));
    const t = el('div'); t.appendChild(el('strong', null, title)); t.appendChild(el('p', 'muted', text));
    b.appendChild(t); return b;
  }
  function gotchaInline(text) { const d = el('div', 'parts-gotcha parts-gotcha--sm'); d.appendChild(el('span', 'parts-gotcha__ico', '⚠')); d.appendChild(el('p', 'muted', text)); return d; }
  function closeBar(pct) { const w = el('div', 'parts-bar'); const f = el('div', 'parts-bar__fill'); f.style.width = Math.max(0, Math.min(100, pct)) + '%'; w.appendChild(f); return w; }

  // ---- one supplier card (screen or battery, iPhone or iPad) ----
  function partCard(kind, dev, sup, redraw) {
    const id = dev.id;
    const trade = kind === 's' ? sTrade(id, sup) : bTrade(id, sup);
    const custom = isCustom(kind, id, sup.supplier);
    const term = cardSearchTerm(kind, dev, sup);
    const card = el('div', 'parts-card' + (sup.preferred ? ' parts-card--pref' : ''));
    const head = el('div', 'parts-card__head');
    const tags = el('div', 'parts-card__tags');
    tags.appendChild(el('span', 'parts-tag', sup.supplier));
    if (sup.preferred) tags.appendChild(el('span', 'parts-tag parts-tag--pref', '★ Preferred'));
    head.appendChild(tags);
    card.appendChild(head);
    card.appendChild(el('h4', 'parts-card__name', sup.product));
    const kv = el('div', 'parts-card__kv');
    function row(k, v, cls) { kv.appendChild(el('span', 'parts-card__k', k)); kv.appendChild(el('span', 'parts-card__v' + (cls ? ' ' + cls : ''), v)); }
    if (kind === 's') { row('Panel', sup.type || dev.panel); row('Closeness', sup.closeness + '%', 'good'); }
    else { row('Capacity', sup.capacity); row('Health', sup.health); }
    row('Warranty', sup.warranty);
    card.appendChild(kv);
    if (kind === 's') card.appendChild(closeBar(sup.closeness));

    // copyable precise search term (the "SKU" to paste into the supplier site)
    const skuRow = el('div', 'parts-sku');
    skuRow.appendChild(el('span', 'parts-sku__ico', '🔎'));
    skuRow.appendChild(el('code', 'parts-sku__term', term));
    const cp = el('button', 'btn btn--ghost btn--sm', 'Copy');
    cp.addEventListener('click', (e) => { e.preventDefault(); copyText(term, 'Search term copied.'); });
    skuRow.appendChild(cp);
    card.appendChild(skuRow);

    // trade + quote + buy
    const foot = el('div', 'parts-card__foot');
    const left = el('div');
    const tradeLine = el('div', 'parts-card__trade');
    tradeLine.appendChild(el('span', 'muted', 'Trade: '));
    tradeLine.appendChild(el('strong', custom ? 'parts-custom' : null, money(trade)));
    const editP = el('button', 'btn btn--ghost btn--sm', custom ? 'Edit ✓' : 'Edit');
    editP.addEventListener('click', (e) => { e.preventDefault(); editPrice(kind, id, sup, trade, redraw); });
    tradeLine.appendChild(editP);
    left.appendChild(tradeLine);
    left.appendChild(el('div', 'parts-card__quote', 'Customer: ' + money(quote(trade))));
    foot.appendChild(left);
    const buy = el('button', 'btn btn--primary btn--sm', 'Buy part');
    buy.addEventListener('click', (e) => { e.preventDefault(); openUrl(buyUrl(kind, dev, sup, term)); });
    const editU = el('button', 'btn btn--ghost btn--sm', (store.urls[kind + 'u:' + id + '_' + sup.supplier] ? 'Link ✓' : 'Link'));
    editU.addEventListener('click', (e) => { e.preventDefault(); editUrl(kind, id, sup.supplier, buyUrl(kind, dev, sup, term), redraw); });
    const bwrap = el('div', 'parts-card__buy'); bwrap.appendChild(editU); bwrap.appendChild(buy);
    foot.appendChild(bwrap);
    card.appendChild(foot);

    // add to Syncro ticket as a billable line item
    const act = el('div', 'parts-card__act');
    const ticketBtn = el('button', 'btn btn--ghost btn--sm parts-ticketbtn', '＋ Add to ticket');
    ticketBtn.addEventListener('click', (e) => { e.preventDefault(); addPartToTicket(dev, kind === 's' ? 'Screen replacement' : 'Battery replacement', sup, trade); });
    act.appendChild(ticketBtn);
    card.appendChild(act);
    return card;
  }

  // ---- header quote (device-aware) ----
  function quoteParts(id) { const sl = screenSuppliersAll(id); const scr = sl.filter((s) => s.preferred)[0] || sl[0]; const bat = batterySuppliersAll(id)[0]; return { scr, bat }; }
  function quoteHtml(id) {
    const d = deviceById(id) || {}; const { scr, bat } = quoteParts(id);
    const vat = store.settings.includeVat ? 'inc. VAT' : 'ex. VAT';
    return '<p><strong>' + (d.name || 'Device') + ' repair quote</strong> (fitting included, ' + vat + ')</p><ul>' +
      (scr ? '<li>Screen replacement: <strong>' + money(quote(sTrade(id, scr))) + '</strong></li>' : '') +
      (bat ? '<li>Battery replacement: <strong>' + money(quote(bTrade(id, bat))) + '</strong></li>' : '') +
      '</ul><p><em>Prepared with TM Toolset &middot; ' + new Date().toLocaleDateString('en-GB') + '</em></p>';
  }
  function quoteText(id) {
    const d = deviceById(id) || {}; const { scr, bat } = quoteParts(id);
    const vat = store.settings.includeVat ? 'inc. VAT' : 'ex. VAT';
    return (d.name || 'Device') + ' repair quote (fitting included, ' + vat + '):\n' +
      (scr ? '- Screen replacement: ' + money(quote(sTrade(id, scr))) + '\n' : '') +
      (bat ? '- Battery replacement: ' + money(quote(bTrade(id, bat))) : '');
  }

  // ---- iPhone / iPad view (shared) ----
  function curModel() { return sub === 'ipad' ? ipadModel : phoneModel; }
  function setModel(v) { if (sub === 'ipad') ipadModel = v; else phoneModel = v; }

  function renderMobile() {
    const list = sub === 'ipad' ? (D.ipads || []) : (D.iphones || []);
    let dev = deviceById(curModel()); if (!dev) { dev = list[0]; setModel(dev.id); }
    const id = dev.id;
    const wrap = el('div', 'parts-view');

    const hc = el('div', 'info-card parts-head');
    const msel = el('select', 'parts-input parts-model');
    list.forEach((x) => { const o = el('option', null, x.name + ' (' + x.a + ')'); o.value = x.id; if (x.id === id) o.selected = true; msel.appendChild(o); });
    msel.addEventListener('change', () => { setModel(msel.value); renderBody(); });
    const col1 = el('div', 'parts-head__col');
    col1.appendChild(el('label', 'parts-lbl', (sub === 'ipad' ? 'iPad' : 'iPhone') + ' model'));
    col1.appendChild(msel);
    col1.appendChild(el('p', 'muted parts-note', 'Display: ' + dev.panel));
    hc.appendChild(col1);

    const { scr, bat } = quoteParts(id);
    const priceBox = (label, val) => { const b = el('div', 'parts-price'); b.appendChild(el('div', 'parts-price__lbl', label)); b.appendChild(el('div', 'parts-price__val', money(val))); return b; };
    const col2 = el('div', 'parts-head__col parts-head__prices');
    col2.appendChild(priceBox('Screen (customer)', scr ? quote(sTrade(id, scr)) : 0));
    col2.appendChild(priceBox('Battery (customer)', bat ? quote(bTrade(id, bat)) : 0));
    hc.appendChild(col2);

    const col3 = el('div', 'parts-head__col parts-head__actions');
    const copyBtn = el('button', 'btn btn--ghost', 'Copy quote');
    copyBtn.addEventListener('click', () => copyText(quoteText(id), 'Quote copied.'));
    const tkBtn = el('button', 'btn btn--primary', 'Quote → ticket note');
    tkBtn.addEventListener('click', async () => {
      const t = window.activeTicket && window.activeTicket.get();
      if (!t || !t.id) { toast('Set a ticket in the top bar first.'); return; }
      try {
        const r = await window.syncro.postNote({ ticketId: t.id, subject: 'Repair quote', body: quoteHtml(id), hidden: true });
        toast(r && r.ok ? ('Quote note added to ticket #' + t.number + '.') : ('Syncro: ' + ((r && r.message) || 'failed')));
      } catch (e) { toast('Syncro error.'); }
    });
    col3.appendChild(copyBtn); col3.appendChild(tkBtn);
    hc.appendChild(col3);
    wrap.appendChild(hc);

    // screens
    wrap.appendChild(gotchaBox('Screen bench notes — ' + dev.name + ' (' + dev.a + ')', dev.screenGotchas));
    const stoolbar = el('div', 'parts-toolbar');
    stoolbar.appendChild(el('h3', 'parts-h3', 'Screen suppliers'));
    const seg = el('div', 'parts-seg');
    const bt1 = el('button', 'btn btn--sm' + (tier === 'preferred' ? ' btn--primary' : ' btn--ghost'), '★ Preferred');
    bt1.addEventListener('click', () => { tier = 'preferred'; renderBody(); });
    const bt2 = el('button', 'btn btn--sm' + (tier === 'all' ? ' btn--primary' : ' btn--ghost'), 'All ' + screenSuppliersAll(id).length + ' tiers');
    bt2.addEventListener('click', () => { tier = 'all'; renderBody(); });
    seg.appendChild(bt1); seg.appendChild(bt2); stoolbar.appendChild(seg);
    wrap.appendChild(stoolbar);
    const sgrid = el('div', 'parts-grid');
    screenSuppliersAll(id).filter((s) => (tier === 'preferred' ? s.preferred : true)).forEach((sup) => sgrid.appendChild(partCard('s', dev, sup, renderBody)));
    wrap.appendChild(sgrid);

    // batteries
    wrap.appendChild(gotchaBox('Battery bench notes — ' + dev.name, dev.batteryGotchas));
    wrap.appendChild(el('h3', 'parts-h3', 'Battery suppliers'));
    const bgrid = el('div', 'parts-grid');
    batterySuppliersAll(id).forEach((sup) => bgrid.appendChild(partCard('b', dev, sup, renderBody)));
    wrap.appendChild(bgrid);

    // competitor benchmark (iPhone only — we hold retail data for phones)
    if (sub === 'phone' && (D.competitors || []).length) {
      const comp = el('div', 'info-card');
      comp.appendChild(el('h3', 'parts-h3', 'Local competitor screen prices — ' + dev.name));
      const cgrid = el('div', 'parts-comp');
      (D.competitors || []).forEach((c) => {
        const cc = el('div', 'parts-comp__cell');
        cc.appendChild(el('div', 'parts-comp__name', c.name));
        cc.appendChild(el('div', 'parts-comp__loc', c.loc));
        cc.appendChild(el('div', 'parts-comp__price', '£' + (c.prices[id] || '—')));
        cgrid.appendChild(cc);
      });
      comp.appendChild(cgrid);
      wrap.appendChild(comp);
    }

    els.body.innerHTML = ''; els.body.appendChild(wrap);
  }

  // ---- laptop finder ----
  function supEnabled(id) { return store.laptopSuppliers[id] !== false; } // all on unless explicitly off
  function enabledSuppliers(kind) { return (D.laptopSuppliers || []).filter((s) => (s.kinds === 'both' || s.kinds === kind) && supEnabled(s.id)); }
  function lScreenCost(lp) { const k = 's:' + lp.id; return store.laptopCost[k] != null ? Number(store.laptopCost[k]) : (lp.screen ? lp.screen.cost : 0); }
  function lBattCost(lp) { const k = 'b:' + lp.id; return store.laptopCost[k] != null ? Number(store.laptopCost[k]) : (lp.battery ? lp.battery.cost : 0); }
  // Pull the clean part-number token out of an annotated string.
  function partTerm(pn) { const m = String(pn).match(/[A-Z0-9]{2,}(?:[-.][A-Z0-9]+)+|[A-Z]{1,3}\d[A-Z0-9]{2,}(?:\.\d+)?|[A-Z0-9]{5,}/); return m ? m[0] : String(pn).replace(/\s*[([=].*$/, '').trim(); }
  function looksAmbiguous(code) { return /[B8O0I1S5Z2G6]/.test(code) && /[A-Z]/.test(code) && /\d/.test(code); }
  function isPartNumber(q) { const s = String(q || '').trim(); return !/\s/.test(s) && /\d/.test(s) && /[A-Za-z]/.test(s) && s.length >= 5; }
  // Token-match a free model string (e.g. "Lenovo ThinkPad T14 Gen 3") to a curated entry.
  function resolveModel(query) {
    const ql = String(query || '').toLowerCase();
    const toks = ql.split(/[^a-z0-9]+/).filter((t) => t.length > 1);
    if (!toks.length) return null;
    let best = null, bestScore = 0;
    (D.laptops || []).forEach((lp) => {
      const hay = (lp.brand + ' ' + lp.model + ' ' + (lp.aliases || '')).toLowerCase();
      let score = 0; toks.forEach((t) => { if (hay.includes(t)) score += 1; });
      if (score > bestScore) { bestScore = score; best = lp; }
    });
    return (best && bestScore >= Math.min(2, toks.length)) ? best : null;
  }
  // Turn whatever the tech searched into the best supplier query terms: a bare part
  // number as-is; a known model → its compatible panel/battery numbers; otherwise
  // the model with a category keyword so suppliers don't return chargers/keyboards.
  function liveTermsFor(query) {
    const q = String(query || '').trim();
    // Screen / battery: resolve a model to its exact part numbers.
    if (isDb()) {
      if (isPartNumber(q)) return { terms: [q], resolved: null };
      const lp = resolveModel(q);
      if (lp && lp[lkind]) {
        const pns = (lkind === 'screen' ? lp[lkind].panels : lp[lkind].parts) || [];
        const terms = pns.map(partTerm).filter((t) => t && !/\s/.test(t)).slice(0, 3);
        if (terms.length) return { terms, resolved: lp };
      }
      return { terms: [q + (lkind === 'screen' ? ' laptop screen' : ' laptop battery')], resolved: lp || null };
    }
    // Other part types: if you've pinned exact numbers for this model+part, use
    // them; otherwise search the model + the part keyword (so suppliers return
    // the right category, not accessories).
    const lp = resolveModel(q);
    const pinned = lp ? pinnedFor(lp).map((n) => n.pn) : [];
    if (pinned.length) return { terms: pinned.slice(0, 4), resolved: lp, pinned: true };
    const base = (lp ? (lp.brand + ' ' + lp.model) : q);
    const kw = ptDef().search;
    const term = (kw ? (base + ' ' + kw) : base).trim();
    return { terms: [term], resolved: lp || null };
  }

  // Pull candidate part numbers out of the live result titles, for pinning.
  function harvestCandidates(items, rm) {
    const stop = new Set(['FHD', 'HD', 'LED', 'LCD', 'IPS', 'OLED', 'USB', 'SSD', 'NVME', 'DDR4', 'DDR5', 'INCH', 'NEW', 'OEM', 'REPLACEMENT', 'LAPTOP', 'SCREEN', 'BATTERY', 'KEYBOARD', 'CHARGING', 'CHARGER', 'ADAPTER', 'GENUINE', 'ORIGINAL', 'BLACK', 'SILVER']);
    const modelToks = new Set((((rm ? rm.brand + ' ' + rm.model + ' ' + (rm.aliases || '') : '')).toUpperCase().match(/[A-Z0-9]+/g) || []));
    const pinnedSet = new Set((rm ? pinnedFor(rm) : []).map((n) => String(n.pn).toUpperCase()));
    const freq = {};
    (items || []).forEach((it) => {
      const toks = (it.title || '').toUpperCase().match(/\b[0-9A-Z][0-9A-Z.\-]{4,}\b/g) || [];
      toks.forEach((raw) => {
        const c = raw.replace(/[.\-]+$/, '');
        if (c.length < 5 || c.length > 22) return;
        if (!/[0-9]/.test(c) || !/[A-Z]/.test(c)) return;
        if (stop.has(c) || modelToks.has(c) || pinnedSet.has(c)) return;
        // Skip connector/spec noise (5-PIN, 5.5MM, 3.25A, 65W, 20V, 1920X1080…)
        if (/PIN$/i.test(c) || /^\d+(\.\d+)?(MM|CM|A|V|W|WH|HZ|GHZ|GB|TB)$/i.test(c) || /^\d+X\d+$/i.test(c)) return;
        freq[c] = (freq[c] || 0) + 1;
      });
    });
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([pn, n]) => ({ pn, n }));
  }
  async function pinNumber(rm, pn, note) {
    if (!(window.partsdb && window.partsdb.pin)) { toast('Update the app to use this.'); return; }
    try {
      const r = await window.partsdb.pin({ modelId: rm.id, model: rm.brand + ' ' + rm.model, part: ptype, pn, note: note || '' });
      if (r && r.db) partsDb = r.db;
      toast(r && r.pushed ? ('Pinned & synced “' + pn + '”.') : r && r.pushMsg ? ('Pinned locally. Sync: ' + r.pushMsg) : ('Pinned “' + pn + '” (set a GitHub token to sync).'));
      if (els.lresults) drawLaptopResults(els.lresults);
    } catch (e) { toast('Pin failed.'); }
  }
  async function unpinNumber(rm, pn) {
    try { const r = await window.partsdb.remove({ modelId: rm.id, model: rm.brand + ' ' + rm.model, part: ptype, pn }); if (r && r.db) partsDb = r.db; if (els.lresults) drawLaptopResults(els.lresults); } catch (e) { /* ignore */ }
  }
  function pinBox(rm) {
    const box = el('div', 'parts-pinbox');
    box.appendChild(el('div', 'parts-pinbox__hd', '📌 Saved part numbers for ' + rm.brand + ' ' + rm.model + ' — ' + ptDef().short));
    const pinned = pinnedFor(rm);
    const prow = el('div', 'parts-chips');
    if (pinned.length) {
      pinned.forEach((n) => {
        const c = el('span', 'parts-pin');
        c.appendChild(el('code', null, n.pn));
        if (n.note) c.appendChild(el('span', 'parts-pin__note', n.note));
        const x = el('button', 'parts-pin__x', '×'); x.title = 'Remove'; x.addEventListener('click', () => unpinNumber(rm, n.pn));
        c.appendChild(x); prow.appendChild(c);
      });
    } else prow.appendChild(el('span', 'muted', 'None yet — pin one below and it becomes the search next time (and syncs to your other devices).'));
    box.appendChild(prow);
    // candidates spotted in the live listings
    const cands = harvestCandidates(liveResults.items, rm);
    if (cands.length) {
      box.appendChild(el('div', 'parts-pinbox__sub', 'Spotted in the listings — pin the right one:'));
      const crow = el('div', 'parts-chips');
      cands.forEach((c) => { const b = el('button', 'parts-chip', '+ ' + c.pn + (c.n > 1 ? ' ·' + c.n : '')); b.addEventListener('click', () => pinNumber(rm, c.pn)); crow.appendChild(b); });
      box.appendChild(crow);
    }
    // manual add
    const add = el('div', 'parts-pinadd');
    const inp = el('input', 'parts-input'); inp.type = 'text'; inp.placeholder = 'Add a part number by hand…';
    const btn = el('button', 'btn btn--ghost btn--sm', 'Pin'); btn.addEventListener('click', () => { const v = inp.value.trim(); if (v) { pinNumber(rm, v); inp.value = ''; } });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = inp.value.trim(); if (v) { pinNumber(rm, v); inp.value = ''; } } });
    add.appendChild(inp); add.appendChild(btn); box.appendChild(add);
    return box;
  }

  // Part number with letters vs digits colour-coded, so B/8 and O/0 can't be mixed up.
  function pnEl(pn) {
    const code = partTerm(pn); const rest = String(pn).replace(code, '').trim();
    const holder = el('span', 'parts-pn__wrap');
    const wrap = el('code', 'parts-pn__code');
    for (const ch of code) { wrap.appendChild(el('span', /[0-9]/.test(ch) ? 'pn-d' : /[A-Za-z]/.test(ch) ? 'pn-a' : 'pn-x', ch)); }
    holder.appendChild(wrap);
    if (rest) holder.appendChild(el('span', 'muted parts-pn__note', ' ' + rest));
    return holder;
  }

  function supplierChooser(redraw) {
    const panel = el('details', 'parts-suppliers');
    panel.appendChild(el('summary', null, '⚙ Suppliers to search (all on — untick any you don’t use)'));
    const grid = el('div', 'parts-suppliers__grid');
    (D.laptopSuppliers || []).forEach((s) => {
      const lab = el('label', 'parts-supchk');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = supEnabled(s.id);
      cb.addEventListener('change', () => { if (cb.checked) delete store.laptopSuppliers[s.id]; else store.laptopSuppliers[s.id] = false; persist({ laptopSuppliers: store.laptopSuppliers }); redraw(); });
      lab.appendChild(cb);
      const t = el('span', 'parts-supchk__t');
      t.appendChild(el('strong', null, s.name));
      t.appendChild(el('span', 'parts-supchk__k', s.kinds === 'both' ? 'screens + batteries' : s.kinds + 's only'));
      if (s.note) t.appendChild(el('span', 'muted parts-supchk__note', s.note));
      lab.appendChild(t); grid.appendChild(lab);
    });
    panel.appendChild(grid);

    // eBay developer keys (optional) for reliable live eBay prices
    const eb = el('div', 'parts-ebay');
    eb.appendChild(el('div', 'parts-ebay__hd', 'eBay live prices (optional): add free eBay developer keys for reliable in-app eBay results. Without them, eBay is a best-effort web read.'));
    const erow = el('div', 'parts-ebay__row');
    const status = el('span', 'muted parts-ebay__status', 'checking…');
    const setBtn = el('button', 'btn btn--ghost btn--sm', 'Set keys');
    const testBtn = el('button', 'btn btn--ghost btn--sm', 'Test');
    const helpBtn = el('button', 'btn btn--ghost btn--sm', 'Get keys ↗');
    erow.appendChild(status); erow.appendChild(setBtn); erow.appendChild(testBtn); erow.appendChild(helpBtn);
    eb.appendChild(erow); panel.appendChild(eb);
    if (window.ebay && window.ebay.get) window.ebay.get().then((s) => { status.textContent = (s && s.hasKeys) ? '✓ eBay keys saved — live eBay on' : 'Not set'; }).catch(() => { status.textContent = ''; });
    setBtn.addEventListener('click', async () => {
      const appId = window.prompt('eBay App ID (Client ID) — from your eBay developer account, Production keyset:');
      if (appId === null) return;
      const certId = window.prompt('eBay Cert ID (Client Secret) — Production keyset:');
      if (certId === null) return;
      try { const r = await window.ebay.save({ appId: appId.trim(), certId: certId.trim() }); status.textContent = (r && r.hasKeys) ? '✓ eBay keys saved — live eBay on' : 'Not set'; toast((r && r.hasKeys) ? 'eBay keys saved. Hit Test.' : 'Keys not saved.'); } catch (e) { toast('Save failed.'); }
    });
    testBtn.addEventListener('click', async () => { testBtn.disabled = true; testBtn.textContent = 'Testing…'; try { const r = await window.ebay.test(); toast((r && r.message) || (r && r.ok ? 'OK' : 'Failed')); } catch (e) { toast('Test failed.'); } testBtn.disabled = false; testBtn.textContent = 'Test'; });
    helpBtn.addEventListener('click', () => openUrl('https://developer.ebay.com/join'));

    // Shared part-number database (GitHub sync)
    const gh = el('div', 'parts-ebay');
    gh.appendChild(el('div', 'parts-ebay__hd', 'Part-number database sync (optional): add a GitHub token (Contents: read & write on your tm-toolset repo) so the part numbers you pin sync across all your devices. Without one, pins stay on this machine/stick.'));
    const grow = el('div', 'parts-ebay__row');
    const gstatus = el('span', 'muted parts-ebay__status', 'checking…');
    const gset = el('button', 'btn btn--ghost btn--sm', 'Set token');
    const gtest = el('button', 'btn btn--ghost btn--sm', 'Test');
    const gsync = el('button', 'btn btn--ghost btn--sm', 'Sync now');
    grow.appendChild(gstatus); grow.appendChild(gset); grow.appendChild(gtest); grow.appendChild(gsync);
    gh.appendChild(grow); panel.appendChild(gh);
    if (window.github && window.github.get) window.github.get().then((s) => { gstatus.textContent = (s && s.hasToken) ? '✓ Token saved — sync on' : 'Not set'; }).catch(() => { gstatus.textContent = ''; });
    gset.addEventListener('click', async () => {
      const t = window.prompt('GitHub fine-grained Personal Access Token (Contents: read & write on the tm-toolset repo):');
      if (t === null) return;
      try { const r = await window.github.save({ token: t.trim() }); gstatus.textContent = (r && r.hasToken) ? '✓ Token saved — sync on' : 'Not set'; toast((r && r.hasToken) ? 'Token saved. Hit Test.' : 'Token cleared.'); } catch (e) { toast('Save failed.'); }
    });
    gtest.addEventListener('click', async () => { gtest.disabled = true; gtest.textContent = 'Testing…'; try { const r = await window.partsdb.test(); toast((r && r.message) || 'Done.'); } catch (e) { toast('Test failed.'); } gtest.disabled = false; gtest.textContent = 'Test'; });
    gsync.addEventListener('click', async () => { gsync.disabled = true; gsync.textContent = 'Syncing…'; try { const r = await window.partsdb.sync(); if (r && r.db) { partsDb = r.db; toast(r.ok ? 'Database synced.' : (r.message || 'Sync failed.')); if (sub === 'laptops') renderBody(); } } catch (e) { toast('Sync failed.'); } gsync.disabled = false; gsync.textContent = 'Sync now'; });
    return panel;
  }

  function identifyHelp() {
    const d = el('details', 'parts-help');
    d.appendChild(el('summary', null, lkind === 'screen' ? '📋 How to nail the exact screen (revisions & misreads — read me)' : '📋 How to nail the exact battery'));
    const body = el('div', 'parts-help__body');
    if (lkind === 'screen') {
      body.innerHTML = '<p>One laptop can ship several panels. The <strong>panel part number</strong> on the sticker (behind the panel) is what matters. Match these and a different brand/part is still compatible — that’s how you find cheaper alternatives:</p>'
        + '<ul><li><strong>Resolution</strong> — HD 1366×768 vs FHD 1920×1080 vs FHD+ 1920×1200.</li>'
        + '<li><strong>Refresh</strong> — 60 vs 120/144/165Hz. A mismatch can mean no image.</li>'
        + '<li><strong>Connector</strong> — 30-pin vs 40-pin eDP, and which side.</li>'
        + '<li><strong>Size, brackets, finish</strong> — matte vs glossy; bracket tabs can differ by revision.</li>'
        + '<li><strong>Touch panels</strong> — these can need a matching <strong>controller/firmware revision</strong>; an otherwise-identical touch assembly may not register correctly, so match the full part/revision, not just the size.</li>'
        + '<li><strong>Same number, different revision = different connector.</strong> A panel like <code>N156HGA-EA3 REV.C1</code> vs <code>REV.C5</code> can have a different PCB size and <strong>connector position</strong> (one may even say “smaller PCB 260mm”), or ship “with brackets” vs “without”. So the model number alone isn’t always enough — match the <strong>revision suffix and the connector location</strong> (which side, how many pins) to what came out, or you can get the right number with the wrong cable.</li></ul>'
        + '<p class="pn-legend">⚠ <strong>Easy-to-misread characters:</strong> below, <span class="pn-a">letters are blue</span> and <span class="pn-d">digits are amber</span> — so a <span class="pn-a">B</span> can’t be mistaken for an <span class="pn-d">8</span>, nor <span class="pn-a">O</span> for <span class="pn-d">0</span>. Always double-check B/8, O/0, I/1, S/5, Z/2, G/6 before ordering.</p>';
    } else {
      body.innerHTML = '<p>Go by the <strong>battery part number</strong> on the cell (e.g. <code>AP18C8K</code>, <code>WY9MP</code>, <code>SI03XL</code>), not just the laptop model:</p>'
        + '<ul><li>Match the part number or a listed-compatible one.</li>'
        + '<li><strong>Wh / cell count</strong> — 3-cell vs 4-cell are different sizes.</li>'
        + '<li><strong>Connector</strong> position and keying.</li>'
        + '<li><strong>Swollen battery?</strong> Don’t pierce or force it — isolate and dispose safely.</li></ul>'
        + '<p class="pn-legend">⚠ Below, <span class="pn-a">letters are blue</span>, <span class="pn-d">digits amber</span> — watch B/8, O/0, I/1, S/5.</p>';
    }
    d.appendChild(body); return d;
  }

  function liveSupplierPayload() {
    return enabledSuppliers(lkind).filter((s) => s.live).map((s) => ({ id: s.id, name: s.name, live: s.live, base: s.base || '' }));
  }
  async function runLiveCompare(query) {
    const q = String(query || '').trim();
    if (!q) { toast('Type a model or part number first.'); return; }
    if (!(window.parts && window.parts.search)) { toast('Update the app to use this.'); return; }
    const sups = liveSupplierPayload();
    if (!sups.length) { toast('No readable suppliers ticked (AJ Parts / eBay).'); return; }
    const { terms, resolved, pinned } = liveTermsFor(q);
    liveResults = { query: q, terms, resolved, pinned, loading: true, items: [], perSupplier: [] };
    // Log the lookup for the parts-history intelligence.
    if (window.parts && window.parts.historyLog) {
      const model = resolved ? (resolved.brand + ' ' + resolved.model) : q;
      let items;
      if (isDb() && terms.every(isPartNumber)) items = terms.map((t) => ({ pn: t, maker: ptype === 'screen' ? panelMaker(t) : '' }));
      else if (model) items = [{ pn: (model + ' · ' + ptDef().short), maker: '' }];
      if (items) window.parts.historyLog({ kind: ptype, model, items }).catch(() => {});
    }
    if (els.lresults) drawLaptopResults(els.lresults);
    let r = null;
    try { r = await window.parts.search({ queries: terms, suppliers: sups }); } catch (e) { /* ignore */ }
    liveResults = { query: q, terms, resolved, pinned, loading: false, items: (r && r.items) || [], perSupplier: (r && r.perSupplier) || [] };
    if (els.lresults) drawLaptopResults(els.lresults);
  }

  function loadPartsDb() {
    if (!(window.partsdb && window.partsdb.get)) return;
    window.partsdb.get().then((db) => { if (db && db.entries) partsDb = db; }).catch(() => {});
    if (window.partsdb.sync) window.partsdb.sync().then((r) => { if (r && r.db && r.db.entries) { partsDb = r.db; if (sub === 'laptops') renderBody(); } }).catch(() => {});
  }

  // Guess the panel maker from the part-number prefix.
  function panelMaker(pn) {
    const s = String(pn || '').toUpperCase();
    if (/^(LP|LM)/.test(s)) return 'LG Display';
    if (/^(NV|NE)/.test(s)) return 'BOE';
    if (/^B\d/.test(s)) return 'AU Optronics';
    if (/^N\d/.test(s)) return 'Innolux';
    if (/^LQ/.test(s)) return 'Sharp';
    if (/^M\d/.test(s)) return 'Innolux';
    if (/^HSD/.test(s)) return 'HannStar';
    if (/^(CLAA|CMO)/.test(s)) return 'Chi Mei';
    if (/^TV/.test(s)) return 'BOE';
    return '';
  }
  function minPriceForTerm(t) { let m = null; (liveResults.items || []).forEach((it) => { if (it.term === t && it.priceNum != null && it.inStock) { if (m == null || it.priceNum < m) m = it.priceNum; } }); return m; }
  const termsArePns = () => (liveResults.terms || []).length > 0 && liveResults.terms.every(isPartNumber);

  function panelSummary() {
    const terms = liveResults.terms || [];
    const noun = lkind === 'screen' ? 'panel' : 'battery';
    const box = el('div', 'parts-psum');
    const one = terms.length === 1;
    box.appendChild(el('div', 'parts-psum__hd' + (one ? ' parts-psum__hd--ok' : ' parts-psum__hd--warn'),
      one ? ('✓ This model uses a single ' + noun + ' (' + terms[0] + ') — you can usually order without opening it up.')
        : ('⚠ This model takes ' + terms.length + ' different ' + noun + 's — they’re cross-compatible, but check the number on the back before you order.')));
    const row = el('div', 'parts-psum__row');
    terms.forEach((t, i) => {
      const chip = el('div', 'parts-psum__chip hue' + (i % 4));
      chip.appendChild(pnEl(t));
      const mk = lkind === 'screen' ? panelMaker(t) : '';
      if (mk) chip.appendChild(el('span', 'parts-psum__mk', mk));
      const min = minPriceForTerm(t);
      chip.appendChild(el('span', 'parts-psum__price', min != null ? ('from ' + money(min)) : (liveResults.loading ? '…' : 'not found')));
      row.appendChild(chip);
    });
    box.appendChild(row);
    return box;
  }

  function livePanel() {
    const wrap = el('div', 'parts-live');
    wrap.appendChild(el('h3', 'parts-h3', 'Live prices — “' + liveResults.query + '”'));
    if (liveResults.resolved) wrap.appendChild(el('div', 'parts-live__note', '✓ Matched ' + liveResults.resolved.brand + ' ' + liveResults.resolved.model + (liveResults.pinned ? ' — using your pinned part number' + (liveResults.terms.length > 1 ? 's' : '') : '')));
    if (termsArePns()) wrap.appendChild(panelSummary());
    else if (liveResults.terms) wrap.appendChild(el('div', 'parts-live__note', 'Searching: ' + liveResults.terms.join(', ')));

    if (liveResults.loading) {
      const ld = el('div', 'parts-live__loading'); ld.appendChild(el('span', 'spinner', '')); ld.appendChild(el('span', 'muted', 'Fetching prices from your suppliers…'));
      wrap.appendChild(ld); return wrap;
    }
    const status = el('div', 'parts-live__status');
    (liveResults.perSupplier || []).forEach((ps) => {
      const lbl = ps.name + (ps.status === 'ok' ? ' · ' + ps.count : ps.status === 'blocked' ? ' · couldn’t read' : ' · open only');
      status.appendChild(el('span', 'parts-live__stat parts-live__stat--' + ps.status, lbl));
    });
    wrap.appendChild(status);
    if (!liveResults.items.length) {
      wrap.appendChild(el('p', 'muted', 'No live results came back. Use the “open on site” buttons below — some suppliers (eBay included) block apps from reading them, especially on a VPN.'));
      if (liveResults.resolved && !isDb()) wrap.appendChild(pinBox(liveResults.resolved));
      return wrap;
    }
    // Group by the panel/battery number searched; dedupe near-identical listings.
    if (termsArePns()) {
      if (lkind === 'screen') wrap.appendChild(el('div', 'parts-live__warn', '⚠ Same number can ship different revisions — check the connector position/pins and “with vs without brackets” against the old panel before ordering.'));
      groupByTerm().forEach((g, i) => wrap.appendChild(groupBlock(g, i)));
    } else {
      const list = el('div', 'parts-live__list');
      liveResults.items.forEach((it) => list.appendChild(liveRow(it)));
      wrap.appendChild(list);
    }
    if (liveResults.resolved && !isDb()) wrap.appendChild(pinBox(liveResults.resolved));
    return wrap;
  }

  function groupByTerm() {
    const terms = liveResults.terms || [];
    return terms.map((t) => {
      const raw = (liveResults.items || []).filter((it) => it.term === t);
      const seen = {}; const ded = [];
      raw.forEach((it) => {
        const k = (it.supplierId || it.supplier) + '|' + (it.priceNum || 0);
        if (seen[k]) { seen[k]._more = (seen[k]._more || 1) + 1; return; }
        const copy = Object.assign({ _more: 1 }, it); seen[k] = copy; ded.push(copy);
      });
      ded.sort((a, b) => (a.inStock === b.inStock ? 0 : a.inStock ? -1 : 1) || ((a.priceNum || 1e9) - (b.priceNum || 1e9)));
      return { term: t, maker: lkind === 'screen' ? panelMaker(t) : '', items: ded };
    });
  }
  function groupBlock(g, i) {
    const sec = el('div', 'parts-grp hue' + (i % 4));
    const hd = el('div', 'parts-grp__hd');
    hd.appendChild(pnEl(g.term));
    if (g.maker) hd.appendChild(el('span', 'parts-grp__mk', g.maker));
    sec.appendChild(hd);
    if (!g.items.length) { sec.appendChild(el('p', 'muted parts-grp__none', 'No live results for this one — try the “open on site” buttons below.')); return sec; }
    const list = el('div', 'parts-live__list');
    g.items.forEach((it) => list.appendChild(liveRow(it)));
    sec.appendChild(list);
    return sec;
  }
  function liveRow(it) {
    const r = el('div', 'parts-live__row' + (it.inStock ? '' : ' parts-live__row--oos'));
    r.appendChild(el('span', 'parts-tag', it.supplier));
    const mid = el('div', 'parts-live__mid');
    mid.appendChild(el('div', 'parts-live__title', it.title));
    mid.appendChild(el('div', 'muted parts-live__stock', it.stock + (it._more > 1 ? ' · +' + (it._more - 1) + ' more at this price' : '')));
    r.appendChild(mid);
    const price = el('div', 'parts-live__price');
    price.appendChild(el('div', 'parts-live__cost', it.price));
    if (it.priceNum != null) price.appendChild(el('div', 'muted parts-live__cust', 'sell ' + money(quote(it.priceNum))));
    r.appendChild(price);
    const acts = el('div', 'parts-live__acts');
    const buy = el('button', 'btn btn--primary btn--sm', 'Buy ↗'); buy.addEventListener('click', () => openUrl(it.url)); acts.appendChild(buy);
    const tk = el('button', 'btn btn--ghost btn--sm', '＋ Ticket'); tk.addEventListener('click', () => addPartToTicket({ id: 'live', name: (it.term || liveResults.query) }, ptDef().short + ' replacement', { supplier: it.supplier, product: it.title.slice(0, 70) }, it.priceNum || 0)); acts.appendChild(tk);
    r.appendChild(acts);
    return r;
  }

  async function findThisPc(btn) {
    if (!(window.parts && window.parts.thisPc)) { toast('Update the app to use this.'); return; }
    const orig = btn.textContent; btn.disabled = true; btn.textContent = 'Detecting…';
    let r = null;
    try { r = await window.parts.thisPc(); } catch (e) { /* ignore */ }
    btn.disabled = false; btn.textContent = orig;
    if (!r || !r.ok) { toast('Couldn’t read this PC’s model.'); return; }
    detect = r;
    lq = (r.query || '').trim();
    if (!r.isLaptop) toast('This looks like a desktop — no built-in screen, but I’ll search by model.');
    renderBody();
    runLiveCompare(lq);
  }
  function detectBanner() {
    const d = detect || {};
    const b = el('div', 'parts-detect');
    b.appendChild(el('span', 'parts-detect__ico', '💻'));
    const t = el('div', 'parts-detect__t');
    const title = el('div', 'parts-detect__title');
    title.appendChild(el('strong', null, 'This PC: ' + (d.brand ? d.brand + ' ' : '') + (d.friendly || d.model || 'Unknown')));
    if (!d.isLaptop) title.appendChild(el('span', 'parts-tag parts-detect__badge', 'desktop — no internal screen'));
    t.appendChild(title);
    const bits = [];
    if (lkind === 'screen' && d.panelMaker) { const mk = EDID_MAKERS[d.panelMaker] || d.panelMaker; bits.push('Fitted panel: ' + mk + (d.panelCode ? (' ' + d.panelCode) : '') + (d.panelName ? (' “' + d.panelName + '”') : '')); }
    bits.push('Searching “' + (d.query || '') + '” below — always confirm against the sticker.');
    t.appendChild(el('div', 'muted parts-detect__sub', bits.join(' · ')));
    b.appendChild(t);
    const x = el('button', 'btn btn--ghost btn--sm', 'Clear');
    x.addEventListener('click', () => { detect = null; renderBody(); });
    b.appendChild(x);
    return b;
  }

  function partTypeGotcha() {
    const d = ptDef();
    const box = el('details', 'parts-help'); box.open = true;
    box.appendChild(el('summary', null, '⚠ ' + d.short + ' — read this first'));
    const body = el('div', 'parts-help__body');
    body.appendChild(el('p', null, d.gotchas || 'Enter the laptop model below and it’ll search your suppliers for this part.'));
    box.appendChild(body);
    return box;
  }

  function renderLaptops() {
    const wrap = el('div', 'parts-view');
    const results = el('div');
    const redraw = () => drawLaptopResults(results);

    const bar = el('div', 'parts-toolbar parts-ltoolbar');
    const ptWrap = el('label', 'parts-ptype');
    ptWrap.appendChild(el('span', 'parts-ptype__lbl', 'Part'));
    const psel = el('select', 'parts-input parts-ptype__sel');
    (D.partTypes || []).forEach((t) => { const o = el('option', null, t.label); o.value = t.id; if (t.id === ptype) o.selected = true; psel.appendChild(o); });
    psel.addEventListener('change', () => { setPtype(psel.value); renderBody(); });
    ptWrap.appendChild(psel);
    const search = el('input', 'parts-input parts-search'); search.type = 'search';
    search.placeholder = ptype === 'screen' ? 'Laptop model or panel part number — e.g. Dell Latitude 5520, or N156HGA-EA3'
      : ptype === 'battery' ? 'Laptop model or battery part number — e.g. HP 250 G8, or AP18C8K'
        : ptype === 'other' ? 'Model + the part you need — e.g. Dell Latitude 5520 CMOS battery'
          : 'Laptop model — e.g. Dell Latitude 5520 (searches ' + ptDef().short.toLowerCase() + ')';
    search.value = lq;
    search.addEventListener('input', () => { lq = search.value; redraw(); });
    const thisBtn = el('button', 'btn btn--primary btn--sm parts-thispc', '💻 Find for THIS PC');
    thisBtn.addEventListener('click', () => findThisPc(thisBtn));
    bar.appendChild(ptWrap); bar.appendChild(search); bar.appendChild(thisBtn);
    wrap.appendChild(bar);
    if (detect) wrap.appendChild(detectBanner());
    wrap.appendChild(supplierChooser(redraw));
    wrap.appendChild(isDb() ? identifyHelp() : partTypeGotcha());
    wrap.appendChild(results);
    els.lresults = results;
    els.body.innerHTML = ''; els.body.appendChild(wrap);
    drawLaptopResults(results);
  }

  function supplierChips(term, cls, ctx) {
    ctx = ctx || {};
    const row = el('div', 'parts-chips' + (cls ? ' ' + cls : ''));
    const sups = enabledSuppliers(lkind);
    if (!sups.length) { row.appendChild(el('span', 'muted', 'No suppliers ticked — open ⚙ Suppliers above.')); return row; }
    sups.forEach((s) => {
      let label = s.name, href = null, off = false;
      if (s.oem) {
        const o = D.oemFor(ctx.brand || ctx.model || term || '');
        label = o ? ('Maker: ' + o.name) : 'Manufacturer ↗';
        const oq = ctx.model || term || '';
        if (o) href = o.url(oq, ctx.serial);
        else if (oq) href = 'https://www.google.com/search?q=' + encodeURIComponent(oq + ' laptop screen manufacturer parts');
        if (!href) off = true;
      } else {
        href = term ? s.url(term) : null;
        off = !term;
      }
      const c = el('button', 'parts-chip' + (off ? ' parts-chip--off' : ''), label); c.title = s.note || '';
      c.addEventListener('click', (e) => { e.preventDefault(); if (href) openUrl(href); });
      row.appendChild(c);
    });
    return row;
  }

  function modelNoteBox(rm, note) {
    const box = el('div', 'parts-modelnote');
    box.appendChild(el('span', 'parts-modelnote__ico', '📌'));
    const t = el('div', 'parts-modelnote__t');
    t.appendChild(el('strong', null, rm.brand + ' ' + rm.model + ' — ' + ptDef().short));
    t.appendChild(el('p', 'parts-modelnote__p', note));
    box.appendChild(t);
    return box;
  }

  function drawLaptopResults(container) {
    container.innerHTML = '';
    const q = lq.trim();

    // Model-specific part gotcha (e.g. "this T14s has soldered RAM").
    if (q) {
      const rm = resolveModel(q);
      const notes = rm && D.partNotesByModel && D.partNotesByModel[rm.id];
      if (notes && notes[ptype]) container.appendChild(modelNoteBox(rm, notes[ptype]));
    }

    const se = el('div', 'parts-searchrow');
    const seHead = el('div', 'parts-searchrow__head');
    seHead.appendChild(el('div', 'parts-searchrow__lbl', q ? ('Compare “' + q + '” in-app, or open a supplier’s own search:') : 'Type a model or part number, then compare prices in-app:'));
    const cmp = el('button', 'btn btn--primary btn--sm', '💷 Compare prices in-app');
    if (!q) cmp.disabled = true;
    cmp.addEventListener('click', () => runLiveCompare(q));
    seHead.appendChild(cmp);
    se.appendChild(seHead);
    const seCtx = (detect && detect.query === q) ? { brand: detect.brand, model: detect.query, serial: detect.serial } : { model: q };
    se.appendChild(supplierChips(q, null, seCtx));
    container.appendChild(se);

    if (liveResults && liveResults.query === q) container.appendChild(livePanel());

    // Curated panel/battery cards only exist for screens & batteries. For other
    // part types the gotcha box + live compare + supplier buttons do the job.
    if (!isDb()) return;
    const ql = q.toLowerCase();
    const items = (D.laptops || []).filter((lp) => {
      const part = lp[lkind]; if (!part) return false;
      if (!ql) return true;
      const pns = (part.panels || part.parts || []).join(' ');
      return (lp.brand + ' ' + lp.model + ' ' + (lp.aliases || '') + ' ' + pns).toLowerCase().includes(ql);
    });
    if (!items.length && q) { const rm = resolveModel(q); if (rm && rm[lkind]) items.push(rm); }
    const grid = el('div', 'parts-grid');
    if (!items.length) {
      grid.appendChild(el('p', 'muted', q ? ('No saved match for “' + q + '” — use the supplier buttons above to search it directly.') : 'No models.'));
    } else {
      items.forEach((lp) => grid.appendChild(laptopCard(lp, container)));
    }
    container.appendChild(grid);
  }

  function laptopCard(lp, container) {
    const part = lp[lkind] || {};
    const cost = lkind === 'screen' ? lScreenCost(lp) : lBattCost(lp);
    const key = (lkind === 'screen' ? 's:' : 'b:') + lp.id;
    const custom = store.laptopCost[key] != null;
    const pns = (lkind === 'screen' ? part.panels : part.parts) || [];
    const card = el('div', 'parts-card');
    const head = el('div', 'parts-card__head'); const tags = el('div', 'parts-card__tags');
    tags.appendChild(el('span', 'parts-tag', lp.brand)); head.appendChild(tags); card.appendChild(head);
    card.appendChild(el('h4', 'parts-card__name', lp.model));
    const kv = el('div', 'parts-card__kv');
    const row = (k, v) => { if (v == null || v === '') return; kv.appendChild(el('span', 'parts-card__k', k)); kv.appendChild(el('span', 'parts-card__v', v)); };
    if (lkind === 'screen') { row('Size', part.size); row('Resolution', part.res); row('Refresh', part.hz ? (part.hz + 'Hz') : null); row('Connector', part.conn); row('Touch', part.touch === true ? 'Yes — bonded (match firmware)' : part.touch === 'varies' ? 'Varies by SKU' : 'No'); }
    else { row('Capacity', part.spec); }
    card.appendChild(kv);

    if (pns.length) {
      const box = el('div', 'parts-pns');
      box.appendChild(el('div', 'parts-pns__lbl', (pns.length > 1 ? 'Interchangeable ' + (lkind === 'screen' ? 'panels' : 'batteries') + ' — buy the cheapest (check the sticker):' : (lkind === 'screen' ? 'Common panel (check the sticker):' : 'Common battery (check the sticker):'))));
      pns.forEach((pn) => {
        const r = el('div', 'parts-pn');
        r.appendChild(pnEl(pn));
        const term = partTerm(pn);
        const cp = el('button', 'btn btn--ghost btn--sm', 'Copy'); cp.addEventListener('click', (e) => { e.preventDefault(); copyText(term, 'Part number copied.'); });
        r.appendChild(cp);
        const sups = enabledSuppliers(lkind);
        if (sups.length && !/\s/.test(term)) {
          const pc = el('button', 'btn btn--ghost btn--sm', '£ compare'); pc.title = 'Search this exact number at ' + sups[0].name;
          pc.addEventListener('click', (e) => { e.preventDefault(); sups.forEach((s) => openUrl(s.url(term))); });
          r.appendChild(pc);
        }
        box.appendChild(r);
      });
      if (pns.length > 1) box.appendChild(el('p', 'muted parts-pns__tip', 'These are cross-compatible — prices vary a lot between them, so “£ compare” opens them all and you grab the cheapest. On AJ Parts one number often returns another; that’s fine if the spec matches.'));
      card.appendChild(box);
    }

    if (part.note) card.appendChild(gotchaInline(part.note));
    if (pns.some((pn) => looksAmbiguous(partTerm(pn)))) card.appendChild(gotchaInline('Double-check the characters before ordering — this one has easily-confused B/8, O/0 or similar. Blue = letter, amber = digit.'));

    const foot = el('div', 'parts-card__foot'); const leftc = el('div');
    const tradeLine = el('div', 'parts-card__trade');
    tradeLine.appendChild(el('span', 'muted', 'Trade: '));
    tradeLine.appendChild(el('strong', custom ? 'parts-custom' : null, money(cost)));
    const editP = el('button', 'btn btn--ghost btn--sm', custom ? 'Edit ✓' : 'Edit');
    editP.addEventListener('click', (e) => {
      e.preventDefault();
      const v = window.prompt('Trade cost (£) for ' + lp.model + ' ' + (lkind === 'screen' ? 'screen' : 'battery') + '.\nBlank to reset.', (cost || 0).toFixed(2));
      if (v === null) return;
      if (!v.trim()) delete store.laptopCost[key]; else store.laptopCost[key] = parseFloat(v) || 0;
      persist({ laptopCost: store.laptopCost }); drawLaptopResults(container);
    });
    tradeLine.appendChild(editP);
    leftc.appendChild(tradeLine);
    leftc.appendChild(el('div', 'parts-card__quote', 'Customer: ' + money(quote(cost))));
    foot.appendChild(leftc);
    card.appendChild(foot);

    const t0 = pns[0] ? partTerm(pns[0]) : '';
    const cardTerm = (t0 && !/\s/.test(t0)) ? t0 : (lp.brand + ' ' + lp.model);
    card.appendChild(supplierChips(cardTerm, 'parts-chips--card', { brand: lp.brand, model: lp.brand + ' ' + lp.model }));

    const act = el('div', 'parts-card__act');
    const tbtn = el('button', 'btn btn--ghost btn--sm parts-ticketbtn', '＋ Add to ticket');
    tbtn.addEventListener('click', (e) => { e.preventDefault(); addPartToTicket({ id: lp.id, name: lp.brand + ' ' + lp.model }, ptDef().short + ' replacement', { supplier: (enabledSuppliers(lkind)[0] || {}).name || '', product: t0 || '' }, cost); });
    act.appendChild(tbtn); card.appendChild(act);
    return card;
  }

  // ---- suppliers view ----
  function renderSuppliers() {
    const wrap = el('div', 'parts-view');
    wrap.appendChild(el('h3', 'parts-h3', 'UK trade suppliers'));
    const grid = el('div', 'parts-grid');
    (D.suppliersDir || []).forEach((s) => {
      const card = el('div', 'parts-card');
      card.appendChild(el('h4', 'parts-card__name', s.name));
      const kv = el('div', 'parts-card__kv');
      const row = (k, v) => { kv.appendChild(el('span', 'parts-card__k', k)); kv.appendChild(el('span', 'parts-card__v', v)); };
      row('Specialty', s.specialty); row('Warranty', s.warranty); row('Cut-off', s.cutoff);
      card.appendChild(kv);
      const foot = el('div', 'parts-card__foot');
      foot.appendChild(el('span', 'muted', new URL(s.url).hostname.replace('www.', '')));
      const open = el('button', 'btn btn--primary btn--sm', 'Open site');
      open.addEventListener('click', () => openUrl(s.url));
      foot.appendChild(open);
      card.appendChild(foot);
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    els.body.innerHTML = ''; els.body.appendChild(wrap);
  }

  // ---- parts search history / stock intelligence ----
  let histWindow = 'all';
  function last12Count(rec) {
    const now = new Date(); let n = 0;
    for (let i = 0; i < 12; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const ym = d.toISOString().slice(0, 7); n += (rec.months && rec.months[ym]) || 0; }
    return n;
  }
  function histCount(rec) { return histWindow === '12' ? last12Count(rec) : rec.count; }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString('en-GB'); } catch (e) { return ''; } }

  async function renderHistory() {
    const wrap = el('div', 'parts-view');
    const top = el('div', 'parts-toolbar');
    top.appendChild(el('h3', 'parts-h3', 'Parts you look up'));
    const seg = el('div', 'parts-seg');
    [['all', 'All time'], ['12', 'Last 12 months']].forEach(([v, t]) => {
      const bt = el('button', 'btn btn--sm' + (histWindow === v ? ' btn--primary' : ' btn--ghost'), t);
      bt.addEventListener('click', () => { histWindow = v; renderBody(); });
      seg.appendChild(bt);
    });
    top.appendChild(seg);
    wrap.appendChild(top);
    const body = el('div'); wrap.appendChild(body);
    els.body.innerHTML = ''; els.body.appendChild(wrap);
    body.appendChild(el('p', 'muted', 'Loading…'));

    let recs = [];
    try { recs = (await window.parts.historyGet()) || []; } catch (e) { /* ignore */ }
    body.innerHTML = '';
    if (!recs.length) {
      body.appendChild(el('p', 'muted', 'No searches logged yet. Each time you compare prices for a panel or battery, it’s counted here — over time you’ll see which parts you source most, so you know what’s worth keeping in stock.'));
      return;
    }
    recs = recs.filter((r) => histCount(r) > 0).sort((a, b) => histCount(b) - histCount(a));
    const totalSearches = recs.reduce((s, r) => s + histCount(r), 0);
    const stockPicks = recs.filter((r) => histCount(r) >= 3);
    const summary = el('div', 'parts-hist-sum');
    summary.appendChild(el('span', null, recs.length + ' distinct parts · ' + totalSearches + ' lookups' + (histWindow === '12' ? ' in the last 12 months' : ' all time')));
    if (stockPicks.length) summary.appendChild(el('span', 'parts-hist-sum__stock', '📦 ' + stockPicks.length + ' worth keeping in stock'));
    const clr = el('button', 'btn btn--ghost btn--sm', 'Clear history');
    clr.addEventListener('click', async () => { if (!window.confirm('Clear all parts search history? This can’t be undone.')) return; await window.parts.historyClear(); renderBody(); });
    summary.appendChild(clr);
    body.appendChild(summary);

    const grid = el('div', 'parts-grid');
    recs.forEach((r) => grid.appendChild(historyCard(r)));
    body.appendChild(grid);
  }

  function historyCard(r) {
    const c = last12Count(r); const count = histCount(r);
    const card = el('div', 'parts-card');
    const head = el('div', 'parts-card__head');
    const left = el('div', 'parts-hist-pn'); left.appendChild(pnEl(r.pn));
    if (r.makers && r.makers.length) left.appendChild(el('span', 'parts-grp__mk', r.makers.join(' / ')));
    head.appendChild(left);
    const badge = el('span', 'parts-hist-badge' + (count >= 3 ? ' parts-hist-badge--hot' : ''), '×' + count);
    head.appendChild(badge);
    card.appendChild(head);

    if (count >= 3) card.appendChild(el('div', 'parts-hist-stock', '📦 Searched ' + count + ' times — consider keeping one in stock.'));

    const kv = el('div', 'parts-card__kv');
    const row = (k, v) => { if (!v) return; kv.appendChild(el('span', 'parts-card__k', k)); kv.appendChild(el('span', 'parts-card__v', v)); };
    const ptd = (D.partTypes || []).find((t) => t.id === r.kind);
    row('Type', ptd ? ptd.short : (r.kind === 'battery' ? 'Battery' : 'Screen panel'));
    row('All time', String(r.count));
    row('Last 12 mo', String(c));
    row('Last looked', fmtDate(r.last));
    card.appendChild(kv);

    if (r.models && r.models.length) { const m = el('div', 'parts-hist-models'); m.appendChild(el('span', 'muted', 'Fits: ')); m.appendChild(el('span', null, r.models.join(', '))); card.appendChild(m); }

    if (r.compat && r.compat.length) {
      const box = el('div', 'parts-hist-compat');
      box.appendChild(el('div', 'muted parts-hist-compat__lbl', 'Cross-compatible with:'));
      const chips = el('div', 'parts-chips');
      r.compat.forEach((pn) => {
        const chip = el('button', 'parts-chip', pn);
        chip.title = 'Look this one up';
        chip.addEventListener('click', () => { sub = 'laptops'; setPtype(r.kind || 'screen'); lq = pn; renderBody(); runLiveCompare(pn); syncSubtabs(); });
        chips.appendChild(chip);
      });
      box.appendChild(chips); card.appendChild(box);
    }

    const act = el('div', 'parts-card__act');
    const again = el('button', 'btn btn--primary btn--sm parts-ticketbtn', '🔎 Look up again');
    again.addEventListener('click', () => { sub = 'laptops'; setPtype(r.kind || 'screen'); const q = (r.kind === 'screen' || r.kind === 'battery') ? r.pn : (r.pn.split(' · ')[0] || r.pn); lq = q; renderBody(); runLiveCompare(q); syncSubtabs(); });
    act.appendChild(again); card.appendChild(act);
    return card;
  }

  function syncSubtabs() { if (els.sub) els.sub.querySelectorAll('[data-sub]').forEach((x) => x.classList.toggle('subtab--active', x.dataset.sub === sub)); }

  function renderBody() {
    renderPricing();
    if (sub === 'laptops') renderLaptops();
    else if (sub === 'history') renderHistory();
    else if (sub === 'suppliers') renderSuppliers();
    else renderMobile();
  }

  async function load() {
    if (loaded) { renderBody(); return; }
    try { const p = await window.parts.get(); if (p) store = Object.assign(store, p); } catch (e) { /* defaults */ }
    loadPartsDb();
    loaded = true;
    renderBody();
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.pricing = $('#partsPricing'); els.body = $('#partsBody'); els.sub = $('#partsSub');
    if (!els.body) return;
    if (els.sub) els.sub.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => {
      sub = b.dataset.sub;
      els.sub.querySelectorAll('[data-sub]').forEach((x) => x.classList.toggle('subtab--active', x === b));
      renderBody();
    }));
    const tab = document.querySelector('.tab[data-tab="parts"]');
    if (tab) tab.addEventListener('click', load);
  });
})();
