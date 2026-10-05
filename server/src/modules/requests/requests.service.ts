import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit, writeAuditInTransaction } from "@/modules/audit/audit.service";
import { notifyUser } from "@/modules/notifications/notifications.service";
import { prisma } from "@/lib/prisma";
import {
  bindWorkflowInstance,
  evaluateWorkflowAction,
  recordWorkflowAction,
  scopesForDocumentRequest,
} from "@/modules/workflow/workflow.engine";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/utils/errors";
import * as repo from "@/modules/requests/requests.repository";
import type { Prisma } from "@prisma/client";
import type {
  CreateRequestInput,
  ListRequestsQuery,
  DecideRequestInput,
} from "@/modules/requests/requests.validator";
import type { RequestDetail, RequestListItem } from "@/modules/requests/requests.types";

// =============================================================================
// URS-DMS â€” requests service
// RBAC model:
//   - "managers" = users holding request.manage (admins + QAOs + dept coords).
//   - otherwise: requester sees only their own requests.
// No `if (role === "admin")` anywhere â€” every check routes through permissions.
// =============================================================================

export interface ListResult {
  items: RequestListItem[];
}

export interface Actor {
  id: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

function isManager(actor: Actor): boolean {
  return actor.permissions.includes("request.manage");
}

async function assertCanView(actor: Actor, request: { requesterId: string }): Promise<void> {
  if (actor.id === request.requesterId) return;
  if (isManager(actor)) return;
  throw new ForbiddenError("You do not have access to this request");
}

// -----------------------------------------------------------------------------
// listRequests
// -----------------------------------------------------------------------------
export async function listRequests(query: ListRequestsQuery, actor: Actor): Promise<ListResult> {
  const where: Prisma.DocumentRequestWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.documentId) where.documentId = query.documentId;
  if (query.requesterId) where.requesterId = query.requesterId;

  // Scope: managers see everything; everyone else sees only their own.
  if (!isManager(actor)) {
    where.requesterId = actor.id;
  }

  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: "insensitive" } },
      { justification: { contains: query.q, mode: "insensitive" } },
    ];
  }

  return { items: await repo.list(where) };
}

// -----------------------------------------------------------------------------
// getRequest
// -----------------------------------------------------------------------------
export async function getRequest(id: string, actor: Actor): Promise<RequestDetail> {
  const request = await repo.findById(id);
  if (!request) throw new NotFoundError("Request not found");
  await assertCanView(actor, request);
  return request;
}

// -----------------------------------------------------------------------------
// createRequest
// -----------------------------------------------------------------------------
export async function createRequest(
  input: CreateRequestInput,
  actor: Actor,
): Promise<RequestDetail> {
  if (!actor.permissions.includes("request.create")) {
    throw new ForbiddenError("Missing permission: request.create");
  }

  // Resolve the documents of this request. `documentIds` is the modern
  // multi-file field (1-3); the legacy single `documentId` is kept for
  // backward compatibility.
  const documentIds = [...new Set(input.documentIds ?? (input.documentId ? [input.documentId] : []))];
  if (documentIds.length === 0) {
    throw new BadRequestError("At least one document is required");
  }
  if (documentIds.length > 3) {
    throw new BadRequestError("A request can include at most 3 documents");
  }
  const documents = await prisma.document.findMany({
    where: { id: { in: documentIds }, deletedAt: null },
    select: { id: true },
  });
  if (documents.length !== documentIds.length) {
    throw new BadRequestError("One or more referenced documents were not found");
  }

  const request = await prisma.$transaction(async (tx) => {
    const created = await repo.create(
      {
        requesterId: actor.id,
        title: input.title,
        justification: input.justification,
        documentId: documentIds[0] ?? null,
        documentIds,
      },
      tx,
    );

    // Sprint 7.4.5 â€” bind a published workflow instance (if one is assigned
    // to the requester's scope) inside the same transaction. No assignment â†’
    // legacy flow unchanged.
    const scopes = await scopesForDocumentRequest(actor.id, tx);
    await bindWorkflowInstance({
      entityType: "DOCUMENT_REQUEST",
      entityId: created.id,
      scopes,
      actor,
      tx,
    });
    return created;
  });

  await writeAudit({
    action: AUDIT_ACTIONS.REQUEST_CREATED,
    userId: actor.id,
    entity: "request",
    entityId: request.id,
    newValue: {
      title: request.title,
      documentIds,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return request;
}

// -----------------------------------------------------------------------------
// browseDepartmentArchive — list-only view of the caller's department bucket
// Used by the user portal "Browse Archive" screen: file name, type, owner,
// date uploaded and size only. No presigned URLs are issued, so files cannot
// be opened or downloaded from this surface.
// -----------------------------------------------------------------------------
export interface BrowseItem {
  id: string;
  title: string;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: string | null;
  ownerName: string;
  departmentId: string | null;
  departmentName: string | null;
  uploadedAt: Date;
  folderName: string | null;
}

export async function browseDepartmentArchive(
  actor: Actor,
): Promise<{ items: BrowseItem[]; departmentId: string | null; departmentName: string | null }> {
  if (!actor.permissions.includes("request.create")) {
    throw new ForbiddenError("Missing permission: request.create");
  }
  const me = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { departmentId: true },
  });
  const departmentId = me?.departmentId ?? null;
  if (!departmentId) return { items: [], departmentId: null, departmentName: null };

  const [department, docs] = await Promise.all([
    prisma.department.findUnique({
      where: { id: departmentId },
      select: { name: true },
    }),
    prisma.document.findMany({
      where: { departmentId, deletedAt: null },
      select: {
        id: true,
        title: true,
        createdAt: true,
        currentVersion: { select: { filename: true, mimeType: true, sizeBytes: true } },
        owner: { select: { firstName: true, lastName: true } },
        folder: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    items: docs.map((d) => ({
      id: d.id,
      title: d.title,
      filename: d.currentVersion?.filename ?? null,
      mimeType: d.currentVersion?.mimeType ?? null,
      sizeBytes: d.currentVersion?.sizeBytes?.toString() ?? null,
      ownerName: d.owner ? `${d.owner.firstName} ${d.owner.lastName}`.trim() : "Unknown",
      departmentId,
      departmentName: department?.name ?? null,
      uploadedAt: d.createdAt,
      folderName: d.folder?.name ?? null,
    })),
    departmentId,
    departmentName: department?.name ?? null,
  };
}

// -----------------------------------------------------------------------------
// decideRequest (approve / reject / fulfill)
// -----------------------------------------------------------------------------

// Deliver requester-owned copies of the source documents into the requester's
// Requested Documents. Each copy links to the request via metadata.requestId
// and references the same immutable version object (shared blob); later
// source rename/move/delete never breaks the delivered files.
async function deliverRequestedDocument(
  tx: Prisma.TransactionClient,
  existing: RequestDetail,
  actor: Actor,
): Promise<void> {
  const sourceIds = existing.items.length > 0
    ? existing.items.map((item) => item.documentId)
    : existing.documentId
      ? [existing.documentId]
      : [];
  const sources = await tx.document.findMany({
    where: { id: { in: sourceIds } },
    include: { currentVersion: true },
  });
  if (sources.length === 0 || sources.some((source) => !source.currentVersion)) {
    throw new ConflictError("One or more source documents have no version to deliver");
  }

  const repository = await tx.repository.findUnique({ where: { ownerId: existing.requesterId } });
  const repositoryId = repository?.id ?? null;

  for (const source of sources) {
    if (!source.currentVersion) continue;
    const delivered = await tx.document.create({
      data: {
        title: `[Delivered] ${source.title}`,
        description: source.description,
        classification: "INTERNAL",
        metadata: {
          ...(source.metadata && typeof source.metadata === "object" ? source.metadata : {}),
          requestId: existing.id,
          delivered: true,
        },
        ownerId: existing.requesterId,
        departmentId: null,
        repositoryId,
      },
    });
    const version = await tx.documentVersion.create({
      data: {
        documentId: delivered.id,
        versionNumber: 1,
        objectKey: source.currentVersion.objectKey,
        filename: source.currentVersion.filename,
        mimeType: source.currentVersion.mimeType,
        sizeBytes: source.currentVersion.sizeBytes,
        checksum: source.currentVersion.checksum,
        changeNote: "Delivered via document request",
        uploadedById: actor.id,
      },
    });
    await tx.document.update({
      where: { id: delivered.id },
      data: { currentVersionId: version.id },
    });
  }

  // Transactional audit: written through `tx` so the delivered event commits
  // with the delivery and rolls back with the approval transaction. Using the
  // global client here previously left a false SUCCESS row if the transaction
  // later aborted.
  await writeAuditInTransaction(tx, {
    action: AUDIT_ACTIONS.REQUEST_FULFILLED_DELIVERED,
    userId: actor.id,
    entity: "request",
    entityId: existing.id,
    newValue: { deliveredCount: sources.length, requesterId: existing.requesterId },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });
}
export async function decideRequest(
  id: string,
  decision: "APPROVED" | "REJECTED" | "FULFILLED",
  input: DecideRequestInput,
  actor: Actor,
): Promise<RequestDetail> {
  if (!isManager(actor)) {
    throw new ForbiddenError("Missing permission: request.manage");
  }

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("Request not found");

  // Managers must give a reason when rejecting (decisionNote required).
  if (decision === "REJECTED" && !input.decisionNote?.trim()) {
    throw new BadRequestError("A reason is required when rejecting a request");
  }

  // State machine validation.
  if (decision === "APPROVED") {
    if (existing.status !== "PENDING") {
      throw new ConflictError("Only pending requests can be approved");
    }
  } else if (decision === "REJECTED") {
    if (existing.status !== "PENDING") {
      throw new ConflictError("Only pending requests can be rejected");
    }
  } else if (decision === "FULFILLED") {
    if (existing.status !== "APPROVED") {
      throw new ConflictError("Only approved requests can be fulfilled");
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Sprint 7.4.5 â€” workflow gate: if a published workflow controls this
    // request, the decision must be an allowed action from the current step
    // (legacy fallback when no instance is bound).
    const evaluation = await evaluateWorkflowAction(
      "DOCUMENT_REQUEST",
      id,
      REQUEST_DECISION_ACTIONS[decision],
      actor,
      tx,
    );
    const row = await repo.decide(
      {
        id,
        status: decision,
        decidedById: actor.id,
        decisionNote: input.decisionNote ?? null,
      },
      tx,
    );

    // Delivery: when a request is fulfilled, deliver requester-owned copies
    // into their Requested Documents (linked via metadata.requestId). The
    // source documents' privacy and ownership are preserved; each delivered
    // copy references the same immutable version object.
    if (decision === "APPROVED") {
      await deliverRequestedDocument(tx, existing, actor);
    }

    if (evaluation) {
      await recordWorkflowAction(tx, evaluation, actor, input.decisionNote ?? undefined);
    }
    return row;
  });

  const actionMap = {
    APPROVED: AUDIT_ACTIONS.REQUEST_APPROVED,
    REJECTED: AUDIT_ACTIONS.REQUEST_REJECTED,
    FULFILLED: AUDIT_ACTIONS.REQUEST_FULFILLED,
  } as const;

  await writeAudit({
    action: actionMap[decision],
    userId: actor.id,
    entity: "request",
    entityId: id,
    oldValue: { status: existing.status },
    newValue: {
      status: decision,
      decisionNote: input.decisionNote ?? null,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  // Rule 19: notify the requester (backend-authoritative, best-effort).
  await safeNotifyRequester(existing.requesterId, decision, id);

  return updated;
}

/** Best-effort requester notification — never fails the business operation. */
async function safeNotifyRequester(
  requesterId: string,
  decision: "APPROVED" | "REJECTED" | "FULFILLED",
  requestId: string,
): Promise<void> {
  try {
    if (decision === "APPROVED") {
      await notifyUser(requesterId, "DOCUMENT_DELIVERED", {
        title: "Documents delivered",
        message: "Your requested documents have been delivered to your Requested Documents folder.",
        entity: "request",
        entityId: requestId,
        actionUrl: "/user/documents",
      });
    } else if (decision === "REJECTED") {
      await notifyUser(requesterId, "REQUEST_REJECTED", {
        title: "Request rejected",
        message: "Your document access request has been rejected.",
        entity: "request",
        entityId: requestId,
        actionUrl: "/user/requests",
      });
    } else {
      await notifyUser(requesterId, "DOCUMENT_DELIVERED", {
        title: "Document delivered",
        message: "A requested document has been delivered to your Requested Documents.",
        entity: "request",
        entityId: requestId,
        actionUrl: "/user/documents",
      });
    }
  } catch {
    // notifications must never break the request operation
  }
}

// -----------------------------------------------------------------------------
// cancelRequest
// -----------------------------------------------------------------------------
export async function cancelRequest(id: string, actor: Actor): Promise<RequestDetail> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("Request not found");

  if (existing.requesterId !== actor.id) {
    throw new ForbiddenError("You can only cancel your own requests");
  }
  if (existing.status !== "PENDING") {
    throw new ConflictError("Only pending requests can be cancelled");
  }

  // Reuse decide() with REJECTED status and an explicit cancel note. This
  // keeps the schema happy (status is a RequestStatus enum, no CANCELLED
  // value exists). Audit action REQUEST_CANCELLED distinguishes it from a
  // manager-driven rejection.
  const updated = await prisma.$transaction(async (tx) => {
    const evaluation = await evaluateWorkflowAction(
      "DOCUMENT_REQUEST",
      id,
      "CANCEL",
      actor,
      tx,
    );
    const row = await repo.decide(
      {
        id,
        status: "REJECTED",
        decidedById: actor.id,
        decisionNote: input_decisionNote(existing, "Cancelled by requester"),
      },
      tx,
    );
    if (evaluation) {
      await recordWorkflowAction(tx, evaluation, actor, "Cancelled by requester");
    }
    return row;
  });

  await writeAudit({
    action: AUDIT_ACTIONS.REQUEST_CANCELLED,
    userId: actor.id,
    entity: "request",
    entityId: id,
    oldValue: { status: existing.status },
    newValue: { status: "REJECTED", reason: "cancelled_by_requester" },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return updated;
}

// Sprint 7.4.5 â€” request status â†’ workflow action adapter (glue convention,
// not workflow data: the action names themselves are authored by ROOT).
const REQUEST_DECISION_ACTIONS: Record<"APPROVED" | "REJECTED" | "FULFILLED", string> = {
  APPROVED: "APPROVE",
  REJECTED: "REJECT",
  FULFILLED: "FULFILL",
};

// Small helper to keep the cancelRequest signature clean.
function input_decisionNote(
  existing: RequestDetail,
  fallback: string,
): string {
  return existing.decisionNote ? `${existing.decisionNote}\n${fallback}` : fallback;
}
