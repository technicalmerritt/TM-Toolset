# TM Toolset - Backup & Imaging: mount / unmount an image for browsing.
# VHD / VHDX / ISO  -> Mount-DiskImage (read-only) and report the drive letters.
# WIM               -> Mount-WindowsImage (read-only) into a temp folder.
# ASCII-only. Requires administrator rights. Mounts are READ-ONLY.
param(
  [string]$Action   = 'mount',   # mount | unmount
  [string]$ImagePath = '',
  [int]$Index       = 1,
  [string]$MountDir = ''         # unmount of a WIM: the folder it was mounted to
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
trap {
  $e = [ordered]@{ ok = $false; error = (("" + $_.Exception.Message) -replace '[^\x20-\x7E]', ' ') }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

$isAdmin = [bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
$out = [ordered]@{ ok = $false; action = $Action; isAdmin = $isAdmin }
if (-not $isAdmin) { $out.error = 'admin'; ($out | ConvertTo-Json -Compress); exit 0 }

$ext = ''
if ($ImagePath) { $ext = ([IO.Path]::GetExtension($ImagePath)).ToLower() }

if ($Action -eq 'mount') {
  if (-not (Test-Path $ImagePath)) { $out.error = 'image-missing'; ($out | ConvertTo-Json -Compress); exit 0 }

  if ($ext -eq '.wim') {
    $dir = Join-Path $env:TEMP ('TM-WIM-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    Mount-WindowsImage -ImagePath $ImagePath -Index $Index -Path $dir -ReadOnly -ErrorAction Stop | Out-Null
    $out.ok = $true; $out.kind = 'wim'; $out.mountDir = $dir; $out.letters = @()
  }
  else {
    Mount-DiskImage -ImagePath $ImagePath -Access ReadOnly -ErrorAction Stop | Out-Null
    $letters = @()
    try {
      $img = Get-DiskImage -ImagePath $ImagePath -ErrorAction SilentlyContinue
      if ($img) {
        foreach ($v in (Get-Disk -Number $img.Number -ErrorAction SilentlyContinue | Get-Partition -ErrorAction SilentlyContinue | Get-Volume -ErrorAction SilentlyContinue)) {
          if ($v.DriveLetter) { $letters += (("" + $v.DriveLetter).ToUpper() + ':') }
        }
      }
    } catch { }
    $out.ok = $true; $out.kind = 'disk'; $out.mountDir = ''; $out.letters = @($letters)
  }
}
elseif ($Action -eq 'unmount') {
  if ($ext -eq '.wim' -or $MountDir) {
    if ($MountDir -and (Test-Path $MountDir)) {
      Dismount-WindowsImage -Path $MountDir -Discard -ErrorAction Stop | Out-Null
      try { Remove-Item $MountDir -Recurse -Force -ErrorAction SilentlyContinue } catch { }
    }
    $out.ok = $true; $out.kind = 'wim'
  }
  else {
    if ($ImagePath) { Dismount-DiskImage -ImagePath $ImagePath -ErrorAction Stop | Out-Null }
    $out.ok = $true; $out.kind = 'disk'
  }
}
else { $out.error = 'unknown-action' }

$out | ConvertTo-Json -Depth 4 -Compress
