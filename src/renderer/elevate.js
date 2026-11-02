'use strict';

// Shows the "running without admin" banner and relaunches elevated on request.
window.addEventListener('DOMContentLoaded', async () => {
  const banner = document.getElementById('elevBanner');
  const btn = document.getElementById('elevBtn');
  if (!banner || !window.appInfo) return;

  try {
    const elevated = await window.appInfo.isElevated();
    banner.hidden = !!elevated;
    document.body.classList.toggle('not-elevated', !elevated);
  } catch {
    banner.hidden = true;
  }

  if (btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Starting…';
      try {
        await window.appInfo.relaunchElevated();
      } catch {
        btn.disabled = false;
        btn.textContent = 'Run as administrator';
      }
    });
  }
});
