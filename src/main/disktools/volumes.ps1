# TM Toolset - list fixed volumes for the disk-usage drive picker (read-only).
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
trap { try { [Console]::Out.WriteLine('{"volumes":[]}') } catch { }; exit 0 }

$v = @()
foreach ($d in (Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' -ErrorAction SilentlyContinue)) {
  $v += [ordered]@{
    drive  = "$($d.DeviceID)\"
    label  = "$($d.VolumeName)"
    freeGB = [math]::Round($d.FreeSpace / 1GB, 1)
    sizeGB = [math]::Round($d.Size / 1GB, 1)
  }
}
[ordered]@{ volumes = @($v) } | ConvertTo-Json -Depth 4 -Compress
