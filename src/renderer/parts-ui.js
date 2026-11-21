'use strict';

// Parts & Quotes tab: iPhone screen/battery + laptop-screen finder with instant
// customer quotes. Trade prices and supplier links are editable and saved to the
// portable tools.json (travel on the stick). Quotes can be copied or posted to
// the active Syncro ticket.
(function () {
  const D = window.TM_PARTS || {};
  const els = {};
  let store = { settings: { shopFee: 35, markupValue: 15, markupType: 'amount', includeVat: true }, prices: {}, urls: {}, laptopCost: {} };
  let model = '14pm', sub = 'phone', tier = 'preferred', lq = '';
  let loaded = false;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function money(n) { return '£' + (Number(n) || 0).toFixed(2); }
  function toast(m) { const t = $('#toast'); if (!t) return; t.textContent = m; t.classList.add('toast--show'); setTimeout(() => t.classList.remove('toast--show'), 2600); }
  function persist(patch) { if (window.parts && window.parts.save) window.parts.save(patch).catch(() => {}); }
  function openUrl(u) { if (window.sys && window.sys.openUrl) window.sys.openUrl(u); }

  // ---- pricing maths ----
  function quote(trade) {
    const s = store.settings;
    let v = (Number(trade) || 0) + (Number(s.shopFee) || 0);
    if (s.markupType === 'amount') v += (Number(s.markupValue) || 0);
    else v += v * ((Number(s.markupValue) || 0) / 100);
    if (s.includeVat) v *= 1.2;
    return v;
  }
  function mIndex(id) { return D.iphones.findIndex((m) => m.id === id); }
  function baseScreen(i) { return 42 + ((D.iphones.length - 1 - (i < 0 ? 8 : i)) * 5); }
  function baseBattery(i) { return 16 + ((D.iphones.length - 1 - (i < 0 ? 8 : i)) * 1.5); }
  function sTrade(id, sup) { const k = 's:' + id + '_' + sup.supplier; return store.prices[k] != null ? Number(store.prices[k]) : Math.max(15, baseScreen(mIndex(id)) + sup.off); }
  function bTrade(id, sup) { const k = 'b:' + id + '_' + sup.supplier; return store.prices[k] != null ? Number(store.prices[k]) : Math.max(10, baseBattery(mIndex(id)) + sup.off); }
  function isCustom(prefix, id, supplier) { return store.prices[prefix + ':' + id + '_' + supplier] != null; }
  function supUrl(kind, id, supplier) {
    const k = kind + 'u:' + id + '_' + supplier;
    if (store.urls[k]) return store.urls[k];
    const m = D.iphones.find((x) => x.id === id);
    const q = (m ? m.name : '') + ' ' + (kind === 'b' ? 'battery' : 'screen');
    const b = D.searchUrl[supplier];
    return b ? b(q) : 'https://www.google.co.uk/search?q=' + encodeURIComponent(supplier + ' ' + q);
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
    const v = window.prompt('Direct product link for ' + supplier + '.\nLeave blank to reset to catalogue search.', curr);
    if (v === null) return;
    const k = kind + 'u:' + id + '_' + supplier;
    if (!v.trim()) delete store.urls[k]; else store.urls[k] = v.trim();
    persist({ urls: store.urls }); redraw();
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
    const hint = el('span', 'muted parts-pricing__hint', 'Customer price = part + fee + markup' + (s.includeVat ? ' + VAT' : '') + '. Saved on the stick.');
    els.pricing.appendChild(hint);
  }

  // ---- phone view ----
  function screensFor(id) {
    let list = (D.screenSuppliers || []).slice();
    if (tier === 'preferred') list = list.filter((s) => s.preferred);
    return list;
  }
  function gotchaBox(title, text) {
    const b = el('div', 'parts-gotcha');
    b.appendChild(el('span', 'parts-gotcha__ico', '⚠'));
    const t = el('div'); t.appendChild(el('strong', null, title)); t.appendChild(el('p', 'muted', text));
    b.appendChild(t); return b;
  }
  function closeBar(pct) { const w = el('div', 'parts-bar'); const f = el('div', 'parts-bar__fill'); f.style.width = Math.max(0, Math.min(100, pct)) + '%'; w.appendChild(f); return w; }

  function partCard(kind, id, sup, redraw) {
    const trade = kind === 's' ? sTrade(id, sup) : bTrade(id, sup);
    const custom = isCustom(kind, id, sup.supplier);
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
    if (kind === 's') { row('Panel', sup.type); row('Closeness', sup.closeness + '%', 'good'); }
    else { row('Capacity', sup.capacity); row('Health', sup.health); }
    row('Warranty', sup.warranty);
    card.appendChild(kv);
    if (kind === 's') card.appendChild(closeBar(sup.closeness));

    // trade + quote + edit
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
    buy.addEventListener('click', (e) => { e.preventDefault(); openUrl(supUrl(kind, id, sup.supplier)); });
    const editU = el('button', 'btn btn--ghost btn--sm', (store.urls[kind + 'u:' + id + '_' + sup.supplier] ? 'Link ✓' : 'Link'));
    editU.addEventListener('click', (e) => { e.preventDefault(); editUrl(kind, id, sup.supplier, supUrl(kind, id, sup.supplier), redraw); });
    const bwrap = el('div', 'parts-card__buy'); bwrap.appendChild(editU); bwrap.appendChild(buy);
    foot.appendChild(bwrap);
    card.appendChild(foot);
    return card;
  }

  function quoteHtml() {
    const m = D.iphones.find((x) => x.id === model) || {};
    const scr = screensFor(model)[0] || (D.screenSuppliers || [])[0];
    const bat = (D.batterySuppliers || [])[0];
    const sc = scr ? quote(sTrade(model, scr)) : 0;
    const bc = bat ? quote(bTrade(model, bat)) : 0;
    const vat = store.settings.includeVat ? 'inc. VAT' : 'ex. VAT';
    return '<p><strong>' + (m.name || 'iPhone') + ' repair quote</strong> (fitting included, ' + vat + ')</p>' +
      '<ul><li>Screen replacement: <strong>' + money(sc) + '</strong></li>' +
      '<li>Battery replacement: <strong>' + money(bc) + '</strong></li></ul>' +
      '<p><em>Prepared with TM Toolset &middot; ' + new Date().toLocaleDateString('en-GB') + '</em></p>';
  }
  function quoteText() {
    const m = D.iphones.find((x) => x.id === model) || {};
    const scr = screensFor(model)[0] || (D.screenSuppliers || [])[0];
    const bat = (D.batterySuppliers || [])[0];
    const vat = store.settings.includeVat ? 'inc. VAT' : 'ex. VAT';
    return (m.name || 'iPhone') + ' repair quote (fitting included, ' + vat + '):\n' +
      '- Screen replacement: ' + money(scr ? quote(sTrade(model, scr)) : 0) + '\n' +
      '- Battery replacement: ' + money(bat ? quote(bTrade(model, bat)) : 0);
  }

  function renderPhone() {
    const m = D.iphones.find((x) => x.id === model) || D.iphones[0];
    const wrap = el('div', 'parts-view');

    // header card: model + instant prices + actions
    const hc = el('div', 'info-card parts-head');
    const msel = el('select', 'parts-input parts-model');
    D.iphones.forEach((x) => { const o = el('option', null, x.name + ' (' + x.a + ')'); o.value = x.id; if (x.id === model) o.selected = true; msel.appendChild(o); });
    msel.addEventListener('change', () => { model = msel.value; renderBody(); });
    const col1 = el('div', 'parts-head__col');
    col1.appendChild(el('label', 'parts-lbl', 'iPhone model'));
    col1.appendChild(msel);
    col1.appendChild(el('p', 'muted parts-note', 'Native panel: ' + m.panel));
    hc.appendChild(col1);

    const scr = screensFor(model)[0] || (D.screenSuppliers || [])[0];
    const bat = (D.batterySuppliers || [])[0];
    const priceBox = (label, val) => { const b = el('div', 'parts-price'); b.appendChild(el('div', 'parts-price__lbl', label)); b.appendChild(el('div', 'parts-price__val', money(val))); return b; };
    const col2 = el('div', 'parts-head__col parts-head__prices');
    col2.appendChild(priceBox('Screen (customer)', scr ? quote(sTrade(model, scr)) : 0));
    col2.appendChild(priceBox('Battery (customer)', bat ? quote(bTrade(model, bat)) : 0));
    hc.appendChild(col2);

    const col3 = el('div', 'parts-head__col parts-head__actions');
    const copyBtn = el('button', 'btn btn--ghost', 'Copy quote');
    copyBtn.addEventListener('click', () => { try { navigator.clipboard.writeText(quoteText()).then(() => toast('Quote copied.')); } catch (e) { toast('Copy failed.'); } });
    const tkBtn = el('button', 'btn btn--primary', 'Add quote to ticket');
    tkBtn.addEventListener('click', async () => {
      const t = window.activeTicket && window.activeTicket.get();
      if (!t || !t.id) { toast('Set a ticket in the top bar first.'); return; }
      try {
        const r = await window.syncro.postNote({ ticketId: t.id, subject: 'Repair quote', body: quoteHtml(), hidden: true });
        toast(r && r.ok ? ('Quote added to ticket #' + t.number + '.') : ('Syncro: ' + ((r && r.message) || 'failed')));
      } catch (e) { toast('Syncro error.'); }
    });
    col3.appendChild(copyBtn); col3.appendChild(tkBtn);
    hc.appendChild(col3);
    wrap.appendChild(hc);

    // screen gotchas
    wrap.appendChild(gotchaBox('Screen bench notes — ' + m.name + ' (' + m.a + ')', m.screenGotchas));

    // tier toggle + screen cards
    const stoolbar = el('div', 'parts-toolbar');
    const bt1 = el('button', 'btn btn--sm' + (tier === 'preferred' ? ' btn--primary' : ' btn--ghost'), '★ Preferred');
    bt1.addEventListener('click', () => { tier = 'preferred'; renderBody(); });
    const bt2 = el('button', 'btn btn--sm' + (tier === 'all' ? ' btn--primary' : ' btn--ghost'), 'All ' + (D.screenSuppliers || []).length + ' tiers');
    bt2.addEventListener('click', () => { tier = 'all'; renderBody(); });
    stoolbar.appendChild(el('h3', 'parts-h3', 'Screen suppliers'));
    const seg = el('div', 'parts-seg'); seg.appendChild(bt1); seg.appendChild(bt2); stoolbar.appendChild(seg);
    wrap.appendChild(stoolbar);
    const sgrid = el('div', 'parts-grid');
    screensFor(model).forEach((sup) => sgrid.appendChild(partCard('s', model, sup, renderBody)));
    wrap.appendChild(sgrid);

    // battery
    wrap.appendChild(gotchaBox('Battery bench notes — ' + m.name, m.batteryGotchas));
    wrap.appendChild(el('h3', 'parts-h3', 'Battery suppliers'));
    const bgrid = el('div', 'parts-grid');
    (D.batterySuppliers || []).forEach((sup) => bgrid.appendChild(partCard('b', model, sup, renderBody)));
    wrap.appendChild(bgrid);

    // competitor benchmark
    const comp = el('div', 'info-card');
    comp.appendChild(el('h3', 'parts-h3', 'Local competitor screen prices — ' + m.name));
    const cgrid = el('div', 'parts-comp');
    (D.competitors || []).forEach((c) => {
      const cc = el('div', 'parts-comp__cell');
      cc.appendChild(el('div', 'parts-comp__name', c.name));
      cc.appendChild(el('div', 'parts-comp__loc', c.loc));
      cc.appendChild(el('div', 'parts-comp__price', '£' + (c.prices[model] || '—')));
      cgrid.appendChild(cc);
    });
    comp.appendChild(cgrid);
    wrap.appendChild(comp);

    els.body.innerHTML = ''; els.body.appendChild(wrap);
  }

  // ---- laptop view ----
  function lCost(lp) { const k = lp.part; return store.laptopCost[k] != null ? Number(store.laptopCost[k]) : lp.cost; }
  function renderLaptops() {
    const wrap = el('div', 'parts-view');
    const bar = el('div', 'parts-toolbar');
    const search = el('input', 'parts-input parts-search'); search.type = 'search'; search.placeholder = 'Search brand, model, part number or panel'; search.value = lq;
    search.addEventListener('input', () => { lq = search.value; renderLaptopList(list); });
    bar.appendChild(search);
    wrap.appendChild(bar);
    const list = el('div', 'parts-grid'); wrap.appendChild(list);
    els.body.innerHTML = ''; els.body.appendChild(wrap);
    renderLaptopList(list);
  }
  function renderLaptopList(list) {
    const q = lq.trim().toLowerCase();
    const items = (D.laptops || []).filter((lp) => !q || (lp.brand + ' ' + lp.model + ' ' + lp.part + ' ' + lp.panel).toLowerCase().includes(q));
    list.innerHTML = '';
    if (!items.length) { list.appendChild(el('p', 'muted', 'No laptop screens match that.')); return; }
    items.forEach((lp) => {
      const cost = lCost(lp);
      const custom = store.laptopCost[lp.part] != null;
      const card = el('div', 'parts-card');
      card.appendChild(el('span', 'parts-tag', lp.brand));
      card.appendChild(el('h4', 'parts-card__name', lp.model));
      const kv = el('div', 'parts-card__kv');
      const row = (k, v) => { kv.appendChild(el('span', 'parts-card__k', k)); kv.appendChild(el('span', 'parts-card__v', v)); };
      row('Part', lp.part); row('Panel', lp.size + ' · ' + lp.panel); row('Supplier', lp.supplier);
      card.appendChild(kv);
      card.appendChild(gotchaInline(lp.gotchas));
      const foot = el('div', 'parts-card__foot');
      const left = el('div');
      const tradeLine = el('div', 'parts-card__trade');
      tradeLine.appendChild(el('span', 'muted', 'Trade: '));
      tradeLine.appendChild(el('strong', custom ? 'parts-custom' : null, money(cost)));
      const editP = el('button', 'btn btn--ghost btn--sm', custom ? 'Edit ✓' : 'Edit');
      editP.addEventListener('click', () => {
        const v = window.prompt('Trade cost (£) for ' + lp.model + '.\nBlank to reset.', cost.toFixed(2));
        if (v === null) return;
        if (!v.trim()) delete store.laptopCost[lp.part]; else store.laptopCost[lp.part] = parseFloat(v) || 0;
        persist({ laptopCost: store.laptopCost }); renderLaptopList(list);
      });
      tradeLine.appendChild(editP);
      left.appendChild(tradeLine);
      left.appendChild(el('div', 'parts-card__quote', 'Customer: ' + money(quote(cost))));
      foot.appendChild(left);
      const buy = el('button', 'btn btn--primary btn--sm', 'Buy part');
      buy.addEventListener('click', () => openUrl(D.searchUrl[lp.supplier] ? D.searchUrl[lp.supplier](lp.part) : lp.url));
      foot.appendChild(buy);
      card.appendChild(foot);
      list.appendChild(card);
    });
  }
  function gotchaInline(text) { const d = el('div', 'parts-gotcha parts-gotcha--sm'); d.appendChild(el('span', 'parts-gotcha__ico', '⚠')); d.appendChild(el('p', 'muted', text)); return d; }

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
    else renderPhone();
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
