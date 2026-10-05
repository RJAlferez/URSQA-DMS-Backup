$ErrorActionPreference = "Stop"

$ruleName = "URS-DMS HTTP 80"
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow -Profile Domain,Private,Public -ErrorAction Stop | Out-Null
Write-Output "Created Windows Firewall rule: $ruleName (TCP 80)."
