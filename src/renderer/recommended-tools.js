'use strict';

// Curated technician tools. Each opens an install chooser: download straight to
// the USB toolkit (so it follows you), to this PC, or open the official site.
// Tools with a reliable direct download are flagged `direct` + given an `id`.
(function () {
  let TOOLS = [];
  let NEW = new Set();

  const els = {};
  let filter = 'All';
  let dataInfo = null;
  let activeDl = null; // { id, barFill, barText }

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(msg, kind) {
    const t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.className = 'toast toast--show' + (kind === 'error' ? ' toast--error' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3600);
  }
  function openUrl(url) { try { if (window.sys && window.sys.openUrl) window.sys.openUrl(url); } catch { /* ignore */ } }

  // ---------- install chooser modal ----------
  function closeModal() { const m = $('#recModal'); if (m) m.remove(); activeDl = null; }

  async function openModal(t) {
    closeModal();
    if (!dataInfo && window.launcher && window.launcher.dataInfo) {
      try { dataInfo = await window.launcher.dataInfo(); } catch { dataInfo = null; }
    }
    const overlay = el('div', 'modal'); overlay.id = 'recModal';
    const panel = el('div', 'modal__panel');
    panel.appendChild(el('h2', null, t.name));
    panel.appendChild(el('p', 'muted', t.desc));
    if (t.why) panel.appendChild(el('p', 'rec-why', 'Why it’s popular: ' + t.why));

    const where = dataInfo ? ('Toolkit: ' + dataInfo.toolkit + (dataInfo.portable ? '  (portable - travels on this drive)' : '  (on this PC)')) : '';
    const btns = el('div', 'rec-modal__btns');

    if (t.direct && t.id) {
      const bUsb = el('button', 'btn btn--primary', 'Download to USB toolkit');
      bUsb.type = 'button';
      bUsb.addEventListener('click', () => doDownload(t, 'usb'));
      const bPc = el('button', 'btn btn--ghost', 'Download to this PC');
      bPc.type = 'button';
      bPc.addEventListener('click', () => doDownload(t, 'pc'));
      btns.append(bUsb, bPc);
    } else {
      panel.appendChild(el('p', 'muted', 'No safe direct download for this one - open the official site, download it, then use "Add a downloaded file" to drop it into your toolkit.'));
    }
    const bSite = el('button', 'btn btn--ghost', 'Open official website');
    bSite.type = 'button';
    bSite.addEventListener('click', () => { openUrl(t.url); });
    const bImport = el('button', 'btn btn--ghost', 'Add a downloaded file...');
    bImport.type = 'button';
    bImport.addEventListener('click', () => doImport(t));
    btns.append(bSite, bImport);
    panel.appendChild(btns);

    // progress
    const prog = el('div', 'rec-prog'); prog.hidden = true;
    const track = el('div', 'rec-prog__track'); const fill = el('div', 'rec-prog__fill');
    track.appendChild(fill);
    const ptext = el('div', 'rec-prog__txt muted', '');
    prog.append(ptext, track);
    panel.appendChild(prog);
    els.prog = prog; els.progFill = fill; els.progText = ptext;

    if (where) panel.appendChild(el('p', 'muted rec-modal__where', where));

    const foot = el('div', 'modal__actions');
    const bClose = el('button', 'btn btn--ghost', 'Close');
    bClose.type = 'button'; bClose.addEventListener('click', closeModal);
    foot.appendChild(bClose);
    panel.appendChild(foot);

    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);
  }

  function setProgress(pct, text) {
    if (!els.prog) return;
    els.prog.hidden = false;
    if (pct >= 0) els.progFill.style.width = Math.max(2, Math.min(100, pct)) + '%';
    else els.progFill.style.width = '100%';
    els.progText.textContent = text;
  }

  async function doDownload(t, dest) {
    activeDl = { id: t.id };
    setProgress(0, 'Starting download...');
    try {
      const res = await window.launcher.download({ id: t.id, name: t.name, dest });
      if (!res || res.ok !== true) { setProgress(0, ''); els.prog.hidden = true; toast('Download failed: ' + ((res && res.error) || ''), 'error'); return; }
      if (dest === 'usb') {
        window.dispatchEvent(new Event('tm-tools-changed'));
        toast(t.name + ' added to My Tools' + (res.portable ? ' on the USB toolkit.' : '.'));
      } else {
        toast(t.name + ' downloaded to your Downloads folder.');
      }
      closeModal();
    } catch (e) {
      els.prog.hidden = true; toast('Download failed: ' + ((e && e.message) || e), 'error');
    } finally { activeDl = null; }
  }

  async function doImport(t) {
    try {
      const res = await window.launcher.importFile({ name: t.name });
      if (res && res.cancelled) return;
      if (!res || res.ok !== true) { toast('Could not add that file: ' + ((res && res.error) || ''), 'error'); return; }
      window.dispatchEvent(new Event('tm-tools-changed'));
      toast(t.name + ' added to My Tools (copied into your toolkit).');
      closeModal();
    } catch (e) { toast('Import failed: ' + ((e && e.message) || e), 'error'); }
  }

  // ---------- grid ----------
  function renderCats() {
    els.cats.innerHTML = '';
    const cats = ['All'];
    for (const t of TOOLS) if (cats.indexOf(t.cat) < 0) cats.push(t.cat);
    for (const c of cats) {
      const b = el('button', 'rec-cat' + (c === filter ? ' rec-cat--active' : ''), c);
      b.type = 'button';
      b.addEventListener('click', () => { filter = c; renderCats(); renderGrid(); });
      els.cats.appendChild(b);
    }
  }

  function renderGrid() {
    els.grid.innerHTML = '';
    for (const t of TOOLS) {
      if (filter !== 'All' && t.cat !== filter) continue;
      const card = el('div', 'rec-card' + (NEW.has(t.id) ? ' rec-card--new' : ''));
      const head = el('div', 'rec-card__head');
      const nameWrap = el('div', 'rec-card__name');
      nameWrap.textContent = t.name;
      if (NEW.has(t.id)) nameWrap.appendChild(el('span', 'rec-new', 'New'));
      head.append(nameWrap, el('span', 'rec-card__tag', t.cat));
      card.appendChild(head);
      card.appendChild(el('p', 'rec-card__desc', t.desc));
      if (t.why) card.appendChild(el('p', 'rec-why', t.why));
      const btn = el('button', 'btn btn--primary btn--sm', t.direct ? 'Get' : 'Download');
      btn.type = 'button';
      btn.addEventListener('click', () => openModal(t));
      card.appendChild(btn);
      els.grid.appendChild(card);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.cats = $('#recCats');
    els.grid = $('#recGrid');
    if (!els.grid) return;
    if (window.launcher && window.launcher.onDownloadProgress) {
      window.launcher.onDownloadProgress((p) => {
        if (!activeDl || !p || p.id !== activeDl.id) return;
        const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
        setProgress(p.pct, p.pct >= 0 ? ('Downloading... ' + p.pct + '%  (' + mb(p.received) + ')') : ('Downloading... ' + mb(p.received)));
      });
    }
    loadFeed();

    // Feed-URL setting (lives on the Settings tab).
    const feedInput = $('#setFeedUrl'); const feedSave = $('#setFeedSave'); const feedStatus = $('#setFeedStatus');
    if (feedInput && window.launcher && window.launcher.toolsGetFeedUrl) {
      window.launcher.toolsGetFeedUrl().then((r) => { if (r && r.url) feedInput.value = r.url; }).catch(() => {});
      feedSave && feedSave.addEventListener('click', () => {
        window.launcher.toolsSetFeedUrl(feedInput.value.trim()).then(() => {
          if (feedStatus) feedStatus.textContent = 'Saved. Refreshing the tools feed…';
          NEW = new Set();
          loadFeed();
          setTimeout(() => { if (feedStatus) feedStatus.textContent = 'Saved.'; }, 1500);
        }).catch(() => { if (feedStatus) feedStatus.textContent = 'Could not save.'; });
      });
    }
  });

  function navBadge(show, count) {
    const tab = document.querySelector('.tab[data-tab="tools"]');
    if (!tab) return;
    let dot = tab.querySelector('.nav-badge');
    if (show) {
      if (!dot) { dot = el('span', 'nav-badge'); tab.appendChild(dot); }
      dot.textContent = count > 0 ? String(count) : '';
    } else if (dot) { dot.remove(); }
  }

  function loadFeed() {
    if (!(window.launcher && window.launcher.toolsFeed)) { renderCats(); renderGrid(); return; }
    window.launcher.toolsFeed().then((res) => {
      if (res && res.ok && Array.isArray(res.tools)) {
        TOOLS = res.tools;
        NEW = new Set(res.newIds || []);
      }
      renderCats();
      renderGrid();
      if (NEW.size) {
        navBadge(true, NEW.size);
        toast(NEW.size + ' new tool' + (NEW.size === 1 ? '' : 's') + ' in the Tools tab.');
      }
      // Clear the "new" flag once the tech actually opens the Tools tab.
      const tab = document.querySelector('.tab[data-tab="tools"]');
      if (tab) tab.addEventListener('click', () => {
        if (NEW.size && window.launcher.toolsMarkSeen) {
          window.launcher.toolsMarkSeen(TOOLS.map((t) => t.id));
        }
        navBadge(false);
      });
    }).catch(() => { renderCats(); renderGrid(); });
  }
})();
