# URS-DMS — Architecture Reference

> Working mental model of the ACTUAL system, verified against source code, schema, routes,
> and runtime config. This is a navigation aid — **the code is the authority**.
> Last verified: 2026-09-13. Repository: `C:\Dev\URS-DMS` (git repo, monorepo: client + server).

---

## 1. System Overview

URS-DMS is a document management + accreditation (AACCUP/ISO) system for the University of
Rizal System. It is a **two-app monorepo**:

- `client/` — React 18 SPA (Vite), talks to the backend only over `/api/v1`.
- `server/` — Express + Prisma modular monolith, PostgreSQL 16, MinIO storage, Redis/BullMQ jobs.

Two portals share one SPA and one auth system:
- **Admin portal** — roles `ADMINISTRATOR`, `QUALITY_ASSURANCE_OFFICER`, `DEPARTMENT_COORDINATOR`, `ROOT`
  (routed under `/dashboard`, `/documents`, `/audit`, `/root*`, …).
- **User portal** — roles `FACULTY`, `STAFF`, `READ_ONLY` (routed under `/user/*`).

Personal document repository is **ownership-based** (per-user `Repository` row). Department/archive
folders are visible to all authenticated users via folder sharing/department scoping.

---

## 2. Actual Tech Stack

| Layer | Actual |
|---|---|
| Frontend | React 18.3, TypeScript 5.2, Vite 5.3, Tailwind 3.4, Radix primitives (shadcn-style `client/src/components/ui`), lucide-react, react-router-dom 7.15, recharts, pdf-lib, tesseract.js |
| Backend | Node ≥20, Express 4.21, TypeScript 5.6, tsx, Zod 3.23, argon2 0.41, jsonwebtoken 9.0 (HS256), cookie-parser, helmet, cors, morgan, winston, express-rate-limit |
| ORM/DB | Prisma 5.22 → PostgreSQL 16 |
| Storage | MinIO 8 (`minio` npm pkg). Bytes stream through Express via signed JWT file tokens; MinIO stays private |
| Queue/Jobs | BullMQ 6 + ioredis (folder copy, folder ZIP, email, maintenance, thumbnails); in-process email poller fallback |
| Email | nodemailer 6 (SMTP) with console provider fallback |
| Auth | JWT access token (15m default) + opaque SHA-256-hashed refresh token (7d) in httpOnly cookie; argon2id hashes |
| Authorization | DB `Permission` codes bound to `Role` via `RolePermission`; checked per-request middleware |
| Testing | Vitest 2.1 (+v8 coverage). 8 test files; 5 require a live DB |
| Deployment | Docker Compose (`docker-compose.yml`, `.production.yml`, `.dokploy.yml`), Caddy/nginx, Cloudflare tunnel/Pages, GHCR images |

---

## 3. Repository Structure

```
URS-DMS/
├── client/                      # React SPA (real frontend; root src/ is legacy)
│   └── src/
│       ├── App.tsx              # ALL routing + Admin/User portal shells (no router lib config elsewhere)
│       ├── context/AuthContext.tsx
│       ├── lib/                 # http.ts, permissions.tsx, userAttention.ts, toast, theme, avatar, uploadBus
│       ├── services/            # auth, admin, documents, requests, aaccup, dashboard, analytics, notifications, repository, root
│       ├── pages/               # AuditLogs, UserManagement, Settings, DocumentRepository, AdminDashboard, …
│       │   ├── user/            # UserDashboard, UserDocuments, UserRequests, UserAACCUPGroup, MyActivity, …
│       │   └── root/            # RootDashboard, RootAudit, RootUsers, RootRolesPermissions, Root*Builders, …
│       └── components/          # ui/ (shadcn), layout/, modals/, preview/, repository/, aaccup/, auth/, user/
├── server/
│   ├── prisma/
│   │   ├── schema.prisma        # 2,218 lines, ~70 models/enums
│   │   ├── migrations/          # 32 migrations (chronological, timestamp-prefixed)
│   │   └── seed.ts              # bootstrap ROOT/ADMIN + role matrix
│   └── src/
│       ├── app.ts               # Express factory + global middleware order
│       ├── server.ts            # boot, email worker, BullMQ startup, graceful shutdown
│       ├── routes/index.ts      # mounts all 21 top-level routers under /api/v1
│       ├── middlewares/         # authenticate, authorize, validate, errorHandler, rateLimiter, requestContext
│       ├── modules/<feature>/   # <feature>.routes/controller/service/repository/validator/types.ts
│       ├── lib/                 # prisma, storage (MinIO), fileToken, queue, redis, zipStream
│       ├── workers/             # BullMQ processors + startup.ts
│       ├── config/              # env.ts (Zod), constants.ts (AUDIT_ACTIONS, ERROR_CODES, COOKIE_NAMES)
│       └── utils/               # errors.ts, apiResponse.ts, hash.ts, device.ts, asyncHandler.ts, logger.ts
├── docker-compose.yml           # postgres + minio + redis + pgadmin + server (+ optional mailserver)
├── docker-compose.production.yml / .dokploy.yml
├── deploy/nginx/, deploy/dokploy/
└── scripts/                     # maintenance-*.js, load-test.ps1, reset-db.sh, etc.
```

> `C:\Dev\URS-DMS\src\` at the repo root is a **legacy duplicate** of the early client. The real
> frontend is `client/src`. Do not edit root `src/` unless explicitly asked.

---

## 4. Architecture Diagram

```
Browser (client/src)
  │ fetch /api/v1/*  — Bearer access token + httpOnly urs_refresh_token cookie (path /api/v1/auth)
  ▼
app.ts: helmet → cors(CLIENT_URL allowlist, credentials) → cookieParser → json(1mb)
        → morgan → requestContext(ip/ua/origin ALS) → globalLimiter(100/15min)
  ▼
routes/index.ts  (/api/v1)
  ▼
middleware per route: authenticate → authorize(requireRole/requirePermission) → validate(Zod)
  ▼
controller (thin)  →  service (business logic + ownership/RBAC re-checks)
  ▼
repository (Prisma)  →  PostgreSQL 16
  │
  ├─ audit.service.writeAudit()  →  audit_logs          (single funnel)
  ├─ lib/storage (MinIO) via signed file tokens         (files.routes.ts streams bytes)
  └─ lib/queue (BullMQ/Redis)  →  workers/*.worker.ts
```

**Error path:** service throws `ApiError` subclasses → `asyncHandler` → Express `next(err)` →
`errorHandler.ts` → JSON `{ success:false, error:{ code, message, details } }`. Prisma P2002→409,
P2025→404, connectivity→503, unknown→500. **No audit writes in the error handler.**

---

## 5. Frontend Architecture

- **Routing:** one `<BrowserRouter>` in `App.tsx`. `AppContent` (admin) and `UserAppContent` (user)
  are full-page shells; `activePage` is a state value synced from `location.pathname` and persisted
  in `localStorage.activePage`. Root pages are lazy-loaded.
- **Auth state:** `AuthContext` wraps `authService` (singleton class with subscribe/emit).
  `authStatus: INITIALIZING | AUTHENTICATED | UNAUTHENTICATED`. `authService.init()` calls `GET /auth/me`
  when a token exists in `localStorage` (`urs_dms_server_token`).
- **API client:** `client/src/lib/http.ts`. `apiGet/apiPost/apiPatch/apiDelete/apiGetPage`.
  On 401: single-flight `POST /auth/refresh` (10s abort), retry once, else clear token and dispatch
  `urs:session-expired` **once per burst**; `AuthContext` then calls `authService.logout()`.
- **Permissions (UX only):** `lib/permissions.tsx` → `hasServerPermission(user, code)` reads the
  `user.permissions` array returned by `/auth/me`. Server is authoritative; UI hides/gates calls to
  avoid 403 noise.
- **State:** local component state + module-level caches (`userAttention.ts`, notification service).
  No Redux/Zustand/React Query. No optimistic rollback framework; toasts in `lib/toast.tsx`.
- **Key pages (verified present):**
  - User: `pages/user/UserDashboard|UserDocuments|UserRequests|UserBrowseArchive|UserAACCUPGroup|UserNotifications|UserProfile|UserSettings|MyActivity`
  - Admin: `AdminDashboard`, `DocumentRepository`, `UserManagement`, `AuditLogs`, `Settings`, `AACCUPGroupPage`, `RequestsReview`, `AdminAreaDetailPage`, `AccountSecurity`
  - Root: `pages/root/RootDashboard|RootOrganization|RootFolderBuilder|RootRequirementBuilder|RootWorkflowBuilder|RootFormBuilder|RootSetupWizard|RootConfigurations|RootMaintenance|RootRolesPermissions|RootAudit|RootUsers`
  - Public: `Login`, `Register`, `ForgotPassword`, `ResetPassword`
- **Portals:** `isAdminRole(role)` → admin shell; `isRootRole(role)` gates `/root*` routes.

---

## 6. Backend Architecture

- **Modular monolith.** Each feature in `server/src/modules/<name>/` owns
  `<name>.routes.ts → controller → service → repository → validator/types`.
- **Thin controllers** (`sendSuccess`, `sendCreated`, `sendNoContent` from `utils/apiResponse.ts`).
- **Services** own business rules, ownership checks, transactions, and audit writes.
- **Repositories** are the only Prisma data-access layer per module.
- **Validation:** Zod schemas in `*.validator.ts`; `validateBody/validateQuery/validateParams`
  middleware. Params validated on most routes; a few low-risk gaps exist (e.g. `POST /auth/sessions/:id/kill`).
- **Response envelope:** `{ success: true, data, meta? }` / `{ success: false, error: { code, message, details? } }`.
- **Rate limiting:** `globalLimiter` 100 req/15min per IP on `/api`; `authLimiter` 5 failed auth
  attempts/15min (`skip` when status < 400). Health + public registration helpers exempt from global.
- **Background jobs:** BullMQ queues (`lib/queue.ts`): `folder-copy`, `folder-zip`, `email-delivery`,
  `maintenance`, `document-thumbnail`. Started in `server.ts` → `workers/startup.ts`.
- **Maintenance:** `maintenance.service.ts` runs recycle cleanup, orphan scan/cleanup, consistency
  check; DB-backed `MaintenanceJob`/`MaintenanceOrphanCandidate`/`MaintenanceLock`.

---

## 7. Authentication Flow (actual)

```
POST /api/v1/auth/login { identifier, password }
 → authLimiter → validateBody(loginSchema)
 → auth.controller.loginHandler
 → auth.service.login()
     user lookup by email (lowercased) OR employeeId, deletedAt:null
     lockout check (lockedUntil > now → ACCOUNT_LOCKED)
     status check (must be ACTIVE)
     argon2 verifyPassword()
     on failure: increment failedAttempts; lock at MAX_FAILED_LOGIN_ATTEMPTS (env, default 5)
                 write audit auth.login.failed (unknown_user | account_locked | account_inactive | bad_password)
     on success: reset counters, lastLogin=now
     issueSession(): random sessionId + random refreshToken; store sha256(refreshToken) in sessions
                     sign HS256 access JWT {sub, roleId, roleName, sessionId, type:"access"}
     audit auth.login.success (+ root.login when role=ROOT)
 → controller sets httpOnly cookie urs_refresh_token (path=/api/v1/auth, sameSite/secure from env, 7d)
 → 200 { accessToken, refreshToken, user:{...,permissions[]} }
Frontend: accessToken → localStorage("urs_dms_server_token"); user state updated; navigate by role.
```

**Authenticated requests:** `authenticate.ts` extracts `Authorization: Bearer` (or `urs_access_token`
cookie), verifies JWT (HS256, issuer/audience), checks the `Session` row (not revoked, not expired),
checks `user.status === ACTIVE`, loads permission codes from DB, sets `req.auth`.

**Refresh:** `POST /auth/refresh` (public; cookie or body token) → hash lookup in `sessions` →
reuse detection (revoked >60s ago ⇒ revoke ALL user sessions + `auth.refresh.reuse_detected`) →
rotate (revoke old, create new) → new access + refresh cookie. A 60s "rotation grace" treats a
recently-revoked token as a concurrent-refresh race and mints a new session instead of nuking all.

**Logout:** `POST /auth/logout` (public, idempotent) → revoke session(s) by refresh hash; if a user
resolves, write `auth.logout` (+ `root.logout` for ROOT). Client clears token.

**Browser restart:** session persists (localStorage access token + 7d refresh cookie) until refresh
expiry/revocation. `init()` re-validates via `/auth/me`.

**Password reset:** `POST /auth/forgot-password` → 20-min single-use token (SHA-256 hash stored only)
emailed; `POST /auth/reset-password` → argon2 re-hash, consume tokens, revoke ALL sessions, audit
`auth.password_reset.completed` (category SECURITY). Dev-only `GET /auth/dev/reset-link` gated by
`NODE_ENV === "development"`.

---

## 8. Authorization / RBAC Flow (actual)

```
USER → Role (RoleName enum, 1 role per user)
     → RolePermission (m2m) → Permission.code (string catalog)
     → route middleware requirePermission(code) / requireAnyPermission(codes) / requireRole(RoleName)
     → service re-asserts ownership/permission (defence in depth)
     → resource/action
```

- **Roles:** `ROOT`, `ADMINISTRATOR`, `QUALITY_ASSURANCE_OFFICER`, `DEPARTMENT_COORDINATOR`, `FACULTY`,
  `STAFF`, `READ_ONLY`. Matrix lives in `server/src/modules/roles/roles.constants.ts`
  (seed source of truth). ROOT binds every code; ADMINISTRATOR binds all except `ROOT_ONLY_CODES`
  (`root.*`, `organization.*`, folder/requirement/workflow/form builders, `setup.*`,
  `repository.emergency_access`).
- **Enforcement points (all three layers exist):**
  1. `middlewares/authorize.ts` (route gate) — denial writes `auth.permission_denied` SECURITY/DENIED.
  2. Service re-checks (`assertCanRead/Write/Manage`, `assertRepositoryAccess`, `assertCanAssignRole`).
  3. Ownership checks: repository/folder/document access is owner-first; cross-user access writes
     `auth.access_denied` SECURITY/DENIED and returns 404 (existence hidden).
- **Privilege-escalation guard:** `modules/admin/_shared/admin.guard.ts::assertCanAssignRole` — an actor
  may only assign roles/permissions they already hold. Applied in `admin/users`, `admin/roles`, and
  (hardened) legacy `modules/users/users.service.ts`.
- **ROOT protection:** ROOT accounts cannot be archived/status-changed/password-reset via admin or
  legacy user surfaces (`assertNotRootTarget`).
- **Frontend checks are UX only** (`hasServerPermission`); every request is re-checked server-side.

**AuthN vs AuthZ are separate:** login success is AUTHENTICATION; resource denial is SECURITY/DENIED.
No code writes a login event for an authorization failure.

---

## 9. Audit Architecture (single funnel)

**Writer:** `modules/audit/audit.service.ts::writeAudit(entry)` — the ONLY audit insert path
(except transactional `tx.auditLog.create` inside `workflow.engine.ts`, which mirrors the same shape).
It sanitizes secrets, derives category/severity/result when not supplied, stamps the request/job
`correlationId` (from `getRequestId()` when the caller does not pass one), writes `audit_logs`, and
notifies ROOT on CRITICAL severity. Errors are swallowed and logged (`[audit] failed to write audit log`).
`writeAuditInTransaction(tx, entry)` shares the same builder but writes through the caller's
transaction client (commits/rolls back with the business operation; propagates write errors; no
pre-commit CRITICAL notification). Request delivery (`request.fulfilled.delivered`) uses it.

**Correlation:** `middlewares/requestContext.ts` assigns every request a stable id (honoring a safe
inbound `X-Request-Id`/`X-Correlation-Id`, else `randomUUID()`), stores it in AsyncLocalStorage,
exposes `getRequestId()`, and echoes it as the `X-Request-Id` response header. Worker processors are
wrapped by `workers/startup.ts` with `runWithRequestId("job:<queue>:<id>")`, so background audit
events carry one stable id per job. `AuditLog.correlationId` has no uniqueness constraint (multiple
events legitimately share one id).

**Category / severity / result derivation (fixed):**
- `auth.permission_denied`, `auth.access_denied`, `auth.password*`, `auth.refresh.reuse_detected` → `SECURITY`
- other `auth.*` → `AUTHENTICATION`; `aaccup*`/`submission` → `SUBMISSION`; `request*` → `REQUEST`;
  `user.role*`/`role*` → `ACCESS_CONTROL`; `document*`/`folder*`/`repository*`/`recycle*` → `REPOSITORY`; else `SYSTEM`
- `result`: denials → `DENIED`; any action matching `isFailedAuditAction` (`*.failed` **or** `*_failed`,
  e.g. `document.upload_failed`) plus the explicit legacy list (`auth.refresh.reuse_detected`) → `FAILED`; else `SUCCESS`
- `severity`: failure/denial actions → `WARNING`; permission updates/root actions/audit clear → `CRITICAL`; else `INFO`
- The shared predicate lives in `config/constants.ts::isFailedAuditAction`; the audit list, reports
  rows, and report summary all classify with the same rule (legacy rows whose `result` was defaulted
  to SUCCESS are classified from the action name so denials stay `DENIED`, never `FAILED`).

**Who writes what:**
| Layer | Events |
|---|---|
| `auth.service.ts` | login success/failed, refresh success/failed/reuse, logout, password changed, session revoked, root login/logout |
| `authorize.ts` | permission_denied (route gate) |
| documents/folders/repositories services | document/folder CRUD, download/preview, version added (on verify only), upload failed, access denied, emergency access used |
| requests/aaccup services | request created/approved/rejected/fulfilled/cancelled; submission created/reviewed/archived/restored; area/requirement/task CRUD |
| workflow engine | workflow_instance.started/transitioned/completed/overridden (transactional) |
| admin/root services | user/role/college/department/settings/organization/config/folder/requirement/workflow/form lifecycle |
| audit service itself | audit cleared/purged/archive created/downloaded/retention changed/exported/reviewed |
| maintenance/email/notifications | maintenance lifecycle, email sent/failed (terminal only), notification marked read/created |
| workers | folder copy completion, maintenance runs |

**Classification rules that must hold:**
- One authoritative server-side result per operation. `document.version_added` is written ONLY by
  `verifyUpload` (success) or `document.upload_failed` by `recordUploadFailure` — never by `addVersion`.
- Root lifecycle events are written exactly once by `auth.service` (no polling watcher; deleted).
- `status=FAILED` filter maps to `result=FAILED`; `DENIED` is separate.
- Historical rows are never rewritten or deleted by code.

**Audit endpoints:** `GET /audit` (`audit.read`), `GET /audit/:id`, `GET /audit/my-activity` (self,
12-month window), `GET /audit/export` (`audit.export`, writes `audit.log_exported`),
`GET /audit/login-groups` (`audit.read`), `GET /audit/summary` (`audit.read`),
`DELETE /audit` (**`requireRole("ROOT")`** — wiping the trail is root-only; the UI hides the button
for non-root), ROOT-only archive/purge/retention/review. Viewing/refreshing/searching the audit page
writes no audit events.

---

## 10. Database Architecture (PostgreSQL via Prisma)

Full model list: `server/prisma/schema.prisma`. Key groups:

**Identity/access**
- `User` — uuid PK, unique `employeeId`/`email`, argon2 `passwordHash`, `status` (ACTIVE/INACTIVE/LOCKED/SUSPENDED),
  `roleId` FK (Restrict), `departmentId`, `programId`, `mustChangePassword`, `failedAttempts`, `lockedUntil`,
  `lastLogin`, `profilePhotoKey`, `deletedAt` (soft delete). Indexed role/status/deletedAt.
- `Role` (unique `name`), `Permission` (unique `code`, `module`), `RolePermission` (composite PK, cascade).
- `Session` — uuid PK, unique `refreshTokenHash`, `userId` (Cascade), ip/device/browser, `expiresAt`, `revokedAt`.
- `PasswordResetToken` (unique `tokenHash`, `expiresAt`, `usedAt`), `RegistrationInvite` (same pattern).

**Audit**
- `AuditLog` — uuid PK, nullable `userId` FK (SetNull), `action`, `category`, `severity`, `result`,
  `entity`/`entityId`, `oldValue`/`newValue` (Json), ip/UA, actor fields, `targetType/Id/Name`,
  `correlationId`, `metadata`, `createdAt`. Indexed userId/action/createdAt/category/severity/result/target.
- `AuditArchive`, `AuditReview` (unique `auditLogId`).

**Repository**
- `Folder` — self-relation `parentId` (**Cascade**), `repositoryId` (SetNull), `departmentId`, `ownerId`,
  color/icon, `deletedAt`. Max depth enforced in service (5; destination depth >= 5 rejected).
- `FolderShare` — unique (folderId,userId) and (folderId,departmentId), `permission` READ/WRITE/OWNER.
- `Document` — uuid PK, `title`, `status` (DRAFT/UNDER_REVIEW/APPROVED/PUBLISHED/ARCHIVED),
  `classification`, `retentionUntil`, `metadata` Json, `ownerId` (Restrict), folder/department/repository,
  unique `currentVersionId` FK (SetNull), `deletedAt`.
- `DocumentVersion` — unique (documentId, versionNumber), `objectKey`, filename/mime/size/checksum,
  `uploadedById` (Restrict). `DocumentTag`, `DocumentShare` (unique documentId+userId, optional `expiresAt`).
- `Repository` (unique `ownerId`, Cascade), `RepositoryFavorite`/`Recent`/`Pin`, `EmergencyAccess`
  (adminId/ownerId, `reason`, `grantedBy`, `expiresAt`, `revokedAt`).
- `RepositoryCopyJob` — PENDING/RUNNING/COMPLETED/FAILED/CANCELLED, `totalItems`/`processedItems`,
  `conflictMode`, `resultFolderId`.

**Requests/AACCUP**
- `DocumentRequest` — PENDING/APPROVED/REJECTED/FULFILLED, requester/decider FKs, `decisionNote`.
  `DocumentRequestItem` — multi-doc requests (unique requestId+documentId, Cascade).
- `AaccupArea` (unique `code`, `areaSet` AACCUP/ISO/CERT, `departmentId` Restrict, `accreditationCycleId`).
- `AaccupRequirement` — unique (areaId, documentCode) and (areaId, sourceNodeId), `isRequired`, `status`.
- `AaccupSubmission` — PENDING/APPROVED/REJECTED/NEEDS_REVISION, document (Restrict), submittedBy/reviewedBy,
  optional task, immutable `snapshotFilename/Mime/Size/Checksum`, `isCurrent` pointer, `deletedAt`.
- `AaccupTask` — OPEN/IN_PROGRESS/COMPLETED/CANCELLED, priority, dueDate, assigneeType USER/DEPARTMENT,
  `assigneeLabel` denormalized, optional requirement/template, `deletedAt`.

**Platform/config builders (ROOT)** — `Configuration*`, `OrganizationVersion`, `FolderTemplate/Node/Assignment/Version/History`,
`RequirementTemplate/Node/Validation/Assignment/Version/History`, `AccreditationCycle`, `WorkflowDefinition/Step/Transition/Assignment/Version/History/Instance/StepInstance/Action`,
`FormTemplate/Field/Assignment/Version/History`, `SetupState`, `Campus`/`College`/`Department`/`Office`/`Program`, `SystemSetting`.

**Notifications/email/maintenance** — `Notification` (per-user inbox, `readAt`, soft delete),
`EmailMessage` (PENDING/SENDING/SENT/FAILED, attempts, nextAttemptAt), `MaintenanceJob/OrphanCandidate/Lock`.

**Conventions:** UUID PKs, `createdAt`/`updatedAt`, `deletedAt` soft-delete on business entities,
explicit `@@index`, `@@map` snake_case table names, FK actions deliberate (Restrict for authored
records, Cascade for child/share/session rows, SetNull for nullable references).

---

## 11. Repository / File Storage Architecture

**Object keys:** `documents/<documentId>/v<versionNumber>/<sanitized-filename>`
(`[^A-Za-z0-9._-]+ → _`), profile photos `profile-photos/<userId>/photo`, thumbnails
`<objectKey>.thumbnail.webp`.

**Upload pipeline (client → server → MinIO):**
```
1. POST /documents (or /documents/:id/version) → create row → presignUpload() returns
   { url: /api/v1/files/upload?token=<signed JWT>, objectKey, headers }
2. Browser PUTs raw bytes to that URL (token = authorization, 15-min TTL, bound to one object key)
3. POST /documents/:id/versions/:versionId/verify → verifyUpload()
     statObject size check + streamed SHA-256 vs declared checksum
     mismatch → delete version row (+ clear currentVersionId if set) + document.upload_failed
     match    → set currentVersionId + document.version_added + notification + thumbnail job
```
**Download/preview:** `GET /documents/:id/download|preview` authorizes (owner/share/folder/manage),
mints 10-min download token; `files.routes.ts` streams from MinIO with `nosniff`. Inline rendering is
allowed only for a safe MIME allowlist (pdf/images/video/audio/text/csv); everything else is forced
to attachment/octet-stream. Upload strips active-content types (html/svg/xml/js) to octet-stream.

**Folder operations:** create/rename/move (cycle + depth guards), soft delete, recycle bin
(owner-scoped), restore (conflict modes keep_both/replace/cancel), permanent delete, recursive copy
(sync under 1,000 items, otherwise persisted `RepositoryCopyJob` + BullMQ), streaming ZIP
(`lib/zipStream.ts`, entry names sanitized).

**Consistency model:** DB row is created before bytes upload; `verifyUpload` reconciles
size/checksum and rolls back the version row on mismatch. Orphan objects are found by maintenance
scan (`MaintenanceOrphanCandidate`, grace period) and removed by `runOrphanCleanup`. Object deletes
are best-effort; a failed MinIO delete leaves an orphan candidate, not a broken DB row.
Recycle-bin cleanup removes rows after retention and then objects.

---

## 12. Submission / Request / AACCUP Architecture

**AACCUP submission lifecycle**
```
POST /aaccup/submissions (aaccup.submission.create)
  → requirement ACTIVE + area context
  → document must exist, not deleted, OWNED by actor (or actor is aaccup.manage)
  → department must match area department (if document has one)
  → dynamic requirement validation (filename/mime/size/pages/expiration)
  → optional task validation (same area, open, matching requirement)
  → transaction: create submission (PENDING, isCurrent=true, snapshot fields),
                ensure area archive folder, move document into archive folder,
                demote previous current submissions
  → audit aaccup_submission.created + notify reviewers
POST /aaccup/submissions/:id/review (aaccup.submission.review)
  → PENDING or NEEDS_REVISION only (APPROVED/REJECTED closed)
  → transaction: status=APPROVED|REJECTED|NEEDS_REVISION, reviewedBy/At,
                 APPROVED promotes isCurrent and demotes siblings
  → audit aaccup_submission.reviewed + notify submitter
```
**Request lifecycle**
```
POST /requests (request.create) → PENDING (+ items, up to 3 docs)
POST /requests/:id/approve (request.manage) → PENDING → APPROVED, delivers copies to requester
POST /requests/:id/reject  (request.manage) → PENDING → REJECTED (decisionNote required)
POST /requests/:id/fulfill (request.manage) → APPROVED → FULFILLED
POST /requests/:id/cancel  (request.create, owner) → PENDING → CANCELLED
```
All decisions pass through the workflow gate when a published workflow is bound
(`evaluateWorkflowAction` + `recordWorkflowAction`), and each writes exactly one audit event.

**Workflow engine** (`modules/workflow/workflow.engine.ts`): resolves an assignment by scope
(document folder/department, request department, submission requirement), binds a
`WorkflowInstance` at entity creation, validates transitions/roles at action time, records
`WorkflowAction` + audit in the same transaction. No assignment ⇒ legacy behavior unchanged.

**Task lifecycle:** create/update/archive/restore (`aaccup.manage`); assignee may advance their own
task status (`PATCH /aaccup/tasks/:id` is the one route without a route-level permission — the
service authorizes manager-or-assignee).

---

## 13. Infrastructure

`docker-compose.yml` services:

| Service | Image | Ports | Notes |
|---|---|---|---|
| postgres | postgres:16-alpine | 5432 | volume `urs-postgres-data`, init.sql, healthcheck |
| minio | minio/minio:latest | 9000 (S3), 9001 (console) | volume `urs-minio-data` |
| redis | redis:7-alpine | `${REDIS_PORT:-6380}`→6379 | appendonly, `maxmemory-policy noeviction` |
| pgadmin | dpage/pgadmin4 | 5050 | optional |
| server | build `./server` (GHCR image) | 4000 | env from `.env`; overrides DB/MinIO/Redis hostnames; NODE_ENV=production |
| mailserver | docker-mailserver | 25/587/993 | profile `mail` only |

Compose network `urs-net` (bridge). Server waits on healthy postgres/minio/redis. Volumes persist
across `docker compose down`. Production variants: `docker-compose.production.yml`,
`docker-compose.dokploy.yml`; reverse proxy config in `deploy/nginx/`.

**Local run:** `docker compose up -d` (infra) then `npm run dev:server` (tsx watch :4000) and
`npm run dev:client` (Vite :5173, proxying `/api`). Env keys are validated at boot by
`server/src/config/env.ts` (Zod, fail-fast).

---

## 14. Important Files

| Area | Path | Purpose |
|---|---|---|
| App bootstrap | `server/src/app.ts`, `server/src/server.ts` | middleware order; boot/workers/shutdown |
| Route registry | `server/src/routes/index.ts` | mounts 21 routers under `/api/v1` |
| Auth middleware | `server/src/middlewares/authenticate.ts` | JWT + session + status + permissions |
| AuthZ middleware | `server/src/middlewares/authorize.ts` | role/permission gates + denial audit |
| Error handler | `server/src/middlewares/errorHandler.ts` | centralized error → HTTP mapping |
| Request context | `server/src/middlewares/requestContext.ts` | ip/ua/origin ALS + stable request id (`req.id`, `X-Request-Id`, `getRequestId`, `runWithRequestId`) |
| Env | `server/src/config/env.ts` | Zod-validated config (fail-fast) |
| Constants | `server/src/config/constants.ts` | `AUDIT_ACTIONS`, `ERROR_CODES`, `COOKIE_NAMES` |
| Auth service | `server/src/modules/auth/auth.service.ts` | login/refresh/logout/password/session logic + audit |
| Tokens | `server/src/modules/auth/auth.tokens.ts`, `auth.cookies.ts` | HS256 JWT sign/verify; refresh cookie |
| RBAC matrix | `server/src/modules/roles/roles.constants.ts` | default role → permission bindings |
| Escalation guard | `server/src/modules/admin/_shared/admin.guard.ts` | cannot grant permissions you lack |
| Audit funnel | `server/src/modules/audit/audit.service.ts` | `writeAudit`, classification, archive/purge/review |
| Audit repo/types | `server/src/modules/audit/audit.repository.ts`, `audit.types.ts` | list/detail/export mapping |
| Documents | `server/src/modules/documents/documents.service.ts` | CRUD, versions, upload verify, URLs |
| Folders | `server/src/modules/folders/folders.service.ts` + `folderSharing.service.ts` | tree, recycle, copy, shares |
| Repository | `server/src/modules/repositories/repository.service.ts` | ownership + emergency access |
| Storage adapter | `server/src/lib/storage.ts` | MinIO put/stat/stream/delete, presign via file tokens |
| File tokens | `server/src/lib/fileToken.ts` | short-lived upload/download JWT |
| File routes | `server/src/modules/files/files.routes.ts` | stream in/out, MIME safety |
| ZIP | `server/src/lib/zipStream.ts` | streaming ZIP, sanitized entry names |
| Queue | `server/src/lib/queue.ts`, `server/src/workers/*` | BullMQ queues/workers |
| Requests | `server/src/modules/requests/requests.service.ts` | state machine + delivery |
| AACCUP submissions | `server/src/modules/aaccup/submissions/aaccup.submissions.service.ts` | submit/review/export |
| Workflow engine | `server/src/modules/workflow/workflow.engine.ts` | bind/evaluate/record/override |
| Schema | `server/prisma/schema.prisma` | all models/enums |
| Seed | `server/prisma/seed.ts` | bootstrap ROOT/ADMIN + matrix |
| Frontend routes | `client/src/App.tsx` | all routes + portal shells |
| Frontend HTTP | `client/src/lib/http.ts` | envelope client + refresh single-flight |
| Auth context | `client/src/context/AuthContext.tsx`, `client/src/services/auth.ts` | session state + login/logout |
| Permissions (UX) | `client/src/lib/permissions.tsx` | `hasServerPermission`, role helpers |
| Attention cache | `client/src/lib/userAttention.ts` | dashboard badge data (permission-aware) |

---

## 15. Critical Business Rules

1. **Ownership-first repository.** Personal folders/documents are visible only to the owner (or an
   active ROOT emergency grant). Cross-user access returns 404 and writes `auth.access_denied`.
2. **Document upload is two-phase.** A version is not "current" until `verifyUpload` confirms size
   and SHA-256; only then is `document.version_added` audited and the document readable.
3. **Submission evidence is immutable.** Snapshot filename/mime/size/checksum captured at submit time.
4. **Exactly one `isCurrent` submission per requirement**; only APPROVED reviews promote it.
5. **Request decisions are a strict state machine** (PENDING→APPROVED/REJECTED; APPROVED→FULFILLED;
   PENDING→CANCELLED by requester). Reject requires a reason.
6. **Folder depth max 5** (destination depth >= 5 rejected). Folder moves cannot create cycles.
7. **Role assignment cannot exceed the actor's own permission set** (escalation guard), and ROOT
   accounts are untouchable from admin/legacy user surfaces.
8. **Audit is append-only from the app's perspective.** `writeAudit` is the single writer; one
   authoritative event per operation; no UI filtering is used to hide duplicates.
9. **AuthN ≠ AuthZ.** Login events and access-denied events are separate actions/categories.
10. **Frontend permission checks are UX only.** Every backend route re-checks.
11. **Secrets never reach the client or audit rows.** Passwords/tokens are redacted by
    `sanitizeForAudit`; `/auth/me` returns no hashes/tokens.
12. **Soft delete is the default** for users/documents/folders/submissions/tasks; permanent delete is
    explicit and audited.

---

## 16. Known Architectural Risks

| Severity | Risk | Evidence / Notes |
|---|---|---|
| HIGH | Two parallel user-admin surfaces (`/users` legacy CRUD + `/admin/users`) | Both mounted; legacy now guarded but duplicated logic remains |
| HIGH | Runtime verification not automated in CI | 5 Vitest suites need a live PostgreSQL; no CI DB service found |
| MEDIUM | Refresh-rotation 60s grace lets a revoked refresh token mint a session | `auth.service.ts` `REFRESH_ROTATION_GRACE_MS`; cannot distinguish rotation from logout/kill revocation |
| MEDIUM | No upload size cap | `assertUploadPolicy` ignores size; storage-exhaustion DoS by any `documents.create` holder |
| MEDIUM | Email delivery has two concurrent paths (BullMQ + in-process) | Claim is atomic now; in-process worker still runs alongside |
| MEDIUM | `dev/reset-link` gated only by `NODE_ENV !== "development"` | Env default is development; deployment hygiene risk |
| MEDIUM | Stale production container crash-loops on boot | `urs-server` (GHCR v1.3) entrypoint runs `prisma migrate deploy`; its older migration name `20250731000000_sprint5_aaccup_areas` is recorded failed in `_prisma_migrations` (repo's 37 migrations are all applied). Rebuild from current code, or `prisma migrate resolve --rolled-back` the phantom row before deploying. |
| MEDIUM | Frontend request volume | Notification poll every 3s; dashboards poll 30s; no request dedupe layer |
| LOW | Legacy rows created before the `result` column exist | Migration defaulted them to SUCCESS with no backfill; read paths classify them by action name (data intentionally not rewritten) |
| LOW | `GET /users/:id` exposes `profilePhotoKey` to all `users.read` holders | All roles hold `users.read` |
| LOW | Health endpoint discloses env/bucket/queue/memory | Public `GET /api/v1/health` |
| LOW | Legacy `src/` at repo root can confuse tooling | Real client is `client/src` |
| LOW | Root `auth` module documented as "frozen" but now writes ROOT lifecycle audit | Comment drift in `constants.ts` was updated; verify before further auth edits |

---

## 17. Known Bugs

**Fixed (verified by typecheck/build; runtime re-test pending a live DB):**
- CRITICAL: legacy `/users` privilege escalation / ROOT takeover — guards added.
- HIGH: stored XSS via upload Content-Type + inline preview — MIME allowlist/denylist + nosniff.
- HIGH: AACCUP cross-user document attach/takeover — owner-or-manager only.
- HIGH: duplicate email delivery/audit — atomic `FOR UPDATE SKIP LOCKED` claim.
- HIGH: audit "LOGIN SUCCESS + LOGIN DENIED" confusion — permission-gated dashboards, stale root-page
  guard, single session-expired dispatch, root watcher removed.
- HIGH: duplicate `document.version_added` — only `verifyUpload` audits success.
- HIGH: root `root.login` spam / missing `root.logout` — emitted once in auth service.
- MEDIUM: unverified version served as current — prefer `currentVersionId`.
- MEDIUM: shared-document move without destination folder access — EDITOR check added.
- MEDIUM: DENIED conflated with FAILED in audit status filter/classification — fixed.
- MEDIUM: duplicate login submits, swallowed lockout errors — loading guard + error mapping.
- LOW: HTML/CSV injection in audit export; emergency-use mislabeled as grant; unaudited export;
  ungated `/audit/summary`.
- **Audit accuracy hardening (2026-09-13):** `*.failed`/`*_failed` actions outside the auth list
  (document.upload_failed, email.failed, maintenance.*.failed, auth.password_reset.failed) were
  classified result=SUCCESS/severity=INFO — now FAILED/WARNING via `isFailedAuditAction`; report
  row status and summary counts are result-aware with a legacy-action fallback; request/job
  correlation ids implemented; `DELETE /audit` now ROOT-only (+ UI hidden for non-root); `requireRole`
  denial audit awaited; frontend double-submit in-flight guard added.
- **Runtime verification (2026-09-13):** `listRepositories()` called the async
  `assertRepositoryAccess()` **without `await`** — the ownership denial rejected as an unhandled
  promise while the request returned 200 with another user's repository list (IDOR) and the audit
  row claimed DENIED. Fixed with `await`; verified 404 + DENIED/SECURITY + matching correlationId.
  All 16 runtime acceptance scenarios pass (`server/src/scripts/audit-runtime-acceptance.ts`).
- **Audit integrity hardening (2026-09-13):** service-level ownership/permission denial audits
  (documents/folders/repositories asserts) are now awaited, so the DENIED row is persisted before the
  error response (no timing race); `request.fulfilled.delivered` is written through the approval
  transaction via `writeAuditInTransaction`, so it rolls back with the business operation. Tests:
  `audit-denial-timing.test.ts`, `audit-transactional.test.ts`.

**Open / by design:**
- 60s refresh grace (see risks).
- No upload cap.
- AACCUP submission/task detail readable by any `aaccup.*.read` holder (documented transparency).
- Self-registration via invitation request; role is derived server-side (program → FACULTY,
  office → STAFF, default FACULTY) — client cannot choose an arbitrary role.
- Double `GET /users/me/profile-photo` on the profile page (TopNav + page).

---

## 18. Testing Entry Points

| Command | Scope |
|---|---|
| `npm run typecheck:server` / `typecheck:client` | tsc `--noEmit` |
| `npm run build:server` / `build:client` | production builds |
| `npm run lint:server` / `lint:client` | ESLint (both currently fail on pre-existing unrelated files) |
| `npm --workspace server run test` | Vitest all suites (**needs PostgreSQL**) |
| `npx vitest run src/__tests__/navigationAssistant*.test.ts src/__tests__/aaccup-export.test.ts src/__tests__/audit-classification.test.ts` | pure suites (no DB) |
| `npx tsx --env-file=../.env src/scripts/audit-runtime-acceptance.ts --confirm` | 16-scenario audit runtime acceptance (needs running server + DB/MinIO; creates & cleans temporary `rt.audit.*` data) |
| `npm run prisma:generate` / `prisma:deploy` / `prisma:seed` | Prisma lifecycle |
| `docker compose up -d` | local Postgres/MinIO/Redis |

DB-dependent suites: `audit.test.ts`, `rbac.test.ts`, `repository.test.ts` (+ helpers in `__tests__/helpers.ts`).

---

## 19. DO NOT BREAK Rules

**Project preservation**
1. Preserve the BLUEPRINT visual identity (navy/primary `#1239B5`/`#2563EB`, existing layouts). No purple themes.
2. Do not redesign working pages or replace the stack.
3. Do not add mock/fake data, seed/demo audit logs, or fake analytics.
4. Do not reset the database or delete real user data without explicit approval.
5. Make the smallest safe change that fixes the root cause; do not rewrite unrelated modules.

**Security & data**
6. Never weaken RBAC or move a server-side check to the frontend only.
7. Never expose secrets/tokens/passwords (client responses, logs, audit rows).
8. Never rewrite or silently delete historical audit records; never hide duplicates via UI filtering.
9. Never introduce duplicate audit generation: one authoritative event per operation via `writeAudit`.
10. Keep AuthN and AuthZ separate: denials are `SECURITY`/`DENIED`, never login failures.
11. Preserve ownership semantics: cross-user access returns 404 + `auth.access_denied`.
12. Preserve the two-phase upload contract (row → bytes → verify) and checksum/size rollback.
13. Preserve immutable submission snapshots and the single-`isCurrent` invariant.
14. Preserve FK `onDelete` behavior and soft-delete columns; schema changes require a migration.
15. Do not claim a fix without verification (typecheck/build + focused test; runtime when DB available).

**Workflow**
16. Follow the token-efficient loop: read this reference → target module → reproduce → trace → fix →
    focused tests → regression → update this reference only if architecture changed.
17. If code contradicts this reference, **trust the code** and update the reference.
18. `client/src` is the real frontend; root `src/` is legacy — do not edit it for feature work.

---

## 20. Token-Efficient Future Workflow

1. Read this file.
2. Locate the module in section 14 (Important Files).
3. Open only the relevant routes/controller/service/repository + shared middleware.
4. Reproduce the issue (API call, test, or code trace).
5. Trace the execution path; identify the first incorrect behavior.
6. Fix the root cause (respect section 19).
7. Run `npm run typecheck:server`/`typecheck:client` and the focused Vitest suite; build if shared code changed.
8. If a live DB is available, run the acceptance scenario; otherwise state that runtime verification is pending.
9. Update this reference only when architecture/behavior changed.
10. Report: what changed, why, files touched, verification performed, residual risk.
