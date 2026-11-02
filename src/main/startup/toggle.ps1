# TM Toolset — enable/disable a single startup item.
# Receives a base64-encoded JSON item (+ enable flag) and makes the change the
# same way Task Manager does (reversible). Machine-wide items need admin.

param([Parameter(Mandatory = $true)][string]$Payload)
$ErrorActionPreference = 'Stop'

function Set-Approved {
  param($approvedKey, $valueName, [bool]$enable)
  if (-not (Test-Path $approvedKey)) { New-Item -Path $approvedKey -Force | Out-Null }
  $bytes = New-Object byte[] 12
  $bytes[0] = $(if ($enable) { 2 } else { 3 })
  New-ItemProperty -Path $approvedKey -Name $valueName -Value $bytes -PropertyType Binary -Force | Out-Null
}

try {
  $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))
  $it = $json | ConvertFrom-Json
  $enable = [bool]$it.enable

  switch ($it.type) {
    'Registry' {
      $key = "$($it.regHive)|$($it.regBit)"
      $approved = switch ($key) {
        'HKCU|64' { 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' }
        'HKLM|64' { 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' }
        'HKLM|32' { 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32' }
        default   { throw 'Unknown registry location.' }
      }
      Set-Approved $approved $it.regValue $enable
    }
    'Startup folder' {
      $approved = if ($it.folderScope -eq 'User') {
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
      } else {
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
      }
      Set-Approved $approved $it.folderFile $enable
    }
    'Scheduled task' {
      if ($enable) { Enable-ScheduledTask -TaskName $it.taskName -TaskPath $it.taskPath -ErrorAction Stop | Out-Null }
      else { Disable-ScheduledTask -TaskName $it.taskName -TaskPath $it.taskPath -ErrorAction Stop | Out-Null }
    }
    default { throw "Unknown item type: $($it.type)" }
  }

  [ordered]@{ ok = $true } | ConvertTo-Json -Compress
} catch {
  [ordered]@{ ok = $false; message = "$($_.Exception.Message)" } | ConvertTo-Json -Compress
}
