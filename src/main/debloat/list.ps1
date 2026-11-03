# TM Toolset - Debloat: list installed software (registry Win32 + UWP appx) and
# flag likely bloatware/trialware. Read-only. ASCII-only; plain arrays.
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
trap { try { [Console]::Out.WriteLine('{"ok":false,"error":"list-failed","apps":[]}') } catch { }; exit 0 }
function Clean { param($s) if ($null -eq $s) { return '' } (("" + $s) -replace '[^\x20-\x7E]', ' ').Trim() }

# Patterns that mark something as likely bloat/trialware, with a reason.
$BLOAT = @(
  @{ re = 'McAfee|Norton|Avast|AVG Tech|WebAdvisor'; why = 'Pre-installed AV trial - usually unwanted' },
  @{ re = 'WildTangent|Candy Crush|King\.com|Bubble Witch|Farm Heroes|March of Empires|Hidden City|Royal Revolt|Asphalt|Disney|Dolby Access|Hidden'; why = 'Pre-installed game / promo app' },
  @{ re = 'Booking\.com|Amazon|TikTok|Instagram|Facebook|LinkedIn|Netflix|Spotify|Prime Video|ExpressVPN|Keeper|WPS Office|Wondershare|CyberLink|Power2Go'; why = 'Promotional / bundled third-party app' },
  @{ re = 'HP JumpStart|HP Support Solutions|HP Documentation|myHP|Dell Customer Connect|Dell Digital Delivery|Lenovo Now|Lenovo Welcome|Lenovo Hints|ASUS GiftBox|Acer Collection|Acer Jumpstart'; why = 'OEM bloat / promo' },
  @{ re = 'Microsoft Solitaire|Xbox|MSN Weather|MSN News|Bing News|Get Help|Microsoft Tips|Mixed Reality|Feedback Hub|3D Viewer|Paint 3D|Microsoft People|Movies . TV|Groove'; why = 'Optional Windows app most users do not need' }
)
# Never-touch (system / genuinely useful) - keep these out of the bloat flag.
$KEEP = 'Edge|Defender|Visual C\+\+|\.NET|Runtime|Redistributable|Driver|Framework|Store|Security|Update|Phone Link|Sticky Notes|Snipping|Terminal|Notepad|Calculator|Photos|Camera'

function IsBloat { param($name) $r = '' ; if ($name -match $KEEP) { return '' } ; foreach ($b in $BLOAT) { if ($name -match $b.re) { return $b.why } } ; return '' }

$apps = @()
$seen = @{}

$regPaths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
foreach ($p in $regPaths) {
  foreach ($k in (Get-ItemProperty $p -ErrorAction SilentlyContinue)) {
    $name = Clean $k.DisplayName
    if (-not $name) { continue }
    if ([int]$k.SystemComponent -eq 1) { continue }
    $uninst = ''
    if ($k.QuietUninstallString) { $uninst = "$($k.QuietUninstallString)" }
    elseif ($k.UninstallString) { $uninst = "$($k.UninstallString)" }
    if (-not $uninst) { continue }
    $key = $k.PSChildName
    if ($seen.ContainsKey($name.ToLower())) { continue }
    $seen[$name.ToLower()] = $true
    $sizeMB = 0; if ($k.EstimatedSize) { $sizeMB = [int]([double]$k.EstimatedSize / 1024) }
    $apps += [ordered]@{
      kind = 'win32'; name = $name; publisher = Clean $k.Publisher; version = Clean $k.DisplayVersion
      sizeMB = $sizeMB; key = Clean $key; bloat = (IsBloat $name)
    }
  }
}

foreach ($a in (Get-AppxPackage -ErrorAction SilentlyContinue)) {
  if ($a.IsFramework) { continue }
  if ($a.NonRemovable -eq $true) { continue }
  $name = Clean $a.Name
  if (-not $name) { continue }
  $apps += [ordered]@{
    kind = 'appx'; name = $name; publisher = Clean $a.Publisher; version = Clean ("$($a.Version)")
    sizeMB = 0; key = Clean ("$($a.PackageFullName)"); bloat = (IsBloat $name)
  }
}

$bloatCount = @($apps | Where-Object { $_.bloat }).Count
[ordered]@{ ok = $true; count = @($apps).Count; bloatCount = $bloatCount; apps = @($apps) } | ConvertTo-Json -Depth 5 -Compress
