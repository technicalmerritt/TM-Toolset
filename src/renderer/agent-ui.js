'use strict';

// "Install agent" in the ticket bar: installs the technician's Syncro RMM agent
// on this PC under the active ticket's customer.
(function () {
  const els = {};
  let busy = false;
  let state = { hasLink: false, installed: false, folders: {} };

  function $(s) { return document.querySelector(s); }
  function status(msg, kind) {
    els.status.textContent = msg || '';
    els.status.style.color = kind === 'error' ? 'var(--danger)' : kind === 'ok' ? '#7fd6a0' : 'var(--text-dim)';
  }

  async function open() {
    const t = window.activeTicket && window.activeTicket.get();
    if (!t || !t.customerId) return;
    try { state = await window.agent.get(); } catch { state = { hasLink: false, installed: false, folders: {} }; }
    els.target.textContent = 'Customer: ' + (t.customerName || t.customerId) + '   ·   Ticket #' + t.number;
    els.warn.hidden = !state.installed;
    els.setup.hidden = !!state.hasLink;
    els.link.value = '';
    els.folder.value = (state.folders && state.folders[String(t.customerId)]) || '';
    els.go.disabled = false;
    els.go.textContent = 'Install agent';
    status(state.hasLink ? 'Downloads your installer from Syncro, checks it is signed, then installs it for this customer.' : 'Paste your installer link once to get started.');
    els.modal.hidden = false;
  }
  function close() { if (!busy) els.modal.hidden = true; }

  async function go() {
    const t = window.activeTicket && window.activeTicket.get();
    if (busy || !t || !t.customerId) return;
    const folder = (els.folder.value || '').trim();
    if (folder && !/^\d+$/.test(folder)) { status('Policy folder ID must be a number.', 'error'); return; }
    busy = true; els.go.disabled = true; els.cancel.disabled = true;
    const key = 'syncro-agent';
    try {
      if (!state.hasLink) {
        const saved = await window.agent.setLink(els.link.value);
        if (!saved || !saved.ok || saved.cleared) { status((saved && saved.message) || 'Paste the installer link from Syncro.', 'error'); els.go.disabled = false; return; }
        state.hasLink = true; els.setup.hidden = true;
        refreshSettings();
      }
      status('Starting…');
      window.TMActivity && window.TMActivity.start(key, 'Installing Syncro agent');
      const res = await window.agent.install({ ticket: t, folderId: folder, note: els.note.checked });
      if (res && res.ok) {
        status((res.installed ? 'Installed for ' : 'The installer finished for ') + (t.customerName || 'this customer') + '.' +
          (res.installed ? '' : ' The agent was not detected yet - give it a minute.') +
          ' Check in Syncro that this PC appears under the right customer.' + (res.noted ? ' Note added to ticket #' + t.number + '.' : ''), 'ok');
        els.go.textContent = 'Done';
      } else {
        status((res && res.message) || 'Install failed.', 'error');
        els.go.disabled = false;
      }
    } catch (e) {
      status('Install failed: ' + ((e && e.message) || e), 'error');
      els.go.disabled = false;
    } finally {
      window.TMActivity && window.TMActivity.end(key);
      busy = false; els.cancel.disabled = false;
    }
  }

  async function refreshSettings() {
    if (!els.setLink) return;
    try {
      const s = await window.agent.get();
      els.setLink.value = '';
      els.setLink.placeholder = s.hasLink ? 'Saved (' + s.host + ') - paste a new link to replace it' : 'https://rmm.syncromsp.com/dl/rs/…';
    } catch { /* ignore */ }
  }
  function setStatus(msg, ok) { els.setStatus.textContent = msg || ''; els.setStatus.style.color = ok ? '#7fd6a0' : 'var(--danger)'; }

  window.addEventListener('DOMContentLoaded', () => {
    els.btn = $('#ticketAgent');
    els.modal = $('#agentModal');
    els.target = $('#agentTarget');
    els.warn = $('#agentWarn');
    els.setup = $('#agentSetup');
    els.link = $('#agentLink');
    els.folder = $('#agentFolder');
    els.note = $('#agentNote');
    els.status = $('#agentStatus');
    els.go = $('#agentGo');
    els.cancel = $('#agentCancel');
    els.setLink = $('#agentSetLink');
    els.setSave = $('#agentSetSave');
    els.setClear = $('#agentSetClear');
    els.setStatus = $('#agentSetStatus');
    if (!els.btn || !els.modal || !window.agent) return;

    els.btn.addEventListener('click', open);
    els.go.addEventListener('click', go);
    els.cancel.addEventListener('click', close);
    els.modal.addEventListener('click', (e) => { if (e.target === els.modal) close(); });
    if (window.agent.onProgress) window.agent.onProgress((msg) => { if (busy) status(String(msg || '')); });

    if (els.setSave) {
      els.setSave.addEventListener('click', async () => {
        const r = await window.agent.setLink(els.setLink.value);
        if (r && r.ok && !r.cleared) { setStatus('Saved.', true); refreshSettings(); }
        else setStatus((r && r.message) || 'Paste the installer link from Syncro.', false);
      });
      els.setClear.addEventListener('click', async () => { await window.agent.setLink(''); setStatus('Removed.', true); refreshSettings(); });
      refreshSettings();
    }
  });
})();
