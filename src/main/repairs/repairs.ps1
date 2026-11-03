# TM Toolset - guided repairs. Runs a single named maintenance action and
# streams its output live. System-changing actions make a restore point first.
# Requires administrator rights (except clearing the user temp folder).

param([string]$Action = '')

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + $m) } catch { } }
function Safe { param([scriptblock]$b) try { & $b } catch { $null } }
trap {
  $e = [ordered]@{ action = $Action; ok = $false; error = "$($_.Exception.Message)"; line = $_.InvocationInfo.ScriptLineNumber }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

$isAdmin = [bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
$out = [ordered]@{ action = $Action; isAdmin = $isAdmin }

$needsAdmin = @('sfc', 'dism', 'chkdsk', 'wureset', 'netreset', 'flushdns', 'restorepoint')
if ((-not $isAdmin) -and ($needsAdmin -contains $Action)) {
  $out.ok = $false; $out.error = 'admin'
  ($out | ConvertTo-Json -Depth 4 -Compress); exit 0
}

function Run-Cli {
  param([string]$exe, [string[]]$cliArgs)
  Step ("> $exe " + ($cliArgs -join ' '))
  $code = 0
  try {
    & $exe @cliArgs 2>&1 | ForEach-Object { $line = "$_"; if ($line.Trim().Length -gt 0) { Step $line } }
    $code = $LASTEXITCODE
  } catch {
    Step ("Error: " + $_.Exception.Message); $code = -1
  }
  if ($null -eq $code) { $code = 0 }
  return $code
}

function New-RestorePoint {
  param([string]$desc)
  Step "Creating a system restore point ($desc)..."
  try {
    Safe { Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction SilentlyContinue }
    Checkpoint-Computer -Description $desc -RestorePointType 'MODIFY_SETTINGS' -ErrorAction Stop
    Step "Restore point created."
  } catch {
    Step "Restore point skipped: $($_.Exception.Message) - System Restore may be off, or one was already made in the last 24 hours."
  }
}

$code = 0
switch ($Action) {
  'restorepoint' { New-RestorePoint 'TM Toolset manual restore point' }
  'sfc'    { $code = Run-Cli 'sfc.exe'      @('/scannow') }
  'dism'   { $code = Run-Cli 'dism.exe'     @('/Online', '/Cleanup-Image', '/RestoreHealth') }
  'chkdsk' { $code = Run-Cli 'chkdsk.exe'   @("$env:SystemDrive", '/scan') }
  'flushdns' { $code = Run-Cli 'ipconfig.exe' @('/flushdns') }
  'cleartemp' {
    Step 'Clearing temporary files...'
    $freed = [int64]0
    foreach ($p in @("$env:TEMP", "$env:SystemRoot\Temp")) {
      if (Test-Path $p) {
        Step "Cleaning $p"
        Get-ChildItem -Path $p -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
          try { $freed += [int64]$_.Length; Remove-Item $_.FullName -Force -Recurse -ErrorAction SilentlyContinue } catch { }
        }
      }
    }
    Step ("Done - freed roughly " + [math]::Round($freed / 1MB) + " MB (files in use were skipped).")
  }
  'wureset' {
    New-RestorePoint 'TM Toolset - before Windows Update reset'
    Step 'Stopping Windows Update services...'
    foreach ($s in @('wuauserv', 'bits', 'cryptsvc', 'msiserver')) { Safe { Stop-Service -Name $s -Force -ErrorAction SilentlyContinue }; Step "  stopped $s" }
    Step 'Renaming SoftwareDistribution and catroot2...'
    $stamp = (Get-Date).ToString('yyyyMMddHHmmss')
    $sd = "$env:SystemRoot\SoftwareDistribution"; $cr = "$env:SystemRoot\System32\catroot2"
    Safe { if (Test-Path $sd) { Rename-Item $sd "$sd.old.$stamp" -Force -ErrorAction SilentlyContinue } }
    Safe { if (Test-Path $cr) { Rename-Item $cr "$cr.old.$stamp" -Force -ErrorAction SilentlyContinue } }
    Step 'Starting services...'
    foreach ($s in @('cryptsvc', 'bits', 'wuauserv', 'msiserver')) { Safe { Start-Service -Name $s -ErrorAction SilentlyContinue }; Step "  started $s" }
    Step 'Windows Update components reset. A restart is recommended.'
  }
  'netreset' {
    New-RestorePoint 'TM Toolset - before network reset'
    $code = Run-Cli 'netsh.exe' @('winsock', 'reset')
    $null = Run-Cli 'netsh.exe' @('int', 'ip', 'reset')
    $null = Run-Cli 'ipconfig.exe' @('/flushdns')
    Step 'Network stack reset. A RESTART is required to finish.'
  }
  default {
    $out.ok = $false; $out.error = 'unknown-action'
    ($out | ConvertTo-Json -Depth 4 -Compress); exit 0
  }
}

$out.exitCode = $code
$out.ok = ($code -eq 0)
$out.restartRecommended = (@('wureset', 'netreset') -contains $Action)
Step 'Finished.'
$out | ConvertTo-Json -Depth 4 -Compress
