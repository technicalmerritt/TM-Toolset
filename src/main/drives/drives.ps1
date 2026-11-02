# TM Toolset — per-drive health detail (read-only). Admin recommended for SMART.

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
function Safe { param([scriptblock]$b) try { & $b } catch { $null } }
trap { try { [Console]::Error.WriteLine('@@FATAL@@' + $_.Exception.Message) } catch { }; exit 1 }

$out = [ordered]@{}
$out.generatedAt = (Get-Date).ToString('o')

# SMART raw attributes keyed by instance name
$smartByInst = @{}
Safe {
  Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictData | ForEach-Object {
    $vs = $_.VendorSpecific
    $a = @{}
    if ($vs -and $vs.Count -ge 362) {
      for ($i = 2; $i -lt 362; $i += 12) {
        $id = [int]$vs[$i]
        if ($id -eq 0) { continue }
        $raw = [int64]$vs[$i + 5] + ([int64]$vs[$i + 6] -shl 8) + ([int64]$vs[$i + 7] -shl 16) + ([int64]$vs[$i + 8] -shl 24)
        $a["$id"] = $raw
      }
    }
    $smartByInst["$($_.InstanceName)"] = $a
  }
}

# Win32_DiskDrive by index (model/serial/firmware/interface)
$ddByIndex = @{}
Safe { Get-CimInstance Win32_DiskDrive | ForEach-Object { $ddByIndex["$($_.Index)"] = $_ } }

# Emit one object per disk from the pipeline (so the collection returns out of
# the Safe scope), and wrap each disk so one failure can't drop the whole list.
$out.drives = Safe {
  @(Get-PhysicalDisk | ForEach-Object {
    $pd = $_
    try {
      $rc = $null
      try { $rc = $pd | Get-StorageReliabilityCounter } catch { $rc = $null }
      $n = "$($pd.DeviceId)"
      $dd = $ddByIndex[$n]

      $sm = $null
      foreach ($k in $smartByInst.Keys) {
        if ($k -match "PHYSICALDRIVE$n`$" -or $k -match "_$n`$") { $sm = $smartByInst[$k]; break }
      }
      if (-not $sm -and $smartByInst.Count -eq 1) { $sm = @($smartByInst.Values)[0] }
      if (-not $sm) { $sm = @{} }

      $vols = Safe {
        @(Get-Partition -DiskNumber $pd.DeviceId -ErrorAction SilentlyContinue | Get-Volume -ErrorAction SilentlyContinue |
          Where-Object { $_.DriveLetter } | ForEach-Object {
            [ordered]@{ drive = "$($_.DriveLetter):"; label = "$($_.FileSystemLabel)"; freeGB = [math]::Round($_.SizeRemaining / 1GB, 1); sizeGB = [math]::Round($_.Size / 1GB, 1) }
          })
      }

      [ordered]@{
        number       = $n
        model        = if ($dd) { "$($dd.Model)".Trim() } else { "$($pd.FriendlyName)" }
        serial       = if ($dd) { "$($dd.SerialNumber)".Trim() } else { $null }
        firmware     = if ($dd) { "$($dd.FirmwareRevision)".Trim() } else { $null }
        interface    = if ($dd) { "$($dd.InterfaceType)" } else { "$($pd.BusType)" }
        mediaType    = "$($pd.MediaType)"
        busType      = "$($pd.BusType)"
        sizeGB       = [math]::Round($pd.Size / 1GB)
        health       = "$($pd.HealthStatus)"
        spindleSpeed = $pd.SpindleSpeed
        temperatureC = if ($rc) { $rc.Temperature } else { $null }
        powerOnHours = if ($rc) { $rc.PowerOnHours } else { $null }
        powerCycles  = if ($rc) { $rc.StartStopCycleCount } else { $null }
        wearPct      = if ($rc) { $rc.Wear } else { $null }
        readErrors   = if ($rc) { $rc.ReadErrorsTotal } else { $null }
        smart        = [ordered]@{
          reallocated           = $sm['5']
          reportedUncorrectable = $sm['187']
          reallocationEvents    = $sm['196']
          pending               = $sm['197']
          offlineUncorrectable  = $sm['198']
          powerOnHoursSmart     = $sm['9']
          temperatureSmart      = $sm['194']
        }
        volumes      = $vols
      }
    } catch {
      [ordered]@{
        number = "$($pd.DeviceId)"; model = "$($pd.FriendlyName)"; health = "$($pd.HealthStatus)"
        sizeGB = [math]::Round($pd.Size / 1GB); mediaType = "$($pd.MediaType)"; busType = "$($pd.BusType)"
        smart = [ordered]@{}; volumes = @()
      }
    }
  })
}

$out | ConvertTo-Json -Depth 6 -Compress
