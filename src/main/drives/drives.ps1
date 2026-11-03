# TM Toolset - per-drive health detail (read-only). Admin required for SMART.
# Reads real SMART data the same way smartctl does: a direct ATA pass-through
# (SMART_RCV_DRIVE_DATA) for SATA/HDD, and the NVMe SMART/Health log for NVMe.
# Falls back to the Windows storage reliability counters when the pass-through
# is unavailable (no admin / USB bridge / unsupported controller).

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
function Safe { param([scriptblock]$b) try { & $b } catch { $null } }
trap { try { [Console]::Error.WriteLine('@@FATAL@@' + $_.Exception.Message) } catch { }; exit 1 }

$out = [ordered]@{}
$out.generatedAt = (Get-Date).ToString('o')
$out.isAdmin = [bool](Safe { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) })

# ---- Low-level SMART pass-through (compiled once; degrade if it won't build) ----
$smartOk = $false
try {
  Add-Type -ErrorAction Stop -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class TMSmart {
  const uint GENERIC_READ = 0x80000000, GENERIC_WRITE = 0x40000000;
  const uint FILE_SHARE_READ = 1, FILE_SHARE_WRITE = 2, OPEN_EXISTING = 3;
  const uint SMART_RCV = 0x0007c088;
  const uint IOCTL_STORAGE_QUERY_PROPERTY = 0x002d1400;

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sec, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  static extern bool DeviceIoControl(IntPtr h, uint code, byte[] inBuf, uint inSize, byte[] outBuf, uint outSize, out uint ret, IntPtr ov);
  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  static extern bool CloseHandle(IntPtr h);

  static IntPtr Open(int drive) {
    return CreateFileW(@"\\.\PhysicalDrive" + drive, GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, IntPtr.Zero, OPEN_EXISTING, 0, IntPtr.Zero);
  }

  // ATA SMART READ DATA (feature 0xD0) or READ THRESHOLDS (0xD1) -> 512 bytes.
  public static byte[] Ata(int drive, byte feature) {
    IntPtr h = Open(drive);
    if (h == IntPtr.Zero || h == (IntPtr)(-1)) return null;
    try {
      byte[] inb = new byte[32];
      BitConverter.GetBytes((uint)512).CopyTo(inb, 0);
      inb[4] = feature; inb[5] = 1; inb[6] = 1; inb[7] = 0x4F; inb[8] = 0xC2; inb[9] = 0xA0; inb[10] = 0xB0;
      inb[12] = (byte)drive;
      byte[] outb = new byte[528];
      uint ret;
      bool ok = DeviceIoControl(h, SMART_RCV, inb, (uint)inb.Length, outb, (uint)outb.Length, out ret, IntPtr.Zero);
      if (!ok) return null;
      byte[] data = new byte[512];
      Array.Copy(outb, 16, data, 0, 512);
      return data;
    } catch { return null; } finally { CloseHandle(h); }
  }

  // NVMe SMART / Health Information log (page 0x02) -> 512 bytes.
  public static byte[] Nvme(int drive) {
    IntPtr h = Open(drive);
    if (h == IntPtr.Zero || h == (IntPtr)(-1)) return null;
    try {
      byte[] buf = new byte[8 + 40 + 512 + 16];
      BitConverter.GetBytes((uint)50).CopyTo(buf, 0);   // PropertyId = StorageDeviceProtocolSpecificProperty
      BitConverter.GetBytes((uint)0).CopyTo(buf, 4);    // QueryType = PropertyStandardQuery
      BitConverter.GetBytes((uint)3).CopyTo(buf, 8);    // ProtocolType = NVMe
      BitConverter.GetBytes((uint)2).CopyTo(buf, 12);   // DataType = LogPage
      BitConverter.GetBytes((uint)2).CopyTo(buf, 16);   // RequestValue = SMART/Health log (0x02)
      BitConverter.GetBytes((uint)0).CopyTo(buf, 20);   // RequestSubValue
      BitConverter.GetBytes((uint)40).CopyTo(buf, 24);  // ProtocolDataOffset
      BitConverter.GetBytes((uint)512).CopyTo(buf, 28); // ProtocolDataLength
      uint ret;
      bool ok = DeviceIoControl(h, IOCTL_STORAGE_QUERY_PROPERTY, buf, (uint)buf.Length, buf, (uint)buf.Length, out ret, IntPtr.Zero);
      if (!ok) return null;
      uint pdo = BitConverter.ToUInt32(buf, 8 + 16);    // returned ProtocolDataOffset (within specific-data)
      if (pdo < 40 || (8 + pdo + 512) > buf.Length) pdo = 40;
      byte[] data = new byte[512];
      Array.Copy(buf, 8 + (int)pdo, data, 0, 512);
      return data;
    } catch { return null; } finally { CloseHandle(h); }
  }
}
"@
  $smartOk = $true
} catch { $smartOk = $false }
$out.smartEngine = [bool]$smartOk

function Parse-AtaAttrs {
  param([byte[]]$ad, [byte[]]$td)
  $thr = @{}
  if ($td -and $td.Length -ge 362) {
    for ($i = 2; $i -lt 362; $i += 12) { $id = [int]$td[$i]; if ($id -ne 0) { $thr["$id"] = [int]$td[$i + 1] } }
  }
  $arr = @()
  if ($ad -and $ad.Length -ge 362) {
    for ($i = 2; $i -lt 362; $i += 12) {
      $id = [int]$ad[$i]
      if ($id -eq 0) { continue }
      $val = [int]$ad[$i + 3]
      $worst = [int]$ad[$i + 4]
      $raw = [int64]$ad[$i + 5] + ([int64]$ad[$i + 6] -shl 8) + ([int64]$ad[$i + 7] -shl 16) + ([int64]$ad[$i + 8] -shl 24) + ([int64]$ad[$i + 9] -shl 32) + ([int64]$ad[$i + 10] -shl 40)
      $tv = $null; if ($thr.ContainsKey("$id")) { $tv = [int]$thr["$id"] }
      $arr += [ordered]@{ id = $id; value = $val; worst = $worst; threshold = $tv; raw = $raw }
    }
  }
  return , $arr
}

function U64 { param([byte[]]$b, [int]$off) # first 8 bytes of a 16-byte NVMe LE field
  if (-not $b -or ($off + 8) -gt $b.Length) { return 0 }
  $v = [uint64]0
  for ($k = 0; $k -lt 8; $k++) { $v = $v -bor ([uint64]$b[$off + $k] -shl ($k * 8)) }
  return $v
}

function Parse-Nvme {
  param([byte[]]$d)
  if (-not $d -or $d.Length -lt 192) { return $null }
  $spare = [int]$d[3]
  $spareThr = [int]$d[4]
  $used = [int]$d[5]
  $tempK = [int]$d[1] -bor ([int]$d[2] -shl 8)
  # Sanity-check so a marshalling slip can't produce a bogus health number.
  if ($spare -lt 0 -or $spare -gt 100 -or $used -lt 0 -or $used -gt 255) { return $null }
  $o = [ordered]@{
    criticalWarning = [int]$d[0]
    percentageUsed  = $used
    availableSpare  = $spare
    spareThreshold  = $spareThr
    temperatureC    = if ($tempK -gt 0) { $tempK - 273 } else { $null }
    dataUnitsWritten = [int64](U64 $d 48)
    dataUnitsRead    = [int64](U64 $d 32)
    powerCycles      = [int64](U64 $d 112)
    powerOnHours     = [int64](U64 $d 128)
    unsafeShutdowns  = [int64](U64 $d 144)
    mediaErrors      = [int64](U64 $d 160)
  }
  return $o
}

# ---- Win32_DiskDrive by index (model/serial/firmware/interface) ----
$ddByIndex = @{}
Safe { Get-CimInstance Win32_DiskDrive | ForEach-Object { $ddByIndex["$($_.Index)"] = $_ } }

$out.drives = Safe {
  @(Get-PhysicalDisk | ForEach-Object {
    $pd = $_
    try {
      $rc = $null
      try { $rc = $pd | Get-StorageReliabilityCounter } catch { $rc = $null }
      $n = [int]$pd.DeviceId
      $dd = $ddByIndex["$n"]
      $bus = "$($pd.BusType)"

      $attrs = @()
      $nvme = $null
      $source = 'reliability-counter'
      if ($smartOk) {
        if ($bus -eq 'NVMe') {
          $nvme = Safe { Parse-Nvme ([TMSmart]::Nvme($n)) }
          if ($nvme) { $source = 'nvme-log' }
        } else {
          $ad = Safe { [TMSmart]::Ata($n, [byte]0xD0) }
          $td = Safe { [TMSmart]::Ata($n, [byte]0xD1) }
          $attrs = Parse-AtaAttrs $ad $td
          if (@($attrs).Count -gt 0) { $source = 'ata-passthrough' }
          else {
            # Some NVMe present as SCSI/RAID - try the NVMe log as a fallback.
            $nvme = Safe { Parse-Nvme ([TMSmart]::Nvme($n)) }
            if ($nvme) { $source = 'nvme-log' }
          }
        }
      }
      if (-not $smartOk -or ($source -eq 'reliability-counter')) {
        if (-not $rc) { $source = 'none' }
      }

      $vols = Safe {
        @(Get-Partition -DiskNumber $pd.DeviceId -ErrorAction SilentlyContinue | Get-Volume -ErrorAction SilentlyContinue |
          Where-Object { $_.DriveLetter } | ForEach-Object {
            [ordered]@{ drive = "$($_.DriveLetter):"; label = "$($_.FileSystemLabel)"; freeGB = [math]::Round($_.SizeRemaining / 1GB, 1); sizeGB = [math]::Round($_.Size / 1GB, 1) }
          })
      }

      $tempC = if ($nvme -and $nvme.temperatureC) { $nvme.temperatureC } elseif ($rc) { $rc.Temperature } else { $null }
      $poh   = if ($nvme -and $nvme.powerOnHours) { $nvme.powerOnHours } elseif ($rc) { $rc.PowerOnHours } else { $null }
      $cyc   = if ($nvme -and $nvme.powerCycles) { $nvme.powerCycles } elseif ($rc) { $rc.StartStopCycleCount } else { $null }
      $wear  = if ($nvme) { $nvme.percentageUsed } elseif ($rc) { $rc.Wear } else { $null }

      [ordered]@{
        number          = $n
        model           = if ($dd) { "$($dd.Model)".Trim() } else { "$($pd.FriendlyName)" }
        serial          = if ($dd) { "$($dd.SerialNumber)".Trim() } else { $null }
        firmware        = if ($dd) { "$($dd.FirmwareRevision)".Trim() } else { $null }
        interface       = if ($dd) { "$($dd.InterfaceType)" } else { $bus }
        mediaType       = "$($pd.MediaType)"
        busType         = $bus
        sizeGB          = [math]::Round($pd.Size / 1GB)
        health          = "$($pd.HealthStatus)"
        spindleSpeed    = $pd.SpindleSpeed
        temperatureC    = $tempC
        powerOnHours    = $poh
        powerCycles     = $cyc
        wearPct         = $wear
        readErrors      = if ($rc) { $rc.ReadErrorsTotal } else { $null }
        writeErrors     = if ($rc) { $rc.WriteErrorsTotal } else { $null }
        smartSource     = $source
        smartAttributes = @($attrs)
        nvme            = $nvme
        volumes         = $vols
      }
    } catch {
      [ordered]@{
        number = [int]$pd.DeviceId; model = "$($pd.FriendlyName)"; health = "$($pd.HealthStatus)"
        sizeGB = [math]::Round($pd.Size / 1GB); mediaType = "$($pd.MediaType)"; busType = "$($pd.BusType)"
        smartSource = 'error'; smartAttributes = @(); nvme = $null; volumes = @()
      }
    }
  })
}

$out | ConvertTo-Json -Depth 6 -Compress
