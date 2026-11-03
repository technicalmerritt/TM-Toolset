# TM Toolset - per-drive surface test (read-only, needs admin).
# Reads 1 MB blocks sampled evenly across the WHOLE physical disk, timing each
# and catching read errors, so a failing/weak area shows up as an unreadable or
# very slow block. It never writes to the disk.

param([int]$Disk = 0)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + $m) } catch { } }
trap { try { [Console]::Error.WriteLine('@@FATAL@@' + $_.Exception.Message) } catch { }; exit 1 }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$out = [ordered]@{ disk = $Disk; isAdmin = [bool]$admin }
if (-not $admin) { $out.error = 'admin'; ($out | ConvertTo-Json -Compress); exit 0 }

$disk = Get-Disk -Number $Disk -ErrorAction SilentlyContinue
$size = if ($disk) { [int64]$disk.Size } else { 0 }
if ($size -le 0) { $out.error = 'size'; ($out | ConvertTo-Json -Compress); exit 0 }
$out.sizeBytes = $size

$block = 1MB
$samples = 400
if ($size -lt ($samples * $block * 4)) {
  $samples = [int][math]::Max(20, [math]::Floor($size / ($block * 4)))
}
$step = [int64]([math]::Floor($size / $samples))
$step = [int64]([math]::Floor($step / $block) * $block)   # keep offsets 1 MB aligned
if ($step -lt $block) { $step = $block }

$buf = New-Object byte[] $block
$bad = @()
$slow = @()
$times = @()
$tested = 0
$errs = 0
$sw = New-Object System.Diagnostics.Stopwatch
$fs = $null
try {
  $fs = New-Object System.IO.FileStream("\\.\PhysicalDrive$Disk", [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  for ($off = 0; ($off + $block) -le $size; $off += $step) {
    try {
      $fs.Seek([int64]$off, [System.IO.SeekOrigin]::Begin) | Out-Null
      $sw.Restart()
      $nread = $fs.Read($buf, 0, $block)
      $sw.Stop()
      $tested++
      if ($nread -le 0) {
        $errs++; $bad += [math]::Round($off / 1GB, 1)
      } else {
        $ms = $sw.Elapsed.TotalMilliseconds
        $times += $ms
        if ($ms -ge 500) { $slow += [ordered]@{ atGB = [math]::Round($off / 1GB, 1); ms = [int]$ms } }
      }
    } catch {
      $errs++; $bad += [math]::Round($off / 1GB, 1)
    }
    if (($tested % 15) -eq 0) { Step ("Surface scan " + [int](100 * $off / $size) + "%  (" + $tested + " regions, " + $errs + " errors)") }
  }
} catch {
  $out.error = 'open'; $out.detail = "$($_.Exception.Message)"
  ($out | ConvertTo-Json -Depth 5 -Compress); exit 0
} finally {
  if ($fs) { try { $fs.Dispose() } catch { } }
}

$avgMs = if ($times.Count) { ($times | Measure-Object -Average).Average } else { 0 }
$maxMs = if ($times.Count) { ($times | Measure-Object -Maximum).Maximum } else { 0 }
$out.regionsTested = $tested
$out.readErrors = $errs
$out.badRegionsGB = @($bad)
$out.slowRegions = @($slow)
$out.avgMsPerBlock = [math]::Round($avgMs, 1)
$out.maxMsPerBlock = [math]::Round($maxMs, 1)
$out.coverage = 'sampled'
Step 'Finishing up'
$out | ConvertTo-Json -Depth 5 -Compress
