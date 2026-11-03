'use strict';

(function () {
  const els = {};
  let loaded = false;
  let loading = false;

  function $(s) {
    return document.querySelector(s);
  }

  function arr(v) {
    return Array.isArray(v) ? v : v == null ? [] : [v];
  }

  function toast(message, kind) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = message;
    t.className = 'toast toast--show' + (kind === 'error' ? ' toast--error' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 3200);
  }

  async function load() {
    if (loading) return;
    loading = true;
    loaded = true;
    els.status.hidden = false;
    els.error.hidden = true;
    els.list.hidden = true;
    try {
      const res = await window.startupItems.list();
      if (!res || res.ok !== true) {
        showError(res ? res.error : 'Unknown error');
        return;
      }
      render(arr(res.data && res.data.items));
    } catch (e) {
      showError((e && e.message) || String(e));
    } finally {
      loading = false;
    }
  }

  function showError(msg) {
    els.status.hidden = true;
    els.list.hidden = true;
    els.errorDetail.textContent = msg || '(no detail)';
    els.error.hidden = false;
  }

  function render(items) {
    els.status.hidden = true;
    els.error.hidden = true;
    els.list.hidden = false;
    els.list.innerHTML = '';
    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'No startup items found.';
      els.list.appendChild(p);
      return;
    }
    const legend = document.createElement('p');
    legend.className = 'muted su-legend';
    legend.innerHTML = 'Advice is a guide from signature, publisher and location - hover a badge for the reason. ' +
      '<span class="su-advice su-advice--keep">Keep</span> leave on · ' +
      '<span class="su-advice su-advice--optional">Safe to disable</span> optional · ' +
      '<span class="su-advice su-advice--review">Review</span> check it first.';
    els.list.appendChild(legend);

    const groups = {};
    for (const it of items) (groups[it.type] = groups[it.type] || []).push(it);
    for (const type of Object.keys(groups).sort()) {
      const sec = document.createElement('section');
      sec.className = 'su-group';
      const h = document.createElement('h3');
      h.textContent = `${type} (${groups[type].length})`;
      sec.appendChild(h);
      for (const it of groups[type]) sec.appendChild(row(it));
      els.list.appendChild(sec);
    }
  }

  // Risk-based recommendation for a startup item (guidance, not gospel).
  function advise(it) {
    const name = (it.name || '').toLowerCase();
    const exe = (it.exePath || '').toLowerCase();
    const pub = (it.publisher || '').toLowerCase();
    const signer = (it.signer || '').toLowerCase();
    const signed = it.signed || '';
    const hay = name + ' ' + exe + ' ' + pub + ' ' + signer;

    const badLoc = /\\temp\\|\\tmp\\|\\downloads\\|\\\$recycle|\\public\\|\\windows\\temp\\/.test(exe);
    const userExe = /\\appdata\\|\\users\\/.test(exe);

    if (badLoc || signed === 'invalid') {
      return { level: 'review', label: 'Review', reason: (signed === 'invalid' ? 'Its digital signature is INVALID. ' : '') + 'Runs from an unusual location (' + (it.exePath || 'unknown') + '). Investigate before trusting - this is where unwanted/malicious items often hide.' };
    }

    if (/(defender|securityhealth|security health|windows security|malwarebytes|bitdefender|kaspersky|\beset\b|sophos|norton|symantec|mcafee|avast|\bavg\b|webroot|trend ?micro|sentinel|crowdstrike|huntress)/.test(hay)) {
      return { level: 'keep', label: 'Keep', reason: 'Security software - leave this enabled.' };
    }
    if (/(realtek|waves ?audio|\baudio\b|synaptics|\belan\b|touchpad|smartaudio|nahimic|igfxtray|intel.*(graphics|management)|hotkey)/.test(hay)) {
      return { level: 'keep', label: 'Keep', reason: 'Driver / hardware helper - usually best left enabled.' };
    }
    if (/microsoft/.test(signer)) {
      if (/(onedrive|teams|skype|cortana|yourphone|phone ?link)/.test(hay)) {
        return { level: 'optional', label: 'Safe to disable', reason: 'A Microsoft app set to auto-start. Disabling it only speeds up boot - it still runs when you open it.' };
      }
      return { level: 'keep', label: 'Keep', reason: 'Signed by Microsoft - generally fine to leave enabled.' };
    }
    if (/(update|updater|helper|assistant|launcher|autostart|\bsync\b|cloud|spotify|steam|discord|epic ?games|origin|\bea app\b|uplay|ubisoft|itunes|bonjour|quicktime|adobe|acrobat|creative ?cloud|\breader\b|java|\bjre\b|zoom|slack|dropbox|google ?drive|googleupdate|backup|vantage|armoury|corsair|icue|logitech|\bghub\b|\blogi\b|razer|synapse|geforce|nvidia|gigabyte|\basus\b|\baura\b|printer|\bhp\b|\bdell\b|lenovo|acer|wildtangent|coupon|shopping|webcompanion|driverbooster|iobit|ccleaner|utorrent|wechat)/.test(hay)) {
      return { level: 'optional', label: 'Safe to disable', reason: 'A third-party app / updater set to auto-start. Disabling only stops it launching at boot - the app still works when you open it.' };
    }
    if (signed === 'unsigned') {
      return { level: 'review', label: 'Review', reason: 'This program is not digitally signed' + (userExe ? ' and runs from a user folder' : '') + '. Not necessarily bad, but worth confirming what it is.' };
    }
    if (signed === 'valid') {
      return { level: 'optional', label: 'Optional', reason: 'Signed by ' + (it.signer || 'a known publisher') + '. Disabling only stops it auto-starting - keep it if you use ' + (it.name || 'it') + ' regularly.' };
    }
    return { level: 'optional', label: 'Optional', reason: 'Disabling only stops it auto-starting at boot.' };
  }

  function row(it) {
    const el = document.createElement('div');
    el.className = 'su-row' + (it.enabled ? '' : ' su-row--off');

    const lab = document.createElement('label');
    lab.className = 'switch';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!it.enabled;
    const sl = document.createElement('span');
    sl.className = 'slider';
    lab.append(cb, sl);

    const info = document.createElement('div');
    info.className = 'su-info';
    const nm = document.createElement('div');
    nm.className = 'su-name';
    nm.textContent = it.name;
    const cmd = document.createElement('div');
    cmd.className = 'su-cmd';
    cmd.textContent = it.command || '';
    cmd.title = it.command || '';
    const loc = document.createElement('div');
    loc.className = 'su-loc';
    const locBits = [it.location || ''];
    if (it.publisher) locBits.push(it.publisher);
    if (it.signed === 'valid') locBits.push('signed');
    else if (it.signed === 'unsigned') locBits.push('unsigned');
    else if (it.signed === 'invalid') locBits.push('BAD signature');
    loc.textContent = locBits.filter(Boolean).join('  ·  ');
    info.append(nm, cmd, loc);

    const adv = advise(it);
    const badge = document.createElement('span');
    badge.className = 'su-advice su-advice--' + adv.level;
    badge.textContent = adv.label;
    badge.title = adv.reason;

    el.append(lab, info, badge);

    cb.addEventListener('change', async () => {
      const want = cb.checked;
      cb.disabled = true;
      try {
        const res = await window.startupItems.toggle(it, want);
        if (res && res.ok) {
          it.enabled = want;
          el.classList.toggle('su-row--off', !want);
          toast((want ? 'Enabled ' : 'Disabled ') + it.name);
        } else {
          cb.checked = !want;
          toast((res && res.message) || 'Could not change that item.', 'error');
        }
      } catch (e) {
        cb.checked = !want;
        toast('Error: ' + ((e && e.message) || e), 'error');
      } finally {
        cb.disabled = false;
      }
    });

    return el;
  }

  window.addEventListener('DOMContentLoaded', () => {
    els.status = $('#startupStatus');
    els.error = $('#startupError');
    els.errorDetail = $('#startupErrorDetail');
    els.list = $('#startupList');
    els.refresh = $('#startupRefresh');
    if (!els.list) return;

    els.refresh && els.refresh.addEventListener('click', load);
    // Lazy-load the first time the tab is opened.
    const tab = document.querySelector('.tab[data-tab="startup"]');
    if (tab) tab.addEventListener('click', () => { if (!loaded) load(); });
  });
})();
