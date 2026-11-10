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
      explain: opts.explain || '',
      actions: Array.isArray(opts.actions) ? opts.actions : [],
      links: Array.isArray(opts.links) ? opts.links : [],
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
        explain:
          'Without security updates, newly discovered vulnerabilities on this PC stay unpatched. Three paths: upgrade to Windows 11 if the hardware qualifies (free), enrol in Extended Security Updates to keep getting patches for a while, or replace the machine. For a shop, flag this to the customer so it is their informed decision.',
        actions: [{ label: 'Check for updates', token: 'windows-update' }],
        links: [{ label: 'Windows 11 & requirements', url: 'https://www.microsoft.com/windows/windows-11' }],
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
        recommendation: 'Free space now: Disk Cleanup, uninstall unused apps, empty the Recycle Bin, and move large files off this drive.',
        explain:
          'Windows needs headroom for updates, temp files and virtual memory. When the system drive fills up, updates fail, apps crash and everything slows down. Biggest quick wins are usually the Downloads folder, old Windows Update files (Disk Cleanup → "Clean up system files"), and large media files that can move to another drive or external storage.',
        actions: [
          { label: 'Disk Cleanup', token: 'disk-cleanup' },
          { label: 'Storage settings', token: 'storage-settings' },
          { label: 'Uninstall programs', token: 'programs' },
        ],
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

  // ---------- Storage: mechanical system drive (SSD upgrade opportunity) ----------
  for (const p of arr(d.physicalDisks)) {
    if (!p.isSystem) continue;
    // Only flag when Windows clearly reports a mechanical drive. "Unspecified"
    // is left alone — both old SSDs and some SATA disks report it, and a wrong
    // "upgrade your drive" call on a machine that already has an SSD is worse
    // than a miss.
    if (/^hdd$/i.test(String(p.mediaType || ''))) {
      add('warning', 'Storage', 'System drive is a mechanical hard disk', `Windows boots from a spinning hard drive (${p.friendlyName}${p.sizeGB ? ', ' + p.sizeGB + ' GB' : ''}). This is usually the single biggest cause of a slow, laggy PC.`, {
        recommendation: 'Recommend an SSD upgrade (clone the drive over) — the most cost-effective speed boost there is.',
        explain:
          'A mechanical hard drive has moving parts and is dozens of times slower than a solid-state drive for the small, scattered reads Windows does constantly. On an HDD, boot, logins, app launches and updates all crawl no matter how fast the CPU or how much RAM is fitted. Cloning the system onto an SSD typically turns a 2–3 minute boot into 15–20 seconds and makes the whole machine feel new — the best-value upgrade you can offer.',
        detail: diskDetail(p),
      });
    }
  }

  // ---------- SMART failure attributes ----------
  for (const s of arr(d.smart)) {
    const realloc = num(s.reallocatedSectors, 0);
    const pending = num(s.pendingSectors, 0);
    const uncorr = num(s.offlineUncorrectable, 0) + num(s.reportedUncorrectable, 0);
    const poh = num(s.powerOnHours, 0);
    if (pending > 0 || uncorr > 0) {
      add('critical', 'Storage', 'Bad sectors detected (SMART)', `${pending} pending and ${uncorr} uncorrectable sector(s) reported by the drive. These are failing or already-lost sectors.`, {
        recommendation: 'Back up now and replace the drive — pending/uncorrectable sectors mean data is already at risk.',
        explain: 'Pending sectors are ones the drive could not read and is waiting to remap; uncorrectable sectors are already lost. Any non-zero count is a real early-failure sign — do not wait for it to grow.',
        detail: smartDetail(s),
      });
    } else if (realloc >= 10) {
      add('warning', 'Storage', 'Reallocated sectors (SMART)', `${realloc} sectors have been remapped after read/write errors.`, {
        recommendation: 'Keep backups current and monitor — a rising count means replace the drive.',
        detail: smartDetail(s),
      });
    } else if (realloc > 0) {
      add('info', 'Storage', 'A few reallocated sectors (SMART)', `${realloc} reallocated sector(s) — not urgent, but worth watching.`, { detail: smartDetail(s) });
    }
    if (poh >= 43800) {
      add('info', 'Storage', 'High drive age', `About ${Math.round(poh / 8760)} years of power-on time (${poh} hours).`, { detail: smartDetail(s) });
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
      explain:
        'Two live antivirus engines scanning the same files at the same moment collide — causing slowdowns, files locked in quarantine loops, and sometimes each one disabling the other, leaving the PC less protected than with just one. Decide which to keep, then remove the other with the vendor\'s official removal tool — ordinary Add/Remove Programs often leaves drivers and services behind.',
      actions: [{ label: 'Uninstall programs', token: 'programs' }],
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
      explain: 'Nothing is actively watching this machine for malware right now. Sometimes malware itself disables protection, so if it will not turn back on, treat the PC as suspect and run an offline scan.',
      actions: [{ label: 'Open Windows Security', token: 'windows-security' }],
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
    add('warning', 'Security', 'Windows Firewall partly disabled', `Disabled profile(s): ${fwDisabled.join(', ')}.`, {
      recommendation: 'Re-enable the firewall for all network profiles unless a managed firewall is in use.',
      actions: [{ label: 'Firewall settings', token: 'firewall' }],
    });
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
      recommendation: 'Review the entries; remove anything you do not recognise.',
      explain:
        'The hosts file maps website names to IP addresses before normal DNS is consulted. There are legit uses (software development, ad-blocking lists), but malware and pirated/cracked software frequently abuse it — redirecting real sites to fake ones, or pointing antivirus and activation servers at 0.0.0.0 / 127.0.0.1 to block updates. Anything here sending a well-known domain (microsoft.com, your bank, an AV vendor) to an odd or dead address is a red flag.',
      actions: [{ label: 'Open hosts file', token: 'hosts-file' }],
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
      recommendation: 'Check the crash pattern, note the bugcheck code, and test RAM; suspect recently changed drivers/hardware.',
      explain:
        'Reliability Monitor shows the timeline — line up the first crash with a recent driver update, Windows update or new hardware. Event Viewer gives the bugcheck (STOP) code, which usually names the culprit. If crashes are random, run Windows Memory Diagnostic to rule out bad RAM. The dump files are in C:\\Windows\\Minidump.',
      actions: [
        { label: 'Reliability Monitor', token: 'reliability' },
        { label: 'Event Viewer', token: 'event-viewer' },
      ],
      detail: bugs.map((b) => `${b.time} — ${b.msg}`).join('\n'),
    });
  }

  const diskErrRaw = ev.diskErrors;
  const diskErrTotal = diskErrRaw && typeof diskErrRaw === 'object' ? num(diskErrRaw.total) : num(diskErrRaw);
  if (diskErrTotal >= 1) {
    const byDisk = arr(diskErrRaw && diskErrRaw.byDisk);
    const named = byDisk
      .filter((x) => x.harddisk !== 'unknown')
      .map((x) => `Disk ${x.harddisk} — ${x.model}${x.serial ? ' (S/N ' + x.serial + ')' : ''}`);
    const where = named.length ? named.join('; ') : 'an attached drive (disk number not recorded in the events)';
    add('critical', 'Storage', 'Disk I/O errors in the event log', `${diskErrTotal} disk-controller error event(s) in the last 14 days on: ${where}. Often a failing drive or a bad cable/port.`, {
      recommendation: 'Check the identified drive(s) below — the Drive Health tab (SMART) and a surface scan will show whether it is a failing drive or just a bad cable/port.',
      explain: '"Disk" controller errors mean Windows retried or failed an I/O to a specific physical disk. The disk number below (Disk 0, 1, 2…) matches Disk Management / the physical drive, so you can tell which drive it was.',
      detail: byDisk.map((x) => `Disk ${x.harddisk}: ${x.count}× — ${x.model}${x.serial ? ' (S/N ' + x.serial + ')' : ''}`).join('\n'),
    });
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
      recommendation: 'Install the correct driver for each flagged device.',
      explain: 'Open Device Manager and look for the devices below (yellow triangle). Right-click → Update driver, or download the proper driver from the PC/part maker\'s support page. A "Code 28" means no driver is installed at all.',
      actions: [{ label: 'Open Device Manager', token: 'device-manager' }],
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
      recommendation: 'Disable non-essential startup items, then restart to feel the difference.',
      explain:
        'Usually safe to disable: software updaters and "helpers" (Adobe, Java, iTunes, Spotify, Steam, printer/vendor updaters), chat and cloud apps you do not need the moment you log in, and pre-installed bloatware. Keep enabled: antivirus/security, touchpad / audio / graphics utilities, and any backup or sync tool you rely on. Disabling only stops it launching at startup — you can still open it manually any time.',
      actions: [
        { label: 'Open Startup settings', token: 'startup-apps' },
        { label: 'Open Task Manager', token: 'task-manager' },
      ],
      detail: startup.slice(0, 25).map((s) => `${s.name}  —  ${s.command}`).join('\n'),
    });
  } else if (startup.length >= 7) {
    add('info', 'Performance', `${startup.length} startup programs`, 'Worth a quick trim if boot feels slow.', { detail: startup.map((s) => `${s.name}  —  ${s.command}`).join('\n') });
  }

  const mem = d.memory || {};
  if (num(mem.usedPct) >= 90) {
    add('warning', 'Performance', 'Memory almost full', `RAM is ${mem.usedPct}% used (${mem.freeMB} MB free of ${mem.totalMB} MB).`, { recommendation: 'Close heavy apps, or consider a RAM upgrade for this workload.' });
  }

  // ---------- Performance: low total RAM for the OS ----------
  const ramGB = num(sys.ramGB);
  if (ramGB > 0 && ramGB <= 4) {
    add('warning', 'Performance', `Only ${ramGB} GB of RAM`, `${ramGB} GB is below what modern Windows needs to run comfortably — the PC will lean heavily on the (far slower) page file and feel sluggish with a browser and a couple of apps open.`, {
      recommendation: 'Recommend a RAM upgrade — 8 GB minimum, 16 GB for comfortable everyday use.',
      explain:
        'Windows 10/11 plus a modern browser can use several gigabytes on their own. With 4 GB or less, the machine constantly shuffles memory to and from disk (paging), which hammers the drive and makes everything stutter. A RAM upgrade is usually inexpensive and one of the most noticeable improvements you can make, especially alongside an SSD.',
    });
  } else if (ramGB > 4 && ramGB <= 8) {
    add('info', 'Performance', `${ramGB} GB of RAM`, `${ramGB} GB is workable but tight for heavy multitasking or lots of browser tabs.`, {
      recommendation: 'Consider 16 GB if the customer runs many apps/tabs at once.',
    });
  }

  const junk = d.junk || {};
  const junkMB = num(junk.userTempMB) + num(junk.winTempMB) + num(junk.wuCacheMB) + num(junk.prefetchMB) + num(junk.minidumpMB);
  if (junkMB >= 1024) {
    add('info', 'Maintenance', `~${(junkMB / 1024).toFixed(1)} GB of reclaimable junk`, 'Temp files, Windows Update cache, prefetch and crash dumps are using noticeable space.', {
      recommendation: 'Clear temp + update cache (Disk Cleanup / Storage Sense).',
      actions: [{ label: 'Disk Cleanup', token: 'disk-cleanup' }],
      detail: `User temp: ${junk.userTempMB} MB\nWindows temp: ${junk.winTempMB} MB\nUpdate cache: ${junk.wuCacheMB} MB\nPrefetch: ${junk.prefetchMB} MB\nCrash dumps: ${junk.minidumpMB} MB`,
    });
  }

  const lastHotfix = d.lastHotfix ? new Date(d.lastHotfix) : null;
  if (lastHotfix && !Number.isNaN(lastHotfix.getTime())) {
    const days = Math.round((Date.now() - lastHotfix.getTime()) / 86400000);
    if (days >= 60) {
      add('warning', 'Maintenance', 'Windows updates look stalled', `The last update was installed ${days} days ago.`, {
        recommendation: 'Run Windows Update; if it keeps failing, reset the update components.',
        actions: [{ label: 'Open Windows Update', token: 'windows-update' }],
      });
    }
  }

  const stopped = arr(d.stoppedAutoServices);
  if (stopped.length >= 1) {
    const names = stopped.slice(0, 15).map((s) => `${s.display || s.name}`);
    add('info', 'Maintenance', `${stopped.length} automatic service(s) not running`, 'Services set to start automatically are currently stopped. Usually harmless, occasionally a symptom.', {
      actions: [{ label: 'Open Services', token: 'services' }],
      detail: names.join('\n'),
    });
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
    add('warning', 'Maintenance', 'Windows Update is failing', `${wuErr} Windows Update errors logged in the last 60 days.`, {
      recommendation: 'Run the Windows Update troubleshooter, or reset the update components (SoftwareDistribution + catroot2).',
      actions: [{ label: 'Open Windows Update', token: 'windows-update' }],
    });
  }

  // ---------- Malware indicators: policies / default values / associations ----------
  const pol = arr(d.policyHijacks);
  if (pol.length) {
    add('warning', 'Security', 'Restrictive policies set on this account', `These restrictions are commonly set by malware to lock you out of cleanup tools: ${pol.join(', ')}.`, {
      recommendation: 'If this is not a managed/enterprise policy, treat it as a malware indicator and clear these policy values.',
      explain: 'Things like a disabled Task Manager or Registry Editor are classic malware self-defence — it stops you from seeing or removing it. On a company-managed PC these may be set deliberately by IT; on a home machine, assume infection.',
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
      recommendation: 'Restore the .exe association to the Windows default (exefile) and run a full malware scan.',
      explain: 'Normally double-clicking any program runs it directly. When this association is hijacked, Windows runs the malware first every single time you open anything — which is why these infections are so persistent. This needs a proper malware clean-up, not just a settings tweak.',
      detail: assoc.join('\n'),
    });
  }

  // ---------- Printing ----------
  const pj = arr(d.printJobs);
  if (pj.length) {
    const total = pj.reduce((n, p) => n + num(p.stuck), 0);
    add('info', 'Hardware', `${total} stuck print job(s)`, `Jobs are stuck in the queue on: ${pj.map((p) => p.printer).join(', ')}.`, { recommendation: 'Clear the print queue (restart the Print Spooler service if it persists).' });
  }

  // ---------- Network ----------
  const nd = d.net || {};
  const internet = (nd.internet || '').toLowerCase();
  const apipa = arr(nd.apipa).filter(Boolean);
  if (apipa.length) {
    add('warning', 'Network', 'No IP from DHCP (APIPA address)', `The adapter has a self-assigned 169.254.x.x address — it is not getting an IP from the router.`, {
      recommendation: 'Check the cable/Wi-Fi, run ipconfig /renew, and confirm the router/DHCP is working.',
      explain: 'A 169.254 "APIPA" address is Windows giving up on DHCP. It is the classic "connected but no internet" cause.',
    });
  } else if (internet && internet !== 'internet') {
    add('warning', 'Network', 'No internet connectivity', `Windows reports this connection as "${nd.internet}".`, { recommendation: 'If it is local-only, the gateway or DNS is the likely culprit.' });
  }
  if (nd.dnsResolves === false) {
    add('warning', 'Network', 'DNS resolution is failing', 'The PC could not resolve a well-known domain — DNS is misconfigured, or malware/filtering is blocking it.', {
      recommendation: 'Flush DNS (ipconfig /flushdns), check the DNS servers, and consider a Winsock/TCP-IP reset if it persists.',
      detail: arr(nd.dns).length ? 'Configured DNS: ' + arr(nd.dns).join(', ') : '',
    });
  }
  const gp = nd.gatewayPing;
  if (gp && gp.ok === false) {
    add('warning', 'Network', 'Cannot reach the gateway', 'Pinging the default gateway failed — likely a local link or router problem.', { recommendation: 'Check the cable/Wi-Fi and the router.' });
  } else if (gp && gp.ok && num(gp.avgMs) >= 10) {
    add('info', 'Network', 'High latency to the router', `~${gp.avgMs} ms to the gateway — high for a local link; possible Wi-Fi interference or a failing connection.`);
  }
  if (nd.smb1 === true) {
    add('warning', 'Security', 'SMBv1 is enabled', 'The obsolete SMBv1 protocol is on — a well-known security risk (the WannaCry vector).', { recommendation: 'Disable SMB1 unless a genuine legacy device needs it.' });
  }

  // ---------- Defender exclusions + tamper protection ----------
  const dex = d.defenderExclusions || {};
  const exPaths = arr(dex.paths).filter(Boolean);
  const exProcs = arr(dex.processes).filter(Boolean);
  const allEx = exPaths.concat(exProcs, arr(dex.extensions).filter(Boolean));
  const suspEx = exPaths.concat(exProcs).filter((p) => /\\Temp\\|\\AppData\\|\\ProgramData\\|\\Users\\Public|Downloads/i.test(p));
  if (suspEx.length) {
    add('warning', 'Security', 'Antivirus exclusions in suspicious locations', `${suspEx.length} Defender exclusion(s) point at Temp/AppData-type paths — malware commonly adds these to whitelist itself.`, {
      recommendation: 'Review each exclusion and remove any you did not set.',
      explain: 'Legit software occasionally adds an exclusion, but Temp/AppData/Downloads exclusions are a classic way malware tells antivirus to ignore it.',
      detail: suspEx.join('\n'),
      actions: [{ label: 'Open Windows Security', token: 'windows-security' }],
    });
  } else if (allEx.length) {
    add('info', 'Security', `${allEx.length} antivirus exclusion(s) configured`, 'Worth a glance to confirm they are all intentional.', { detail: allEx.join('\n') });
  }
  if (dex.tamperOff === true) {
    add('warning', 'Security', 'Defender Tamper Protection is off', 'Tamper Protection stops malware (or users) from disabling Defender — it is off here.', {
      recommendation: 'Turn Tamper Protection back on in Windows Security.',
      actions: [{ label: 'Open Windows Security', token: 'windows-security' }],
    });
  }

  // ---------- Suspicious persistence ----------
  const tasks = arr(d.suspiciousTasks);
  if (tasks.length) {
    add('warning', 'Security', `${tasks.length} scheduled task(s) running from Temp/AppData`, 'Scheduled tasks launching from temp or user folders are a common malware persistence trick.', {
      recommendation: 'Review these in Task Scheduler and delete anything you do not recognise.',
      actions: [{ label: 'Open Task Scheduler', token: 'task-scheduler' }],
      detail: tasks.slice(0, 15).map((t) => `${t.path || ''}${t.name}  →  ${t.run}`).join('\n'),
    });
  }
  const suspStartup = arr(d.startup).filter((s) => /\\Temp\\|\\AppData\\|\\ProgramData\\|\\Users\\Public|%TEMP%|%APPDATA%/i.test(s.command || ''));
  if (suspStartup.length) {
    add('warning', 'Security', `${suspStartup.length} startup item(s) running from Temp/AppData`, 'Auto-start entries pointing at temp or user folders are a common malware persistence location.', {
      recommendation: 'Review these startup entries and remove anything unexpected.',
      actions: [{ label: 'Open Startup settings', token: 'startup-apps' }],
      detail: suspStartup.slice(0, 15).map((s) => `${s.name}  →  ${s.command}`).join('\n'),
    });
  }

  // ---------- Browser extensions ----------
  const be = d.browserExt || {};
  const beParts = [];
  if (num(be.chrome)) beParts.push(`Chrome: ${num(be.chrome)}`);
  if (num(be.edge)) beParts.push(`Edge: ${num(be.edge)}`);
  if (num(be.firefox)) beParts.push(`Firefox: ${num(be.firefox)}`);
  const beTotal = num(be.chrome) + num(be.edge) + num(be.firefox);
  if (beTotal > 0) {
    add(beTotal >= 15 ? 'warning' : 'info', 'Security', `${beTotal} browser extension(s) installed`, `${beParts.join(' · ')}. Extensions are the main route for adware and PUPs.`, {
      recommendation: beTotal >= 15 ? 'Review and remove unknown extensions — a high count often means bundled adware.' : 'Worth a quick review for anything the customer did not install.',
    });
  }

  // ---------- Windows image health ----------
  const ih = (d.imageHealth || '').toLowerCase();
  if (ih === 'repairable') {
    add('warning', 'System', 'Windows system files are corrupt (repairable)', 'DISM reports the component store is corrupt but repairable.', {
      recommendation: 'Run DISM /Online /Cleanup-Image /RestoreHealth, then sfc /scannow.',
      explain: 'This typically causes update failures and odd glitches. RestoreHealth pulls fresh files from Windows Update; follow with SFC to repair protected system files.',
    });
  } else if (ih === 'notrepairable') {
    add('critical', 'System', 'Windows system files are corrupt (not repairable online)', 'DISM reports component-store corruption it cannot repair online.', { recommendation: 'An in-place repair/upgrade (or clean reinstall) is likely needed.' });
  }

  // ---------- Time sync ----------
  const ts = d.timeSync || {};
  if (ts.service && String(ts.service).toLowerCase() !== 'running') {
    add('info', 'Maintenance', 'Clock-sync service not running', `The Windows Time service is "${ts.service}". A drifting clock breaks Windows Update and secure (HTTPS) sites.`, { recommendation: 'Start and enable the Windows Time (w32time) service.' });
  } else if (ts.source && /local cmos/i.test(String(ts.source))) {
    add('info', 'Maintenance', 'Clock not syncing to the internet', 'The time source is the local hardware clock, not an internet time server — it can drift and break updates/secure sites.', { recommendation: 'Point w32time at an NTP server and resync (w32tm /resync).' });
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

function smartDetail(s) {
  const bits = [];
  if (s.reallocatedSectors != null) bits.push(`Reallocated sectors (5): ${s.reallocatedSectors}`);
  if (s.pendingSectors != null) bits.push(`Pending sectors (197): ${s.pendingSectors}`);
  if (s.offlineUncorrectable != null) bits.push(`Uncorrectable (198): ${s.offlineUncorrectable}`);
  if (s.reportedUncorrectable != null) bits.push(`Reported uncorrectable (187): ${s.reportedUncorrectable}`);
  if (s.reallocationEvents != null) bits.push(`Reallocation events (196): ${s.reallocationEvents}`);
  if (s.powerOnHours != null) bits.push(`Power-on hours: ${s.powerOnHours}`);
  if (s.temperatureC != null) bits.push(`Temperature: ${s.temperatureC} °C`);
  return bits.join('\n');
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
