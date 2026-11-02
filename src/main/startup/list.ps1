# TM Toolset — enumerate ALL startup items (read-only).
# Registry Run keys, Startup folders, and logon/boot scheduled tasks, each with
# its enabled/disabled state and the identifiers needed to toggle it.

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
function Safe { param([scriptblock]$b) try { & $b } catch { $null } }
trap { try { [Console]::Error.WriteLine('@@FATAL@@' + $_.Exception.Message) } catch { }; exit 1 }

# Windows records enable/disable state (as Task Manager does) in StartupApproved.
# First byte: even (2/6) = enabled, odd (3) = disabled. No entry = enabled.
function Get-ApprovedState {
  param($approvedKey, $valueName)
  try {
    $v = (Get-ItemProperty -Path $approvedKey -Name $valueName -ErrorAction SilentlyContinue).$valueName
    if ($null -eq $v) { return $true }
    return (($v[0] -band 1) -eq 0)
  } catch { return $true }
}

$items = @()

# ---------- Registry Run keys ----------
$runKeys = @(
  @{ hive = 'HKCU'; bit = '64'; path = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run';                 approved = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run';   scope = 'User' },
  @{ hive = 'HKLM'; bit = '64'; path = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run';                 approved = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run';   scope = 'Machine' },
  @{ hive = 'HKLM'; bit = '32'; path = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run';     approved = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32'; scope = 'Machine' }
)
foreach ($rk in $runKeys) {
  $p = Get-ItemProperty -Path $rk.path -ErrorAction SilentlyContinue
  if ($p) {
    $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
      $suffix = ''
      if ($rk.bit -eq '32') { $suffix = ' (32-bit)' }
      $items += [ordered]@{
        id       = "reg|$($rk.hive)|$($rk.bit)|$($_.Name)"
        name     = "$($_.Name)"
        type     = 'Registry'
        command  = "$($_.Value)"
        location = "$($rk.hive)\...\Run$suffix"
        scope    = $rk.scope
        enabled  = (Get-ApprovedState $rk.approved "$($_.Name)")
        regHive  = $rk.hive
        regBit   = $rk.bit
        regValue = "$($_.Name)"
      }
    }
  }
}

# ---------- Startup folders ----------
$folders = @(
  @{ scope = 'User';    path = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup";     approved = 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' },
  @{ scope = 'Machine'; path = "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"; approved = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' }
)
foreach ($f in $folders) {
  Get-ChildItem -Path $f.path -File -ErrorAction SilentlyContinue | ForEach-Object {
    $items += [ordered]@{
      id          = "folder|$($f.scope)|$($_.Name)"
      name        = "$($_.Name)"
      type        = 'Startup folder'
      command     = "$($_.FullName)"
      location    = "$($f.scope) Startup folder"
      scope       = $f.scope
      enabled     = (Get-ApprovedState $f.approved "$($_.Name)")
      folderScope = $f.scope
      folderFile  = "$($_.Name)"
    }
  }
}

# ---------- Scheduled tasks with logon/boot triggers (third-party) ----------
Safe {
  Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $_.TaskPath -notlike '\Microsoft\*' -and
    (@($_.Triggers) | Where-Object { "$($_.CimClass.CimClassName)" -match 'Logon|Boot' }).Count -gt 0
  } | ForEach-Object {
    $t = $_
    $act = (@($t.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)".Trim() }) -join '  ;  ')
    $items += [ordered]@{
      id       = "task|$($t.TaskPath)$($t.TaskName)"
      name     = "$($t.TaskName)"
      type     = 'Scheduled task'
      command  = "$act"
      location = "Task Scheduler: $($t.TaskPath)"
      scope    = 'Task'
      enabled  = ($t.State -ne 'Disabled')
      taskName = "$($t.TaskName)"
      taskPath = "$($t.TaskPath)"
    }
  }
}

[ordered]@{ items = @($items) } | ConvertTo-Json -Depth 6 -Compress
