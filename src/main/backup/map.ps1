# TM Toolset - Backup & Imaging: read-only disk + partition map.
# Enumerates every physical disk, its partitions and volumes with rich detail.
# Makes NO changes. ASCII-only output; plain arrays only.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
trap { try { [Console]::Out.WriteLine('{"ok":false,"disks":[],"error":"collect-failed"}') } catch { }; exit 0 }

function Clean { param($s) if ($null -eq $s) { return '' } (("" + $s) -replace '[^\x20-\x7E]', ' ').Trim() }

$isAdmin = [bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
$sysDrive = ("" + $env:SystemDrive).TrimEnd('\').ToUpper()   # e.g. C:

# BitLocker protection status by mount point (admin only).
$bl = @{}
try {
  foreach ($b in (Get-BitLockerVolume -ErrorAction SilentlyContinue)) {
    if ($b.MountPoint) { $bl[(("" + $b.MountPoint).TrimEnd('\').ToUpper())] = "$($b.ProtectionStatus)" }
  }
} catch { }

# Physical-disk extras (bus / media type) keyed by disk number.
$pd = @{}
try {
  foreach ($p in (Get-PhysicalDisk -ErrorAction SilentlyContinue)) {
    $pd["$($p.DeviceId)"] = [ordered]@{ media = (Clean $p.MediaType); bus = (Clean $p.BusType) }
  }
} catch { }

$disks = @()
foreach ($d in (Get-Disk -ErrorAction SilentlyContinue | Sort-Object Number)) {
  $parts = @()
  foreach ($pt in (Get-Partition -DiskNumber $d.Number -ErrorAction SilentlyContinue | Sort-Object Offset)) {
    $vol = $null
    try { $vol = ($pt | Get-Volume -ErrorAction SilentlyContinue) } catch { }

    $letter = ''
    if ($pt.DriveLetter -and ("" + $pt.DriveLetter).Trim()) { $letter = (("" + $pt.DriveLetter).Trim().ToUpper()) }

    $fs = ''; $label = ''; $free = $null
    if ($vol) {
      $fs = Clean $vol.FileSystem
      $label = Clean $vol.FileSystemLabel
      if ($null -ne $vol.SizeRemaining) { $free = [int64]$vol.SizeRemaining }
    }

    $typ = Clean $pt.Type
    $flags = @()
    if ($pt.IsBoot)   { $flags += 'Boot' }
    if ($pt.IsSystem) { $flags += 'System' }
    if ($pt.IsActive) { $flags += 'Active' }
    if ($typ -match 'Recovery') { $flags += 'Recovery' }

    $blk = ''
    $letterColon = ''
    if ($letter) { $letterColon = $letter + ':' ; if ($bl.ContainsKey($letterColon)) { $blk = $bl[$letterColon] } }

    # A partition is protected (never a safe destructive target) if it is the
    # system/boot volume, holds Windows, or is an EFI / recovery partition.
    $protected = $false
    if ($pt.IsBoot -or $pt.IsSystem) { $protected = $true }
    if ($letterColon -and ($letterColon -eq $sysDrive)) { $protected = $true }
    if ($typ -match 'Recovery' -or $typ -match 'System') { $protected = $true }

    $parts += [ordered]@{
      number      = [int]$pt.PartitionNumber
      letter      = $letter
      label       = $label
      fs          = $fs
      type        = $typ
      sizeBytes   = [int64]$pt.Size
      freeBytes   = $free
      offsetBytes = [int64]$pt.Offset
      flags       = @($flags)
      bitlocker   = $blk
      protected   = $protected
    }
  }

  $extra = $pd["$($d.Number)"]
  $bus = ''; $media = ''
  if ($extra) { $bus = $extra.bus; $media = $extra.media }
  if (-not $bus) { $bus = Clean $d.BusType }

  $disks += [ordered]@{
    number     = [int]$d.Number
    model      = Clean $d.FriendlyName
    serial     = Clean $d.SerialNumber
    sizeBytes  = [int64]$d.Size
    partStyle  = Clean $d.PartitionStyle
    busType    = $bus
    mediaType  = $media
    health     = Clean $d.HealthStatus
    isBoot     = [bool]$d.IsBoot
    isSystem   = [bool]$d.IsSystem
    isOffline  = [bool]$d.IsOffline
    isReadOnly = [bool]$d.IsReadOnly
    partitions = @($parts)
  }
}

[ordered]@{ ok = $true; isAdmin = $isAdmin; sysDrive = $sysDrive; disks = @($disks) } | ConvertTo-Json -Depth 6 -Compress
