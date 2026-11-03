# TM Toolset - Debloat: uninstall one app. appx = silent (+ provisioned removal
# so it won't come back for new users). win32 = silent via msiexec where possible,
# else launches the vendor uninstaller. Streams output. ASCII-only.
param([string]$Kind = '', [string]$Key = '')

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + (("" + $m) -replace '[^\x20-\x7E]', ' ')) } catch { } }
trap {
  $e = [ordered]@{ ok = $false; error = (("" + $_.Exception.Message) -replace '[^\x20-\x7E]', ' ') }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}
$out = [ordered]@{ ok = $false; kind = $Kind }
if (-not $Key) { $out.error = 'no-key'; ($out | ConvertTo-Json -Compress); exit 0 }

if ($Kind -eq 'appx') {
  Step "Removing app package: $Key"
  Remove-AppxPackage -Package $Key -ErrorAction Stop
  try {
    $prov = Get-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue | Where-Object { $_.PackageName -eq $Key }
    if ($prov) { Step 'Removing the provisioned copy (stops it reinstalling for new users)...'; Remove-AppxProvisionedPackage -Online -PackageName $Key -ErrorAction SilentlyContinue | Out-Null }
  } catch { }
  $out.ok = $true
  Step 'Done.'
  ($out | ConvertTo-Json -Compress); exit 0
}

if ($Kind -eq 'win32') {
  $cmd = ''
  foreach ($base in @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall')) {
    $rp = Join-Path $base $Key
    if (Test-Path $rp) {
      $ip = Get-ItemProperty $rp -ErrorAction SilentlyContinue
      if ($ip.QuietUninstallString) { $cmd = "$($ip.QuietUninstallString)" }
      elseif ($ip.UninstallString) { $cmd = "$($ip.UninstallString)" }
      break
    }
  }
  if (-not $cmd) { $out.error = 'not-found'; ($out | ConvertTo-Json -Compress); exit 0 }

  $code = 0
  if ($cmd -match 'msiexec') {
    $g = [regex]::Match($cmd, '\{[0-9A-Fa-f\-]+\}').Value
    if ($g) {
      Step "msiexec /x $g /quiet /norestart"
      $p = Start-Process 'msiexec.exe' -ArgumentList "/x $g /quiet /norestart" -Wait -PassThru
      $code = $p.ExitCode
    } else {
      Step "Running: $cmd"
      $p = Start-Process 'cmd.exe' -ArgumentList "/c `"$cmd`"" -Wait -PassThru
      $code = $p.ExitCode
    }
  } else {
    Step "Launching uninstaller (may show its own window): $cmd"
    $p = Start-Process 'cmd.exe' -ArgumentList "/c `"$cmd`"" -Wait -PassThru
    $code = $p.ExitCode
  }
  if ($null -eq $code) { $code = 0 }
  $out.exitCode = $code
  $out.ok = ($code -eq 0 -or $code -eq 3010 -or $code -eq 1605)
  $out.restartRecommended = ($code -eq 3010)
  Step 'Finished.'
  ($out | ConvertTo-Json -Compress); exit 0
}

$out.error = 'unknown-kind'
($out | ConvertTo-Json -Compress)
