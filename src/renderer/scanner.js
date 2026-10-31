'use strict';

(function () {
  const SEV = {
    critical: { label: 'Critical', cls: 'sev--critical', order: 0 },
    warning: { label: 'Warning', cls: 'sev--warning', order: 1 },
    info: { label: 'Info', cls: 'sev--info', order: 2 },
    ok: { label: 'OK', cls: 'sev--ok', order: 3 },
  };

  const els = {};
  let lastResult = null;

  function $(sel) {
    return document.querySelector(sel);
  }

  function toast(message, kind) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.className = 'toast toast--show' + (kind === 'error' ? ' toast--error' : '');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      t.className = 'toast';
    }, 3200);
  }

  async function runScan() {
    els.runBtn.disabled = true;
    els.rerunBtn && (els.rerunBtn.disabled = true);
    els.results.hidden = true;
    els.status.hidden = false;
    els.statusText.textContent = 'Scanning… this reads system information only and can take up to a minute.';
    try {
      lastResult = await window.scanner.run();
      render(lastResult);
    } catch (err) {
      els.status.hidden = true;
      toast('Scan failed: ' + (err && err.message ? err.message : err), 'error');
    } finally {
      els.runBtn.disabled = false;
      els.rerunBtn && (els.rerunBtn.disabled = false);
    }
  }

  function scoreClass(s) {
    return s >= 80 ? 'score--good' : s >= 50 ? 'score--warn' : 'score--bad';
  }

  function render(result) {
    els.status.hidden = true;
    els.results.hidden = false;

    els.score.textContent = result.score;
    els.scoreRing.className = 'score-ring ' + scoreClass(result.score);
    els.summary.textContent = result.summary || '';

    els.counts.innerHTML = '';
    for (const sev of ['critical', 'warning', 'info', 'ok']) {
      const n = (result.counts && result.counts[sev]) || 0;
      const chip = document.createElement('span');
      chip.className = 'count ' + SEV[sev].cls;
      chip.textContent = `${n} ${SEV[sev].label}`;
      els.counts.appendChild(chip);
    }

    els.findings.innerHTML = '';
    const byCat = {};
    for (const f of result.findings || []) {
      (byCat[f.category] = byCat[f.category] || []).push(f);
    }
    for (const cat of Object.keys(byCat).sort()) {
      const group = byCat[cat].sort((a, b) => SEV[a.severity].order - SEV[b.severity].order);
      const section = document.createElement('section');
      section.className = 'fgroup';
      const h = document.createElement('h3');
      h.textContent = cat;
      section.appendChild(h);
      for (const f of group) section.appendChild(card(f));
      els.findings.appendChild(section);
    }
  }

  function card(f) {
    const el = document.createElement('div');
    el.className = 'finding ' + SEV[f.severity].cls;

    const head = document.createElement('button');
    head.className = 'finding__head';
    head.type = 'button';

    const dot = document.createElement('span');
    dot.className = 'finding__dot';
    const title = document.createElement('span');
    title.className = 'finding__title';
    title.textContent = f.title;
    const sev = document.createElement('span');
    sev.className = 'finding__sev';
    sev.textContent = SEV[f.severity].label;
    head.append(dot, title, sev);

    const body = document.createElement('div');
    body.className = 'finding__body';
    body.hidden = true;

    const summary = document.createElement('p');
    summary.className = 'finding__summary';
    summary.textContent = f.summary;
    body.appendChild(summary);

    if (f.recommendation) {
      const rec = document.createElement('p');
      rec.className = 'finding__rec';
      rec.textContent = 'Recommended: ' + f.recommendation;
      body.appendChild(rec);
    }
    if (f.detail) {
      const d = document.createElement('pre');
      d.className = 'finding__detail';
      d.textContent = f.detail;
      body.appendChild(d);
    }

    // Critical/warning findings start expanded so they can't be missed.
    if (f.severity === 'critical' || f.severity === 'warning') {
      body.hidden = false;
      el.classList.add('finding--open');
    }

    head.addEventListener('click', () => {
      body.hidden = !body.hidden;
      el.classList.toggle('finding--open', !body.hidden);
    });

    el.append(head, body);
    return el;
  }

  async function exportReport() {
    if (!lastResult) return;
    try {
      const p = await window.scanner.exportReport(lastResult);
      if (p) toast('Report saved:\n' + p);
    } catch (err) {
      toast('Export failed: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.runBtn = $('#scanRun');
    els.rerunBtn = $('#scanRerun');
    els.status = $('#scanStatus');
    els.statusText = $('#scanStatusText');
    els.results = $('#scanResults');
    els.score = $('#scanScore');
    els.scoreRing = $('#scanScoreRing');
    els.summary = $('#scanSummary');
    els.counts = $('#scanCounts');
    els.findings = $('#scanFindings');
    els.exportBtn = $('#scanExport');
    if (!els.runBtn) return;

    els.runBtn.addEventListener('click', runScan);
    els.rerunBtn && els.rerunBtn.addEventListener('click', runScan);
    els.exportBtn.addEventListener('click', exportReport);
  });
})();
