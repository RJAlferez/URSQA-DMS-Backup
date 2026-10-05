import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import { statObject } from "@/lib/storage";
import { env } from "@/config/env";
import { ForbiddenError, NotFoundError } from "@/utils/errors";
import * as repo from "@/modules/repositories/repository.repository";
import type {
  GrantEmergencyAccessInput,
  RevokeEmergencyAccessInput,
} from "@/modules/repositories/repository.validator";
import type {
  EmergencyAccessView,
  RepositoryView,
} from "@/modules/repositories/repository.types";

// =============================================================================
// URS-DMS — Personal repository service
// -----------------------------------------------------------------------------
// Provisioning is idempotent: every account (User and Administrator) is
// auto-provisioned a repository on first access; a backfill command covers
// existing accounts. Repository access is ownership-based: the authenticated
// actor may access their own repository only, unless an active ROOT-granted
// emergency grant covers (actor, owner). Emergency grants are time-limited,
// reason-required, revocable and audited at high severity.
// =============================================================================

export interface Actor {
  id: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

async function assertPermission(actor: Actor, code: string, message: string): Promise<void> {
  if (!actor.permissions.includes(code)) {
    // Awaited so the DENIED row is persisted before the 403 propagates.
    await writeAudit({
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      userId: actor.id,
      entity: "repository",
      entityId: code,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      category: "SECURITY",
      severity: "WARNING",
      result: "DENIED",
      newValue: { reason: "missing_permission", required: code },
    });
    throw new ForbiddenError(message);
  }
}

// Shared access gate used by repository-scoped surfaces: own repository, or
// active emergency grant.
export async function assertRepositoryAccess(
  actor: Actor,
  ownerId: string,
): Promise<string> {
  const repositoryId = await repo.ensureRepository(ownerId);
  if (actor.id === ownerId) return repositoryId;
  if (await repo.hasActiveEmergencyAccess(actor.id, ownerId)) {
    await writeAudit({
      action: AUDIT_ACTIONS.REPOSITORY_EMERGENCY_ACCESS_USED,
      userId: actor.id,
      entity: "repository",
      entityId: repositoryId,
      newValue: { accessType: "emergency_use", targetOwnerId: ownerId },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
    return repositoryId;
  }
  await writeAudit({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    userId: actor.id,
    entity: "repository",
    entityId: repositoryId,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    category: "SECURITY",
    severity: "WARNING",
    result: "DENIED",
    newValue: { reason: "cross_user_repository_access", targetOwnerId: ownerId },
  });
  throw new NotFoundError("Repository not found");
}

export async function getMyRepository(actor: Actor): Promise<RepositoryView> {
  const repositoryId = await repo.ensureRepository(actor.id);
  const stats = await repo.getRepositoryStats(actor.id);
  const emergencyActive = await repo.hasActiveEmergencyAccess(actor.id, actor.id);
  return {
    id: repositoryId,
    ownerId: actor.id,
    createdAt: new Date().toISOString(),
    folderCount: stats.folderCount,
    documentCount: stats.documentCount,
    storageBytes: stats.storageBytes,
    emergencyAccessActive: emergencyActive,
  };
}

export async function backfill(actor: Actor): Promise<{ provisioned: number }> {
  await assertPermission(actor, "repository.emergency_access", "Missing permission: repository.emergency_access");
  const provisioned = await repo.backfillRepositories();
  return { provisioned };
}

// ── Emergency access ─────────────────────────────────────────────────────────

export async function grantEmergencyAccess(
  ownerId: string,
  input: GrantEmergencyAccessInput,
  actor: Actor,
): Promise<{ id: string; expiresAt: string }> {
  await assertPermission(actor, "repository.emergency_access", "Missing permission: repository.emergency_access");

  const target = await prisma.user.findFirst({
    where: { id: ownerId, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!target) throw new NotFoundError("Target user not found");
  const admin = await prisma.user.findFirst({
    where: { id: input.adminId, deletedAt: null },
    select: { id: true, email: true },
  });
  if (!admin) throw new NotFoundError("Admin user not found");
  if (input.adminId === ownerId) {
    await writeAudit({
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      userId: actor.id,
      entity: "repository",
      entityId: ownerId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      category: "SECURITY",
      severity: "WARNING",
      result: "DENIED",
      newValue: { reason: "self_grant_emergency_access", targetOwnerId: ownerId },
    });
    throw new ForbiddenError("A repository owner already has access to their own repository");
  }

  await repo.ensureRepository(ownerId);
  const grant = await repo.grantEmergencyAccess({
    adminId: input.adminId,
    ownerId,
    reason: input.reason,
    durationMinutes: input.durationMinutes,
    grantedBy: actor.id,
  });

  await writeAudit({
    action: AUDIT_ACTIONS.REPOSITORY_EMERGENCY_GRANTED,
    userId: actor.id,
    entity: "repository",
    entityId: ownerId,
    newValue: {
      adminId: input.adminId,
      targetOwnerId: ownerId,
      reason: input.reason,
      expiresAt: grant.expiresAt.toISOString(),
      durationMinutes: input.durationMinutes,
      severity: "HIGH",
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return { id: grant.id, expiresAt: grant.expiresAt.toISOString() };
}

export async function revokeEmergencyAccess(
  id: string,
  _input: RevokeEmergencyAccessInput,
  actor: Actor,
): Promise<{ id: string }> {
  await assertPermission(actor, "repository.emergency_access", "Missing permission: repository.emergency_access");
  const revoked = await repo.revokeEmergencyAccess(id);
  if (!revoked) throw new NotFoundError("Emergency access grant not found");

  await writeAudit({
    action: AUDIT_ACTIONS.REPOSITORY_EMERGENCY_REVOKED,
    userId: actor.id,
    entity: "repository",
    entityId: id,
    newValue: { revoked: true },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return revoked;
}

export async function listEmergencyAccess(actor: Actor): Promise<EmergencyAccessView[]> {
  const rows = await repo.listEmergencyAccessForAdmin(actor.id);
  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    adminId: row.adminId,
    adminName: actor.id === row.adminId ? "self" : row.adminId,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    reason: row.reason,
    grantedBy: row.grantedBy,
    grantedAt: row.grantedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    active: row.revokedAt === null && row.expiresAt.getTime() > now,
  })) as unknown as EmergencyAccessView[];
}

export async function listRepositories(actor: Actor, ownerId: string): Promise<Array<{ id: string }>> {
  // MUST be awaited: without it the ownership denial rejects as an unhandled
  // promise, the request continues and returns 200 with another user's
  // repository list (IDOR) while the audit row claims DENIED.
  await assertRepositoryAccess(actor, ownerId);
  const rows = await repo.listRepositoriesForOwner(ownerId);
  return rows.map((row) => ({ id: row.id }));
}

// ── Server storage display (rule 13) ─────────────────────────────────────────

export interface StorageSummary {
  usedBytes: string;
  availableBytes: string | null;
  totalBytes: string | null;
  minioStatus: "online" | "offline";
  bucket: string;
}

/**
 * Honest server storage display: verified used bytes from PostgreSQL version
 * rows; capacity is NOT fabricated — MinIO has no configured quota, so
 * available/total are null and the client renders them as "—". MinIO
 * reachability is probed via a stat call (NoSuchKey proves the bucket is
 * reachable; any other error means storage is down).
 */
export async function getStorageSummary(actor: Actor): Promise<StorageSummary> {
  await repo.ensureRepository(actor.id);
  const used = await prisma.documentVersion.aggregate({ _sum: { sizeBytes: true } });

  let minioStatus: "online" | "offline" = "offline";
  try {
    await statObject("__urs_dms_probe_key__");
    minioStatus = "online";
  } catch (err) {
    const code = (err as { code?: string })?.code;
    minioStatus = code === "NoSuchKey" || code === "NotFound" ? "online" : "offline";
  }

  return {
    usedBytes: (used._sum.sizeBytes ?? BigInt(0)).toString(),
    availableBytes: null,
    totalBytes: null,
    minioStatus,
    bucket: env.MINIO_BUCKET,
  };
}
