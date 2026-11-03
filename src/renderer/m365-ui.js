'use strict';

// Microsoft 365 tab: curated plain-English "what's new" with impact ratings,
// free training, official sources, and a live pull of Microsoft's own roadmap.
(function () {
  const els = {};
  let UPDATES = [], COURSES = [], RESOURCES = [], NEW = new Set();
  let upFilter = 'All', crsFilter = 'All';
  let roadmapLoaded = false;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function openUrl(url) { try { if (window.sys && window.sys.openUrl) window.sys.openUrl(url); } catch { /* ignore */ } }
  function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.className = 'toast toast--show'; clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3600); }

  const IMP = {
    high: { cls: 'imp--high', label: 'High' },
    medium: { cls: 'imp--medium', label: 'Medium' },
    low: { cls: 'imp--low', label: 'Low' },
    'heads-up': { cls: 'imp--heads', label: 'Heads-up' }
  };
  function impKey(s) { return String(s || '').toLowerCase().replace(/\s+/g, '-'); }

  // ---------- section switching ----------
  function showSection(name) {
    ['whatsnew', 'roadmap', 'training', 'resources'].forEach((n) => {
      const sec = $('#m365-' + n); if (sec) sec.hidden = n !== name;
    });
    Array.from(document.querySelectorAll('.m365-tab')).forEach((b) => b.classList.toggle('m365-tab--active', b.dataset.m365 === name));
    if (name === 'roadmap' && !roadmapLoaded) loadRoadmap();
  }

  // ---------- what's new ----------
  function renderUpCats() {
    els.cats.innerHTML = '';
    const cats = ['All'];
    for (const u of UPDATES) if (cats.indexOf(u.cat) < 0) cats.push(u.cat);
    for (const c of cats) {
      const b = el('button', 'rec-cat' + (c === upFilter ? ' rec-cat--active' : ''), c);
      b.type = 'button';
      b.addEventListener('click', () => { upFilter = c; renderUpCats(); renderUpdates(); });
      els.cats.appendChild(b);
    }
  }
  function updateCard(u, isNew) {
    const card = el('div', 'm365-up' + (isNew ? ' m365-up--new' : ''));
    const head = el('div', 'm365-up__head');
    const ik = impKey(u.impact);
    const imp = IMP[ik] || IMP.low;
    head.appendChild(el('span', 'imp ' + imp.cls, imp.label));
    head.appendChild(el('span', 'm365-up__cat', u.cat || ''));
    if (u.date) head.appendChild(el('span', 'm365-up__date muted', u.date));
    if (isNew) head.appendChild(el('span', 'rec-new', 'New'));
    card.appendChild(head);
    card.appendChild(el('h3', 'm365-up__title', u.title || ''));
    if (u.tldr) card.appendChild(el('p', 'm365-up__tldr', u.tldr));
    if (u.who) { const p = el('p', 'm365-up__meta'); p.append(el('strong', null, 'Who: '), document.createTextNode(u.who)); card.appendChild(p); }
    if (u.action) { const p = el('p', 'm365-up__meta m365-up__action'); p.append(el('strong', null, 'What to do: '), document.createTextNode(u.action)); card.appendChild(p); }
    if (u.url) {
      const a = el('button', 'btn btn--ghost btn--sm', 'Read the official detail');
      a.type = 'button'; a.addEventListener('click', () => openUrl(u.url));
      card.appendChild(a);
    }
    return card;
  }
  function renderUpdates() {
    els.updates.innerHTML = '';
    let n = 0;
    for (const u of UPDATES) {
      if (upFilter !== 'All' && u.cat !== upFilter) continue;
      els.updates.appendChild(updateCard(u, NEW.has(String(u.id)))); n++;
    }
    if (!n) els.updates.appendChild(el('p', 'muted', 'Nothing in this category.'));
  }

  // ---------- training ----------
  function renderCrsCats() {
    els.crsCats.innerHTML = '';
    const cats = ['All'];
    for (const c of COURSES) if (cats.indexOf(c.cat) < 0) cats.push(c.cat);
    for (const c of cats) {
      const b = el('button', 'rec-cat' + (c === crsFilter ? ' rec-cat--active' : ''), c);
      b.type = 'button';
      b.addEventListener('click', () => { crsFilter = c; renderCrsCats(); renderCourses(); });
      els.crsCats.appendChild(b);
    }
  }
  function renderCourses() {
    els.courses.innerHTML = '';
    for (const c of COURSES) {
      if (crsFilter !== 'All' && c.cat !== crsFilter) continue;
      const card = el('div', 'rec-card');
      const head = el('div', 'rec-card__head');
      head.append(el('div', 'rec-card__name', c.name), el('span', 'rec-card__tag', c.cat));
      card.appendChild(head);
      const meta = [c.level, c.cost, (c.mins ? (Math.round(c.mins / 60 * 10) / 10) + ' h' : ''), c.provider].filter(Boolean).join('  •  ');
      card.appendChild(el('p', 'muted m365-crs__meta', meta));
      card.appendChild(el('p', 'rec-card__desc', c.desc || ''));
      const btn = el('button', 'btn btn--primary btn--sm', 'Open course');
      btn.type = 'button'; btn.addEventListener('click', () => openUrl(c.url));
      card.appendChild(btn);
      els.courses.appendChild(card);
    }
  }

  // ---------- resources ----------
  function renderResources() {
    els.res.innerHTML = '';
    for (const r of RESOURCES) {
      const row = el('div', 'm365-res__row');
      const txt = el('div');
      txt.append(el('div', 'm365-res__name', r.name), el('div', 'muted m365-res__desc', r.desc || ''));
      const btn = el('button', 'btn btn--ghost btn--sm', 'Open');
      btn.type = 'button'; btn.addEventListener('click', () => openUrl(r.url));
      row.append(txt, btn);
      els.res.appendChild(row);
    }
  }

  // ---------- live roadmap ----------
  function loadRoadmap() {
    if (!(window.m365 && window.m365.roadmap)) return;
    roadmapLoaded = true;
    els.rmMsg.textContent = 'Fetching the latest from Microsoft…';
    els.rmList.innerHTML = '';
    window.m365.roadmap().then((res) => {
      if (!res || !res.ok) {
        roadmapLoaded = false;
        els.rmMsg.textContent = 'Could not reach Microsoft right now (' + ((res && res.error) || 'offline') + '). The curated "What’s new" tab still works offline.';
        return;
      }
      els.rmMsg.textContent = '';
      if (!res.items.length) { els.rmMsg.textContent = 'No roadmap items came back.'; return; }
      for (const it of res.items) {
        const card = el('div', 'm365-up');
        const head = el('div', 'm365-up__head');
        if (it.status) head.appendChild(el('span', 'm365-up__cat', it.status));
        if (it.modified) head.appendChild(el('span', 'm365-up__date muted', String(it.modified).slice(0, 10)));
        card.appendChild(head);
        card.appendChild(el('h3', 'm365-up__title', it.title));
        if (it.desc) card.appendChild(el('p', 'm365-up__tldr', it.desc));
        if (it.tags && it.tags.length) card.appendChild(el('p', 'muted m365-up__meta', it.tags.join(' · ')));
        const a = el('button', 'btn btn--ghost btn--sm', 'View on Microsoft roadmap');
        a.type = 'button'; a.addEventListener('click', () => openUrl(it.url));
        card.appendChild(a);
        els.rmList.appendChild(card);
      }
    }).catch(() => { roadmapLoaded = false; els.rmMsg.textContent = 'Could not load the live roadmap.'; });
  }

  // ---------- nav badge for new items ----------
  function navBadge(show, count) {
    const tab = document.querySelector('.tab[data-tab="m365"]');
    if (!tab) return;
    let dot = tab.querySelector('.nav-badge');
    if (show) { if (!dot) { dot = el('span', 'nav-badge'); tab.appendChild(dot); } dot.textContent = count > 0 ? String(count) : ''; }
    else if (dot) dot.remove();
  }

  function loadFeed() {
    if (!(window.m365 && window.m365.feed)) return;
    window.m365.feed().then((res) => {
      if (!res || !res.ok) return;
      UPDATES = res.updates || []; COURSES = res.courses || []; RESOURCES = res.resources || [];
      NEW = new Set((res.newIds || []).map(String));
      if (els.updated && res.updated) els.updated.textContent = 'Last reviewed ' + res.updated + '.';
      if (els.note && res.note) els.note.textContent = res.note;
      renderUpCats(); renderUpdates(); renderCrsCats(); renderCourses(); renderResources();
      if (NEW.size) { navBadge(true, NEW.size); toast(NEW.size + ' new Microsoft 365 update' + (NEW.size === 1 ? '' : 's') + '.'); }
    }).catch(() => {});
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.cats = $('#m365Cats'); els.updates = $('#m365Updates'); els.note = $('#m365Note'); els.updated = $('#m365Updated');
    els.crsCats = $('#m365CourseCats'); els.courses = $('#m365Courses'); els.res = $('#m365Resources');
    els.rmList = $('#m365RoadmapList'); els.rmMsg = $('#m365RoadmapMsg');
    if (!els.updates) return;

    Array.from(document.querySelectorAll('.m365-tab')).forEach((b) => b.addEventListener('click', () => showSection(b.dataset.m365)));
    const rb = $('#m365RoadmapBtn'); if (rb) rb.addEventListener('click', () => { roadmapLoaded = false; loadRoadmap(); });

    // Clear the "new" flag when the tech opens the tab.
    const tab = document.querySelector('.tab[data-tab="m365"]');
    if (tab) tab.addEventListener('click', () => {
      if (NEW.size && window.m365.markSeen) window.m365.markSeen(UPDATES.map((u) => u.id));
      navBadge(false);
    });

    // Settings feed-URL wiring.
    const inp = $('#setM365FeedUrl'); const save = $('#setM365FeedSave'); const status = $('#setM365FeedStatus');
    if (inp && window.m365 && window.m365.getFeedUrl) {
      window.m365.getFeedUrl().then((r) => { if (r && r.url) inp.value = r.url; }).catch(() => {});
      save && save.addEventListener('click', () => {
        window.m365.setFeedUrl(inp.value.trim()).then(() => {
          if (status) status.textContent = 'Saved. Refreshing…';
          NEW = new Set(); loadFeed();
          setTimeout(() => { if (status) status.textContent = 'Saved.'; }, 1500);
        }).catch(() => { if (status) status.textContent = 'Could not save.'; });
      });
    }

    loadFeed();
  });
})();
