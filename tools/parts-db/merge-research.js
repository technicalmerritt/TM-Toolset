#!/usr/bin/env node
/*
 * merge-research.js — upsert parts-researcher output into parts-db.json
 *
 * Usage:
 *   node tools/parts-db/merge-research.js research1.json [research2.json ...]
 *   node tools/parts-db/merge-research.js --db path/to/parts-db.json research.json
 *
 * Each research file is a JSON array in the parts-researcher shape, one object
 * per model with brand/model/years/aliases and either a nested `parts:{...}`
 * object or the parts flat on the object. Every part is
 * {numbers:[], note, confidence, source}.
 *
 * The tool MERGES into the existing database:
 *   - an incoming model is matched to an existing one by id, then by
 *     normalised model name, then by alias token overlap; matched models keep
 *     their existing id (so curated ids like "dell-lat-5420" are never broken);
 *   - part numbers are merged by part number (dedup, case-insensitive), so a
 *     human-confirmed pin (confidence 100) is never downgraded by a researched
 *     number;
 *   - charge-port / RAM / SSD notes populate model-level gotcha notes.
 * Nothing is deleted. Review the printed report, then commit parts-db.json.
 */
const fs = require('fs');
const path = require('path');

const PARTS = ['screen','battery','chargeport','keyboard','lid','palmrest','fan','hinges','ram','ssd'];
const NOTE_PARTS = new Set(['chargeport','ram','ssd']);

let args = process.argv.slice(2);
let dbPath = path.join(__dirname, '..', '..', 'parts-db.json');
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--db') { dbPath = args[++i]; continue; }
  files.push(args[i]);
}
if (!files.length) { console.error('usage: merge-research.js [--db parts-db.json] research.json ...'); process.exit(1); }

let db;
try { db = JSON.parse(fs.readFileSync(dbPath,'utf8')); }
catch { db = { version:2, updated:'', models:{}, entries:{} }; }
if (!db.models) db.models = {};
if (!db.entries) db.entries = {};

const norm = s => (s||'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const idFor = (brand,model) => norm(brand).replace(/[^a-z0-9]/g,'') + '-' +
  (model||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

// A token is only trustworthy for matching if it is a genuine model/chassis
// CODE: it must contain a digit AND be either hyphenated (cb315-3h, cb314-1h)
// or long (>=6: np950xdb, da0zcatb8d0). This deliberately EXCLUDES short
// line-markers that merely contain digits — x360, x1, r752t, c733 — because
// those are shared across unrelated models of one brand (e.g. Envy x360 laptop
// vs Chromebook x360) and would wrongly collapse distinct models together.
// Idempotent re-runs still match via the exact normalised model name below, so
// erring toward "create new" here is safe: a visible duplicate beats a silent
// bad merge into a good model.
const isCode = t => /\d/.test(t) && (t.includes('-') || t.length >= 6);

// index existing models for matching
const byNormModel = {};            // normalised model string -> id
const aliasToId = {};              // code-like alias token -> id
for (const id in db.models) {
  const m = db.models[id];
  byNormModel[norm(m.model)] = id;
  (m.aliases||'').toLowerCase().split(/\s+/).filter(isCode).forEach(t => { if(!aliasToId[t]) aliasToId[t]=id; });
}

function matchId(e) {
  const cand = e.id || idFor(e.brand, e.model);
  if (db.models[cand]) return cand;
  const nm = norm(e.model);
  if (byNormModel[nm]) return byNormModel[nm];
  // code-like alias token overlap (same brand only)
  const toks = (e.aliases||'').toLowerCase().split(/\s+/).filter(isCode);
  for (const t of toks) {
    const hit = aliasToId[t];
    if (hit && db.models[hit] && norm(db.models[hit].brand) === norm(e.brand)) return hit;
  }
  return cand; // new
}

const report = { created:[], updated:[], numbersAdded:0, notesSet:0 };

for (const f of files) {
  const arr = JSON.parse(fs.readFileSync(f,'utf8'));
  for (const e of arr) {
    const parts = e.parts || e;         // nested or flat
    const id = matchId(e);
    const isNew = !db.models[id];
    if (isNew) {
      db.models[id] = { brand:e.brand, model:e.model, aliases:(e.aliases||'').toLowerCase(), years:e.years||'', notes:{} };
      byNormModel[norm(e.model)] = id;
      report.created.push(id);
    } else {
      const m = db.models[id];
      if (!m.notes) m.notes = {};
      if (!m.years && e.years) m.years = e.years;
      if (e.aliases) {
        const have = new Set((m.aliases||'').split(/\s+/).filter(Boolean));
        e.aliases.toLowerCase().split(/\s+/).filter(Boolean).forEach(t=>have.add(t));
        m.aliases = [...have].join(' ');
      }
      if (!report.created.includes(id) && !report.updated.includes(id)) report.updated.push(id);
    }
    const m = db.models[id];
    for (const part of PARTS) {
      const p = parts[part];
      if (!p) continue;
      const note = (p.note||'').trim();
      const nums = Array.isArray(p.numbers) ? p.numbers.filter(Boolean) : [];
      if (NOTE_PARTS.has(part) && note) {
        if (!m.notes[part] || note.length > m.notes[part].length) { m.notes[part] = note; report.notesSet++; }
      }
      if (!nums.length) continue;
      const key = id + '|' + part;
      if (!db.entries[key]) db.entries[key] = { model:m.model, modelId:id, part, numbers:[] };
      const seen = new Set(db.entries[key].numbers.map(x=>x.pn.toUpperCase()));
      for (const pn of nums) {
        if (seen.has(pn.toUpperCase())) continue;       // never overwrite an existing (possibly pinned) number
        seen.add(pn.toUpperCase());
        db.entries[key].numbers.push({ pn, note, confidence:(typeof p.confidence==='number'?p.confidence:60), confirmed:false, source:'researched' });
        report.numbersAdded++;
      }
    }
  }
}

db.version = 2;
db.updated = new Date().toISOString().slice(0,10);
fs.writeFileSync(dbPath, JSON.stringify(db,null,1));

const nModels = Object.keys(db.models).length;
const nEntries = Object.keys(db.entries).length;
let nNums=0; for (const k in db.entries) nNums += db.entries[k].numbers.length;
console.log('merged into', dbPath);
console.log('  new models   :', report.created.length, report.created.join(', ') || '(none)');
console.log('  models updated:', report.updated.length);
console.log('  numbers added :', report.numbersAdded);
console.log('  gotcha notes set:', report.notesSet);
console.log('  DB totals -> models', nModels, 'entries', nEntries, 'numbers', nNums);
