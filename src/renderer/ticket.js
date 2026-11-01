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

  function clear() {
    current = null;
    if (els.input) els.input.value = '';
    render();
    notify();
    if (els.input) els.input.focus();
  }

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
    if (!els.form) return;

    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = (els.input.value || '').trim().replace(/^#/, '');
      if (/^\d+$/.test(n)) lookup(n);
      else toast('Enter a numeric ticket number.', 'error');
    });
    els.clear.addEventListener('click', clear);
    render();
  });
})();
