# TM Toolset - BIOS/UEFI: read-only firmware info for the running system.
# ASCII-only; plain arrays. Makes no changes.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
trap { try { [Console]::Out.WriteLine('{"ok":false,"error":"info-failed"}') } catch { }; exit 0 }
function Clean { param($s) if ($null -eq $s) { return '' } (("" + $s) -replace '[^\x20-\x7E]', ' ').Trim() }

$o = [ordered]@{ ok = $true }

$b = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue
if ($b) {
  $o.biosVendor  = Clean $b.Manufacturer
  $o.biosVersion = Clean ($b.SMBIOSBIOSVersion)
  $o.biosSerial  = Clean $b.SerialNumber
  $rel = ''
  try { if ($b.ReleaseDate) { $rel = ([datetime]$b.ReleaseDate).ToString('yyyy-MM-dd') } } catch { }
  $o.biosDate = $rel
}

$bb = Get-CimInstance Win32_BaseBoard -ErrorAction SilentlyContinue
if ($bb) {
  $o.boardVendor  = Clean $bb.Manufacturer
  $o.boardProduct = Clean $bb.Product
  $o.boardSerial  = Clean $bb.SerialNumber
  $o.boardVersion = Clean $bb.Version
}

$cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
if ($cs) { $o.sysVendor = Clean $cs.Manufacturer; $o.sysModel = Clean $cs.Model }
$csp = Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue
if ($csp) { $o.uuid = Clean $csp.UUID }

# UEFI vs legacy
$fw = ''
try { $ci = Get-ComputerInfo -Property BiosFirmwareType -ErrorAction SilentlyContinue; if ($ci) { $fw = Clean $ci.BiosFirmwareType } } catch { }
if (-not $fw) { try { $null = Confirm-SecureBootUEFI -ErrorAction Stop; $fw = 'Uefi' } catch { } }
$o.firmwareType = $fw

# Secure Boot
$sb = 'Unknown'
try { if (Confirm-SecureBootUEFI -ErrorAction Stop) { $sb = 'On' } else { $sb = 'Off' } } catch { $sb = 'Unknown (legacy BIOS or needs admin)' }
$o.secureBoot = $sb

# TPM
try {
  $tpm = Get-CimInstance -Namespace 'root\cimv2\security\microsofttpm' -ClassName Win32_Tpm -ErrorAction SilentlyContinue
  if ($tpm) {
    $o.tpmPresent = $true
    $o.tpmVersion = Clean ($tpm.SpecVersion -split ',')[0]
    $o.tpmEnabled = [bool]$tpm.IsEnabled_InitialValue
  } else { $o.tpmPresent = $false }
} catch { $o.tpmPresent = $false }

$o | ConvertTo-Json -Depth 5 -Compress
