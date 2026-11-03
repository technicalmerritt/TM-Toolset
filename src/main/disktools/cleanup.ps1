# TM Toolset - junk cleanup (CCleaner-style). Two modes:
#   -Mode scan            -> measure reclaimable space per category (no changes)
#   -Mode clean -Ids a,b  -> delete the chosen categories, report space freed
# Only well-known safe junk is touched. Files in use are skipped.

param([string]$Mode = 'scan', [string]$Ids = '')

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + $m) } catch { } }
function Safe { param([scriptblock]$b) try { & $b } catch { $null } }
trap {
  $e = [ordered]@{ mode = $Mode; error = "$($_.Exception.Message)"; line = $_.InvocationInfo.ScriptLineNumber }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

function Get-Cats {
  $c = @()
  $c += @{ id = 'user-temp';    label = 'User temporary files';              type = 'contents'; paths = @("$env:TEMP") }
  $c += @{ id = 'win-temp';     label = 'Windows temporary files';           type = 'contents'; paths = @("$env:SystemRoot\Temp") }
  $c += @{ id = 'win-update';   label = 'Windows Update cache';              type = 'contents'; paths = @("$env:SystemRoot\SoftwareDistribution\Download") }
  $c += @{ id = 'wer';          label = 'Windows error reports';             type = 'contents'; paths = @("$env:LOCALAPPDATA\Microsoft\Windows\WER", "$env:ProgramData\Microsoft\Windows\WER") }
  $c += @{ id = 'prefetch';     label = 'Prefetch data (rebuilds itself)';   type = 'contents'; paths = @("$env:SystemRoot\Prefetch") }
  $c += @{ id = 'thumbnails';   label = 'Thumbnail & icon cache';            type = 'glob';     paths = @("$env:LOCALAPPDATA\Microsoft\Windows\Explorer\thumbcache_*.db", "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache_*.db") }
  $c += @{ id = 'browser-cache'; label = 'Browser caches (Chrome, Edge, Firefox)'; type = 'glob'; paths = @("$env:LOCALAPPDATA\Google\Chrome\User Data\*\Cache\*", "$env:LOCALAPPDATA\Microsoft\Edge\User Data\*\Cache\*", "$env:LOCALAPPDATA\Mozilla\Firefox\Profiles\*\cache2\*") }
  $c += @{ id = 'recycle-bin';  label = 'Recycle Bin';                        type = 'recycle'; paths = @() }
  return $c
}

function Measure-Cat {
  param($cat)
  $sum = [int64]0; $cnt = 0
  if ($cat.type -eq 'recycle') {
    foreach ($d in (Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue)) {
      $rb = Join-Path $d.Root '$Recycle.Bin'
      if (Test-Path $rb) { Get-ChildItem -LiteralPath $rb -Force -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { $sum += [int64]$_.Length; $cnt++ } }
    }
  } else {
    foreach ($p in $cat.paths) {
      Get-ChildItem -Path $p -Force -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object { $sum += [int64]$_.Length; $cnt++ }
    }
  }
  return @{ bytes = $sum; count = $cnt }
}

function Clean-Cat {
  param($cat)
  if ($cat.type -eq 'recycle') {
    Safe { Clear-RecycleBin -Force -ErrorAction SilentlyContinue }
    return
  }
  foreach ($p in $cat.paths) {
    if ($cat.type -eq 'glob') {
      Get-ChildItem -Path $p -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Safe { Remove-Item -LiteralPath $_.FullName -Force -Recurse -ErrorAction SilentlyContinue } }
    } else {
      if (Test-Path $p) {
        Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue | ForEach-Object { Safe { Remove-Item -LiteralPath $_.FullName -Force -Recurse -ErrorAction SilentlyContinue } }
      }
    }
  }
}

$out = [ordered]@{ mode = $Mode }

if ($Mode -eq 'clean') {
  $wanted = @(($Ids -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 })
  $cleaned = @(); $total = [int64]0
  foreach ($c in (Get-Cats)) {
    if ($wanted -notcontains $c.id) { continue }
    Step "Cleaning $($c.label)..."
    $before = (Measure-Cat $c).bytes
    Clean-Cat $c
    $total += [int64]$before
    $cleaned += [ordered]@{ id = $c.id; label = $c.label; freedBytes = [int64]$before }
  }
  $out.cleaned = @($cleaned)
  $out.totalFreed = [int64]$total
  Step 'Done.'
  $out | ConvertTo-Json -Depth 5 -Compress
  exit 0
}

# scan
$cats = @(); $total = [int64]0
foreach ($c in (Get-Cats)) {
  Step "Measuring $($c.label)..."
  $m = Measure-Cat $c
  $total += [int64]$m.bytes
  $cats += [ordered]@{ id = $c.id; label = $c.label; bytes = [int64]$m.bytes; count = $m.count }
}
$out.categories = @($cats)
$out.totalBytes = [int64]$total
Step 'Done.'
$out | ConvertTo-Json -Depth 5 -Compress
