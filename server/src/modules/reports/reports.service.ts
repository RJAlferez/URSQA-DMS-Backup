import { prisma } from "@/lib/prisma";
import {
  calculateOverallCompliance,
  calculateDepartmentCompliance,
} from "@/modules/aaccup/services/compliance.service";
import type { ReportFilters } from "@/modules/reports/reports.types";
import type {
  AaccupReportAreaRow,
  AaccupReportSummary,
  AuditReportRow,
  AuditReportSummary,
  DepartmentReportRow,
  DepartmentReportSummary,
  DocumentReportRow,
  DocumentReportSummary,
  PaginationMeta,
  ReportMetadata,
  ReportResult,
  RequestReportRow,
  RequestReportSummary,
  StorageReportRow,
  StorageReportSummary,
  UserActivityReportRow,
  UserActivityReportSummary,
} from "@/modules/reports/reports.types";
import * as repo from "@/modules/reports/reports.repository";
import { deriveModule } from "@/modules/reports/reports.repository";

// =============================================================================
// URS-DMS — Reporting Engine service (Sprint 6.4)
// -----------------------------------------------------------------------------
// Business logic only. The service:
//   1. Calls repository functions (pure data access — no Prisma here).
//   2. Delegates AACCUP compliance math to the compliance service (single
//      source of truth — never reimplemented here, per AI_CONTEXT §9).
//   3. Maps raw Prisma rows → typed report DTOs (PII masking for the audit
//      report happens here, once, before records leave the service).
//   4. Builds the ReportMetadata envelope every endpoint returns.
//
// Reports intentionally read the production tables directly for the count
// dimensions that don't have a dedicated module surface (departments, user
// activity, storage-by-department). Where a module-owned service exists
// (aaccup compliance), it is reused — not duplicated.
//
// Pagination rules:
//   - documents, requests, users, audit      → paginated
//   - departments, aaccup, storage            → bounded result sets, no
//                                                pagination (omitted from the
//                                                response envelope)
// =============================================================================

const fullName = (firstName: string, lastName: string): string =>
  `${firstName} ${lastName}`.trim();

const MS_PER_MINUTE = 60_000;

function metadata<T extends ReportFilters>(reportType: string, filters: T): ReportMetadata<T> {
  return {
    reportType,
    generatedAt: new Date().toISOString(),
    appliedFilters: filters,
  };
}

function pagination(page: number, pageSize: number, total: number): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Mask a single email: keep the first 3 chars + "***" + the @domain. */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const i = email.lastIndexOf("@");
  if (i <= 0) return "***";
  const local = email.slice(0, i);
  const domain = email.slice(i);
  if (local.length <= 3) return `***${domain}`;
  return `${local.slice(0, 3)}***${domain}`;
}

// -----------------------------------------------------------------------------
// 1. DOCUMENT REPORT
// -----------------------------------------------------------------------------
export async function documentReport(
  filters: ReportFilters,
  page: number,
  pageSize: number,
): Promise<ReportResult<DocumentReportSummary, DocumentReportRow, ReportFilters>> {
  const [{ rows, total }, agg] = await Promise.all([
    repo.listDocuments(filters, page, pageSize),
    repo.documentAggregates(filters),
  ]);

  // Resolve department names in ONE batch for the list page (groups come from
  // groupBy via aggregate).
  const deptIds = rows
    .map((r) => r.departmentId)
    .filter((id): id is string => id !== null);
  const aggrDeptIds = agg.byDepartment
    .map((d) => d.departmentId)
    .filter((id): id is string => id !== null);
  const allDeptIds = Array.from(new Set([...deptIds, ...aggrDeptIds]));
  const departments = allDeptIds.length
    ? await prisma.department.findMany({
        where: { id: { in: allDeptIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(departments.map((d) => [d.id, d.name]));

  const records: DocumentReportRow[] = rows.map((d) => {
    const totalSizeBytes = d.versions.reduce((acc, v) => acc + v.sizeBytes, BigInt(0));
    return {
      id: d.id,
      title: d.title,
      status: d.status,
      classification: d.classification,
      ownerId: d.ownerId,
      ownerName: fullName(d.owner.firstName, d.owner.lastName),
      departmentId: d.departmentId,
      departmentName: d.departmentId ? nameById.get(d.departmentId) ?? null : null,
      versionCount: d._count.versions,
      totalSizeBytes: totalSizeBytes.toString(),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  });

  const summary: DocumentReportSummary = {
    totalDocuments: total,
    byStatus: agg.byStatus.map((b) => ({ label: b.status, value: b._count })),
    byClassification: agg.byClassification.map((b) => ({ label: b.classification, value: b._count })),
    byDepartment: agg.byDepartment.map((b) => ({
      label: b.departmentId ? nameById.get(b.departmentId) ?? "Unassigned" : "Unassigned",
      value: b._count,
    })),
    totalSizeBytes: agg.totalSize.toString(),
    totalVersions: agg.totalVersions,
  };

  return {
    metadata: metadata("documents", filters),
    summary,
    records,
    pagination: pagination(page, pageSize, total),
  };
}

// -----------------------------------------------------------------------------
// 2. REQUEST REPORT
// -----------------------------------------------------------------------------
export async function requestReport(
  filters: ReportFilters,
  page: number,
  pageSize: number,
): Promise<ReportResult<RequestReportSummary, RequestReportRow, ReportFilters>> {
  const [{ rows, total }, agg] = await Promise.all([
    repo.listRequests(filters, page, pageSize),
    repo.requestAggregates(filters),
  ]);

  const records: RequestReportRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    requesterId: r.requesterId,
    requesterName: fullName(r.requester.firstName, r.requester.lastName),
    documentId: r.documentId,
    documentTitle: r.document?.title ?? null,
    decidedById: r.decidedById,
    decidedByName: r.decidedBy ? fullName(r.decidedBy.firstName, r.decidedBy.lastName) : null,
    decidedAt: r.decidedAt,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  // Average processing time = mean of (decidedAt - createdAt) across decided.
  let totalMins = 0;
  let decidedCount = 0;
  let approved = 0;
  let rejected = 0;
  for (const r of agg.decided) {
    if (!r.decidedAt) continue;
    totalMins += (r.decidedAt.getTime() - r.createdAt.getTime()) / MS_PER_MINUTE;
    decidedCount += 1;
  }
  for (const b of agg.byStatus) {
    if (b.status === "APPROVED") approved += b._count;
    if (b.status === "REJECTED") rejected += b._count;
  }
  const totalDecided = approved + rejected;
  const averageProcessingTimeMinutes = decidedCount
    ? Math.round((totalMins / decidedCount) * 10) / 10
    : 0;
  const approvalRate = totalDecided
    ? Math.round((approved / totalDecided) * 1000) / 10
    : 0;

  const summary: RequestReportSummary = {
    totalRequests: total,
    byStatus: agg.byStatus.map((b) => ({ label: b.status, value: b._count })),
    approvalRate,
    averageProcessingTimeMinutes,
    totalDecided,
  };

  return {
    metadata: metadata("requests", filters),
    summary,
    records,
    pagination: pagination(page, pageSize, total),
  };
}

// -----------------------------------------------------------------------------
// 3. AACCUP COMPLIANCE REPORT
// Reuses calculateOverallCompliance for the summary + area breakdown, then
// enriches each area with the department name in one extra batch.
// -----------------------------------------------------------------------------
export async function aaccupReport(
  filters: ReportFilters,
): Promise<ReportResult<AaccupReportSummary, AaccupReportAreaRow, ReportFilters>> {
  const overall = await calculateOverallCompliance({
    departmentId: filters.departmentId,
    areaId: filters.areaId,
  });

  // Enrich area rows with their department name in ONE batch (the
  // compliance service deliberately doesn't own the department join).
  const deptIds = Array.from(new Set(overall.areaBreakdown.map((a) => a.departmentId)));
  const departments = deptIds.length
    ? await prisma.department.findMany({
        where: { id: { in: deptIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(departments.map((d) => [d.id, d.name]));

  const records: AaccupReportAreaRow[] = overall.areaBreakdown.map((a) => ({
    areaId: a.areaId,
    areaCode: a.areaCode,
    areaName: a.areaName,
    departmentId: a.departmentId,
    departmentName: nameById.get(a.departmentId) ?? "Unassigned",
    totalRequirements: a.totalRequirements,
    completedRequirements: a.completedRequirements,
    compliancePercentage: a.compliancePercentage,
    requirementCounts: a.requirementCounts,
  }));

  const summary: AaccupReportSummary = {
    totalDepartments: overall.totalDepartments,
    totalAreas: overall.totalAreas,
    totalRequirements: overall.totalRequirements,
    requirementStatusCounts: overall.requirementStatusCounts,
    totalApproved: overall.totalApproved,
    totalPending: overall.totalPending,
    totalMissing: overall.totalMissing,
    compliancePercentage: overall.compliancePercentage,
  };

  return {
    metadata: metadata("aaccup", filters),
    summary,
    records,
  };
}

// -----------------------------------------------------------------------------
// 4. DEPARTMENT REPORT
// Reuses calculateDepartmentCompliance per department so every compliance
// figure goes through the same code path as the AACCUP module.
// -----------------------------------------------------------------------------
export async function departmentReport(
  filters: ReportFilters,
): Promise<ReportResult<DepartmentReportSummary, DepartmentReportRow, ReportFilters>> {
  const [departments, requirementCounts] = await Promise.all([
    repo.departmentsWithCounts(filters),
    repo.departmentRequirementCounts(),
  ]);

  // Compute compliance per department concurrently. Compliance service issues
  // one nested include query per department; bounded by #departments.
  const complianceByDept = await Promise.all(
    departments.map((d) =>
      calculateDepartmentCompliance(d.id).then(
        (c) => [d.id, c] as const,
      ).catch(() => [d.id, null] as const),
    ),
  );
  const complianceMap = new Map(complianceByDept);

  const records: DepartmentReportRow[] = departments.map((d) => {
    const c = complianceMap.get(d.id);
    return {
      id: d.id,
      name: d.name,
      code: d.code,
      headName: d.head ? fullName(d.head.firstName, d.head.lastName) : null,
      userCount: d._count.users,
      documentCount: d._count.documents,
      areaCount: d._count.aaccupAreas,
      requirementCount: requirementCounts.get(d.id) ?? 0,
      compliancePercentage: c?.compliancePercentage ?? 0,
      createdAt: d.createdAt,
    };
  });

  const totalUsers = records.reduce((a, r) => a + r.userCount, 0);
  const totalDocs = records.reduce((a, r) => a + r.documentCount, 0);
  const totalAreas = records.reduce((a, r) => a + r.areaCount, 0);
  const avgCompliance = records.length
    ? Math.round(
        (records.reduce((a, r) => a + r.compliancePercentage, 0) / records.length) * 10,
      ) / 10
    : 0;

  const summary: DepartmentReportSummary = {
    totalDepartments: records.length,
    totalUsers,
    totalDocuments: totalDocs,
    totalAreas,
    averageCompliancePercentage: avgCompliance,
  };

  return {
    metadata: metadata("departments", filters),
    summary,
    records,
  };
}

// -----------------------------------------------------------------------------
// 5. USER ACTIVITY REPORT
// -----------------------------------------------------------------------------
export async function userActivityReport(
  filters: ReportFilters,
  page: number,
  pageSize: number,
): Promise<ReportResult<UserActivityReportSummary, UserActivityReportRow, ReportFilters>> {
  const [{ rows, total }, counts, roleCounts] = await Promise.all([
    repo.listUsers(filters, page, pageSize),
    repo.perUserCounts(filters),
    repo.userActivityCounts(filters),
  ]);

  const records: UserActivityReportRow[] = rows.map((u) => ({
    userId: u.id,
    employeeId: u.employeeId,
    email: u.email,
    fullName: fullName(u.firstName, u.lastName),
    roleName: u.role.name,
    departmentId: u.departmentId,
    status: u.status,
    documentCount: counts.documents.get(u.id) ?? 0,
    requestCount: counts.requests.get(u.id) ?? 0,
    submissionCount: counts.submissions.get(u.id) ?? 0,
    auditEventCount: counts.auditEvents.get(u.id) ?? 0,
    lastLogin: u.lastLogin,
    createdAt: u.createdAt,
  }));

  const summary: UserActivityReportSummary = {
    totalUsers: total,
    activeUsers: roleCounts.activeUsers,
    totalDocuments: records.reduce((a, r) => a + r.documentCount, 0),
    totalRequests: records.reduce((a, r) => a + r.requestCount, 0),
    totalSubmissions: records.reduce((a, r) => a + r.submissionCount, 0),
    totalAuditEvents: records.reduce((a, r) => a + r.auditEventCount, 0),
    byRole: roleCounts.byRole.map((r) => ({ label: r.roleName, value: r._count })),
  };

  return {
    metadata: metadata("users", filters),
    summary,
    records,
    pagination: pagination(page, pageSize, total),
  };
}

// -----------------------------------------------------------------------------
// 6. STORAGE REPORT
// -----------------------------------------------------------------------------
export async function storageReport(
  filters: ReportFilters,
): Promise<ReportResult<StorageReportSummary, StorageReportRow, ReportFilters>> {
  const [byDept, totals] = await Promise.all([
    repo.storageByDepartment(filters),
    repo.storageTotals(filters),
  ]);

  const records: StorageReportRow[] = byDept.map((d) => ({
    departmentId: d.departmentId,
    departmentName: d.departmentName,
    fileCount: d._count > 0 ? 1 : 0,
    versionCount: d._count,
    totalSizeBytes: (d._sum.sizeBytes ?? BigInt(0)).toString(),
  }));

  // `fileCount` above is intentionally a per-row participation flag (1 if any
  // version is stored, 0 otherwise). Department-level distinct-document counts
  // would require a cross-table groupBy over documents → versions; the storage
  // summary's `totalFiles` carries the authoritative system-wide distinct
  // document count. Per-department file counts are out of 1.0 scope.

  const summary: StorageReportSummary = {
    totalFiles: totals.totalFiles,
    totalVersions: totals.totalVersions,
    totalSizeBytes: totals.totalSize.toString(),
    // Stored null is preserved — matches the dashboard module, since MinIO
    // has no configured quota (repo known issue).
    availableStorageBytes: null,
    byMimeType: totals.byMimeType.map((m) => ({ label: m.mimeType, value: m._count })),
  };

  return {
    metadata: metadata("storage", filters),
    summary,
    records,
  };
}

// -----------------------------------------------------------------------------
// 7. AUDIT REPORT
// Email is masked (PII). Other actor fields (id, name, role) are kept — the
// spec mandates masking only tokens/passwords/secrets in audit payloads; the
// audit timeline already exposes actor email/name on the audit module.
// We mask email here too for defence in depth on the reports surface.
// -----------------------------------------------------------------------------
export async function auditReport(
  filters: ReportFilters,
  page: number,
  pageSize: number,
): Promise<ReportResult<AuditReportSummary, AuditReportRow, ReportFilters>> {
  const [{ rows, total }, agg] = await Promise.all([
    repo.listAuditForReport(filters, page, pageSize),
    repo.auditAggregates(filters),
  ]);

  const records: AuditReportRow[] = rows.map((r) => ({
    id: r.id,
    timestamp: r.createdAt,
    action: r.action,
    module: deriveModule(r.action),
    // Authoritative status: stored result wins; legacy defaulted rows fall back
    // to the action list so denials stay DENIED (never FAILED) and failures
    // stay FAILED.
    status: repo.reportAuditStatus(r.result, r.action),
    userId: r.user?.id ?? null,
    userName: r.user ? fullName(r.user.firstName, r.user.lastName) : null,
    userEmail: maskEmail(r.user?.email ?? null),
    userRole: r.user?.role?.name ?? null,
    entity: r.entity,
    entityId: r.entityId,
    ipAddress: r.ipAddress,
  }));

  // Summary counts are computed per (action, result) group and classified with
  // the same authoritative rule as the rows, so legacy rows defaulted to
  // SUCCESS still count as failures/denials and new DENIED rows are never
  // folded into FAILED.
  let successCount = 0;
  let failedCount = 0;
  let deniedCount = 0;
  for (const group of agg.byActionResult) {
    const status = repo.reportAuditStatus(group.result, group.action);
    if (status === "SUCCESS") successCount += group._count;
    else if (status === "FAILED") failedCount += group._count;
    else deniedCount += group._count;
  }

  const byModuleMap = new Map<string, number>();
  for (const b of agg.byAction) {
    const m = deriveModule(b.action);
    byModuleMap.set(m, (byModuleMap.get(m) ?? 0) + b._count);
  }

  const summary: AuditReportSummary = {
    totalEvents: agg.total,
    successCount,
    failedCount,
    deniedCount,
    byModule: Array.from(byModuleMap.entries()).map(([label, value]) => ({ label, value })),
    byAction: agg.byAction.map((b) => ({ label: b.action, value: b._count })),
  };

  return {
    metadata: metadata("audit", filters),
    summary,
    records,
    pagination: pagination(page, pageSize, total),
  };
}
