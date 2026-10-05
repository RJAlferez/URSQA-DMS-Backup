import { prisma } from "@/lib/prisma";
import type {
  DocumentClassification,
  DocumentStatus,
  Prisma,
  RequestStatus,
  UserStatus,
} from "@prisma/client";
import { isFailedAuditAction } from "@/config/constants";
import type { ReportFilters } from "@/modules/reports/reports.types";

// =============================================================================
// URS-DMS — Reporting Engine repository (Sprint 6.4)
// -----------------------------------------------------------------------------
// Pure Prisma data access. NO business logic, no DTO mapping beyond simple
// row shaping. The service layer composes these queries into report shapes
// and reuses the compliance service for AACCUP math (single source of truth).
//
// Performance strategy (mirrors the analytics/dashboard modules):
//   - Counts use prisma.<model>.count({ where }) — single server-side COUNT.
//   - Bucketed counts use groupBy({ by: [...], _count: { _all: true } }) so a
//     dimension breakdown is ONE round trip (no N+1).
//   - Aggregate scalars use prisma.<model>.aggregate({ _sum / _avg / _count }).
//   - Paginated reads use findMany + count in ONE Promise.all batch (one round
//     trip through the Prisma connection pool).
//   - Relation includes are scoped via `satisfies Prisma.<XxxInclude>` so the
//     compiler verifies the shape without widening to `any`.
// =============================================================================

// Pull the integer count out of a Prisma groupBy row, tolerating the
// `_count: { _all: number }` shape returned by Prisma's groupBy({ _count }).
function countOf(r: { _count?: Record<string, number> }): number {
  return typeof r._count?._all === "number" ? r._count._all : 0;
}

// -----------------------------------------------------------------------------
// Filter helpers — convert a ReportFilters object into typed Prisma WhereInput
// fragments. Each helper returns a partial fragment the caller spreads into
// its own where clause. This keeps the per-filter rule in ONE place.
// -----------------------------------------------------------------------------

// Build the standard createdAt date-range filter fragment.
function createdAtRange(filters: ReportFilters): { createdAt?: Prisma.DateTimeFilter } {
  if (!filters.from && !filters.to) return {};
  const r: Prisma.DateTimeFilter = {};
  if (filters.from) r.gte = filters.from;
  if (filters.to) r.lte = filters.to;
  return { createdAt: r };
}

// -----------------------------------------------------------------------------
// 1. DOCUMENT REPORT
// -----------------------------------------------------------------------------

export const DOCUMENT_REPORT_SELECT = {
  id: true,
  title: true,
  status: true,
  classification: true,
  ownerId: true,
  departmentId: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { firstName: true, lastName: true } },
  department: { select: { name: true } },
  _count: { select: { versions: true } },
} satisfies Prisma.DocumentSelect;

type DocumentListRow = Prisma.DocumentGetPayload<{
  select: typeof DOCUMENT_REPORT_SELECT & { versions: { select: { sizeBytes: true } } };
}>;

export async function listDocuments(
  filters: ReportFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: DocumentListRow[]; total: number }> {
  const where: Prisma.DocumentWhereInput = { deletedAt: null, ...createdAtRange(filters) };
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.userId) where.ownerId = filters.userId;
  if (filters.status) where.status = filters.status as DocumentStatus;
  if (filters.documentType) where.classification = filters.documentType as DocumentClassification;

  const [rows, total] = await Promise.all([
    prisma.document.findMany({
      where,
      select: {
        ...DOCUMENT_REPORT_SELECT,
        // sum of version sizes is computed in SQL where possible; Prisma cannot
        // _sum inside a relation include alongside findMany, so we fetch the
        // version rows' sizeBytes directly. Pagination bounds the row count.
        versions: { select: { sizeBytes: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.document.count({ where }),
  ]);
  return { rows, total };
}

export async function documentAggregates(filters: ReportFilters): Promise<{
  byStatus: { status: string; _count: number }[];
  byClassification: { classification: string; _count: number }[];
  byDepartment: { departmentId: string | null; _count: number }[];
  totalVersions: number;
  totalSize: bigint;
}> {
  const where: Prisma.DocumentWhereInput = { deletedAt: null, ...createdAtRange(filters) };
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.userId) where.ownerId = filters.userId;
  if (filters.status) where.status = filters.status as DocumentStatus;
  if (filters.documentType) where.classification = filters.documentType as DocumentClassification;

  const [byStatus, byClassification, byDepartment, totalVersions, sizeAgg] = await Promise.all([
    prisma.document.groupBy({ by: ["status"], _count: { _all: true }, where }),
    prisma.document.groupBy({ by: ["classification"], _count: { _all: true }, where }),
    prisma.document.groupBy({ by: ["departmentId"], _count: { _all: true }, where }),
    prisma.documentVersion.count({
      where: { document: where },
    }),
    prisma.documentVersion.aggregate({
      _sum: { sizeBytes: true },
      // Versions of soft-deleted documents still occupy storage in MinIO until
      // a GC pass runs (repo known issue). Storage stats include them.
    }),
  ]);
  return {
    byStatus: byStatus.map((r) => ({ status: r.status, _count: countOf(r) })),
    byClassification: byClassification.map((r) => ({
      classification: r.classification,
      _count: countOf(r),
    })),
    byDepartment: byDepartment.map((r) => ({
      departmentId: r.departmentId,
      _count: countOf(r),
    })),
    totalVersions,
    totalSize: sizeAgg._sum.sizeBytes ?? BigInt(0),
  };
}

// -----------------------------------------------------------------------------
// 2. REQUEST REPORT
// -----------------------------------------------------------------------------

export const REQUEST_REPORT_SELECT = {
  id: true,
  title: true,
  status: true,
  requesterId: true,
  documentId: true,
  decidedById: true,
  decidedAt: true,
  decisionNote: true,
  createdAt: true,
  updatedAt: true,
  requester: { select: { firstName: true, lastName: true } },
  document: { select: { id: true, title: true } },
  decidedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.DocumentRequestSelect;

type RequestReportRowRaw = Prisma.DocumentRequestGetPayload<{
  select: typeof REQUEST_REPORT_SELECT;
}>;

export async function listRequests(
  filters: ReportFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: RequestReportRowRaw[]; total: number }> {
  const where: Prisma.DocumentRequestWhereInput = {};
  if (filters.from || filters.to) {
    const r: Prisma.DateTimeFilter = {};
    if (filters.from) r.gte = filters.from;
    if (filters.to) r.lte = filters.to;
    where.createdAt = r;
  }
  if (filters.userId) where.requesterId = filters.userId;
  if (filters.status) where.status = filters.status as RequestStatus;
  if (filters.requestType) where.title = { contains: filters.requestType, mode: "insensitive" };
  if (filters.departmentId) where.requester = { departmentId: filters.departmentId };

  const [rows, total] = await Promise.all([
    prisma.documentRequest.findMany({
      where,
      select: REQUEST_REPORT_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.documentRequest.count({ where }),
  ]);
  return { rows, total };
}

export async function requestAggregates(filters: ReportFilters): Promise<{
  byStatus: { status: string; _count: number }[];
  decided: { createdAt: Date; decidedAt: Date | null }[];
}> {
  const where: Prisma.DocumentRequestWhereInput = {};
  if (filters.from || filters.to) {
    const r: Prisma.DateTimeFilter = {};
    if (filters.from) r.gte = filters.from;
    if (filters.to) r.lte = filters.to;
    where.createdAt = r;
  }
  if (filters.userId) where.requesterId = filters.userId;
  if (filters.status) where.status = filters.status as RequestStatus;
  if (filters.departmentId) where.requester = { departmentId: filters.departmentId };

  const [byStatus, decided] = await Promise.all([
    prisma.documentRequest.groupBy({ by: ["status"], _count: { _all: true }, where }),
    prisma.documentRequest.findMany({
      where: { ...where, decidedAt: { not: null } },
      select: { createdAt: true, decidedAt: true },
    }),
  ]);
  return {
    byStatus: byStatus.map((r) => ({ status: r.status, _count: countOf(r) })),
    decided,
  };
}

// -----------------------------------------------------------------------------
// 4. DEPARTMENT REPORT (counts only — compliance figures come from the
// compliance service at the service layer).
// -----------------------------------------------------------------------------

export async function departmentsWithCounts(filters: ReportFilters): Promise<{
  id: string;
  name: string;
  code: string;
  headId: string | null;
  head: { firstName: string; lastName: string } | null;
  createdAt: Date;
  _count: { users: number; documents: number; aaccupAreas: number };
}[]> {
  const where: Prisma.DepartmentWhereInput = { deletedAt: null };
  // Date range applies to department.createdAt (departments created in window).
  if (filters.from || filters.to) {
    const r: Prisma.DateTimeFilter = {};
    if (filters.from) r.gte = filters.from;
    if (filters.to) r.lte = filters.to;
    where.createdAt = r;
  }

  // Single findMany with relation counts — no N+1.
  return prisma.department.findMany({
    where,
    select: {
      id: true,
      name: true,
      code: true,
      headId: true,
      createdAt: true,
      head: { select: { firstName: true, lastName: true } },
      _count: {
        select: {
          users: { where: { deletedAt: null } },
          documents: { where: { deletedAt: null } },
          aaccupAreas: { where: { deletedAt: null } },
        },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function departmentRequirementCounts(): Promise<
  Map<string, number>
> {
  // Group requirements by area → roll up to department via the area relation.
  const rows = await prisma.aaccupRequirement.groupBy({
    by: ["areaId"],
    _count: { _all: true },
    where: { deletedAt: null },
  });
  const areaCounts = new Map<string, number>(
    rows.map((r) => [r.areaId, countOf(r)]),
  );
  const areas = await prisma.aaccupArea.findMany({
    where: { deletedAt: null },
    select: { id: true, departmentId: true },
  });
  const deptCounts = new Map<string, number>();
  for (const a of areas) {
    const c = areaCounts.get(a.id) ?? 0;
    deptCounts.set(a.departmentId, (deptCounts.get(a.departmentId) ?? 0) + c);
  }
  return deptCounts;
}

// -----------------------------------------------------------------------------
// 5. USER ACTIVITY REPORT
// -----------------------------------------------------------------------------

export const USER_ACTIVITY_SELECT = {
  id: true,
  employeeId: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  departmentId: true,
  lastLogin: true,
  createdAt: true,
  role: { select: { name: true } },
} satisfies Prisma.UserSelect;

type UserActivityRowRaw = Prisma.UserGetPayload<{ select: typeof USER_ACTIVITY_SELECT }>;

export async function listUsers(
  filters: ReportFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: UserActivityRowRaw[]; total: number }> {
  const where: Prisma.UserWhereInput = { deletedAt: null, ...createdAtRange(filters) };
  if (filters.userId) where.id = filters.userId;
  if (filters.roleId) where.roleId = filters.roleId;
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.status) where.status = filters.status as UserStatus;

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: USER_ACTIVITY_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return { rows, total };
}

export async function userActivityCounts(filters: ReportFilters): Promise<{
  byRole: { roleName: string; _count: number }[];
  activeUsers: number;
}> {
  const where: Prisma.UserWhereInput = { deletedAt: null, ...createdAtRange(filters) };
  if (filters.departmentId) where.departmentId = filters.departmentId;
  if (filters.roleId) where.roleId = filters.roleId;
  if (filters.status) where.status = filters.status as UserStatus;

  const [byRole, activeUsers] = await Promise.all([
    prisma.user.groupBy({
      by: ["roleId"],
      _count: { _all: true },
      where,
    }),
    prisma.user.count({ where: { ...where, status: "ACTIVE" } }),
  ]);

  const roleIds = byRole.map((r) => r.roleId);
  const roles = roleIds.length
    ? await prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } })
    : [];
  const roleNameById = new Map(roles.map((r) => [r.id, r.name]));

  return {
    byRole: byRole.map((r) => ({ roleName: roleNameById.get(r.roleId) ?? "UNKNOWN", _count: countOf(r) })),
    activeUsers,
  };
}

// Per-user activity counters, computed in a single groupBy per dimension so
// the activity report reads each row with O(1) lookups into these maps (no
// N+1 per user).
export async function perUserCounts(filters: ReportFilters): Promise<{
  documents: Map<string, number>;
  requests: Map<string, number>;
  submissions: Map<string, number>;
  auditEvents: Map<string, number>;
}> {
  // Date range applies to the activity being counted (event time), not the
  // user's createdAt — the user list filter retains its own dateRange.
  const userFilter: Prisma.UserWhereInput = { deletedAt: null };
  if (filters.userId) userFilter.id = filters.userId;
  if (filters.departmentId) userFilter.departmentId = filters.departmentId;
  if (filters.roleId) userFilter.roleId = filters.roleId;

  const docWhere: Prisma.DocumentWhereInput = { deletedAt: null, owner: userFilter };
  if (filters.from || filters.to) {
    const r: Prisma.DateTimeFilter = {};
    if (filters.from) r.gte = filters.from;
    if (filters.to) r.lte = filters.to;
    docWhere.createdAt = r;
  }
  const reqWhere: Prisma.DocumentRequestWhereInput = { requester: userFilter };
  if (filters.from || filters.to) {
    const r: Prisma.DateTimeFilter = {};
    if (filters.from) r.gte = filters.from;
    if (filters.to) r.lte = filters.to;
    reqWhere.createdAt = r;
  }
  const subWhere: Prisma.AaccupSubmissionWhereInput = { deletedAt: null, submittedByUser: userFilter };
  if (filters.from || filters.to) {
    const r: Prisma.DateTimeFilter = {};
    if (filters.from) r.gte = filters.from;
    if (filters.to) r.lte = filters.to;
    subWhere.submittedAt = r;
  }
  const audWhere: Prisma.AuditLogWhereInput = { user: userFilter };
  if (filters.from || filters.to) {
    const r: Prisma.DateTimeFilter = {};
    if (filters.from) r.gte = filters.from;
    if (filters.to) r.lte = filters.to;
    audWhere.createdAt = r;
  }

  const [docs, reqs, subs, auds] = await Promise.all([
    prisma.document.groupBy({ by: ["ownerId"], _count: { _all: true }, where: docWhere }),
    prisma.documentRequest.groupBy({ by: ["requesterId"], _count: { _all: true }, where: reqWhere }),
    prisma.aaccupSubmission.groupBy({ by: ["submittedBy"], _count: { _all: true }, where: subWhere }),
    prisma.auditLog.groupBy({ by: ["userId"], _count: { _all: true }, where: audWhere }),
  ]);
  return {
    documents: new Map(docs.map((r) => [r.ownerId, countOf(r)])),
    requests: new Map(reqs.map((r) => [r.requesterId, countOf(r)])),
    submissions: new Map(subs.map((r) => [r.submittedBy, countOf(r)])),
    auditEvents: new Map<string, number>(
      auds
        .filter((r) => r.userId !== null)
        .map((r) => [r.userId as string, countOf(r)]),
    ),
  };
}

// -----------------------------------------------------------------------------
// 6. STORAGE REPORT (grouped by department)
// -----------------------------------------------------------------------------

export async function storageByDepartment(filters: ReportFilters): Promise<
  {
    departmentId: string | null;
    departmentName: string | null;
    _count: number;
    _sum: { sizeBytes: bigint | null };
  }[]
> {
  const versionWhere: Prisma.DocumentVersionWhereInput = {};
  if (filters.from || filters.to) {
    const r: Prisma.DateTimeFilter = {};
    if (filters.from) r.gte = filters.from;
    if (filters.to) r.lte = filters.to;
    versionWhere.uploadedAt = r;
  }
  const docWhere: Prisma.DocumentWhereInput = { deletedAt: null };
  if (filters.departmentId) docWhere.departmentId = filters.departmentId;
  if (filters.documentType) docWhere.classification = filters.documentType as DocumentClassification;

  // Group versions by their document's department. Prisma has no
  // groupBy across a relation + scalar in one go, so we go via the
  // document model and use the relation aggregate available there.
  const byDept = await prisma.document.findMany({
    where: docWhere,
    select: {
      departmentId: true,
      department: { select: { name: true } },
      versions: {
        where: versionWhere,
        select: { sizeBytes: true },
      },
    },
  });

  // Aggregate locally per department — the set is bounded by document count in
  // the (filtered) window. This avoids a raw SQL groupBy across two tables and
  // keeps the read portable across Prisma versions.
  const acc = new Map<
    string | null,
    { name: string | null; versionCount: number; fileCount: number; bytes: bigint }
  >();
  for (const d of byDept) {
    const key = d.departmentId;
    const existing = acc.get(key) ?? {
      name: d.department?.name ?? null,
      versionCount: 0,
      fileCount: 0,
      bytes: 0n,
    };
    existing.versionCount += d.versions.length;
    if (d.versions.length > 0) existing.fileCount += 1;
    for (const v of d.versions) existing.bytes += v.sizeBytes;
    // Preserve the first non-null department name we saw (departments may be
    // soft-deleted but their name is still meaningful in a historical report).
    if (existing.name === null && d.department?.name) existing.name = d.department.name;
    acc.set(key, existing);
  }
  return Array.from(acc.entries()).map(([departmentId, v]) => ({
    departmentId,
    departmentName: v.name,
    _count: v.versionCount,
    _sum: { sizeBytes: v.bytes },
  }));
}

export async function storageTotals(filters: ReportFilters): Promise<{
  totalFiles: number;
  totalVersions: number;
  totalSize: bigint;
  byMimeType: { mimeType: string; _count: number }[];
}> {
  const where: Prisma.DocumentVersionWhereInput = {};
  if (filters.from || filters.to) {
    const r: Prisma.DateTimeFilter = {};
    if (filters.from) r.gte = filters.from;
    if (filters.to) r.lte = filters.to;
    where.uploadedAt = r;
  }
  const [totalFiles, totalVersions, sizeAgg, byMime] = await Promise.all([
    prisma.document.count({ where: { deletedAt: null, versions: { some: where } } }),
    prisma.documentVersion.count({ where }),
    prisma.documentVersion.aggregate({ where, _sum: { sizeBytes: true } }),
    prisma.documentVersion.groupBy({ by: ["mimeType"], _count: { _all: true }, where }),
  ]);
  return {
    totalFiles,
    totalVersions,
    totalSize: sizeAgg._sum.sizeBytes ?? BigInt(0),
    byMimeType: byMime.map((r) => ({ mimeType: r.mimeType, _count: countOf(r) })),
  };
}

// -----------------------------------------------------------------------------
// 7. AUDIT REPORT — mirrors the existing audit.repository read shapes. Kept
// here so the reports module owns its own read selector and does not depend
// on the audit module's list-shape (which carries more user resolution fields
// than the audit report actually needs).
// -----------------------------------------------------------------------------

export const AUDIT_REPORT_SELECT = {
  id: true,
  createdAt: true,
  action: true,
  result: true,
  entity: true,
  entityId: true,
  ipAddress: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: { select: { name: true } },
    },
  },
} satisfies Prisma.AuditLogSelect;

type AuditReportRowRaw = Prisma.AuditLogGetPayload<{
  select: typeof AUDIT_REPORT_SELECT;
}>;

// Legacy rows created before the `result` column existed were back-filled with
// the DEFAULT 'SUCCESS' by the additive migration, so for those actions we must
// fall back to the action name to avoid reporting a historical failed login or
// denial as SUCCESS. NEW rows always carry the authoritative `result`.
const LEGACY_DENIED_ACTIONS = new Set<string>([
  "auth.permission_denied",
  "auth.access_denied",
]);
const LEGACY_FAILED_ACTIONS = new Set<string>([
  "auth.login.failed",
  "auth.refresh.failed",
  "auth.refresh.reuse_detected",
]);

/**
 * Authoritative audit status for report rows:
 *   - stored result wins (SUCCESS / FAILED / DENIED),
 *   - legacy rows whose result was defaulted to SUCCESS fall back to the
 *     action name so denials stay DENIED (never FAILED) and failures stay FAILED.
 */
export function reportAuditStatus(
  result: string,
  action: string,
): "SUCCESS" | "FAILED" | "DENIED" {
  if (result === "FAILED" || result === "DENIED") return result;
  if (LEGACY_DENIED_ACTIONS.has(action)) return "DENIED";
  if (isFailedAuditAction(action) || LEGACY_FAILED_ACTIONS.has(action)) return "FAILED";
  return "SUCCESS";
}

/** Module label = action prefix before the first "." (matches audit module). */
export function deriveModule(action: string): string {
  const i = action.indexOf(".");
  return i === -1 ? action : action.slice(0, i);
}

export async function listAuditForReport(
  filters: ReportFilters,
  page: number,
  pageSize: number,
): Promise<{ rows: AuditReportRowRaw[]; total: number }> {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.from || filters.to) {
    const r: Prisma.DateTimeFilter = {};
    if (filters.from) r.gte = filters.from;
    if (filters.to) r.lte = filters.to;
    where.createdAt = r;
  }
  if (filters.userId) where.userId = filters.userId;
  if (filters.entity) where.entity = { equals: filters.entity, mode: "insensitive" };
  if (filters.status) {
    // Filter on the stored result so FAILED excludes DENIED (authorization
    // denials are not operation failures).
    where.result = filters.status;
  }
  const userFilter: Prisma.UserWhereInput = {};
  if (filters.roleId) userFilter.roleId = filters.roleId;
  if (filters.departmentId) userFilter.departmentId = filters.departmentId;
  if (Object.keys(userFilter).length > 0) where.user = userFilter;

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      select: AUDIT_REPORT_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total };
}

export async function auditAggregates(filters: ReportFilters): Promise<{
  total: number;
  byAction: { action: string; _count: number }[];
  byActionResult: { action: string; result: string; _count: number }[];
}> {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.from || filters.to) {
    const r: Prisma.DateTimeFilter = {};
    if (filters.from) r.gte = filters.from;
    if (filters.to) r.lte = filters.to;
    where.createdAt = r;
  }
  if (filters.userId) where.userId = filters.userId;
  if (filters.status) {
    where.result = filters.status;
  }

  const [total, byAction, byActionResult] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({ by: ["action"], _count: { _all: true }, where }),
    prisma.auditLog.groupBy({ by: ["action", "result"], _count: { _all: true }, where }),
  ]);
  return {
    total,
    byAction: byAction.map((r) => ({ action: r.action, _count: countOf(r) })),
    byActionResult: byActionResult.map((r) => ({
      action: r.action,
      result: r.result,
      _count: countOf(r),
    })),
  };
}

