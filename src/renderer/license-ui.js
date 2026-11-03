'use strict';

// Licence gate + trial banner + Settings licence card.
// Per-user model: a licence is tied to an e-mail and works on every machine the
// technician uses. The gate only *blocks* when the app is genuinely unusable
// (trial over / expired / invalid). While on trial or licensed, it can be
// opened for a look and dismissed again - no dead ends.
(function () {
  const els = {};
  let blocking = false; // true only when the app may not be used without a key
  function $(s) { return document.querySelector(s); }
  function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('toast--show'); setTimeout(() => t.classList.remove('toast--show'), 3200); }

  function showGate(msg, isBlocking) {
    blocking = !!isBlocking;
    els.gate.hidden = false;
    els.gateMsg.textContent = msg || 'Enter your licence key to activate.';
    els.gateErr.textContent = '';
    // Dismiss controls appear only when the app is still usable.
    if (els.x) els.x.hidden = blocking;
    if (els.back) els.back.hidden = blocking;
    els.gate.classList.toggle('lic-gate--blocking', blocking);
    setTimeout(() => { try { (els.email.value ? els.key : els.email).focus(); } catch { /* ignore */ } }, 50);
  }
  function hideGate() { els.gate.hidden = true; blocking = false; }
  // Only let the user close the gate when it isn't blocking.
  function tryClose() { if (!blocking) hideGate(); }

  function refresh() {
    if (!window.license) return;
    window.license.status().then((s) => {
      if (!s) return;
      const mid = s.machineId || '';
      if (els.mid) els.mid.textContent = mid;
      if (els.setMid) els.setMid.textContent = mid;
      // Settings status line
      if (els.setLine) {
        if (s.state === 'licensed') {
          const seats = s.seats ? (' - up to ' + s.seats + ' machine' + (s.seats === 1 ? '' : 's')) : '';
          els.setLine.textContent = 'Licensed to ' + (s.email || s.name || 'you') + (s.expires ? (' - expires ' + s.expires) : ' - perpetual') + seats + '.';
        } else if (s.state === 'trial') els.setLine.textContent = 'Trial - ' + s.daysLeft + ' day(s) left. Full functionality.';
        else els.setLine.textContent = (s.reason || 'Not licensed') + ' - activate below.';
      }
      if (els.setEmail && s.email && !els.setEmail.value) els.setEmail.value = s.email;
      // Gate + banner
      if (s.state === 'licensed') { hideGate(); els.banner.hidden = true; }
      else if (s.state === 'trial') {
        // Don't yank a gate the user opened on purpose; just keep the banner.
        els.banner.hidden = false;
        els.bannerText.textContent = 'Trial - ' + s.daysLeft + ' day' + (s.daysLeft === 1 ? '' : 's') + ' left.';
      } else {
        // App unusable: block until a valid key is entered.
        els.banner.hidden = true;
        showGate(s.reason || 'Your trial has ended. Enter a licence key to continue.', true);
      }
    }).catch(() => {});
  }

  function activate(key, email, errEl, after) {
    const k = (key || '').trim();
    if (!k) { if (errEl) errEl.textContent = 'Paste a licence key first.'; return; }
    window.license.activate(k, (email || '').trim()).then((r) => {
      if (r && r.ok) { toast('Licence activated - thank you!'); if (errEl) errEl.textContent = ''; refresh(); if (after) after(); }
      else if (errEl) errEl.textContent = (r && r.reason) || 'Activation failed.';
    }).catch(() => { if (errEl) errEl.textContent = 'Activation failed.'; });
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.gate = $('#licenseGate'); els.gateMsg = $('#licGateMsg'); els.gateErr = $('#licGateErr');
    els.key = $('#licKey'); els.email = $('#licEmail'); els.mid = $('#licMid');
    els.x = $('#licGateClose'); els.back = $('#licGateBack');
    els.banner = $('#licBanner'); els.bannerText = $('#licBannerText');
    els.setLine = $('#licStatusLine'); els.setKey = $('#licSetKey'); els.setEmail = $('#licSetEmail'); els.setMid = $('#licSetMid'); els.setStatus = $('#licSetStatus');
    if (!els.gate) return;

    $('#licActivate').addEventListener('click', () => activate(els.key.value, els.email.value, els.gateErr, () => { els.key.value = ''; }));
    // Ways out of the gate when it isn't blocking.
    els.x && els.x.addEventListener('click', tryClose);
    els.back && els.back.addEventListener('click', tryClose);
    els.gate.addEventListener('click', (e) => { if (e.target === els.gate) tryClose(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.gate.hidden) tryClose(); });

    els.banner && $('#licBannerBtn').addEventListener('click', () => showGate('Enter a licence key, or close this to carry on with your trial.', false));
    $('#licSetActivate') && $('#licSetActivate').addEventListener('click', () => activate(els.setKey.value, els.setEmail.value, els.setStatus, () => { els.setKey.value = ''; }));
    $('#licSetDeactivate') && $('#licSetDeactivate').addEventListener('click', () => {
      if (!window.confirm('Deactivate the licence on this machine? The app will fall back to trial/locked.')) return;
      window.license.deactivate().then(() => { toast('Deactivated.'); refresh(); });
    });
    refresh();
  });
})();
