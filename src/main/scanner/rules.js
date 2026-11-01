'use strict';

// Pure evaluation layer: takes the raw data object produced by collect.ps1 and
// returns scored, categorised findings. No I/O here so it is easily testable.

const SEVERITY_WEIGHT = { critical: 22, warning: 9, info: 0, ok: 0 };

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// PowerShell ConvertTo-Json serialises a single-item list as a bare object,
// not a one-element array. Coerce anything we intend to iterate into an array.
function arr(v) {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function evaluate(d) {
  d = d || {};
  const findings = [];
  const add = (severity, category, title, summary, opts = {}) =>
    findings.push({
      severity,
      category,
      title,
      summary,
      detail: opts.detail || '',
      recommendation: opts.recommendation || '',
    });

  const sys = d.system || {};

  // ---------- System / OS lifecycle ----------
  const build = num(sys.buildNumber);
  const caption = sys.caption || 'Windows';
  if (build > 0 && build < 22000) {
    add(
      'warning',
      'System',
      'Windows 10 — past end of support',
      `${caption} (build ${build}). Microsoft ended free support for Windows 10 on 14 October 2025; without Extended Security Updates it no longer receives security patches.`,
      {
        recommendation:
          sys.tpmPresent && sys.secureBoot
            ? 'This machine has TPM and Secure Boot, so it looks eligible for Windows 11 — plan the in-place upgrade.'
            : 'Check Windows 11 eligibility (TPM 2.0 + Secure Boot + supported CPU), or enrol the machine in Extended Security Updates.',
      }
    );
  } else if (build >= 22000) {
    add('ok', 'System', 'Windows 11', `${caption}${sys.displayVersion ? ' ' + sys.displayVersion : ''} (build ${build}) — a supported release.`);
  }

  if (sys.isAdmin === false) {
    add('info', 'System', 'Scan ran without administrator rights', 'Some checks (BitLocker, TPM, Secure Boot, parts of the event log) may be incomplete.', {
      recommendation: 'Re-run the scanner as administrator for a full picture.',
    });
  }

  if (sys.tpmPresent === false) {
    add('info', 'Hardware', 'No TPM detected', 'No Trusted Platform Module was found. TPM 2.0 is required for Windows 11 and for BitLocker without a password.', {
      recommendation: 'Check whether a firmware TPM (Intel PTT / AMD fTPM) can be enabled in BIOS.',
    });
  }

  // ---------- Pending reboot ----------
  if (d.pendingReboot === true) {
    add('warning', 'Maintenance', 'Reboot pending', 'Windows is waiting on a restart to finish applying updates or file changes. This can cause odd behaviour and failed installs until it is done.', {
      recommendation: 'Restart the PC.',
    });
  }

  // ---------- Storage: free space ----------
  for (const v of arr(d.volumes)) {
    const pct = num(v.freePct);
    const freeGB = num(v.freeGB);
    const label = `${v.drive}${v.label ? ' (' + v.label + ')' : ''}`;
    if (pct < 7 || freeGB < 10) {
      add('critical', 'Storage', `Very low disk space on ${label}`, `${freeGB} GB free of ${v.sizeGB} GB (${pct}%). Windows can become unstable below ~10% free.`, {
        recommendation: 'Free space: run the junk cleanup below, uninstall unused apps, or move data off this drive.',
      });
    } else if (pct < 15) {
      add('warning', 'Storage', `Low disk space on ${label}`, `${freeGB} GB free of ${v.sizeGB} GB (${pct}%).`, {
        recommendation: 'Clear space soon to keep performance and updates healthy.',
      });
    }
  }

  // ---------- Storage: SMART / physical health ----------
  for (const p of arr(d.physicalDisks)) {
    const health = (p.healthStatus || '').toLowerCase();
    if (health && health !== 'healthy') {
      add('critical', 'Storage', `Drive health: ${p.friendlyName}`, `Windows reports this ${p.mediaType || 'disk'} as "${p.healthStatus}" (${p.operational || 'unknown'}).`, {
        recommendation: 'Back up this drive immediately and plan a replacement — this is an early-failure warning.',
        detail: diskDetail(p),
      });
    } else {
      const wear = num(p.wearPct, -1);
      if (wear >= 80) {
        add('warning', 'Storage', `SSD heavily worn: ${p.friendlyName}`, `Estimated wear is ${wear}% of rated endurance.`, {
          recommendation: 'Plan a replacement; back up important data.',
          detail: diskDetail(p),
        });
      } else if (wear >= 50) {
        add('info', 'Storage', `SSD wear: ${p.friendlyName}`, `Estimated wear is ${wear}% of rated endurance — monitor over time.`, { detail: diskDetail(p) });
      }
      const temp = num(p.temperatureC, 0);
      if (temp >= 70) {
        add('warning', 'Storage', `Drive running hot: ${p.friendlyName}`, `Reported temperature is ${temp} °C.`, {
          recommendation: 'Check airflow/heatsink; sustained high temps shorten drive life.',
        });
      }
    }
  }

  // ---------- Security ----------
  const sec = d.security || {};
  const avs = arr(sec.avProducts).filter((a) => a && a.name);
  // Multiple *active* real-time AV engines conflict. productState middle nibble 0x1000 = enabled.
  const activeAvs = avs.filter((a) => (num(a.state) & 0x1000) !== 0);
  if (activeAvs.length > 1) {
    add('warning', 'Security', 'Multiple active antivirus products', `${activeAvs.map((a) => a.name).join(' + ')} appear to be running real-time protection at once. Two live AV engines fight each other and cause slowdowns and quarantine loops.`, {
      recommendation: 'Keep one real-time AV; fully uninstall the others (leftover trials like Norton/McAfee are common).',
      detail: avs.map((a) => `${a.name} — state 0x${num(a.state).toString(16)} (${(num(a.state) & 0x1000) ? 'active' : 'off'})`).join('\n'),
    });
  } else if (avs.length > 1) {
    add('info', 'Security', 'Leftover antivirus registration', `More than one AV product is registered, but only one looks active. Stale registrations (uninstalled trials) can still cause confusing exclusion/behaviour issues.`, {
      recommendation: 'Remove any antivirus the customer no longer uses with the vendor’s official removal tool.',
      detail: avs.map((a) => `${a.name} — state 0x${num(a.state).toString(16)} (${(num(a.state) & 0x1000) ? 'active' : 'off'})`).join('\n'),
    });
  }

  if (sec.defenderRTP === false && activeAvs.length === 0) {
    add('critical', 'Security', 'No real-time antivirus protection', 'Microsoft Defender real-time protection is off and no other active AV was detected.', {
      recommendation: 'Turn Defender real-time protection back on, or confirm a working third-party AV is installed.',
    });
  } else if (sec.defenderRTP === true) {
    add('ok', 'Security', 'Real-time protection active', 'Microsoft Defender real-time protection is enabled.');
  }

  const sigAge = num(sec.defenderSigAgeDays, -1);
  if (sigAge >= 7) {
    add('warning', 'Security', 'Antivirus definitions out of date', `Defender signatures are ${sigAge} days old.`, { recommendation: 'Update definitions (Windows Security → Virus & threat protection → Check for updates).' });
  }

  const fwDisabled = arr(sec.firewallDisabled);
  if (fwDisabled.length) {
    add('warning', 'Security', 'Windows Firewall partly disabled', `Disabled profile(s): ${fwDisabled.join(', ')}.`, { recommendation: 'Re-enable the firewall for all network profiles unless a managed firewall is in use.' });
  }

  if (sec.uac === 0) {
    add('warning', 'Security', 'User Account Control disabled', 'UAC is turned off, which removes an important barrier against silent privilege escalation by malware.', { recommendation: 'Re-enable UAC (default level or higher).' });
  }

  if (sec.activation != null && num(sec.activation, 1) !== 1) {
    add('warning', 'System', 'Windows not activated', 'Windows reports it is not fully licensed/activated.', { recommendation: 'Check the licence / digital entitlement for this machine.' });
  }

  const bl = d.bitlocker;
  if (bl && /off|unknown/i.test(bl.protection || '')) {
    add('info', 'Security', 'System drive not encrypted', `BitLocker protection on ${sys.caption ? 'the system drive' : 'C:'} is "${bl.protection}".`, { recommendation: 'Consider enabling BitLocker on portable machines holding customer data.' });
  }

  // ---------- Network tamper indicators ----------
  const net = d.network || {};
  const hosts = arr(net.hostsEntries).filter((l) => l && !/^\s*127\.0\.0\.1\s+localhost|::1\s+localhost/i.test(l));
  if (hosts.length) {
    add('warning', 'Security', 'Custom entries in the hosts file', `${hosts.length} non-default hosts entr${hosts.length === 1 ? 'y' : 'ies'} found. Malware and cracks often redirect domains here.`, {
      recommendation: 'Review these entries; remove anything unexpected.',
      detail: hosts.slice(0, 20).join('\n'),
    });
  }
  if (net.proxyServer || net.autoConfig) {
    add('info', 'Security', 'A system proxy is configured', `Proxy: ${net.proxyServer || net.autoConfig}. Legitimate on managed networks, but a classic malware persistence trick otherwise.`, { recommendation: 'Confirm this proxy is expected.' });
  }

  // ---------- Stability: crashes & errors ----------
  const ev = d.events || {};
  const kp = num(ev.kernelPower41);
  if (kp >= 3) {
    add('warning', 'Stability', 'Repeated unexpected shutdowns', `${kp} unexpected power-loss/hard-reset events (Kernel-Power 41) in the last 14 days.`, { recommendation: 'Check PSU, battery, overheating and loose power connections.' });
  } else if (kp >= 1) {
    add('info', 'Stability', 'Unexpected shutdown detected', `${kp} Kernel-Power 41 event(s) in the last 14 days.`);
  }

  const bugs = arr(ev.bugchecks);
  const dumps = num(d.minidumps);
  if (bugs.length || dumps) {
    const n = Math.max(bugs.length, dumps);
    add('critical', 'Stability', 'Blue-screen crashes (BSOD)', `${n} bugcheck/crash dump${n === 1 ? '' : 's'} recorded. Repeated BSODs point to a driver, memory or storage fault.`, {
      recommendation: 'Review the minidumps (C:\\Windows\\Minidump); test RAM and update/roll back recent drivers.',
      detail: bugs.map((b) => `${b.time} — ${b.msg}`).join('\n'),
    });
  }

  const diskErr = num(ev.diskErrors);
  if (diskErr >= 1) {
    add('critical', 'Storage', 'Disk I/O errors in the event log', `${diskErr} disk-controller error event(s) in the last 14 days — often a dying drive or bad cable.`, { recommendation: 'Back up now; run a full SMART/surface check and reseat/replace the SATA/NVMe connection.' });
  }

  const appErrs = arr(ev.appErrors);
  const noisy = appErrs.filter((a) => num(a.count) >= 5);
  if (noisy.length) {
    add('info', 'Stability', 'Frequently crashing applications', noisy.map((a) => `${a.app} (${a.count}×)`).join(', '), { recommendation: 'Repair/reinstall or update the worst offenders.' });
  }

  // ---------- Hardware: problem devices & battery ----------
  const probs = arr(d.problemDevices);
  if (probs.length) {
    add('warning', 'Hardware', `${probs.length} device(s) with driver problems`, 'Devices are reporting errors in Device Manager (missing or faulty drivers).', {
      recommendation: 'Install correct drivers for these devices.',
      detail: probs.map((p) => `${p.name} — error ${p.errorCode}${p.class ? ' [' + p.class + ']' : ''}`).join('\n'),
    });
  }

  const bat = d.battery;
  if (bat && bat.wearPct != null) {
    const w = num(bat.wearPct);
    if (w >= 40) {
      add('warning', 'Hardware', 'Battery heavily worn', `Battery holds about ${100 - w}% of its original design capacity (${w}% wear).`, { recommendation: 'Offer a battery replacement.' });
    } else if (w >= 25) {
      add('info', 'Hardware', 'Battery wear', `Battery is at roughly ${100 - w}% of design capacity (${w}% wear).`);
    }
  }

  // ---------- Performance / maintenance ----------
  const startup = arr(d.startup);
  if (startup.length >= 12) {
    add('warning', 'Performance', `${startup.length} startup programs`, 'A high number of auto-start programs slows boot and steals memory.', {
      recommendation: 'Disable non-essential startup items (Task Manager → Startup).',
      detail: startup.slice(0, 25).map((s) => `${s.name}  —  ${s.command}`).join('\n'),
    });
  } else if (startup.length >= 7) {
    add('info', 'Performance', `${startup.length} startup programs`, 'Worth a quick trim if boot feels slow.', { detail: startup.map((s) => `${s.name}  —  ${s.command}`).join('\n') });
  }

  const mem = d.memory || {};
  if (num(mem.usedPct) >= 90) {
    add('warning', 'Performance', 'Memory almost full', `RAM is ${mem.usedPct}% used (${mem.freeMB} MB free of ${mem.totalMB} MB).`, { recommendation: 'Close heavy apps, or consider a RAM upgrade for this workload.' });
  }

  const junk = d.junk || {};
  const junkMB = num(junk.userTempMB) + num(junk.winTempMB) + num(junk.wuCacheMB) + num(junk.prefetchMB) + num(junk.minidumpMB);
  if (junkMB >= 1024) {
    add('info', 'Maintenance', `~${(junkMB / 1024).toFixed(1)} GB of reclaimable junk`, 'Temp files, Windows Update cache, prefetch and crash dumps are using noticeable space.', {
      recommendation: 'Clear temp + update cache (Disk Cleanup / Storage Sense).',
      detail: `User temp: ${junk.userTempMB} MB\nWindows temp: ${junk.winTempMB} MB\nUpdate cache: ${junk.wuCacheMB} MB\nPrefetch: ${junk.prefetchMB} MB\nCrash dumps: ${junk.minidumpMB} MB`,
    });
  }

  const lastHotfix = d.lastHotfix ? new Date(d.lastHotfix) : null;
  if (lastHotfix && !Number.isNaN(lastHotfix.getTime())) {
    const days = Math.round((Date.now() - lastHotfix.getTime()) / 86400000);
    if (days >= 60) {
      add('warning', 'Maintenance', 'Windows updates look stalled', `The last update was installed ${days} days ago.`, { recommendation: 'Run Windows Update; if it fails, reset the update components.' });
    }
  }

  const stopped = arr(d.stoppedAutoServices);
  if (stopped.length >= 1) {
    const names = stopped.slice(0, 15).map((s) => `${s.display || s.name}`);
    add('info', 'Maintenance', `${stopped.length} automatic service(s) not running`, 'Services set to start automatically are currently stopped. Usually harmless, occasionally a symptom.', { detail: names.join('\n') });
  }

  // ---------- Drive failure prediction & dirty bit ----------
  const fp = arr(d.failurePredict);
  if (fp.length) {
    add('critical', 'Storage', 'Drive predicts imminent failure (SMART)', 'The disk controller has set its SMART failure-prediction flag. This is the strongest early warning of drive death there is.', {
      recommendation: 'Back up immediately and replace the drive before it fails.',
      detail: fp.map((x) => x.instance).join('\n'),
    });
  }
  const dirty = arr(d.dirtyVolumes);
  if (dirty.length) {
    add('warning', 'Storage', `Volume marked "dirty": ${dirty.join(', ')}`, 'Windows has flagged the volume as needing a disk check, usually after an unclean shutdown or file-system errors.', {
      recommendation: 'Run CHKDSK (chkdsk /f) on the affected drive at the next restart.',
    });
  }

  // ---------- WHEA hardware errors ----------
  const whea = num(d.wheaErrors);
  if (whea >= 1) {
    add(whea >= 5 ? 'critical' : 'warning', 'Hardware', 'Hardware errors logged (WHEA)', `${whea} Windows Hardware Error Architecture event(s) in the last 60 days — these come from the CPU, memory or PCIe bus, not software.`, {
      recommendation: 'Test RAM (MemTest), check temperatures, and update firmware/BIOS. Recurring WHEA errors usually mean failing hardware.',
    });
  }

  // ---------- Windows Update failures ----------
  const wuErr = num(d.wuErrors);
  if (wuErr >= 3) {
    add('warning', 'Maintenance', 'Windows Update is failing', `${wuErr} Windows Update errors logged in the last 60 days.`, { recommendation: 'Run the Windows Update troubleshooter, or reset the update components (SoftwareDistribution + catroot2).' });
  }

  // ---------- Malware indicators: policies / default values / associations ----------
  const pol = arr(d.policyHijacks);
  if (pol.length) {
    add('warning', 'Security', 'Restrictive policies set on this account', `These restrictions are commonly set by malware to lock you out of cleanup tools: ${pol.join(', ')}.`, {
      recommendation: 'If this is not a managed/enterprise policy, treat it as a malware indicator and clear these policy values.',
      detail: pol.join('\n'),
    });
  }
  const defs = arr(d.defaults);
  if (defs.length) {
    add('critical', 'Security', 'Core Windows startup values have been altered', 'Winlogon / boot values were changed from their defaults — a classic persistence trick for malware that loads itself at logon or boot.', {
      recommendation: 'Investigate for infection and restore these values to Windows defaults.',
      detail: defs.join('\n'),
    });
  }
  const assoc = arr(d.assocHijack);
  if (assoc.length) {
    add('critical', 'Security', 'Executable file association hijacked', 'The handler that runs .exe files has been redirected — malware does this so it launches whenever any program is opened.', {
      recommendation: 'Restore the .exe association to the Windows default (exefile) and scan for malware.',
      detail: assoc.join('\n'),
    });
  }

  // ---------- Printing ----------
  const pj = arr(d.printJobs);
  if (pj.length) {
    const total = pj.reduce((n, p) => n + num(p.stuck), 0);
    add('info', 'Hardware', `${total} stuck print job(s)`, `Jobs are stuck in the queue on: ${pj.map((p) => p.printer).join(', ')}.`, { recommendation: 'Clear the print queue (restart the Print Spooler service if it persists).' });
  }

  // ---------- Score & counts ----------
  const counts = { critical: 0, warning: 0, info: 0, ok: 0 };
  let penalty = 0;
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] || 0) + 1;
    penalty += SEVERITY_WEIGHT[f.severity] || 0;
  }
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  // Order: worst first.
  const order = { critical: 0, warning: 1, info: 2, ok: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const summary = buildSummary(sys, counts);

  return { findings, counts, score, summary };
}

function diskDetail(p) {
  const bits = [];
  if (p.mediaType) bits.push(`Type: ${p.mediaType}`);
  if (p.busType) bits.push(`Bus: ${p.busType}`);
  if (p.sizeGB) bits.push(`Size: ${p.sizeGB} GB`);
  if (p.wearPct != null) bits.push(`Wear: ${p.wearPct}%`);
  if (p.temperatureC != null) bits.push(`Temp: ${p.temperatureC} °C`);
  if (p.powerOnHours != null) bits.push(`Power-on hours: ${p.powerOnHours}`);
  return bits.join('\n');
}

function buildSummary(sys, counts) {
  const parts = [];
  if (sys.model) parts.push(sys.model.trim());
  if (sys.caption) parts.push(sys.caption.trim() + (sys.displayVersion ? ' ' + sys.displayVersion : ''));
  if (sys.cpu) parts.push(sys.cpu.trim());
  if (sys.ramGB) parts.push(`${sys.ramGB} GB RAM`);
  if (sys.uptimeHours != null) parts.push(`up ${sys.uptimeHours}h`);
  let line = parts.join('  ·  ');
  if (counts.critical) line += `  —  ${counts.critical} critical issue${counts.critical === 1 ? '' : 's'} need attention`;
  else if (counts.warning) line += `  —  ${counts.warning} thing${counts.warning === 1 ? '' : 's'} to look at`;
  else line += '  —  no major issues found';
  return line;
}

module.exports = { evaluate };
