# TM Toolset - Drivers: offline library manager.
#   index   : parse every .inf (class / version / hardware IDs) -> index.json
#   list    : (re)build the index and return a grouped summary
#   harvest : pnputil /export-driver *  (pull this PC's drivers into the library)
#   import  : copy an existing driver folder into the library
#   install : pnputil /add-driver ... /install  (install matching drivers now)
#   remove  : delete one package folder from the library
#   inject  : DISM offline - add the library's drivers to an applied Windows image
# Streams @@STEP@@ progress; emits one JSON object. ASCII-only; plain arrays.
param(
  [string]$Action = '',
  [string]$Lib    = '',
  [string]$Source = '',   # import: folder to copy in
  [string]$Inf    = '',   # install: a specific .inf (omit = install all matching)
  [string]$Target = '',   # remove: package folder to delete
  [string]$Image  = ''    # inject: applied offline Windows directory
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + (("" + $m) -replace '[^\x20-\x7E]', ' ')) } catch { } }
function Clean { param($s) if ($null -eq $s) { return '' } (("" + $s) -replace '[^\x20-\x7E]', ' ').Trim() }
trap {
  $e = [ordered]@{ ok = $false; action = $Action; error = (("" + $_.Exception.Message) -replace '[^\x20-\x7E]', ' '); line = $_.InvocationInfo.ScriptLineNumber }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

$isAdmin = [bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
$out = [ordered]@{ ok = $false; action = $Action; isAdmin = $isAdmin }
if (-not $Lib) { $out.error = 'no-lib'; ($out | ConvertTo-Json -Compress); exit 0 }
if (-not (Test-Path $Lib)) { try { New-Item -ItemType Directory -Path $Lib -Force | Out-Null } catch { } }

function CoreKey {
  param($hw)
  $h = ("" + $hw).ToUpper()
  $m = [regex]::Match($h, 'VEN_[0-9A-F]+&DEV_[0-9A-F]+'); if ($m.Success) { return $m.Value }
  $m = [regex]::Match($h, 'VID_[0-9A-F]+&PID_[0-9A-F]+'); if ($m.Success) { return $m.Value }
  return $h
}

function Parse-Inf {
  param([string]$path)
  $txt = ''
  try { $txt = Get-Content -LiteralPath $path -Raw -ErrorAction Stop } catch { return $null }
  if (-not $txt) { return $null }
  $class = ''; $provider = ''; $ver = ''; $date = ''
  $mC = [regex]::Match($txt, '(?im)^\s*Class\s*=\s*(.+?)\s*$');            if ($mC.Success) { $class = Clean $mC.Groups[1].Value }
  $mP = [regex]::Match($txt, '(?im)^\s*Provider\s*=\s*(.+?)\s*$');         if ($mP.Success) { $provider = (Clean $mP.Groups[1].Value) -replace '%', '' }
  $mV = [regex]::Match($txt, '(?im)^\s*DriverVer\s*=\s*([0-9/]+)\s*,?\s*([0-9\.]*)');
  if ($mV.Success) {
    $ver = Clean $mV.Groups[2].Value
    # INF DriverVer dates are ALWAYS MM/DD/YYYY regardless of system locale,
    # so parse the parts by hand (locale-independent, never throws a wrong month).
    $parts = ("" + $mV.Groups[1].Value) -split '/'
    if ($parts.Count -eq 3) {
      try { $date = ('{0:0000}-{1:00}-{2:00}' -f [int]$parts[2], [int]$parts[0], [int]$parts[1]) } catch { }
    }
  }
  # Hardware IDs anywhere in the file -> reduced match keys.
  $keys = @{}
  foreach ($mm in [regex]::Matches($txt, '(?i)(PCI|USB|ACPI|HID|HDAUDIO|SCSI|PCMCIA|SW|BTH|USBPRINT|ROOT)\\[A-Z0-9_&\.\-]+')) {
    $k = CoreKey $mm.Value
    if ($k) { $keys[$k] = $true }
  }
  return [ordered]@{ inf = $path; class = $class; provider = $provider; version = $ver; date = $date; mk = @($keys.Keys) }
}

function Build-Index {
  Step 'Scanning the library for .inf files...'
  $infs = @(Get-ChildItem -Path $Lib -Recurse -Filter *.inf -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'index.json' })
  $total = $infs.Count
  Step ("Found $total driver .inf files. Parsing...")
  $entries = @()
  $i = 0
  foreach ($f in $infs) {
    $i++
    $e = Parse-Inf $f.FullName
    if ($e) { $entries += $e }
    if (($i % 200) -eq 0) { Step ("Parsed $i / $total...") }
  }
  try { ($entries | ConvertTo-Json -Depth 5 -Compress) | Set-Content -LiteralPath (Join-Path $Lib 'index.json') -Encoding UTF8 } catch { }
  return @($entries)
}

function Summarize {
  param($entries)
  $byClass = @{}
  $totalSize = [int64]0
  $packages = @()
  foreach ($e in $entries) {
    $c = $e.class; if (-not $c) { $c = 'Unknown' }
    $sz = [int64]0
    try { $dir = Split-Path -Parent $e.inf; $sz = [int64]((Get-ChildItem -LiteralPath $dir -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum) } catch { }
    $totalSize += $sz
    if (-not $byClass.ContainsKey($c)) { $byClass[$c] = [ordered]@{ class = $c; count = 0; sizeBytes = [int64]0 } }
    $byClass[$c].count++
    $byClass[$c].sizeBytes += $sz
    $packages += [ordered]@{ inf = $e.inf; class = $c; provider = $e.provider; version = $e.version; date = $e.date; sizeBytes = $sz; folder = (Split-Path -Parent $e.inf) }
  }
  $classes = @()
  foreach ($k in ($byClass.Keys | Sort-Object)) { $classes += $byClass[$k] }
  return [ordered]@{ classes = @($classes); packages = @($packages); totalBytes = $totalSize; packageCount = @($entries).Count }
}

function Run-Cli {
  param([string]$exe, [string[]]$cliArgs)
  Step ("> $exe " + ($cliArgs -join ' '))
  $code = 0
  try {
    & $exe @cliArgs 2>&1 | ForEach-Object { $l = "$_"; if ($l.Trim().Length -gt 0) { Step $l } }
    $code = $LASTEXITCODE
  } catch { Step ('Error: ' + $_.Exception.Message); $code = -1 }
  if ($null -eq $code) { $code = 0 }
  return $code
}

switch ($Action) {

  'list' {
    $entries = Build-Index
    $sum = Summarize $entries
    $out.ok = $true; $out.summary = $sum
  }

  'index' {
    $entries = Build-Index
    $out.ok = $true; $out.packageCount = @($entries).Count
  }

  'harvest' {
    if (-not $isAdmin) { $out.error = 'admin'; ($out | ConvertTo-Json -Compress); exit 0 }
    $dest = Join-Path $Lib ('harvested_' + (Get-Date).ToString('yyyyMMdd_HHmmss'))
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Step "Exporting this PC's third-party drivers into the library..."
    $code = Run-Cli 'pnputil.exe' @('/export-driver', '*', $dest)
    $n = @(Get-ChildItem -Path $dest -Recurse -Filter *.inf -File -ErrorAction SilentlyContinue).Count
    Step "Exported $n driver package(s). Rebuilding index..."
    $entries = Build-Index
    $out.ok = ($code -eq 0 -or $n -gt 0); $out.exported = $n; $out.dest = $dest; $out.packageCount = @($entries).Count
  }

  'import' {
    if (-not $Source -or -not (Test-Path $Source)) { $out.error = 'no-source'; ($out | ConvertTo-Json -Compress); exit 0 }
    $base = Split-Path -Leaf ($Source.TrimEnd('\'))
    $safe = ($base -replace '[^\w.() -]+', '_').Trim(); if (-not $safe) { $safe = 'import' }
    $dest = Join-Path $Lib ('imported_' + $safe + '_' + (Get-Date).ToString('yyyyMMdd_HHmmss'))
    New-Item -ItemType Directory -Path $dest -Force | Out-Null
    Step "Copying drivers from $Source ..."
    Copy-Item -Path (Join-Path $Source '*') -Destination $dest -Recurse -Force -ErrorAction SilentlyContinue
    $n = @(Get-ChildItem -Path $dest -Recurse -Filter *.inf -File -ErrorAction SilentlyContinue).Count
    Step "Imported $n driver package(s). Rebuilding index..."
    $entries = Build-Index
    $out.ok = $true; $out.imported = $n; $out.dest = $dest; $out.packageCount = @($entries).Count
  }

  'install' {
    if (-not $isAdmin) { $out.error = 'admin'; ($out | ConvertTo-Json -Compress); exit 0 }
    if ($Inf) {
      if (-not (Test-Path $Inf)) { $out.error = 'inf-missing'; ($out | ConvertTo-Json -Compress); exit 0 }
      $code = Run-Cli 'pnputil.exe' @('/add-driver', $Inf, '/install')
    } else {
      Step 'Adding every matching driver in the library and installing it on present hardware...'
      $code = Run-Cli 'pnputil.exe' @('/add-driver', (Join-Path $Lib '*.inf'), '/subdirs', '/install')
    }
    $out.ok = ($code -eq 0 -or $code -eq 259 -or $code -eq 3010); $out.exitCode = $code
    $out.restartRecommended = ($code -eq 3010)
  }

  'remove' {
    $full = ''
    try { $full = [IO.Path]::GetFullPath($Target) } catch { }
    $libFull = ''
    try { $libFull = [IO.Path]::GetFullPath($Lib) } catch { }
    if (-not $full -or -not $libFull -or -not $full.ToUpper().StartsWith($libFull.ToUpper())) { $out.error = 'bad-target'; ($out | ConvertTo-Json -Compress); exit 0 }
    if (Test-Path $full) { Remove-Item -LiteralPath $full -Recurse -Force -ErrorAction SilentlyContinue }
    $entries = Build-Index
    $out.ok = $true; $out.packageCount = @($entries).Count
  }

  'inject' {
    if (-not $isAdmin) { $out.error = 'admin'; ($out | ConvertTo-Json -Compress); exit 0 }
    if (-not $Image -or -not (Test-Path $Image)) { $out.error = 'image-missing'; ($out | ConvertTo-Json -Compress); exit 0 }
    Step "Injecting the library's drivers into the offline Windows at $Image ..."
    $code = Run-Cli 'dism.exe' @("/Image:$Image", '/Add-Driver', "/Driver:$Lib", '/Recurse')
    $out.ok = ($code -eq 0); $out.exitCode = $code
  }

  default { $out.error = 'unknown-action'; ($out | ConvertTo-Json -Compress); exit 0 }
}

Step 'Finished.'
$out | ConvertTo-Json -Depth 7 -Compress
