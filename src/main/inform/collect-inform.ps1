# TM Toolset - Information (Inform) inventory collector
# READ-ONLY. Emits a single JSON object describing the computer. Makes no changes.

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'

function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + $m) } catch { } }
function Safe { param([scriptblock]$b) try { & $b } catch { $null } }
trap { try { [Console]::Error.WriteLine('@@FATAL@@' + $_.Exception.Message) } catch { }; exit 1 }

$out = [ordered]@{}
$out.generatedAt = (Get-Date).ToString('o')

Step 'Operating system'
$os  = Safe { Get-CimInstance Win32_OperatingSystem }
$cs  = Safe { Get-CimInstance Win32_ComputerSystem }
$bios = Safe { Get-CimInstance Win32_BIOS }
$cpu = Safe { Get-CimInstance Win32_Processor | Select-Object -First 1 }
$board = Safe { Get-CimInstance Win32_BaseBoard }

$lic = Safe {
  Get-CimInstance SoftwareLicensingProduct -Filter "ApplicationID='55c92734-d682-4d71-983e-d6ec3f16059f' AND PartialProductKey IS NOT NULL" | Select-Object -First 1
}

$out.os = [ordered]@{
  name           = $os.Caption
  displayVersion = Safe { (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').DisplayVersion }
  version        = $os.Version
  build          = "$($os.BuildNumber)"
  arch           = $os.OSArchitecture
  installDate    = Safe { $os.InstallDate.ToString('yyyy-MM-dd') }
  lastBoot       = Safe { $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm') }
  uptimeHours    = Safe { [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1) }
  bootMode       = $cs.BootupState
  registeredUser = $os.RegisteredUser
  loggedInUser   = Safe { "$env:USERDOMAIN\$env:USERNAME" }
  activation     = Safe { if ($lic.LicenseStatus -eq 1) { 'Activated' } else { 'Not activated' } }
  productId      = $os.SerialNumber
}

Step 'Hardware'
$out.computer = [ordered]@{
  manufacturer = $cs.Manufacturer
  model        = $cs.Model
  systemType   = $cs.SystemType
  serial       = $bios.SerialNumber
  domain       = $cs.Domain
  partOfDomain = [bool]$cs.PartOfDomain
}
$out.cpu = [ordered]@{
  name       = $cpu.Name
  cores      = $cpu.NumberOfCores
  logical    = $cpu.NumberOfLogicalProcessors
  maxClockMHz = $cpu.MaxClockSpeed
  socket     = $cpu.SocketDesignation
}
$out.board = [ordered]@{
  manufacturer = $board.Manufacturer
  product      = $board.Product
  biosVendor   = $bios.Manufacturer
  biosVersion  = $bios.SMBIOSBIOSVersion
  biosDate     = Safe { $bios.ReleaseDate.ToString('yyyy-MM-dd') }
  secureBoot   = Safe { [bool](Confirm-SecureBootUEFI) }
  tpm          = Safe { [bool]((Get-Tpm).TpmPresent) }
}
$out.memory = [ordered]@{
  totalGB = Safe { [math]::Round($cs.TotalPhysicalMemory / 1GB, 1) }
  usedPct = Safe { [math]::Round((1 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize)) * 100) }
  modules = Safe {
    @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
      [ordered]@{
        slot        = $_.DeviceLocator
        capacityGB  = [math]::Round($_.Capacity / 1GB)
        speedMHz    = $_.Speed
        manufacturer = ("$($_.Manufacturer)").Trim()
        partNumber  = ("$($_.PartNumber)").Trim()
      }
    })
  }
}
$out.graphics = Safe {
  @(Get-CimInstance Win32_VideoController | ForEach-Object {
    [ordered]@{
      name          = $_.Name
      driverVersion = $_.DriverVersion
      driverDate    = Safe { $_.DriverDate.ToString('yyyy-MM-dd') }
      resolution    = if ($_.CurrentHorizontalResolution) { "$($_.CurrentHorizontalResolution) x $($_.CurrentVerticalResolution)" } else { $null }
      refreshHz     = $_.CurrentRefreshRate
    }
  })
}

Step 'Disks and volumes'
$out.disks = Safe {
  @(Get-PhysicalDisk | ForEach-Object {
    $rc = $_ | Get-StorageReliabilityCounter
    [ordered]@{
      model     = $_.FriendlyName
      media     = "$($_.MediaType)"
      bus       = "$($_.BusType)"
      sizeGB    = [math]::Round($_.Size / 1GB)
      health    = "$($_.HealthStatus)"
      wearPct   = $rc.Wear
      tempC     = $rc.Temperature
    }
  })
}
$out.volumes = Safe {
  @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    $freePct = 0; if ($_.Size) { $freePct = [math]::Round(($_.FreeSpace / $_.Size) * 100) }
    [ordered]@{
      drive   = $_.DeviceID
      label   = $_.VolumeName
      fs      = $_.FileSystem
      sizeGB  = [math]::Round($_.Size / 1GB, 1)
      freeGB  = [math]::Round($_.FreeSpace / 1GB, 1)
      freePct = $freePct
    }
  })
}

Step 'Applications'
$out.defaultBrowser = Safe {
  $progId = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice' -ErrorAction SilentlyContinue).ProgId
  switch -Wildcard ($progId) {
    'ChromeHTML*'   { 'Google Chrome'; break }
    'MSEdgeHTM*'    { 'Microsoft Edge'; break }
    'FirefoxURL*'   { 'Mozilla Firefox'; break }
    'IE.HTTP*'      { 'Internet Explorer'; break }
    'BraveHTML*'    { 'Brave'; break }
    default         { if ($progId) { $progId } else { 'Unknown' } }
  }
}
$out.programs = Safe {
  $paths = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $list = foreach ($p in $paths) {
    Get-ItemProperty $p -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName } |
      ForEach-Object {
        $d = $null
        if ($_.InstallDate -match '^\d{8}$') { $d = $_.InstallDate.Substring(0,4) + '-' + $_.InstallDate.Substring(4,2) + '-' + $_.InstallDate.Substring(6,2) }
        [ordered]@{ name = $_.DisplayName; publisher = $_.Publisher; version = $_.DisplayVersion; installed = $d }
      }
  }
  @($list | Sort-Object { $_.name } -Unique)
}

Step 'Security'
$mp = Safe { Get-MpComputerStatus }
$out.security = [ordered]@{
  uac        = Safe { [bool]((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System').EnableLUA) }
  defenderRTP = $mp.RealTimeProtectionEnabled
  defenderSigAge = $mp.AntivirusSignatureAge
  firewall   = Safe {
    @(Get-NetFirewallProfile | ForEach-Object { [ordered]@{ profile = $_.Name; enabled = [bool]$_.Enabled } })
  }
  avProducts = Safe {
    @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object {
      [ordered]@{ name = $_.displayName; active = (($_.productState -band 0x1000) -ne 0) }
    })
  }
  bitlocker  = Safe { "$((Get-BitLockerVolume -MountPoint $env:SystemDrive).ProtectionStatus)" }
}

Step 'Network'
$out.network = [ordered]@{
  status    = Safe { $cx = (Get-NetConnectionProfile | Select-Object -First 1).IPv4Connectivity; if ($cx) { "$cx" } else { 'Unknown' } }
  proxy     = Safe { (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings').ProxyServer }
  hostsCount = Safe { @(Get-Content "$env:SystemRoot\System32\drivers\etc\hosts" | Where-Object { $_ -match '^\s*[^#\s]' }).Count }
  adapters  = Safe {
    @(Get-NetAdapter | Where-Object { $_.Status -ne 'Not Present' } | ForEach-Object {
      $ip = (Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
      $dhcp = (Get-NetIPInterface -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).Dhcp
      [ordered]@{
        name   = $_.Name
        desc   = $_.InterfaceDescription
        status = "$($_.Status)"
        mac    = $_.MacAddress
        speed  = "$($_.LinkSpeed)"
        ipv4   = $ip
        dhcp   = "$dhcp"
      }
    })
  }
}

Step 'History'
$out.history = [ordered]@{
  restoreEnabled = Safe { if ((Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\SystemRestore' -Name RPSessionInterval -ErrorAction SilentlyContinue).RPSessionInterval -gt 0) { 'Enabled' } else { 'Disabled' } }
  shadowCopies  = Safe { @(Get-CimInstance Win32_ShadowCopy -OperationTimeoutSec 10).Count }
  bsodDumps     = Safe { @(Get-ChildItem "$env:SystemRoot\Minidump\*.dmp").Count }
  unexpectedShutdowns = Safe { @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41; StartTime = (Get-Date).AddDays(-30) }).Count }
  usbDevices = Safe {
    @(Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Enum\USBSTOR\*\*' -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty FriendlyName -Unique)
  }
}

Step 'Finishing up'
$out | ConvertTo-Json -Depth 6 -Compress
