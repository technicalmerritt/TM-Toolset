# TM Toolset - Disk Tools: file-based drive / USB speed test.
# Sequential write (flushed to the device), sequential read, and 4K random read,
# on any writable volume. Great for spotting slow / counterfeit USB sticks.
# Non-destructive: writes one temp file in free space and deletes it.
# ASCII-only; streams @@STEP@@ progress; emits one JSON object.
param([string]$Path = '', [int]$SizeMB = 256)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + (("" + $m) -replace '[^\x20-\x7E]', ' ')) } catch { } }
trap {
  $e = [ordered]@{ ok = $false; error = (("" + $_.Exception.Message) -replace '[^\x20-\x7E]', ' '); line = $_.InvocationInfo.ScriptLineNumber }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

$out = [ordered]@{ ok = $false }
if (-not $Path) { $out.error = 'no-path'; ($out | ConvertTo-Json -Compress); exit 0 }
$letter = (("" + $Path).Trim().TrimStart('\').Substring(0, 1)).ToUpper()
if ($letter -notmatch '^[A-Z]$') { $out.error = 'bad-path'; ($out | ConvertTo-Json -Compress); exit 0 }
$root = $letter + ':\'
if (-not (Test-Path $root)) { $out.error = 'not-found'; ($out | ConvertTo-Json -Compress); exit 0 }
if ($SizeMB -lt 32) { $SizeMB = 32 }
if ($SizeMB -gt 8192) { $SizeMB = 8192 }

# Make sure there is room (plus a little headroom).
try {
  $free = [int64](Get-Volume -DriveLetter $letter -ErrorAction Stop).SizeRemaining
  if ($free -gt 0 -and $free -lt ([int64]$SizeMB * 1MB + 64MB)) { $out.error = 'no-space'; ($out | ConvertTo-Json -Compress); exit 0 }
} catch { }

$file = Join-Path $root 'TM-SPEEDTEST.tmp'
$sentinel = Join-Path $env:TEMP 'TM-SPEEDTEST.cancel'
try { if (Test-Path $sentinel) { Remove-Item $sentinel -Force -ErrorAction SilentlyContinue } } catch { }
function Cancelled { try { return (Test-Path $sentinel) } catch { return $false } }

$block = 8MB
$buf = New-Object byte[] $block
(New-Object Random).NextBytes($buf)   # random data so controllers can't cheat by compressing
$rbuf = New-Object byte[] $block
$cancelled = $false
$writeMBps = 0.0; $readMBps = 0.0; $iops = 0; $randMBps = 0.0

try {
  # ---- sequential write (WriteThrough -> real device speed) ----
  Step 'Sequential write...'
  $fs = New-Object System.IO.FileStream($file, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None, $block, [System.IO.FileOptions]::WriteThrough)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $written = [int64]0; $target = [int64]$SizeMB * 1MB
  while ($written -lt $target) {
    $fs.Write($buf, 0, $block); $written += $block
    if (($written % 67108864) -lt $block) { Step ('Writing... ' + [math]::Round($written / 1MB) + ' / ' + $SizeMB + ' MB'); if (Cancelled) { $cancelled = $true; break } }
  }
  $fs.Flush($true); $sw.Stop(); $fs.Dispose()
  if (-not $cancelled -and $sw.Elapsed.TotalSeconds -gt 0) { $writeMBps = [math]::Round(($written / 1MB) / $sw.Elapsed.TotalSeconds, 1) }

  # ---- sequential read ----
  if (-not $cancelled) {
    Step 'Sequential read...'
    $rs = New-Object System.IO.FileStream($file, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None, $block, [System.IO.FileOptions]::SequentialScan)
    $sw2 = [System.Diagnostics.Stopwatch]::StartNew(); $read = [int64]0
    while ($true) {
      $n = $rs.Read($rbuf, 0, $block); if ($n -le 0) { break }
      $read += $n
      if (($read % 67108864) -lt $block) { Step ('Reading... ' + [math]::Round($read / 1MB) + ' MB'); if (Cancelled) { $cancelled = $true; break } }
    }
    $sw2.Stop(); $rs.Dispose()
    if (-not $cancelled -and $sw2.Elapsed.TotalSeconds -gt 0) { $readMBps = [math]::Round(($read / 1MB) / $sw2.Elapsed.TotalSeconds, 1) }
  }

  # ---- 4K random read ----
  if (-not $cancelled) {
    Step '4K random read...'
    $small = New-Object byte[] 4096
    $rs2 = New-Object System.IO.FileStream($file, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None, 4096, [System.IO.FileOptions]::RandomAccess)
    $len = $rs2.Length; $rnd = New-Object Random
    $iter = 2000; $did = 0
    $sw3 = [System.Diagnostics.Stopwatch]::StartNew()
    for ($i = 0; $i -lt $iter; $i++) {
      $maxBlk = [int64]([math]::Floor($len / 4096)) - 1; if ($maxBlk -lt 1) { break }
      $off = [int64]($rnd.Next(0, [int]$maxBlk)) * 4096
      $rs2.Seek($off, [System.IO.SeekOrigin]::Begin) | Out-Null
      $null = $rs2.Read($small, 0, 4096); $did++
      if (($i % 500) -eq 0 -and (Cancelled)) { $cancelled = $true; break }
    }
    $sw3.Stop(); $rs2.Dispose()
    if ($did -gt 0 -and $sw3.Elapsed.TotalSeconds -gt 0) {
      $iops = [int][math]::Round($did / $sw3.Elapsed.TotalSeconds)
      $randMBps = [math]::Round(($did * 4096 / 1MB) / $sw3.Elapsed.TotalSeconds, 2)
    }
  }
} finally {
  try { if (Test-Path $file) { Remove-Item $file -Force -ErrorAction SilentlyContinue } } catch { }
  try { if (Test-Path $sentinel) { Remove-Item $sentinel -Force -ErrorAction SilentlyContinue } } catch { }
}

$out.ok = $true
$out.cancelled = $cancelled
$out.path = $root
$out.sizeMB = $SizeMB
$out.writeMBps = $writeMBps
$out.readMBps = $readMBps
$out.rand4kIops = $iops
$out.rand4kMBps = $randMBps
$out | ConvertTo-Json -Depth 4 -Compress
