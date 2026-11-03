'use strict';

(function () {
  const els = {};
  let loaded = false;
  let loading = false;
  let lastDevices = null;

  function $(s) { return document.querySelector(s); }
  function arr(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // Device Manager ConfigManagerErrorCode → plain English + what to do.
  const CODES = {
    1: ['Not configured correctly', 'Reinstall the driver for this device.'],
    3: ['Driver may be corrupted, or the system is low on memory', 'Reinstall the driver; check RAM if it persists.'],
    10: ['Cannot start', 'Update or reinstall the driver; the device may be faulty.'],
    12: ['Not enough free resources', 'Disable another device, or free up IRQ/memory resources in BIOS.'],
    14: ['Needs a restart to work', 'Restart the PC.'],
    18: ['Drivers need reinstalling', 'Reinstall the driver.'],
    19: ['Registry entry is corrupted', 'Uninstall the device and reinstall the driver.'],
    21: ['Windows is removing it', 'Restart the PC.'],
    22: ['Disabled', 'Enable the device in Device Manager.'],
    24: ['Not present, not working, or missing a driver', 'Reconnect the device and install its driver.'],
    28: ['Driver is NOT installed', 'Install the correct driver for this device.'],
    29: ['Disabled by firmware', 'Enable the device in BIOS/UEFI.'],
    31: ['Not working — the driver may be failing', 'Update or reinstall the driver.'],
    32: ['Its start-up service is disabled', 'Set the device’s driver service back to a normal start type.'],
    33: ['Windows can’t determine which resources it needs', 'Likely a hardware fault — check the device.'],
    37: ['Driver failed to initialise', 'Reinstall the driver.'],
    39: ['Driver is corrupted or missing', 'Reinstall the driver.'],
    40: ['Service key in the registry is invalid', 'Reinstall the driver.'],
    43: ['Windows stopped it because it reported a problem', 'Update the driver; this often means a hardware fault (common for failing USB/GPU).'],
    44: ['Stopped by an application or service', 'Restart the PC.'],
    45: ['Not connected (last-known entry)', 'Reconnect the device if it should be present.'],
    48: ['Blocked because it’s known to be incompatible', 'Get an updated, compatible driver from the maker.'],
    52: ['Driver can’t be verified (signature)', 'Install a properly signed driver from the maker.'],
  };
  function decode(code) {
    return CODES[code] || ['Problem code ' + code, 'Update or reinstall the driver; check the maker’s support site.'];
  }

  async function load() {
    if (loading) return;
    loading = true; loaded = true;
    els.status.hidden = false; els.error.hidden = true; els.content.hidden = true;
    try {
      const res = await window.devices.list();
      if (!res || res.ok !== true) { showError(res ? res.error : 'Unknown error'); return; }
      render(res.data || {});
    } catch (e) { showError((e && e.message) || String(e)); }
    finally { loading = false; }
  }

  function showError(msg) {
    els.status.hidden = true; els.content.hidden = true;
    els.errorDetail.textContent = msg || '(no detail)';
    els.error.hidden = false;
  }

  function deviceCard(d) {
    const [meaning, fix] = decode(d.errorCode);
    const card = el('section', 'crash-card');
    const head = el('div', 'crash-card__head');
    const left = el('div');
    left.appendChild(el('h3', null, d.name || 'Unknown device'));
    left.appendChild(el('div', 'crash-sub', [d.class, d.manufacturer].filter(Boolean).join('  ·  ')));
    head.appendChild(left);
    const badge = el('div', 'crash-code');
    badge.appendChild(el('span', 'crash-code__hex', 'Code ' + d.errorCode));
    head.appendChild(badge);
    card.appendChild(head);

    card.appendChild(el('p', 'crash-plain', meaning + '.'));
    const grid = el('div', 'crash-grid');
    const c2 = el('div', 'crash-col');
    c2.appendChild(el('h4', 'crash-col__h', 'What to try'));
    const ul = el('ul', 'crash-list');
    ul.appendChild(el('li', null, fix));
    c2.appendChild(ul);
    grid.appendChild(c2);
    card.appendChild(grid);

    if (d.deviceId) {
      const meta = el('div', 'crash-meta');
      meta.append(el('span', 'crash-meta__k', 'Hardware ID'), el('span', 'crash-meta__v', d.deviceId));
      card.appendChild(meta);
    }
    return card;
  }

  function buildSyncroHtml() {
    const e = window.tmEsc || ((s) => s);
    const data = lastDevices || {};
    const problems = arr(data.problems);
    const out = ['<p><strong>TM Toolset — Drivers &amp; Devices</strong><br>' + e(new Date().toLocaleString()) + '</p>'];
    if (!problems.length) {
      out.push('<p>No driver problems — all ' + e(data.totalDevices != null ? data.totalDevices : '') + ' devices reporting OK.</p>');
    } else {
      out.push('<p><strong>' + problems.length + ' device(s) with a problem:</strong></p><ul>');
      for (const d of problems) {
        const meaning = decode(d.errorCode)[0];
        out.push('<li><strong>' + e(d.name || 'Unknown device') + '</strong> (' + e(d.class || '') + ') — code ' + e(d.errorCode) + ': ' + e(meaning) + '</li>');
      }
      out.push('</ul>');
    }
    out.push('<p><em>Generated by TM Toolset · Technical Merritt Computer Services</em></p>');
    return out.join('\n');
  }

  function render(data) {
    lastDevices = data;
    if (data && data.error) {
      showError(data.error + (data.line ? '  (line ' + data.line + ': ' + (data.near || '') + ')' : ''));
      return;
    }
    els.status.hidden = true; els.error.hidden = true; els.content.hidden = false;
    els.content.innerHTML = '';
    const problems = arr(data.problems);
    const summary = el('section', 'crash-summary');
    if (!problems.length) {
      summary.classList.add('crash-summary--good');
      summary.appendChild(el('h2', null, 'No driver problems'));
      summary.appendChild(el('p', 'muted', `All ${data.totalDevices != null ? data.totalDevices + ' ' : ''}devices are reporting OK — no missing drivers, failed or disabled hardware.`));
      els.content.appendChild(summary);
      return;
    }
    summary.appendChild(el('h2', null, `${problems.length} device${problems.length === 1 ? '' : 's'} with a problem`));
    summary.appendChild(el('p', 'muted', `Out of ${data.totalDevices != null ? data.totalDevices : 'all'} devices. Each is decoded below with what to try.`));
    els.content.appendChild(summary);
    for (const d of problems) els.content.appendChild(deviceCard(d));
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.status = $('#devicesStatus');
    els.error = $('#devicesError');
    els.errorDetail = $('#devicesErrorDetail');
    els.content = $('#devicesContent');
    els.refresh = $('#devicesRefresh');
    els.syncro = $('#devicesSyncro');
    if (!els.content) return;
    els.refresh && els.refresh.addEventListener('click', load);
    els.syncro && els.syncro.addEventListener('click', () => {
      if (!loaded) { load().then(() => window.tmSyncroPost(els.syncro, 'TM Toolset — Drivers & Devices', buildSyncroHtml())); }
      else window.tmSyncroPost(els.syncro, 'TM Toolset — Drivers & Devices', buildSyncroHtml());
    });
    const tab = document.querySelector('.tab[data-tab="devices"]');
    if (tab) tab.addEventListener('click', () => { if (!loaded) load(); });
  });
})();
