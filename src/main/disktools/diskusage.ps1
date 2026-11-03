# TM Toolset - disk usage explorer (WinDirStat-style). One recursive pass over
# the given path; for each immediate sub-folder it accumulates size, file count,
# sub-directory count, newest change date and attributes, streaming live
# snapshots as it goes. Loose files in the folder are grouped as "<Files>".
# Read-only.

param([string]$Path = 'C:\')

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + $m) } catch { } }
trap {
  $e = [ordered]@{ path = $Path; error = "$($_.Exception.Message)"; line = $_.InvocationInfo.ScriptLineNumber }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

function Attr-Str {
  param($a)
  $s = ''
  if ($a -band [System.IO.FileAttributes]::ReadOnly)     { $s += 'R' }
  if ($a -band [System.IO.FileAttributes]::Hidden)       { $s += 'H' }
  if ($a -band [System.IO.FileAttributes]::System)       { $s += 'S' }
  if ($a -band [System.IO.FileAttributes]::ReparsePoint) { $s += 'J' }
  if ($a -band [System.IO.FileAttributes]::Compressed)   { $s += 'C' }
  if ($a -band [System.IO.FileAttributes]::Encrypted)    { $s += 'E' }
  return $s
}

# Build the rows array (sorted, top N) from the accumulator hashtable.
function Build-Rows {
  param($info, $topN)
  $top = $info.GetEnumerator() | Sort-Object { [int64]$_.Value.bytes } -Descending | Select-Object -First $topN
  $rows = @()
  foreach ($e in $top) {
    $v = $e.Value
    $lc = ''
    if ($v.last -gt [datetime]'1990-01-01') { $lc = $v.last.ToString('yyyy-MM-dd HH:mm') }
    $rows += @{ n = "$($e.Key)"; b = [int64]$v.bytes; d = [bool]$v.isdir; fi = [int]$v.files; sd = [int]$v.subdirs; lc = $lc; at = "$($v.attr)" }
  }
  return , $rows
}

function Emit-Usage {
  param($info, $grand, $n)
  $snap = @{ f = (Build-Rows $info 45); t = [int64]$grand; n = $n }
  try { [Console]::Error.WriteLine('@@STEP@@@@USAGE@@' + ($snap | ConvertTo-Json -Depth 4 -Compress)) } catch { }
}

$out = [ordered]@{ path = $Path }
$rp = $null
try { $rp = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path } catch { $out.error = 'badpath'; ($out | ConvertTo-Json -Compress); exit 0 }
$out.path = $rp
$base = $rp.TrimEnd('\') + '\'
$baseLen = $base.Length

$info = @{}          # immediate child name -> @{ bytes; files; subdirs; last; attr; isdir }
$topFiles = @()      # rolling buffer of biggest individual files
$n = 0
$grand = [int64]0
$minDate = [datetime]'0001-01-01'
$sw = [System.Diagnostics.Stopwatch]::StartNew()

function Ensure-Key {
  param($info, $key)
  if (-not $info.ContainsKey($key)) {
    $info[$key] = @{ bytes = [int64]0; files = 0; subdirs = 0; last = [datetime]'0001-01-01'; attr = ''; isdir = $true }
  }
}

Step "Scanning $rp - this can take a few minutes on a full drive..."
Get-ChildItem -LiteralPath $rp -Force -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
  $item = $_
  $full = $item.FullName
  if ($full.Length -le $baseLen) { return }
  $rest = $full.Substring($baseLen)
  $bs = $rest.IndexOf('\')
  $isDir = $item.PSIsContainer
  $lw = $item.LastWriteTime

  if ($bs -lt 0) {
    # an immediate child of the scanned folder
    if ($isDir) {
      Ensure-Key $info $rest
      $info[$rest].isdir = $true
      $info[$rest].attr = (Attr-Str $item.Attributes)
      if ($lw -gt $info[$rest].last) { $info[$rest].last = $lw }
    } else {
      Ensure-Key $info '<Files>'
      $info['<Files>'].isdir = $false
      $len = [int64]$item.Length
      $info['<Files>'].bytes += $len
      $info['<Files>'].files += 1
      $grand += $len
      if ($lw -gt $info['<Files>'].last) { $info['<Files>'].last = $lw }
      $topFiles += [pscustomobject]@{ path = $full; size = $len }
      if ($topFiles.Count -ge 250) { $topFiles = @($topFiles | Sort-Object size -Descending | Select-Object -First 60) }
    }
  } else {
    $key = $rest.Substring(0, $bs)
    Ensure-Key $info $key
    if ($isDir) {
      $info[$key].subdirs += 1
    } else {
      $len = [int64]$item.Length
      $info[$key].bytes += $len
      $info[$key].files += 1
      $grand += $len
      $topFiles += [pscustomobject]@{ path = $full; size = $len }
      if ($topFiles.Count -ge 250) { $topFiles = @($topFiles | Sort-Object size -Descending | Select-Object -First 60) }
    }
    if ($lw -gt $info[$key].last) { $info[$key].last = $lw }
  }

  $n++
  if ($sw.ElapsedMilliseconds -ge 350) { Emit-Usage $info $grand $n; $sw.Restart() }
}

$rowsArr = Build-Rows $info 200
$folders = @()
foreach ($r in $rowsArr) {
  $folders += [ordered]@{ name = $r.n; bytes = [int64]$r.b; isDir = [bool]$r.d; files = [int]$r.fi; subdirs = [int]$r.sd; lastChange = "$($r.lc)"; attr = "$($r.at)" }
}
$files = @($topFiles | Sort-Object size -Descending | Select-Object -First 50 | ForEach-Object { [ordered]@{ path = $_.path; bytes = [int64]$_.size } })

$out.folders = @($folders)
$out.files = @($files)
$out.totalBytes = [int64]$grand
$out.scannedFiles = $n
Step 'Done.'
$out | ConvertTo-Json -Depth 5 -Compress
