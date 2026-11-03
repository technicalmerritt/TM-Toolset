# TM Toolset - BIOS/UEFI: capture a board's identity (serial / UUID / MAC / asset
# tag) so it can be restored after a board or BIOS-chip swap. Read-only.
# ASCII-only; plain arrays.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
trap { try { [Console]::Out.WriteLine('{"ok":false,"error":"capture-failed"}') } catch { }; exit 0 }
function Clean { param($s) if ($null -eq $s) { return '' } (("" + $s) -replace '[^\x20-\x7E]', ' ').Trim() }

$o = [ordered]@{ ok = $true; captured = (Get-Date).ToString('s') }

$cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
if ($cs) { $o.sysVendor = Clean $cs.Manufacturer; $o.sysModel = Clean $cs.Model }
$csp = Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue
if ($csp) { $o.uuid = Clean $csp.UUID; if (-not $o.sysModel) { $o.sysModel = Clean $csp.Name } }
$b = Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue
if ($b) { $o.systemSerial = Clean $b.SerialNumber; $o.biosVersion = Clean $b.SMBIOSBIOSVersion }
$bb = Get-CimInstance Win32_BaseBoard -ErrorAction SilentlyContinue
if ($bb) { $o.boardVendor = Clean $bb.Manufacturer; $o.boardProduct = Clean $bb.Product; $o.boardSerial = Clean $bb.SerialNumber }
$enc = Get-CimInstance Win32_SystemEnclosure -ErrorAction SilentlyContinue
if ($enc) { $o.assetTag = Clean $enc.SMBIOSAssetTag }

# Network adapter MACs (physical adapters).
$macs = @()
try {
  foreach ($a in (Get-NetAdapter -Physical -ErrorAction SilentlyContinue)) {
    if ($a.MacAddress) {
      $macs += [ordered]@{ name = Clean $a.Name; desc = Clean $a.InterfaceDescription; mac = Clean $a.MacAddress }
    }
  }
} catch {
  foreach ($a in (Get-CimInstance Win32_NetworkAdapter -Filter 'PhysicalAdapter=TRUE' -ErrorAction SilentlyContinue)) {
    if ($a.MACAddress) { $macs += [ordered]@{ name = Clean $a.NetConnectionID; desc = Clean $a.Name; mac = Clean $a.MACAddress } }
  }
}
$o.macs = @($macs)

$o | ConvertTo-Json -Depth 5 -Compress
