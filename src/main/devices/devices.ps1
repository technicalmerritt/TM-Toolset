# TM Toolset - drivers & problem devices (read-only). No admin required.
# Lists Device Manager entries with a problem (ConfigManagerErrorCode <> 0).

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
function Safe { param([scriptblock]$b) try { & $b } catch { $null } }
function Clean { param([string]$s, [int]$max = 200)
  if (-not $s) { return '' }
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) { $c = [int][char]$ch; if ($c -ge 32 -and $c -le 126) { [void]$sb.Append($ch) } }
  $r = $sb.ToString(); if ($r.Length -gt $max) { $r = $r.Substring(0, $max) }; return $r
}
trap {
  $e = [ordered]@{ error = "$($_.Exception.Message)"; line = $_.InvocationInfo.ScriptLineNumber; near = ("$($_.InvocationInfo.Line)").Trim() }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

$out = [ordered]@{}
$out.generatedAt = (Get-Date).ToString('o')

$problems = New-Object System.Collections.Generic.List[object]
$all = Safe { @(Get-CimInstance Win32_PnPEntity) }
$count = 0
foreach ($d in @($all)) {
  try {
    if ($null -eq $d) { continue }
    $code = $d.ConfigManagerErrorCode
    if ($null -eq $code) { continue }
    $codeNum = [int]$code
    if ($codeNum -eq 0) { continue }
    $problems.Add([ordered]@{
      name         = (Clean "$($d.Name)" 140)
      deviceId     = (Clean "$($d.DeviceID)" 200)
      class        = (Clean "$($d.PNPClass)" 50)
      manufacturer = (Clean "$($d.Manufacturer)" 90)
      errorCode    = $codeNum
      status       = (Clean "$($d.Status)" 24)
    })
    $count++
  } catch { continue }
}

# Count with Measure-Object (avoids the @($list).Count overload that throws).
$total = 0
try { $total = [int]((@($all) | Measure-Object).Count) } catch { $total = 0 }

$out.problems     = @($problems | Sort-Object { $_.errorCode } -Descending)
$out.problemCount = $count
$out.totalDevices = $total
$out | ConvertTo-Json -Depth 5 -Compress
