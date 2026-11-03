# TM Toolset - counterfeit / fake-capacity drive tester.
# Writes uniquely-stamped data across the drive's free space, flushing each
# block straight to the device (WriteThrough), then reads it all back and
# verifies the stamp. A fake drive either WRAPS (re-uses the same physical
# cells, so earlier stamps reappear) or returns ZEROS past its real size - the
# first block that fails to verify marks the TRUE capacity.
# File-based and non-destructive to existing files, but it fills free space, so
# run it on an empty / freshly-formatted drive for a clean, fast result.
# ASCII-only. Does NOT require administrator rights.
param(
  [string]$Path  = '',     # volume root to test, e.g. E:\
  [double]$MaxGB = 0,      # cap the amount written (0 = all free space)
  [int]$FlushEvery = 0     # reserved
)

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

# Never fill the running Windows / system drive.
$sysLetter = ("" + $env:SystemDrive).TrimEnd(':\').Substring(0, 1).ToUpper()
if ($letter -eq $sysLetter) { $out.error = 'is-system'; ($out | ConvertTo-Json -Compress); exit 0 }

if (-not (Test-Path $root)) { $out.error = 'not-found'; ($out | ConvertTo-Json -Compress); exit 0 }

$free = $null
try { $v = Get-Volume -DriveLetter $letter -ErrorAction Stop; $free = [int64]$v.SizeRemaining } catch { }
if ($null -eq $free) {
  try { $d = Get-PSDrive -Name $letter -ErrorAction Stop; $free = [int64]$d.Free } catch { }
}
if ($null -eq $free -or $free -le 0) { $out.error = 'no-free-space'; ($out | ConvertTo-Json -Compress); exit 0 }

$MAGIC    = [uint32]0x544D4331   # 'TMC1'
$block    = 1048576              # 1 MB stamp block
$margin   = 64MB                 # leave headroom so the volume never hits 100%
$target   = $free - $margin
if ($MaxGB -gt 0) {
  $cap = [int64]($MaxGB * 1GB)
  if ($cap -lt $target) { $target = $cap }
}
$target = [int64]($target - ($target % $block))
if ($target -lt $block) { $out.error = 'too-small'; ($out | ConvertTo-Json -Compress); exit 0 }

$testDir  = Join-Path $root 'TM-CAPTEST'
$sentinel = Join-Path $env:TEMP 'TM-CAPTEST.cancel'
try { if (Test-Path $sentinel) { Remove-Item $sentinel -Force -ErrorAction SilentlyContinue } } catch { }
try { if (Test-Path $testDir) { Remove-Item $testDir -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
New-Item -ItemType Directory -Path $testDir -Force | Out-Null

function Cancelled { try { return (Test-Path $sentinel) } catch { return $false } }

$buf  = New-Object byte[] $block
$rbuf = New-Object byte[] $block

Step ("Target: write and verify " + [math]::Round($target / 1GB, 2) + " GB on " + $root)

# ---------- WRITE PASS ----------
$written   = [int64]0
$fileIndex = 0
$writeErr  = ''
$cancelled = $false
while ($written -lt $target) {
  if (Cancelled) { $cancelled = $true; break }
  $file = Join-Path $testDir ("cap{0:D5}.bin" -f $fileIndex)
  $fileTarget = [int64][math]::Min([double]($target - $written), [double]1GB)
  $fs = $null
  try {
    $fs = New-Object System.IO.FileStream($file, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None, $block, [System.IO.FileOptions]::WriteThrough)
    $n = [int64]0
    while ($n -lt $fileTarget) {
      $ob = [BitConverter]::GetBytes([int64]$written)
      [Array]::Copy($ob, 0, $buf, 0, 8)
      $mb = [BitConverter]::GetBytes([uint32]$MAGIC)
      [Array]::Copy($mb, 0, $buf, 8, 4)
      $fs.Write($buf, 0, $block)
      $written += $block; $n += $block
      if (($written % 268435456) -lt $block) {
        Step ("Writing... " + [math]::Round($written / 1GB, 2) + " GB")
        if (Cancelled) { $cancelled = $true; break }
      }
    }
    $fs.Flush($true)
  } catch {
    $writeErr = ("" + $_.Exception.Message) -replace '[^\x20-\x7E]', ' '
    Step ("Write stopped at " + [math]::Round($written / 1GB, 2) + " GB: " + $writeErr)
  } finally {
    if ($fs) { try { $fs.Dispose() } catch { } }
  }
  if ($writeErr -or $cancelled) { break }
  $fileIndex++
}

# ---------- VERIFY PASS ----------
$expect   = [int64]0
$verified = [int64]0
$firstBad = [int64](-1)
if (-not $cancelled) {
  Step "Write pass done. Reading everything back to verify..."
  for ($i = 0; $i -le $fileIndex; $i++) {
    if (Cancelled) { $cancelled = $true; break }
    $file = Join-Path $testDir ("cap{0:D5}.bin" -f $i)
    if (-not (Test-Path $file)) { continue }
    $rfs = $null
    try {
      $rfs = New-Object System.IO.FileStream($file, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None, $block, [System.IO.FileOptions]::SequentialScan)
      while ($true) {
        $read = $rfs.Read($rbuf, 0, $block)
        if ($read -lt $block) { break }
        $gotOff   = [BitConverter]::ToInt64($rbuf, 0)
        $gotMagic = [BitConverter]::ToUInt32($rbuf, 8)
        if ($gotOff -ne $expect -or $gotMagic -ne $MAGIC) { $firstBad = $expect; break }
        $verified += $block; $expect += $block
        if (($verified % 268435456) -lt $block) {
          Step ("Verifying... " + [math]::Round($verified / 1GB, 2) + " GB")
          if (Cancelled) { $cancelled = $true; break }
        }
      }
    } catch {
      $firstBad = $expect
      Step ("Read error at " + [math]::Round($expect / 1GB, 2) + " GB: " + ((("" + $_.Exception.Message) -replace '[^\x20-\x7E]', ' ')))
    } finally {
      if ($rfs) { try { $rfs.Dispose() } catch { } }
    }
    if ($firstBad -ge 0) { break }
  }
}

# ---------- CLEAN UP ----------
Step "Cleaning up test files..."
try { if (Test-Path $testDir) { Remove-Item $testDir -Recurse -Force -ErrorAction SilentlyContinue } } catch { }
try { if (Test-Path $sentinel) { Remove-Item $sentinel -Force -ErrorAction SilentlyContinue } } catch { }

# A drive is fake / mis-reporting if verification failed, or if writes died well
# short of the claimed free space (device refused data past its real size).
$shortfall = ($writeErr -ne '') -and ($written -lt ($target * 0.95))
$fake = ($firstBad -ge 0) -or $shortfall
if ($firstBad -ge 0) { $real = $firstBad }
elseif ($shortfall)  { $real = $written }
else                 { $real = $written }

$out.ok               = $true
$out.cancelled        = $cancelled
$out.path             = $root
$out.claimedSizeBytes = [int64]($v.Size)
$out.claimedFreeBytes = $free
$out.targetBytes      = $target
$out.writtenBytes     = $written
$out.verifiedBytes    = $verified
$out.firstBadOffset   = $firstBad
$out.realCapacityBytes = [int64]$real
$out.fake             = ([bool]$fake -and -not $cancelled)
$out.writeError       = $writeErr
$out | ConvertTo-Json -Depth 4 -Compress
