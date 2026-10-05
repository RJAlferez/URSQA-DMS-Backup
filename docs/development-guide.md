# Development guide

## Start the stack

1. Create a local `.env` from `.env.example` and supply required non-secret/local values. Do not copy credentials into source or documentation.
2. Start infrastructure with Docker Compose, or use the provided Bash helper where supported:

```powershell
docker compose up -d postgres minio redis pgadmin
npm run prisma:generate
npm run dev:server
npm run dev:client
```

The server development command is `tsx watch src/server.ts` through the root workspace command. The client runs Vite and proxies `/api` to `http://localhost:4000`. `scripts/dev.sh` starts infrastructure and host client/server for Bash environments.

## Validate changes

Use targeted checks first: client lint/typecheck/build for UI work; server lint/typecheck and relevant Vitest files for API work. See [testing](testing.md) for exact commands and the integration-test database warning. Use `docker compose logs` and the health endpoint `/api/v1/health` when debugging a running stack.

## Safe workflow

1. Inspect the route, service, validator, repository/schema, and client service before editing.
2. Preserve the controller/service/repository and shared-component boundaries.
3. Do not change Prisma schema/migrations, security checks, audit behavior, or environment/deployment configuration without explicit authorization.
4. Do not add mock data unless requested. Keep unrelated existing dirty changes untouched.
5. Check API changes against validator and route guards; check UI changes against shared primitives and responsive shells.
6. Review `git diff` and run proportionate validation before handoff.

## Debugging order

Confirm environment validation and dependency services first; then reproduce through the smallest route/client service; inspect server logs and error response; trace route -> middleware -> controller -> service -> repository/storage/job. For authorization problems, inspect both the database permission binding and service-level ownership rules. For file problems, check the signed file-token flow, MinIO endpoint configuration, and metadata-finalization path.

## Database precautions

Generate Prisma client when schema artifacts legitimately change, but do not run `prisma:migrate`, `prisma:deploy`, seed, cleanup, or destructive maintenance commands without authorization and a confirmed target database.
