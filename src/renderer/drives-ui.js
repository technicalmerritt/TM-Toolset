'use strict';

(function () {
  const els = {};
  let loaded = false;
  let loading = false;

  function $(s) {
    return document.querySelector(s);
  }
  function arr(v) {
    return Array.isArray(v) ? v : v == null ? [] : [v];
  }
  function num(v, d = 0) {
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
  }

  // Overall health %: start at 100, subtract for the real failure indicators.
  function healthPct(dr) {
    let h = 100;
    const s = dr.smart || {};
    h -= Math.min(30, num(s.reallocated));
    if (num(s.pending) > 0) h -= 25;
    if (num(s.offlineUncorrectable) + num(s.reportedUncorrectable) > 0) h -= 40;
    h -= num(dr.wearPct);
    if (num(dr.temperatureC) >= 60) h -= 10;
    const hs = (dr.health || '').toLowerCase();
    if (hs && hs !== 'healthy') h = Math.min(h, 45);
    return Math.max(1, Math.round(h));
  }
  function healthClass(p) {
    return p >= 80 ? 'good' : p >= 50 ? 'warn' : 'bad';
  }
  function tempClass(t) {
    return t >= 60 ? 'bad' : t >= 50 ? 'warn' : 'good';
  }

  async function load() {
    if (loading) return;
    loading = true;
    loaded = true;
    els.status.hidden = false;
    els.error.hidden = true;
    els.list.hidden = true;
    try {
      const res = await window.drives.list();
      if (!res || res.ok !== true) {
        showError(res ? res.error : 'Unknown error');
        return;
      }
      render(arr(res.data && res.data.drives));
    } catch (e) {
      showError((e && e.message) || String(e));
    } finally {
      loading = false;
    }
  }

  function showError(msg) {
    els.status.hidden = true;
    els.list.hidden = true;
    els.errorDetail.textContent = msg || '(no detail)';
    els.error.hidden = false;
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function bar(label, value, max, cls, valueText) {
    const wrap = el('div', 'gauge');
    const top = el('div', 'gauge__top');
    top.append(el('span', 'gauge__label', label), el('span', 'gauge__val', valueText));
    const track = el('div', 'gauge__track');
    const fill = el('div', 'gauge__fill ' + (cls || ''));
    fill.style.width = Math.max(0, Math.min(100, (value / max) * 100)) + '%';
    track.appendChild(fill);
    wrap.append(top, track);
    return wrap;
  }

  function smartTable(s) {
    const rows = [
      ['Reallocated sectors (5)', s.reallocated],
      ['Pending sectors (197)', s.pending],
      ['Offline uncorrectable (198)', s.offlineUncorrectable],
      ['Reported uncorrectable (187)', s.reportedUncorrectable],
      ['Reallocation events (196)', s.reallocationEvents],
    ].filter((r) => r[1] != null);
    if (!rows.length) return null;
    const t = el('table', 'info-table');
    const tb = el('tbody');
    for (const [k, v] of rows) {
      const tr = el('tr');
      tr.appendChild(el('td', null, k));
      const vd = el('td', null, String(v));
      const bad = num(v) > 0;
      vd.style.color = bad ? 'var(--danger)' : '#7fd6a0';
      vd.style.fontWeight = '600';
      tr.appendChild(vd);
      tr.appendChild(el('td', null, bad ? 'Attention' : 'OK'));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    return t;
  }

  function driveCard(dr) {
    const card = el('section', 'drive-card');
    const p = healthPct(dr);

    // Header
    const head = el('div', 'drive-head');
    const title = el('div', 'drive-title');
    title.appendChild(el('h3', null, dr.model || 'Drive ' + dr.number));
    const sub = el('div', 'drive-sub');
    sub.textContent = [dr.mediaType, dr.interface || dr.busType, dr.sizeGB ? dr.sizeGB + ' GB' : '', 'Disk ' + dr.number]
      .filter(Boolean)
      .join('  ·  ');
    title.appendChild(sub);
    head.appendChild(title);

    const ring = el('div', 'drive-health drive-health--' + healthClass(p));
    ring.append(el('span', 'drive-health__pct', p + '%'), el('small', null, (dr.health || 'Health')));
    head.appendChild(ring);
    card.appendChild(head);

    // Gauges row
    const gauges = el('div', 'drive-gauges');
    const temp = num(dr.temperatureC);
    if (temp > 0) gauges.appendChild(bar('Temperature', temp, 70, tempClass(temp), temp + ' °C'));
    if (dr.wearPct != null) gauges.appendChild(bar('Life used (SSD wear)', num(dr.wearPct), 100, num(dr.wearPct) >= 80 ? 'bad' : num(dr.wearPct) >= 50 ? 'warn' : 'good', num(dr.wearPct) + '%'));
    if (dr.powerOnHours != null) {
      const yrs = (num(dr.powerOnHours) / 8760).toFixed(1);
      gauges.appendChild(bar('Power-on time', Math.min(100, num(dr.powerOnHours) / 438), 100, 'good', `${num(dr.powerOnHours)} h (~${yrs} yr)`));
    }
    if (gauges.children.length) card.appendChild(gauges);

    // Specs
    const specs = el('div', 'kv drive-specs');
    const add = (k, v) => {
      if (v == null || v === '') return;
      specs.append(el('div', 'kv__k', k), el('div', 'kv__v', String(v)));
    };
    add('Serial', dr.serial);
    add('Firmware', dr.firmware);
    add('Interface', dr.interface || dr.busType);
    add('Power cycles', dr.powerCycles);
    if (num(dr.spindleSpeed) > 0) add('Spindle', dr.spindleSpeed + ' RPM');
    card.appendChild(specs);

    // SMART table
    const st = smartTable(dr.smart || {});
    if (st) {
      card.appendChild(el('h4', 'info-sub', 'SMART attributes'));
      card.appendChild(st);
    } else {
      const note = el('p', 'muted');
      note.style.fontSize = '12px';
      note.textContent = 'Detailed SMART attributes need administrator rights (or the drive does not report them, e.g. some USB enclosures).';
      card.appendChild(note);
    }

    // Volumes
    const vols = arr(dr.volumes);
    if (vols.length) {
      card.appendChild(el('h4', 'info-sub', 'Volumes'));
      for (const v of vols) {
        const pct = v.sizeGB ? (1 - v.freeGB / v.sizeGB) * 100 : 0;
        card.appendChild(bar(`${v.drive} ${v.label || ''}`.trim(), pct, 100, pct >= 90 ? 'bad' : pct >= 85 ? 'warn' : 'good', `${v.freeGB} GB free of ${v.sizeGB} GB`));
      }
    }

    return card;
  }

  function render(ds) {
    els.status.hidden = true;
    els.error.hidden = true;
    els.list.hidden = false;
    els.list.innerHTML = '';
    if (!ds.length) {
      els.list.appendChild(el('p', 'muted', 'No drives detected.'));
      return;
    }
    for (const dr of ds) els.list.appendChild(driveCard(dr));
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.status = $('#drivesStatus');
    els.error = $('#drivesError');
    els.errorDetail = $('#drivesErrorDetail');
    els.list = $('#drivesList');
    els.refresh = $('#drivesRefresh');
    if (!els.list) return;
    els.refresh && els.refresh.addEventListener('click', load);
    const tab = document.querySelector('.tab[data-tab="drives"]');
    if (tab) tab.addEventListener('click', () => { if (!loaded) load(); });
  });
})();
