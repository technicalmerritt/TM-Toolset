'use strict';

// "Install agent" in the ticket bar: downloads the technician's Syncro agent
// installer, verifies it is signed by Servably (Syncro), and hands it over to
// run — rather than running it silently (which only unpacked files).
(function () {
  const els = {};
  let busy = false;
  let state = { hasLink: false, installed: false };
  let readyPath = null; // the verified installer on disk

  function $(s) { return document.querySelector(s); }
  function status(msg, kind) {
    els.status.textContent = msg || '';
    els.status.style.color = kind === 'error' ? 'var(--danger)' : kind === 'ok' ? '#7fd6a0' : 'var(--text-dim)';
  }
  function show(el, on) { if (el) el.hidden = !on; }

  async function open() {
    const t = window.activeTicket && window.activeTicket.get();
    if (!t || !t.customerId) return;
    try { state = await window.agent.get(); } catch { state = { hasLink: false, installed: false }; }
    readyPath = null;
    els.target.textContent = 'Customer: ' + (t.customerName || t.customerId) + '   ·   Ticket #' + t.number;
    show(els.warn, state.installed);
    show(els.setup, !state.hasLink);
    if (els.link) els.link.value = '';
    els.go.disabled = false;
    els.go.textContent = 'Download & verify';
    show(els.reveal, false);
    show(els.run, false);
    status(state.hasLink ? 'Downloads your installer from Syncro and checks it is signed by Servably, then you run it.' : 'Paste your installer link once to get started.');
    els.modal.hidden = false;
  }
  function close() { if (!busy) els.modal.hidden = true; }

  async function go() {
    const t = window.activeTicket && window.activeTicket.get();
    if (busy || !t || !t.customerId) return;
    busy = true; els.go.disabled = true; els.cancel.disabled = true;
    const key = 'syncro-agent';
    try {
      if (!state.hasLink) {
        const saved = await window.agent.setLink(els.link.value);
        if (!saved || !saved.ok || saved.cleared) { status((saved && saved.message) || 'Paste the installer link from Syncro.', 'error'); els.go.disabled = false; return; }
        state.hasLink = true; show(els.setup, false);
        refreshSettings();
      }
      status('Starting…');
      window.TMActivity && window.TMActivity.start(key, 'Fetching Syncro agent installer');
      const res = await window.agent.prepare();
      if (res && res.ok) {
        readyPath = res.path;
        status('Downloaded and verified (signed by ' + (res.signer || 'Servably') + '). Saved to your Downloads as Syncro-Agent-Setup.exe. Click Run installer, then follow Syncro’s prompts — or Open folder to run it yourself.', 'ok');
        els.go.textContent = 'Re-download';
        els.go.disabled = false;
        show(els.reveal, true);
        show(els.run, true);
      } else {
        status((res && res.message) || 'Download failed.', 'error');
        els.go.disabled = false;
      }
    } catch (e) {
      status('Failed: ' + ((e && e.message) || e), 'error');
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
    els.status = $('#agentStatus');
    els.go = $('#agentGo');
    els.cancel = $('#agentCancel');
    els.reveal = $('#agentReveal');
    els.run = $('#agentRun');
    els.setLink = $('#agentSetLink');
    els.setSave = $('#agentSetSave');
    els.setClear = $('#agentSetClear');
    els.setStatus = $('#agentSetStatus');
    if (!els.btn || !els.modal || !window.agent) return;

    els.btn.addEventListener('click', open);
    els.go.addEventListener('click', go);
    els.cancel.addEventListener('click', close);
    if (els.reveal) els.reveal.addEventListener('click', () => { if (readyPath) window.agent.reveal(readyPath); });
    if (els.run) els.run.addEventListener('click', async () => {
      if (!readyPath) return;
      const r = await window.agent.run(readyPath);
      if (r && r.ok) status('Installer launched — follow Syncro’s prompts to finish. It can take a minute to appear in Syncro after it checks in.', 'ok');
      else status((r && r.message) || 'Could not launch the installer — use Open folder and run it yourself.', 'error');
    });
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
