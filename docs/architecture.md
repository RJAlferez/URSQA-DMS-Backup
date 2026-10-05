# Architecture

## Overview

URS-DMS is a browser client backed by a JSON Express API at `/api/v1`. The client uses Vite's `/api` proxy in development. The API uses Prisma/PostgreSQL for relational state, MinIO for objects, Redis/BullMQ for queued work, and Nodemailer for email delivery.

```text
React + Vite client
  |  fetch /api/v1 (Bearer access token; refresh cookie)
Express app -> route -> validation/guards -> controller -> service -> repository/Prisma -> PostgreSQL
       |                                      |                -> MinIO (signed API file URLs/streaming)
       |                                      |                -> audit/notifications/email
       |                                      `-> BullMQ -> Redis -> workers (email, thumbnails, copy, ZIP, maintenance)
```

## Application layers

- `client/src`: route-driven React application, page shells, components, services, and UI utilities.
- `server/src/routes/index.ts`: mounts module routers beneath `/api/v1`.
- Middleware applies security headers, CORS, parsing, request context, rate limiting, authentication, authorization, validation, and centralized errors.
- Modules generally separate `routes`, `controller`, `service`, `repository`, `validator`, and `types`; not every module has every layer.
- `server/prisma/schema.prisma` is the relational model and migration source.

## Key flows

Authentication creates a database session, issues a signed access JWT, and places the opaque refresh token in an httpOnly cookie. Each authenticated request validates the JWT, session, active user status, and current role permissions before handlers run.

Document metadata and versions are stored in PostgreSQL while bytes move through signed `/files` API URLs that stream to/from MinIO. The API owns metadata finalization and file access checks. Folder copy, folder ZIP, email, thumbnail, and maintenance work are registered as BullMQ worker responsibilities.

Services are the cross-cutting boundary for ownership, business rules, audit events, notifications, and transactions. Routes expose HTTP contracts; repositories encapsulate Prisma queries where provided.

## External services

Implemented integrations are PostgreSQL, MinIO/S3-compatible storage, Redis/BullMQ, and console or SMTP email. Docker Compose also defines optional self-hosted mail and pgAdmin services. The navigation assistant has a service and route; any remote model/provider behavior is configuration-dependent and not verified as usable in this release.
