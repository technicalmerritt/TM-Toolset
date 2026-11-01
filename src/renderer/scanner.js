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
  let scanning = false;

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

  function setStatus(text) {
    if (els.statusText) els.statusText.textContent = text;
  }

  async function runScan() {
    scanning = true;
    lastResult = null;
    els.results.hidden = true;
    els.error.hidden = true;
    els.status.hidden = false;
    els.runBtn.disabled = true;
    setStatus('Starting…');

    try {
      const res = await window.scanner.run();
      if (!res || res.ok !== true) {
        if (res && res.cancelled) {
          els.status.hidden = true;
          toast('Scan stopped.');
          return;
        }
        showError(res ? res.error : 'Unknown error', res ? res.detail : '');
        return;
      }
      lastResult = res.result;
      render(lastResult);
    } catch (err) {
      showError((err && err.message) || String(err), '');
    } finally {
      scanning = false;
      els.runBtn.disabled = false;
    }
  }

  async function stopScan() {
    if (!scanning) return;
    setStatus('Stopping…');
    try {
      await window.scanner.cancel();
    } catch {
      /* ignore */
    }
  }

  function showError(message, detail) {
    els.status.hidden = true;
    els.results.hidden = true;
    els.errorMsg.textContent = message || 'The scan hit a problem';
    els.errorDetail.textContent = detail && detail.trim() ? detail.trim() : '(no additional detail was returned)';
    els.error.hidden = false;
  }

  function scoreClass(s) {
    return s >= 80 ? 'score--good' : s >= 50 ? 'score--warn' : 'score--bad';
  }

  function render(result) {
    els.status.hidden = true;
    els.error.hidden = true;
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
    if (f.explain) {
      const ex = document.createElement('p');
      ex.className = 'finding__explain';
      ex.textContent = f.explain;
      body.appendChild(ex);
    }
    const hasActions = (f.actions && f.actions.length) || (f.links && f.links.length);
    if (hasActions) {
      const row = document.createElement('div');
      row.className = 'finding__actions';
      for (const a of f.actions || []) {
        const btn = document.createElement('button');
        btn.className = 'btn btn--sm';
        btn.type = 'button';
        btn.textContent = a.label;
        btn.addEventListener('click', async () => {
          const ok = window.sys && (await window.sys.open(a.token));
          if (!ok) toast('Could not open that on this PC.', 'error');
        });
        row.appendChild(btn);
      }
      for (const l of f.links || []) {
        const btn = document.createElement('button');
        btn.className = 'btn btn--sm btn--ghost';
        btn.type = 'button';
        btn.textContent = l.label + ' ↗';
        btn.addEventListener('click', () => window.sys && window.sys.openUrl(l.url));
        row.appendChild(btn);
      }
      body.appendChild(row);
    }
    if (f.detail) {
      const d = document.createElement('pre');
      d.className = 'finding__detail';
      d.textContent = f.detail;
      body.appendChild(d);
    }

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
      toast('Export failed: ' + ((err && err.message) || err), 'error');
    }
  }

  async function copyError() {
    const text = `${els.errorMsg.textContent}\n\n${els.errorDetail.textContent}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Details copied.');
    } catch {
      toast('Could not copy — please select the text manually.', 'error');
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.runBtn = $('#scanRun');
    els.rerunBtn = $('#scanRerun');
    els.stopBtn = $('#scanStop');
    els.status = $('#scanStatus');
    els.statusText = $('#scanStatusText');
    els.results = $('#scanResults');
    els.score = $('#scanScore');
    els.scoreRing = $('#scanScoreRing');
    els.summary = $('#scanSummary');
    els.counts = $('#scanCounts');
    els.findings = $('#scanFindings');
    els.exportBtn = $('#scanExport');
    els.error = $('#scanError');
    els.errorMsg = $('#scanErrorMsg');
    els.errorDetail = $('#scanErrorDetail');
    els.errorCopy = $('#scanErrorCopy');
    els.errorRetry = $('#scanErrorRetry');
    if (!els.runBtn) return;

    els.runBtn.addEventListener('click', runScan);
    els.rerunBtn && els.rerunBtn.addEventListener('click', runScan);
    els.stopBtn && els.stopBtn.addEventListener('click', stopScan);
    els.exportBtn && els.exportBtn.addEventListener('click', exportReport);
    els.errorCopy && els.errorCopy.addEventListener('click', copyError);
    els.errorRetry && els.errorRetry.addEventListener('click', runScan);

    // Live status text from the collector.
    if (window.scanner && window.scanner.onProgress) {
      window.scanner.onProgress((msg) => {
        if (scanning) setStatus(msg);
      });
    }
  });
})();
