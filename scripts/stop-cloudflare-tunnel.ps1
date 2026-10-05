$ErrorActionPreference = "Stop"
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output "Stopped Cloudflare tunnels. Docker services and persistent data were not changed."
