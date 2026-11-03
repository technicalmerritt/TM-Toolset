# TM Toolset - Backup & Imaging: guarded partition operations.
# Targets a partition by disk + partition number (never by letter alone) so the
# wrong volume can't be hit. Destructive actions refuse the system/boot disk and
# require a typed confirmation. ASCII-only. Requires administrator rights.
#
#   Action = letter : assign / change drive letter   (-NewLetter)
#   Action = label  : rename the volume label          (-NewLabel)
#   Action = resize : shrink or extend a partition     (-SizeMB, 0 = maximum)
#   Action = format : format a volume                  [DESTRUCTIVE] (-FsType, -NewLabel, -Confirm)
param(
  [string]$Action   = '',
  [int]$Disk        = -1,
  [int]$Part        = -1,
  [string]$NewLetter = '',
  [string]$NewLabel = '',
  [int]$SizeMB      = 0,
  [string]$FsType   = 'NTFS',
  [string]$Confirm  = ''     # format: must equal the partition's current letter (or 'FORMAT' if unlettered)
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
trap {
  $e = [ordered]@{ ok = $false; action = $Action; error = (("" + $_.Exception.Message) -replace '[^\x20-\x7E]', ' '); line = $_.InvocationInfo.ScriptLineNumber }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

$isAdmin = [bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
$out = [ordered]@{ ok = $false; action = $Action; isAdmin = $isAdmin }
if (-not $isAdmin) { $out.error = 'admin'; ($out | ConvertTo-Json -Compress); exit 0 }
if ($Disk -lt 0 -or $Part -lt 0) { $out.error = 'no-target'; ($out | ConvertTo-Json -Compress); exit 0 }

$pt = Get-Partition -DiskNumber $Disk -PartitionNumber $Part -ErrorAction Stop
$sysDrive = ("" + $env:SystemDrive).TrimEnd('\').ToUpper()
$curLetter = ''
if ($pt.DriveLetter) { $curLetter = (("" + $pt.DriveLetter).ToUpper() + ':') }

# A partition is protected from destructive / structural changes.
$protected = $false
if ($pt.IsBoot -or $pt.IsSystem) { $protected = $true }
if ($curLetter -and ($curLetter -eq $sysDrive)) { $protected = $true }
$typeStr = ("" + $pt.Type)
if ($typeStr -match 'Recovery' -or $typeStr -match 'System') { $protected = $true }

switch ($Action) {

  'letter' {
    $L = ("" + $NewLetter).Trim().TrimEnd(':').ToUpper()
    if ($L.Length -ne 1) { $out.error = 'bad-letter'; ($out | ConvertTo-Json -Compress); exit 0 }
    if ($protected) { $out.error = 'protected'; ($out | ConvertTo-Json -Compress); exit 0 }
    Set-Partition -DiskNumber $Disk -PartitionNumber $Part -NewDriveLetter $L -ErrorAction Stop
    $out.ok = $true; $out.letter = ($L + ':')
  }

  'label' {
    if (-not $curLetter) { $out.error = 'no-volume'; ($out | ConvertTo-Json -Compress); exit 0 }
    $lab = (("" + $NewLabel) -replace '[^\x20-\x7E]', '').Trim()
    Set-Volume -DriveLetter ($curLetter.TrimEnd(':')) -NewFileSystemLabel $lab -ErrorAction Stop
    $out.ok = $true; $out.label = $lab
  }

  'resize' {
    if ($protected) { $out.error = 'protected'; ($out | ConvertTo-Json -Compress); exit 0 }
    if ($SizeMB -le 0) {
      $sup = Get-PartitionSupportedSize -DiskNumber $Disk -PartitionNumber $Part -ErrorAction Stop
      Resize-Partition -DiskNumber $Disk -PartitionNumber $Part -Size $sup.SizeMax -ErrorAction Stop
      $out.newSizeBytes = [int64]$sup.SizeMax
    } else {
      $bytes = [int64]$SizeMB * 1MB
      Resize-Partition -DiskNumber $Disk -PartitionNumber $Part -Size $bytes -ErrorAction Stop
      $out.newSizeBytes = $bytes
    }
    $out.ok = $true
  }

  'format' {
    if ($protected) { $out.error = 'protected'; ($out | ConvertTo-Json -Compress); exit 0 }
    $expected = $curLetter; if (-not $expected) { $expected = 'FORMAT' }
    if ((("" + $Confirm).Trim().ToUpper()) -ne $expected) { $out.error = 'confirm-mismatch'; ($out | ConvertTo-Json -Compress); exit 0 }
    $fs = ("" + $FsType).ToUpper(); if ($fs -notin @('NTFS', 'EXFAT', 'FAT32', 'REFS')) { $fs = 'NTFS' }
    $lab = (("" + $NewLabel) -replace '[^\x20-\x7E]', '').Trim()
    if (-not $curLetter) { $out.error = 'no-volume'; ($out | ConvertTo-Json -Compress); exit 0 }
    Format-Volume -DriveLetter ($curLetter.TrimEnd(':')) -FileSystem $fs -NewFileSystemLabel $lab -Confirm:$false -Force -ErrorAction Stop | Out-Null
    $out.ok = $true; $out.fs = $fs; $out.label = $lab
  }

  default { $out.error = 'unknown-action'; ($out | ConvertTo-Json -Compress); exit 0 }
}

$out | ConvertTo-Json -Depth 4 -Compress
