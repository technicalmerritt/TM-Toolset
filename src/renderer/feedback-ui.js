'use strict';

// Feedback & fixes: jot bugs/ideas, keep them, batch them up later.
// Mic support: live dictation via the Web Speech API when the runtime provides
// it; otherwise fall back to recording a voice memo (saved + replayable) so a
// spoken note is never lost even without transcription.
(function () {
  const els = {};
  let ITEMS = [];
  let filter = 'open';
  let recog = null, listening = false;       // speech-to-text
  let mediaRec = null, recording = false, chunks = []; // voice-memo fallback
  const speechSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function toast(msg) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.className = 'toast toast--show'; clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 3600); }
  function openUrl(url) { try { if (window.sys && window.sys.openUrl) window.sys.openUrl(url); } catch { /* ignore */ } }

  function copyText(text) {
    // navigator.clipboard isn't reliable from file://; use a hidden textarea.
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  function typeChecked() { const r = document.querySelector('input[name="fbType"]:checked'); return r ? r.value : 'bug'; }

  // ---------- list ----------
  function counts() {
    let open = 0, done = 0;
    for (const i of ITEMS) { if (i.status === 'done') done++; else open++; }
    return { open, done };
  }
  function renderCount() {
    const c = counts();
    if (els.count) els.count.textContent = c.open + ' open' + (c.done ? (', ' + c.done + ' done') : '');
  }
  function fmtDate(iso) { try { return new Date(iso).toLocaleDateString(); } catch { return ''; } }

  function row(item) {
    const r = el('div', 'fb-item' + (item.status === 'done' ? ' fb-item--done' : ''));
    const ico = el('span', 'fb-item__ico', item.type === 'idea' ? '💡' : '🐛');
    const body = el('div', 'fb-item__body');
    const txt = el('div', 'fb-item__text', item.text || (item.audio ? '(voice memo)' : ''));
    body.appendChild(txt);
    const meta = el('div', 'fb-item__meta muted', (item.type === 'idea' ? 'Idea' : 'Bug') + ' • ' + fmtDate(item.created));
    body.appendChild(meta);
    if (item.audio) {
      const play = el('button', 'btn btn--ghost btn--xs', '▶ Play memo');
      play.type = 'button'; play.addEventListener('click', () => window.feedback.playAudio(item.audio));
      body.appendChild(play);
    }
    const acts = el('div', 'fb-item__acts');
    const doneBtn = el('button', 'btn btn--ghost btn--xs', item.status === 'done' ? 'Reopen' : 'Done');
    doneBtn.type = 'button';
    doneBtn.addEventListener('click', () => {
      window.feedback.update({ id: item.id, status: item.status === 'done' ? 'open' : 'done' }).then(load);
    });
    const del = el('button', 'btn btn--ghost btn--xs', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => {
      if (!window.confirm('Delete this note?')) return;
      window.feedback.remove({ id: item.id, audioPath: item.audio || '' }).then(load);
    });
    acts.append(doneBtn, del);
    r.append(ico, body, acts);
    return r;
  }

  function renderList() {
    els.list.innerHTML = '';
    const shown = ITEMS.filter((i) => filter === 'all' ? true : (filter === 'done' ? i.status === 'done' : i.status !== 'done'));
    for (const i of shown) els.list.appendChild(row(i));
    els.empty.hidden = shown.length > 0;
    renderCount();
  }

  function load() {
    if (!(window.feedback && window.feedback.list)) return;
    window.feedback.list().then((r) => { if (r && r.ok) { ITEMS = r.items || []; renderList(); } }).catch(() => {});
  }

  // ---------- add ----------
  function addItem(extra) {
    const text = (els.text.value || '').trim();
    const payload = Object.assign({ type: typeChecked(), text }, extra || {});
    if (!payload.text && !payload.audio) { toast('Type something or record a memo first.'); return; }
    window.feedback.add(payload).then((r) => {
      if (r && r.ok) { els.text.value = ''; toast('Added.'); load(); }
      else toast('Could not add that.');
    }).catch(() => toast('Could not add that.'));
  }

  // ---------- mic: dictation ----------
  function startDictation() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    recog = new Ctor();
    recog.lang = 'en-GB'; recog.continuous = true; recog.interimResults = true;
    let base = els.text.value ? (els.text.value.replace(/\s+$/, '') + ' ') : '';
    recog.onresult = (e) => {
      let interim = '', finalAdd = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalAdd += t + ' '; else interim += t;
      }
      if (finalAdd) base += finalAdd;
      els.text.value = base + interim;
    };
    recog.onerror = (e) => {
      stopMic();
      // In plain Electron the online speech service often isn't available.
      if (e && (e.error === 'network' || e.error === 'service-not-allowed' || e.error === 'not-allowed')) {
        micMsg('Live dictation isn’t available in this build - recording a voice memo instead. Tap the mic to stop.');
        startRecording();
      } else {
        micMsg('Dictation stopped (' + ((e && e.error) || 'error') + ').');
      }
    };
    recog.onend = () => { if (listening) { try { recog.start(); } catch { /* ignore */ } } };
    try { recog.start(); listening = true; setMic(true, 'Listening… tap to stop'); micMsg('Speak now - your words appear in the box. Tap the mic again to stop.'); }
    catch { listening = false; startRecording(); }
  }

  // ---------- mic: voice-memo fallback ----------
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      mediaRec = new MediaRecorder(stream);
      mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      mediaRec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const data = await blobToDataUrl(blob);
        const saved = await window.feedback.saveAudio(data);
        if (saved && saved.ok) { addItem({ audio: saved.path }); micMsg('Voice memo saved to the list. Add a typed note too if you like.'); }
        else micMsg('Could not save the memo.');
      };
      mediaRec.start(); recording = true; setMic(true, 'Recording… tap to stop');
    } catch (e) {
      recording = false; setMic(false);
      micMsg('No microphone access (' + ((e && e.name) || 'blocked') + '). You can still type your note.');
    }
  }
  function blobToDataUrl(blob) { return new Promise((res) => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.readAsDataURL(blob); }); }

  function setMic(active, label) { els.mic.classList.toggle('fb-mic--on', !!active); els.mic.textContent = active ? ('⏹ ' + (label || 'Stop')) : '🎤 Dictate'; }
  function micMsg(m) { if (!els.micMsg) return; els.micMsg.hidden = !m; els.micMsg.textContent = m || ''; }

  function stopMic() {
    if (recog) { listening = false; try { recog.stop(); } catch { /* ignore */ } recog = null; }
    if (mediaRec && recording) { recording = false; try { mediaRec.stop(); } catch { /* ignore */ } mediaRec = null; }
    setMic(false);
  }
  function toggleMic() {
    if (listening || recording) { stopMic(); micMsg(''); return; }
    if (speechSupported) startDictation(); else startRecording();
  }

  // ---------- batch out ----------
  function batchText() {
    const open = ITEMS.filter((i) => i.status !== 'done');
    const bugs = open.filter((i) => i.type !== 'idea');
    const ideas = open.filter((i) => i.type === 'idea');
    let out = 'TM Toolset - feedback batch (' + new Date().toLocaleDateString() + ')\n';
    const list = (arr) => arr.map((i, n) => (n + 1) + '. ' + (i.text || '(voice memo - see app)') + '  [noted ' + fmtDate(i.created) + ']').join('\n');
    if (bugs.length) out += '\nBUGS / FIXES NEEDED\n' + list(bugs) + '\n';
    if (ideas.length) out += '\nIDEAS / SUGGESTIONS\n' + list(ideas) + '\n';
    if (!bugs.length && !ideas.length) out += '\n(no open items)\n';
    return out;
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.text = $('#fbText'); els.mic = $('#fbMic'); els.micMsg = $('#fbMicMsg'); els.count = $('#fbCount');
    els.list = $('#fbList'); els.empty = $('#fbEmpty');
    if (!els.list) return;

    $('#fbAdd').addEventListener('click', () => addItem());
    els.mic.addEventListener('click', toggleMic);
    if (!speechSupported) els.mic.title = 'Record a voice memo (live dictation not available in this build)';

    Array.from(document.querySelectorAll('.fb-f')).forEach((b) => b.addEventListener('click', () => {
      filter = b.dataset.fbf;
      Array.from(document.querySelectorAll('.fb-f')).forEach((x) => x.classList.toggle('fb-f--active', x === b));
      renderList();
    }));

    $('#fbCopy').addEventListener('click', () => { copyText(batchText()) ? toast('Open items copied to clipboard.') : toast('Could not copy.'); });
    $('#fbAskClaude').addEventListener('click', () => {
      copyText(batchText());
      openUrl('https://claude.ai/new');
      toast('Opened claude.ai - your notes are on the clipboard, just paste them in.');
    });
    $('#fbOpenDir').addEventListener('click', () => window.feedback.openDir());

    load();
  });
})();
