# TM Toolset - crash / blue-screen analysis (read-only).
# Reads the bug-check code + parameters straight from the crash-dump headers
# (C:\Windows\Minidump\*.dmp and MEMORY.DMP) and pulls the bug-check and
# unexpected-restart events from the System log. Makes no changes.

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
# Force UTF-8 stdout so no code-page byte can corrupt the JSON the app parses.
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
try { $OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
function Safe { param([scriptblock]$b) try { & $b } catch { $null } }
trap { try { [Console]::Error.WriteLine('@@FATAL@@' + $_.Exception.Message) } catch { }; exit 1 }

$out = [ordered]@{}
$out.generatedAt = (Get-Date).ToString('o')
$out.isAdmin = [bool](Safe { ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) })

# Keep only printable ASCII so raw header bytes / OS free text can never break
# the JSON we emit (ConvertTo-Json on Windows PowerShell mishandles some of them).
function Clean {
  param([string]$s, [int]$max = 600)
  if (-not $s) { return '' }
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    $c = [int][char]$ch
    if ($c -ge 32 -and $c -le 126) { [void]$sb.Append($ch) }
  }
  $r = $sb.ToString()
  if ($r.Length -gt $max) { $r = $r.Substring(0, $max) }
  return $r
}

function Read-DumpHeader {
  param([string]$Path)
  $info = [ordered]@{}
  $fs = $null
  try {
    $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $hdr = New-Object byte[] 96
    $null = $fs.Read($hdr, 0, 96)
    $sig = [System.Text.Encoding]::ASCII.GetString($hdr, 0, 8)
    $info.signature = (Clean $sig 16)
    # Only decode a bug check when this really is a kernel crash dump header.
    if ($sig.Length -ge 4 -and $sig.Substring(0, 4) -eq 'PAGE') {
      $code = [System.BitConverter]::ToUInt32($hdr, 0x38)
      $info.bugcheckCode = ('0x{0:X8}' -f $code)
      if ($sig.Length -ge 8 -and $sig.Substring(4, 4) -eq 'DU64') {
        $p1 = [System.BitConverter]::ToUInt64($hdr, 0x40)
        $p2 = [System.BitConverter]::ToUInt64($hdr, 0x48)
        $p3 = [System.BitConverter]::ToUInt64($hdr, 0x50)
        $p4 = [System.BitConverter]::ToUInt64($hdr, 0x58)
      } else {
        $p1 = [System.BitConverter]::ToUInt32($hdr, 0x3C)
        $p2 = [System.BitConverter]::ToUInt32($hdr, 0x40)
        $p3 = [System.BitConverter]::ToUInt32($hdr, 0x44)
        $p4 = [System.BitConverter]::ToUInt32($hdr, 0x48)
      }
      $info.params = @(('0x{0:X}' -f $p1), ('0x{0:X}' -f $p2), ('0x{0:X}' -f $p3), ('0x{0:X}' -f $p4))
    } else {
      $info.notKernelDump = $true
    }
  } catch {
    $info.parseError = (Clean "$($_.Exception.Message)")
  } finally {
    if ($fs) { try { $fs.Dispose() } catch { } }
  }
  return $info
}

# ---- Crash dump files ----
$dumps = New-Object System.Collections.Generic.List[object]
$files = New-Object System.Collections.Generic.List[object]
Get-ChildItem -Path "$env:SystemRoot\Minidump" -Filter *.dmp -File -ErrorAction SilentlyContinue | ForEach-Object { $files.Add($_) }
$mem = Get-Item "$env:SystemRoot\MEMORY.DMP" -ErrorAction SilentlyContinue
if ($mem) { $files.Add($mem) }
foreach ($f in $files) {
  $rec = [ordered]@{
    file   = "$($f.FullName)"
    name   = "$($f.Name)"
    sizeKB = [math]::Round($f.Length / 1KB)
    time   = $f.LastWriteTime.ToString('o')
  }
  $h = Read-DumpHeader -Path $f.FullName
  foreach ($k in $h.Keys) { $rec[$k] = $h[$k] }
  $dumps.Add($rec)
}
$out.dumps = @($dumps | Sort-Object { $_.time } -Descending)

# ---- Event-log crash history (works even when dumps are disabled) ----
$events = New-Object System.Collections.Generic.List[object]
Safe {
  Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WER-SystemErrorReporting'; Id = 1001 } -MaxEvents 30 -ErrorAction SilentlyContinue | ForEach-Object {
    $events.Add([ordered]@{
      time    = $_.TimeCreated.ToString('o')
      kind    = 'bugcheck'
      message = (Clean ((("$($_.Message)") -replace '\s+', ' ').Trim()))
    })
  }
}
Safe {
  Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Power'; Id = 41 } -MaxEvents 30 -ErrorAction SilentlyContinue | ForEach-Object {
    $events.Add([ordered]@{
      time    = $_.TimeCreated.ToString('o')
      kind    = 'power'
      message = 'The PC restarted without shutting down cleanly first - a power cut, a hard reset (held the power button), or a crash that produced no dump.'
    })
  }
}
$out.events = @($events | Sort-Object { $_.time } -Descending | Select-Object -First 50)

# ---- Dump configuration (so we can tell the tech why there may be no dumps) ----
$cc = Safe { Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CrashControl' -ErrorAction SilentlyContinue }
if ($cc) {
  $out.dumpTypeCode = [int]$cc.CrashDumpEnabled   # 0=none 1=complete 2=kernel 3=small 7=automatic
  $out.autoReboot   = [bool]$cc.AutoReboot
}

$out | ConvertTo-Json -Depth 6 -Compress
