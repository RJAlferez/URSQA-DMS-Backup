# Backend

## Server lifecycle

`server/src/index.ts` loads and validates environment configuration before importing the bootstrap. `server.ts` ensures the MinIO bucket, starts Express, starts the legacy email worker and BullMQ workers, and shuts down HTTP, queues, Redis, and Prisma gracefully. `app.ts` configures trust proxy, Helmet, CORS, parsing, Morgan/Winston logging, request context, `/api` rate limiting, the `/api/v1` router, 404 handling, and the error handler.

## HTTP/module pattern

Routes validate parameters/body/query with Zod middleware, apply `authenticate` and permission/role guards, then delegate to controllers through `asyncHandler`. Services contain domain behavior. Repositories, where present, perform Prisma persistence. `utils/apiResponse.ts` and `utils/errors.ts` provide response/error conventions.

## Mounted modules

`/health`, `/files`, `/auth`, `/users`, `/documents`, `/folders`, `/requests`, `/aaccup`, `/dashboard`, `/analytics`, `/audit`, `/reports`, `/admin`, `/notifications`, `/workflows`, `/repositories`, `/root`, and `/assistant` are mounted under `/api/v1`.

`admin` contains users, roles, permissions, colleges, departments, and settings. `root` contains overview/configuration, organization, folder builder, requirement builder, workflow definition work, form builder, roles/permissions, and setup. AACCUP has area, requirement, submission, task, analytics, and compliance services.

## Cross-cutting behavior

Authentication resolves a live session and database permissions. Guards use `requirePermission`, `requireAnyPermission`, or `requireRole`. Request context supplies request/correlation information used by logging and auditing. Storage helpers issue object operations; queue helpers enqueue jobs; worker startup registers email, thumbnail, folder copy, folder ZIP, and maintenance workers.

The API’s exact request validation schemas are in each module’s `*.validator.ts`; use those files when changing a contract.
