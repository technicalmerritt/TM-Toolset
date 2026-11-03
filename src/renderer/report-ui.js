'use strict';

(function () {
  const els = {};
  let loading = false;
  let logoSvg = '';
  let standaloneHtml = '';

  const REPORT_CSS = [
    '.report{background:#fff;color:#1a2230;max-width:820px;margin:0 auto;padding:34px 40px;border-radius:10px;box-shadow:0 6px 28px rgba(0,0,0,.28);font-family:"Poppins",system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;}',
    '.report__head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #ff6600;padding-bottom:14px;}',
    '.report__brand svg,.report__brand img{height:46px;width:auto;display:block;}',
    '.report__brand strong{font-size:17px;color:#1a2230;}',
    '.report__title{text-align:right;}',
    '.report__title h1{margin:0;font-size:22px;color:#1a2230;}',
    '.report__title .sub{color:#6b7280;font-size:12px;}',
    '.report__meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px 28px;margin:16px 0;font-size:13px;}',
    '.report__meta div span{color:#6b7280;}.report__meta div b{color:#1a2230;}',
    '.report__verdict{background:#f4f7fb;border-left:4px solid #1f9d55;border-radius:8px;padding:12px 16px;margin:12px 0 4px;font-size:14px;color:#1a2230;}',
    '.report__verdict--warn{border-left-color:#d9822b;}',
    '.rep-sec{margin:20px 0;}',
    '.rep-sec h2{font-size:12.5px;text-transform:uppercase;letter-spacing:.05em;color:#ff6600;border-bottom:1px solid #e5e7eb;padding-bottom:5px;margin:0 0 10px;}',
    '.rep-kv{display:grid;grid-template-columns:180px 1fr;gap:5px 12px;font-size:13px;}',
    '.rep-kv .k{color:#6b7280;}.rep-kv .v{color:#1a2230;}',
    '.rep-table{width:100%;border-collapse:collapse;font-size:13px;}',
    '.rep-table th,.rep-table td{text-align:left;padding:6px 8px;border-bottom:1px solid #eceff3;}',
    '.rep-table th{color:#6b7280;font-weight:600;font-size:11px;text-transform:uppercase;}',
    '.rep-pill{font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;display:inline-block;}',
    '.rep-pill--good{color:#1f7a44;background:#e6f6ed;}',
    '.rep-pill--warn{color:#b45309;background:#fef3c7;}',
    '.rep-pill--bad{color:#b91c1c;background:#fee2e2;}',
    '.rep-line{font-size:13.5px;color:#1a2230;margin:0;}',
    '.rep-notes{white-space:pre-wrap;font-size:13.5px;color:#1a2230;}',
    '.report__foot{margin-top:26px;border-top:1px solid #e5e7eb;padding-top:12px;color:#6b7280;font-size:11px;display:flex;justify-content:space-between;gap:12px;}',
  ].join('');

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function arr(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
  function num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
  function safe(p) { return Promise.resolve(p).then((r) => r).catch(() => null); }
  function $(s) { return document.querySelector(s); }
  function toast(msg, kind) {
    const t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.className = 'toast toast--show' + (kind === 'error' ? ' toast--error' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3600);
  }
  function healthWord(p) { return p >= 85 ? 'Good' : p >= 55 ? 'Fair' : 'Needs attention'; }
  function pillCls(p) { return p >= 85 ? 'good' : p >= 55 ? 'warn' : 'bad'; }

  function buildReport(data) {
    const inf = (data.inf && data.inf.ok && data.inf.data) || {};
    const os = inf.os || {}, comp = inf.computer || {}, cpu = inf.cpu || {}, mem = inf.memory || {};
    const drives = (data.dr && data.dr.ok && arr(data.dr.data.drives)) || [];
    const batD = (data.bat && data.bat.ok && data.bat.data) || {};
    const crD = (data.cr && data.cr.ok && data.cr.data) || {};
    const devD = (data.dev && data.dev.ok && data.dev.data) || {};

    const customer = (els.customer.value || '').trim();
    const ticket = (els.ticket.value || '').trim();
    const tech = (els.tech.value || '').trim();
    const notes = (els.notes.value || '').trim();
    const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

    const issues = [];

    // Storage
    let storageRows = '';
    let worst = 100;
    for (const d of drives) {
      const h = window.tmDriveHealth ? window.tmDriveHealth(d) : 100;
      if (h < worst) worst = h;
      if (h < 85) issues.push('storage');
      const temp = num(d.temperatureC) ? num(d.temperatureC) + ' °C' : '-';
      storageRows += '<tr><td>' + esc(d.model || ('Disk ' + d.number)) + '</td><td>' + h + '% (' + healthWord(h) + ')</td><td>' + temp + '</td><td><span class="rep-pill rep-pill--' + pillCls(h) + '">' + (h >= 85 ? 'Healthy' : h >= 55 ? 'Monitor' : 'At risk') + '</span></td></tr>';
    }
    if (!drives.length) storageRows = '<tr><td colspan="4" style="color:#6b7280">No drive details available.</td></tr>';

    // Battery
    let batterySec = '';
    if (batD.hasBattery) {
      const b = arr(batD.batteries)[0] || {};
      const wear = num(b.wearPct);
      if (wear >= 40) issues.push('battery');
      batterySec = '<div class="rep-sec"><h2>Battery</h2><div class="rep-kv">' +
        '<div class="k">Battery health</div><div class="v">' + Math.max(0, 100 - Math.round(wear)) + '% of original capacity <span class="rep-pill rep-pill--' + (wear >= 40 ? 'bad' : wear >= 25 ? 'warn' : 'good') + '">' + (wear >= 40 ? 'Replace soon' : wear >= 25 ? 'Worn' : 'Good') + '</span></div>' +
        (b.cycleCount != null ? '<div class="k">Charge cycles</div><div class="v">' + num(b.cycleCount) + '</div>' : '') +
        '</div></div>';
    }

    // Stability
    const dumps = arr(crD.dumps).length;
    if (dumps > 0) issues.push('crashes');
    const stabilityLine = dumps > 0
      ? 'The records show ' + dumps + ' recent crash' + (dumps === 1 ? '' : 'es') + ' (blue screens). We reviewed these as part of the service.'
      : 'No recent crashes or blue screens were found - the system has been stable.';

    // Devices
    const probs = num(devD.problemCount);
    if (probs > 0) issues.push('devices');
    const deviceLine = probs > 0
      ? probs + ' device' + (probs === 1 ? '' : 's') + ' had a driver problem that we looked at.'
      : 'All hardware is installed correctly with no driver problems.';

    // Verdict
    const verdictLevel = issues.length ? 'warn' : 'good';
    const verdict = issues.length
      ? 'We carried out a full health check and addressed the points below. A few areas are worth keeping an eye on (see the relevant sections).'
      : 'We carried out a full health check and this computer is in good working order.';

    const metaBits = [];
    if (customer) metaBits.push('<div><span>Customer</span><br><b>' + esc(customer) + '</b></div>');
    metaBits.push('<div><span>Date</span><br><b>' + esc(dateStr) + '</b></div>');
    if (ticket) metaBits.push('<div><span>Ticket</span><br><b>#' + esc(ticket) + '</b></div>');
    if (tech) metaBits.push('<div><span>Technician</span><br><b>' + esc(tech) + '</b></div>');

    const ramStr = num(mem.totalGB) ? mem.totalGB + ' GB' : '-';
    const body =
      '<div class="report">' +
      '<div class="report__head">' +
        '<div class="report__brand">' + (logoSvg || '<strong>Technical Merritt<br>Computer Services</strong>') + '</div>' +
        '<div class="report__title"><h1>Service Report</h1><div class="sub">PC health &amp; work summary</div></div>' +
      '</div>' +
      '<div class="report__meta">' + metaBits.join('') + '</div>' +
      '<div class="report__verdict report__verdict--' + verdictLevel + '">' + esc(verdict) + '</div>' +

      '<div class="rep-sec"><h2>This computer</h2><div class="rep-kv">' +
        '<div class="k">Make &amp; model</div><div class="v">' + esc([comp.manufacturer, comp.model].filter(Boolean).join(' ') || 'Unknown') + '</div>' +
        '<div class="k">Operating system</div><div class="v">' + esc([os.name, os.displayVersion].filter(Boolean).join(' ') || 'Windows') + '</div>' +
        '<div class="k">Processor</div><div class="v">' + esc(cpu.name || '-') + '</div>' +
        '<div class="k">Memory (RAM)</div><div class="v">' + ramStr + '</div>' +
        (comp.serial ? '<div class="k">Serial number</div><div class="v">' + esc(comp.serial) + '</div>' : '') +
      '</div></div>' +

      '<div class="rep-sec"><h2>Storage health</h2><table class="rep-table"><thead><tr><th>Drive</th><th>Health</th><th>Temp</th><th>Status</th></tr></thead><tbody>' + storageRows + '</tbody></table></div>' +

      batterySec +

      '<div class="rep-sec"><h2>Stability</h2><p class="rep-line">' + esc(stabilityLine) + '</p></div>' +
      '<div class="rep-sec"><h2>Hardware &amp; drivers</h2><p class="rep-line">' + esc(deviceLine) + '</p></div>' +

      (notes ? '<div class="rep-sec"><h2>Work performed</h2><div class="rep-notes">' + esc(notes) + '</div></div>' : '') +

      '<div class="report__foot"><span>Technical Merritt Computer Services</span><span>Prepared with TM Toolset &middot; ' + esc(dateStr) + '</span></div>' +
      '</div>';

    const standalone = '<!doctype html><html><head><meta charset="utf-8"><title>Service Report' + (customer ? ' - ' + esc(customer) : '') + '</title><style>body{background:#eef1f5;margin:0;padding:24px;}' + REPORT_CSS + '</style></head><body>' + body + '</body></html>';
    return { body, standalone, customer };
  }

  async function build() {
    if (loading) return;
    loading = true;
    els.status.hidden = false;
    els.preview.innerHTML = '';
    els.build.disabled = true;
    try {
      const [inf, dr, bat, cr, dev] = await Promise.all([
        safe(window.inform && window.inform.run()),
        safe(window.drives && window.drives.list()),
        safe(window.battery && window.battery.list()),
        safe(window.crash && window.crash.list()),
        safe(window.devices && window.devices.list()),
      ]);
      const r = buildReport({ inf, dr, bat, cr, dev });
      els.preview.innerHTML = r.body;
      standaloneHtml = r.standalone;
      els.print.disabled = false; els.save.disabled = false; els.syncro.disabled = false;
      els.save.dataset.name = ('TM-Toolset-Report' + (r.customer ? '-' + r.customer.replace(/[^\w -]+/g, '') : '')).trim();
    } catch (e) {
      toast('Could not build the report: ' + ((e && e.message) || e), 'error');
    } finally {
      loading = false; els.build.disabled = false; els.status.hidden = true;
    }
  }

  function doPrint() {
    if (!standaloneHtml) return;
    window.print();
  }

  async function doSave() {
    if (!standaloneHtml) return;
    try {
      const res = await window.report.saveHtml({ html: standaloneHtml, name: els.save.dataset.name || 'TM-Toolset-Report' });
      if (res && res.cancelled) return;
      if (res && res.ok) toast('Report saved.'); else toast('Save failed: ' + ((res && res.error) || ''), 'error');
    } catch (e) { toast('Save failed: ' + ((e && e.message) || e), 'error'); }
  }

  async function doSyncro() {
    const t = window.activeTicket && window.activeTicket.get();
    if (!t) { toast('Load a ticket number in the bar up top first.', 'error'); return; }
    if (!els.preview.firstChild) return;
    try {
      const res = await window.syncro.postNote({ ticketId: t.id, subject: 'Service Report', body: els.preview.innerHTML, hidden: true });
      if (res && res.ok) toast('Report posted to ticket #' + t.number + ' (private note).');
      else toast('Syncro: ' + ((res && res.message) || 'failed'), 'error');
    } catch (e) { toast('Syncro error: ' + ((e && e.message) || e), 'error'); }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.customer = $('#repCustomer'); els.ticket = $('#repTicket'); els.tech = $('#repTech'); els.notes = $('#repNotes');
    els.build = $('#repBuild'); els.print = $('#repPrint'); els.save = $('#repSave'); els.syncro = $('#repSyncro');
    els.status = $('#reportStatus'); els.preview = $('#reportPreview');
    if (!els.preview) return;

    // Inject report CSS so the on-screen preview matches the saved file.
    const st = document.createElement('style'); st.textContent = REPORT_CSS; document.head.appendChild(st);
    // Preload the logo for the report header.
    fetch('logo-light.svg').then((r) => r.text()).then((t) => { if (t && t.indexOf('<svg') >= 0) logoSvg = t; }).catch(() => {});

    els.build.addEventListener('click', build);
    els.print.addEventListener('click', doPrint);
    els.save.addEventListener('click', doSave);
    els.syncro.addEventListener('click', doSyncro);

    // Pre-fill customer + ticket from the active ticket when the tab opens.
    const tab = document.querySelector('.tab[data-tab="report"]');
    if (tab) tab.addEventListener('click', () => {
      const t = window.activeTicket && window.activeTicket.get();
      if (t) {
        if (!els.customer.value && t.customerName) els.customer.value = t.customerName;
        if (!els.ticket.value && t.number) els.ticket.value = t.number;
      }
    });
  });
})();
