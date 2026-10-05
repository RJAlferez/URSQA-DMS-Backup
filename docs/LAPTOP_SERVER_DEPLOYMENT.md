# URS-DMS Laptop Server Deployment

## Architecture

The React production bundle in `client/dist` is served by project-local Caddy on TCP 80. Caddy forwards `/api/*` unchanged to the host-only Docker API mapping `127.0.0.1:4001` (container port 4000). Express streams authorized files through private MinIO; PostgreSQL, Redis, pgAdmin, and MinIO are not application entry points.

The client uses `VITE_API_BASE=/api/v1`, so public-IP changes do not require a frontend rebuild.

## Prerequisites and Build

Install Docker Desktop, ensure it is running, and install Caddy locally:

```powershell
.\scripts\install-caddy.ps1
npm run build:client
```

The build output must be `client/dist`. The production server does not use Vite's development server or port 5173.

## Start and Stop

```powershell
.\scripts\start-production.ps1
.\scripts\stop-production.ps1
```

Use `-Build` to rebuild the client and `-ConfigureFirewall` from an elevated PowerShell to create the TCP 80 inbound rule. The current non-elevated session could not change firewall rules; the legacy 4000 allow rule must also be removed from an elevated session:

```powershell
.\scripts\start-production.ps1 -Build -ConfigureFirewall
# Optional cleanup, elevated PowerShell only:
Remove-NetFirewallRule -DisplayName "URS-DMS Server 4000"
```

The compose override only changes host bindings and server HTTP cookie settings. It does not reset migrations, recreate volumes, or delete data. Do not use `docker compose down -v`.

## Local and LAN Tests

Test `http://localhost`, then from another device on the same Wi-Fi test `http://192.168.8.36`. Verify SPA refreshes such as `/dashboard`, `/documents`, `/admin`, and `/root`; login, refresh persistence, uploads, downloads, previews, thumbnails, profile photos, folder sharing, AACCUP, ISO, notifications, and chatbot.

Health endpoint: `http://localhost/api/v1/health`.

## Router and Public Test

Reserve `192.168.8.36` in the router DHCP settings. Add one manual forwarding rule:

| Setting | Value |
|---|---|
| Comment | URS-DMS |
| Protocol | TCP |
| Remote port | 80 |
| Local IP | 192.168.8.36 |
| Local port | 80 |
| Remote IP | blank / any |

Do not use DMZ and do not forward 4000, 5432, 5433, 6379, 6380, 9000, 9001, or 5050. Test `http://PUBLIC-IP` from mobile data only after LAN testing succeeds.

## Windows Startup

Configure Docker Desktop to start with Windows, then create a Task Scheduler task running PowerShell at user logon with:

```powershell
-NoProfile -ExecutionPolicy Bypass -File C:\Dev\URS-DMS\scripts\start-production.ps1
```

Run Caddy elevated or install it as a Windows service if a service-managed deployment is preferred. The start script intentionally stops if another service owns TCP 80; currently IIS/W3SVC owns it and must be stopped or reconfigured manually after confirming it is not needed by another application.

## Temporary Cloudflare Tunnel

For temporary remote testing, expose only Caddy's HTTP entry point. Do not use the old multi-tunnel setup for Vite, backend 4000, MinIO 9000, or MinIO Console 9001:

```powershell
.\scripts\start-cloudflare-tunnel.ps1
.\scripts\stop-cloudflare-tunnel.ps1
```

The launcher stops existing `cloudflared` quick tunnels, starts one tunnel to `http://127.0.0.1:80`, and health-checks `/api/v1/health`. The generated `trycloudflare.com` URL is temporary and changes after restart. Cloudflare quick tunnels are not a substitute for HTTPS/domain production security or a stable public URL.

To publish the same production build to Cloudflare Pages while keeping one tunnel only:

```powershell
.\scripts\publish-cloudflare-pages.ps1 -TunnelUrl https://YOUR-TUNNEL.trycloudflare.com
```

Pages is built with `VITE_API_BASE=https://YOUR-TUNNEL.trycloudflare.com/api/v1`. It does not create another tunnel. Because Pages is HTTPS and the temporary tunnel URL is HTTPS, the production override uses `Secure` and `SameSite=None` refresh cookies. Plain HTTP local testing may not persist refresh cookies while this Pages mode is active; the tunnel URL is the supported remote test origin.

## Troubleshooting

- Local works but LAN fails: check Windows Firewall and that Caddy is bound to TCP 80.
- LAN works but PUBLIC-IP fails: check forwarding, ISP inbound filtering, and possible Surf2Sawa/Converge CGNAT. Do not change the database or application to address CGNAT.
- Frontend opens but API fails: check `/api` proxy, `VITE_API_BASE`, and `docker logs urs-server`.
- Login fails remotely: production cookies are host-only, HTTP-compatible, and `SameSite=Lax`; check browser cookie policy and origin.
- Files fail remotely: confirm URLs are `/api/v1/files/*` signed backend URLs, never MinIO hostnames or port 9000.
- Refresh gives 404: confirm Caddy's `try_files {path} /index.html` fallback and that `client/dist/index.html` exists.

## Security and Backup

HTTP is unencrypted. Passwords and tokens can be observed on untrusted networks; do not use confidential university data for uncontrolled public testing. Add HTTPS and a domain before real internet use. Keep encrypted backups of PostgreSQL and MinIO data and test restoration. Never put `DATABASE_URL`, JWT secrets, MinIO credentials, Redis credentials, or the DeepSeek API key in Vite variables.
