# TM Toolset — detect THIS machine's make/model (and internal panel EDID) so the
# Parts tab can search for the screen/battery of the laptop it's running on.
# Emits a single compressed JSON object on stdout.
$ErrorActionPreference = 'SilentlyContinue'

function Dec($arr) { if (-not $arr) { return '' } ; (($arr | Where-Object { $_ -gt 0 } | ForEach-Object { [char]$_ }) -join '').Trim() }

$cs   = Get-CimInstance Win32_ComputerSystem
$csp  = Get-CimInstance Win32_ComputerSystemProduct
$enc  = Get-CimInstance Win32_SystemEnclosure
$bios = Get-CimInstance Win32_BIOS

$man   = "$($cs.Manufacturer)".Trim()
$model = "$($cs.Model)".Trim()
$ver   = "$($csp.Version)".Trim()

# Laptop / portable chassis types
$laptopTypes = @(8, 9, 10, 11, 12, 14, 30, 31, 32)
$isLaptop = $false
foreach ($ct in @($enc.ChassisTypes)) { if ($laptopTypes -contains [int]$ct) { $isLaptop = $true } }

# Normalise the manufacturer to a brand name
$brand = $man
switch -Regex ($man) {
  'dell'            { $brand = 'Dell'; break }
  'lenovo'          { $brand = 'Lenovo'; break }
  'hewlett|^hp\b|hp ' { $brand = 'HP'; break }
  'asus'            { $brand = 'Asus'; break }
  'acer'            { $brand = 'Acer'; break }
  'micro-?star|msi' { $brand = 'MSI'; break }
  'microsoft'       { $brand = 'Microsoft'; break }
  'samsung'         { $brand = 'Samsung'; break }
  'toshiba|dynabook'{ $brand = 'Toshiba'; break }
  'apple'           { $brand = 'Apple'; break }
  'huawei'          { $brand = 'Huawei'; break }
  'fujitsu'         { $brand = 'Fujitsu'; break }
  'razer'           { $brand = 'Razer'; break }
  'gigabyte'        { $brand = 'Gigabyte'; break }
  'sony'            { $brand = 'Sony'; break }
}

# Lenovo puts the marketing name in Version (Model is the machine type, e.g. 20T0)
$friendly = $model
if ($brand -eq 'Lenovo' -and $ver) { $friendly = $ver }
$friendly = ($friendly -replace '(?i)\b(inc|incorporated|co|ltd|corporation|computer|technologies|notebook pc)\b\.?', '').Trim()

# Internal panel EDID (manufacturer PNP id + product code)
$panelMaker = ''; $panelCode = ''; $panelName = ''
$mons = Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID
foreach ($m in @($mons)) {
  $mk = Dec $m.ManufacturerName
  $nm = Dec $m.UserFriendlyName
  $pc = Dec $m.ProductCodeID
  if (-not $panelMaker) { $panelMaker = $mk; $panelCode = $pc; $panelName = $nm }
  # Prefer an internal-looking panel (blank/"Color LCD" friendly name)
  if ($nm -match '(?i)^(color lcd|)$' -and $mk) { $panelMaker = $mk; $panelCode = $pc; $panelName = $nm }
}

$query = ($brand + ' ' + $friendly).Trim()

$o = [ordered]@{
  ok           = $true
  isLaptop     = $isLaptop
  manufacturer = $man
  brand        = $brand
  model        = $model
  friendly     = $friendly
  version      = $ver
  serial       = "$($bios.SerialNumber)".Trim()
  panelMaker   = $panelMaker
  panelCode    = $panelCode
  panelName    = $panelName
  query        = $query
}
$o | ConvertTo-Json -Compress
