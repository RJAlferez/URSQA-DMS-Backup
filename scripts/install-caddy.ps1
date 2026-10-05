$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root "tools\caddy"
$caddy = Join-Path $tools "caddy.exe"

if (Test-Path -LiteralPath $caddy) {
    & $caddy version
    exit 0
}

if (-not (Test-Path -LiteralPath $tools)) {
    New-Item -ItemType Directory -Path $tools | Out-Null
}

$release = Invoke-RestMethod -Uri "https://api.github.com/repos/caddyserver/caddy/releases/latest" -Headers @{ "User-Agent" = "URS-DMS-deployer" }
$asset = @($release.assets) | Where-Object { $_.name -match "windows_amd64\.zip$" } | Select-Object -First 1
if (-not $asset) { throw "Could not find the Caddy Windows amd64 release asset." }

$zip = Join-Path $env:TEMP "urs-dms-caddy.zip"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip
Expand-Archive -LiteralPath $zip -DestinationPath $tools -Force
Remove-Item -LiteralPath $zip -Force

if (-not (Test-Path -LiteralPath $caddy)) { throw "Caddy installation did not produce $caddy" }
& $caddy version
