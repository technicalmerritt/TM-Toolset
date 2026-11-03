# TM Toolset - battery health (read-only). No admin required.
# Uses the Windows battery report (design vs full-charge capacity, cycle count)
# plus the live charge level. Makes no changes.

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
function Safe { param([scriptblock]$b) try { & $b } catch { $null } }
function Clean { param([string]$s, [int]$max = 120)
  if (-not $s) { return '' }
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) { $c = [int][char]$ch; if ($c -ge 32 -and $c -le 126) { [void]$sb.Append($ch) } }
  $r = $sb.ToString(); if ($r.Length -gt $max) { $r = $r.Substring(0, $max) }; return $r
}
# On any unhandled error, still emit a valid JSON object (with diagnostics) so
# the tab shows a clean message instead of a raw failure - and we can see where.
trap {
  $e = [ordered]@{ error = "$($_.Exception.Message)"; line = $_.InvocationInfo.ScriptLineNumber; near = ("$($_.InvocationInfo.Line)").Trim() }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

$out = [ordered]@{}
$out.generatedAt = (Get-Date).ToString('o')

$bats = @()
$tmp = Join-Path $env:TEMP ("tm_batt_" + ([guid]::NewGuid().ToString('N')) + ".xml")
Safe { powercfg /batteryreport /output "$tmp" /XML | Out-Null }
if (Test-Path $tmp) {
  try {
    [xml]$xml = Get-Content -Path $tmp -Raw
    foreach ($b in @($xml.BatteryReport.Batteries.Battery)) {
      if (-not $b) { continue }
      $design = [double](("$($b.DesignCapacity)") -replace '[^0-9]', '')
      $full   = [double](("$($b.FullChargeCapacity)") -replace '[^0-9]', '')
      $cyc    = "$($b.CycleCount)"
      $cycNum = $null; if ($cyc -match '^\d+$') { $cycNum = [int]$cyc }
      $wear   = $null; if ($design -gt 0) { $wear = [math]::Round((1 - ($full / $design)) * 100, 1) }
      $bats += [ordered]@{
        id                 = (Clean "$($b.Id)" 90)
        manufacturer       = (Clean "$($b.Manufacturer)" 60)
        serial             = (Clean "$($b.SerialNumber)" 60)
        chemistry          = (Clean "$($b.Chemistry)" 20)
        designCapacity     = [int]$design
        fullChargeCapacity = [int]$full
        cycleCount         = $cycNum
        wearPct            = $wear
      }
    }
  } catch { }
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

# Live charge / power state
$cur = $null; $onLine = $null
$w = Safe { @(Get-CimInstance Win32_Battery) }
if ($w -and @($w).Count -gt 0) { $cur = @($w)[0].EstimatedChargeRemaining }
$bs = Safe { Get-CimInstance -Namespace root\wmi -ClassName BatteryStatus }
if ($bs) { $onLine = [bool](@($bs)[0].PowerOnline) }

$batCount = 0
try { $batCount = [int]((@($bats) | Measure-Object).Count) } catch { $batCount = 0 }
$out.hasBattery      = ($batCount -gt 0)
$out.batteries       = @($bats)
$out.currentChargePct = $cur
$out.onACPower       = $onLine

$out | ConvertTo-Json -Depth 5 -Compress
