'use strict';

(function () {
  const els = {};

  function $(s) {
    return document.querySelector(s);
  }

  function status(msg, kind) {
    if (!els.status) return;
    els.status.textContent = msg || '';
    els.status.style.color = kind === 'error' ? 'var(--danger)' : kind === 'ok' ? '#7fd6a0' : 'var(--text-dim)';
  }

  async function refresh() {
    try {
      const s = await window.settings.get();
      els.subdomain.value = s.subdomain || '';
      els.token.placeholder = s.hasToken ? '•••••••• (saved — leave blank to keep)' : 'Paste a Syncro API token';
    } catch {
      /* ignore */
    }
  }

  async function save() {
    const payload = { subdomain: els.subdomain.value };
    if (els.token.value) payload.token = els.token.value;
    try {
      await window.settings.save(payload);
      els.token.value = '';
      await refresh();
      status('Saved.', 'ok');
    } catch (e) {
      status('Could not save: ' + ((e && e.message) || e), 'error');
    }
  }

  async function test() {
    status('Testing…');
    const payload = { subdomain: els.subdomain.value };
    if (els.token.value) payload.token = els.token.value;
    try {
      const res = await window.settings.test(payload);
      status(res.message, res.ok ? 'ok' : 'error');
    } catch (e) {
      status('Test failed: ' + ((e && e.message) || e), 'error');
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.subdomain = $('#setSubdomain');
    els.token = $('#setToken');
    els.save = $('#setSave');
    els.test = $('#setTest');
    els.status = $('#setStatus');
    if (!els.subdomain) return;

    els.save.addEventListener('click', save);
    els.test.addEventListener('click', test);
    refresh();
  });
})();
