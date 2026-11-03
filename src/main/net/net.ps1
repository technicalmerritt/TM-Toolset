# TM Toolset - Networking: status, gotchas, ping, LAN discovery, profile fix.
#   Action = info      : adapters, IP config, connection profile, warnings (read-only)
#   Action = ping      : latency/jitter/loss to -Target
#   Action = discover  : fast async ping sweep of the active /24 subnet
#   Action = setprivate: switch Public connection profiles to Private (admin)
# Streams @@STEP@@ for discover; emits one JSON object. ASCII-only; plain arrays.
param([string]$Action = 'info', [string]$Target = '')

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch { }
function Step { param($m) try { [Console]::Error.WriteLine('@@STEP@@' + (("" + $m) -replace '[^\x20-\x7E]', ' ')) } catch { } }
function Clean { param($s) if ($null -eq $s) { return '' } (("" + $s) -replace '[^\x20-\x7E]', ' ').Trim() }
trap {
  $e = [ordered]@{ ok = $false; action = $Action; error = (("" + $_.Exception.Message) -replace '[^\x20-\x7E]', ' ') }
  try { [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress)) } catch { }
  exit 0
}

$isAdmin = [bool](([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))

function Get-Info {
  $adapters = @()
  foreach ($a in (Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' })) {
    $adapters += [ordered]@{
      name   = Clean $a.Name
      desc   = Clean $a.InterfaceDescription
      mac    = Clean $a.MacAddress
      speed  = Clean $a.LinkSpeed
      ifIndex = [int]$a.ifIndex
    }
  }

  $profiles = @()
  $warnings = @()
  foreach ($p in (Get-NetConnectionProfile -ErrorAction SilentlyContinue)) {
    $cat = Clean $p.NetworkCategory
    $profiles += [ordered]@{
      name = Clean $p.Name
      category = $cat
      ipv4 = Clean $p.IPv4Connectivity
      ipv6 = Clean $p.IPv6Connectivity
      alias = Clean $p.InterfaceAlias
      ifIndex = [int]$p.InterfaceIndex
    }
    if ($cat -eq 'Public') {
      $warnings += [ordered]@{ id = 'public'; sev = 'warn'; title = "Network '" + (Clean $p.Name) + "' is set to Public"; detail = 'On a home or office network this blocks file & printer sharing and network discovery - you often cannot see printers or other PCs. Set it to Private.'; fix = 'setprivate' }
    }
    if ((Clean $p.IPv4Connectivity) -notmatch 'Internet') {
      $warnings += [ordered]@{ id = 'noint'; sev = 'warn'; title = "No internet on '" + (Clean $p.Name) + "'"; detail = 'Windows reports this connection has no internet access (IPv4 connectivity: ' + (Clean $p.IPv4Connectivity) + ').'; fix = '' }
    }
  }

  # IP config for the primary adapter (the one with a default gateway).
  $ipv4 = ''; $gw = ''; $dns = @(); $primaryIdx = 0
  $cfg = Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1
  if (-not $cfg) { $cfg = Get-NetIPConfiguration -ErrorAction SilentlyContinue | Select-Object -First 1 }
  if ($cfg) {
    $primaryIdx = [int]$cfg.InterfaceIndex
    if ($cfg.IPv4Address) { $ipv4 = Clean ($cfg.IPv4Address.IPAddress | Select-Object -First 1) }
    if ($cfg.IPv4DefaultGateway) { $gw = Clean ($cfg.IPv4DefaultGateway.NextHop | Select-Object -First 1) }
    if ($cfg.DNSServer) { foreach ($d in $cfg.DNSServer.ServerAddresses) { if ($d -match '\.') { $dns += (Clean $d) } } }
  }

  if ($ipv4 -match '^169\.254\.') {
    $warnings += [ordered]@{ id = 'apipa'; sev = 'bad'; title = 'No DHCP address (APIPA 169.254.x.x)'; detail = 'This PC did not get an address from a router/DHCP server, so it is effectively off the network. Check the cable/Wi-Fi, the router, or set a static IP.'; fix = '' }
  }
  if (-not $gw -and $ipv4 -and $ipv4 -notmatch '^169\.254\.') {
    $warnings += [ordered]@{ id = 'nogw'; sev = 'warn'; title = 'No default gateway'; detail = 'There is an IP address but no gateway, so internet/other-subnet traffic cannot route.'; fix = '' }
  }
  if (-not $dns.Count -and $ipv4) {
    $warnings += [ordered]@{ id = 'nodns'; sev = 'warn'; title = 'No DNS server configured'; detail = 'Without DNS, names will not resolve even if the connection otherwise works.'; fix = '' }
  }

  # SMB1 (insecure) still enabled?
  try {
    $smb = Get-SmbServerConfiguration -ErrorAction SilentlyContinue
    if ($smb -and $smb.EnableSMB1Protocol) {
      $warnings += [ordered]@{ id = 'smb1'; sev = 'warn'; title = 'SMB1 is enabled (insecure)'; detail = 'The legacy SMB1 protocol is on. It is a security risk (WannaCry-era) and should be disabled unless an old NAS/printer truly needs it.'; fix = '' }
    }
  } catch { }

  [ordered]@{ ok = $true; isAdmin = $isAdmin; adapters = @($adapters); profiles = @($profiles); ipv4 = $ipv4; gateway = $gw; dns = @($dns); primaryIndex = $primaryIdx; warnings = @($warnings) }
}

function Get-Ping {
  param([string]$t)
  if (-not $t) { return [ordered]@{ ok = $false; error = 'no-target' } }
  $p = New-Object System.Net.NetworkInformation.Ping
  $times = @(); $sent = 0; $recv = 0
  for ($i = 0; $i -lt 10; $i++) {
    $sent++
    try {
      $r = $p.Send($t, 1000)
      if ($r.Status -eq 'Success') { $recv++; $times += [double]$r.RoundtripTime }
    } catch { }
    Start-Sleep -Milliseconds 120
  }
  $avg = 0; $min = 0; $max = 0; $jit = 0
  if ($times.Count) {
    $min = ($times | Measure-Object -Minimum).Minimum
    $max = ($times | Measure-Object -Maximum).Maximum
    $avg = [math]::Round(($times | Measure-Object -Average).Average, 1)
    if ($times.Count -gt 1) {
      $diffs = @(); for ($j = 1; $j -lt $times.Count; $j++) { $diffs += [math]::Abs($times[$j] - $times[$j - 1]) }
      $jit = [math]::Round(($diffs | Measure-Object -Average).Average, 1)
    }
  }
  $loss = if ($sent) { [math]::Round((($sent - $recv) / $sent) * 100) } else { 100 }
  [ordered]@{ ok = $true; target = $t; sent = $sent; received = $recv; lossPct = $loss; minMs = $min; maxMs = $max; avgMs = $avg; jitterMs = $jit }
}

function Get-Discover {
  # Ping-sweep the active /24 using async .NET pings (fast).
  $info = Get-Info
  $ip = $info.ipv4
  if (-not $ip -or $ip -match '^169\.254\.') { return [ordered]@{ ok = $false; error = 'no-subnet' } }
  $base = ($ip -replace '\.\d+$', '.')
  Step ("Scanning " + $base + "0/24 ...")
  $pings = @(); $tasks = @()
  for ($i = 1; $i -le 254; $i++) {
    $p = New-Object System.Net.NetworkInformation.Ping
    $pings += $p
    $tasks += $p.SendPingAsync(($base + $i), 700)
  }
  try { [System.Threading.Tasks.Task]::WaitAll($tasks) } catch { }
  $hosts = @()
  for ($i = 0; $i -lt $tasks.Count; $i++) {
    $res = $null
    try { $res = $tasks[$i].Result } catch { }
    if ($res -and $res.Status -eq 'Success') {
      $addr = ($base + ($i + 1))
      $name = ''
      try { $name = Clean ([System.Net.Dns]::GetHostEntry($addr).HostName) } catch { }
      $hosts += [ordered]@{ ip = $addr; name = $name; ms = [int]$res.RoundtripTime }
    }
  }
  Step ("Found " + @($hosts).Count + " device(s).")
  [ordered]@{ ok = $true; subnet = ($base + '0/24'); count = @($hosts).Count; hosts = @($hosts) }
}

function Set-Private {
  if (-not $isAdmin) { return [ordered]@{ ok = $false; error = 'admin' } }
  $changed = @()
  foreach ($p in (Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq 'Public' })) {
    try { Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Private -ErrorAction Stop; $changed += (Clean $p.Name) } catch { }
  }
  [ordered]@{ ok = $true; changed = @($changed) }
}

switch ($Action) {
  'info'       { (Get-Info) | ConvertTo-Json -Depth 7 -Compress }
  'ping'       { (Get-Ping $Target) | ConvertTo-Json -Depth 5 -Compress }
  'discover'   { (Get-Discover) | ConvertTo-Json -Depth 6 -Compress }
  'setprivate' { (Set-Private) | ConvertTo-Json -Depth 5 -Compress }
  default      { [ordered]@{ ok = $false; error = 'unknown-action' } | ConvertTo-Json -Compress }
}
