# API reference

All routes below are prefixed with `/api/v1`. Successful JSON handlers use the project API response helpers; validation failure/error shape is handled centrally. Bodies, query fields, and detailed response DTOs are defined by each module’s validator/types/controller and are not duplicated here to avoid inventing contracts.

## Public/authentication

| Method | Route | Auth / authorization | Module |
|---|---|---|---|
| POST | `/auth/login`, `/auth/refresh`, `/auth/logout` | Public; login/refresh use auth limiter | auth |
| GET | `/auth/registration-options` | Public | auth |
| POST | `/auth/registration/validate`, `/auth/registration`, `/auth/registration/request` | Public; limiter where declared | auth |
| GET | `/auth/me`, `/auth/sessions` | Authenticated | auth |
| POST | `/auth/change-password` | `users.self.update` | auth |
| POST | `/auth/sessions/:sessionId/kill`, `/auth/sessions/kill-all` | Authenticated | auth |
| POST | `/auth/password-reset/request`, `/auth/password-reset/reset` | Public | password reset |
| GET | `/auth/dev/reset-link` | Public route in committed code; intended environment restrictions are not verified here | password reset |

## Documents, folders, files, repository, requests

| Group | Base route | Operations exposed |
|---|---|---|
| Files | `/files` | Signed-token `PUT /upload` and `GET /download` endpoints; the token is the access grant and Express streams to/from MinIO. |
| Documents | `/documents` | List/search/deleted, create/presign/finalize, detail/update/delete/restore/permanent delete, versions, tags, shares, preview/download/thumbnail and ZIP-related operations. Routes carry `documents.*` permissions. |
| Folders | `/folders` | List/tree/deleted/shared, create/detail/update/delete/restore/permanent delete, move/copy/ZIP/jobs, pins, and folder-share CRUD. Routes carry `folders.*` permissions. |
| Repositories | `/repositories` | `GET /me`, `/storage`, `/emergency`; `POST /backfill`, `/:ownerId/emergency-access`, `/emergency-access/:id/revoke`; `GET /:ownerId`. Emergency mutation/backfill needs `repository.emergency_access`; owner access is service-checked. |
| Requests | `/requests` | List, detail, create, matching/approve/reject/fulfill and item operations as declared by `requests.routes.ts`; permissions include `request.create` or `request.manage`. |

## Application modules

| Base route | Verified endpoint families / protection |
|---|---|
| `/health` | Health endpoint. |
| `/users` | Own profile/photo, user listing/detail/update/delete/status and related user operations; router determines per-operation permissions. |
| `/dashboard` | Authenticated dashboard statistics endpoints with `dashboard.read`. |
| `/analytics` | Authenticated analytics endpoints with `analytics.read`. |
| `/reports` | Report listing/metrics/export; read/export permissions are declared in `reports.routes.ts`. |
| `/notifications` | Inbox listing/count/read updates/delete/preferences; own inbox uses `notification.read`, management route uses `notification.manage`. |
| `/assistant` | `POST` navigation assistant query; authentication and request validation are declared in its route. |
| `/maintenance` | Status/jobs/orphan/maintenance actions; exact ROOT/permission guards are in `maintenance.routes.ts`. |

## AACCUP and workflow

`/aaccup` mounts areas plus nested requirement, submission, task, and analytics routers. They expose CRUD/archive/restore/review/status and reporting operations protected by the corresponding `aaccup.*` permissions. `/workflows` exposes workflow definitions, steps, transitions, assignments, versions/history and runtime instance/action endpoints; root definition operations and runtime permissions are explicitly distinguished in `workflow.routes.ts`.

## Administration and root

`/admin` mounts users, roles, permissions, colleges, departments, and settings. Required permission families are `user.*`, `role.*`, `permission.read`, `college.*`, `department.*`, and `admin.settings.*`.

`/root` mounts overview, configuration, organization, folder-builder, requirement-builder, workflow builder, form builder, role/permission administration, and setup. These routes use dedicated root/engine permissions. Consult nested route files before client integration because these builders have large endpoint sets.

## Audit

`/audit` provides `GET /`, `GET /:id`, `GET /export`, `GET /summary`, `GET /presets`, `GET /login-groups`, `GET /my-activity`, and ROOT-oriented retention/archive/review/clear endpoints. `audit.read`, `audit.export`, or `ROOT` requirements are stated directly in `audit.routes.ts`.
