'use strict';

// Self-update UI: a top banner when an update is available, plus a Settings card
// with Check / Download & install and live progress. Downloads only on a click,
// and the main process refuses unless licensed or on trial.
(function () {
  const els = {};
  let latestInfo = null;
  let busy = false;

  function $(s) { return document.querySelector(s); }
  function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.className = 'toast toast--show'; clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3600); }
  function openUrl(url) { try { if (window.sys && window.sys.openUrl) window.sys.openUrl(url); } catch { /* ignore */ } }

  function showBanner(info) {
    if (!els.banner) return;
    els.banner.hidden = false;
    els.bannerText.textContent = 'Update available: ' + info.latest + ' (you have ' + info.current + ').';
  }
  function hideBanner() { if (els.banner) els.banner.hidden = true; }

  function setProg(pct, text) {
    if (!els.prog) return;
    els.prog.hidden = false;
    els.progText.textContent = text;
    els.progFill.style.width = (pct >= 0 ? Math.max(3, Math.min(100, pct)) : 100) + '%';
  }

  function applyInfo(info) {
    latestInfo = info;
    if (els.current) els.current.textContent = info.current || '—';
    if (els.latest) els.latest.textContent = info.latest || '—';
    if (info.newer) {
      showBanner(info);
      if (els.install) els.install.hidden = false;
      if (els.page) els.page.hidden = false;
      if (els.status) els.status.textContent = 'A new version is ready to install.';
      if (els.notes && info.notes) { els.notes.hidden = false; els.notes.textContent = info.notes; }
    } else {
      hideBanner();
      if (els.install) els.install.hidden = true;
      if (els.status) els.status.textContent = 'You’re on the latest version.';
    }
  }

  function check(manual) {
    if (!(window.updates && window.updates.check)) return;
    if (manual && els.status) els.status.textContent = 'Checking…';
    window.updates.check().then((r) => {
      if (!r || !r.ok) {
        if (manual && els.status) els.status.textContent = 'Could not check: ' + ((r && r.error) || 'offline') + '.';
        if (r && r.info && els.current) els.current.textContent = r.info.current || '—';
        return;
      }
      applyInfo(r.info);
    }).catch(() => { if (manual && els.status) els.status.textContent = 'Could not check for updates.'; });
  }

  function install() {
    if (busy) return;
    if (!latestInfo || !latestInfo.newer) { check(true); return; }
    if (!window.confirm('Download and install ' + latestInfo.latest + '? The app will close and reopen itself.')) return;
    busy = true;
    if (els.install) els.install.disabled = true;
    setProg(0, 'Starting…');
    window.updates.apply().then((r) => {
      if (r && r.ok) { setProg(100, 'Installed. Restarting…'); toast('Update installed — restarting.'); }
      else {
        busy = false; if (els.install) els.install.disabled = false;
        if (els.prog) els.prog.hidden = true;
        const reason = (r && r.reason === 'already-latest') ? 'You’re already on the latest version.' : ((r && (r.reason || r.error)) || 'Update failed.');
        if (els.status) els.status.textContent = reason;
        toast(reason);
      }
    }).catch(() => { busy = false; if (els.install) els.install.disabled = false; if (els.prog) els.prog.hidden = true; if (els.status) els.status.textContent = 'Update failed.'; });
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.banner = $('#updBanner'); els.bannerText = $('#updBannerText');
    els.current = $('#updCurrent'); els.latest = $('#updLatest'); els.status = $('#updStatus'); els.notes = $('#updNotes');
    els.install = $('#updInstall'); els.page = $('#updPage'); els.prog = $('#updProg'); els.progText = $('#updProgText'); els.progFill = $('#updProgFill');

    if (window.updates && window.updates.repo) window.updates.repo().then((r) => { const e = $('#updRepo'); if (e && r) e.textContent = r.repo; }).catch(() => {});
    if (window.updates && window.updates.onProgress) {
      window.updates.onProgress((p) => {
        if (!p) return;
        if (p.phase === 'download') setProg(p.pct, p.total ? ('Downloading… ' + (p.pct >= 0 ? p.pct + '%' : (Math.round(p.got / 1048576) + ' MB'))) : 'Downloading…');
        else if (p.phase === 'extract') setProg(-1, 'Extracting…');
        else if (p.phase === 'install') setProg(-1, 'Installing…');
        else if (p.phase === 'done') setProg(100, 'Done — restarting…');
      });
    }

    $('#updCheck') && $('#updCheck').addEventListener('click', () => check(true));
    $('#updInstall') && $('#updInstall').addEventListener('click', install);
    $('#updPage') && $('#updPage').addEventListener('click', () => latestInfo && openUrl(latestInfo.pageUrl));
    $('#updBannerBtn') && $('#updBannerBtn').addEventListener('click', install);
    $('#updBannerNotes') && $('#updBannerNotes').addEventListener('click', () => latestInfo && openUrl(latestInfo.pageUrl));

    // Quiet check on launch so the banner can appear without the tech doing anything.
    setTimeout(() => check(false), 2500);
  });
})();
