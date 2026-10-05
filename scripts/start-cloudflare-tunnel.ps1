param(
    [string]$Origin = "http://127.0.0.1:80"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) { $cloudflared = "C:\Program Files (x86)\cloudflared\cloudflared.exe" }
if (-not (Test-Path -LiteralPath $cloudflared)) { throw "cloudflared is not installed." }

try {
    $local = Invoke-WebRequest -Uri $Origin -UseBasicParsing -TimeoutSec 10
    if ($local.StatusCode -ne 200) { throw "Caddy origin returned HTTP $($local.StatusCode)." }
} catch {
    throw "Caddy is not reachable at $Origin. Start production first."
}

# Remove old URS quick tunnels so MinIO, its console, port 4000, and Vite are
# not exposed separately. This does not stop Docker containers or touch data.
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outLog = Join-Path $root "logs\cloudflared-caddy-$stamp.log"
$errLog = Join-Path $root "logs\cloudflared-caddy-$stamp.err.log"
Start-Process -FilePath $cloudflared `
    -ArgumentList "tunnel", "--url", $Origin, "--no-autoupdate" `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden

$publicUrl = $null
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 2
    foreach ($path in @($outLog, $errLog)) {
        if (-not (Test-Path -LiteralPath $path)) { continue }
        try {
            $fs = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
            try {
                $reader = [IO.StreamReader]::new($fs)
                try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
            } finally { $fs.Dispose() }
            if ($text -match "https://[a-z0-9-]+\.trycloudflare\.com") { $publicUrl = $matches[0]; break }
        } catch { }
    }
    if ($publicUrl) { break }
}
if (-not $publicUrl) { throw "Cloudflare Tunnel did not provide a public URL. Check $errLog" }

$health = Invoke-RestMethod -Uri "$publicUrl/api/v1/health" -TimeoutSec 20
if ($health.data.status -ne "ok") { throw "Public tunnel health is not OK." }

Write-Output "URS-DMS temporary Cloudflare tunnel is ready: $publicUrl"
Write-Output "Frontend and API: $publicUrl"
Write-Output "Health: $publicUrl/api/v1/health"
Write-Output "Stop: .\scripts\stop-cloudflare-tunnel.ps1"
