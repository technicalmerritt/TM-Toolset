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
    loc.textContent = it.location || '';
    info.append(nm, cmd, loc);

    el.append(lab, info);

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
