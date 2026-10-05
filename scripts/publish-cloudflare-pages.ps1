param(
    [Parameter(Mandatory = $true)]
    [string]$TunnelUrl
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$TunnelUrl = $TunnelUrl.TrimEnd("/")
if ($TunnelUrl -notmatch "^https://[a-z0-9-]+\.trycloudflare\.com$") {
    throw "TunnelUrl must be an HTTPS trycloudflare.com URL."
}

$health = Invoke-RestMethod -Uri "$TunnelUrl/api/v1/health" -TimeoutSec 20
if ($health.data.status -ne "ok") { throw "Tunnel API health is not OK." }
if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { throw "npx is not available." }

$oldApiBase = $env:VITE_API_BASE
$env:VITE_API_BASE = "$TunnelUrl/api/v1"
try {
    npm --prefix (Join-Path $root "client") run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend production build failed." }
    npx wrangler pages deploy (Join-Path $root "client\dist") --project-name urs-dms --branch main --commit-dirty=true
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare Pages deployment failed." }
} finally {
    if ($null -eq $oldApiBase) { Remove-Item Env:VITE_API_BASE -ErrorAction SilentlyContinue }
    else { $env:VITE_API_BASE = $oldApiBase }
}

Write-Output "Cloudflare Pages deployed with API base $TunnelUrl/api/v1"
