# Why a component download fails on one network and not another.
#
# The application says only "could not connect to the server". This says which
# step failed - the name lookup, the connection, the secure handshake, or the
# transfer - and for the handshake it names who issued the certificate, which
# is how an antivirus or a router sitting in the middle gives itself away.
#
# Run it on the machine that cannot download, on that network, and send back
# everything it prints:
#
#   powershell -ExecutionPolicy Bypass -File network-check.ps1
#
# It downloads at most 64 KB and writes nothing to disk.

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

# The two ends of every component download. huggingface.co answers the request
# and then redirects to the content host, so either one can be the one refusing.
$targets = @(
    'huggingface.co',
    'us.aws.cdn.hf.co',
    'cdn-lfs.hf.co',
    'github.com',
    'objects.githubusercontent.com'
)

$vad = 'https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin'

try {
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11 -bor [Net.SecurityProtocolType]::Tls
} catch { }

function Say($text) { Write-Host $text }
function Head($text) { Write-Host ""; Write-Host "== $text" }
function Ok($text) { Write-Host "   ok    $text" }
function Bad($text) { Write-Host "   FAIL  $text" }
function Note($text) { Write-Host "         $text" }

Say "Volocal network check"
Say ("date         " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Say ("windows      " + [System.Environment]::OSVersion.Version.ToString())
Say ("powershell   " + $PSVersionTable.PSVersion.ToString())
Say ("machine      " + $env:COMPUTERNAME)

# ---------------------------------------------------------------- the network

Head "network"
try {
    Get-NetIPConfiguration -ErrorAction Stop |
        Where-Object { $_.IPv4Address -or $_.IPv6Address } |
        ForEach-Object {
            $v4 = ($_.IPv4Address.IPAddress -join ', ')
            $v6 = ($_.IPv6Address.IPAddress -join ', ')
            $dns = ($_.DNSServer.ServerAddresses -join ', ')
            Note ("{0}: v4={1} v6={2} dns={3}" -f $_.InterfaceAlias, $v4, $v6, $dns)
        }
} catch { Note "interface list unavailable: $($_.Exception.Message)" }

# ------------------------------------------------------------------ the proxy
#
# A proxy configured in Windows but not in the environment is a classic
# works-in-the-browser-fails-in-the-application difference.

Head "proxy"
$anyProxy = $false
foreach ($name in 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY') {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { Note "$name = $value"; $anyProxy = $true }
}
try {
    $settings = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings' -ErrorAction Stop
    if ($settings.ProxyEnable -eq 1) {
        Note "windows proxy = $($settings.ProxyServer)"
        $anyProxy = $true
    }
    if ($settings.AutoConfigURL) { Note "auto-config = $($settings.AutoConfigURL)"; $anyProxy = $true }
} catch { }
try {
    $system = [System.Net.WebRequest]::GetSystemWebProxy().GetProxy([Uri]'https://huggingface.co')
    if ($system.Host -ne 'huggingface.co') { Note "resolved through = $system"; $anyProxy = $true }
} catch { }
if (-not $anyProxy) { Ok "none configured" }

# ------------------------------------------------------------------ the guard
#
# TLS-inspecting antivirus replaces the certificate, and the handshake below
# will name it. Listing the products first makes that name recognisable.

Head "security products"
try {
    $found = Get-CimInstance -Namespace 'root\SecurityCenter2' -ClassName AntiVirusProduct -ErrorAction Stop
    if ($found) { $found | ForEach-Object { Note $_.displayName } } else { Note "none reported" }
} catch { Note "not readable: $($_.Exception.Message)" }

# ------------------------------------------------------------------- per host
#
# Whether this machine has a route to the IPv6 internet at all. Without one,
# the IPv6 addresses a host publishes are not a fault of that host and must not
# be printed as failures - a report where half the lines say FAIL on a healthy
# machine cannot be read. Link-local (fe80) and unique-local (fd, as Tailscale
# hands out) are not routes to the internet, so only 2000::/3 counts.

$hasIPv6 = $false
try {
    $hasIPv6 = [bool](Get-NetIPAddress -AddressFamily IPv6 -ErrorAction Stop |
        Where-Object { $_.IPAddress -match '^[23]' })
} catch { }

function Test-Tcp([string]$address, [int]$timeoutMs) {
    # Opened on the family of the address being tested. A client left to choose
    # for itself refuses an IPv6 address with a message about socket families,
    # which reads as a fault in the host rather than in the route to it.
    $parsed = [System.Net.IPAddress]::Parse($address)
    $client = New-Object System.Net.Sockets.TcpClient($parsed.AddressFamily)
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $pending = $client.BeginConnect($parsed, 443, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne($timeoutMs)) {
            return @{ ok = $false; ms = $timeoutMs; why = "no answer within $timeoutMs ms" }
        }
        $client.EndConnect($pending)
        return @{ ok = $true; ms = $watch.ElapsedMilliseconds; why = '' }
    } catch {
        return @{ ok = $false; ms = $watch.ElapsedMilliseconds; why = $_.Exception.Message }
    } finally { $client.Close() }
}

function Test-Tls([string]$name, [string]$address) {
    $parsed = [System.Net.IPAddress]::Parse($address)
    $client = New-Object System.Net.Sockets.TcpClient($parsed.AddressFamily)
    try {
        $client.Connect($parsed, 443)
        $accept = [System.Net.Security.RemoteCertificateValidationCallback] { param($a, $b, $c, $d) $true }
        $secure = New-Object System.Net.Security.SslStream($client.GetStream(), $false, $accept)
        $secure.AuthenticateAsClient($name)
        $certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($secure.RemoteCertificate)
        return @{
            ok       = $true
            issuer   = $certificate.Issuer
            subject  = $certificate.Subject
            protocol = $secure.SslProtocol.ToString()
            why      = ''
        }
    } catch {
        return @{ ok = $false; why = $_.Exception.Message }
    } finally { $client.Close() }
}

foreach ($name in $targets) {
    Head $name

    $addresses = @()
    try {
        $records = Resolve-DnsName -Name $name -ErrorAction Stop |
            Where-Object { $_.QueryType -in 'A', 'AAAA' }
        $addresses = @($records | ForEach-Object { $_.IPAddress })
    } catch {
        try { $addresses = @([System.Net.Dns]::GetHostAddresses($name) | ForEach-Object { $_.IPAddressToString }) }
        catch { }
    }

    if (-not $addresses -or $addresses.Count -eq 0) {
        Bad "name does not resolve - nothing else can be tested for this host"
        continue
    }
    Ok ("resolves to " + ($addresses -join ', '))

    # Each address separately: a host with a broken IPv6 route and a working
    # IPv4 one fails or stalls depending on which the client happens to pick.
    $reachable = $null
    foreach ($address in $addresses) {
        if ($address -match ':' -and -not $hasIPv6) {
            Note ("skipped {0}, this machine has no IPv6 route" -f $address)
            continue
        }
        $tcp = Test-Tcp $address 15000
        if ($tcp.ok) {
            Ok ("port 443 open on {0} ({1} ms)" -f $address, $tcp.ms)
            if (-not $reachable) { $reachable = $address }
        } else {
            Bad ("port 443 on {0} - {1}" -f $address, $tcp.why)
        }
    }

    # Through an address that answered, so the handshake reports on the
    # handshake rather than repeating a connection that has already failed.
    if (-not $reachable) {
        Bad "no address answered - the secure handshake cannot be tested"
        continue
    }
    $tls = Test-Tls $name $reachable
    if ($tls.ok) {
        Ok ("secure handshake, " + $tls.protocol)
        Note ("certificate issued by " + $tls.issuer)
    } else {
        Bad ("secure handshake - " + $tls.why)
    }
}

# ------------------------------------------------------- the actual component
#
# Everything above can pass and this still fail: it is the only step that goes
# through the redirect and asks for bytes.

Head "the first 64 KB of the speech-detection file"
try {
    $request = [System.Net.HttpWebRequest]::Create($vad)
    $request.UserAgent = 'Volocal'
    $request.Timeout = 15000
    $request.ReadWriteTimeout = 20000
    $request.AddRange(0, 65535)
    $response = $request.GetResponse()
    $stream = $response.GetResponseStream()
    $buffer = New-Object byte[] 65536
    $read = 0
    while ($read -lt 65536) {
        $step = $stream.Read($buffer, $read, 65536 - $read)
        if ($step -le 0) { break }
        $read += $step
    }
    $stream.Close(); $response.Close()
    Ok ("{0} bytes, status {1}" -f $read, [int]$response.StatusCode)
    Note ("served by " + $response.ResponseUri.Host)
} catch [System.Net.WebException] {
    Bad $_.Exception.Message
    if ($_.Exception.Status) { Note ("status: " + $_.Exception.Status) }
    if ($_.Exception.Response) { Note ("http: " + [int]$_.Exception.Response.StatusCode) }
    if ($_.Exception.InnerException) { Note ("cause: " + $_.Exception.InnerException.Message) }
} catch {
    Bad $_.Exception.Message
}

Write-Host ""
Say "end of check"
