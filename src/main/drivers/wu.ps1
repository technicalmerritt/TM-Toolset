# TM Toolset - Drivers: fetch official drivers for THIS PC from Windows Update
# via the Windows Update Agent COM API (no scraping, Microsoft-signed).
#   Mode = scan    : list driver updates that are available but not installed
#   Mode = install : download + install all available driver updates
# Streams @@STEP@@ progress; emits one JSON object. ASCII-only; plain arrays.
param([string]$Mode = 'scan')

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + (("" + $m) -replace '[^\x20-\x7E]', ' ')) } catch { } }
function Clean { param($s) if ($null -eq $s) { return '' } (("" + $s) -replace '[^\x20-\x7E]', ' ').Trim() }
trap {
  $e = [ordered]@{ ok = $false; mode = $Mode; error = (("" + $_.Exception.Message) -replace '[^\x20-\x7E]', ' ') }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

$isAdmin = [bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
$out = [ordered]@{ ok = $false; mode = $Mode; isAdmin = $isAdmin }

Step 'Connecting to Windows Update...'
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
Step 'Searching for driver updates for this PC (this can take a minute)...'
$result = $searcher.Search("IsInstalled=0 and Type='Driver'")

$found = @()
foreach ($u in $result.Updates) {
  $dt = ''
  try { $dt = ([datetime]$u.DriverVerDate).ToString('yyyy-MM-dd') } catch { }
  $found += [ordered]@{
    title   = Clean $u.Title
    driver  = Clean $u.DriverModel
    class   = Clean $u.DriverClass
    date    = $dt
    mandatory = [bool]$u.IsMandatory
  }
}
Step ("Found " + @($found).Count + " driver update(s) available.")
$out.available = @($found)

if ($Mode -eq 'scan') {
  $out.ok = $true
  Step 'Finished.'
  $out | ConvertTo-Json -Depth 5 -Compress
  return
}

# ---- install ----
if (-not $isAdmin) { $out.error = 'admin'; ($out | ConvertTo-Json -Compress); exit 0 }
if ($result.Updates.Count -eq 0) {
  $out.ok = $true; $out.installed = 0; Step 'No driver updates to install - all up to date.'
  $out | ConvertTo-Json -Depth 5 -Compress; return
}

$toDownload = New-Object -ComObject Microsoft.Update.UpdateColl
foreach ($u in $result.Updates) { if (-not $u.EulaAccepted) { try { $u.AcceptEula() } catch { } }; [void]$toDownload.Add($u) }

Step ('Downloading ' + $toDownload.Count + ' driver package(s) from Windows Update...')
$downloader = $session.CreateUpdateDownloader()
$downloader.Updates = $toDownload
$dres = $downloader.Download()

$toInstall = New-Object -ComObject Microsoft.Update.UpdateColl
foreach ($u in $result.Updates) { if ($u.IsDownloaded) { [void]$toInstall.Add($u) } }
Step ('Installing ' + $toInstall.Count + ' driver(s)...')
$installer = $session.CreateUpdateInstaller()
$installer.Updates = $toInstall
$ires = $installer.Install()

$out.ok = $true
$out.installed = $toInstall.Count
$out.rebootRequired = [bool]$ires.RebootRequired
$out.resultCode = [int]$ires.ResultCode
$rbMsg = ''
if ($ires.RebootRequired) { $rbMsg = ' A restart is required.' }
Step ('Done. ' + $toInstall.Count + ' driver(s) processed.' + $rbMsg)
$out | ConvertTo-Json -Depth 5 -Compress
