'use strict';

// Industry News: fetches headlines, lets you dismiss or mark "not interested".
// The "not interested" signal is remembered (per-viewer, localStorage) and used
// to hide similar items over time.
(function () {
  const els = {};
  let loaded = false;
  let loading = false;
  let items = [];

  const DISMISS_KEY = 'tm_news_dismissed';
  const PREF_KEY = 'tm_news_prefs';
  const FOCUS_KEY = 'tm_news_focus';
  let hideOffTopic = true;

  // Relevance to a PC-repair technician, from title + summary keywords.
  const HIGH_RE = /\b(windows|microsoft|update|patch|driver|bsod|blue screen|crash|ssd|nvme|hard drive|storage|cpu|gpu|ram|memory|bios|uefi|motherboard|laptop|desktop|boot|malware|ransomware|virus|trojan|phishing|vulnerab|cve|exploit|security|breach|hack|data recovery|repair|hardware|firmware|intel|amd|nvidia|chrome|edge|firefox|outlook|office|microsoft 365|printer|network|router|wi-?fi|password|backup|encrypt|powershell|registry|activation|overheat|battery|usb|azure|active directory|vpn|firewall|zero-?day|patch tuesday|windows 11|windows 10)\b/gi;
  const LOW_RE = /\b(netflix|movie|film|tv show|streaming|trailer|series|episode|best shows|game review|playstation|xbox|nintendo|sports|celebrity|discount|coupon|gift|shopping|recipe|tesla|nasa|space|stock market|box office|prime video|disney|wordle|headphones|earbuds|smartwatch)\b/gi;
  function relevance(it) {
    const text = ((it.title || '') + ' ' + (it.summary || '')).toLowerCase();
    const hi = (text.match(HIGH_RE) || []).length;
    const lo = (text.match(LOW_RE) || []).length;
    const score = hi * 2 - lo * 3;
    if (score >= 3) return 'high';
    if (score <= -2 || (lo > 0 && hi === 0)) return 'low';
    return 'med';
  }
  const REL_RANK = { high: 0, med: 1, low: 2 };
  const REL_LABEL = { high: 'Repair-relevant', med: 'General tech', low: 'Off-topic' };
  const STOP = new Set(['the', 'a', 'an', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you', 'are', 'was', 'has', 'have', 'will', 'new', 'how', 'why', 'what', 'its', 'into', 'out', 'can', 'now', 'get', 'gets', 'over', 'after', 'about', 'more', 'than', 'they', 'them', 'but', 'not', 'all', 'via', 'amp']);

  function $(s) { return document.querySelector(s); }
  function arr(v) { return Array.isArray(v) ? v : v == null ? [] : [v]; }
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function toast(msg) {
    const t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.className = 'toast toast--show';
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3000);
  }
  function load(key, def) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; } }
  function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* ignore */ } }

  function dismissed() { return new Set(load(DISMISS_KEY, [])); }
  function addDismissed(link) { const s = dismissed(); s.add(link); save(DISMISS_KEY, Array.from(s).slice(-500)); }
  function prefs() { return load(PREF_KEY, { sources: {}, keywords: {} }); }

  function keywords(title) {
    return String(title || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w));
  }

  function learnNotInterested(it) {
    const p = prefs();
    p.sources[it.source] = (p.sources[it.source] || 0) + 2;
    for (const k of keywords(it.title)) p.keywords[k] = (p.keywords[k] || 0) + 1;
    save(PREF_KEY, p);
    addDismissed(it.link);
  }

  // Hide an item if its source is heavily disliked, or it shares disliked keywords.
  function isSuppressed(it, p) {
    if ((p.sources[it.source] || 0) >= 6) return true;
    let hits = 0;
    for (const k of keywords(it.title)) if ((p.keywords[k] || 0) >= 2) { hits++; if (hits >= 2) return true; }
    return false;
  }

  function fmtAgo(dateStr) {
    const t = Date.parse(dateStr);
    if (!t) return '';
    const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 60) return mins + ' min ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    const days = Math.round(hrs / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  }

  async function fetchNews() {
    if (loading) return;
    loading = true; loaded = true;
    els.status.hidden = false; els.error.hidden = true; els.list.hidden = true;
    try {
      const res = await window.news.fetch();
      if (!res || res.ok !== true) { showError(res ? res.error : 'Unknown error'); return; }
      items = arr(res.items);
      render();
    } catch (e) { showError((e && e.message) || String(e)); }
    finally { loading = false; }
  }

  function showError(msg) {
    els.status.hidden = true; els.list.hidden = true;
    els.errorDetail.textContent = (msg || '(no detail)') + '\n\nThis needs an internet connection.';
    els.error.hidden = false;
  }

  function render() {
    els.status.hidden = true; els.error.hidden = true; els.list.hidden = false;
    els.list.innerHTML = '';
    const dis = dismissed();
    const p = prefs();
    let visible = items.filter((it) => !dis.has(it.link) && !isSuppressed(it, p));
    for (const it of visible) it._rel = relevance(it);
    if (hideOffTopic) visible = visible.filter((it) => it._rel !== 'low');
    // Most repair-relevant first, then newest.
    visible.sort((a, b) => (REL_RANK[a._rel] - REL_RANK[b._rel]) || ((Date.parse(b.date) || 0) - (Date.parse(a.date) || 0)));
    if (!visible.length) {
      els.list.appendChild(el('p', 'muted', 'Nothing to show. Try Refresh, turn off Repair focus, or Reset learning if you have hidden a lot.'));
      return;
    }
    for (const it of visible) els.list.appendChild(card(it));
  }

  function card(it) {
    const rel = it._rel || relevance(it);
    const c = el('article', 'news-card news-card--' + rel);
    const head = el('div', 'news-card__head');
    const left = el('div', 'news-card__meta');
    left.append(el('span', 'news-rel news-rel--' + rel, REL_LABEL[rel]), el('span', 'news-card__src', it.source));
    head.append(left, el('span', 'news-card__time', fmtAgo(it.date)));
    c.appendChild(head);

    const title = el('a', 'news-card__title', it.title);
    title.href = '#';
    title.addEventListener('click', (e) => { e.preventDefault(); openLink(it.link); });
    c.appendChild(title);

    if (it.summary) c.appendChild(el('p', 'news-card__sum', it.summary));

    const actions = el('div', 'news-card__actions');
    const read = el('button', 'btn btn--primary btn--sm', 'Read');
    read.type = 'button';
    read.addEventListener('click', () => openLink(it.link));
    const notint = el('button', 'btn btn--ghost btn--sm', '👎 Not interested');
    notint.type = 'button';
    notint.addEventListener('click', () => { learnNotInterested(it); render(); toast('Got it - fewer stories like that.'); });
    const hide = el('button', 'news-x', '×');
    hide.type = 'button';
    hide.title = 'Hide this story';
    hide.addEventListener('click', () => { addDismissed(it.link); render(); });
    actions.append(read, notint, hide);
    c.appendChild(actions);
    return c;
  }

  function openLink(url) {
    try { if (window.sys && window.sys.openUrl) window.sys.openUrl(url); } catch { /* ignore */ }
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.status = $('#newsStatus');
    els.error = $('#newsError');
    els.errorDetail = $('#newsErrorDetail');
    els.list = $('#newsList');
    els.refresh = $('#newsRefresh');
    els.reset = $('#newsReset');
    els.focus = $('#newsFocus');
    if (!els.list) return;
    try { hideOffTopic = load(FOCUS_KEY, true) !== false; } catch { hideOffTopic = true; }
    function syncFocusBtn() { if (els.focus) els.focus.textContent = 'Repair focus: ' + (hideOffTopic ? 'On' : 'Off'); }
    syncFocusBtn();
    els.focus && els.focus.addEventListener('click', () => {
      hideOffTopic = !hideOffTopic; save(FOCUS_KEY, hideOffTopic); syncFocusBtn();
      els.focus.classList.toggle('btn--primary', hideOffTopic); els.focus.classList.toggle('btn--ghost', !hideOffTopic);
      if (loaded) render();
    });
    els.refresh && els.refresh.addEventListener('click', () => { loaded = false; fetchNews(); });
    els.reset && els.reset.addEventListener('click', () => {
      save(PREF_KEY, { sources: {}, keywords: {} }); save(DISMISS_KEY, []);
      toast('Learning reset.'); render();
    });
    const tab = document.querySelector('.tab[data-tab="news"]');
    if (tab) tab.addEventListener('click', () => { if (!loaded) fetchNews(); });
  });
})();
