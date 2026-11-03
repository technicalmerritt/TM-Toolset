# TM Toolset - BitLocker pre-work guard. Lists encrypted volumes, protection
# status and recovery keys so firmware/TPM/hardware work doesn't lock a customer
# out. Reading recovery passwords needs administrator rights. Read-only.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
trap { try { [Console]::Out.WriteLine('{"ok":false,"error":"bitlocker-failed","volumes":[]}') } catch { }; exit 0 }
function Clean { param($s) if ($null -eq $s) { return '' } (("" + $s) -replace '[^\x20-\x7E]', ' ').Trim() }

$isAdmin = [bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
$o = [ordered]@{ ok = $true; isAdmin = $isAdmin; supported = $true; volumes = @() }

$vols = @()
try { $vols = @(Get-BitLockerVolume -ErrorAction Stop) } catch { $o.supported = $false }

$any = $false
foreach ($v in $vols) {
  $keys = @()
  foreach ($kp in @($v.KeyProtector)) {
    if ("$($kp.KeyProtectorType)" -eq 'RecoveryPassword' -and $kp.RecoveryPassword) {
      $keys += [ordered]@{ id = Clean $kp.KeyProtectorId; password = Clean $kp.RecoveryPassword }
    }
  }
  $prot = Clean $v.ProtectionStatus
  if ($prot -eq 'On' -or (Clean $v.VolumeStatus) -match 'Encrypt') { $any = $true }
  $o.volumes += [ordered]@{
    mount      = Clean $v.MountPoint
    status     = Clean $v.VolumeStatus
    protection = $prot
    encPct     = [int]$v.EncryptionPercentage
    method     = Clean $v.EncryptionMethod
    keys       = @($keys)
  }
}
$o.anyEncrypted = $any
$o | ConvertTo-Json -Depth 6 -Compress
