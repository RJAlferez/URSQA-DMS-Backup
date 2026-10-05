# Project structure

| Path | Purpose |
|---|---|
| `client/` | Vite React application: `src/App.tsx` routes/shells, pages, components, services, context, library helpers, and domain types. |
| `server/` | Express application, Prisma schema/migrations, module-based API, middleware, libraries, workers, tests, and Dockerfile. |
| `server/src/modules/` | Domain modules: auth, users, documents, folders, requests, repositories, audit, AACCUP, admin, root, workflow, reports, and supporting services. |
| `server/prisma/` | `schema.prisma`, ordered SQL migrations, and seed script. |
| `docker/` | PostgreSQL initialization, MinIO, mail-server, and wait scripts. |
| `deploy/` | Nginx and Dokploy deployment assets. |
| `scripts/` | Development, lint, maintenance, cleanup, tunnel, and load-test utilities. |
| `docs/` | Project documentation; this documentation set is the maintained context baseline. |
| `docker-compose.yml` | Local/integrated PostgreSQL, MinIO, Redis, pgAdmin, optional mail, and server topology. |
| `.env.example` | Environment-variable names and non-secret example configuration. |

Important entry points are `client/src/main.tsx`, `client/src/App.tsx`, `server/src/index.ts`, `server/src/server.ts`, `server/src/app.ts`, and `server/src/routes/index.ts`.
