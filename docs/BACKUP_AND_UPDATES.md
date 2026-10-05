# Source backup and future updates

Production URL: https://urs-dms.online

Source backup: https://github.com/Lamaww/URSQA-DMS-_Backup

## Backup scope

The backup `main` branch contains the local source snapshot, including the
existing feature revisions, Prisma migrations, deployment configuration, and
documentation. Its parent history comes from the original `master` branch.
The original repository's fetched `main` branch is retained separately as
`upstream-main`, and the existing release tags are retained.

Local environment files, database exports, Docker volumes, uploaded documents,
dependencies, compiled frontend bundles, and downloaded Caddy binaries are
excluded. This snapshot records the current code; uploading it does not verify
or deploy the changes to production.

## Git remotes

Keep `origin` pointing at the original project. Use `backup` for this repository:

```powershell
git remote -v
git push backup HEAD:main
```

For future updates, review `git status` and `git diff`, stage the intended source
files, and commit them before pushing. If `main` has newer remote commits, fetch
and reconcile them before pushing. Do not force-push over the backup history.

The release workflow builds the frontend bundle before its runtime Docker image.
Its Dokploy webhook step is restricted to the original repository, so pushes to
this backup repository do not invoke that deployment hook. Deployment remains a
separate operation; do not connect automatic production deployments to this
backup unless deliberately configuring that behavior.

## Emergency recovery

1. Clone the backup `main` branch onto the replacement host.
2. Restore the private production environment configuration from secure storage.
   `.env.example` and `deploy/dokploy/env.production.example` are templates.
3. Restore the matching PostgreSQL database and MinIO/object-storage data from
   separate backups. Git does not contain users, submissions, or uploaded files.
4. Follow [Laptop/server deployment](LAPTOP_SERVER_DEPLOYMENT.md) or
   [Dokploy deployment](../deploy/dokploy/README.md) for the chosen host.
5. Apply the included database migrations using the documented deployment path,
   then check authentication, file access, and email before switching traffic.

Back up PostgreSQL and object storage together at a consistent recovery point.
Use the hosting provider's database and volume backup features, or encrypted
database exports and object-storage copies kept outside GitHub. Also preserve
the private environment configuration separately. Recovery requires all three:
source code, database/object data, and private configuration.

For Windows hosts, `scripts/install-caddy.ps1` installs the excluded Caddy binary.
Shell scripts use LF line endings through `.gitattributes` for Docker/Linux.
