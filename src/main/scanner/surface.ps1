# TM Toolset — online surface / file-system scan (read-only). Needs admin.
# Runs Repair-Volume -Scan on each fixed volume (the online equivalent of
# chkdsk /scan) and reports whether errors were found. Makes no repairs.

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'

function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + $m) } catch { } }
function Safe { param([scriptblock]$b) try { & $b } catch { $null } }
trap { try { [Console]::Error.WriteLine('@@FATAL@@' + $_.Exception.Message) } catch { }; exit 1 }

$out = [ordered]@{}
$out.generatedAt = (Get-Date).ToString('o')

$admin = Safe {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
$out.isAdmin = [bool]$admin

$results = @()
$vols = Safe { Get-Volume | Where-Object { $_.DriveLetter -and $_.DriveType -eq 'Fixed' } }
foreach ($v in $vols) {
  $letter = "$($v.DriveLetter)"
  Step "Scanning $letter`: (this can take a while)"
  $r = Safe { "$(Repair-Volume -DriveLetter $letter -Scan -ErrorAction SilentlyContinue)" }
  if (-not $r) { $r = 'Unknown' }
  $results += [ordered]@{
    drive  = "$letter`:"
    label  = "$($v.FileSystemLabel)"
    fs     = "$($v.FileSystem)"
    result = $r
  }
}
$out.volumes = $results

Step 'Finishing up'
$out | ConvertTo-Json -Depth 5 -Compress
