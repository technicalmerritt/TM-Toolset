# TM Toolset - per-drive speed test (needs admin).
# Sequential READ straight off the physical disk (read-only), plus an optional
# sequential WRITE to a temporary file on the drive's largest free volume (the
# temp file is flushed to hardware for a true figure, then deleted).

param([int]$Disk = 0)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + $m) } catch { } }
trap { try { [Console]::Error.WriteLine('@@FATAL@@' + $_.Exception.Message) } catch { }; exit 1 }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$out = [ordered]@{ disk = $Disk; isAdmin = [bool]$admin }
if (-not $admin) { $out.error = 'admin'; ($out | ConvertTo-Json -Compress); exit 0 }

# NB: PowerShell variables are case-insensitive, so this local must NOT be named
# $disk - that would overwrite the [int]$Disk parameter with the disk object and
# break every later use of $Disk (e.g. Get-Partition -DiskNumber $Disk).
$diskObj = Get-Disk -Number $Disk -ErrorAction SilentlyContinue
$size = if ($diskObj) { [int64]$diskObj.Size } else { 0 }
if ($size -le 0) { $out.error = 'size'; ($out | ConvertTo-Json -Compress); exit 0 }

$block = 1MB
$count = 256                       # 256 MB sample
$start = [int64]1GB
if (($start + ($count * $block)) -ge $size) { $start = 0 }

# ---------- Sequential read ----------
$buf = New-Object byte[] $block
$fs = $null
try {
  $fs = New-Object System.IO.FileStream("\\.\PhysicalDrive$Disk", [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  $fs.Seek($start, [System.IO.SeekOrigin]::Begin) | Out-Null
  $read = [int64]0
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  for ($i = 0; $i -lt $count; $i++) {
    $nread = $fs.Read($buf, 0, $block)
    if ($nread -le 0) { break }
    $read += $nread
    if (($i % 32) -eq 0) { Step ("Read test " + [int](100 * $i / $count) + "%") }
  }
  $sw.Stop()
  $secs = $sw.Elapsed.TotalSeconds
  if ($secs -gt 0) { $out.readMBps = [math]::Round(($read / 1MB) / $secs, 1) }
  $out.readMB = [int]($read / 1MB)
} catch {
  $out.readError = "$($_.Exception.Message)"
} finally {
  if ($fs) { try { $fs.Dispose() } catch { } }
}

# ---------- Sequential write (temp file on largest free volume of this disk) ----------
$vol = Get-Partition -DiskNumber $Disk -ErrorAction SilentlyContinue | Get-Volume -ErrorAction SilentlyContinue |
  Where-Object { $_.DriveLetter -and $_.SizeRemaining -gt 2GB } | Sort-Object SizeRemaining -Descending | Select-Object -First 1
if ($vol) {
  $tmp = "$($vol.DriveLetter):\__tmtoolset_speedtest.tmp"
  $ws = $null
  try {
    $wbuf = New-Object byte[] $block
    (New-Object System.Random).NextBytes($wbuf)
    $wcount = 256
    $ws = New-Object System.IO.FileStream($tmp, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    $sw2 = [System.Diagnostics.Stopwatch]::StartNew()
    for ($i = 0; $i -lt $wcount; $i++) {
      $ws.Write($wbuf, 0, $block)
      if (($i % 32) -eq 0) { Step ("Write test " + [int](100 * $i / $wcount) + "%") }
    }
    $ws.Flush($true)                 # push to the device, not just the cache
    $sw2.Stop()
    $secs2 = $sw2.Elapsed.TotalSeconds
    if ($secs2 -gt 0) { $out.writeMBps = [math]::Round($wcount / $secs2, 1) }
    $out.writeMB = $wcount
    $out.writeDrive = "$($vol.DriveLetter):"
  } catch {
    $out.writeError = "$($_.Exception.Message)"
  } finally {
    if ($ws) { try { $ws.Dispose() } catch { } }
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
} else {
  $out.writeNote = 'No writable volume with 2 GB free on this disk - read speed only.'
}

Step 'Finishing up'
$out | ConvertTo-Json -Depth 5 -Compress
