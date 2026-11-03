'use strict';

// Internet speed test using Cloudflare's public speed backend
// (speed.cloudflare.com). Runs in the main process (Node fetch) so the
// renderer's CSP doesn't block it. Reports latency + download + upload.
const BASE = 'https://speed.cloudflare.com';

async function measureLatency(samples) {
  const lat = [];
  for (let i = 0; i < samples; i++) {
    const t = Date.now();
    try { await fetch(BASE + '/__down?bytes=0', { cache: 'no-store' }); lat.push(Date.now() - t); }
    catch { /* ignore a dropped sample */ }
  }
  if (!lat.length) return { min: null, avg: null };
  lat.sort((a, b) => a - b);
  return { min: lat[0], avg: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) };
}

async function speedTest(onProgress) {
  const emit = throttle(onProgress, 400);
  const out = { ok: false };

  onProgress('Measuring latency…');
  const lat = await measureLatency(8);
  out.latencyMs = lat.min;
  out.latencyAvgMs = lat.avg;
  if (lat.min != null) onProgress('Latency ' + lat.min + ' ms (avg ' + lat.avg + ' ms)');

  // Download: stream a sized payload and time the whole transfer.
  onProgress('Testing download…');
  const dlBytes = 26214400; // 25 MB
  {
    const t = Date.now();
    const res = await fetch(BASE + '/__down?bytes=' + dlBytes, { cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error('Download endpoint returned HTTP ' + res.status);
    const reader = res.body.getReader();
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      const el = (Date.now() - t) / 1000;
      if (el > 0) emit('Download ' + (got * 8 / el / 1e6).toFixed(0) + ' Mbps (' + (got / 1048576).toFixed(0) + ' MB)');
    }
    const el = Math.max(0.001, (Date.now() - t) / 1000);
    out.downloadMbps = +(got * 8 / el / 1e6).toFixed(1);
  }

  // Upload: POST a buffer and time it.
  onProgress('Testing upload…');
  const upBytes = 10 * 1024 * 1024; // 10 MB
  {
    const buf = Buffer.alloc(upBytes, 0x78);
    const t = Date.now();
    const res = await fetch(BASE + '/__up', { method: 'POST', body: buf, headers: { 'Content-Type': 'application/octet-stream' } });
    if (!res.ok) throw new Error('Upload endpoint returned HTTP ' + res.status);
    await res.arrayBuffer().catch(() => {});
    const el = Math.max(0.001, (Date.now() - t) / 1000);
    out.uploadMbps = +(upBytes * 8 / el / 1e6).toFixed(1);
  }

  out.ok = true;
  return out;
}

function throttle(fn, ms) {
  let last = 0;
  return (msg) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(msg); } };
}

module.exports = { speedTest };
