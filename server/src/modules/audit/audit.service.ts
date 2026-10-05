import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { AuditAction } from "@/config/constants";
import { AUDIT_ACTIONS, isFailedAuditAction } from "@/config/constants";
import { getRequestId } from "@/middlewares/requestContext";
import * as repo from "@/modules/audit/audit.repository";
import { FAILED_AUDIT_ACTIONS } from "@/modules/audit/audit.repository";
import type {
  AuditLogDetail,
  AuditLogListItem,
  AuditListResult,
  AuditCategory,
  AuditSeverity,
  AuditResult,
  AuditArchiveRecord,
  AuditReviewView,
  AuditSummary,
  LoginGroup,
  AuditPreset,
} from "@/modules/audit/audit.types";
import type {
  ExportAuditQuery,
  ListAuditQuery,
  ArchiveAuditQuery,
  PurgeAuditQuery,
  MyActivityQuery,
  LoginGroupsQuery as LoginGroupsQuerySchema,
} from "@/modules/audit/audit.validator";
import { NotFoundError, BadRequestError } from "@/utils/errors";
import * as crypto from "node:crypto";

// =============================================================================
// URS-DMS — enhanced audit write helper (Sprint 8.8A)
// =============================================================================

export interface AuditWrite {
  action: AuditAction;
  userId?: string | null;
  entity?: string;
  entityId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  userAgent?: string;
  category?: AuditCategory;
  severity?: AuditSeverity;
  result?: AuditResult;
  actorName?: string;
  actorRole?: string;
  actorOrganization?: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Shared audit-row builder. Used by both the global writer and the
 * transaction-aware writer so classification, sanitization and correlation
 * behave identically on either path.
 */
function buildAuditData(entry: AuditWrite): Prisma.AuditLogUncheckedCreateInput {
  const sanitizedNew = sanitizeForAudit(entry.newValue);
  const sanitizedOld = sanitizeForAudit(entry.oldValue);
  const sanitizedMeta = sanitizeForAudit(entry.metadata);

  return {
    action: entry.action,
    userId: entry.userId ?? null,
    entity: entry.entity ?? null,
    entityId: entry.entityId ?? null,
    oldValue: (sanitizedOld as Prisma.InputJsonValue | null) ?? undefined,
    newValue: (sanitizedNew as Prisma.InputJsonValue | null) ?? undefined,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    category: entry.category ?? deriveCategory(entry.action),
    severity: entry.severity ?? deriveSeverity(entry.action),
    result: entry.result ?? deriveResult(entry.action),
    actorName: entry.actorName ?? null,
    actorRole: entry.actorRole ?? null,
    actorOrganization: entry.actorOrganization ?? null,
    targetType: entry.targetType ?? entry.entity ?? null,
    targetId: entry.targetId ?? entry.entityId ?? null,
    targetName: entry.targetName ?? null,
    correlationId: entry.correlationId ?? getRequestId() ?? null,
    metadata: (sanitizedMeta as Prisma.InputJsonValue | null) ?? undefined,
  };
}

export async function writeAudit(entry: AuditWrite): Promise<void> {
  try {
    const data = buildAuditData(entry);

    await prisma.auditLog.create({ data });

    // Notify ROOT users on CRITICAL events
    if (data.severity === "CRITICAL") {
      void notifyRootOnCritical(entry).catch((err) => {
        console.error("[audit] failed to notify ROOT on critical event", err);
      });
    }
  } catch (err) {
    console.error("[audit] failed to write audit log", {
      action: entry.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Transaction-aware audit writer. The row is inserted through the caller's
 * transaction client, so it commits with the business operation and rolls
 * back with it — no orphaned SUCCESS event if the transaction aborts.
 *
 * Deliberately does NOT fire the CRITICAL ROOT notification: that side effect
 * must only happen after a successful commit. Callers needing it for a
 * CRITICAL event should notify after their transaction resolves.
 *
 * Unlike `writeAudit` (best-effort, swallows errors), this variant propagates
 * a write failure so the enclosing transaction fails as a unit.
 */
export async function writeAuditInTransaction(
  tx: Prisma.TransactionClient,
  entry: AuditWrite,
): Promise<void> {
  await tx.auditLog.create({ data: buildAuditData(entry) });
}

async function notifyRootOnCritical(entry: AuditWrite): Promise<void> {
  const roots = await prisma.user.findMany({
    where: { role: { name: "ROOT" }, status: "ACTIVE", deletedAt: null },
    select: { id: true },
  });
  if (roots.length === 0) return;

  const title = `Critical Audit: ${entry.action}`;
  const message = entry.newValue
    ? `Details: ${JSON.stringify(entry.newValue).slice(0, 400)}`
    : "A critical administrative audit event occurred.";

  await prisma.notification.createMany({
    data: roots.map((r) => ({
      userId: r.id,
      type: "AACCUP_SUBMISSION_PENDING_REVIEW", // reused type for visibility
      title,
      message,
      priority: "HIGH",
      readAt: null,
      entity: "audit_log",
      entityId: entry.userId ?? undefined,
    })),
  });
}

// =============================================================================
// Secret redaction / sanitization
// =============================================================================

const SENSITIVE_KEYS = new Set([
  "password", "passwordhash", "newpassword", "oldpassword",
  "currentpassword", "password_hash", "hashedpassword",
  "token", "accesstoken", "refreshtoken", "resettoken",
  "resettokenhash", "jti", "jwt", "secret", "authorization",
  "apikey", "api_key", "cookie", "setcookie", "credentials",
  "presignedurl", "presigned_url", "minio", "accesskey",
  "secretkey", "sessionkey", "privatekey", "signature",
]);

const MASK = "***";

function isJwtLike(s: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s);
}

function isUrlWithToken(s: string): boolean {
  return /^https?:\/\/.+(?:token|key|secret|signature|credential)=/.test(s);
}

export function sanitizeForAudit(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map(sanitizeForAudit);
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = MASK;
      } else {
        out[k] = sanitizeForAudit(v);
      }
    }
    return out;
  }
  if (typeof input === "string") {
    if (isJwtLike(input)) return MASK;
    if (isUrlWithToken(input)) return "[REDACTED_URL]";
  }
  return input;
}

function maskUnknown(input: unknown): unknown {
  return sanitizeForAudit(input);
}

function maskDetail(detail: AuditLogDetail): AuditLogDetail {
  return {
    ...detail,
    changes: {
      oldValue: maskUnknown(detail.changes.oldValue),
      newValue: maskUnknown(detail.changes.newValue),
    },
    metadata: maskUnknown(detail.metadata),
  };
}

// =============================================================================
// Category / Severity / Result derivation from action
// =============================================================================

function deriveCategory(action: string): AuditCategory {
  // Authorization denials are SECURITY events, not authentication events — the
  // check must run before the generic `auth.` prefix so `auth.permission_denied`
  // / `auth.access_denied` never land in the "Login Activity" preset.
  if (action === AUDIT_ACTIONS.PERMISSION_DENIED
    || action === AUDIT_ACTIONS.ACCESS_DENIED
    || action.startsWith("auth.password")
    || action.startsWith("auth.refresh.reuse"))
    return "SECURITY";
  if (action.startsWith("auth.")) return "AUTHENTICATION";
  if (action.startsWith("aaccup") || action.startsWith("submission")) return "SUBMISSION";
  if (action.startsWith("request")) return "REQUEST";
  if (action.startsWith("user.role") || action.startsWith("role") || action === AUDIT_ACTIONS.PERMISSIONS_UPDATED)
    return "ACCESS_CONTROL";
  if (action.startsWith("document") || action.startsWith("folder") || action.startsWith("repository")
    || action.startsWith("recycle"))
    return "REPOSITORY";
  return "SYSTEM";
}

function deriveSeverity(action: string): AuditSeverity {
  // Every terminal failure action is a warning, regardless of which module
  // emitted it (document upload failed, email failed, maintenance failed, …).
  if (isFailedAuditAction(action)
    || action === AUDIT_ACTIONS.LOGIN_FAILED
    || action === AUDIT_ACTIONS.PERMISSION_DENIED
    || action === AUDIT_ACTIONS.PASSWORD_RESET_FAILED
    || action === AUDIT_ACTIONS.REFRESH_REUSE)
    return "WARNING";
  if (action === AUDIT_ACTIONS.PERMISSIONS_UPDATED
    || action.startsWith("root.")
    || action === AUDIT_ACTIONS.AUDIT_LOGS_CLEARED)
    return "CRITICAL";
  return "INFO";
}

function deriveResult(action: string): AuditResult {
  if (action === AUDIT_ACTIONS.PERMISSION_DENIED || action === AUDIT_ACTIONS.ACCESS_DENIED) return "DENIED";
  // `*.failed` / `*_failed` covers document.upload_failed, email.failed,
  // auth.password_reset.failed, maintenance.*.failed; the explicit list covers
  // the legacy non-failed-suffix names (e.g. auth.refresh.reuse_detected).
  if (isFailedAuditAction(action) || FAILED_AUDIT_ACTIONS.includes(action)) return "FAILED";
  return "SUCCESS";
}

// =============================================================================
// Build the Prisma where
// =============================================================================
function buildWhere(q: ListAuditQuery | ExportAuditQuery): Prisma.AuditLogWhereInput {
  const actionConstraints: Prisma.StringFilter[] = [];
  const where: Prisma.AuditLogWhereInput = {};

  if (q.entityId) where.entityId = q.entityId;
  if (q.ipAddress) where.ipAddress = { contains: q.ipAddress, mode: "insensitive" };
  if (q.entity) where.entity = { equals: q.entity, mode: "insensitive" };
  if (q.action) actionConstraints.push({ contains: q.action, mode: "insensitive" });

  const dateRange: Prisma.DateTimeFilter = {};
  if (q.from) dateRange.gte = q.from;
  if (q.to) dateRange.lte = q.to;
  if (q.from || q.to) where.createdAt = dateRange;

  if ("status" in q && q.status) {
    // "Failed" must mean FAILED results only. Authorization denials are a
    // distinct DENIED result and must not be conflated with login/operation
    // failures in the status filter.
    where.result = q.status;
  }

  if (q.module) {
    const prefix = q.module.endsWith(".") ? q.module : `${q.module}.`;
    actionConstraints.push({ startsWith: prefix, mode: "insensitive" });
  }

  if ("category" in q && q.category) where.category = q.category;
  if ("severity" in q && q.severity) where.severity = q.severity;
  if ("result" in q && q.result) where.result = q.result;
  if ("targetType" in q && q.targetType) where.targetType = q.targetType;

  if (actionConstraints.length === 1) {
    where.action = actionConstraints[0];
  } else if (actionConstraints.length > 1) {
    where.AND = actionConstraints.map((ac) => ({ action: ac }));
  }

  const userFilter: Prisma.UserWhereInput = {};
  if (q.userId) userFilter.id = q.userId;
  if (q.roleId) userFilter.roleId = q.roleId;
  if (q.departmentId) userFilter.departmentId = q.departmentId;

  if (q.q) {
    const t = q.q;
    const userSearch: Prisma.UserWhereInput = {
      OR: [
        { email: { contains: t, mode: "insensitive" } },
        { employeeId: { contains: t, mode: "insensitive" } },
        { firstName: { contains: t, mode: "insensitive" } },
        { lastName: { contains: t, mode: "insensitive" } },
      ],
    };
    if (Object.keys(userFilter).length > 0) {
      userFilter.AND = [userSearch];
    } else {
      Object.assign(userFilter, userSearch);
    }

    const auditSearch: Prisma.AuditLogWhereInput = {
      OR: [
        { action: { contains: t, mode: "insensitive" } },
        { entity: { contains: t, mode: "insensitive" } },
        { targetName: { contains: t, mode: "insensitive" } },
        { actorName: { contains: t, mode: "insensitive" } },
        { newValue: { string_contains: t } },
        { oldValue: { string_contains: t } },
      ],
    };

    where.OR = [auditSearch, { user: userFilter }];
  } else if (Object.keys(userFilter).length > 0) {
    where.user = userFilter;
  }

  return where;
}

// =============================================================================
// Build the Prisma orderBy
// =============================================================================
function buildOrderBy(
  q: Pick<ListAuditQuery, "sort">,
): Prisma.AuditLogOrderByWithRelationInput[] {
  switch (q.sort) {
    case "oldest":
      return [{ createdAt: "asc" }, { id: "asc" }];
    case "user":
      return [{ user: { lastName: "asc" } }, { createdAt: "desc" }, { id: "desc" }];
    case "action":
      return [{ action: "asc" }, { createdAt: "desc" }, { id: "desc" }];
    case "module":
      return [{ action: "asc" }, { createdAt: "desc" }, { id: "desc" }];
    case "category":
      return [{ category: "asc" }, { createdAt: "desc" }, { id: "desc" }];
    case "severity":
      return [{ severity: "asc" }, { createdAt: "desc" }, { id: "desc" }];
    case "newest":
    default:
      return [{ createdAt: "desc" }, { id: "desc" }];
  }
}

// =============================================================================
// Public service API — List / Get / Export
// =============================================================================
export async function listAudit(q: ListAuditQuery): Promise<AuditListResult> {
  const where = buildWhere(q);
  const orderBy = buildOrderBy(q);
  const { items, total } = await repo.list(where, q.page, q.pageSize, orderBy);
  return {
    items,
    meta: {
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    },
  };
}

export async function getAudit(id: string): Promise<AuditLogDetail> {
  const detail = await repo.findById(id);
  if (!detail) throw new NotFoundError("Audit log not found");
  return maskDetail(detail);
}

export async function exportAudit(
  q: ExportAuditQuery,
): Promise<{ items: AuditLogListItem[]; format: "csv" | "json" | "pdf" }> {
  if (!["csv", "json", "pdf"].includes(q.format)) {
    throw new BadRequestError("Unsupported export format");
  }
  const where = buildWhere(q);
  const orderBy = buildOrderBy(q);
  const items = await repo.findManyForExport(where, orderBy, q.maxRows);
  return { items, format: q.format as "csv" | "json" | "pdf" };
}

/** Records that an operator exported (part of) the audit trail. */
export async function logAuditExport(
  userId: string,
  format: string,
  count: number,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  await writeAudit({
    action: AUDIT_ACTIONS.AUDIT_LOG_EXPORTED as AuditAction,
    userId,
    ipAddress,
    userAgent,
    category: "SYSTEM",
    severity: "INFO",
    newValue: { format, count },
  });
}

/**
 * Admin-only destructive action. Deletes every audit row and leaves a single
 * record behind documenting who cleared the logs and how many rows were removed.
 */
export async function clearAuditLogs(
  userId: string | undefined,
  ipAddress: string,
  userAgent: string,
): Promise<number> {
  const cleared = await repo.clearAll();
  await writeAudit({
    action: AUDIT_ACTIONS.AUDIT_LOGS_CLEARED,
    userId: userId ?? null,
    newValue: { cleared },
    ipAddress,
    userAgent,
    category: "SYSTEM",
    severity: "CRITICAL",
  });
  return cleared;
}

// =============================================================================
// My Activity — scoped to the caller's userId
// =============================================================================

export async function listMyActivity(
  userId: string,
  q: MyActivityQuery,
): Promise<AuditListResult> {
  const where: Prisma.AuditLogWhereInput = { userId };
  if (q.category) where.category = q.category;
  if (q.result) where.result = q.result;
  const dateRange: Prisma.DateTimeFilter = {};
  if (q.from) dateRange.gte = q.from;
  if (q.to) dateRange.lte = q.to;
  if (q.from || q.to) where.createdAt = dateRange;

  if (q.q) {
    const t = q.q;
    where.OR = [
      { action: { contains: t, mode: "insensitive" } },
      { entity: { contains: t, mode: "insensitive" } },
      { targetName: { contains: t, mode: "insensitive" } },
    ];
  }

  const orderBy: Prisma.AuditLogOrderByWithRelationInput[] = [
    { createdAt: "desc" }, { id: "desc" },
  ];

  const { items, total } = await repo.list(where, q.page, q.pageSize, orderBy);
  return {
    items,
    meta: {
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    },
  };
}

// =============================================================================
// Archive — ROOT only
// =============================================================================

export async function archiveAudit(
  q: ArchiveAuditQuery,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<AuditArchiveRecord> {
  const count = await repo.countByDateRange(q.from, q.to);
  if (count === 0) throw new BadRequestError("No audit records found in the specified date range");

  const ids = await repo.findIdsByDateRange(q.from, q.to);
  const rows = await repo.findManyByIds(ids);

  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(rows.map((r) => r.id)));
  const checksum = hash.digest("hex");

  const archive = await repo.createArchive({
    dateRangeFrom: q.from,
    dateRangeTo: q.to,
    recordCount: count,
    checksum,
    format: "json",
    createdBy: userId,
    notes: q.notes,
  });

  await writeAudit({
    action: "audit.archive_created" as AuditAction,
    userId,
    ipAddress,
    userAgent,
    category: "SYSTEM",
    severity: "CRITICAL",
    newValue: {
      archiveId: archive.id,
      dateRange: { from: q.from, to: q.to },
      recordCount: count,
      checksum,
    },
  });

  return archive;
}

// =============================================================================
// Purge — ROOT only, with mandatory archive-first
// =============================================================================

export async function purgeAuditLogs(
  q: PurgeAuditQuery,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ archived: number; purged: number; archiveId?: string }> {
  const count = await repo.countByDateRange(q.from, q.to);
  if (count === 0) throw new BadRequestError("No audit records found in the specified date range");

  let archiveId: string | undefined;

  if (q.archiveFirst) {
    const ids = await repo.findIdsByDateRange(q.from, q.to);
    const rows = await repo.findManyByIds(ids);
    const hash = crypto.createHash("sha256");
    hash.update(JSON.stringify(rows.map((r) => r.id)));
    const checksum = hash.digest("hex");

    const archive = await repo.createArchive({
      dateRangeFrom: q.from,
      dateRangeTo: q.to,
      recordCount: count,
      checksum,
      format: "json",
      createdBy: userId,
      notes: `Purged on ${new Date().toISOString()}`,
    });
    archiveId = archive.id;
  }

  const ids = await repo.findIdsByDateRange(q.from, q.to);
  const purged = await repo.deleteByIds(ids);

  // Permanent record — this action must survive any future purge
  await writeAudit({
    action: "audit.logs_purged" as AuditAction,
    userId,
    ipAddress,
    userAgent,
    category: "SYSTEM",
    severity: "CRITICAL",
    newValue: {
      dateRange: { from: q.from, to: q.to },
      purgeCount: purged,
      archivedCount: count,
      archiveId,
    },
  });

  return { archived: count, purged, archiveId };
}

// =============================================================================
// Retention
// =============================================================================

export async function getRetentionConfig(): Promise<{ retentionYears: number }> {
  const setting = await prisma.systemSetting.findFirst();
  return { retentionYears: setting?.auditRetentionYears ?? 5 };
}

export async function setRetentionConfig(
  retentionYears: number,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const previous = await getRetentionConfig();
  await prisma.systemSetting.updateMany({
    data: { auditRetentionYears: retentionYears, updatedById: userId },
  });

  await writeAudit({
    action: "audit.retention_changed" as AuditAction,
    userId,
    ipAddress,
    userAgent,
    category: "SYSTEM",
    severity: "CRITICAL",
    oldValue: { retentionYears: previous.retentionYears },
    newValue: { retentionYears },
  });
}

// =============================================================================
// Archives listing
// =============================================================================
export async function listArchives(): Promise<AuditArchiveRecord[]> {
  return repo.listArchives();
}

// =============================================================================
// Phase 2 — Review service (ROOT only)
// =============================================================================

export async function getReview(auditLogId: string): Promise<AuditReviewView | null> {
  const row = await prisma.auditReview.findUnique({ where: { auditLogId } });
  if (!row) return null;
  let reviewerName: string | null = null;
  if (row.reviewedBy) {
    const u = await prisma.user.findUnique({ where: { id: row.reviewedBy }, select: { firstName: true, lastName: true } });
    reviewerName = u ? `${u.firstName} ${u.lastName}`.trim() : null;
  }
  return {
    id: row.id,
    auditLogId: row.auditLogId,
    status: row.status as "UNREVIEWED" | "REVIEWED" | "NEEDS_FOLLOW_UP",
    note: row.note,
    reviewedBy: row.reviewedBy,
    reviewerName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function upsertReview(
  auditLogId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
  data: { status?: string; note?: string },
): Promise<AuditReviewView> {
  const row = await prisma.auditReview.upsert({
    where: { auditLogId },
    create: {
      auditLogId,
      reviewedBy: userId,
      status: data.status ?? "REVIEWED",
      note: data.note ?? null,
    },
    update: {
      reviewedBy: userId,
      ...(data.status ? { status: data.status } : {}),
      ...(data.note !== undefined ? { note: data.note || null } : {}),
    },
  });

  let reviewerName: string | null = null;
  if (userId) {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    reviewerName = u ? `${u.firstName} ${u.lastName}`.trim() : null;
  }

  const action = data.status === "NEEDS_FOLLOW_UP"
    ? (AUDIT_ACTIONS.AUDIT_FOLLOWUP_MARKED as AuditAction)
    : (AUDIT_ACTIONS.AUDIT_EVENT_REVIEWED as AuditAction);

  await writeAudit({
    action,
    userId,
    ipAddress,
    userAgent,
    category: "SYSTEM",
    severity: "INFO",
    targetType: "audit_review",
    targetId: row.id,
    newValue: {
      auditLogId,
      status: row.status,
      hasNote: !!row.note,
    },
  });

  return {
    id: row.id,
    auditLogId: row.auditLogId,
    status: row.status as "UNREVIEWED" | "REVIEWED" | "NEEDS_FOLLOW_UP",
    note: row.note,
    reviewedBy: row.reviewedBy,
    reviewerName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// =============================================================================
// Phase 2 — My Activity 12-month enforcement
// =============================================================================
export async function listMyActivity12m(
  userId: string,
  q: MyActivityQuery,
): Promise<AuditListResult> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const where: Prisma.AuditLogWhereInput = {
    userId,
    createdAt: { gte: q.from ?? twelveMonthsAgo, lte: q.to },
  };

  if (q.category) where.category = q.category;
  if (q.result) where.result = q.result;

  if (q.q) {
    const t = q.q;
    where.OR = [
      { action: { contains: t, mode: "insensitive" } },
      { entity: { contains: t, mode: "insensitive" } },
      { targetName: { contains: t, mode: "insensitive" } },
    ];
  }

  const orderBy: Prisma.AuditLogOrderByWithRelationInput[] = [
    { createdAt: "desc" }, { id: "desc" },
  ];

  const { items, total } = await repo.list(where, q.page, q.pageSize, orderBy);
  return {
    items,
    meta: {
      page: q.page,
      pageSize: q.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    },
  };
}

// =============================================================================
// Phase 2 — IP visibility scoping
// =============================================================================
export function scopeIpVisibility(
  items: AuditLogListItem[],
  viewerRole: string,
  viewerDepartmentId: string | null,
): AuditLogListItem[] {
  return items.map((item) => {
    if (viewerRole === "ROOT") return item;
    if (["ADMINISTRATOR", "QUALITY_ASSURANCE_OFFICER", "DEPARTMENT_COORDINATOR"].includes(viewerRole)) {
      if (viewerDepartmentId && item.user.departmentId !== viewerDepartmentId) {
        return { ...item, ipAddress: null };
      }
      return item;
    }
    return { ...item, ipAddress: item.user?.id ? item.ipAddress : null };
  });
}

// =============================================================================
// Phase 2 — Audit summary for Root dashboard
// =============================================================================
export async function getAuditSummary(days: number): Promise<AuditSummary> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [failedLogins, criticalEvents, retention] = await Promise.all([
    prisma.auditLog.count({
      where: { action: AUDIT_ACTIONS.LOGIN_FAILED, createdAt: { gte: since } },
    }),
    prisma.auditLog.count({
      where: { severity: "CRITICAL", createdAt: { gte: since } },
    }),
    getRetentionConfig(),
  ]);

  const reviewedIds = (await prisma.auditReview.findMany({
    where: { status: "REVIEWED" },
    select: { auditLogId: true },
  })).map((r) => r.auditLogId);

  const unreviewedCritical = await prisma.auditLog.count({
    where: {
      severity: "CRITICAL",
      createdAt: { gte: since },
      id: { notIn: reviewedIds },
    },
  });

  const lastArchive = await prisma.auditArchive.findFirst({
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const [recentRoleChanges, recentPermissionChanges, totalRecords] = await Promise.all([
    prisma.auditLog.count({
      where: { action: "user.role_changed", createdAt: { gte: since } },
    }),
    prisma.auditLog.count({
      where: { action: "role.permissions_updated", createdAt: { gte: since } },
    }),
    prisma.auditLog.count(),
  ]);

  return {
    failedLoginsToday: failedLogins,
    criticalEventsToday: criticalEvents,
    unreviewedCritical,
    recentRoleChanges,
    recentPermissionChanges,
    lastArchive: lastArchive?.createdAt.toISOString() ?? null,
    retentionYears: retention.retentionYears,
    totalRecords,
  };
}

// =============================================================================
// Phase 2 — Failed login grouping (UI helper query)
// =============================================================================
export async function getLoginGroups(q: LoginGroupsQuerySchema): Promise<LoginGroup[]> {
  const since = q.from ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rawRows = await prisma.auditLog.findMany({
    where: {
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      createdAt: { gte: since, lte: q.to },
    },
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true, email: true, departmentId: true, role: { select: { name: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const groups = new Map<string, AuditLogListItem[]>();
  for (const row of rawRows) {
    const ip = row.ipAddress ?? "unknown";
    const list = groups.get(ip) ?? [];
    list.push(repo.toListItem(row as Parameters<typeof repo.toListItem>[0]));
    groups.set(ip, list);
  }

  return Array.from(groups.entries())
    .filter(([, items]) => items.length >= q.minAttempts)
    .map(([ipAddress, items]) => ({
      ipAddress,
      count: items.length,
      firstAttempt: items[items.length - 1]?.timestamp?.toISOString() ?? "",
      lastAttempt: items[0]?.timestamp?.toISOString() ?? "",
      items,
    }))
    .sort((a, b) => b.count - a.count);
}

// =============================================================================
// Phase 2 — Archive download
// =============================================================================
export async function getArchiveForDownload(
  archiveId: string,
): Promise<AuditArchiveRecord | null> {
  const archive = await prisma.auditArchive.findUnique({ where: { id: archiveId } });
  return archive ?? null;
}

export async function logArchiveDownload(
  archiveId: string,
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const archive = await prisma.auditArchive.findUnique({ where: { id: archiveId } });
  await writeAudit({
    action: AUDIT_ACTIONS.AUDIT_ARCHIVE_DOWNLOADED as AuditAction,
    userId,
    ipAddress,
    userAgent,
    category: "SYSTEM",
    severity: "INFO",
    targetType: "audit_archive",
    targetId: archiveId,
    newValue: {
      archiveId,
      dateRange: archive ? { from: archive.dateRangeFrom, to: archive.dateRangeTo } : null,
      recordCount: archive?.recordCount ?? null,
    },
  });
}

// =============================================================================
// Phase 2 — Quick presets
// =============================================================================
export function getAuditPresets(): AuditPreset[] {
  return [
    { key: "today", label: "Today", query: {} },
    { key: "last7", label: "Last 7 Days", query: {} },
    { key: "last30", label: "Last 30 Days", query: {} },
    { key: "login_activity", label: "Login Activity", query: { category: "AUTHENTICATION" } },
    { key: "failed_security", label: "Failed Security Events", query: { category: "SECURITY", result: "FAILED" } },
    { key: "submissions", label: "Submissions", query: { category: "SUBMISSION" } },
    { key: "requests", label: "Requests", query: { category: "REQUEST" } },
    { key: "role_changes", label: "Role / Permission Changes", query: { category: "ACCESS_CONTROL" } },
    { key: "critical", label: "Critical Events", query: { severity: "CRITICAL" } },
  ];
}
