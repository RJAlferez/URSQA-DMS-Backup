$ErrorActionPreference = 'Stop'
$root = 'C:\Dev\URS-DMS'

Write-Host '============================================================'
Write-Host ' URS-DMS - Deploy via Cloudflare quick tunnels'
Write-Host ' App (5173) | API (4000) | MinIO S3 (9000) | Console (9001)'
Write-Host '============================================================'

# ── Pre-flight: verify all services are healthy locally ─────────────────────
Write-Host ''
Write-Host '--- Pre-flight health checks ---'
$allHealthy = $true

try {
    $pg = Invoke-RestMethod -Uri 'http://localhost:4000/api/v1/health' -TimeoutSec 10
    $dbOk = $pg.data.services.database.status -eq 'up'
    $mioK = $pg.data.services.minio.status -eq 'up'
    Write-Host "  PostgreSQL : $(if($dbOk){'UP'}else{'DOWN'})"
    Write-Host "  MinIO      : $(if($mioK){'UP'}else{'DOWN'})"
    if (-not $dbOk) { $allHealthy = $false; Write-Warning 'PostgreSQL is not reachable — tunnel will expose broken API' }
    if (-not $mioK) { $allHealthy = $false; Write-Warning 'MinIO is not reachable — uploads/downloads will fail' }
} catch {
    Write-Warning 'API health check failed — is the server running? (run restart-server.ps1 first)'
    $allHealthy = $false
}

try {
    $redisPing = docker exec urs-redis redis-cli PING 2>$null
    Write-Host "  Redis      : $(if($redisPing -eq 'PONG'){'UP'}else{'DOWN'})"
    if ($redisPing -ne 'PONG') { $allHealthy = $false; Write-Warning 'Redis is down — background jobs will not work' }
} catch {
    Write-Host "  Redis      : NOT RUNNING"
    Write-Warning 'Redis container not found — background jobs unavailable'
}

if (-not $allHealthy) {
    Write-Host ''
    Write-Error 'Pre-flight checks FAILED. Fix the issues above before deploying.'
    exit 1
}

Write-Host 'All services healthy — starting tunnels...'
Write-Host ''

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

function Start-TunnelProcess($name, $port) {
    Start-Process -FilePath 'cloudflared' `
        -ArgumentList 'tunnel', '--url', "http://localhost:$port", '--protocol', 'http2', '--no-autoupdate' `
        -RedirectStandardOutput "$root\urs-tunnel-$name.log" `
        -RedirectStandardError "$root\urs-tunnel-$name.err.log" `
        -WindowStyle Hidden
}

Start-TunnelProcess 'app' 5173
Start-TunnelProcess 'backend' 4000
Start-TunnelProcess 'minio' 9000
Start-TunnelProcess 'console' 9001

function Get-TunnelUrl($name) {
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep 1
        $log = Get-Content "$root\urs-tunnel-$name.err.log" -Raw -ErrorAction SilentlyContinue
        if ($log -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            return $matches[0]
        }
    }
    throw "Tunnel '$name' did not become ready within 45s"
}

$appUrl = Get-TunnelUrl 'app'
Write-Host "App tunnel:     $appUrl"
$backendUrl = Get-TunnelUrl 'backend'
Write-Host "Backend tunnel: $backendUrl"
$minioUrl = Get-TunnelUrl 'minio'
Write-Host "MinIO tunnel:   $minioUrl"
$consoleUrl = Get-TunnelUrl 'console'
Write-Host "Console tunnel: $consoleUrl"

# 1. Back up the current .env before each launch (restored by tunnel-stop.ps1).
Copy-Item "$root\.env" "$root\.env.tunnel-backup" -Force

# 2. Point MinIO's public endpoint at the tunnel so presigned file URLs
#    (preview/download) work for remote visitors.
$envContent = [IO.File]::ReadAllText("$root\.env")
if ($envContent -match 'MINIO_PUBLIC_ENDPOINT=https://[a-z0-9-]+\.trycloudflare\.com') {
    $envContent = [regex]::Replace($envContent, 'MINIO_PUBLIC_ENDPOINT=https://[a-z0-9-]+\.trycloudflare\.com', "MINIO_PUBLIC_ENDPOINT=$minioUrl")
} elseif ($envContent -match 'MINIO_PUBLIC_ENDPOINT=http://localhost:9000') {
    $envContent = $envContent.Replace('MINIO_PUBLIC_ENDPOINT=http://localhost:9000', "MINIO_PUBLIC_ENDPOINT=$minioUrl")
} else {
    Write-Warning 'MINIO_PUBLIC_ENDPOINT not found in expected form; appending.'
    $envContent = "$envContent`nMINIO_PUBLIC_ENDPOINT=$minioUrl"
}
[IO.File]::WriteAllText("$root\.env", $envContent)
Write-Host 'Updated .env MINIO_PUBLIC_ENDPOINT'

# Keep browser origins and the local Pages build aligned with the fresh tunnels.
$envContent = [IO.File]::ReadAllText("$root\.env")
$envContent = [regex]::Replace($envContent, '(?m)^CLIENT_URL=.*$', "CLIENT_URL=http://localhost:5173,http://127.0.0.1:5173,https://urs-dms.online,$appUrl")
$envContent = [regex]::Replace($envContent, '(?m)^MINIO_CORS_ORIGINS=.*$', "MINIO_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://urs-dms.online,$appUrl")
if ($envContent -notmatch '(?m)^CLIENT_URL=') {
    $envContent = "$envContent`nCLIENT_URL=http://localhost:5173,http://127.0.0.1:5173,https://urs-dms.online,$appUrl"
}
if ($envContent -notmatch '(?m)^MINIO_CORS_ORIGINS=') {
    $envContent = "$envContent`nMINIO_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://urs-dms.online,$appUrl"
}
[IO.File]::WriteAllText("$root\.env", $envContent)
[IO.File]::WriteAllText("$root\client\.env", "VITE_API_BASE=$backendUrl/api/v1`n")
Write-Host 'Updated CORS origins and client VITE_API_BASE'

# 3. Recreate the Docker API server so the new MinIO endpoint is picked up.
Write-Host 'Recreating Docker API server...'
docker compose -f "$root\docker-compose.yml" up -d --force-recreate server

# 4. Restart the Vite client with a RELATIVE API base: the browser then
#    calls the app tunnel itself (/api/v1/*) and Vite proxies it to :4000 —
#    no CORS, no separate API tunnel needed.
$viteProc = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match 'vite' } |
    Select-Object -First 1
if ($viteProc) {
    Write-Host "Stopping Vite PID $($viteProc.ProcessId) ..."
    Stop-Process -Id $viteProc.ProcessId -Force
    Start-Sleep 2
}
$env:VITE_API_BASE = '/api/v1'
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k','cd /d C:\Dev\URS-DMS\client && npm run dev'
Remove-Item Env:VITE_API_BASE
Write-Host 'Vite restarted with VITE_API_BASE=/api/v1'

# 5. Health checks THROUGH the tunnels (app tunnel proxies /api to :4000).
Start-Sleep 3
$appOk = $false
$minioOk = $false
for ($i = 0; $i -lt 20; $i++) {
    if (-not $appOk) {
        try {
            $h = Invoke-RestMethod -Uri "$appUrl/api/v1/health" -TimeoutSec 15
            Write-Host "API health via app tunnel: $($h.data.status)"
            $appOk = $true
        } catch {
        }
    }
    if (-not $minioOk) {
        try {
            $r = Invoke-WebRequest -Uri "$minioUrl/minio/health/live" -UseBasicParsing -TimeoutSec 15
            Write-Host "MinIO health via tunnel: HTTP $($r.StatusCode)"
            $minioOk = $true
        } catch {
        }
    }
    if ($appOk -and $minioOk) { break }
    Start-Sleep 2
}

if (-not $appOk) { Write-Warning 'App tunnel API health check FAILED (is Vite up?)' }
if (-not $minioOk) { Write-Warning 'MinIO tunnel health check FAILED' }

Write-Host ''
Write-Host '============================================================'
Write-Host ' SHARE THESE URLS'
Write-Host "  App:     $appUrl"
Write-Host "  Backend: $backendUrl"
Write-Host "  MinIO:   $minioUrl"
Write-Host "  Console: $consoleUrl"
Write-Host '============================================================'
Write-Host 'Stop everything later with:  .\tunnel-stop.ps1'
