$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Get-Process -Name caddy -ErrorAction SilentlyContinue | Stop-Process
docker compose -f (Join-Path $root "docker-compose.yml") -f (Join-Path $root "docker-compose.production.yml") stop server
Write-Output "Stopped Caddy and urs-server. Persistent volumes were not changed."
