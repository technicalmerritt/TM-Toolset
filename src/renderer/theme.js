'use strict';

// White-label theming: brand name, logo, and a colour scheme derived from a
// base background + accent, with automatic light/dark text contrast.
(function () {
  const DEFAULT = { brand: '', accent: '#ff6600', bg: '#0e1b33', logo: '', appIcon: '' };
  const PRESETS = [
    ['TM Default', '#0e1b33', '#ff6600'],
    ['Light', '#f4f6fa', '#ff6600'],
    ['Graphite', '#1b1d22', '#4a9eff'],
    ['Slate', '#141a33', '#7b5cff'],
    ['Emerald', '#0f2420', '#16c784'],
    ['Crimson', '#241014', '#ff4d4f'],
    ['Paper', '#faf9f6', '#2f6df6'],
    ['Oaklands', '#f5f7f4', '#0a7f39', { brand: 'Oaklands Computer Services', logo: 'logo-oaklands.svg', appIcon: 'oaklands' }],
  ];
  const DEFAULT_TITLE = 'TM Toolset';
  let current = Object.assign({}, DEFAULT);

  // True when a brand/logo/appIcon value was put there by a built-in preset
  // (e.g. Oaklands) rather than typed or uploaded by the user. Switching to
  // another preset drops those, but keeps anything the user set themselves.
  function fromPreset(key, val) { return !!val && PRESETS.some((p) => p[3] && p[3][key] === val); }

  function $(s) { return document.querySelector(s); }
  function hexToRgb(h) { h = ('' + h).replace('#', ''); if (h.length === 3) h = h.split('').map((c) => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function toHex(r, g, b) { const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); return '#' + c(r) + c(g) + c(b); }
  function mix(a, b, t) { const A = hexToRgb(a), B = hexToRgb(b); return toHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
  function lum(h) { const p = hexToRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; }
  function isHex(h) { return /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test('' + h); }

  function derive(bg, accent) {
    const dark = lum(bg) < 0.4;
    const toward = dark ? '#ffffff' : '#000000';
    const text = dark ? '#f3f3f4' : '#16202e';
    const onAccent = lum(accent) > 0.55 ? '#16202e' : '#ffffff';
    return {
      '--bg': bg,
      '--bg-elev': mix(bg, toward, 0.06),
      '--bg-elev-2': mix(bg, toward, 0.13),
      '--border': mix(bg, toward, 0.22),
      '--text': text,
      '--text-dim': mix(text, bg, 0.42),
      '--accent': accent,
      '--accent-hover': mix(accent, dark ? '#ffffff' : '#000000', 0.15),
      '--on-accent': onAccent,
      '--navy': mix(bg, toward, 0.10),
      '--navy-2': mix(bg, toward, 0.16),
      '_dark': dark,
    };
  }

  function apply(theme) {
    const t = Object.assign({}, DEFAULT, theme || {});
    if (!isHex(t.bg)) t.bg = DEFAULT.bg;
    if (!isHex(t.accent)) t.accent = DEFAULT.accent;
    current = t;
    const vars = derive(t.bg, t.accent);
    const root = document.documentElement;
    for (const k of Object.keys(vars)) { if (k[0] === '-') root.style.setProperty(k, vars[k]); }
    // logo: custom, else the built-in that suits the background
    const img = document.querySelector('.brand__logo');
    if (img) {
      if (t.logo) img.src = t.logo;
      else img.src = vars._dark ? 'logo-dark.svg' : 'logo-light.svg';
      img.alt = t.brand || 'Technical Merritt Computer Services';
    }
    // Title bar follows the brand, and falls back when the brand is cleared.
    try { document.title = t.brand || DEFAULT_TITLE; } catch { /* ignore */ }
    // App icon (window + taskbar) follows the theme.
    try { if (window.theme && window.theme.setAppIcon) window.theme.setAppIcon(t.appIcon || ''); } catch { /* ignore */ }
    try { localStorage.setItem('tmTheme', JSON.stringify(t)); } catch { /* ignore */ }
  }

  function save() { if (window.theme && window.theme.set) window.theme.set(current); }

  // ---- Settings UI wiring ----
  function fillSettings() {
    const b = $('#brandName'); if (b) b.value = current.brand || '';
    const a = $('#brandAccent'); if (a) a.value = isHex(current.accent) ? current.accent : '#ff6600';
    const g = $('#brandBg'); if (g) g.value = isHex(current.bg) ? current.bg : '#0e1b33';
    const prev = $('#brandLogoPreview'); if (prev) { if (current.logo) { prev.src = current.logo; prev.hidden = false; } else prev.hidden = true; }
    const ip = $('#brandAppIconPreview');
    if (ip) {
      const v = current.appIcon || '';
      ip.src = !v || v === 'default' ? '../icon.png'
        : (v === 'oaklands' ? '../icons/oaklands-icon.png'
          : (/^data:/.test(v) ? v : ('../' + v)));
    }
  }

  function wireSettings() {
    const name = $('#brandName'), acc = $('#brandAccent'), bg = $('#brandBg');
    if (!bg) return;
    const live = () => { apply({ brand: name.value, accent: acc.value, bg: bg.value, logo: current.logo, appIcon: current.appIcon }); save(); };
    name.addEventListener('input', live);
    acc.addEventListener('input', live);
    bg.addEventListener('input', live);
    $('#brandLogoPick') && $('#brandLogoPick').addEventListener('click', () => {
      window.theme.pickLogo().then((r) => {
        if (r && r.ok && r.data) { current.logo = r.data; apply(current); save(); fillSettings(); }
        else if (r && r.error === 'too-big') { const s = $('#brandStatus'); if (s) s.textContent = 'That image is over 2 MB — use a smaller logo.'; }
      });
    });
    $('#brandLogoClear') && $('#brandLogoClear').addEventListener('click', () => { current.logo = ''; apply(current); save(); fillSettings(); });
    $('#brandAppIconPick') && $('#brandAppIconPick').addEventListener('click', () => {
      window.theme.pickAppIcon().then((r) => {
        if (r && r.cancelled) return;
        if (r && r.ok && r.data) { current.appIcon = r.data; apply(current); save(); fillSettings(); }
        else { const s = $('#brandStatus'); if (s) s.textContent = 'Could not use that image as an icon.'; }
      });
    });
    $('#brandAppIconReset') && $('#brandAppIconReset').addEventListener('click', () => { current.appIcon = ''; apply(current); save(); fillSettings(); });
    $('#brandReset') && $('#brandReset').addEventListener('click', () => { apply(Object.assign({}, DEFAULT)); save(); fillSettings(); });
    const presetWrap = $('#brandPresets');
    if (presetWrap) {
      presetWrap.innerHTML = '';
      for (const [label, pbg, pacc, extra] of PRESETS) {
        const chip = document.createElement('button');
        chip.type = 'button'; chip.className = 'ov-chip'; chip.textContent = label;
        chip.addEventListener('click', () => {
          const e = extra || {};
          // A preset's own branding replaces what is there; otherwise keep the
          // user's custom name/logo/icon but drop any left by another preset.
          const pick = (k) => (e[k] != null ? e[k] : (fromPreset(k, current[k]) ? '' : current[k]));
          apply({
            brand: pick('brand'),
            accent: pacc, bg: pbg,
            logo: pick('logo'),
            appIcon: pick('appIcon'),
          });
          save(); fillSettings();
        });
        presetWrap.appendChild(chip);
      }
    }
  }

  // Instant apply from the per-install cache (avoids a flash of default theme),
  // then reconcile with the stored config (source of truth, travels on USB).
  try { const cached = JSON.parse(localStorage.getItem('tmTheme') || 'null'); if (cached) apply(cached); } catch { /* ignore */ }

  window.addEventListener('DOMContentLoaded', () => {
    wireSettings();
    if (window.theme && window.theme.get) {
      window.theme.get().then((r) => { if (r && r.theme) apply(r.theme); fillSettings(); }).catch(() => fillSettings());
    } else fillSettings();
  });
})();
