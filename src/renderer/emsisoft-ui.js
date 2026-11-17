'use strict';

// Emsisoft deployment UI: the Settings-tab key/defaults card, and the
// "Deploy Emsisoft" popup launched from the ticket bar.
//
// Flow (matches the agreed workflow): pick the ticket in the top bar → click
// Deploy Emsisoft → choose Trial / Monthly / Licence key → confirm (the exact
// licence key that will be spent is shown first) → workspace is created →
// installer links appear (the install token stays hidden behind a reveal, with
// its "never share publicly" warning) → a private note is written to the ticket.

(function () {
  var PRODUCTS = [{ code: 'EBS', label: 'Business Security' }, { code: 'EES', label: 'Enterprise Security' }];
  var defaults = { option: 'coupon', product: 'EBS', seats: 1, logToTicket: true };

  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (Array.isArray(kids) ? kids : (kids == null ? [] : [kids])).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
    });
    return n;
  }
  function fill(node, kids) { node.textContent = ''; (Array.isArray(kids) ? kids : [kids]).forEach(function (c) { if (c != null && c !== false) node.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c))); }); }

  function toast(message, kind) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.className = 'toast toast--show' + (kind === 'error' ? ' toast--error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, 3200);
  }

  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d)) return String(v);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function productLabel(code) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].code === code) return PRODUCTS[i].label;
    return code || '';
  }
  function licenceLabel(l) {
    var bits = [];
    if (l.product) bits.push(l.product);
    if (l.seats != null) bits.push(l.seats + (l.seats === 1 ? ' seat' : ' seats'));
    if (l.months != null) bits.push(l.months + ' mo');
    if (l.expiry) bits.push('expires ' + fmtDate(l.expiry));
    var label = bits.join(' · ');
    return (label ? label + '  —  ' : '') + l.key;
  }

  // ───────────────────────── Settings card ─────────────────────────
  function initSettings() {
    var key = $('#emsKey'), save = $('#emsSave'), test = $('#emsTest'), st = $('#emsStatus');
    if (!key) return;
    var defOption = $('#emsDefOption'), defProduct = $('#emsDefProduct'), defSeats = $('#emsDefSeats'), defLog = $('#emsDefLog'), defSt = $('#emsDefStatus');

    function setStatus(node, msg, kind) { if (!node) return; node.textContent = msg || ''; node.style.color = kind === 'error' ? 'var(--danger)' : kind === 'ok' ? '#7fd6a0' : 'var(--text-dim)'; }

    // Populate product dropdown.
    function fillProducts(sel, chosen) {
      if (!sel) return;
      sel.innerHTML = '';
      PRODUCTS.forEach(function (p) { sel.appendChild(el('option', { value: p.code, text: p.code + ' — ' + p.label })); });
      if (chosen) sel.value = chosen;
    }

    async function loadProducts() {
      try { var r = await window.emsisoft.products(); if (r && r.ok && Array.isArray(r.products) && r.products.length) PRODUCTS = r.products; } catch (e) { /* keep fallback */ }
      fillProducts(defProduct, defaults.product);
    }

    async function refresh() {
      try {
        var s = await window.emsisoft.get();
        key.placeholder = s && s.hasKey ? '•••••••• (saved — leave blank to keep)' : 'Paste your Emsisoft API key';
        defaults = (s && s.defaults) || defaults;
        if (defOption) defOption.value = defaults.option;
        if (defProduct) defProduct.value = defaults.product;
        if (defSeats) defSeats.value = defaults.seats;
        if (defLog) defLog.checked = defaults.logToTicket !== false;
      } catch (e) { /* ignore */ }
    }

    save.addEventListener('click', async function () {
      var payload = {};
      if (key.value) payload.key = key.value;
      if (!key.value) { setStatus(st, 'Enter the API key to save (or it is already saved).', 'error'); return; }
      try { await window.emsisoft.save(payload); key.value = ''; await refresh(); setStatus(st, 'Saved.', 'ok'); }
      catch (e) { setStatus(st, 'Could not save: ' + ((e && e.message) || e), 'error'); }
    });
    test.addEventListener('click', async function () {
      setStatus(st, 'Testing…');
      var payload = {}; if (key.value) payload.key = key.value;
      try { var res = await window.emsisoft.test(payload); setStatus(st, res.message, res.ok ? 'ok' : 'error'); }
      catch (e) { setStatus(st, 'Test failed: ' + ((e && e.message) || e), 'error'); }
    });

    async function saveDefaults() {
      var d = {
        option: defOption ? defOption.value : defaults.option,
        product: defProduct ? defProduct.value : defaults.product,
        seats: defSeats ? parseInt(defSeats.value, 10) || 1 : defaults.seats,
        logToTicket: defLog ? defLog.checked : defaults.logToTicket,
      };
      try { var r = await window.emsisoft.save({ defaults: d }); defaults = (r && r.defaults) || d; setStatus(defSt, 'Defaults saved.', 'ok'); setTimeout(function () { setStatus(defSt, ''); }, 1500); }
      catch (e) { setStatus(defSt, 'Could not save defaults.', 'error'); }
    }
    [defOption, defProduct, defSeats, defLog].forEach(function (c) { if (c) c.addEventListener('change', saveDefaults); });

    loadProducts();
    refresh();
  }

  // ───────────────────────── Deploy modal ─────────────────────────
  var modal, body, titleEl;
  var ctx = null;

  function openModal() { if (modal) { modal.hidden = false; } }
  function closeModal() { if (modal) { modal.hidden = true; } ctx = null; }

  function goSettings() {
    closeModal();
    var tab = document.querySelector('.tab[data-tab="settings"]');
    if (tab) tab.click();
  }

  function stepConfigMissing() {
    titleEl.textContent = 'Deploy Emsisoft';
    fill(body, [
      el('p', { class: 'muted', text: 'Emsisoft isn’t set up yet. Add your Emsisoft partner API key in Settings, then come back and deploy.' }),
      el('div', { class: 'modal__actions' }, [
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', onclick: closeModal }),
        el('button', { class: 'btn btn--primary', type: 'button', text: 'Open Settings', onclick: goSettings }),
      ]),
    ]);
  }

  function productSelect(id, chosen) {
    var sel = el('select', { id: id, class: 'ems-select' });
    PRODUCTS.forEach(function (p) { sel.appendChild(el('option', { value: p.code, text: p.code + ' — ' + p.label })); });
    sel.value = chosen || (PRODUCTS[0] && PRODUCTS[0].code) || 'EBS';
    return sel;
  }

  function stepForm() {
    titleEl.textContent = 'Deploy Emsisoft';
    var t = ctx.ticket;
    var option = ctx.option || defaults.option;

    // option segmented control
    var seg = el('div', { class: 'ems-seg' });
    [['coupon', 'Licence key'], ['msp', 'Monthly'], ['trial', 'Trial']].forEach(function (o) {
      seg.appendChild(el('button', {
        type: 'button', 'data-opt': o[0], text: o[1],
        'aria-pressed': String(option === o[0]),
        onclick: function () { ctx.option = o[0]; stepForm(); },
      }));
    });

    // dynamic licence area
    var area = el('div', { class: 'ems-area' });
    if (option === 'coupon') {
      var sel = el('select', { id: 'emsLicSel', class: 'ems-select' });
      sel.appendChild(el('option', { value: '', text: 'Loading your unused licences…' }));
      area.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Licence to use' }), sel]));
      var hint = el('p', { class: 'muted ems-hint' });
      area.appendChild(hint);
      window.emsisoft.listLicences({}).then(function (r) {
        if (!r || !r.ok) { sel.innerHTML = ''; sel.appendChild(el('option', { value: '', text: '(couldn’t load — see below)' })); hint.textContent = (r && r.message) || 'Could not load licences.'; return; }
        ctx.licences = r.licences || [];
        sel.innerHTML = '';
        if (!ctx.licences.length) { sel.appendChild(el('option', { value: '', text: 'No unused licences available' })); hint.textContent = 'No unused licence coupons found. Add licences in MyEmsisoft, or use Monthly / Trial instead.'; return; }
        ctx.licences.forEach(function (l, i) { sel.appendChild(el('option', { value: String(i), text: licenceLabel(l) })); });
        sel.value = '0';
        hint.textContent = 'This key is spent permanently when you deploy.';
      }, function () { sel.innerHTML = ''; sel.appendChild(el('option', { value: '', text: '(error loading licences)' })); });
    } else if (option === 'msp') {
      area.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Product' }), productSelect('emsProd', ctx.product || defaults.product)]));
      area.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Seats (monthly billing)' }), el('input', { id: 'emsSeats', type: 'number', min: '1', value: String(ctx.seats || defaults.seats || 1) })]));
      area.appendChild(el('p', { class: 'muted ems-hint', text: 'Adds the workspace to your monthly MSP billing plan.' }));
    } else { // trial
      area.appendChild(el('label', { class: 'field' }, [el('span', { text: 'Product' }), productSelect('emsProd', ctx.product || defaults.product)]));
      area.appendChild(el('p', { class: 'muted ems-hint', text: 'Starts a trial — no licence is used.' }));
    }

    fill(body, [
      el('label', { class: 'field' }, [el('span', { text: 'Workspace name' }), el('input', { id: 'emsName', type: 'text', value: ctx.name != null ? ctx.name : (t.customerName || '') })]),
      el('label', { class: 'field' }, [el('span', { text: 'Customer email (invite)' }), el('input', { id: 'emsEmail', type: 'email', value: ctx.email || '', placeholder: ctx.emailLoading ? 'Looking up from Syncro…' : 'name@example.com' })]),
      el('div', { class: 'field' }, [el('span', { class: 'ems-lbl', text: 'Licence' }), seg]),
      area,
      el('div', { class: 'modal__actions' }, [
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Cancel', onclick: closeModal }),
        el('button', { class: 'btn btn--primary', type: 'button', text: 'Continue', onclick: collectAndConfirm }),
      ]),
    ]);

    // Pre-fill email from Syncro once.
    if (ctx.email == null && !ctx.emailTried && t.customerId && window.syncro && window.syncro.getCustomer) {
      ctx.emailTried = true;
      window.syncro.getCustomer({ customerId: t.customerId }).then(function (r) {
        if (r && r.ok && r.customer && r.customer.email) { var inp = $('#emsEmail'); if (inp && !inp.value) inp.value = r.customer.email; ctx.email = r.customer.email; }
      }, function () { /* ignore */ });
    }
  }

  function collectAndConfirm() {
    var name = ($('#emsName') && $('#emsName').value || '').trim();
    var email = ($('#emsEmail') && $('#emsEmail').value || '').trim();
    ctx.name = name; ctx.email = email;
    var option = ctx.option || defaults.option;
    if (!name) { toast('Enter a workspace name.', 'error'); return; }

    var licence, summary, warn = '';
    if (option === 'coupon') {
      var sel = $('#emsLicSel');
      var idx = sel ? parseInt(sel.value, 10) : NaN;
      if (!(ctx.licences && ctx.licences[idx])) { toast('Select a licence key.', 'error'); return; }
      var l = ctx.licences[idx];
      licence = { type: 'coupon', coupon: l.key, product: l.product };
      summary = 'Assign licence key ' + l.key + (l.product ? ' (' + l.product + ')' : '') + '.';
      warn = 'This permanently spends licence key ' + l.key + '.';
    } else if (option === 'msp') {
      var prod = $('#emsProd') ? $('#emsProd').value : defaults.product;
      var seats = parseInt($('#emsSeats') ? $('#emsSeats').value : defaults.seats, 10);
      if (!(seats > 0)) { toast('Enter a seat count.', 'error'); return; }
      ctx.product = prod; ctx.seats = seats;
      licence = { type: 'msp', product: prod, seats: seats };
      summary = 'Add to monthly MSP billing: ' + seats + ' seat' + (seats === 1 ? '' : 's') + ' of ' + prod + ' — ' + productLabel(prod) + '.';
      warn = 'This starts recurring monthly billing for ' + seats + ' seat' + (seats === 1 ? '' : 's') + '.';
    } else {
      var tprod = $('#emsProd') ? $('#emsProd').value : defaults.product;
      ctx.product = tprod;
      licence = { type: 'trial', product: tprod };
      summary = 'Start a trial of ' + tprod + ' — ' + productLabel(tprod) + '. No licence used.';
    }
    ctx.licence = licence;
    stepConfirm(summary, warn);
  }

  function stepConfirm(summary, warn) {
    titleEl.textContent = 'Confirm deploy';
    fill(body, [
      el('div', { class: 'ems-confirm' }, [
        el('p', {}, [el('strong', { text: 'Create workspace “' + ctx.name + '”' }), ctx.email ? (' and invite ' + ctx.email) : '', '.']),
        el('p', { text: summary }),
        warn ? el('p', { class: 'ems-warn', text: '⚠ ' + warn }) : null,
      ]),
      el('div', { class: 'modal__actions' }, [
        el('button', { class: 'btn btn--ghost', type: 'button', text: 'Back', onclick: stepForm }),
        el('button', { class: 'btn btn--primary', type: 'button', text: 'Deploy now', onclick: runDeploy }),
      ]),
    ]);
  }

  function runDeploy() {
    titleEl.textContent = 'Deploying…';
    fill(body, [el('p', { class: 'muted', text: 'Creating the workspace and fetching installer links…' })]);
    window.emsisoft.deploy({ name: ctx.name, customerEmail: ctx.email, licence: ctx.licence }).then(stepResult, function (e) {
      stepResult({ ok: false, message: (e && e.message) || String(e) });
    });
  }

  function copyBtn(text) {
    var b = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Copy' });
    b.addEventListener('click', function () { try { navigator.clipboard.writeText(text).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1400); }); } catch (e) { b.textContent = '—'; } });
    return b;
  }
  function linkRow(label, url) {
    if (!url) return null;
    return el('div', { class: 'ems-link' }, [
      el('div', { class: 'ems-link__l' }, [el('strong', { text: label }), el('div', { class: 'ems-link__url', text: url })]),
      el('div', { class: 'ems-link__b' }, [copyBtn(url), el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Open', onclick: function () { if (window.sys && window.sys.openUrl) window.sys.openUrl(url); } })]),
    ]);
  }
  // Small collapsible "what the deploy actually did" footer, for diagnosing.
  function traceEl(res) {
    if (!res || !res.trace || !res.trace.length) return null;
    var d = el('details', { class: 'ems-trace' });
    d.appendChild(el('summary', { text: 'Technical detail' }));
    res.trace.forEach(function (line) { d.appendChild(el('div', { class: 'ems-trace__l', text: line })); });
    return d;
  }

  function stepResult(res) {
    if (!res || !res.ok) {
      titleEl.textContent = 'Deploy failed';
      fill(body, [
        el('p', { class: 'ems-warn', text: (res && res.message) || 'Something went wrong.' }),
        traceEl(res),
        el('div', { class: 'modal__actions' }, [
          el('button', { class: 'btn btn--ghost', type: 'button', text: 'Close', onclick: closeModal }),
          el('button', { class: 'btn btn--primary', type: 'button', text: 'Back', onclick: stepForm }),
        ]),
      ]);
      return;
    }
    titleEl.textContent = 'Emsisoft deployed';
    var links = res.links || {};
    var kids = [el('p', {}, [el('strong', { text: 'Workspace “' + (res.name || ctx.name) + '” created.' })])];

    if (res.links) {
      kids.push(el('div', { class: 'ems-links' }, [
        linkRow('Installer (web, recommended)', links.downloadUrl),
        linkRow('Installer (web, full offline)', links.downloadUrlFull),
        linkRow('Direct download', links.downloadUrlDirect),
        linkRow('Direct download (full offline)', links.downloadUrlDirectFull),
        linkRow('macOS (Apple silicon)', links.downloadUrlMacOsArm),
        linkRow('macOS (Intel)', links.downloadUrlMacOsX64),
      ]));
      if (links.installToken) {
        var tokRow = el('div', { class: 'ems-token' });
        var revealed = false;
        var tokVal = el('code', { class: 'ems-token__val', text: '•••••• hidden' });
        var revealBtn = el('button', { class: 'btn btn--ghost btn--sm', type: 'button', text: 'Reveal install token' });
        revealBtn.addEventListener('click', function () { revealed = !revealed; tokVal.textContent = revealed ? links.installToken : '•••••• hidden'; revealBtn.textContent = revealed ? 'Hide token' : 'Reveal install token'; });
        tokRow.appendChild(el('p', { class: 'muted ems-hint', text: 'Install token — activates software against your licence with no login. Never share it publicly.' }));
        tokRow.appendChild(el('div', { class: 'ems-token__row' }, [tokVal, revealBtn, copyBtn(links.installToken)]));
        tokRow.appendChild(el('p', { class: 'muted ems-hint', text: links.tokenExpiration ? ('Token expires ' + fmtDate(links.tokenExpiration) + '.') : 'Token does not expire.' }));
        kids.push(tokRow);
      }
    } else if (res.message) {
      kids.push(el('p', { class: 'muted', text: res.message }));
    }

    // Syncro note status line.
    var noteStatus = el('p', { class: 'info-line' });
    kids.push(noteStatus);
    kids.push(traceEl(res));

    kids.push(el('div', { class: 'modal__actions' }, [
      ctx.ticket && ctx.ticket.id ? el('button', { class: 'btn btn--ghost', type: 'button', text: 'Log to ticket #' + ctx.ticket.number, onclick: function () { postNote(res, noteStatus, true); } }) : null,
      el('button', { class: 'btn btn--primary', type: 'button', text: 'Done', onclick: closeModal }),
    ]));

    fill(body, kids);

    // Auto-post the private note once if the default is on and a ticket is active.
    if (defaults.logToTicket !== false && ctx.ticket && ctx.ticket.id && !ctx.noted) postNote(res, noteStatus, false);
  }

  function noteBody(res) {
    var e = esc, when = new Date().toLocaleString();
    var lic = ctx.licence || {};
    var licLine = lic.type === 'coupon' ? ('Licence key ' + (lic.coupon || '')) : lic.type === 'msp' ? ('Monthly MSP — ' + lic.seats + ' seat(s) of ' + (lic.product || '')) : ('Trial of ' + (lic.product || ''));
    var out = ['<p><strong>Emsisoft deployed</strong> &mdash; ' + e(when) + '</p>'];
    out.push('<p>Workspace: <strong>' + e(res.name || ctx.name) + '</strong></p>');
    out.push('<p>Licence: ' + e(licLine) + '</p>');
    if (res.links && res.links.downloadUrl) out.push('<p>Installer: ' + e(res.links.downloadUrl) + '</p>');
    out.push('<p><em>Deployed via TM Toolset. This note is private — the installer link above carries an activation token; keep it internal.</em></p>');
    return out.join('\n');
  }
  function postNote(res, statusNode, manual) {
    if (!(window.syncro && window.syncro.postNote && ctx.ticket && ctx.ticket.id)) return;
    ctx.noted = true;
    statusNode.textContent = 'Writing note to ticket #' + ctx.ticket.number + '…';
    statusNode.style.color = 'var(--text-dim)';
    window.syncro.postNote({ ticketId: ctx.ticket.id, subject: 'Emsisoft deployed', body: noteBody(res), hidden: true }).then(function (r) {
      if (r && r.ok) { statusNode.textContent = '✓ Private note added to ticket #' + ctx.ticket.number + '.'; statusNode.style.color = '#7fd6a0'; }
      else { statusNode.textContent = 'Couldn’t add the note: ' + ((r && r.message) || 'unknown error'); statusNode.style.color = 'var(--danger)'; ctx.noted = false; }
    }, function (e) { statusNode.textContent = 'Couldn’t add the note: ' + ((e && e.message) || e); statusNode.style.color = 'var(--danger)'; ctx.noted = false; });
  }

  async function open() {
    var ticket = window.activeTicket && window.activeTicket.get ? window.activeTicket.get() : null;
    if (!ticket) { toast('Pick a ticket first.', 'error'); return; }
    ctx = { ticket: ticket, option: defaults.option, name: null, email: null };
    openModal();
    titleEl.textContent = 'Deploy Emsisoft';
    fill(body, [el('p', { class: 'muted', text: 'Checking Emsisoft setup…' })]);
    try {
      var s = await window.emsisoft.get();
      if (s && s.defaults) defaults = s.defaults;
      try { var pr = await window.emsisoft.products(); if (pr && pr.ok && pr.products && pr.products.length) PRODUCTS = pr.products; } catch (e2) { /* keep fallback */ }
      ctx.option = defaults.option;
      if (!s || !s.hasKey) { stepConfigMissing(); return; }
      stepForm();
    } catch (e) { stepConfigMissing(); }
  }

  window.addEventListener('DOMContentLoaded', function () {
    initSettings();
    modal = $('#emsModal'); body = $('#emsBody'); titleEl = $('#emsTitle');
    var close = $('#emsClose'); if (close) close.addEventListener('click', closeModal);
    if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && modal && !modal.hidden) closeModal(); });
    var btn = $('#ticketDeployEms'); if (btn) btn.addEventListener('click', open);
  });
})();
