'use strict';

// Shared helper so every diagnostic tab can post its findings to the active
// Syncro ticket as a private note. Uses the app's own Syncro token (Settings).
(function () {
  function toast(msg, kind) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast toast--show' + (kind === 'error' ? ' toast--error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 3600);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  window.tmEsc = esc;

  // subject: ticket comment subject; html: comment body (HTML)
  window.tmSyncroPost = async function (btn, subject, html) {
    const t = window.activeTicket && window.activeTicket.get();
    if (!t) { toast('Load a ticket number in the bar up top first.', 'error'); return; }
    if (!html) { toast('Nothing to send yet — run this tab first.', 'error'); return; }
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    try {
      const res = await window.syncro.postNote({ ticketId: t.id, subject, body: html, hidden: true });
      if (res && res.ok) toast('Posted to ticket #' + t.number + ' as a private note.');
      else toast('Syncro: ' + ((res && res.message) || 'failed'), 'error');
    } catch (e) {
      toast('Syncro error: ' + ((e && e.message) || e), 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  };
})();
