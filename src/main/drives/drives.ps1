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

  // ---- Generic SCSI pass-through (for NVMe-over-USB bridge vendor commands) ----
  [StructLayout(LayoutKind.Sequential)]
  public struct SPTD {
    public ushort Length; public byte ScsiStatus; public byte PathId; public byte TargetId; public byte Lun;
    public byte CdbLength; public byte SenseInfoLength; public byte DataIn;
    public uint DataTransferLength; public uint TimeOutValue; public IntPtr DataBuffer; public uint SenseInfoOffset;
    [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)] public byte[] Cdb;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct SPTDWS { public SPTD s; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)] public byte[] Sense; }

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  static extern bool DeviceIoControl(IntPtr h, uint code, IntPtr inBuf, uint inSize, IntPtr outBuf, uint outSize, out uint ret, IntPtr ov);

  const uint IOCTL_SCSI_PASS_THROUGH_DIRECT = 0x4D014;

  // One SCSI pass-through. fromDevice=true reads 'data' back; otherwise sends 'data'.
  // Returns true only on a clean SCSI status (0). All failures degrade to false so
  // the caller falls back to the reliability-counter path (and the UI's honest
  // "can't read" state) rather than ever surfacing a made-up number.
  public static bool Scsi(int drive, byte[] cdb, bool fromDevice, byte[] data) {
    IntPtr h = Open(drive);
    if (h == IntPtr.Zero || h == (IntPtr)(-1)) return false;
    GCHandle pin = GCHandle.Alloc(data, GCHandleType.Pinned);
    IntPtr buf = IntPtr.Zero;
    try {
      SPTDWS w = new SPTDWS();
      w.s.Length = (ushort)Marshal.SizeOf(typeof(SPTD));
      w.s.CdbLength = (byte)cdb.Length;
      w.s.SenseInfoLength = 32;
      w.s.DataIn = (byte)(fromDevice ? 1 : 0);
      w.s.DataTransferLength = (uint)data.Length;
      w.s.TimeOutValue = 10;
      w.s.DataBuffer = pin.AddrOfPinnedObject();
      w.s.SenseInfoOffset = (uint)Marshal.OffsetOf(typeof(SPTDWS), "Sense");
      w.s.Cdb = new byte[16];
      Array.Copy(cdb, w.s.Cdb, Math.Min(cdb.Length, 16));
      w.Sense = new byte[32];
      int size = Marshal.SizeOf(typeof(SPTDWS));
      buf = Marshal.AllocHGlobal(size);
      Marshal.StructureToPtr(w, buf, false);
      uint ret;
      bool ok = DeviceIoControl(h, IOCTL_SCSI_PASS_THROUGH_DIRECT, buf, (uint)size, buf, (uint)size, out ret, IntPtr.Zero);
      if (!ok) return false;
      SPTDWS o = (SPTDWS)Marshal.PtrToStructure(buf, typeof(SPTDWS));
      return o.s.ScsiStatus == 0;
    } catch { return false; } finally {
      if (buf != IntPtr.Zero) Marshal.FreeHGlobal(buf);
      pin.Free(); CloseHandle(h);
    }
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

# ---- NVMe SMART through USB bridges (ASMedia / Realtek / JMicron) --------------
# Standard Windows NVMe queries don't tunnel through a USB enclosure, so a worn
# NVMe behind a caddy falls back to placeholder reliability counters. These
# vendor pass-throughs fetch the drive's real SMART/Health log (page 0x02) — the
# exact command sequences smartmontools uses (sntasmedia / sntrealtek /
# sntjmicron). Every call is read-only and any failure returns $null.

# A parsed NVMe log only counts if it carries genuine telemetry — an unsupported
# bridge can return all-zeros, which would otherwise look like a pristine 0%-used
# drive and re-create the very false-100% bug we're fixing.
function Is-RealNvme { param($p) return ($p -and (([int64]$p.dataUnitsWritten -gt 0) -or ([int64]$p.powerOnHours -gt 0) -or ($p.temperatureC))) }

# One NVMe admin command through a given bridge chip. Returns the raw response
# bytes ($size long) or $null. opcode/cdw10/nsid/size cover both the SMART/Health
# log (0x02, cdw10 0x007F0002, nsid broadcast, 512B) and Identify Controller
# (0x06, cdw10 0x00000001, nsid 0, 4096B). Vendor CDB layouts are exactly those
# in smartmontools (sntasmedia / sntrealtek / sntjmicron).
function Invoke-BridgeNvme { param([int]$drive, [string]$chip, [int]$opcode, [uint32]$cdw10, [uint32]$nsid, [byte[]]$buf)
  # $buf is filled in place by the pass-through (never returned through a
  # scriptblock, which would let PowerShell enumerate the byte[] and corrupt it).
  # Returns $true only on a clean read.
  $size = $buf.Length
  if ($chip -eq 'asmedia') {
    $c = New-Object byte[] 16
    $c[0] = 0xe6; $c[1] = [byte]$opcode; $c[3] = [byte]($cdw10 -band 0xff)
    $hi = ($cdw10 -shr 16) -band 0xffff
    $c[6] = [byte](($hi -shr 8) -band 0xff); $c[7] = [byte]($hi -band 0xff)
    return [bool](Safe { [TMSmart]::Scsi($drive, $c, $true, $buf) })
  }
  elseif ($chip -eq 'realtek') {
    $c = New-Object byte[] 16
    $c[0] = 0xe4; $c[1] = [byte]($size -band 0xff); $c[2] = [byte](($size -shr 8) -band 0xff)
    $c[3] = [byte]$opcode; $c[4] = [byte]($cdw10 -band 0xff)
    return [bool](Safe { [TMSmart]::Scsi($drive, $c, $true, $buf) })
  }
  elseif ($chip -eq 'jmicron') {
    $cmd = New-Object byte[] 512
    $cmd[0] = 0x4e; $cmd[1] = 0x56; $cmd[2] = 0x4d; $cmd[3] = 0x45          # dword0 'NVME' signature
    $cmd[8] = [byte]$opcode                                                # dword2 = opcode
    $cmd[12] = [byte]($nsid -band 0xff); $cmd[13] = [byte](($nsid -shr 8) -band 0xff)
    $cmd[14] = [byte](($nsid -shr 16) -band 0xff); $cmd[15] = [byte](($nsid -shr 24) -band 0xff)
    $cmd[48] = [byte]($cdw10 -band 0xff); $cmd[49] = [byte](($cdw10 -shr 8) -band 0xff)
    $cmd[50] = [byte](($cdw10 -shr 16) -band 0xff); $cmd[51] = [byte](($cdw10 -shr 24) -band 0xff)
    $c1 = New-Object byte[] 12; $c1[0] = 0xa1; $c1[1] = 0x80; $c1[4] = 0x02 # proto_nvm_cmd; cmd len 512 BE
    if (-not (Safe { [TMSmart]::Scsi($drive, $c1, $false, $cmd) })) { return $false }
    $c2 = New-Object byte[] 12; $c2[0] = 0xa1; $c2[1] = 0x82               # proto_dma_in; data len BE
    $c2[3] = [byte](($size -shr 16) -band 0xff); $c2[4] = [byte](($size -shr 8) -band 0xff); $c2[5] = [byte]($size -band 0xff)
    return [bool](Safe { [TMSmart]::Scsi($drive, $c2, $true, $buf) })
  }
  return $false
}

# NVMe Identify Controller -> real model / serial / firmware (ASCII, space-padded).
function Parse-Identify { param([byte[]]$d)
  if (-not $d -or $d.Length -lt 72) { return $null }
  $enc = [System.Text.Encoding]::ASCII
  $mn = $enc.GetString($d, 24, 40).Trim()
  if (-not $mn) { return $null }
  return [ordered]@{ serial = $enc.GetString($d, 4, 20).Trim(); model = $mn; firmware = $enc.GetString($d, 64, 8).Trim() }
}

function Try-BridgeNvme { param([int]$drive)
  if (-not $smartOk) { return $null }
  foreach ($chip in @('asmedia', 'realtek', 'jmicron')) {
    # Buffers are owned here and filled in place; nothing crosses a scriptblock.
    $sbuf = New-Object byte[] 512
    if (-not (Invoke-BridgeNvme $drive $chip 0x02 ([uint32]0x007F0002) ([uint32]0xffffffff) $sbuf)) { continue }
    $p = Parse-Nvme $sbuf
    if (-not (Is-RealNvme $p)) { continue }
    $p.bridge = $chip
    # Same chip just worked; fetch Identify Controller for the real identity.
    $ibuf = New-Object byte[] 4096
    if (Invoke-BridgeNvme $drive $chip 0x06 ([uint32]0x00000001) ([uint32]0) $ibuf) {
      $id = Parse-Identify $ibuf
      if ($id) { $p.idModel = $id.model; $p.idSerial = $id.serial; $p.idFirmware = $id.firmware }
    }
    return $p
  }
  return $null
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
      $ovModel = $null; $ovSerial = $null; $ovFirmware = $null  # real identity from a bridge, if read
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
      # USB/SCSI bridge: the standard NVMe/ATA queries can't tunnel through the
      # enclosure, so try the vendor NVMe-over-USB pass-throughs (ASMedia /
      # Realtek / JMicron) to read the drive's real SMART before falling back.
      if ($smartOk -and -not $nvme -and @($attrs).Count -eq 0 -and ($bus -eq 'USB' -or $bus -eq 'SCSI')) {
        $bn = Safe { Try-BridgeNvme $n }
        if ($bn) {
          $nvme = $bn; $source = 'nvme-usb-' + $bn.bridge
          if ($bn.idModel) { $ovModel = $bn.idModel }
          if ($bn.idSerial) { $ovSerial = $bn.idSerial }
          if ($bn.idFirmware) { $ovFirmware = $bn.idFirmware }
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
        model           = if ($ovModel) { $ovModel } elseif ($dd) { "$($dd.Model)".Trim() } else { "$($pd.FriendlyName)" }
        serial          = if ($ovSerial) { $ovSerial } elseif ($dd) { "$($dd.SerialNumber)".Trim() } else { $null }
        firmware        = if ($ovFirmware) { $ovFirmware } elseif ($dd) { "$($dd.FirmwareRevision)".Trim() } else { $null }
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
