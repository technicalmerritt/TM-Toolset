'use strict';

// Global "active ticket" held in the top bar. Other views (scanner, information)
// read it via window.activeTicket and act on the resolved customer/ticket.

(function () {
  let current = null; // { id, number, subject, customerId, customerName }
  const subs = [];
  const els = {};

  function $(s) {
    return document.querySelector(s);
  }

  function toast(message, kind) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.className = 'toast toast--show' + (kind === 'error' ? ' toast--error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 3000);
  }

  function notify() {
    for (const cb of subs) {
      try { cb(current); } catch { /* ignore */ }
    }
  }

  function render() {
    if (!els.form) return;
    if (current) {
      els.form.hidden = true;
      els.info.hidden = false;
      els.cust.textContent = current.customerName || 'Customer';
      els.subj.textContent = `#${current.number}${current.subject ? ' · ' + current.subject : ''}`;
    } else {
      els.info.hidden = true;
      els.form.hidden = false;
    }
  }

  async function lookup(num) {
    if (!(window.syncro && window.syncro.lookup)) return;
    els.input.disabled = true;
    try {
      const res = await window.syncro.lookup({ number: num });
      if (res && res.ok) {
        current = res.ticket;
        render();
        notify();
        toast(`Ticket #${current.number} — ${current.customerName}`);
      } else {
        toast((res && res.message) || 'Ticket not found.', 'error');
      }
    } catch (e) {
      toast('Lookup failed: ' + ((e && e.message) || e), 'error');
    } finally {
      els.input.disabled = false;
    }
  }

  function setTicket(t) {
    current = t;
    render();
    notify();
    closePicker();
    toast(`Ticket #${current.number} — ${current.customerName}`);
  }

  function clear() {
    current = null;
    if (els.input) els.input.value = '';
    render();
    notify();
    if (els.input) els.input.focus();
  }

  // ---- Live-ticket picker (pick instead of typing a number) ----
  let allTickets = [];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function renderPickList(list) {
    if (!els.pickList) return;
    if (!list.length) { els.pickList.innerHTML = '<div class="ticket__pickempty">No live tickets.</div>'; return; }
    els.pickList.innerHTML = list.map((t) => `<button class="ticket__pickitem" type="button" data-i="${allTickets.indexOf(t)}"><strong>#${esc(t.number)}</strong> ${esc(t.customerName)}<span class="ticket__picksub">${esc(t.subject)}${t.status ? ' · ' + esc(t.status) : ''}</span></button>`).join('');
    els.pickList.querySelectorAll('.ticket__pickitem').forEach((b) => b.addEventListener('click', () => { const t = allTickets[+b.dataset.i]; if (t) setTicket(t); }));
  }
  function filterPick() {
    const q = (els.pickFilter.value || '').trim().toLowerCase();
    if (!q) return renderPickList(allTickets);
    renderPickList(allTickets.filter((t) => (('#' + t.number + ' ' + t.customerName + ' ' + t.subject + ' ' + t.status).toLowerCase()).includes(q)));
  }
  async function openPicker() {
    if (!(window.syncro && window.syncro.listTickets)) { toast('Configure Syncro in Settings first.', 'error'); return; }
    els.picker.hidden = false;
    els.pickList.innerHTML = '<div class="ticket__pickempty">Loading live tickets…</div>';
    if (els.pickFilter) { els.pickFilter.value = ''; els.pickFilter.focus(); }
    try {
      const res = await window.syncro.listTickets({ limit: 50 });
      if (!res || !res.ok) { els.pickList.innerHTML = '<div class="ticket__pickempty">' + esc((res && res.message) || 'Could not load tickets.') + '</div>'; return; }
      allTickets = res.tickets || [];
      if (!allTickets.length) { els.pickList.innerHTML = '<div class="ticket__pickempty">No live (unresolved) tickets.</div>'; return; }
      renderPickList(allTickets);
    } catch (e) { els.pickList.innerHTML = '<div class="ticket__pickempty">Error: ' + esc((e && e.message) || e) + '</div>'; }
  }
  function closePicker() { if (els.picker) els.picker.hidden = true; }

  window.activeTicket = {
    get: () => current,
    clear,
    onChange: (cb) => {
      subs.push(cb);
      try { cb(current); } catch { /* ignore */ }
    },
  };

  window.addEventListener('DOMContentLoaded', () => {
    els.form = $('#ticketForm');
    els.input = $('#ticketInput');
    els.info = $('#ticketInfo');
    els.cust = $('#ticketCustomer');
    els.subj = $('#ticketSubject');
    els.clear = $('#ticketClear');
    els.pickBtn = $('#ticketPickBtn');
    els.picker = $('#ticketPicker');
    els.pickFilter = $('#ticketPickFilter');
    els.pickList = $('#ticketPickList');
    if (!els.form) return;

    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = (els.input.value || '').trim().replace(/^#/, '');
      if (/^\d+$/.test(n)) lookup(n);
      else toast('Enter a numeric ticket number.', 'error');
    });
    els.clear.addEventListener('click', clear);
    if (els.pickBtn) els.pickBtn.addEventListener('click', (e) => { e.stopPropagation(); if (els.picker.hidden) openPicker(); else closePicker(); });
    if (els.pickFilter) els.pickFilter.addEventListener('input', filterPick);
    // close the picker when clicking elsewhere
    document.addEventListener('click', (e) => { if (els.picker && !els.picker.hidden && !els.picker.contains(e.target) && e.target !== els.pickBtn) closePicker(); });
    render();
  });
})();
