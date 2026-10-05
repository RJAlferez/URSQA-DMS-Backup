import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/utils/errors";
import * as repo from "@/modules/folders/folders.repository";
import { ensureRepository } from "@/modules/repositories/repository.repository";
import {
  sanitizeZipSegment,
  streamZipArchive,
  type ZipDirectoryEntry,
  type ZipFileEntry,
} from "@/lib/zipStream";
import { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type {
  CreateFolderInput,
  ListFoldersQuery,
  UpdateFolderInput,
} from "@/modules/folders/folders.validator";
import type {
  FolderDetail,
  FolderListItem,
  ResolvedFolderNode,
  ResolvedFolderStructure,
} from "@/modules/folders/folders.types";
import { assertFolderAccess, resolveFolderAccess } from "@/modules/folders/folderSharing.service";

// =============================================================================
// URS-DMS — folders service
// RBAC model:
//   - "managers" = users holding folders.delete (admins + QAOs).
//   - otherwise: owner OR department-coordinator within matching department.
//   - read access: folders.read permission OR ownership/department match.
// No `if (role === "admin")` anywhere — every check routes through permissions.
// =============================================================================

export interface ListResult {
  items: FolderListItem[];
}

export interface Actor {
  id: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

// Rule 1 / D-002: repository access is OWNERSHIP-BASED. Member roles hold
// folders.delete for their own repository, so a permission-based "manager"
// shortcut would let any account bypass ownership. Department-scoped folders
// (organization master data / archive folders) remain visible to everyone;
// personal folders are owner-only.
async function assertCanManage(actor: Actor, folder: { id: string; ownerId: string | null }): Promise<void> {
  if (folder.ownerId === actor.id) return;
  await writeAudit({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    userId: actor.id,
    entity: "folder",
    entityId: folder.id,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    category: "SECURITY",
    severity: "WARNING",
    result: "DENIED",
    newValue: { reason: "cross_user_folder_manage_attempt", ownerId: folder.ownerId },
  });
  throw new NotFoundError("Folder not found");
}

// -----------------------------------------------------------------------------
// listFolders
// -----------------------------------------------------------------------------
export async function listFolders(query: ListFoldersQuery, actor: Actor): Promise<ListResult> {
  const where: Prisma.FolderWhereInput = {};
  if (!query.includeDeleted) where.deletedAt = null;
  if (query.parentId !== undefined) where.parentId = query.parentId;
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.q) {
    where.name = { contains: query.q, mode: "insensitive" };
  }

  const candidates = await repo.list(where);
  const items = await Promise.all(candidates.map(async (folder) => {
    const access = await resolveFolderAccess(actor.id, folder.id);
    return access === "NONE" ? null : folder;
  }));
  return { items: items.filter((folder): folder is FolderListItem => folder !== null) };
}

// -----------------------------------------------------------------------------
// getFolder
// -----------------------------------------------------------------------------
export async function getFolder(id: string, actor: Actor): Promise<FolderDetail> {
  const folder = await repo.findById(id);
  if (!folder) throw new NotFoundError("Folder not found");
  if ((await resolveFolderAccess(actor.id, id)) === "NONE") {
    await writeAudit({
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      userId: actor.id,
      entity: "folder",
      entityId: folder.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      category: "SECURITY",
      severity: "WARNING",
      result: "DENIED",
      newValue: { reason: "cross_user_folder_read_attempt", ownerId: folder.ownerId },
    });
    throw new NotFoundError("Folder not found");
  }
  // Record the folder in the owner's recents (best-effort, owner only).
  if (folder.ownerId === actor.id) {
    await prisma.repositoryRecent.upsert({
      where: {
        ownerId_itemType_itemId: { ownerId: actor.id, itemType: "FOLDER", itemId: id },
      },
      create: { ownerId: actor.id, itemType: "FOLDER", itemId: id, lastOpenedAt: new Date() },
      update: { lastOpenedAt: new Date() },
    });
  }
  return folder;
}

// -----------------------------------------------------------------------------
// createFolder
// -----------------------------------------------------------------------------
export async function createFolder(
  input: CreateFolderInput,
  actor: Actor,
): Promise<FolderDetail> {
// Validate parent if specified.
  if (input.parentId) {
    const parent = await repo.findById(input.parentId);
    if (!parent) throw new BadRequestError("Parent folder not found");
    await assertFolderAccess(actor.id, input.parentId, "EDITOR");
    // Rule 3: reject any create that would land at depth 6 or deeper.
    await assertDestinationDepth(input.parentId);
  }

  // BUG-3 FIX: a folder may only be scoped to the creator's own department
  // (or null). Tagging a folder to another department would bypass the
  // same-department sharing restriction.
  if (input.departmentId !== undefined && input.departmentId !== null) {
    const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { departmentId: true } });
    if (!me?.departmentId || me.departmentId !== input.departmentId) {
      await writeAudit({
        action: AUDIT_ACTIONS.ACCESS_DENIED,
        userId: actor.id,
        entity: "folder",
        entityId: undefined,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        category: "SECURITY",
        severity: "WARNING",
        result: "DENIED",
        newValue: { reason: "cross_department_folder_tag", departmentId: input.departmentId },
      });
      throw new ForbiddenError("You may only scope a folder to your own department");
    }
  }

  const folder = await repo.create({
    name: input.name,
    parentId: input.parentId ?? null,
    departmentId: input.departmentId ?? null,
    ownerId: actor.id,
  });

  await writeAudit({
    action: AUDIT_ACTIONS.FOLDER_CREATED,
    userId: actor.id,
    entity: "folder",
    entityId: folder.id,
    newValue: {
      name: folder.name,
      parentId: folder.parentId,
      departmentId: folder.departmentId,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return folder;
}

// -----------------------------------------------------------------------------
// updateFolder
// -----------------------------------------------------------------------------
export async function updateFolder(
  id: string,
  input: UpdateFolderInput,
  actor: Actor,
): Promise<FolderDetail> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("Folder not found");
  await assertCanManage(actor, existing);

  // BUG-3 FIX: a folder may only be scoped to the creator's own department.
  // UPDATE: prevent the owner from changing a folder's department to one they don't
  // belong to (would bypass the same-department sharing restriction).
  if (input.departmentId !== undefined && input.departmentId !== null) {
    const me = await prisma.user.findUnique({ where: { id: actor.id }, select: { departmentId: true } });
    if (!me?.departmentId || me.departmentId !== input.departmentId) {
      await writeAudit({
        action: AUDIT_ACTIONS.ACCESS_DENIED,
        userId: actor.id,
        entity: "folder",
        entityId: id,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        category: "SECURITY",
        severity: "WARNING",
        result: "DENIED",
        newValue: { reason: "cross_department_folder_tag", departmentId: input.departmentId },
      });
      throw new ForbiddenError("You may only scope a folder to your own department");
    }
  }

  // Circular-loop guard: refuse to move folder into its own subtree.
  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === id) {
      throw new BadRequestError("A folder cannot be its own parent");
    }
    const isCycle = await repo.isDescendantOf(input.parentId, id);
    if (isCycle) {
      throw new BadRequestError("Cannot move a folder into its own subtree");
    }
    const parent = await repo.findById(input.parentId);
    if (!parent) throw new BadRequestError("Parent folder not found");
    // BUG-1 FIX: destination folder authorization — require EDITOR or OWNER access
    // to prevent a user from moving their folder under another user's folder,
    // which would grant them cascade-delete and permission inheritance on the
    // destination tree.
    const destAccess = await resolveFolderAccess(actor.id, input.parentId);
    if (!(destAccess === "EDITOR" || destAccess === "OWNER")) {
      await writeAudit({
        action: AUDIT_ACTIONS.ACCESS_DENIED,
        userId: actor.id,
        entity: "folder",
        entityId: input.parentId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        category: "SECURITY",
        severity: "WARNING",
        result: "DENIED",
        newValue: { reason: "cross_user_folder_move_destination", required: "EDITOR", actual: destAccess },
      });
      throw new NotFoundError("Folder not found");
    }
    // Rule 3: reject a move that would place this folder at depth 6+.
    await assertDestinationDepth(input.parentId);
  }

  const updated = await repo.update({
    id,
    data: {
      name: input.name,
      parentId: input.parentId,
      departmentId: input.departmentId,
      color: input.color,
      icon: input.icon,
    },
  });

  await writeAudit({
    action: AUDIT_ACTIONS.FOLDER_UPDATED,
    userId: actor.id,
    entity: "folder",
    entityId: id,
    oldValue: {
      name: existing.name,
      parentId: existing.parentId,
      departmentId: existing.departmentId,
    },
    newValue: {
      name: updated.name,
      parentId: updated.parentId,
      departmentId: updated.departmentId,
      color: updated.color,
      icon: updated.icon,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return updated;
}

// -----------------------------------------------------------------------------
// softDeleteFolder
// -----------------------------------------------------------------------------
export async function softDeleteFolder(id: string, actor: Actor): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("Folder not found");

  // Rule 1: only the owner can delete a personal folder; direct-ID access to
  // another account's folder never reveals existence.
  if (existing.ownerId !== actor.id) {
    await writeAudit({
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      userId: actor.id,
      entity: "folder",
      entityId: id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      category: "SECURITY",
      severity: "WARNING",
      result: "DENIED",
      newValue: { reason: "cross_user_folder_delete_attempt", ownerId: existing.ownerId },
    });
    throw new NotFoundError("Folder not found");
  }

  await repo.softDelete(id);

  await writeAudit({
    action: AUDIT_ACTIONS.FOLDER_DELETED,
    userId: actor.id,
    entity: "folder",
    entityId: id,
    oldValue: { name: existing.name, parentId: existing.parentId },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  // NOTE: documents inside a soft-deleted folder are NOT auto-deleted. They
  // remain visible via their own list scoping and the folderId index.
}

// -----------------------------------------------------------------------------
// Personal repository folder lifecycle (recycle bin, copy, restore, permanent)
// -----------------------------------------------------------------------------
const MAX_FOLDER_DEPTH = 5;

async function assertOwner(actor: Actor, folder: { id: string; ownerId: string | null }): Promise<void> {
  if (folder.ownerId !== actor.id) {
    await writeAudit({
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      userId: actor.id,
      entity: "folder",
      entityId: folder.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      category: "SECURITY",
      severity: "WARNING",
      result: "DENIED",
      newValue: { reason: "cross_user_folder_access_attempt", ownerId: folder.ownerId },
    });
    throw new NotFoundError("Folder not found");
  }
}

async function assertDestinationDepth(parentId: string | null): Promise<void> {
  if (!parentId) return;
  const depth = await repo.depthOf(parentId);
  if (depth >= MAX_FOLDER_DEPTH) {
    throw new BadRequestError(`Maximum folder depth of ${MAX_FOLDER_DEPTH} exceeded`);
  }
}

/** List the owner's deleted folders (recycle bin). */
export async function listDeletedFolders(actor: Actor): Promise<{ items: FolderListItem[] }> {
  const rows = await repo.listDeleted(actor.id);
  return { items: rows };
}

export interface RestoreFolderInput {
  targetParentId?: string | null;
  conflictMode?: "keep_both" | "replace" | "cancel";
}

/**
 * Restore a deleted folder (and its still-deleted subtree) to its original
 * parent or an explicit destination, with name-conflict handling (rule 8/10).
 */
export async function restoreFolder(
  id: string,
  input: RestoreFolderInput,
  actor: Actor,
): Promise<FolderDetail> {
  const existing = await repo.findById(id, true);
  if (!existing) throw new NotFoundError("Folder not found");
  await assertOwner(actor, existing);
  if (!existing.deletedAt) throw new BadRequestError("Folder is not deleted");

  // Resolve destination: explicit target, else original parent if it still
  // exists and is owned + active, else repository root.
  let targetParentId: string | null = existing.parentId;
  if (input.targetParentId !== undefined) targetParentId = input.targetParentId;
  if (targetParentId) {
    const parent = await repo.findById(targetParentId);
    if (!parent || parent.ownerId !== actor.id || parent.deletedAt) {
      targetParentId = null;
    }
  }
  if (targetParentId) {
    await assertDestinationDepth(targetParentId);
  }

  // Name-conflict handling against ACTIVE sibling folders.
  const conflictMode = input.conflictMode ?? "keep_both";
  let restoredName = existing.name;
  if (targetParentId !== null || existing.parentId === null) {
    const clash = await repo.findSameNameFolder(targetParentId, existing.name, actor.id, id);
    if (clash && clash.id !== id) {
      if (conflictMode === "cancel") {
        throw new ConflictError(
          `A folder named "${existing.name}" already exists in the destination`,
          { existingId: clash.id },
        );
      }
      if (conflictMode === "replace") {
        await repo.softDelete(clash.id);
      } else {
        restoredName = await repo.uniqueFolderName(targetParentId, existing.name, actor.id);
      }
    }
  }

  const restored = await repo.restore(id);
  if (restored.parentId !== targetParentId || restoredName !== existing.name) {
    await repo.update({ id, data: { parentId: targetParentId, name: restoredName } });
  }

  await writeAudit({
    action: AUDIT_ACTIONS.FOLDER_RESTORED,
    userId: actor.id,
    entity: "folder",
    entityId: id,
    oldValue: { name: existing.name, deletedAt: existing.deletedAt },
    newValue: { parentId: targetParentId, name: restoredName, conflictMode },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return (await repo.findById(id, true)) ?? restored;
}

/** Large-copy threshold — copies at/above this item count run as a persisted
 * background job so the request and browser never freeze (rule 9). */
export const COPY_JOB_THRESHOLD_ITEMS = 1000;

export interface CopyFolderInput {
  targetParentId?: string | null;
  conflictMode?: "merge" | "keep_both" | "cancel";
}

export type FolderCopyJobView = {
  id: string;
  sourceFolderId: string | null;
  sourceFolderName: string | null;
  targetParentId: string | null;
  conflictMode: string;
  status: string;
  totalItems: number;
  processedItems: number;
  error: string | null;
  resultFolderId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

/**
 * Copy a folder subtree (folders + active files). Conflicts: merge into an
 * existing same-name folder, keep_both (suffix), or cancel (409). Large
 * copies are persisted as background jobs (rule 8/9).
 */
export async function copyFolder(
  id: string,
  input: CopyFolderInput,
  actor: Actor,
): Promise<{ folder?: FolderDetail; job?: FolderCopyJobView }> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("Folder not found");
  await assertOwner(actor, existing);
  if (input.targetParentId) {
    const target = await repo.findById(input.targetParentId);
    if (!target || target.ownerId !== actor.id) throw new NotFoundError("Destination folder not found");
    await assertDestinationDepth(input.targetParentId);
  }
  const conflictMode = input.conflictMode ?? "keep_both";

  const totalItems = await repo.countSubtreeItems(id);
  if (totalItems >= COPY_JOB_THRESHOLD_ITEMS) {
    const job = await startFolderCopyJob(id, input.targetParentId ?? null, conflictMode, totalItems, actor);
    return { job };
  }

  const folder = await runFolderCopy(id, input.targetParentId ?? null, conflictMode, actor);
  return { folder };
}

/** Synchronous (small) folder copy with conflict resolution. */
async function runFolderCopy(
  sourceId: string,
  targetParentId: string | null,
  conflictMode: "merge" | "keep_both" | "cancel",
  actor: Actor,
): Promise<FolderDetail> {
  const source = await repo.findById(sourceId);
  if (!source) throw new NotFoundError("Folder not found");

  const repositoryId = await ensureRepository(actor.id);
  const conflict = await repo.findSameNameFolder(targetParentId, source.name, actor.id, sourceId);
  if (conflict && conflict.id !== sourceId) {
    if (conflictMode === "cancel") {
      throw new ConflictError(`A folder named "${source.name}" already exists in the destination`, {
        existingId: conflict.id,
      });
    }
    if (conflictMode === "merge") {
      await repo.copyChildrenInto(sourceId, conflict.id, actor.id, repositoryId);
      await writeAudit({
        action: AUDIT_ACTIONS.FOLDER_COPIED,
        userId: actor.id,
        entity: "folder",
        entityId: conflict.id,
        newValue: { source: sourceId, targetParentId, name: source.name, mode: "merge" },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
      const merged = await repo.findById(conflict.id);
      if (!merged) throw new NotFoundError("Merged folder not found");
      return merged;
    }
  }

  const copiedId = await repo.copySubtree({
    sourceId,
    newParentId: targetParentId,
    ownerId: actor.id,
    repositoryId,
    total: await repo.countSubtreeItems(sourceId),
  });

  // keep_both conflict: suffix the copied root name.
  if (conflict) {
    const unique = await repo.uniqueFolderName(targetParentId, source.name, actor.id);
    await repo.update({ id: copiedId, data: { name: unique } });
  }

  const copied = await repo.findById(copiedId);
  if (!copied) throw new NotFoundError("Copied folder not found");

  await writeAudit({
    action: AUDIT_ACTIONS.FOLDER_COPIED,
    userId: actor.id,
    entity: "folder",
    entityId: copiedId,
    newValue: { source: sourceId, targetParentId, name: copied.name, conflictMode },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return copied;
}

/** Persisted background copy job via BullMQ (Sprint 8.5). */
async function startFolderCopyJob(
  sourceId: string,
  targetParentId: string | null,
  conflictMode: "merge" | "keep_both" | "cancel",
  totalItems: number,
  actor: Actor,
): Promise<FolderCopyJobView> {
  const repositoryId = await ensureRepository(actor.id);
  const job = await prisma.repositoryCopyJob.create({
    data: {
      ownerId: actor.id,
      repositoryId,
      sourceFolderId: sourceId,
      targetParentId,
      conflictMode,
      status: "PENDING",
      totalItems,
      processedItems: 0,
    },
  });

  // Enqueue to BullMQ instead of fire-and-forget IIFE
  const { enqueue, QUEUE_NAMES } = await import("@/lib/queue");
  await enqueue<{ jobRecordId: string; sourceFolderId: string; targetParentId: string | null; conflictMode: string; totalItems: number; actorId: string; repositoryId: string }>(
    QUEUE_NAMES.FOLDER_COPY,
    {
      jobRecordId: job.id,
      sourceFolderId: sourceId,
      targetParentId,
      conflictMode,
      totalItems,
      actorId: actor.id,
      repositoryId,
    },
  );

  return toCopyJobView(job);
}

function toCopyJobView(job: {
  id: string;
  sourceFolderId: string | null;
  targetParentId: string | null;
  conflictMode: string;
  status: string;
  totalItems: number;
  processedItems: number;
  error: string | null;
  resultFolderId: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}): FolderCopyJobView {
  return {
    id: job.id,
    sourceFolderId: job.sourceFolderId,
    sourceFolderName: null,
    targetParentId: job.targetParentId,
    conflictMode: job.conflictMode,
    status: job.status,
    totalItems: job.totalItems,
    processedItems: job.processedItems,
    error: job.error,
    resultFolderId: job.resultFolderId,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

export async function listCopyJobs(actor: Actor): Promise<FolderCopyJobView[]> {
  const jobs = await prisma.repositoryCopyJob.findMany({
    where: { ownerId: actor.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const sourceIds = [...new Set(jobs.map((job) => job.sourceFolderId).filter(Boolean))] as string[]
  const sources = sourceIds.length > 0
    ? await prisma.folder.findMany({ where: { id: { in: sourceIds } }, select: { id: true, name: true } })
    : []
  const sourceMap = new Map(sources.map((s) => [s.id, s.name]))
  return jobs.map((job) => {
    const view = toCopyJobView(job)
    view.sourceFolderName = job.sourceFolderId ? sourceMap.get(job.sourceFolderId) ?? null : null
    return view
  })
}

export async function getCopyJob(id: string, actor: Actor): Promise<FolderCopyJobView> {
  const job = await prisma.repositoryCopyJob.findFirst({
    where: { id, ownerId: actor.id },
  });
  if (!job) throw new NotFoundError("Copy job not found");
  const view = toCopyJobView(job);
  if (job.sourceFolderId) {
    const source = await prisma.folder.findUnique({ where: { id: job.sourceFolderId }, select: { name: true } })
    view.sourceFolderName = source?.name ?? null
  }
  return view
}

/** Permanently delete a folder subtree (hard delete). */
export async function permanentDeleteFolder(id: string, actor: Actor): Promise<void> {
  const existing = await repo.findById(id, true);
  if (!existing) throw new NotFoundError("Folder not found");
  await assertOwner(actor, existing);

  await repo.permanentDelete(id);
  await writeAudit({
    action: AUDIT_ACTIONS.FOLDER_PERMANENTLY_DELETED,
    userId: actor.id,
    entity: "folder",
    entityId: id,
    oldValue: { name: existing.name },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

// ── Quick access pins ────────────────────────────────────────────────────────

export async function pinFolder(id: string, actor: Actor): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("Folder not found");
  await assertOwner(actor, existing);
  await prisma.repositoryPin.upsert({
    where: { ownerId_folderId: { ownerId: actor.id, folderId: id } },
    create: { ownerId: actor.id, folderId: id },
    update: {},
  });
  await writeAudit({
    action: AUDIT_ACTIONS.FOLDER_PINNED,
    userId: actor.id,
    entity: "folder",
    entityId: id,
    newValue: { name: existing.name },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

export async function unpinFolder(id: string, actor: Actor): Promise<void> {
  await prisma.repositoryPin.deleteMany({ where: { ownerId: actor.id, folderId: id } });
  await writeAudit({
    action: AUDIT_ACTIONS.FOLDER_UNPINNED,
    userId: actor.id,
    entity: "folder",
    entityId: id,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

export async function listPinnedFolders(actor: Actor): Promise<{ items: FolderListItem[] }> {
  const pins = await prisma.repositoryPin.findMany({
    where: { ownerId: actor.id },
    include: { folder: true },
    orderBy: { createdAt: "desc" },
  });
  const items = pins
    .map((pin) => pin.folder)
    .filter((folder): folder is NonNullable<typeof folder> => folder !== null && folder.deletedAt === null)
    .map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      departmentId: folder.departmentId,
      ownerId: folder.ownerId,
      color: folder.color ?? null,
      icon: folder.icon ?? null,
      documentCount: 0,
      childCount: 0,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    }));
  return { items };
}

// -----------------------------------------------------------------------------
// resolveMyFolderStructure (Sprint 7.4.3)
// -----------------------------------------------------------------------------
// The Document Repository's upload-destination structure is defined by the
// Folder Builder (Sprint 7.4.3): the folder template ASSIGNED to the user's
// org unit wins, falling back up the chain DEPARTMENT → COLLEGE → UNIVERSITY.
// Only when NO template is assigned anywhere up the chain does the legacy
// flat Folder structure apply (source: "legacy"), preserving pre-7.4.3
// behavior. Read-only; no audit (project convention, AI_CONTEXT §8).

function buildResolvedTree(
  rows: repo.FolderTemplateNodeRow[],
): ResolvedFolderNode[] {
  const byParent = new Map<string | null, ResolvedFolderNode[]>();
  for (const row of rows) {
    const node: ResolvedFolderNode = {
      id: row.id,
      parentId: row.parentId,
      name: row.name,
      description: row.description,
      level: row.level,
      sortOrder: row.sortOrder,
      icon: row.icon,
      color: row.color,
      visibility: row.visibility,
      status: row.status,
      children: [],
    };
    const bucket = byParent.get(row.parentId) ?? [];
    bucket.push(node);
    byParent.set(row.parentId, bucket);
  }
  const attach = (parentId: string | null): ResolvedFolderNode[] => {
    const bucket = byParent.get(parentId) ?? [];
    for (const node of bucket) {
      node.children = attach(node.id);
    }
    return bucket;
  };
  return attach(null);
}

export async function resolveMyFolderStructure(actor: Actor): Promise<ResolvedFolderStructure> {
  const context = await repo.findUserOrgContext(actor.id);
  const targets: repo.AssignmentTargetScope[] = [];
  if (context?.departmentId) targets.push({ type: "DEPARTMENT", id: context.departmentId });
  if (context?.collegeId) targets.push({ type: "COLLEGE", id: context.collegeId });
  targets.push({ type: "UNIVERSITY", id: null });

  const assignment = await repo.findFolderTemplateAssignment(targets);
  if (assignment) {
    const template = await repo.findTemplateBrief(assignment.templateId);
    const rows = await repo.listFolderTemplateNodes(assignment.templateId);
    return {
      source: "template",
      template: template
        ? { id: template.id, name: template.name, code: template.code, icon: template.icon, color: template.color }
        : null,
      assignment: { id: assignment.id, targetType: assignment.targetType, targetId: assignment.targetId },
      tree: buildResolvedTree(rows),
      legacyFolders: [],
    };
  }

  // No assignment anywhere up the chain — fall back to the legacy structure.
  const where: Prisma.FolderWhereInput = { deletedAt: null };
  where.OR = [{ ownerId: actor.id }, { departmentId: { not: null } }];
  const legacyFolders = await repo.list(where);
  if (legacyFolders.length === 0) {
    return { source: "none", template: null, assignment: null, tree: [], legacyFolders: [] };
  }
  return { source: "legacy", template: null, assignment: null, tree: [], legacyFolders };
}

// -----------------------------------------------------------------------------
// Folder information (rule 12) — recursive counts + size, aggregate queries.
// -----------------------------------------------------------------------------
export async function getFolderInfo(id: string, actor: Actor) {
  const folder = await repo.findById(id);
  if (!folder) throw new NotFoundError("Folder not found");
  await assertFolderAccess(actor.id, id, "VIEWER");
  return repo.getFolderInfo(id);
}

// -----------------------------------------------------------------------------
// Folder ZIP download (rule 14) — streaming store-method archive of the ACTIVE
// subtree. Data flows chunk-by-chunk from MinIO; the archive is never held in
// memory. CRC32 is computed incrementally and written with data descriptors.
// The archive writer itself lives in @/lib/zipStream (shared with the AACCUP
// approved-package export).
// -----------------------------------------------------------------------------

/**
 * Build a streaming ZIP of the folder's ACTIVE subtree. Returns a Readable
 * (async generator) plus the download filename. Entry paths mirror the folder
 * structure; deleted items and hidden internal data are excluded.
 */
export async function downloadFolderZip(
  id: string,
  actor: Actor,
): Promise<{ filename: string; stream: Readable }> {
  const folder = await repo.findById(id);
  if (!folder) throw new NotFoundError("Folder not found");
  await assertFolderAccess(actor.id, id, "VIEWER");

  // Collect the active subtree with safe relative paths.
  interface Node {
    folderId: string;
    name: string;
    relPath: string;
    modifiedAt: Date;
  }
  const folderNodes: Node[] = [];
  const stack: Node[] = [{ folderId: id, name: folder.name, relPath: sanitizeZipSegment(folder.name), modifiedAt: folder.updatedAt }];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    folderNodes.push(node);
    const children = await prisma.folder.findMany({
      where: { parentId: node.folderId, deletedAt: null },
      select: { id: true, name: true, updatedAt: true },
      orderBy: { name: "asc" },
    });
    for (const child of children) {
      stack.push({
        folderId: child.id,
        name: child.name,
        relPath: `${node.relPath}/${sanitizeZipSegment(child.name)}`,
        modifiedAt: child.updatedAt,
      });
    }
  }

  const fileEntries: Array<{
    relPath: string;
    objectKey: string;
    size: number;
    modifiedAt: Date;
  }> = [];
  for (const node of folderNodes) {
    const files = await prisma.document.findMany({
      where: { folderId: node.folderId, deletedAt: null },
      select: {
        updatedAt: true,
        currentVersion: {
          select: { objectKey: true, filename: true, sizeBytes: true },
        },
      },
      orderBy: { title: "asc" },
    });
    for (const file of files) {
      if (!file.currentVersion) continue;
      fileEntries.push({
        relPath: `${node.relPath}/${sanitizeZipSegment(file.currentVersion.filename)}`,
        objectKey: file.currentVersion.objectKey,
        size: Number(file.currentVersion.sizeBytes),
        modifiedAt: file.updatedAt,
      });
    }
  }

  const base = folder.name.replace(/[^\w -]/g, "").trim().replace(/\s+/g, "-") || "folder";
  const filename = `${base}.zip`;

  const dirs: ZipDirectoryEntry[] = folderNodes.map((node) => ({
    path: `${node.relPath}/`,
    time: node.modifiedAt,
  }));
  const files: ZipFileEntry[] = fileEntries.map((entry) => ({
    path: entry.relPath,
    objectKey: entry.objectKey,
    size: entry.size,
    time: entry.modifiedAt,
  }));
  const stream = streamZipArchive(dirs, files);

  // Folder ZIP downloads are audited once at the service boundary (rule 23).
  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_DOWNLOADED,
    userId: actor.id,
    entity: "folder",
    entityId: id,
    newValue: { zip: true, fileCount: fileEntries.length },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return { filename, stream };
}
