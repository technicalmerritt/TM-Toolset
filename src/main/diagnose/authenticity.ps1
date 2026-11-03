# TM Toolset - component authenticity check. Reports RAM and disk specs as the
# hardware declares them and flags common counterfeit/relabel tells. Read-only.
# Honest: this reads *reported* specs (WMI/SMBIOS); true SPD-level spoofing needs
# low-level reads. For storage fakery use the Drive Health capacity/speed tests.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
trap { try { [Console]::Out.WriteLine('{"ok":false,"error":"auth-failed","ram":[],"disks":[],"flags":[]}') } catch { }; exit 0 }
function Clean { param($s) if ($null -eq $s) { return '' } (("" + $s) -replace '[^\x20-\x7E]', ' ').Trim() }

$o = [ordered]@{ ok = $true; ram = @(); disks = @(); flags = @() }
$flags = @()

foreach ($m in (Get-CimInstance Win32_PhysicalMemory -ErrorAction SilentlyContinue)) {
  $cap = [int64]$m.Capacity
  $mfr = Clean $m.Manufacturer
  $slot = Clean $m.DeviceLocator
  $rated = [int]$m.Speed
  $conf = [int]$m.ConfiguredClockSpeed
  $o.ram += [ordered]@{
    slot = $slot; manufacturer = $mfr; part = Clean $m.PartNumber
    capacityGB = [math]::Round($cap / 1GB, 1); ratedMHz = $rated; configuredMHz = $conf
  }
  if (-not $mfr -or $mfr -match '^0+$' -or $mfr -match 'Unknown|Undefined|NO DIMM|0000') {
    $flags += ("RAM in " + $slot + ": no real manufacturer ID - common on fake or relabelled modules.")
  }
  if ($rated -gt 0 -and $conf -gt 0 -and $conf -lt [int]($rated * 0.7)) {
    $flags += ("RAM in " + $slot + ": running at " + $conf + " MHz vs rated " + $rated + " MHz - check XMP/EXPO, or the stick may be over-rated on its label.")
  }
}

foreach ($d in (Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue)) {
  $sizeGB = [math]::Round([double]$d.Size / 1GB, 0)
  $o.disks += [ordered]@{
    model = Clean $d.Model; sizeGB = $sizeGB; interface = Clean $d.InterfaceType
    serial = Clean $d.SerialNumber; media = Clean $d.MediaType
  }
}
if (@($o.disks).Count) { $flags += 'For storage, confirm real capacity/speed with the Drive Health capacity & speed tests - this only shows what the device reports.' }

$o.flags = @($flags)
$o | ConvertTo-Json -Depth 5 -Compress
