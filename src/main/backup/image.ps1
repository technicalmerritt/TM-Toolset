# TM Toolset - Backup & Imaging: create / apply images using Windows' own
# proven engines (wbadmin for bootable system images, DISM for volume WIMs).
# Streams live output as @@STEP@@ lines; emits one JSON object at the end.
# ASCII-only. Requires administrator rights.
#
#   Mode = systemimage : wbadmin full bootable image of the OS (-allCritical)
#   Mode = capture     : DISM /Capture-Image  (a volume -> a .wim file)
#   Mode = apply       : DISM /Apply-Image     (a .wim file -> a volume)  [DESTRUCTIVE, guarded]
param(
  [string]$Mode    = '',
  [string]$Source  = '',   # capture: source volume letter e.g. D:   systemimage: volume to include e.g. C:
  [string]$Target  = '',   # systemimage: target drive e.g. E:   capture/apply: full .wim path
  [string]$Name    = '',   # image friendly name
  [string]$ApplyTo = '',   # apply: destination volume letter e.g. F:
  [int]$Index      = 1,    # apply: image index inside the wim
  [string]$Confirm = ''    # apply: must equal ApplyTo letter as a safety interlock
)

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + (("" + $m) -replace '[^\x20-\x7E]', ' ')) } catch { } }
trap {
  $e = [ordered]@{ ok = $false; mode = $Mode; error = (("" + $_.Exception.Message) -replace '[^\x20-\x7E]', ' '); line = $_.InvocationInfo.ScriptLineNumber }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

$isAdmin = [bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
$out = [ordered]@{ ok = $false; mode = $Mode; isAdmin = $isAdmin }
if (-not $isAdmin) { $out.error = 'admin'; ($out | ConvertTo-Json -Compress); exit 0 }

function Norm-Letter { param($s) $t = ("" + $s).Trim().TrimEnd('\').ToUpper(); if ($t -and ($t -notmatch ':$')) { $t = $t + ':' }; return $t }

function Run-Cli {
  param([string]$exe, [string[]]$cliArgs)
  Step ("> $exe " + ($cliArgs -join ' '))
  $code = 0
  try {
    & $exe @cliArgs 2>&1 | ForEach-Object { $line = "$_"; if ($line.Trim().Length -gt 0) { Step $line } }
    $code = $LASTEXITCODE
  } catch {
    Step ('Error: ' + $_.Exception.Message); $code = -1
  }
  if ($null -eq $code) { $code = 0 }
  return $code
}

$code = 0
switch ($Mode) {

  'systemimage' {
    $tgt = Norm-Letter $Target
    $inc = Norm-Letter $Source
    if (-not $tgt) { $out.error = 'no-target'; ($out | ConvertTo-Json -Compress); exit 0 }
    Step "Preparing a full, bootable system image with Windows Backup (wbadmin)."
    Step "Target: $tgt   This writes a WindowsImageBackup folder onto the target drive."
    $wbArgs = @('start', 'backup', "-backupTarget:$tgt", '-allCritical', '-vssFull', '-quiet')
    if ($inc) { $wbArgs += "-include:$inc" }
    $code = Run-Cli 'wbadmin.exe' $wbArgs
    $out.target = $tgt
  }

  'capture' {
    $src = Norm-Letter $Source
    if (-not $src) { $out.error = 'no-source'; ($out | ConvertTo-Json -Compress); exit 0 }
    if (-not $Target) { $out.error = 'no-target'; ($out | ConvertTo-Json -Compress); exit 0 }
    $dir = Split-Path -Path $Target -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (Test-Path $Target) { $out.error = 'target-exists'; ($out | ConvertTo-Json -Compress); exit 0 }
    $nm = $Name; if (-not $nm) { $nm = "TM image of $src" }
    Step "Capturing volume $src into a WIM image with DISM."
    Step "This reads the files on $src and writes $Target. The source is not changed."
    $code = Run-Cli 'dism.exe' @('/Capture-Image', "/ImageFile:$Target", "/CaptureDir:$src\", "/Name:$nm", '/Compress:fast')
    $out.source = $src; $out.imageFile = $Target
  }

  'apply' {
    $dest = Norm-Letter $ApplyTo
    $conf = Norm-Letter $Confirm
    if (-not $dest)            { $out.error = 'no-dest'; ($out | ConvertTo-Json -Compress); exit 0 }
    if (-not (Test-Path $Target)) { $out.error = 'image-missing'; ($out | ConvertTo-Json -Compress); exit 0 }
    if ($conf -ne $dest)       { $out.error = 'confirm-mismatch'; ($out | ConvertTo-Json -Compress); exit 0 }

    # Hard safety interlock: never apply onto the running Windows / system / boot volume.
    $sysDrive = ("" + $env:SystemDrive).TrimEnd('\').ToUpper()
    if ($dest -eq $sysDrive) { $out.error = 'dest-is-system'; ($out | ConvertTo-Json -Compress); exit 0 }
    $protected = $false
    try {
      $pt = Get-Partition -DriveLetter ($dest.TrimEnd(':')) -ErrorAction SilentlyContinue
      if ($pt -and ($pt.IsBoot -or $pt.IsSystem)) { $protected = $true }
    } catch { }
    if ($protected) { $out.error = 'dest-protected'; ($out | ConvertTo-Json -Compress); exit 0 }

    Step "Applying image $Target (index $Index) onto volume $dest with DISM."
    Step "WARNING: existing contents of $dest will be overwritten."
    $code = Run-Cli 'dism.exe' @('/Apply-Image', "/ImageFile:$Target", "/Index:$Index", "/ApplyDir:$dest\")
    $out.applyTo = $dest; $out.imageFile = $Target
  }

  default { $out.error = 'unknown-mode'; ($out | ConvertTo-Json -Compress); exit 0 }
}

$out.exitCode = $code
$out.ok = ($code -eq 0)
Step 'Finished.'
$out | ConvertTo-Json -Depth 4 -Compress
