# TM Toolset - Privacy & telemetry hardening.
#   privacy.ps1 -Action scan
#   privacy.ps1 -Action apply -Ids "advertisingid,telemetry,..." [-RestorePoint]
# Scans a curated set of Windows privacy / telemetry / ad / suggestion settings
# and reports each as private or exposed; apply hardens the chosen ones. Needs
# admin for the machine-wide (HKLM / service) items. ASCII-only JSON output.

param(
  [string]$Action = 'scan',
  [string]$Ids = '',
  [switch]$RestorePoint
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
trap { try { [Console]::Out.WriteLine('{"ok":false,"error":"privacy-failed","items":[]}') } catch { }; exit 0 }
function Step($m) { [Console]::Error.WriteLine('@@STEP@@' + $m) }

# ---- registry + service helpers ----
function RegGet($path, $name) { try { return (Get-ItemProperty -LiteralPath $path -Name $name -ErrorAction Stop).$name } catch { return $null } }
function RegSet($path, $name, $type, $val) {
  try { if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null } } catch { }
  try { New-ItemProperty -LiteralPath $path -Name $name -PropertyType $type -Value $val -Force | Out-Null; return $true } catch { return $false }
}
# Real logged-in user hives (so per-user tweaks reach the customer even when the
# elevated process is a different admin account). Plus the current user.
function UserHiveRoots {
  $roots = @('HKCU:')
  foreach ($k in (Get-ChildItem 'Registry::HKEY_USERS' -ErrorAction SilentlyContinue)) {
    $sid = "$($k.PSChildName)"
    if ($sid -match '^S-1-5-21-' -and $sid -notmatch '_Classes$') { $roots += "Registry::HKEY_USERS\$sid" }
  }
  return ($roots | Select-Object -Unique)
}
function ExpandPaths($p) {
  if ("$p" -like 'HKCU:\*') {
    $sub = "$p".Substring(6)
    $out = @()
    foreach ($root in (UserHiveRoots)) { if ($root -eq 'HKCU:') { $out += "HKCU:\$sub" } else { $out += "$root\$sub" } }
    return $out
  }
  return @($p)
}

# ---- the curated tweak list ----
# Each: id,name,cat,desc,rec(recommended/pre-ticked),type('reg'|'svc'),data
function New-Tweaks {
  $t = @()
  $cdm = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\ContentDeliveryManager'
  $t += @{ id='telemetry'; name='Diagnostic data to the minimum'; cat='Telemetry & diagnostics'; rec=$true; desc='Sets Windows diagnostic data to the lowest level allowed by policy.'; type='reg'; data=@{ items=@(@{p='HKLM:\SOFTWARE\Policies\Microsoft\Windows\DataCollection'; n='AllowTelemetry'; t='DWord'; on=0}) } }
  $t += @{ id='diagtrack'; name='Disable the telemetry service (DiagTrack)'; cat='Telemetry & diagnostics'; rec=$true; desc='Stops the Connected User Experiences and Telemetry service that uploads usage data.'; type='svc'; data=@{ name='DiagTrack' } }
  $t += @{ id='dmwappush'; name='Disable WAP push message routing (dmwappushservice)'; cat='Telemetry & diagnostics'; rec=$true; desc='A telemetry-related service most home PCs do not need.'; type='svc'; data=@{ name='dmwappushservice' } }
  $t += @{ id='tailored'; name='Turn off tailored experiences with diagnostic data'; cat='Telemetry & diagnostics'; rec=$true; desc='Stops Microsoft using diagnostic data to show personalised tips and ads.'; type='reg'; data=@{ items=@(@{p='HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Privacy'; n='TailoredExperiencesWithDiagnosticDataEnabled'; t='DWord'; on=0}) } }
  $t += @{ id='werror'; name='Disable Windows Error Reporting'; cat='Telemetry & diagnostics'; rec=$true; desc='Stops crash/error reports being sent to Microsoft.'; type='reg'; data=@{ items=@(@{p='HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting'; n='Disabled'; t='DWord'; on=1}) } }
  $t += @{ id='feedback'; name='Never ask for feedback'; cat='Telemetry & diagnostics'; rec=$true; desc='Sets the Windows feedback frequency to Never.'; type='reg'; data=@{ items=@(@{p='HKCU:\SOFTWARE\Microsoft\Siuf\Rules'; n='NumberOfSIUFInPeriod'; t='DWord'; on=0}) } }

  $t += @{ id='advertisingid'; name='Turn off the advertising ID'; cat='Advertising & suggestions'; rec=$true; desc='Stops apps using an advertising ID to profile the user across apps.'; type='reg'; data=@{ items=@(@{p='HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\AdvertisingInfo'; n='Enabled'; t='DWord'; on=0}) } }
  $t += @{ id='consumerfeatures'; name='Stop auto-installed promoted apps (Candy Crush etc.)'; cat='Advertising & suggestions'; rec=$true; desc='Disables Microsoft consumer experiences, which silently install promoted apps and games.'; type='reg'; data=@{ items=@(@{p='HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent'; n='DisableWindowsConsumerFeatures'; t='DWord'; on=1}) } }
  $t += @{ id='startsuggestions'; name='Turn off Start-menu suggestions'; cat='Advertising & suggestions'; rec=$true; desc='Removes promoted/suggested apps from the Start menu.'; type='reg'; data=@{ items=@(@{p=$cdm; n='SubscribedContent-338388Enabled'; t='DWord'; on=0}, @{p=$cdm; n='SystemPaneSuggestionsEnabled'; t='DWord'; on=0}) } }
  $t += @{ id='lockscreen'; name='Turn off lock-screen tips & fun facts'; cat='Advertising & suggestions'; rec=$true; desc='Stops Windows Spotlight tips and advertising on the lock screen.'; type='reg'; data=@{ items=@(@{p=$cdm; n='RotatingLockScreenOverlayEnabled'; t='DWord'; on=0}, @{p=$cdm; n='SubscribedContent-338387Enabled'; t='DWord'; on=0}) } }
  $t += @{ id='settingssuggest'; name='Turn off suggested content in Settings'; cat='Advertising & suggestions'; rec=$true; desc='Removes the suggestion banners in the Settings app.'; type='reg'; data=@{ items=@(@{p=$cdm; n='SubscribedContent-338393Enabled'; t='DWord'; on=0}, @{p=$cdm; n='SubscribedContent-353694Enabled'; t='DWord'; on=0}, @{p=$cdm; n='SubscribedContent-353696Enabled'; t='DWord'; on=0}) } }
  $t += @{ id='tips'; name='Turn off Windows tips & suggestions'; cat='Advertising & suggestions'; rec=$true; desc='Stops the "get tips, tricks and suggestions" notifications.'; type='reg'; data=@{ items=@(@{p=$cdm; n='SubscribedContent-338389Enabled'; t='DWord'; on=0}, @{p=$cdm; n='SoftLandingEnabled'; t='DWord'; on=0}) } }
  $t += @{ id='silentapps'; name='Stop silently installing suggested apps'; cat='Advertising & suggestions'; rec=$true; desc='Prevents Windows pre-installing OEM/promoted apps for new content.'; type='reg'; data=@{ items=@(@{p=$cdm; n='SilentInstalledAppsEnabled'; t='DWord'; on=0}, @{p=$cdm; n='OemPreInstalledAppsEnabled'; t='DWord'; on=0}, @{p=$cdm; n='PreInstalledAppsEnabled'; t='DWord'; on=0}) } }
  $t += @{ id='explorerads'; name='Turn off File Explorer sync-provider ads'; cat='Advertising & suggestions'; rec=$true; desc='Removes OneDrive/Office promotional banners inside File Explorer.'; type='reg'; data=@{ items=@(@{p='HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced'; n='ShowSyncProviderNotifications'; t='DWord'; on=0}) } }

  $t += @{ id='bingsearch'; name='Turn off Bing/web results in Start search'; cat='Search & Cortana'; rec=$true; desc='Keeps the Start search box to local results only.'; type='reg'; data=@{ items=@(@{p='HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Search'; n='BingSearchEnabled'; t='DWord'; on=0}, @{p='HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search'; n='DisableWebSearch'; t='DWord'; on=1}, @{p='HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search'; n='ConnectedSearchUseWeb'; t='DWord'; on=0}) } }
  $t += @{ id='cortana'; name='Turn off Cortana'; cat='Search & Cortana'; rec=$false; desc='Disables Cortana (optional - some users rely on it).'; type='reg'; data=@{ items=@(@{p='HKLM:\SOFTWARE\Policies\Microsoft\Windows\Windows Search'; n='AllowCortana'; t='DWord'; on=0}) } }

  $t += @{ id='activityhistory'; name='Turn off activity history / Timeline'; cat='Activity & tracking'; rec=$true; desc='Stops Windows collecting and uploading your activity history.'; type='reg'; data=@{ items=@(@{p='HKLM:\SOFTWARE\Policies\Microsoft\Windows\System'; n='EnableActivityFeed'; t='DWord'; on=0}, @{p='HKLM:\SOFTWARE\Policies\Microsoft\Windows\System'; n='PublishUserActivities'; t='DWord'; on=0}, @{p='HKLM:\SOFTWARE\Policies\Microsoft\Windows\System'; n='UploadUserActivities'; t='DWord'; on=0}) } }
  $t += @{ id='apptracking'; name='Stop tracking app launches'; cat='Activity & tracking'; rec=$true; desc='Stops Windows tracking which apps you open to personalise Start and search.'; type='reg'; data=@{ items=@(@{p='HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\Advanced'; n='Start_TrackProgs'; t='DWord'; on=0}) } }
  $t += @{ id='location'; name='Turn off location tracking'; cat='Activity & tracking'; rec=$false; desc='Denies system location access (optional - disables Find My Device and weather by location).'; type='reg'; data=@{ items=@(@{p='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\location'; n='Value'; t='String'; on='Deny'}) } }

  $t += @{ id='deliveryopt'; name='Do not share Windows updates with other PCs'; cat='Network & performance'; rec=$true; desc='Turns off peer-to-peer Delivery Optimization (saves bandwidth and avoids uploading to the internet).'; type='reg'; data=@{ items=@(@{p='HKLM:\SOFTWARE\Policies\Microsoft\Windows\DeliveryOptimization'; n='DODownloadMode'; t='DWord'; on=0}) } }
  $t += @{ id='backgroundapps'; name='Turn off background apps'; cat='Network & performance'; rec=$false; desc='Stops Store apps running in the background (speed/privacy, but some apps need it for notifications).'; type='reg'; data=@{ items=@(@{p='HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications'; n='GlobalUserDisabled'; t='DWord'; on=1}) } }
  $t += @{ id='edgetelemetry'; name='Reduce Microsoft Edge telemetry'; cat='Network & performance'; rec=$true; desc='Turns off Edge usage metrics and personalisation reporting.'; type='reg'; data=@{ items=@(@{p='HKLM:\SOFTWARE\Policies\Microsoft\Edge'; n='MetricsReportingEnabled'; t='DWord'; on=0}, @{p='HKLM:\SOFTWARE\Policies\Microsoft\Edge'; n='PersonalizationReportingEnabled'; t='DWord'; on=0}) } }
  return $t
}

function TweakState($t) {
  if ($t.type -eq 'svc') {
    $s = Get-Service -Name $t.data.name -ErrorAction SilentlyContinue
    if (-not $s) { return 'na' }
    if ("$($s.StartType)" -eq 'Disabled') { return 'private' } else { return 'exposed' }
  }
  $all = $true
  foreach ($it in $t.data.items) {
    $cur = RegGet $it.p $it.n
    if ($null -eq $cur -or "$cur" -ne "$($it.on)") { $all = $false }
  }
  if ($all) { return 'private' } else { return 'exposed' }
}

function TweakApply($t) {
  if ($t.type -eq 'svc') {
    $s = Get-Service -Name $t.data.name -ErrorAction SilentlyContinue
    if (-not $s) { return $true }
    try { Stop-Service -Name $t.data.name -Force -ErrorAction SilentlyContinue } catch { }
    try { Set-Service -Name $t.data.name -StartupType Disabled -ErrorAction SilentlyContinue } catch { }
    $s2 = Get-Service -Name $t.data.name -ErrorAction SilentlyContinue
    return ($null -eq $s2 -or "$($s2.StartType)" -eq 'Disabled')
  }
  $ok = $true
  foreach ($it in $t.data.items) {
    foreach ($p in (ExpandPaths $it.p)) { if (-not (RegSet $p $it.n $it.t $it.on)) { $ok = $false } }
  }
  return $ok
}

$tweaks = New-Tweaks

if ($Action -eq 'scan') {
  Step 'Reading privacy settings'
  $out = @()
  foreach ($t in $tweaks) {
    $out += [ordered]@{ id=$t.id; name=$t.name; cat=$t.cat; desc=$t.desc; rec=[bool]$t.rec; state=(TweakState $t) }
  }
  $exposed = @($out | Where-Object { $_.state -eq 'exposed' }).Count
  [ordered]@{ ok=$true; items=@($out); exposed=$exposed } | ConvertTo-Json -Depth 6 -Compress
  exit 0
}

if ($Action -eq 'apply') {
  $want = @("$Ids".Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $restorePointMade = $false
  if ($RestorePoint) {
    Step 'Creating a System Restore point'
    try {
      # Allow a restore point even if one was made in the last 24h.
      RegSet 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore' 'SystemRestorePointCreationFrequency' 'DWord' 0 | Out-Null
      try { Enable-ComputerRestore -Drive "$env:SystemDrive\" -ErrorAction SilentlyContinue } catch { }
      Checkpoint-Computer -Description 'TM Toolset - before privacy hardening' -RestorePointType 'MODIFY_SETTINGS' -ErrorAction SilentlyContinue
      $restorePointMade = $true
    } catch { $restorePointMade = $false }
  }
  $applied = @(); $failed = @()
  foreach ($t in $tweaks) {
    if ($want -notcontains $t.id) { continue }
    Step ('Applying: ' + $t.name)
    if (TweakApply $t) { $applied += $t.id } else { $failed += $t.id }
  }
  [ordered]@{ ok=$true; applied=@($applied); failed=@($failed); restorePoint=$restorePointMade } | ConvertTo-Json -Depth 4 -Compress
  exit 0
}

'{"ok":false,"error":"unknown-action","items":[]}'
