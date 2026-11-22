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
  let sub = 'phone', tier = 'preferred', lq = '', lkind = 'screen';
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
  function partTerm(pn) { const m = String(pn).match(/[A-Z0-9]{2,}(?:-[A-Z0-9]+)+|[A-Z]{1,3}\d[A-Z0-9]{2,}|[A-Z0-9]{5,}/); return m ? m[0] : String(pn).replace(/\s*[([=].*$/, '').trim(); }
  function looksAmbiguous(code) { return /[B8O0I1S5Z2G6]/.test(code) && /[A-Z]/.test(code) && /\d/.test(code); }

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
        + '<li><strong>Touch panels</strong> — these can need a matching <strong>controller/firmware revision</strong>; an otherwise-identical touch assembly may not register correctly, so match the full part/revision, not just the size.</li></ul>'
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

  function renderLaptops() {
    const wrap = el('div', 'parts-view');
    const results = el('div');
    const redraw = () => drawLaptopResults(results);

    const bar = el('div', 'parts-toolbar parts-ltoolbar');
    const seg = el('div', 'parts-seg');
    const sBtn = el('button', 'btn btn--sm' + (lkind === 'screen' ? ' btn--primary' : ' btn--ghost'), '🖥 Screens');
    sBtn.addEventListener('click', () => { lkind = 'screen'; renderBody(); });
    const bBtn = el('button', 'btn btn--sm' + (lkind === 'battery' ? ' btn--primary' : ' btn--ghost'), '🔋 Batteries');
    bBtn.addEventListener('click', () => { lkind = 'battery'; renderBody(); });
    seg.appendChild(sBtn); seg.appendChild(bBtn);
    const search = el('input', 'parts-input parts-search'); search.type = 'search';
    search.placeholder = lkind === 'screen' ? 'Laptop model or panel part number — e.g. Dell Latitude 5520, or N156HGA-EA3' : 'Laptop model or battery part number — e.g. HP 250 G8, or AP18C8K';
    search.value = lq;
    search.addEventListener('input', () => { lq = search.value; redraw(); });
    bar.appendChild(seg); bar.appendChild(search);
    wrap.appendChild(bar);
    wrap.appendChild(supplierChooser(redraw));
    wrap.appendChild(identifyHelp());
    wrap.appendChild(results);
    els.body.innerHTML = ''; els.body.appendChild(wrap);
    drawLaptopResults(results);
  }

  function supplierChips(term, cls) {
    const row = el('div', 'parts-chips' + (cls ? ' ' + cls : ''));
    const sups = enabledSuppliers(lkind);
    if (!sups.length) { row.appendChild(el('span', 'muted', 'No suppliers ticked — open ⚙ Suppliers above.')); return row; }
    sups.forEach((s) => {
      const c = el('button', 'parts-chip', s.name); c.title = s.note || '';
      if (!term) c.classList.add('parts-chip--off');
      c.addEventListener('click', (e) => { e.preventDefault(); if (term) openUrl(s.url(term)); });
      row.appendChild(c);
    });
    return row;
  }

  function drawLaptopResults(container) {
    container.innerHTML = '';
    const q = lq.trim();

    const se = el('div', 'parts-searchrow');
    se.appendChild(el('div', 'parts-searchrow__lbl', q ? ('Search ' + (lkind === 'screen' ? 'screens' : 'batteries') + ' for “' + q + '” at:') : 'Type a model or part number, then search these suppliers:'));
    se.appendChild(supplierChips(q));
    container.appendChild(se);

    const ql = q.toLowerCase();
    const items = (D.laptops || []).filter((lp) => {
      const part = lp[lkind]; if (!part) return false;
      if (!ql) return true;
      const pns = (part.panels || part.parts || []).join(' ');
      return (lp.brand + ' ' + lp.model + ' ' + (lp.aliases || '') + ' ' + pns).toLowerCase().includes(ql);
    });
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
    card.appendChild(supplierChips(cardTerm, 'parts-chips--card'));

    const act = el('div', 'parts-card__act');
    const tbtn = el('button', 'btn btn--ghost btn--sm parts-ticketbtn', '＋ Add to ticket');
    tbtn.addEventListener('click', (e) => { e.preventDefault(); addPartToTicket({ id: lp.id, name: lp.brand + ' ' + lp.model }, lkind === 'screen' ? 'Screen replacement' : 'Battery replacement', { supplier: (enabledSuppliers(lkind)[0] || {}).name || '', product: t0 || '' }, cost); });
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

  function renderBody() {
    renderPricing();
    if (sub === 'laptops') renderLaptops();
    else if (sub === 'suppliers') renderSuppliers();
    else renderMobile();
  }

  async function load() {
    if (loaded) { renderBody(); return; }
    try { const p = await window.parts.get(); if (p) store = Object.assign(store, p); } catch (e) { /* defaults */ }
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
