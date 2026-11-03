'use strict';

// Fetches current tech / IT / repair news from a set of reputable RSS/Atom
// feeds, merges, de-dupes and sorts by date. Read-only, no tracking.

const FEEDS = [
  { source: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/' },
  { source: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/' },
  { source: 'The Register', url: 'https://www.theregister.com/headlines.atom' },
  { source: "Tom's Hardware", url: 'https://www.tomshardware.com/feeds/all' },
  { source: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { source: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { source: 'Windows Central', url: 'https://www.windowscentral.com/feed' },
  { source: 'How-To Geek', url: 'https://www.howtogeek.com/feed/' },
];

function stripCdata(s) {
  return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}
function decode(s) {
  return stripCdata(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
function pick(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
  return m ? m[1] : '';
}

function parseFeed(xml, source) {
  const items = [];
  let blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi);
  if (!blocks) blocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi);
  if (!blocks) return items;
  for (const b of blocks) {
    const title = decode(pick(b, 'title'));
    let link = decode(pick(b, 'link'));
    if (!link || /^https?:/i.test(link) === false) {
      const m = b.match(/<link[^>]*href="([^"]+)"/i);
      if (m) link = m[1];
    }
    link = String(link || '').trim();
    const date = decode(pick(b, 'pubDate') || pick(b, 'published') || pick(b, 'updated') || pick(b, 'dc:date'));
    let summary = decode(pick(b, 'description') || pick(b, 'summary') || pick(b, 'content:encoded'));
    if (summary.length > 260) summary = summary.slice(0, 260) + '…';
    if (title && /^https?:/i.test(link)) items.push({ title, link, source, date, summary });
  }
  return items;
}

async function fetchFeed(feed) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'TM-Toolset/1.0 (+technician news reader)', 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
      redirect: 'follow',
    });
    clearTimeout(to);
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeed(xml, feed.source);
  } catch {
    return [];
  }
}

async function fetchNews() {
  const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f)));
  let items = [];
  for (const r of results) if (r.status === 'fulfilled' && Array.isArray(r.value)) items = items.concat(r.value);
  // de-dupe by link
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (seen.has(it.link)) continue;
    seen.add(it.link);
    out.push(it);
  }
  out.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  return { ok: true, items: out.slice(0, 90), fetchedAt: new Date().toISOString(), sources: FEEDS.map((f) => f.source) };
}

module.exports = { fetchNews };
