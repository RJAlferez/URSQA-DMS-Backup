param(
    [switch]$Build,
    [switch]$ConfigureFirewall
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$caddy = Join-Path $root "tools\caddy\caddy.exe"
$caddyfile = Join-Path $root "Caddyfile"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker CLI is not available." }
if (-not (Test-Path -LiteralPath $caddy)) {
    throw "Caddy is not installed. Run .\scripts\install-caddy.ps1 first."
}
if (-not (Test-Path -LiteralPath (Join-Path $root "client\dist\index.html")) -or $Build) {
    npm --prefix (Join-Path $root "client") run build
    if (-not $?) { throw "Frontend production build failed." }
}

if ($ConfigureFirewall) { & (Join-Path $PSScriptRoot "configure-firewall.ps1") }

$port80 = Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue
if ($port80) {
    throw "TCP 80 is already in use (PID $($port80[0].OwningProcess)). Stop the owning service, then rerun this script."
}

docker compose -f (Join-Path $root "docker-compose.yml") -f (Join-Path $root "docker-compose.production.yml") up -d postgres minio redis server
if (-not $?) { throw "URS-DMS containers failed to start." }

$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
    $status = docker inspect --format '{{.State.Health.Status}}' urs-server 2>$null
    if ($status -eq "healthy") { $healthy = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $healthy) { throw "urs-server did not become healthy. Check: docker logs urs-server" }

Start-Process -FilePath $caddy -ArgumentList "run", "--config", $caddyfile -WorkingDirectory $root
Write-Output "URS-DMS production server started: http://localhost and http://192.168.8.36"
