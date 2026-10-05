# Configuration

## Required runtime values

The environment schema requires `CLIENT_URL`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`. It also validates or defaults: `NODE_ENV`, `PORT`, access/refresh expiry, JWT issuer/audience, cookie domain/security/same-site, MinIO endpoint/port/SSL/access key/secret/bucket/public endpoint, rate-limit window/max, account lockout/password/session settings, trust proxy, email settings, Redis settings, and worker/job limits.

Use `.env.example` for variable names and safe example shape. Never commit live passwords, JWT secrets, database URLs containing credentials, SMTP passwords, or access keys.

## Services

`docker-compose.yml` defines PostgreSQL, MinIO, Redis, pgAdmin, the server, and an optional mailserver profile. The server container overrides database/MinIO/Redis hostnames for the Compose network. `MINIO_PUBLIC_ENDPOINT` is accepted by the environment schema; direct public-MinIO URL use is not verified in this committed release because the current `/files` routes stream through Express.

## Optional configuration

Bootstrap administrator/root variables are read by seeding and are optional at runtime. Email provider defaults to `console`; selecting `smtp` requires `SMTP_HOST` and `SMTP_FROM` per the schema. Redis has localhost defaults, but queue-backed production behavior depends on an available Redis service.

Configuration is validated on server import and invalid values terminate startup.
