# Deploying URS-DMS to Hostinger VPS via Dokploy

This guide walks through deploying the production stack to a Hostinger KVM VPS
managed by Dokploy. The stack uses **same-domain routing** — the SPA and the
API share one domain, with Nginx inside the frontend container reverse-proxying
`/api/*` to the backend.

```
Internet ──► Traefik (Dokploy)
              ├─► https://urs-dms.online/        → frontend (Nginx + SPA)
              ├─► https://urs-dms.online/api/*   → urs-server (Express)
              └─► https://minio.urs-dms.online       → MinIO console/API (optional)
```

---

## 0. Prerequisites

| What | Why |
|---|---|
| Hostinger KVM 2 VPS (or higher), Ubuntu 22.04/24.04 | Docker host |
| Public domain with DNS access | A records for `dms` and `minio` |
| SMTP account (Resend, Brevo, SES) | Invitation + password-reset emails |
| Two 48-byte random secrets | `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` |
| Strong passwords | Bootstrap admin + ROOT |
| Dokploy installed on the VPS | See below |
| This repo pushed to GitHub (or GitLab) | Dokploy pulls from Git |

### Generate the secrets you'll need

```bash
node -e "console.log('JWT_ACCESS_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('POSTGRES_PASSWORD=' + require('crypto').randomBytes(24).toString('base64url'))"
node -e "console.log('MINIO_ROOT_PASSWORD=' + require('crypto').randomBytes(24).toString('base64url'))"
node -e "console.log('BOOTSTRAP_ADMIN_PASSWORD=' + require('crypto').randomBytes(18).toString('base64url'))"
node -e "console.log('BOOTSTRAP_ROOT_PASSWORD=' + require('crypto').randomBytes(18).toString('base64url'))"
```

Save these in your password manager — you won't see them again.

---

## 1. Provision the VPS and install Dokploy

1. Buy a Hostinger KVM 2 (or larger). Pick Ubuntu 22.04 or 24.04 LTS.
2. SSH in as root.
3. Run the Dokploy installer (one shot — installs Docker, Traefik, Dokploy):

   ```bash
   curl -sSL https://dokploy.com/install.sh | sh
   ```

4. Open `http://<VPS-IP>:3000` and complete the setup wizard (admin user/password).
5. Set up your organization + project `urs-dms`.

### DNS

Create A records pointing at the VPS IP:

| Name | Type | Value |
|---|---|---|
| `urs-dms.online` | A | `<VPS-IP>` |
| `minio.urs-dms.online` | A | `<VPS-IP>` |

If you skip the `minio` subdomain, you'll need to access the MinIO console via
the Dokploy UI's "Show Containers" → port-forwarding.

---

## 2. Create the supporting services in Dokploy

For each service, click **Create Service** in the Dokploy project and follow
the matching section below.

### 2.1 PostgreSQL (Dokploy Database)

- **Type:** Database
- **Image:** `postgres:16-alpine`
- **Database name:** `urs_dms`
- **Username:** `urs_user`
- **Password:** `<from your secret generator>`
- **Volume:** `/var/lib/postgresql/data` (persistent)
- **Health check:** `pg_isready -U urs_user -d urs_dms`
- Note the internal hostname Dokploy assigns (usually `postgres`).

### 2.2 Redis (Dokploy Database)

- **Type:** Database
- **Image:** `redis:7-alpine`
- **Command:** `redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy noeviction`
- **Volume:** `/data` (persistent)
- Note the internal hostname (usually `redis`).

### 2.3 MinIO (Dokploy Application — Docker image)

- **Type:** Application
- **Source:** Docker Image → `minio/minio:latest`
- **Command:** `server /data --console-address ":9001"`
- **Environment:**
  ```
  MINIO_ROOT_USER=urs_minio_admin
  MINIO_ROOT_PASSWORD=<from your secret generator>
  ```
- **Volumes:** `/data` (persistent)
- **Domains (via Traefik):**
  - `minio.urs-dms.online` → port `9000` (S3 API)
  - `minio-console.urs-dms.online` → port `9001` (web console, restrict by IP if possible)
- **Health check:** `curl -f http://localhost:9000/minio/health/live`

After first start, open the MinIO console and **create the `urs-dms` bucket**
(it will be auto-created on backend boot anyway, but creating it explicitly
lets you set CORS + lifecycle rules up front):

```json
[
  {
    "AllowedOrigins": ["https://urs-dms.online"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Also add a lifecycle rule on prefix `temp/` (expire after 1 day) — addresses
the abandoned-multipart-upload limitation noted in the README.

---

## 3. Backend service (urs-server)

- **Type:** Application
- **Source:** Git provider → this repo, branch `main`
- **Build:** Docker
- **Dockerfile:** `server/Dockerfile`
- **Port:** `4000`
- **Health check path:** `/api/v1/health`

### Environment

Paste the contents of [`env.production.example`](./env.production.example)
section "Backend service env" into the Dokploy Environment tab, replacing
every `GENERATE_*` placeholder with your real secret. Reference values:

| Var | Example value |
|---|---|
| `PUBLIC_APP_URL` | `https://urs-dms.online` |
| `CLIENT_URL` | `https://urs-dms.online` |
| `DATABASE_URL` | `postgresql://urs_user:<pw>@postgres:5432/urs_dms?schema=public&connection_limit=20&pool_timeout=30` |
| `REDIS_HOST` | `redis` (Dokploy-internal name) |
| `MINIO_ENDPOINT` | `minio` (Dokploy-internal name) |
| `JWT_*` | real secrets |
| `SMTP_*` | your SMTP provider credentials |

**Important:** do **not** set `MINIO_PUBLIC_ENDPOINT` — the backend already
streams files via signed tokens through the same origin.

### Optional: Office preview conversion

If server-side previews for DOC/DOCX/PPT/PPTX/XLS/XLSX are required, add a
Dokploy application using `gotenberg/gotenberg:8` and expose it only on the
internal Dokploy network. Set `GOTENBERG_URL=http://gotenberg:3000` on
`urs-server`. Native browser previews continue to work when this service is
omitted.

### Domain

You do **not** need to attach a public domain to the backend in Dokploy —
the frontend container proxies `/api/*` to the backend over the internal
network (`urs-server:4000`). The Nginx config baked into the frontend image
handles routing.

### Depends on

Postgres + Redis + MinIO must be `healthy` before the backend starts. Set
"Depends on" in the Dokploy service to all three.

---

## 4. Frontend service (urs-frontend)

- **Type:** Application
- **Source:** Git provider → this repo, branch `main`
- **Build:** Docker
- **Dockerfile:** `./Dockerfile` (the new root Dockerfile)
- **Build args:**
  ```
  VITE_API_BASE=/api/v1
  BACKEND_UPSTREAM=urs-server:4000
  ```
- **Port:** `80`
- **Health check:** `/`

### Domain (via Traefik)

Attach **`urs-dms.online`** with Traefik auto-TLS. Dokploy will obtain
and renew the Let's Encrypt certificate automatically once DNS resolves.

### Depends on

`urs-server` (the backend) must start before the frontend, otherwise the
Nginx upstream `urs-server:4000` will be unreachable on first boot. Set
"Depends on" to the backend service.

---

## 5. First deploy

1. In Dokploy, click **Deploy** on the backend service first.
2. Watch the build logs. You should see:
   ```
   [entrypoint] applying Prisma migrations...
   [entrypoint] running seed...
   [entrypoint] starting application: node dist/server.js
   URS-DMS server listening on port 4000 (production)
   ```
3. Once backend is healthy, deploy the frontend.
4. Visit `https://urs-dms.online/`. The SPA should load.
5. Probe the API: `curl -s https://urs-dms.online/api/v1/health | jq`.
   Expect `services.minio.status === "up"` and `services.database.status === "up"`.

---

## 6. Smoke test

1. Log in with the bootstrap admin email and password.
2. **Immediately change the bootstrap admin password** from the user settings page.
3. Upload a small document in the repository.
4. Verify it appears in the MinIO console under bucket `urs-dms` (path
   `documents/<docId>/<versionId>/<filename>`).
5. Open DevTools → Application → Cookies. Confirm `urs_refresh_token` is set
   with `Secure; HttpOnly; SameSite=None` and a 7-day expiry.
6. Trigger an AACCUP submission ZIP export and download it.
7. Log out and log back in — refresh-cookie rotation should work.

---

## 7. Backups and hardening

| Action | Where |
|---|---|
| Schedule Postgres dump → MinIO bucket | Dokploy → Backups |
| Snapshot MinIO data volume nightly | Cron inside Dokploy, or Dokploy volume backup |
| Restrict MinIO console by IP | Traefik middleware |
| Disable pgAdmin (not deployed here) | n/a — we don't ship pgAdmin |
| Rotate JWT secrets | Update env in Dokploy → redeploy backend (invalidates all sessions) |
| Rotate bootstrap admin/ROOT passwords | UI after first login |

---

## 8. Updates (after the initial deploy)

The deployment is wired for **auto-deploy on push**:

1. In Dokploy → Service Settings → **Git** → enable **Auto Deploy** on push.
2. Optionally protect `master` with branch protection rules in GitHub.
3. Push to `main`:

   ```bash
   git push origin main
   ```

4. Dokploy detects the push, rebuilds the image, runs migrations on container
   start (`entrypoint.sh`), and swaps the container once health checks pass.

To update both frontend and backend:
- Push once → rebuild both → 1-3 minute deploy window
- Backend redeploys first (so migrations apply), frontend follows

If something breaks, use Dokploy's **Rollback** button to revert to the
previous container.

---

## 9. Troubleshooting

### `502 Bad Gateway` on `/api/*`

The frontend Nginx upstream can't reach the backend. Check:
- Backend service is running (`urs-server`)
- Both services are on the same Dokploy network
- Backend health check is green

### `services.minio.status === "down"` in `/api/v1/health`

- `MINIO_ENDPOINT` and `MINIO_PORT` match the Dokploy-internal MinIO service
- `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` match the MinIO service env
- MinIO service is healthy in Dokploy

### Cookies not persisting

- `COOKIE_SECURE=true` is required for HTTPS
- `COOKIE_SAME_SITE=none` is required for cross-origin (not needed for
  same-origin but harmless)
- `COOKIE_DOMAIN` must be empty for same-domain setup

### Prisma migration fails on first boot

- Check the entrypoint logs: `dokploy logs urs-server`
- Most common cause: `DATABASE_URL` doesn't match the credentials Dokploy
  generated for the Postgres service. Fix env, redeploy.

### SPA loads but routes 404 on refresh

- Nginx is missing the SPA fallback. Confirm `try_files $uri $uri/ /index.html;`
  in `/etc/nginx/conf.d/app.conf`. If you changed the nginx config and
  rebuilt, the new image is correct; otherwise force-rebuild the frontend.

---

## 10. What's intentionally NOT deployed

- `pgAdmin` (local-only convenience, not in the Dokploy compose)
- Cloudflare quick tunnels (replaced by Traefik + Let's Encrypt)
- Docker-mailserver profile (Hostinger blocks port 25; use external SMTP)
- `docker-compose.yml` (still used for local dev; do **not** use on the VPS)
- `docker-compose.production.yml` (dev-only overrides; do **not** use on the VPS)
- `Caddyfile` at the repo root (Windows-specific, dev-only)
