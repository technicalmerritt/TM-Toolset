'use strict';

(function () {
  const els = {};
  let data = null;
  let loading = false;

  function $(s) {
    return document.querySelector(s);
  }

  // PowerShell single items arrive as bare objects, not arrays.
  function arr(v) {
    return Array.isArray(v) ? v : v == null ? [] : [v];
  }

  function toast(message, kind) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.className = 'toast toast--show' + (kind === 'error' ? ' toast--error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 3200);
  }

  async function load() {
    if (loading) return;
    loading = true;
    els.status.hidden = false;
    els.error.hidden = true;
    els.content.hidden = true;
    els.statusText.textContent = 'Gathering system information…';
    try {
      const res = await window.inform.run();
      if (!res || res.ok !== true) {
        showError(res ? res.error : 'Unknown error');
        return;
      }
      data = res.data;
      render(data);
    } catch (err) {
      showError((err && err.message) || String(err));
    } finally {
      loading = false;
    }
  }

  function showError(message) {
    els.status.hidden = true;
    els.content.hidden = true;
    els.errorDetail.textContent = message || '(no detail)';
    els.error.hidden = false;
  }

  // ---- Rendering helpers ----

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function card(title) {
    const c = el('section', 'info-card');
    c.appendChild(el('h3', 'info-card__title', title));
    return c;
  }

  function kvGrid(pairs) {
    const grid = el('div', 'kv');
    for (const [k, v] of pairs) {
      if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
      grid.appendChild(el('div', 'kv__k', k));
      grid.appendChild(el('div', 'kv__v', String(v)));
    }
    return grid;
  }

  function table(headers, rows) {
    const t = el('table', 'info-table');
    const thead = el('thead');
    const htr = el('tr');
    headers.forEach((h) => htr.appendChild(el('th', null, h)));
    thead.appendChild(htr);
    t.appendChild(thead);
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      r.forEach((cell) => tr.appendChild(el('td', null, cell == null ? '' : String(cell))));
      tbody.appendChild(tr);
    }
    t.appendChild(tbody);
    return t;
  }

  function yesNo(v, yes = 'Yes', no = 'No') {
    return v === true ? yes : v === false ? no : null;
  }

  function render(d) {
    els.status.hidden = true;
    els.error.hidden = true;
    els.content.hidden = false;
    els.content.innerHTML = '';

    const os = d.os || {};
    const c = d.computer || {};
    const cpu = d.cpu || {};
    const b = d.board || {};
    const mem = d.memory || {};
    const sec = d.security || {};
    const net = d.network || {};
    const hist = d.history || {};

    // Operating System
    const osCard = card('Operating System');
    osCard.appendChild(
      kvGrid([
        ['Name', os.name],
        ['Edition / version', [os.displayVersion, os.version].filter(Boolean).join('  ·  ')],
        ['Build', os.build],
        ['Architecture', os.arch],
        ['Install date', os.installDate],
        ['Last boot', os.lastBoot],
        ['Uptime', os.uptimeHours != null ? os.uptimeHours + ' hours' : null],
        ['Boot mode', os.bootMode],
        ['Logged-in user', os.loggedInUser],
        ['Activation', os.activation],
      ])
    );
    els.content.appendChild(osCard);

    // Hardware
    const hw = card('Hardware');
    hw.appendChild(
      kvGrid([
        ['Manufacturer', c.manufacturer],
        ['Model', c.model],
        ['Type', c.systemType],
        ['Serial', c.serial],
        ['CPU', cpu.name],
        ['Cores / threads', [cpu.cores, cpu.logical].filter((x) => x != null).join(' / ')],
        ['Max clock', cpu.maxClockMHz ? cpu.maxClockMHz + ' MHz' : null],
        ['Motherboard', [b.manufacturer, b.product].filter(Boolean).join(' ')],
        ['BIOS', [b.biosVersion, b.biosDate].filter(Boolean).join('  ·  ')],
        ['Secure Boot', yesNo(b.secureBoot, 'On', 'Off')],
        ['TPM', yesNo(b.tpm, 'Present', 'Not present')],
        ['Memory', mem.totalGB != null ? mem.totalGB + ' GB' : null],
      ])
    );
    const mods = arr(mem.modules);
    if (mods.length) {
      hw.appendChild(el('h4', 'info-sub', 'Memory modules'));
      hw.appendChild(
        table(
          ['Slot', 'Capacity', 'Speed', 'Part number'],
          mods.map((m) => [m.slot, m.capacityGB != null ? m.capacityGB + ' GB' : '', m.speedMHz ? m.speedMHz + ' MHz' : '', m.partNumber])
        )
      );
    }
    const gpus = arr(d.graphics);
    if (gpus.length) {
      hw.appendChild(el('h4', 'info-sub', 'Graphics & displays'));
      hw.appendChild(
        table(
          ['Adapter', 'Driver', 'Resolution', 'Refresh'],
          gpus.map((g) => [g.name, [g.driverVersion, g.driverDate].filter(Boolean).join('  '), g.resolution, g.refreshHz ? g.refreshHz + ' Hz' : ''])
        )
      );
    }
    els.content.appendChild(hw);

    // Disks & volumes
    const disks = arr(d.disks);
    const vols = arr(d.volumes);
    if (disks.length || vols.length) {
      const dk = card('Disks & volumes');
      if (disks.length) {
        dk.appendChild(
          table(
            ['Drive', 'Type', 'Bus', 'Size', 'Health', 'Wear'],
            disks.map((x) => [x.model, x.media, x.bus, x.sizeGB ? x.sizeGB + ' GB' : '', x.health, x.wearPct != null ? x.wearPct + '%' : ''])
          )
        );
      }
      if (vols.length) {
        dk.appendChild(el('h4', 'info-sub', 'Volumes'));
        dk.appendChild(
          table(
            ['Drive', 'Label', 'File system', 'Free', 'Size', 'Free %'],
            vols.map((v) => [v.drive, v.label, v.fs, v.freeGB + ' GB', v.sizeGB + ' GB', v.freePct + '%'])
          )
        );
      }
      els.content.appendChild(dk);
    }

    // Security
    const sc = card('Security');
    sc.appendChild(
      kvGrid([
        ['Default browser', d.defaultBrowser],
        ['UAC', yesNo(sec.uac, 'Enabled', 'Disabled')],
        ['Defender real-time', yesNo(sec.defenderRTP, 'On', 'Off')],
        ['Definitions age', sec.defenderSigAge != null ? sec.defenderSigAge + ' days' : null],
        ['BitLocker (system drive)', sec.bitlocker],
      ])
    );
    const fw = arr(sec.firewall);
    if (fw.length) sc.appendChild(el('p', 'info-line', 'Firewall — ' + fw.map((f) => `${f.profile}: ${f.enabled ? 'on' : 'off'}`).join(', ')));
    const avs = arr(sec.avProducts);
    if (avs.length) sc.appendChild(el('p', 'info-line', 'Antivirus — ' + avs.map((a) => `${a.name}${a.active ? ' (active)' : ' (inactive)'}`).join(', ')));
    els.content.appendChild(sc);

    // Network
    const nc = card('Network');
    nc.appendChild(
      kvGrid([
        ['Internet status', net.status],
        ['Proxy', net.proxy || 'None'],
        ['Hosts-file entries', net.hostsCount],
      ])
    );
    const adapters = arr(net.adapters);
    if (adapters.length) {
      nc.appendChild(
        table(
          ['Adapter', 'Status', 'IPv4', 'MAC', 'DHCP'],
          adapters.map((a) => [a.name || a.desc, a.status, a.ipv4, a.mac, a.dhcp])
        )
      );
    }
    els.content.appendChild(nc);

    // History
    const hc = card('History');
    hc.appendChild(
      kvGrid([
        ['System Restore', hist.restoreEnabled],
        ['Shadow copies', hist.shadowCopies],
        ['Crash dumps (BSOD)', hist.bsodDumps],
        ['Unexpected shutdowns (30d)', hist.unexpectedShutdowns],
      ])
    );
    const usb = arr(hist.usbDevices);
    if (usb.length) hc.appendChild(el('p', 'info-line', 'USB devices seen — ' + usb.slice(0, 12).join(', ')));
    els.content.appendChild(hc);

    // Installed programs
    const progs = arr(d.programs);
    const pc = card(`Installed programs (${progs.length})`);
    if (progs.length) {
      pc.appendChild(
        table(
          ['Name', 'Version', 'Publisher', 'Installed'],
          progs.map((p) => [p.name, p.version, p.publisher, p.installed])
        )
      );
    } else {
      pc.appendChild(el('p', 'muted', 'No installed programs were enumerated.'));
    }
    els.content.appendChild(pc);
  }

  async function exportText() {
    if (!data) return;
    try {
      const p = await window.inform.exportText(data);
      if (p) toast('Saved:\n' + p);
    } catch (err) {
      toast('Export failed: ' + ((err && err.message) || err), 'error');
    }
  }

  async function openAssetModal() {
    if (!data) {
      toast('Let the information finish loading first.', 'error');
      return;
    }
    const tk = window.activeTicket && window.activeTicket.get();
    if (!tk || !tk.customerId) {
      toast('Set a ticket number in the top bar first (so we know the customer).', 'error');
      const input = document.getElementById('ticketInput');
      if (input) input.focus();
      return;
    }
    els.createAsset.disabled = true;
    try {
      const res = await window.syncro.assetTypes();
      if (!res || !res.ok) {
        toast((res && res.message) || 'Could not load asset types.', 'error');
        return;
      }
      if (!res.types.length) {
        toast('No asset types in Syncro yet — create one under Admin → Asset Types, then try again.', 'error');
        return;
      }
      els.assetType.innerHTML = '';
      for (const t of res.types) {
        const o = document.createElement('option');
        o.value = String(t.id);
        o.textContent = t.name;
        els.assetType.appendChild(o);
      }
      const c = data.computer || {};
      els.assetName.value = [c.manufacturer, c.model].filter(Boolean).join(' ').trim() || 'PC';
      els.assetTarget.textContent = `Customer: ${tk.customerName}`;
      els.assetModal.hidden = false;
    } catch (err) {
      toast('Asset error: ' + ((err && err.message) || err), 'error');
    } finally {
      els.createAsset.disabled = false;
    }
  }

  function closeAssetModal() {
    els.assetModal.hidden = true;
  }

  async function doCreateAsset() {
    const tk = window.activeTicket && window.activeTicket.get();
    if (!tk || !tk.customerId) {
      toast('No customer — set a ticket first.', 'error');
      return;
    }
    const assetTypeId = parseInt(els.assetType.value, 10);
    const name = (els.assetName.value || '').trim() || 'PC';
    const os = data.os || {};
    const c = data.computer || {};
    const cpu = data.cpu || {};
    const mem = data.memory || {};
    const properties = {
      Serial: c.serial,
      'Operating System': [os.name, os.displayVersion].filter(Boolean).join(' '),
      CPU: cpu.name,
      RAM: mem.totalGB != null ? mem.totalGB + ' GB' : undefined,
    };
    Object.keys(properties).forEach((k) => (properties[k] == null || properties[k] === '') && delete properties[k]);

    els.assetCreate.disabled = true;
    try {
      const res = await window.syncro.createAsset({ customerId: tk.customerId, name, assetTypeId, properties });
      if (res && res.ok) {
        closeAssetModal();
        toast(res.message || 'Asset created.');
      } else {
        toast((res && res.message) || 'Could not create asset.', 'error');
      }
    } catch (err) {
      toast('Asset error: ' + ((err && err.message) || err), 'error');
    } finally {
      els.assetCreate.disabled = false;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.status = $('#infoStatus');
    els.statusText = $('#infoStatusText');
    els.error = $('#infoError');
    els.errorDetail = $('#infoErrorDetail');
    els.content = $('#infoContent');
    els.refresh = $('#infoRefresh');
    els.export = $('#infoExport');
    els.retry = $('#infoRetry');
    els.createAsset = $('#infoCreateAsset');
    els.assetModal = $('#assetModal');
    els.assetType = $('#assetType');
    els.assetName = $('#assetName');
    els.assetTarget = $('#assetTarget');
    els.assetCreate = $('#assetCreate');
    els.assetCancel = $('#assetCancel');
    if (!els.content) return;

    els.refresh && els.refresh.addEventListener('click', load);
    els.retry && els.retry.addEventListener('click', load);
    els.export && els.export.addEventListener('click', exportText);
    els.createAsset && els.createAsset.addEventListener('click', openAssetModal);
    els.assetCreate && els.assetCreate.addEventListener('click', doCreateAsset);
    els.assetCancel && els.assetCancel.addEventListener('click', closeAssetModal);
    els.assetModal &&
      els.assetModal.addEventListener('click', (e) => {
        if (e.target === els.assetModal) closeAssetModal();
      });

    if (window.inform && window.inform.onProgress) {
      window.inform.onProgress((msg) => {
        if (loading) els.statusText.textContent = 'Gathering: ' + msg + '…';
      });
    }

    // Auto-load the front page on startup.
    load();
  });
})();
