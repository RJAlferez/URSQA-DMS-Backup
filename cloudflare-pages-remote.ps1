$ErrorActionPreference = 'Stop'

$root = 'C:\Dev\URS-DMS'
$healthLocal = 'http://127.0.0.1:4000/api/v1/health'
$pagesUrl = 'https://urs-dms.online'
$envRemote = "$root\.env.remote"

Write-Host '============================================================'
Write-Host ' URS-DMS Cloudflare Pages + Backend Tunnel'
Write-Host '============================================================'

# 1. Start private infrastructure if needed.
Write-Host '[1/6] Infrastructure'
docker compose -f "$root\docker-compose.yml" up -d postgres minio redis pgadmin | Out-Host

# 2. Create the server-only remote environment once. It contains no public URL.
if (-not (Test-Path $envRemote)) {
    $content = [IO.File]::ReadAllText("$root\.env")
    $content = [regex]::Replace($content, '(?m)^COOKIE_SECURE=.*$', 'COOKIE_SECURE=true')
    $content = [regex]::Replace($content, '(?m)^COOKIE_SAME_SITE=.*$', 'COOKIE_SAME_SITE=none')
    $content = [regex]::Replace($content, '(?m)^COOKIE_DOMAIN=.*$', 'COOKIE_DOMAIN=')
    [IO.File]::WriteAllText($envRemote, $content)
} else {
    # Keep provider settings current when .env.remote predates a new provider integration.
    $sourceContent = [IO.File]::ReadAllText("$root\.env")
    $remoteContent = [IO.File]::ReadAllText($envRemote)
    foreach ($key in @('DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL')) {
        $match = [regex]::Match($sourceContent, "(?m)^$key=.*$")
        if (-not $match.Success -or $match.Value -match "=$") { continue }
        if ($remoteContent -match "(?m)^$key=.*$") {
            $remoteContent = [regex]::Replace($remoteContent, "(?m)^$key=.*$", [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $match.Value })
        } else {
            $remoteContent = $remoteContent.TrimEnd() + "`r`n" + $match.Value + "`r`n"
        }
    }
    [IO.File]::WriteAllText($envRemote, $remoteContent)
}

# 3. Ensure Express runs with cross-site cookie settings, then health-gate.
Write-Host '[2/6] Express'
$remoteApi = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -match 'tsx' -and $_.CommandLine -match '\.env\.remote' } |
    Select-Object -First 1
if (-not $remoteApi) {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
        Where-Object { $_.CommandLine -match 'tsx' } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep 2
    Start-Process cmd.exe -ArgumentList '/k', "cd /d $root\server && npx tsx watch --env-file=$envRemote src/server.ts > $root\logs\dev-server-console.log 2>&1"
}

$local = $null
for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep 2
    try {
        $local = Invoke-RestMethod $healthLocal -TimeoutSec 5
        if ($local.data.status -eq 'ok' -and $local.data.services.database.status -eq 'up' -and $local.data.services.minio.status -eq 'up') { break }
    } catch { }
}
if (-not $local -or $local.data.status -ne 'ok') {
    Write-Host 'BACKEND LOCAL HEALTH FAILED' -ForegroundColor Red
    if (Test-Path "$root\logs\dev-server-console.log") { Get-Content "$root\logs\dev-server-console.log" -Tail 30 }
    exit 1
}
Write-Host '  PostgreSQL, Redis, MinIO, Express: OK'

# 4. Expose ONLY Express through one Cloudflare quick tunnel.
Write-Host '[3/6] Cloudflare backend tunnel'
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

$cloudflared = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cloudflared) { $cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' }
if (-not (Test-Path $cloudflared)) { throw 'cloudflared is not installed.' }

$logStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outLog = "$root\logs\cloudflared-backend-$logStamp.log"
$errLog = "$root\logs\cloudflared-backend-$logStamp.err.log"
Start-Process -FilePath $cloudflared `
    -ArgumentList 'tunnel', '--url', 'http://127.0.0.1:4000', '--no-autoupdate' `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errLog `
    -WindowStyle Hidden

$backendUrl = $null
for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep 2
    # The redirected stdout/stderr files stay open (written) by cloudflared, so
    # read them with a shared-open FileStream instead of ReadAllText, which
    # throws "file in use" the moment the writer holds the handle.
    $logs = ''
    foreach ($logPath in @($outLog, $errLog)) {
        if (-not (Test-Path $logPath)) { continue }
        try {
            $fs = [IO.File]::Open($logPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
            try {
                $reader = [IO.StreamReader]::new($fs)
                try { $logs += $reader.ReadToEnd() } finally { $reader.Dispose() }
            } finally { $fs.Dispose() }
        } catch { }
    }
    if ($logs -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $backendUrl = $matches[0]
        break
    }
}
if (-not $backendUrl) {
    Get-Content $errLog -Tail 30
    throw 'Cloudflare backend tunnel failed to start.'
}
Write-Host "  Backend: $backendUrl"

# 5. Verify public API before changing the Pages build.
Write-Host '[4/6] Public API health'
$publicHealth = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep 2
    try {
        $publicHealth = Invoke-RestMethod "$backendUrl/api/v1/health" -TimeoutSec 15
        if ($publicHealth.data.status -eq 'ok') { break }
    } catch { }
}
if (-not $publicHealth -or $publicHealth.data.status -ne 'ok') { throw 'Cloudflare public health failed.' }
Write-Host '  Public health: OK'

# 6. Bake the current tunnel URL into the Vite bundle and deploy Pages.
Write-Host '[5/6] Cloudflare Pages build and deploy'
$env:VITE_API_BASE = "$backendUrl/api/v1"
try {
    & npm --prefix "$root\client" run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    & npx wrangler pages deploy "$root\client\dist" --project-name urs-dms --branch main --commit-dirty=true
    if ($LASTEXITCODE -ne 0) { throw 'Cloudflare Pages deploy failed.' }
} finally {
    Remove-Item Env:VITE_API_BASE -ErrorAction SilentlyContinue
}

Write-Host '[6/6] REMOTE TESTING READY' -ForegroundColor Green
Write-Host "  Frontend: $pagesUrl"
Write-Host "  Backend:  $backendUrl/api/v1/health"
Write-Host ''
Write-Host 'Quick Tunnel URLs change after cloudflared restarts.'
Write-Host 'Rerun this script to rebake and redeploy Pages automatically.'
