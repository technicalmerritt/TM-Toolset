# TM Toolset - Drivers: read-only scan of this PC's devices and their drivers,
# cross-referenced against the OFFLINE LIBRARY so we can flag "a newer/missing
# driver is already in your pack" and offer a one-click fix. Makes no changes.
# ASCII-only output; plain arrays only (no generic lists).
param([string]$Lib = '')

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
trap { try { [Console]::Out.WriteLine('{"ok":false,"error":"scan-failed","classes":[]}') } catch { }; exit 0 }

function Clean { param($s) if ($null -eq $s) { return '' } (("" + $s) -replace '[^\x20-\x7E]', ' ').Trim() }
function CoreKey {
  param($hw)
  $h = ("" + $hw).ToUpper()
  $m = [regex]::Match($h, 'VEN_[0-9A-F]+&DEV_[0-9A-F]+'); if ($m.Success) { return $m.Value }
  $m = [regex]::Match($h, 'VID_[0-9A-F]+&PID_[0-9A-F]+'); if ($m.Success) { return $m.Value }
  return $h
}
function VerNum { param($v) try { return [version](("" + $v) -replace '[^0-9.]', '') } catch { return [version]'0.0.0.0' } }

$isAdmin = [bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))

$make = ''; $model = ''
try {
  $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
  if ($cs) { $make = Clean $cs.Manufacturer; $model = Clean $cs.Model }
} catch { }

# Problem devices by InstanceId.
$probMap = @{}
try {
  foreach ($d in (Get-PnpDevice -ErrorAction SilentlyContinue)) {
    if ($d.Status -and $d.Status -ne 'OK') {
      $probMap[("" + $d.InstanceId).ToUpper()] = [ordered]@{ status = Clean $d.Status; class = Clean $d.Class; name = Clean $d.FriendlyName; problem = Clean $d.Problem }
    }
  }
} catch { }

$seen = @{}
$devices = @()

foreach ($drv in (Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue)) {
  $id = ("" + $drv.DeviceID).ToUpper()
  if (-not $id) { continue }
  $hw = ''
  if ($drv.HardWareID) { if ($drv.HardWareID -is [array]) { $hw = Clean $drv.HardWareID[0] } else { $hw = Clean $drv.HardWareID } }
  $date = ''
  try { if ($drv.DriverDate) { $date = ([datetime]$drv.DriverDate).ToString('yyyy-MM-dd') } } catch { }
  $cls = Clean $drv.DeviceClass; if (-not $cls) { $cls = 'OTHER' }
  $prob = $probMap[$id]
  $st = 'OK'; $pr = ''
  if ($prob) { $st = $prob.status; $pr = $prob.problem }
  $devices += [ordered]@{
    name = Clean $drv.DeviceName; class = $cls.ToUpper(); hwid = $hw
    version = Clean $drv.DriverVersion; provider = Clean $drv.DriverProviderName; date = $date
    inf = Clean $drv.InfName
    status = $st
    problem = $pr
    hasProblem = [bool]$prob
    libPresent = $false; libNewer = $false; libVersion = ''; libDate = ''; libInf = ''
  }
  $seen[$id] = $true
}

foreach ($id in $probMap.Keys) {
  if ($seen.ContainsKey($id)) { continue }
  $p = $probMap[$id]
  $cls = $p.class; if (-not $cls) { $cls = 'UNKNOWN' }
  $hw = ''
  try {
    $ids = (Get-PnpDeviceProperty -InstanceId $id -KeyName 'DEVPKEY_Device_HardwareIds' -ErrorAction SilentlyContinue).Data
    if ($ids) { if ($ids -is [array]) { $hw = Clean $ids[0] } else { $hw = Clean $ids } }
  } catch { }
  $devices += [ordered]@{
    name = $p.name; class = $cls.ToUpper(); hwid = $hw; version = ''; provider = ''; date = ''
    inf = ''; status = $p.status; problem = $p.problem; hasProblem = $true
    libPresent = $false; libNewer = $false; libVersion = ''; libDate = ''; libInf = ''
  }
}

# ---- cross-reference the offline library index (built by library.ps1) ----
$libCount = 0
$indexPath = ''
if ($Lib) { $indexPath = Join-Path $Lib 'index.json' }
if ($indexPath -and (Test-Path $indexPath)) {
  try {
    $idx = Get-Content $indexPath -Raw -ErrorAction Stop | ConvertFrom-Json
    $libKeys = @{}
    foreach ($e in @($idx)) {
      $libCount++
      foreach ($k in @($e.mk)) {
        $kk = ("" + $k).ToUpper()
        if (-not $kk) { continue }
        if (-not $libKeys.ContainsKey($kk)) { $libKeys[$kk] = @() }
        $libKeys[$kk] += $e
      }
    }
    foreach ($d in $devices) {
      if (-not $d.hwid) { continue }
      $ck = CoreKey $d.hwid
      if (-not $libKeys.ContainsKey($ck)) { continue }
      $cand = @($libKeys[$ck])
      if (-not $cand.Count) { continue }
      $best = $cand | Sort-Object @{ Expression = { $_.date } }, @{ Expression = { VerNum $_.version } } -Descending | Select-Object -First 1
      $newer = $false
      if ($best.date -and $d.date) {
        if ($best.date -gt $d.date) { $newer = $true }
        elseif ($best.date -eq $d.date -and (VerNum $best.version) -gt (VerNum $d.version)) { $newer = $true }
      } elseif (-not $d.date -and $best.date) { $newer = $true }
      if ($d.hasProblem) { $newer = $true }   # missing/broken: any matching pack driver is an improvement
      $d.libPresent = $true
      $d.libNewer   = [bool]$newer
      $d.libVersion = Clean $best.version
      $d.libDate    = Clean $best.date
      $d.libInf     = Clean $best.inf
    }
  } catch { }
}

$byClass = @{}
foreach ($d in $devices) {
  $c = $d.class
  if (-not $byClass.ContainsKey($c)) { $byClass[$c] = @() }
  $byClass[$c] += $d
}
$classes = @()
foreach ($c in ($byClass.Keys | Sort-Object)) {
  $list = @($byClass[$c])
  $bad = @($list | Where-Object { $_.hasProblem }).Count
  $fix = @($list | Where-Object { $_.libNewer }).Count
  $classes += [ordered]@{ class = $c; count = $list.Count; problems = $bad; fixable = $fix; devices = $list }
}

$problemTotal = @($devices | Where-Object { $_.hasProblem }).Count
$fixTotal     = @($devices | Where-Object { $_.libNewer }).Count
[ordered]@{
  ok = $true; isAdmin = $isAdmin; make = $make; model = $model
  deviceCount = @($devices).Count; problemCount = $problemTotal; fixableCount = $fixTotal
  libIndexed = $libCount; classes = @($classes)
} | ConvertTo-Json -Depth 7 -Compress
