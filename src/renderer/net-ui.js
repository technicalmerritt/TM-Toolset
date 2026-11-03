'use strict';

// Networking tab: status & gotchas, internet speed test, LAN ping + discovery.
(function () {
  const els = {};
  let loadedOnce = false;
  let busy = false;
  let progressMode = null;   // 'speed' | 'discover'

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(msg) {
    const t = $('#toast'); if (!t) return;
    t.textContent = msg; t.classList.add('toast--show');
    setTimeout(() => t.classList.remove('toast--show'), 3200);
  }
  function metric(label, value, cls) {
    const b = el('div', 'metric' + (cls ? ' metric--' + cls : ''));
    b.appendChild(el('div', 'metric__val', value));
    b.appendChild(el('div', 'metric__lbl', label));
    return b;
  }

  // ---------- status & gotchas ----------
  function loadStatus() {
    els.statusBusy.hidden = false;
    els.error.hidden = true;
    els.warnings.innerHTML = '';
    els.cards.innerHTML = '';
    return window.net.info().then((res) => {
      els.statusBusy.hidden = true;
      if (!res || !res.ok) { els.error.hidden = false; els.errorDetail.textContent = (res && res.error) || 'Unknown error.'; return; }
      renderStatus(res.data || {});
    }).catch((e) => { els.statusBusy.hidden = true; els.error.hidden = false; els.errorDetail.textContent = (e && e.message) || String(e); });
  }

  function renderStatus(d) {
    const warns = d.warnings || [];
    els.warnings.innerHTML = '';
    if (!warns.length) {
      els.warnings.appendChild(el('div', 'net-ok', '✓ No network gotchas detected.'));
    }
    for (const w of warns) {
      const card = el('div', 'net-warn net-warn--' + (w.sev === 'bad' ? 'bad' : 'warn'));
      const body = el('div', 'net-warn__body');
      body.appendChild(el('div', 'net-warn__title', (w.sev === 'bad' ? '✖ ' : '⚠ ') + w.title));
      body.appendChild(el('div', 'net-warn__detail muted', w.detail));
      card.appendChild(body);
      if (w.fix === 'setprivate') {
        const btn = el('button', 'btn btn--primary btn--sm', 'Set to Private');
        btn.type = 'button';
        btn.addEventListener('click', () => {
          btn.disabled = true;
          window.net.setPrivate().then((res) => {
            const r = (res && res.data) || {};
            if (res && res.ok && r.ok) { toast(r.changed && r.changed.length ? ('Set to Private: ' + r.changed.join(', ')) : 'Updated.'); loadStatus(); }
            else if (r.error === 'admin') { toast('Needs administrator rights — use the “Run as administrator” banner.'); btn.disabled = false; }
            else { toast('Could not change the profile.'); btn.disabled = false; }
          }).catch(() => { btn.disabled = false; });
        });
        card.appendChild(btn);
      }
      els.warnings.appendChild(card);
    }

    // info cards
    els.cards.innerHTML = '';
    const grid = el('div', 'kv net-kv');
    const add = (k, v) => { if (v == null || v === '') return; grid.append(el('div', 'kv__k', k), el('div', 'kv__v', String(v))); };
    add('IPv4 address', d.ipv4);
    add('Gateway', d.gateway);
    add('DNS', (d.dns || []).join(', '));
    for (const p of (d.profiles || [])) {
      add('Network — ' + p.name, p.category + '  (' + p.ipv4 + ')');
    }
    for (const a of (d.adapters || [])) {
      add('Adapter — ' + a.name, [a.desc, a.speed].filter(Boolean).join('  ·  '));
    }
    els.cards.appendChild(grid);
  }

  // ---------- internet speed ----------
  function runSpeed() {
    if (busy) { toast('Something is already running.'); return; }
    busy = true; progressMode = 'speed';
    els.speedResult.hidden = true;
    els.speedRunner.hidden = false;
    els.speedLog.textContent = '';
    els.speedState.textContent = 'Running…';
    els.speedState.className = 'repairs-state repairs-state--run';
    els.speedGo.disabled = true;
    window.net.speed().then((res) => {
      const d = (res && res.data) || {};
      if (!res || !res.ok || d.ok !== true) {
        els.speedState.textContent = 'Failed';
        els.speedState.className = 'repairs-state repairs-state--bad';
        appendSpeed('[error] ' + ((res && res.error) || 'speed test failed'));
        return;
      }
      els.speedState.textContent = 'Done';
      els.speedState.className = 'repairs-state repairs-state--good';
      els.speedResult.hidden = false;
      els.speedResult.innerHTML = '';
      els.speedResult.appendChild(metric('Download', (d.downloadMbps != null ? d.downloadMbps : '—') + ' Mbps', d.downloadMbps >= 100 ? 'good' : d.downloadMbps >= 25 ? 'warn' : 'bad'));
      els.speedResult.appendChild(metric('Upload', (d.uploadMbps != null ? d.uploadMbps : '—') + ' Mbps', d.uploadMbps >= 20 ? 'good' : d.uploadMbps >= 5 ? 'warn' : 'bad'));
      els.speedResult.appendChild(metric('Latency', (d.latencyMs != null ? d.latencyMs : '—') + ' ms', d.latencyMs <= 30 ? 'good' : d.latencyMs <= 80 ? 'warn' : 'bad'));
    }).catch((e) => { els.speedState.textContent = 'Failed'; els.speedState.className = 'repairs-state repairs-state--bad'; appendSpeed('[error] ' + ((e && e.message) || e)); })
      .finally(() => { busy = false; progressMode = null; els.speedGo.disabled = false; });
  }
  function appendSpeed(line) { els.speedLog.textContent += String(line).replace(/\s+$/, '') + '\n'; els.speedLog.scrollTop = els.speedLog.scrollHeight; }

  // ---------- LAN ----------
  function runPing() {
    if (busy) { toast('Something is already running.'); return; }
    busy = true;
    els.pingResult.hidden = false;
    els.pingResult.innerHTML = '';
    els.pingResult.appendChild(el('p', 'muted', 'Pinging…'));
    els.pingGo.disabled = true;
    window.net.ping(els.pingTarget.value.trim()).then((res) => {
      const d = (res && res.data) || {};
      els.pingResult.innerHTML = '';
      if (!res || !res.ok || d.ok !== true) {
        if (d.error === 'no-target') els.pingResult.appendChild(el('p', 'test-err', 'No gateway found to ping — type a host.'));
        else els.pingResult.appendChild(el('p', 'test-err', 'Ping failed: ' + ((res && res.error) || d.error || 'error')));
        return;
      }
      els.pingResult.appendChild(el('p', 'muted', 'Target: ' + d.target));
      const row = el('div', 'net-speed');
      row.appendChild(metric('Avg', (d.avgMs != null ? d.avgMs : '—') + ' ms', d.avgMs <= 30 ? 'good' : d.avgMs <= 80 ? 'warn' : 'bad'));
      row.appendChild(metric('Min / Max', d.minMs + ' / ' + d.maxMs + ' ms'));
      row.appendChild(metric('Jitter', d.jitterMs + ' ms', d.jitterMs <= 10 ? 'good' : d.jitterMs <= 30 ? 'warn' : 'bad'));
      row.appendChild(metric('Loss', d.lossPct + ' %', d.lossPct === 0 ? 'good' : d.lossPct <= 10 ? 'warn' : 'bad'));
      els.pingResult.appendChild(row);
    }).catch((e) => { els.pingResult.innerHTML = ''; els.pingResult.appendChild(el('p', 'test-err', 'Ping failed: ' + ((e && e.message) || e))); })
      .finally(() => { busy = false; els.pingGo.disabled = false; });
  }

  function runDiscover() {
    if (busy) { toast('Something is already running.'); return; }
    busy = true; progressMode = 'discover';
    els.discoverList.innerHTML = '';
    els.discoverHint.textContent = 'Scanning…';
    els.discoverGo.disabled = true;
    window.net.discover().then((res) => {
      const d = (res && res.data) || {};
      if (!res || !res.ok || d.ok !== true) {
        els.discoverHint.textContent = '';
        els.discoverList.appendChild(el('p', 'test-err', d.error === 'no-subnet' ? 'No usable subnet (is this PC on a network?).' : ('Scan failed: ' + ((res && res.error) || d.error || 'error'))));
        return;
      }
      els.discoverHint.textContent = d.count + ' device(s) on ' + d.subnet;
      els.discoverList.innerHTML = '';
      for (const h of (d.hosts || [])) {
        const row = el('div', 'net-dev');
        row.appendChild(el('span', 'bk-mono net-dev__ip', h.ip));
        row.appendChild(el('span', 'net-dev__name', h.name || '—'));
        row.appendChild(el('span', 'muted net-dev__ms', h.ms + ' ms'));
        els.discoverList.appendChild(row);
      }
      if (!d.hosts || !d.hosts.length) els.discoverList.appendChild(el('p', 'muted', 'Nothing answered (some devices hide from pings / firewall).'));
    }).catch((e) => { els.discoverHint.textContent = ''; els.discoverList.appendChild(el('p', 'test-err', 'Scan failed: ' + ((e && e.message) || e))); })
      .finally(() => { busy = false; progressMode = null; els.discoverGo.disabled = false; });
  }

  // ---------- sub-nav ----------
  function showSub(name) {
    for (const b of document.querySelectorAll('#panel-network .subtab')) b.classList.toggle('subtab--active', b.dataset.nsub === name);
    const map = { status: 'net-status', speed: 'net-speed', lan: 'net-lan' };
    for (const k of Object.keys(map)) { const s = document.getElementById(map[k]); if (s) s.hidden = k !== name; }
  }

  function wire() {
    els.statusBusy = $('#netStatusBusy'); els.error = $('#netError'); els.errorDetail = $('#netErrorDetail');
    els.warnings = $('#netWarnings'); els.cards = $('#netCards');
    els.speedGo = $('#netSpeedGo'); els.speedResult = $('#netSpeedResult'); els.speedRunner = $('#netSpeedRunner'); els.speedState = $('#netSpeedState'); els.speedLog = $('#netSpeedLog');
    els.pingTarget = $('#netPingTarget'); els.pingGo = $('#netPingGo'); els.pingResult = $('#netPingResult');
    els.discoverGo = $('#netDiscoverGo'); els.discoverHint = $('#netDiscoverHint'); els.discoverList = $('#netDiscoverList');
    if (!els.warnings) return;

    for (const b of document.querySelectorAll('#panel-network .subtab')) b.addEventListener('click', () => showSub(b.dataset.nsub));
    $('#netRefresh').addEventListener('click', loadStatus);
    els.speedGo.addEventListener('click', runSpeed);
    els.pingGo.addEventListener('click', runPing);
    els.pingTarget.addEventListener('keydown', (e) => { if (e.key === 'Enter') runPing(); });
    els.discoverGo.addEventListener('click', runDiscover);

    if (window.net && window.net.onProgress) {
      window.net.onProgress((msg) => {
        if (progressMode === 'speed') appendSpeed(msg);
        else if (progressMode === 'discover') els.discoverHint.textContent = msg;
      });
    }

    const tab = document.querySelector('.tab[data-tab="network"]');
    if (tab) tab.addEventListener('click', () => { if (!loadedOnce) { loadedOnce = true; loadStatus(); } });
  }

  window.addEventListener('DOMContentLoaded', wire);
})();
