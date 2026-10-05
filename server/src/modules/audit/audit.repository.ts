import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { isFailedAuditAction } from "@/config/constants";
import type {
  AuditLogDetail,
  AuditLogListItem,
  AuditArchiveRecord,
} from "@/modules/audit/audit.types";

const AUDIT_INCLUDE = {
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      departmentId: true,
      role: { select: { name: true } },
    },
  },
} satisfies Prisma.AuditLogInclude;

type AuditRow = Prisma.AuditLogGetPayload<{ include: typeof AUDIT_INCLUDE }>;

export const FAILED_AUDIT_ACTIONS: readonly string[] = [
  "auth.login.failed",
  "auth.refresh.failed",
  "auth.refresh.reuse_detected",
  "auth.permission_denied",
  "auth.access_denied",
] as const;

const FAILED_ACTIONS = new Set<string>(FAILED_AUDIT_ACTIONS);

function fullName(u: { firstName: string; lastName: string } | null): string | null {
  if (!u) return null;
  return `${u.firstName} ${u.lastName}`.trim() || null;
}

function deriveModule(action: string): string {
  const i = action.indexOf(".");
  return i === -1 ? action : action.slice(0, i);
}

const DENIED_ACTIONS = new Set<string>([
  "auth.permission_denied",
  "auth.access_denied",
]);

function deriveStatus(action: string): "SUCCESS" | "FAILED" | "DENIED" {
  if (DENIED_ACTIONS.has(action)) return "DENIED";
  // `*.failed` / `*_failed` keeps every module's terminal failure classified
  // correctly (document.upload_failed, email.failed, maintenance.*.failed, …).
  if (isFailedAuditAction(action) || FAILED_ACTIONS.has(action)) return "FAILED";
  return "SUCCESS";
}

export function toListItem(row: AuditRow): AuditLogListItem {
  const u = row.user;
  return {
    id: row.id,
    timestamp: row.createdAt,
    action: row.action,
    category: row.category,
    severity: row.severity,
    result: row.result,
    module: deriveModule(row.action),
    status: deriveStatus(row.action),
    user: {
      id: u?.id ?? null,
      name: fullName(u),
      email: u?.email ?? null,
      role: u?.role?.name ?? null,
      departmentId: u?.departmentId ?? null,
    },
    entity: { type: row.entity, id: row.entityId },
    targetType: row.targetType,
    targetId: row.targetId,
    targetName: row.targetName,
    actorName: row.actorName,
    actorRole: row.actorRole,
    actorOrganization: row.actorOrganization,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    correlationId: row.correlationId,
    description: null,
  };
}

function toDetail(row: AuditRow): AuditLogDetail {
  return {
    ...toListItem(row),
    changes: { oldValue: row.oldValue, newValue: row.newValue },
    metadata: row.metadata,
  };
}

export async function list(
  where: Prisma.AuditLogWhereInput,
  page: number,
  pageSize: number,
  orderBy: Prisma.AuditLogOrderByWithRelationInput[],
): Promise<{ items: AuditLogListItem[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: AUDIT_INCLUDE,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { items: rows.map(toListItem), total };
}

export async function findById(id: string): Promise<AuditLogDetail | null> {
  const row = await prisma.auditLog.findUnique({
    where: { id },
    include: AUDIT_INCLUDE,
  });
  return row ? toDetail(row) : null;
}

export async function findManyForExport(
  where: Prisma.AuditLogWhereInput,
  orderBy: Prisma.AuditLogOrderByWithRelationInput[],
  maxRows: number,
): Promise<AuditLogListItem[]> {
  const rows = await prisma.auditLog.findMany({
    where,
    include: AUDIT_INCLUDE,
    orderBy,
    take: maxRows,
  });
  return rows.map(toListItem);
}

export async function clearAll(): Promise<number> {
  const result = await prisma.auditLog.deleteMany({});
  return result.count;
}

// =============================================================================
// Archive repository
// =============================================================================

export async function countByDateRange(
  from: Date,
  to: Date,
): Promise<number> {
  return prisma.auditLog.count({
    where: { createdAt: { gte: from, lte: to } },
  });
}

export async function findIdsByDateRange(
  from: Date,
  to: Date,
): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.id);
}

export async function findManyByIds(
  ids: string[],
): Promise<AuditLogListItem[]> {
  const rows = await prisma.auditLog.findMany({
    where: { id: { in: ids } },
    include: AUDIT_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toListItem);
}

export async function deleteByIds(ids: string[]): Promise<number> {
  const result = await prisma.auditLog.deleteMany({
    where: { id: { in: ids } },
  });
  return result.count;
}

export async function createArchive(record: {
  dateRangeFrom: Date;
  dateRangeTo: Date;
  recordCount: number;
  checksum: string;
  format?: string;
  objectKey?: string;
  createdBy?: string;
  notes?: string;
}): Promise<AuditArchiveRecord> {
  return prisma.auditArchive.create({
    data: {
      dateRangeFrom: record.dateRangeFrom,
      dateRangeTo: record.dateRangeTo,
      recordCount: record.recordCount,
      checksum: record.checksum,
      format: record.format ?? "json",
      objectKey: record.objectKey ?? null,
      createdBy: record.createdBy ?? null,
      notes: record.notes ?? null,
    },
  });
}

export async function listArchives(): Promise<AuditArchiveRecord[]> {
  return prisma.auditArchive.findMany({
    orderBy: { createdAt: "desc" },
  });
}
