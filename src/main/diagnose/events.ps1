# TM Toolset - Diagnose: recent-problems triage. Reads the System + Application
# event logs (last 7 days) and groups the nasties into plain-English categories.
# Read-only. ASCII-only; plain arrays.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
trap { try { [Console]::Out.WriteLine('{"ok":false,"error":"events-failed","categories":[]}') } catch { }; exit 0 }
function Clean { param($s) if ($null -eq $s) { return '' } (("" + $s) -replace '[^\x20-\x7E]', ' ').Trim() }

$since = (Get-Date).AddDays(-7)
$cat = [ordered]@{}
$MEAN = @{
  power    = 'Unexpected shutdowns / power loss - the PC lost power or was force powered-off. Causes: PSU, overheating, a crash, or just hard power-offs at the wall.'
  disk     = 'Disk / storage errors - the drive reported read/write or controller errors. Often a failing drive or a bad cable - check Drive Health.'
  whea     = 'Hardware errors (WHEA) - the CPU/memory/PCIe reported hardware errors. Often RAM, CPU or overheating.'
  bsod     = 'Blue screens (bugcheck) - Windows crashed. Open Crash Analysis for the decoded cause.'
  service  = 'Service failures - a Windows service crashed or would not start.'
  appcrash = 'Application crashes/hangs - a program stopped working.'
  other    = 'Other critical/error events worth a glance.'
}
function AddEvt { param($k, $msg, $time)
  if (-not $cat.Contains($k)) { $cat[$k] = [ordered]@{ key = $k; count = 0; latest = ''; samples = @() } }
  $cat[$k].count++
  $ts = ''
  try { $ts = $time.ToString('yyyy-MM-dd HH:mm') } catch { }
  if (-not $cat[$k].latest) { $cat[$k].latest = $ts }
  if (@($cat[$k].samples).Count -lt 3) {
    $m = Clean $msg; if ($m.Length -gt 180) { $m = $m.Substring(0, 180) + '...' }
    $cat[$k].samples += ($ts + '  ' + $m)
  }
}

# ---- System log: critical + error ----
foreach ($e in (Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = $since; Level = 1, 2 } -MaxEvents 500 -ErrorAction SilentlyContinue)) {
  $id = [int]$e.Id; $src = "$($e.ProviderName)"
  $k = 'other'
  if ($id -eq 41 -and $src -match 'Kernel-Power') { $k = 'power' }
  elseif ($id -eq 6008) { $k = 'power' }
  elseif ($id -eq 1001 -and $src -match 'BugCheck') { $k = 'bsod' }
  elseif ($src -match 'WHEA') { $k = 'whea' }
  elseif ($src -match 'disk|Ntfs|storahci|stornvme|volmgr' -or ($id -in 7, 11, 51, 153, 55)) { $k = 'disk' }
  elseif ($src -match 'Service Control Manager' -or ($id -in 7000, 7001, 7031, 7034)) { $k = 'service' }
  AddEvt $k $e.Message $e.TimeCreated
}

# ---- Application log: crashes + hangs ----
foreach ($e in (Get-WinEvent -FilterHashtable @{ LogName = 'Application'; StartTime = $since; Level = 1, 2 } -MaxEvents 300 -ErrorAction SilentlyContinue)) {
  $id = [int]$e.Id; $src = "$($e.ProviderName)"
  if ($id -in 1000, 1002 -or $src -match 'Application Error|Application Hang|.NET Runtime') { AddEvt 'appcrash' $e.Message $e.TimeCreated }
}

$cats = @()
foreach ($k in $cat.Keys) {
  $c = $cat[$k]
  $cats += [ordered]@{ key = $k; count = $c.count; latest = $c.latest; meaning = $MEAN[$k]; samples = @($c.samples) }
}
$cats = @($cats | Sort-Object -Property count -Descending)
$total = 0; foreach ($c in $cats) { $total += $c.count }
[ordered]@{ ok = $true; days = 7; total = $total; categories = $cats } | ConvertTo-Json -Depth 6 -Compress
