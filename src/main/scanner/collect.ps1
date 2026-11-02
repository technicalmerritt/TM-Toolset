# TM Toolset — Issue Scanner data collector
# READ-ONLY. Gathers system diagnostics and emits a single JSON object on stdout.
# Makes no changes to the system. Every section is wrapped so one failure can't
# abort the whole scan; checks that need elevation simply return null when denied.

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'

# Progress markers go to stderr (never stdout) so they can't corrupt the JSON.
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + $m) } catch { } }
function Safe { param([scriptblock]$b) try { & $b } catch { $null } }

# Any terminating error is reported to stderr with a FATAL marker; nothing goes to stdout.
trap { try { [Console]::Error.WriteLine('@@FATAL@@' + $_.Exception.Message) } catch { }; exit 1 }

Step 'Reading system information'

$out = [ordered]@{}
$out.generatedAt      = (Get-Date).ToString('o')
$out.collectorVersion = '1.0.0'

# ---------- System / OS ----------
$os   = Safe { Get-CimInstance Win32_OperatingSystem }
$cs   = Safe { Get-CimInstance Win32_ComputerSystem }
$bios = Safe { Get-CimInstance Win32_BIOS }
$cpu  = Safe { Get-CimInstance Win32_Processor | Select-Object -First 1 }

$isAdmin = Safe {
  ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

$sys = [ordered]@{}
$sys.caption        = $os.Caption
$sys.version        = $os.Version
$sys.buildNumber    = [int]($os.BuildNumber)
$sys.displayVersion = Safe { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').DisplayVersion }
$sys.osArch         = $os.OSArchitecture
$sys.installDate    = Safe { $os.InstallDate.ToString('o') }
$sys.lastBoot       = Safe { $os.LastBootUpTime.ToString('o') }
$sys.uptimeHours    = Safe { [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1) }
$sys.manufacturer   = $cs.Manufacturer
$sys.model          = $cs.Model
$sys.systemType     = $cs.SystemType
$sys.cpu            = $cpu.Name
$sys.cpuCores       = $cpu.NumberOfCores
$sys.cpuLogical     = $cpu.NumberOfLogicalProcessors
$sys.ramGB          = Safe { [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) }
$sys.biosVersion    = $bios.SMBIOSBIOSVersion
$sys.serial         = $bios.SerialNumber
$sys.isAdmin        = [bool]$isAdmin
$sys.secureBoot     = Safe { [bool](Confirm-SecureBootUEFI) }
$sys.tpmPresent     = Safe { [bool]((Get-Tpm).TpmPresent) }
$sys.tpmVersion     = Safe { (Get-CimInstance -Namespace 'root\cimv2\security\microsofttpm' -ClassName Win32_Tpm).SpecVersion }
$out.system = $sys

# ---------- Memory ----------
$mem = [ordered]@{}
if ($os) {
  $mem.totalMB = [math]::Round($os.TotalVisibleMemorySize / 1024)
  $mem.freeMB  = [math]::Round($os.FreePhysicalMemory / 1024)
  if ($os.TotalVisibleMemorySize) {
    $mem.usedPct = [math]::Round((1 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize)) * 100)
  }
}
$out.memory = $mem

# ---------- Volumes (fixed disks) ----------
$out.volumes = Safe {
  Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    $freePct = 0
    if ($_.Size) { $freePct = [math]::Round(($_.FreeSpace / $_.Size) * 100) }
    [ordered]@{
      drive   = $_.DeviceID
      label   = $_.VolumeName
      sizeGB  = [math]::Round($_.Size / 1GB, 1)
      freeGB  = [math]::Round($_.FreeSpace / 1GB, 1)
      freePct = $freePct
    }
  }
}

Step 'Checking storage and drive health'
# ---------- Physical disks + SMART / reliability ----------
$out.physicalDisks = Safe {
  Get-PhysicalDisk | ForEach-Object {
    $rc = $_ | Get-StorageReliabilityCounter
    [ordered]@{
      friendlyName = $_.FriendlyName
      mediaType    = "$($_.MediaType)"
      busType      = "$($_.BusType)"
      sizeGB       = [math]::Round($_.Size / 1GB)
      healthStatus = "$($_.HealthStatus)"
      operational  = "$($_.OperationalStatus)"
      wearPct      = $rc.Wear
      temperatureC = $rc.Temperature
      powerOnHours = $rc.PowerOnHours
    }
  }
}

# ---------- SMART failure attributes (needs admin; root\wmi) ----------
# Parses MSStorageDriver_FailurePredictData raw bytes for the attributes that
# actually predict drive failure (5/187/196/197/198 + power-on hours/temp).
$out.smart = Safe {
  @(Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictData | ForEach-Object {
    $vs = $_.VendorSpecific
    $attrs = @{}
    if ($vs -and $vs.Count -ge 362) {
      for ($i = 2; $i -lt 362; $i += 12) {
        $id = [int]$vs[$i]
        if ($id -eq 0) { continue }
        $raw = [int64]$vs[$i + 5] + ([int64]$vs[$i + 6] -shl 8) + ([int64]$vs[$i + 7] -shl 16) + ([int64]$vs[$i + 8] -shl 24)
        $attrs["$id"] = $raw
      }
    }
    [ordered]@{
      instance              = "$($_.InstanceName)"
      reallocatedSectors    = $attrs['5']
      reportedUncorrectable = $attrs['187']
      reallocationEvents    = $attrs['196']
      pendingSectors        = $attrs['197']
      offlineUncorrectable  = $attrs['198']
      powerOnHours          = $attrs['9']
      temperatureC          = $attrs['194']
    }
  })
}

# ---------- Pending reboot ----------
$out.pendingReboot = Safe {
  $pend = $false
  $keys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
  )
  foreach ($k in $keys) { if (Test-Path $k) { $pend = $true } }
  $pfro = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager').PendingFileRenameOperations
  if ($pfro) { $pend = $true }
  [bool]$pend
}

Step 'Checking security and antivirus'
# ---------- Security ----------
$mp = Safe { Get-MpComputerStatus }
$sec = [ordered]@{}
$sec.defenderRTP        = $mp.RealTimeProtectionEnabled
$sec.defenderAV         = $mp.AntivirusEnabled
$sec.defenderSigAgeDays = $mp.AntivirusSignatureAge
$sec.firewallDisabled   = Safe { @(Get-NetFirewallProfile | Where-Object { -not $_.Enabled } | Select-Object -ExpandProperty Name) }
$sec.avProducts         = Safe { Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { [ordered]@{ name = $_.displayName; state = $_.productState } } }
$sec.uac                = Safe { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System').EnableLUA }
$sec.activation         = Safe {
  (Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f' AND PartialProductKey IS NOT NULL" |
    Select-Object -First 1).LicenseStatus
}
$out.security = $sec

# ---------- BitLocker (system drive) ----------
$out.bitlocker = Safe {
  $v = Get-BitLockerVolume -MountPoint $env:SystemDrive
  [ordered]@{ protection = "$($v.ProtectionStatus)"; status = "$($v.VolumeStatus)"; pct = $v.EncryptionPercentage }
}

Step 'Checking devices and drivers'
# ---------- Problem devices ----------
$out.problemDevices = Safe {
  Get-CimInstance Win32_PnPEntity |
    Where-Object { $_.ConfigManagerErrorCode -ne $null -and $_.ConfigManagerErrorCode -ne 0 } |
    ForEach-Object { [ordered]@{ name = $_.Name; errorCode = [int]$_.ConfigManagerErrorCode; class = $_.PNPClass } }
}

# ---------- Startup items ----------
$out.startup = Safe {
  $items = @()
  $runKeys = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run'
  )
  foreach ($k in $runKeys) {
    $p = Get-ItemProperty $k
    if ($p) {
      $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
        $items += [ordered]@{ name = $_.Name; command = "$($_.Value)"; source = 'Registry' }
      }
    }
  }
  $folders = @(
    "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup",
    "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup"
  )
  foreach ($f in $folders) {
    Get-ChildItem $f -File | ForEach-Object { $items += [ordered]@{ name = $_.Name; command = $_.FullName; source = 'StartupFolder' } }
  }
  $items
}

# ---------- Services: automatic but not running ----------
$out.stoppedAutoServices = Safe {
  Get-CimInstance Win32_Service |
    Where-Object { $_.StartMode -eq 'Auto' -and $_.State -ne 'Running' } |
    ForEach-Object { [ordered]@{ name = $_.Name; display = $_.DisplayName; state = $_.State } }
}

Step 'Reading event logs and crash history'
# ---------- Event log signals (last 14 days) ----------
$since = (Get-Date).AddDays(-14)
$ev = [ordered]@{}
$ev.kernelPower41 = Safe { @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41; StartTime = $since }).Count }
# Disk controller errors, grouped by which physical disk, with model/serial.
$ev.diskErrors = Safe {
  $evs = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'disk'; StartTime = $since } -ErrorAction SilentlyContinue)
  $groups = @{}
  foreach ($e in $evs) {
    $hd = $null
    if ("$($e.Message)" -match 'Harddisk(\d+)') { $hd = $Matches[1] }
    else { foreach ($pp in @($e.Properties)) { if ("$($pp.Value)" -match 'Harddisk(\d+)') { $hd = $Matches[1]; break } } }
    $key = if ($hd) { $hd } else { 'unknown' }
    if (-not $groups.ContainsKey($key)) { $groups[$key] = 0 }
    $groups[$key] = $groups[$key] + 1
  }
  $dd = @{}
  Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | ForEach-Object { $dd["$($_.Index)"] = $_ }
  $byDisk = @()
  foreach ($k in $groups.Keys) {
    $drv = $dd[$k]
    $byDisk += [ordered]@{
      harddisk = $k
      model    = if ($drv) { "$($drv.Model)".Trim() } else { 'Unidentified disk' }
      serial   = if ($drv) { "$($drv.SerialNumber)".Trim() } else { $null }
      count    = $groups[$k]
    }
  }
  [ordered]@{ total = $evs.Count; byDisk = $byDisk }
}
$ev.bugchecks     = Safe {
  @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 1001; ProviderName = 'Microsoft-Windows-WER-SystemErrorReporting'; StartTime = $since } |
    Select-Object -First 10 | ForEach-Object { [ordered]@{ time = $_.TimeCreated.ToString('o'); msg = (($_.Message -split "`n")[0]).Trim() } })
}
$ev.appErrors = Safe {
  @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Id = 1000; StartTime = $since } |
    Group-Object { "$($_.Properties[0].Value)" } | Sort-Object Count -Descending | Select-Object -First 8 |
    ForEach-Object { [ordered]@{ app = "$($_.Name)"; count = $_.Count } })
}
$out.events    = $ev
$out.minidumps = Safe { @(Get-ChildItem "$env:SystemRoot\Minidump\*.dmp").Count }

# ---------- Windows Update recency ----------
$out.lastHotfix = Safe { (Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1).InstalledOn.ToString('o') }

# ---------- Reclaimable junk ----------
function DirSizeMB { param($p)
  Safe {
    if (Test-Path $p) {
      $sum = (Get-ChildItem $p -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
      [math]::Round($sum / 1MB)
    } else { 0 }
  }
}
$out.junk = [ordered]@{
  userTempMB = DirSizeMB $env:TEMP
  winTempMB  = DirSizeMB "$env:SystemRoot\Temp"
  wuCacheMB  = DirSizeMB "$env:SystemRoot\SoftwareDistribution\Download"
  prefetchMB = DirSizeMB "$env:SystemRoot\Prefetch"
  minidumpMB = DirSizeMB "$env:SystemRoot\Minidump"
}

# ---------- Battery health (laptops) ----------
$out.battery = Safe {
  $stat = Get-CimInstance -Namespace root\WMI -ClassName BatteryStaticData
  $full = Get-CimInstance -Namespace root\WMI -ClassName BatteryFullChargedCapacity
  if ($stat -and $full -and $stat.DesignedCapacity) {
    $wear = [math]::Round((1 - ($full.FullChargedCapacity / $stat.DesignedCapacity)) * 100)
    [ordered]@{ designedCapacity = $stat.DesignedCapacity; fullChargedCapacity = $full.FullChargedCapacity; wearPct = $wear }
  } else { $null }
}

# ---------- Network tamper indicators ----------
$out.network = [ordered]@{
  hostsEntries = Safe { @(Get-Content "$env:SystemRoot\System32\drivers\etc\hosts" | Where-Object { $_ -match '^\s*[^#\s]' }) }
  proxyServer  = Safe { (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings').ProxyServer }
  autoConfig   = Safe { (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings').AutoConfigURL }
}

# ---------- System protection (fast registry check; VSS enumeration can hang) ----------
$out.restoreEnabled = Safe { if ((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore' -Name RPSessionInterval -ErrorAction SilentlyContinue).RPSessionInterval -gt 0) { $true } else { $false } }

Step 'Checking for malware indicators'
$since60 = (Get-Date).AddDays(-60)

# ---------- Drive failure prediction (SMART predict) + dirty bit ----------
$out.failurePredict = Safe {
  @(Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus |
    Where-Object { $_.PredictFailure } |
    ForEach-Object { [ordered]@{ instance = "$($_.InstanceName)"; reason = $_.Reason } })
}
$out.dirtyVolumes = Safe {
  $dirty = @()
  Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object {
    $q = cmd /c "fsutil dirty query $($_.DriveLetter):" 2>$null
    if ("$q" -match 'is\s+Dirty') { $dirty += "$($_.DriveLetter):" }
  }
  $dirty
}

# ---------- WHEA hardware errors (60 days) ----------
$out.wheaErrors = Safe { @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WHEA-Logger'; StartTime = $since60 }).Count }

# ---------- Windows Update failures (60 days) ----------
$out.wuErrors = Safe { @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WindowsUpdateClient'; Level = 2; StartTime = $since60 }).Count }

# ---------- Group Policy hijack keys (malware restriction tricks) ----------
$out.policyHijacks = Safe {
  $checks = @(
    @{ name = 'Registry editor disabled';  path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\System';   val = 'DisableRegistryTools' },
    @{ name = 'Task Manager disabled';      path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\System';   val = 'DisableTaskMgr' },
    @{ name = 'Command Prompt disabled';    path = 'HKCU:\Software\Policies\Microsoft\Windows\System';                  val = 'DisableCMD' },
    @{ name = 'Desktop hidden';             path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer'; val = 'NoDesktop' },
    @{ name = 'Run menu removed';           path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer'; val = 'NoRun' },
    @{ name = 'Control Panel blocked';      path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer'; val = 'NoControlPanel' },
    @{ name = 'Folder Options removed';     path = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer'; val = 'NoFolderOptions' }
  )
  $hits = @()
  foreach ($c in $checks) {
    $v = (Get-ItemProperty $c.path -Name $c.val -ErrorAction SilentlyContinue).($c.val)
    if ($v -eq 1) { $hits += $c.name }
  }
  $hits
}

# ---------- Default registry value tamper (classic malware persistence) ----------
$out.defaults = Safe {
  $issues = @()
  $winlogon = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
  $userinit = (Get-ItemProperty $winlogon -Name Userinit -ErrorAction SilentlyContinue).Userinit
  if ($userinit -and ($userinit -notmatch 'userinit\.exe')) { $issues += "Userinit = $userinit" }
  $shell = (Get-ItemProperty $winlogon -Name Shell -ErrorAction SilentlyContinue).Shell
  if ($shell -and ($shell -ne 'explorer.exe')) { $issues += "Shell = $shell" }
  $sm = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager'
  $boot = (Get-ItemProperty $sm -Name BootExecute -ErrorAction SilentlyContinue).BootExecute
  if ($boot -and (("$boot") -notmatch 'autocheck')) { $issues += "BootExecute = $boot" }
  $issues
}

# ---------- File association hijack (.exe) ----------
$out.assocHijack = Safe {
  $issues = @()
  $uc = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.exe\UserChoice' -ErrorAction SilentlyContinue).ProgId
  if ($uc -and ($uc -ne 'exefile')) { $issues += ".exe UserChoice = $uc" }
  $cmd = (Get-ItemProperty 'Registry::HKEY_CLASSES_ROOT\exefile\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
  if ($cmd -and ($cmd -notmatch '"%1"')) { $issues += "exefile open command = $cmd" }
  $issues
}

# ---------- Stuck print jobs (Win32_PrintJob is non-blocking, unlike Get-PrintJob) ----------
$out.printJobs = Safe {
  $jobs = @(Get-CimInstance Win32_PrintJob -OperationTimeoutSec 10)
  $stuck = @($jobs | Where-Object { "$($_.Status) $($_.JobStatus)" -match 'Error|Blocked|Offline|Paused|PaperOut' })
  @($stuck | Group-Object { ($_.Name -split ',')[0] } | ForEach-Object { [ordered]@{ printer = $_.Name; stuck = $_.Count; total = $_.Count } })
}

Step 'Checking network health'
# ---------- Network diagnostics ----------
$cfg = Safe { Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1 }
$net = [ordered]@{}
$net.ipv4        = Safe { $cfg.IPv4Address.IPAddress }
$net.gateway     = Safe { $cfg.IPv4DefaultGateway.NextHop }
$net.dns         = Safe { @($cfg.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | Select-Object -ExpandProperty ServerAddresses) }
$net.apipa       = Safe { @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '169.254.*' } | Select-Object -ExpandProperty IPAddress) }
$net.internet    = Safe { "$((Get-NetConnectionProfile | Select-Object -First 1).IPv4Connectivity)" }
$net.dnsResolves = Safe { [bool](Resolve-DnsName -Name 'www.microsoft.com' -Type A -QuickTimeout -ErrorAction SilentlyContinue) }
$net.smb1        = Safe { [bool]((Get-SmbServerConfiguration).EnableSMB1Protocol) }
$net.gatewayPing = Safe {
  $gw = $cfg.IPv4DefaultGateway.NextHop
  if ($gw) {
    $p = @(Test-Connection -ComputerName $gw -Count 2 -ErrorAction SilentlyContinue)
    if ($p.Count -gt 0) { [ordered]@{ ok = $true; avgMs = [math]::Round(($p | Measure-Object -Property ResponseTime -Average).Average) } }
    else { [ordered]@{ ok = $false } }
  }
}
$out.net = $net

Step 'Checking antivirus exclusions and persistence'
# ---------- Defender exclusions + tamper protection ----------
$out.defenderExclusions = Safe {
  $mp = Get-MpPreference
  [ordered]@{
    paths      = @($mp.ExclusionPath)
    processes  = @($mp.ExclusionProcess)
    extensions = @($mp.ExclusionExtension)
    tamperOff  = ((Get-MpComputerStatus).IsTamperProtected -eq $false)
  }
}

# ---------- Suspicious scheduled tasks (Temp/AppData persistence) ----------
$out.suspiciousTasks = Safe {
  @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.State -ne 'Disabled' } | ForEach-Object {
    $t = $_
    foreach ($a in @($t.Actions)) {
      $exec = "$($a.Execute) $($a.Arguments)"
      if ($exec -match '(?i)\\Temp\\|\\AppData\\|\\ProgramData\\|\\Users\\Public|%TEMP%|%APPDATA%') {
        [ordered]@{ name = "$($t.TaskName)"; path = "$($t.TaskPath)"; run = $exec.Trim() }
      }
    }
  } | Where-Object { $_ })
}

Step 'Checking browsers'
# ---------- Browser extension counts ----------
$out.browserExt = Safe {
  [ordered]@{
    chrome  = @(Get-ChildItem "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Extensions" -Directory -ErrorAction SilentlyContinue).Count
    edge    = @(Get-ChildItem "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Extensions" -Directory -ErrorAction SilentlyContinue).Count
    firefox = @(Get-ChildItem "$env:APPDATA\Mozilla\Firefox\Profiles\*\extensions\*" -ErrorAction SilentlyContinue).Count
  }
}

Step 'Checking system integrity and clock'
# ---------- Windows image health (DISM CheckHealth, fast) ----------
$out.imageHealth = Safe {
  $o = "$(& dism.exe /Online /Cleanup-Image /CheckHealth 2>$null)"
  if ($o -match 'No component store corruption') { 'Healthy' }
  elseif ($o -match 'is repairable') { 'Repairable' }
  elseif ($o -match 'not repairable') { 'NotRepairable' }
  else { 'Unknown' }
}

# ---------- Time sync ----------
$out.timeSync = Safe {
  $svc = (Get-Service w32time -ErrorAction SilentlyContinue).Status
  $src = "$(& w32tm /query /source 2>$null)".Trim()
  [ordered]@{ service = "$svc"; source = $src }
}

Step 'Finishing up'
$out | ConvertTo-Json -Depth 6 -Compress
