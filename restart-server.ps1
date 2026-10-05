# =============================================================================
# restart-server.ps1 - restart ONLY the URS-DMS API server
# -----------------------------------------------------------------------------
# Safe restart: finds the node.exe whose command line contains "dist/server.js"
# and stops that single PID. NEVER runs Get-Process node | Stop-Process -Force,
# so the Vite client (npm run dev), the opencode session, and any other node
# process keep running untouched.
# =============================================================================

$ErrorActionPreference = "Stop"
$serverDir = "C:\Dev\URS-DMS\server"
$logOut = "C:\Dev\URS-DMS\urs-server.log"
$logErr = "C:\Dev\URS-DMS\urs-server.err.log"
$healthUrl = "http://localhost:4000/api/v1/health"
$port = 4000

# 1. Find the API server process by command line (not by "node" name).
$apiProcess = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*dist/server.js*" } |
    Select-Object -First 1

if ($apiProcess) {
    Write-Host "Stopping API server PID $($apiProcess.ProcessId) ..."
    Stop-Process -Id $apiProcess.ProcessId -Force
    Start-Sleep -Milliseconds 500
} else {
    Write-Host "No running API server process found (starting fresh)."
}

# 2. Wait until port 4000 is free (server may take a moment to release it).
$deadline = (Get-Date).AddSeconds(20)
while ((Get-Date) -lt $deadline) {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $listener) { break }
    Start-Sleep -Milliseconds 500
}
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    Write-Error "Port $port is still in use after 20s; aborting."
    exit 1
}

# 3. Set the runtime env overrides before launching (process-scoped).
$env:DATABASE_URL = "postgresql://urs_user:urs_password@localhost:5432/urs_dms?schema=public"
$env:MINIO_ENDPOINT = "localhost"
# SMTP credentials are read from .env (EMAIL_PROVIDER=console by default).
# Never hardcode SMTP_PASS in this file - it would be committed to the repo.

# 4. Start the server detached with output redirected to log files.
Write-Host "Starting API server (detached) ..."
$proc = Start-Process -FilePath "node.exe" `
    -ArgumentList "--env-file=C:\Dev\URS-DMS\.env", "dist/server.js" `
    -WorkingDirectory $serverDir `
    -RedirectStandardOutput $logOut `
    -RedirectStandardError $logErr `
    -WindowStyle Hidden `
    -PassThru
Write-Host "API server PID $($proc.Id) started."

# 5. Poll the health endpoint and print the status.
$ready = $false
$pollDeadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $pollDeadline) {
    try {
        $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 3
        if ($health.data.status) {
            Write-Host "health: $($health.data.status)"
            $ready = $true
            break
        }
    } catch {
        # not up yet - keep polling
    }
    Start-Sleep -Milliseconds 500
}

if (-not $ready) {
    Write-Host "health: FAILED - server did not become ready. Last log lines:"
    if (Test-Path $logErr) { Get-Content $logErr -Tail 20 }
    exit 1
}
