import {
  presignDownload,
  presignUpload,
  statObject,
  getObjectStream,
  deleteObject,
  objectExists,
  thumbnailObjectKey,
  previewObjectKey,
  putObject,
} from "@/lib/storage";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import { notifyUser, notifyUsers } from "@/modules/notifications/notifications.service";
import type { NotificationType } from "@prisma/client";
import { getConfigValue } from "@/modules/root/root.config.service";
import { ensureRepository } from "@/modules/repositories/repository.repository";
import {
  bindWorkflowInstance,
  evaluateWorkflowAction,
  recordWorkflowAction,
  scopesForDocument,
} from "@/modules/workflow/workflow.engine";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError } from "@/utils/errors";
import { env } from "@/config/env";
import { resolveFolderAccess, assertFolderAccess } from "@/modules/folders/folderSharing.service";
import * as repo from "@/modules/documents/documents.repository";
import type { Prisma } from "@prisma/client";
import type { ListDocumentsQuery } from "@/modules/documents/documents.validator";
import type { CopyDocumentInput } from "@/modules/documents/documents.validator";
import { documentSelect } from "@/modules/documents/documents.types";
import type {
  AddVersionInput,
  CreateDocumentInput,
  ShareDocumentInput,
  UpdateDocumentInput,
} from "@/modules/documents/documents.validator";
import type {
  DocumentDetail,
  DocumentListItem,
  DocumentVersionView,
} from "@/modules/documents/documents.types";
import type { DocumentStatus } from "@prisma/client";

// =============================================================================
// URS-DMS â€” documents service
// RBAC model:
//   - "managers" = users holding documents.delete (admins + QAOs).
//   - otherwise: owner OR active share OR folder/department scope.
// No `if (role === "admin")` anywhere â€” every check routes through permissions.
// =============================================================================

// Sprint 7.4.5 â€” document status â†’ workflow action adapter (glue convention,
// not workflow data: the action names themselves are authored by ROOT).
const DOCUMENT_STATUS_ACTIONS: Record<DocumentStatus, string> = {
  DRAFT: "RESET_TO_DRAFT",
  UNDER_REVIEW: "SUBMIT_FOR_REVIEW",
  APPROVED: "APPROVE",
  PUBLISHED: "PUBLISH",
  ARCHIVED: "ARCHIVE",
};

export interface ListResult {
  items: DocumentListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface DocumentWithVersionUrl {
  document: DocumentDetail;
  upload: {
    url: string;
    objectKey: string;
    headers: Record<string, string>;
    expiresInSeconds: number;
  };
}

export interface DownloadResult {
  url: string;
  objectKey: string;
  expiresInSeconds: number;
  filename: string;
  sizeBytes: string;
  mimeType: string;
}

export interface Actor {
  id: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

const SHARE_PERMISSIONS = ["READ", "WRITE", "OWNER"] as const;
type SharePermissionValue = (typeof SHARE_PERMISSIONS)[number];

// Rule 1 / D-002: repository access is OWNERSHIP-BASED. Member roles hold
// documents.delete for their own repository, so a permission-based "manager"
// shortcut would let any account bypass ownership. Managers see other
// accounts' records only through explicit management surfaces (reports,
// submission review), never through the documents API.
function canReadWrite(actor: Actor, ownerId: string): boolean {
  if (actor.id === ownerId) return true;
  return false;
}

async function assertCanRead(actor: Actor, doc: { ownerId: string; id: string; folderId?: string | null }): Promise<void> {
  if (canReadWrite(actor, doc.ownerId)) return;
  if (doc.folderId && (await resolveFolderAccess(actor.id, doc.folderId)) !== "NONE") return;
  const share = await repo.findActiveShare(doc.id, actor.id);
  if (share) return;
  // Rule 22: AACCUP submission review and document-request management are the
  // CONTROLLED transfer mechanisms — an authorized reviewer/manager may READ
  // a document that is the subject of a submission/request (never write).
  if (await hasManagedReadAccess(actor, doc.id)) return;
  // Rule 1: direct-ID access to another account's item must NOT reveal
  // existence — always 404. The denial audit is awaited so the DENIED row is
  // persisted before the error propagates to the client.
  await writeAudit({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    userId: actor.id,
    entity: "document",
    entityId: doc.id,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    category: "SECURITY",
    severity: "WARNING",
    result: "DENIED",
    newValue: { reason: "cross_user_read_attempt", ownerId: doc.ownerId },
  });
  throw new NotFoundError("Document not found");
}

/** Controlled-transfer read access (rule 22) — review/request surfaces only. */
async function hasManagedReadAccess(actor: Actor, documentId: string): Promise<boolean> {
  try {
    if (actor.permissions.includes("aaccup.submission.review")) {
      const submission = await prisma.aaccupSubmission.findFirst({
        where: { documentId, deletedAt: null },
        select: { id: true },
      });
      if (submission) return true;
    }
    if (actor.permissions.includes("request.manage")) {
      const request = await prisma.documentRequest.findFirst({
        where: { documentId },
        select: { id: true },
      });
      if (request) return true;
    }
  } catch {
    // best-effort; ownership checks above are authoritative
  }
  return false;
}

async function assertCanWrite(actor: Actor, doc: { ownerId: string; id: string; folderId?: string | null }): Promise<void> {
  if (actor.id === doc.ownerId) return;
  if (doc.folderId && (await resolveFolderAccess(actor.id, doc.folderId)) === "EDITOR") return;
  const share = await repo.findActiveShare(doc.id, actor.id);
  if (share && (share.permission === "WRITE" || share.permission === "OWNER")) return;
  await writeAudit({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    userId: actor.id,
    entity: "document",
    entityId: doc.id,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    category: "SECURITY",
    severity: "WARNING",
    result: "DENIED",
    newValue: { reason: "cross_user_write_attempt", ownerId: doc.ownerId },
  });
  throw new NotFoundError("Document not found");
}

async function assertCanManage(actor: Actor, doc: { ownerId: string; id: string }): Promise<void> {
  if (actor.id === doc.ownerId) return;
  await writeAudit({
    action: AUDIT_ACTIONS.ACCESS_DENIED,
    userId: actor.id,
    entity: "document",
    entityId: doc.id,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    category: "SECURITY",
    severity: "WARNING",
    result: "DENIED",
    newValue: { reason: "cross_user_manage_attempt", ownerId: doc.ownerId },
  });
  throw new NotFoundError("Document not found");
}

// -----------------------------------------------------------------------------
// listDocuments
// -----------------------------------------------------------------------------
export async function listDocuments(query: ListDocumentsQuery, actor: Actor): Promise<ListResult> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const where: Prisma.DocumentWhereInput = { deletedAt: null };

  if (query.status) where.status = query.status;
  if (query.classification) where.classification = query.classification;
  if (query.departmentId) where.departmentId = query.departmentId;
  if (query.folderId !== undefined) {
    where.folderId = query.folderId; // null => root-level documents (no folder)
    if (query.folderId) {
      await assertFolderAccess(actor.id, query.folderId, "VIEWER");
      delete where.ownerId;
    }
  }
  if (query.ownerId) where.ownerId = query.ownerId;
  if (query.uploadedById) {
    where.versions = { some: { uploadedById: query.uploadedById } };
  }
  if (query.tag) where.tags = { some: { tag: query.tag } };

  // Rule 1 / D-002: lists are ALWAYS owner-or-shared scoped — the manager
  // bypass was removed because member roles legitimately hold
  // documents.delete for their own repository.
  where.OR = query.folderId ? [{ folderId: query.folderId }] : [{ ownerId: actor.id }, { shares: { some: { userId: actor.id } } }];

  if (query.q) {
    const qFilter: Prisma.DocumentWhereInput = {
      OR: [
        { title: { contains: query.q, mode: "insensitive" } },
        { description: { contains: query.q, mode: "insensitive" } },
        { versions: { some: { filename: { contains: query.q, mode: "insensitive" } } } },
      ],
    };
    if (where.OR) {
      where.AND = [{ OR: where.OR }, qFilter];
      delete where.OR;
    } else {
      where.OR = qFilter.OR;
    }
  }

  const sortField = query.sort ?? "updatedAt";
  const sortOrder = query.order ?? "desc";
  const orderBy: Prisma.DocumentOrderByWithRelationInput = { [sortField]: sortOrder };

  const r = await repo.list(where, page, pageSize, orderBy);
  return {
    items: await enrichSubmissionStatuses(r.items),
    meta: {
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
      totalPages: Math.max(1, Math.ceil(r.total / r.pageSize)),
    },
  };
}

// -----------------------------------------------------------------------------
// getDocument
// -----------------------------------------------------------------------------
export async function getDocument(id: string, actor: Actor): Promise<DocumentDetail> {
  const doc = await repo.findById(id);
  if (!doc) throw new NotFoundError("Document not found");
  await assertCanRead(actor, doc);
  return doc;
}

// -----------------------------------------------------------------------------
// createDocument
// -----------------------------------------------------------------------------
export async function createDocument(
  input: CreateDocumentInput,
  actor: Actor,
): Promise<DocumentWithVersionUrl> {
  if (input.folderId) await assertFolderAccess(actor.id, input.folderId, "EDITOR");
  let created: DocumentDetail | undefined;
  await prisma.$transaction(async (tx) => {
    created = await repo.create(
      {
        ownerId: actor.id,
        departmentId: input.departmentId ?? null,
        folderId: input.folderId ?? null,
        title: input.title,
        description: input.description ?? null,
        classification: input.classification,
        retentionUntil: input.retentionUntil ?? null,
        metadata: (input.metadata ?? null) as Prisma.InputJsonValue | null,
      },
      tx,
    );

    // Sprint 7.4.5 â€” bind a published workflow instance (if one is assigned
    // to the document's folder/department scope) inside the same transaction.
    // No assignment â†’ legacy flow unchanged.
    const scopes = await scopesForDocument(created.id, tx);
    await bindWorkflowInstance({
      entityType: "DOCUMENT",
      entityId: created.id,
      scopes,
      actor,
      tx,
    });
  });
  if (!created) throw new BadRequestError("Document creation failed");

  if (input.tags && input.tags.length > 0) {
    await repo.setTags(created.id, input.tags);
  }

  const versionNumber = 1;
  // The object key embeds the (future) versionId. Because we have not yet
  // created the version row, we mint a placeholder using the documentId +
  // versionNumber. The first actual upload must use exactly this key.
  // NOTE: the controller/handler that finalizes the upload should persist
  //       a DocumentVersion row with this same objectKey.
  const objectKey = `documents/${created.id}/v${versionNumber}/initial`;
  const upload = await presignUpload(
    created.id,
    `v${versionNumber}`,
    "initial",
    "application/octet-stream",
    0,
  );

  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_CREATED,
    userId: actor.id,
    entity: "document",
    entityId: created.id,
    newValue: {
      title: created.title,
      classification: created.classification,
      ownerId: created.ownerId,
      hasInitialVersion: false,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  const refreshed = await repo.findById(created.id);
  return {
    document: refreshed ?? created,
    upload: {
      url: upload.url,
      objectKey,
      headers: upload.headers,
      expiresInSeconds: upload.expiresInSeconds,
    },
  };
}

// -----------------------------------------------------------------------------
// updateDocument
// -----------------------------------------------------------------------------
export async function updateDocument(
  id: string,
  input: UpdateDocumentInput,
  actor: Actor,
): Promise<DocumentDetail> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("Document not found");
  await assertCanWrite(actor, existing);

  // BUG-2 FIX: only the document owner may change its departmentId; WRITE sharees
  // must not be able to reclassify the document into another department archive.
  if (
    input.departmentId !== undefined &&
    input.departmentId !== existing.departmentId &&
    actor.id !== existing.ownerId
  ) {
    await writeAudit({
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      userId: actor.id,
      entity: "document",
      entityId: id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      category: "SECURITY",
      severity: "WARNING",
      result: "DENIED",
      newValue: { reason: "non_owner_department_change", ownerId: existing.ownerId },
    });
    throw new ForbiddenError("Only the document owner can change its department");
  }

  // Moving a document requires write access to the destination folder, exactly
  // like createDocument. Without this a WRITE-share holder could relocate the
  // owner's document into a folder they control and retain access after the
  // share expires.
  if (
    input.folderId !== undefined &&
    input.folderId !== null &&
    input.folderId !== existing.folderId
  ) {
    await assertFolderAccess(actor.id, input.folderId, "EDITOR");
  }

  const statusChanged =
    input.status !== undefined && input.status !== existing.status;
  let updated: DocumentDetail | undefined;
  let evaluation: Awaited<ReturnType<typeof evaluateWorkflowAction>> = null;
  await prisma.$transaction(async (tx) => {
    // Sprint 7.4.5 â€” workflow gate on status transitions: if a published
    // workflow controls this document, the status change must be an allowed
    // action from the current step (legacy fallback when no instance is
    // bound). Non-status edits skip the gate entirely.
    if (statusChanged) {
      evaluation = await evaluateWorkflowAction(
        "DOCUMENT",
        id,
        DOCUMENT_STATUS_ACTIONS[input.status as DocumentStatus],
        actor,
        tx,
      );
    }
    updated = await repo.update(
      {
        id,
        data: {
          title: input.title,
          description: input.description,
          classification: input.classification,
          status: input.status,
          folderId: input.folderId,
          departmentId: input.departmentId,
          retentionUntil: input.retentionUntil,
          metadata:
            input.metadata === undefined
              ? undefined
              : ((input.metadata ?? null) as Prisma.InputJsonValue | null),
        },
      },
      tx,
    );
    if (evaluation) {
      await recordWorkflowAction(tx, evaluation, actor, undefined);
    }
  });
  if (!updated) throw new BadRequestError("Document update failed");

  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_UPDATED,
    userId: actor.id,
    entity: "document",
    entityId: id,
    oldValue: {
      title: existing.title,
      status: existing.status,
      classification: existing.classification,
      folderId: existing.folderId,
      departmentId: existing.departmentId,
    },
    newValue: {
      title: updated.title,
      status: updated.status,
      classification: updated.classification,
      folderId: updated.folderId,
      departmentId: updated.departmentId,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return updated;
}

// -----------------------------------------------------------------------------
// softDeleteDocument
// -----------------------------------------------------------------------------
export async function softDeleteDocument(id: string, actor: Actor): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("Document not found");
  await assertCanManage(actor, existing);

  await repo.softDelete(id);

  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_DELETED,
    userId: actor.id,
    entity: "document",
    entityId: id,
    oldValue: { title: existing.title, ownerId: existing.ownerId },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  // NOTE: physical MinIO object cleanup is intentionally deferred â€” soft-deleted
  // documents may be restored. A scheduled job should purge objects once the
  // document row is permanently destroyed (out of Sprint 3 scope).
}

// -----------------------------------------------------------------------------
// restoreDocument (recycle bin) — owner-only, conflict-aware (rule 10/8)
// -----------------------------------------------------------------------------
export interface RestoreDocumentInput {
  targetFolderId?: string | null;
  conflictMode?: "keep_both" | "replace" | "cancel";
}

export async function restoreDocument(
  id: string,
  input: RestoreDocumentInput,
  actor: Actor,
): Promise<DocumentDetail> {
  const existing = await repo.findByIdIncludingDeleted(id);
  if (!existing) throw new NotFoundError("Document not found");
  if (existing.ownerId !== actor.id) {
    await writeAudit({
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      userId: actor.id,
      entity: "document",
      entityId: id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      category: "SECURITY",
      severity: "WARNING",
      result: "DENIED",
      newValue: { reason: "cross_user_restore_attempt", ownerId: existing.ownerId },
    });
    throw new NotFoundError("Document not found");
  }

  // Resolve the destination folder: explicit target, else original parent if
  // it still exists and is owned + active, else repository root.
  let targetFolderId: string | null = existing.folderId;
  if (input.targetFolderId !== undefined) targetFolderId = input.targetFolderId;
  if (targetFolderId) {
    const target = await prisma.folder.findFirst({
      where: { id: targetFolderId, ownerId: actor.id, deletedAt: null },
      select: { id: true },
    });
    if (!target) targetFolderId = null;
  }

  // Name-conflict handling against ACTIVE files in the destination.
  const conflictMode = input.conflictMode ?? "keep_both";
  let restoredTitle = existing.title;
  if (targetFolderId) {
    const clash = await prisma.document.findFirst({
      where: {
        ownerId: actor.id,
        folderId: targetFolderId,
        deletedAt: null,
        title: existing.title,
      },
      select: { id: true, title: true },
    });
    if (clash) {
      if (conflictMode === "cancel") {
        throw new ConflictError(
          `A file named "${existing.title}" already exists in the destination`,
          { existingId: clash.id },
        );
      }
      if (conflictMode === "replace") {
        await prisma.document.update({ where: { id: clash.id }, data: { deletedAt: new Date() } });
      } else {
        // keep_both: suffix the restored file's title.
        restoredTitle = await uniqueCopyTitle(actor.id, targetFolderId, existing.title);
      }
    }
  }

  const restored = await repo.restore(id);
  if (restored.folderId !== targetFolderId || restoredTitle !== existing.title) {
    await prisma.document.update({ where: { id }, data: { folderId: targetFolderId, title: restoredTitle } });
    restored.folderId = targetFolderId;
    restored.title = restoredTitle;
  }

  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_RESTORED,
    userId: actor.id,
    entity: "document",
    entityId: id,
    newValue: { folderId: targetFolderId, conflictMode },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return (await repo.findByIdIncludingDeleted(id)) ?? restored;
}

// -----------------------------------------------------------------------------
// Resolve a document URL without deciding which user action caused it. Preview
// and download share authorization, version selection, and recents behavior,
// but they must emit different audit actions.
// -----------------------------------------------------------------------------
interface ResolvedDocumentUrl {
  result: DownloadResult;
  versionId: string;
}

const OFFICE_PREVIEW_TYPES = new Set([
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function getConvertedPreview(
  objectKey: string,
  filename: string,
  mimeType: string,
): Promise<DownloadResult | null> {
  if (!OFFICE_PREVIEW_TYPES.has(mimeType) || !env.GOTENBERG_URL) return null;

  const convertedKey = previewObjectKey(objectKey);
  if (!await objectExists(convertedKey)) {
    const source = await streamToBuffer(await getObjectStream(objectKey));
    const form = new FormData();
    form.append("files", new Blob([source], { type: mimeType }), filename);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), env.GOTENBERG_TIMEOUT_MS);
    try {
      const response = await fetch(`${env.GOTENBERG_URL}/forms/libreoffice/convert`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ServiceUnavailableError("Document preview conversion failed", { status: response.status });
      }
      const pdf = Buffer.from(await response.arrayBuffer());
      if (pdf.length === 0) throw new ServiceUnavailableError("Document preview conversion returned no data");
      await putObject(convertedKey, pdf, pdf.length, "application/pdf");
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      throw new ServiceUnavailableError("Document preview conversion is unavailable", {
        reason: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  const converted = await statObject(convertedKey);
  const download = await presignDownload(convertedKey, { inline: true });
  return {
    url: download.url,
    objectKey: convertedKey,
    expiresInSeconds: download.expiresInSeconds,
    filename: filename.replace(/\.[^.]+$/, "") + ".pdf",
    sizeBytes: String(converted.size),
    mimeType: "application/pdf",
  };
}

async function resolveDocumentUrl(
  id: string,
  actor: Actor,
  versionId?: string,
  opts: { inline?: boolean } = {},
): Promise<ResolvedDocumentUrl> {
  const doc = await repo.findById(id);
  if (!doc) throw new NotFoundError("Document not found");
  await assertCanRead(actor, doc);

  let version:
    | DocumentVersionView
    | { id: string; objectKey: string; filename: string; mimeType: string; sizeBytes: string }
    | undefined;
  if (versionId) {
    version = doc.versions.find((v) => v.id === versionId);
    if (!version) throw new NotFoundError("Version not found");
  } else {
    // Prefer the explicitly promoted current version. Only fall back to the
    // newest row for legacy documents whose currentVersionId predates the
    // field — otherwise an unverified/abandoned version would be served as
    // the document's content.
    const current =
      (doc.currentVersionId
        ? doc.versions.find((v) => v.id === doc.currentVersionId)
        : undefined) ?? doc.versions[0];
    if (!current) throw new NotFoundError("Document has no versions");
    version = current;
  }

  const dl = await presignDownload(version.objectKey, opts);

  // Record the file in the owner's recents (best-effort).
  await recordRecent(actor, "FILE", id);

  return {
    versionId: version.id,
    result: {
      url: dl.url,
      objectKey: dl.objectKey,
      expiresInSeconds: dl.expiresInSeconds,
      filename: version.filename,
      sizeBytes: version.sizeBytes,
      mimeType: version.mimeType,
    },
  };
}

export async function getDownloadUrl(
  id: string,
  actor: Actor,
  versionId?: string,
): Promise<DownloadResult> {
  const { result, versionId: resolvedVersionId } = await resolveDocumentUrl(
    id,
    actor,
    versionId,
    { inline: false },
  );
  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_DOWNLOADED,
    userId: actor.id,
    entity: "document",
    entityId: id,
    newValue: { versionId: resolvedVersionId, objectKey: result.objectKey },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return result;
}

// -----------------------------------------------------------------------------
// getPreviewUrl - preview is a read of the latest version rendered inline and
// must never emit document.downloaded.
// -----------------------------------------------------------------------------
export async function getPreviewUrl(id: string, actor: Actor): Promise<DownloadResult> {
  const { result } = await resolveDocumentUrl(id, actor, undefined, { inline: true });
  const convertedPreview = await getConvertedPreview(result.objectKey, result.filename, result.mimeType);
  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_PREVIEWED,
    userId: actor.id,
    entity: "document",
    entityId: id,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  return convertedPreview ?? result;
}

export async function getThumbnailStream(id: string, actor: Actor): Promise<{ stream: Readable; mimeType: string; filename: string }> {
  const doc = await repo.findById(id);
  if (!doc) throw new NotFoundError("Document not found");
  await assertCanRead(actor, doc);
  const version =
    (doc.currentVersionId ? doc.versions.find((v) => v.id === doc.currentVersionId) : undefined) ??
    doc.versions[0];
  if (!version) throw new NotFoundError("Document has no versions");
  const key = thumbnailObjectKey(version.objectKey);
  if (!(await objectExists(key))) {
    try {
      const { processDocumentThumbnailJob } = await import("@/workers/documentThumbnail.worker");
      await processDocumentThumbnailJob({ data: { objectKey: version.objectKey, mimeType: version.mimeType } });
    } catch {
      throw new NotFoundError("Thumbnail is not ready");
    }
  }
  if (!(await objectExists(key))) throw new NotFoundError("Thumbnail is not ready");
  return { stream: await getObjectStream(key), mimeType: "image/webp", filename: `${version.filename}.webp` };
}

// -----------------------------------------------------------------------------
// Personal repository document lifecycle (copy, recycle bin, favorites)
// -----------------------------------------------------------------------------

/**
 * Attach the latest AACCUP submission status to list items (badges). One
 * batched query per list — never N+1. Submission state is the authoritative
 * source; status is never inferred.
 */
async function enrichSubmissionStatuses(items: DocumentListItem[]): Promise<DocumentListItem[]> {
  if (items.length === 0) return items;
  const ids = items.map((item) => item.id);
  const submissions = await prisma.aaccupSubmission.findMany({
    where: { documentId: { in: ids }, deletedAt: null },
    orderBy: { submittedAt: "desc" },
    select: { documentId: true, status: true },
  });
  const latest = new Map<string, NonNullable<DocumentListItem["submissionStatus"]>>();
  for (const submission of submissions) {
    if (!latest.has(submission.documentId)) latest.set(submission.documentId, submission.status);
  }
  return items.map((item) => ({ ...item, submissionStatus: latest.get(item.id) ?? null }));
}

/** List the owner's deleted documents (recycle bin). */
export async function listDeletedDocuments(actor: Actor): Promise<DocumentListItem[]> {
  const rows = await prisma.document.findMany({
    where: { ownerId: actor.id, deletedAt: { not: null } },
    select: documentSelect,
    orderBy: { updatedAt: "desc" },
  });
  return enrichSubmissionStatuses(rows.map((row) => repo.toListItemPublic(row)));
}

/**
 * List the owner's Requested Documents — documents delivered through approved
 * document requests. Delivery creates an owner-owned copy flagged with
 * metadata.delivered = true (requests module), so this is a pure owner-scoped
 * read; access, never ownership of the source document (spec §10.2).
 */
export async function listRequestedDocuments(actor: Actor): Promise<DocumentListItem[]> {
  const rows = await prisma.document.findMany({
    where: {
      ownerId: actor.id,
      deletedAt: null,
      metadata: { path: ["delivered"], equals: true },
    },
    select: documentSelect,
    orderBy: { updatedAt: "desc" },
  });
  return rows.map((row) => repo.toListItemPublic(row));
}

/**
 * Copy a document into a folder (or root). The copy is a fresh record
 * referencing the same immutable version object(s); replacing one copy never
 * alters the other. Name conflicts: keep_both auto-suffixes "(n)".
 */
export async function copyDocument(
  id: string,
  input: CopyDocumentInput,
  actor: Actor,
): Promise<DocumentDetail> {
  const source = await repo.findById(id);
  if (!source) throw new NotFoundError("Document not found");
  await assertCanWrite(actor, source);

  if (input.targetFolderId) {
    await assertFolderAccess(actor.id, input.targetFolderId, "EDITOR");
  }

  const repositoryId = await ensureRepository(actor.id);
  let title = source.title;
  if (input.conflictMode === "keep_both" || input.conflictMode === "replace" || input.conflictMode === "cancel") {
    const conflict = await prisma.document.findFirst({
      where: { ownerId: actor.id, folderId: input.targetFolderId ?? null, title, deletedAt: null },
      select: { id: true },
    });
    if (conflict && input.conflictMode === "cancel") {
      throw new ConflictError("A file with this name already exists in the destination");
    }
    if (conflict && input.conflictMode === "replace") {
      await prisma.document.update({ where: { id: conflict.id }, data: { deletedAt: new Date() } });
    }
    if (conflict && input.conflictMode === "keep_both") {
      title = await uniqueCopyTitle(actor.id, input.targetFolderId ?? null, source.title);
    }
  }

  const copied = await prisma.document.create({
    data: {
      title,
      description: source.description,
      classification: source.classification,
      metadata: source.metadata as Prisma.InputJsonValue | undefined,
      ownerId: actor.id,
      folderId: input.targetFolderId ?? null,
      repositoryId,
    },
  });

  // Copy current version as a shared immutable blob reference.
  const current = await prisma.documentVersion.findFirst({
    where: { documentId: id, id: source.currentVersionId ?? undefined },
    orderBy: { versionNumber: "desc" },
  });
  if (current) {
    const newVersion = await prisma.documentVersion.create({
      data: {
        documentId: copied.id,
        versionNumber: 1,
        objectKey: current.objectKey,
        filename: current.filename,
        mimeType: current.mimeType,
        sizeBytes: current.sizeBytes,
        checksum: current.checksum,
        changeNote: "Copied file",
        uploadedById: actor.id,
      },
    });
    await prisma.document.update({ where: { id: copied.id }, data: { currentVersionId: newVersion.id } });
  }

  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_COPIED,
    userId: actor.id,
    entity: "document",
    entityId: copied.id,
    newValue: { source: id, targetFolderId: input.targetFolderId ?? null, title },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  const detail = await repo.findById(copied.id);
  if (!detail) throw new NotFoundError("Copied document not found");
  return detail;
}

async function uniqueCopyTitle(ownerId: string, folderId: string | null, base: string): Promise<string> {
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  const clashes = await prisma.document.findMany({
    where: { ownerId, folderId, title: { startsWith: stem }, deletedAt: null },
    select: { title: true },
  });
  const clashSet = new Set(clashes.map((c) => c.title))
  let n = 1
  while (clashSet.has(`${stem} (${n})${ext}`)) n += 1
  return `${stem} (${n})${ext}`
}

/**
 * Permanently delete a document (recycle-bin permanent delete). Guarded: a
 * submission snapshot that still references this document blocks deletion.
 * Physical objects are removed only when no remaining version row references
 * them (shared immutable blobs from copies must survive).
 */
export async function permanentDeleteDocument(id: string, actor: Actor): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError("Document not found");
  if (doc.ownerId !== actor.id) {
    await writeAudit({
      action: AUDIT_ACTIONS.ACCESS_DENIED,
      userId: actor.id,
      entity: "document",
      entityId: id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      category: "SECURITY",
      severity: "WARNING",
      result: "DENIED",
      newValue: { reason: "cross_user_permanent_delete_attempt", ownerId: doc.ownerId },
    });
    throw new NotFoundError("Document not found");
  }

  const snapshotRefs = await prisma.aaccupSubmission.count({ where: { documentId: id } });
  if (snapshotRefs > 0) {
    throw new ConflictError(
      "This file is referenced by an accreditation submission snapshot and cannot be permanently deleted",
    );
  }

  const objectKeys = await prisma.documentVersion.findMany({
    where: { documentId: id },
    select: { objectKey: true },
  });
  const keysToDelete: string[] = [];
  for (const { objectKey } of objectKeys) {
    const otherRefs = await prisma.documentVersion.count({
      where: { objectKey, documentId: { not: id } },
    });
    if (otherRefs === 0) keysToDelete.push(objectKey);
  }

  await prisma.document.delete({ where: { id } });

  for (const objectKey of keysToDelete) {
    try {
      await deleteObject(objectKey);
    } catch {
      // orphan cleanup is best-effort; row removal is authoritative
    }
  }

  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_PERMANENTLY_DELETED,
    userId: actor.id,
    entity: "document",
    entityId: id,
    oldValue: { title: doc.title },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

// â”€â”€ Favorites â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function favoriteDocument(id: string, actor: Actor): Promise<void> {
  const doc = await repo.findById(id);
  if (!doc) throw new NotFoundError("Document not found");
  await assertCanRead(actor, doc);
  await prisma.repositoryFavorite.upsert({
    where: { ownerId_documentId: { ownerId: actor.id, documentId: id } },
    create: { ownerId: actor.id, documentId: id },
    update: {},
  });
  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_FAVORITED,
    userId: actor.id,
    entity: "document",
    entityId: id,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

export async function unfavoriteDocument(id: string, actor: Actor): Promise<void> {
  await prisma.repositoryFavorite.deleteMany({ where: { ownerId: actor.id, documentId: id } });
  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_UNFAVORITED,
    userId: actor.id,
    entity: "document",
    entityId: id,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

export async function listFavoriteDocuments(actor: Actor): Promise<DocumentListItem[]> {
  const rows = await prisma.document.findMany({
    where: {
      ownerId: actor.id,
      deletedAt: null,
      favorites: { some: { ownerId: actor.id } },
    },
    select: documentSelect,
    orderBy: { updatedAt: "desc" },
  });
  return enrichSubmissionStatuses(rows.map((row) => repo.toListItemPublic(row)));
}

// â”€â”€ Recents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function recordRecent(
  actor: Actor,
  itemType: "FILE" | "FOLDER",
  itemId: string,
): Promise<void> {
  await prisma.repositoryRecent.upsert({
    where: { ownerId_itemType_itemId: { ownerId: actor.id, itemType, itemId } },
    create: { ownerId: actor.id, itemType, itemId, lastOpenedAt: new Date() },
    update: { lastOpenedAt: new Date() },
  });
  // Keep the recent list bounded (50 per type).
  const stale = await prisma.repositoryRecent.findMany({
    where: { ownerId: actor.id, itemType },
    orderBy: { lastOpenedAt: "desc" },
    skip: 50,
    select: { id: true },
  });
  if (stale.length > 0) {
    await prisma.repositoryRecent.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  }
}

export interface RecentItem {
  itemType: "FILE" | "FOLDER";
  itemId: string;
  name: string;
  lastOpenedAt: string;
}

export interface DocumentActivityEvent {
  id: string;
  action: string;
  status: string;
  timestamp: string;
  actorName: string | null;
  actorEmail: string | null;
  details: Prisma.JsonValue;
}

export interface DocumentActivity {
  downloadCount: number;
  events: DocumentActivityEvent[];
}

/**
 * Per-file Details / Activity view (rule 18). The authoritative source is the
 * global AuditLog — events are filtered to this document, never duplicated.
 * Read-only; no audit entry is written.
 */
export async function getDocumentActivity(id: string, actor: Actor): Promise<DocumentActivity> {
  const doc = await repo.findById(id);
  if (!doc) throw new NotFoundError("Document not found");
  await assertCanRead(actor, doc);

  const [auditRows, downloadCount] = await Promise.all([
    prisma.auditLog.findMany({
      where: { entity: "document", entityId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        action: true,
        createdAt: true,
        userId: true,
        newValue: true,
        user: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.auditLog.count({
      where: { entity: "document", entityId: id, action: AUDIT_ACTIONS.DOCUMENT_DOWNLOADED },
    }),
  ]);

  return {
    downloadCount,
    events: auditRows.map((row) => ({
      id: row.id,
      action: row.action,
      status: row.action.includes("failed") || row.action.includes("denied") ? "FAILURE" : "SUCCESS",
      timestamp: row.createdAt.toISOString(),
      actorName: row.user ? `${row.user.firstName} ${row.user.lastName}`.trim() : null,
      actorEmail: row.user?.email ?? null,
      details: row.newValue,
    })),
  };
}

export async function listRecents(actor: Actor): Promise<RecentItem[]> {
  const rows = await prisma.repositoryRecent.findMany({
    where: { ownerId: actor.id },
    orderBy: { lastOpenedAt: "desc" },
    take: 50,
  });
  const fileIds = rows.filter((r) => r.itemType === "FILE").map((r) => r.itemId)
  const folderIds = rows.filter((r) => r.itemType === "FOLDER").map((r) => r.itemId)
  const [files, folders] = await Promise.all([
    fileIds.length > 0
      ? prisma.document.findMany({ where: { id: { in: fileIds } }, select: { id: true, title: true } })
      : Promise.resolve([] as { id: string; title: string }[]),
    folderIds.length > 0
      ? prisma.folder.findMany({ where: { id: { in: folderIds } }, select: { id: true, name: true } })
      : Promise.resolve([] as { id: string; name: string }[]),
  ])
  const fileMap = new Map(files.map((f) => [f.id, f.title]))
  const folderMap = new Map(folders.map((f) => [f.id, f.name]))
  const items: RecentItem[] = []
  for (const row of rows) {
    const name = row.itemType === "FILE" ? fileMap.get(row.itemId) : folderMap.get(row.itemId)
    if (name) {
      items.push({
        itemType: row.itemType as "FILE" | "FOLDER",
        itemId: row.itemId,
        name,
        lastOpenedAt: row.lastOpenedAt.toISOString(),
      })
    }
  }
  return items;
}

// -----------------------------------------------------------------------------
// Upload policy (Configuration Engine integration â€” Sprint 7.5)
// -----------------------------------------------------------------------------
// Reads the live platform policy instead of duplicating constants. Only the
// file-type allowlist is enforced — there is no maximum upload size
// (upload.max_size_bytes is no longer consulted).
//   upload.allowed_file_types — extensions (e.g. ["pdf","docx"]) allowed;
//                               empty/absent => everything allowed
// -----------------------------------------------------------------------------
async function assertUploadPolicy(
  filename: string,
  mimeType: string,
  _sizeBytes: bigint,
): Promise<void> {
  const [allowedTypesValue] = await Promise.all([
    getConfigValue("upload.allowed_file_types"),
  ]);

  const allowed = Array.isArray(allowedTypesValue) ? allowedTypesValue : [];
  if (allowed.length > 0) {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (!allowed.map((item) => String(item).toLowerCase()).includes(ext)) {
      throw new BadRequestError(
        `File type ".${ext}" is not allowed (allowed: ${allowed.join(", ")})`,
      );
    }
  }
  void mimeType;
}

// -----------------------------------------------------------------------------
// addVersion
// -----------------------------------------------------------------------------
export async function addVersion(
  documentId: string,
  input: AddVersionInput,
  actor: Actor,
): Promise<{
  document: DocumentDetail;
  upload: {
    url: string;
    objectKey: string;
    headers: Record<string, string>;
    expiresInSeconds: number;
  };
}> {
  const doc = await repo.findById(documentId);
  if (!doc) throw new NotFoundError("Document not found");
  await assertCanWrite(actor, doc);

  // â”€â”€ Configuration Engine enforcement (Sprint 7.5 integration): upload size
  // and allowed file types come from the Configuration Engine keys
  // (upload.max_size_bytes, upload.allowed_file_types) so ROOT can tune them
  // without code changes. Fallbacks preserve the pre-integration defaults:
  // 100 MB cap and no type restriction.
  await assertUploadPolicy(input.filename, input.mimeType, input.sizeBytes);

  // â”€â”€ Dedupe: reject if a version with this checksum already exists for this
  // document. Avoids storing identical bytes twice under different version
  // numbers. Checked BEFORE creating the version row so we don't leave
  // orphaned rows on the rejection path.
  const existingVersion = await repo.findVersionByChecksum(documentId, input.checksum);
  if (existingVersion) {
    throw new ConflictError("A version with this checksum already exists for this document", {
      existingVersionId: existingVersion.id,
      versionNumber: existingVersion.versionNumber,
    });
  }

  const versionNumber = await repo.nextVersionNumber(documentId);
  // Obtain the canonical, sanitized object key from the storage adapter before
  // persisting the version. This keeps filenames with spaces or punctuation
  // consistent across the database, presigned URL and later verification.
  const upload = await presignUpload(
    documentId,
    `v${versionNumber}`,
    input.filename,
    input.mimeType,
    Number(input.sizeBytes),
  );
  const objectKey = upload.objectKey;

  await repo.createVersion({
    documentId,
    versionNumber,
    objectKey,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    checksum: input.checksum,
    changeNote: input.changeNote ?? null,
    uploadedById: actor.id,
  });

  // NOTE: no audit event here. The upload is only final once the client PUTs
  // the bytes and `verifyUpload` confirms size + checksum — that is the single
  // authoritative DOCUMENT_VERSION_ADDED event (mirrors recordUploadFailure,
  // which owns the failure event). Auditing here produced two identical rows
  // for one upload.

  const refreshed = await repo.findById(documentId);
  if (!refreshed) throw new NotFoundError("Document not found after version add");
  return {
    document: refreshed,
    upload: {
      url: upload.url,
      objectKey,
      headers: upload.headers,
      expiresInSeconds: upload.expiresInSeconds,
    },
  };
}

// -----------------------------------------------------------------------------
// listVersions
// -----------------------------------------------------------------------------
export async function listVersions(
  documentId: string,
  actor: Actor,
): Promise<DocumentVersionView[]> {
  const doc = await repo.findById(documentId);
  if (!doc) throw new NotFoundError("Document not found");
  await assertCanRead(actor, doc);
  return doc.versions;
}

// -----------------------------------------------------------------------------
// verifyUpload â€” called by the controller after the client completes the
// presigned PUT to MinIO. ETags are MD5/multipart identifiers, not SHA-256, so
// verification streams the stored object through Node's SHA-256 hasher. The
// version becomes current only after both size and digest checks succeed.
// -----------------------------------------------------------------------------
export async function verifyUpload(
  documentId: string,
  versionId: string,
  actor: Actor,
): Promise<void> {
  const doc = await repo.findById(documentId);
  if (!doc) throw new NotFoundError("Document not found");
  await assertCanWrite(actor, doc);

  const version = await repo.findVersionById(versionId);
  if (!version || version.documentId !== documentId) {
    throw new NotFoundError("Version not found");
  }

  let storedSize = 0;
  try {
    const stat = await statObject(version.objectKey);
    storedSize = stat.size;
  } catch {
    // Object not yet uploaded (client hasn't completed the PUT) or storage
    // is unavailable. Surface as a 400 â€" caller behavior: client should retry
    // the upload then call verify again.
    await recordUploadFailure(actor, doc, version, "object not yet available in storage");
    throw new BadRequestError(
      "Object is not yet available in storage - complete the upload before verifying",
    );
  }

  const hash = createHash("sha256");
  const stream = await getObjectStream(version.objectKey);
  for await (const chunk of stream) hash.update(chunk as Buffer);
  const actualChecksum = hash.digest("hex");
  if (
    storedSize !== Number(version.sizeBytes) ||
    actualChecksum !== version.checksum.toLowerCase()
  ) {
    await repo.deleteVersion(versionId);
    if (doc.currentVersionId === versionId) {
      await repo.update({ id: documentId, data: { currentVersionId: null } });
    }
    await recordUploadFailure(actor, doc, version, "size or checksum mismatch");
    throw new BadRequestError(
      "Uploaded file size or checksum does not match the declared values - version rolled back",
      {
        expectedChecksum: version.checksum,
        actualChecksum,
        expectedSize: version.sizeBytes.toString(),
        actualSize: storedSize,
      },
    );
  }

  await repo.update({ id: documentId, data: { currentVersionId: versionId } });

  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_VERSION_ADDED,
    userId: actor.id,
    entity: "document",
    entityId: documentId,
    newValue: { versionId, verified: true, checksum: actualChecksum },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  // Rule 19: upload-completed notification (backend-authoritative, single write).
  await safeNotify(actor.id, "DOCUMENT_UPLOADED", {
    title: "Upload completed",
    message: `"${doc.title}" was uploaded successfully.`,
    entity: "document",
    entityId: documentId,
    actionUrl: "/documents",
  });

  // Rule 19: storage warning when a verified threshold is crossed (best-effort,
  // throttled to one warning per 24h).
  await maybeEmitStorageWarning();

  const { enqueue, QUEUE_NAMES } = await import("@/lib/queue");
  void enqueue(
    QUEUE_NAMES.DOCUMENT_THUMBNAIL,
    { objectKey: version.objectKey, mimeType: version.mimeType },
    { jobId: `document-thumbnail:${version.id}` },
  ).catch(() => undefined);
}

/**
 * Single authoritative upload-failure audit + notification (rules 19/23).
 * Called ONLY from verifyUpload so each failed upload is recorded exactly once.
 */
async function recordUploadFailure(
  actor: Actor,
  doc: { id: string; title: string },
  version: { versionNumber: number; checksum: string },
  reason: string,
): Promise<void> {
  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_UPLOAD_FAILED,
    userId: actor.id,
    entity: "document",
    entityId: doc.id,
    newValue: { versionNumber: version.versionNumber, checksum: version.checksum, failureReason: reason },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
  await safeNotify(actor.id, "DOCUMENT_UPLOAD_FAILED", {
    title: "Upload failed",
    message: `"${doc.title}" could not be verified (${reason}). Please retry.`,
    entity: "document",
    entityId: doc.id,
    actionUrl: "/documents",
  });
}

/** Best-effort notification emit — never fails the business operation. */
async function safeNotify(
  userId: string,
  type: NotificationType,
  input: Record<string, unknown>,
): Promise<void> {
  try {
    await notifyUser(userId, type, input);
  } catch {
    // notifications must never break the document operation
  }
}

/** Storage-warning emitter (rule 19): throttled to one warning per 24h. */
async function maybeEmitStorageWarning(): Promise<void> {
  try {
    const thresholdValue = await getConfigValue("storage.warning_threshold");
    if (thresholdValue === null || thresholdValue === undefined) return;
    const thresholdBytes = Number(thresholdValue);
    if (!Number.isFinite(thresholdBytes) || thresholdBytes <= 0) return;

    const used = await prisma.documentVersion.aggregate({ _sum: { sizeBytes: true } });
    const usedBytes = Number(used._sum.sizeBytes ?? 0n);
    if (usedBytes < thresholdBytes) return;

    const recent = await prisma.notification.findFirst({
      where: { type: "STORAGE_WARNING", createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      select: { id: true },
    });
    if (recent) return;

    const targets = await prisma.user.findMany({
      where: { deletedAt: null, status: "ACTIVE", role: { name: { in: ["ROOT", "ADMINISTRATOR"] } } },
      select: { id: true },
    });
    await notifyUsers(targets.map((t) => t.id), "STORAGE_WARNING", {
      title: "Storage warning",
      message: `Platform storage usage (${Math.round(usedBytes / 1048576)} MB) exceeds the configured warning threshold.`,
    });
  } catch {
    // storage warnings are advisory
  }
}

// -----------------------------------------------------------------------------
// shareDocument
// -----------------------------------------------------------------------------
export async function shareDocument(
  id: string,
  input: ShareDocumentInput,
  actor: Actor,
): Promise<void> {
  const doc = await repo.findById(id);
  if (!doc) throw new NotFoundError("Document not found");
  await assertCanManage(actor, doc);

  if (input.userId === doc.ownerId) {
    throw new BadRequestError("Cannot share a document with its owner");
  }

  if (input.expiresAt && input.expiresAt < new Date()) {
    throw new BadRequestError("Expiry date must be in the future");
  }

  await repo.upsertShare({
    documentId: id,
    userId: input.userId,
    permission: input.permission,
    expiresAt: input.expiresAt ?? null,
  });

  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_SHARED,
    userId: actor.id,
    entity: "document",
    entityId: id,
    newValue: {
      sharedWith: input.userId,
      permission: input.permission,
      expiresAt: input.expiresAt,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

// -----------------------------------------------------------------------------
// unshareDocument
// -----------------------------------------------------------------------------
export async function unshareDocument(id: string, userId: string, actor: Actor): Promise<void> {
  const doc = await repo.findById(id);
  if (!doc) throw new NotFoundError("Document not found");
  await assertCanManage(actor, doc);

  const removed = await repo.deleteShare(id, userId);
  if (!removed) throw new NotFoundError("Share not found");

  await writeAudit({
    action: AUDIT_ACTIONS.DOCUMENT_UNSHARED,
    userId: actor.id,
    entity: "document",
    entityId: id,
    oldValue: { sharedWith: userId },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}

// Re-exports for callers that import types from the service module
export { SHARE_PERMISSIONS, type SharePermissionValue };
