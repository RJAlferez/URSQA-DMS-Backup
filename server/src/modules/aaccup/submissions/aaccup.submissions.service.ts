import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import { notifyUser, notifyUsers } from "@/modules/notifications/notifications.service";
import { sendEmail } from "@/modules/email/email.service";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "@/utils/errors";
import { streamZipArchive } from "@/lib/zipStream";
import { buildExportPlan } from "@/modules/aaccup/submissions/aaccup.export-plan";
import { Readable } from "node:stream";
import * as repo from "@/modules/aaccup/submissions/aaccup.submissions.repository";
import type { AreaSet, Prisma } from "@prisma/client";
import type {
  CreateSubmissionInput,
  ListSubmissionsQuery,
  ReviewSubmissionInput,
  UnsubmitSubmissionInput,
  UpdateSubmissionInput,
} from "@/modules/aaccup/submissions/aaccup.submissions.validator";
import type {
  AaccupSubmissionDetail,
  AaccupSubmissionListItem,
} from "@/modules/aaccup/submissions/aaccup.submissions.types";
import { assertRequirementUploadValid } from "@/modules/requirements/requirement.runtime";
import {
  bindWorkflowInstance,
  evaluateWorkflowAction,
  recordWorkflowAction,
  scopesForAaccupSubmission,
} from "@/modules/workflow/workflow.engine";

// Sprint 7.4.5 — review decision → workflow action adapter (glue convention,
// not workflow data: the action names themselves are authored by ROOT).
const REVIEW_DECISION_ACTIONS: Record<"APPROVED" | "REJECTED" | "NEEDS_REVISION", string> = {
  APPROVED: "APPROVE",
  REJECTED: "REJECT",
  NEEDS_REVISION: "REQUEST_REVISION",
};

// =============================================================================
// URS-DMS — AACCUP submission service
// RBAC model:
//   - "reviewers" hold aaccup.submission.review (QAOs by default).
//   - "submitters" hold aaccup.submission.create (QAOs, dept coords, faculty, staff).
//   - Reads: submitter sees their own submissions; reviewers/managers see all.
// No `if (role === "admin")` anywhere — every check routes through permissions.
// =============================================================================

export interface ListResult {
  items: AaccupSubmissionListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Actor {
  id: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

function isReviewer(actor: Actor): boolean {
  return actor.permissions.includes("aaccup.submission.review");
}

function isManager(actor: Actor): boolean {
  // aaccup.manage implies full AACCUP manager rights (admin / QAO).
  return actor.permissions.includes("aaccup.manage");
}

function assertCanCreate(actor: Actor): void {
  if (!actor.permissions.includes("aaccup.submission.create")) {
    throw new ForbiddenError("Missing permission: aaccup.submission.create");
  }
}

function assertCanReview(actor: Actor): void {
  if (!isReviewer(actor) && !isManager(actor)) {
    throw new ForbiddenError("Missing permission: aaccup.submission.review");
  }
}

function assertCanArchive(actor: Actor): void {
  if (!actor.permissions.includes("aaccup.submission.archive")) {
    throw new ForbiddenError("Missing permission: aaccup.submission.archive");
  }
}

function assertCanRead(actor: Actor, submittedById: string): void {
  if (actor.id === submittedById) return;
  if (isReviewer(actor) || isManager(actor)) return;
  if (actor.permissions.includes("aaccup.submission.read")) {
    // Generic readers may inspect any submission record for transparency.
    return;
  }
  throw new ForbiddenError("You do not have access to this submission");
}

function assertCanUpdate(actor: Actor, submittedById: string): void {
  if (!actor.permissions.includes("aaccup.submission.update")) {
    throw new ForbiddenError("Missing permission: aaccup.submission.update");
  }
  // Submitters may only edit their own submissions; reviewers/managers may edit
  // any (defense in depth — actual mutation is restricted to remarks here).
  if (actor.id !== submittedById && !isReviewer(actor) && !isManager(actor)) {
    throw new ForbiddenError("You can only edit your own submissions");
  }
}

const SORT_FIELDS = new Set(["submittedAt", "createdAt", "updatedAt", "status"]);

// -----------------------------------------------------------------------------
// Validation helpers
// -----------------------------------------------------------------------------

// Requirement must exist and not be archived. Returns the joined area
// department so the document-belonging check can run afterwards.
interface RequirementContext {
  id: string;
  areaDepartmentId: string;
  dynamic: boolean;
  area: { id: string; name: string; areaSet: string; departmentId: string };
}

async function assertRequirementUsable(requirementId: string): Promise<RequirementContext> {
  const requirement = await prisma.aaccupRequirement.findFirst({
    where: { id: requirementId, deletedAt: null },
    select: {
      id: true,
      status: true,
      sourceNodeId: true,
      area: {
        select: { id: true, name: true, areaSet: true, deletedAt: true, departmentId: true, status: true },
      },
    },
  });
  if (!requirement) {
    throw new NotFoundError("AACCUP requirement not found");
  }
  if (requirement.status !== "ACTIVE") {
    throw new BadRequestError("Requirement is inactive and cannot accept submissions");
  }
  if (!requirement.area || requirement.area.deletedAt) {
    throw new BadRequestError("Parent AACCUP area is archived");
  }
  if (requirement.area.status !== "ACTIVE") {
    throw new BadRequestError("Parent AACCUP area is inactive");
  }
  return {
    id: requirement.id,
    areaDepartmentId: requirement.area.departmentId,
    dynamic: requirement.sourceNodeId !== null,
    area: {
      id: requirement.area.id,
      name: requirement.area.name,
      areaSet: requirement.area.areaSet,
      departmentId: requirement.area.departmentId,
    },
  };
}

// Document must exist and not be soft-deleted. Returns its department + owner
// for ownership scoping and the belonging check.
interface DocumentContext {
  id: string;
  ownerId: string;
  departmentId: string | null;
  metadata: Prisma.JsonValue;
  currentVersion: {
    filename: string;
    mimeType: string;
    sizeBytes: bigint;
    checksum: string;
  } | null;
}

async function assertDocumentUsable(documentId: string, actor: Actor): Promise<DocumentContext> {
  const document = await prisma.document.findFirst({
    where: { id: documentId },
    select: {
      id: true,
      ownerId: true,
      departmentId: true,
      deletedAt: true,
      status: true,
      metadata: true,
      currentVersion: { select: { filename: true, mimeType: true, sizeBytes: true, checksum: true } },
    },
  });
  if (!document) {
    throw new NotFoundError("Document not found");
  }
  if (document.deletedAt) {
    throw new BadRequestError("Document is archived and cannot be submitted");
  }
  // Only the document owner or an AACCUP manager may attach a document to a
  // submission. The previous `documents.update` fallback let any role holding
  // that code (FACULTY/STAFF/DEPT_COORD/QAO) commandeer another user's
  // document and have it silently moved into the AACCUP archive folder.
  if (document.ownerId !== actor.id && !isManager(actor)) {
    throw new ForbiddenError("You can only submit documents you own");
  }
  return {
    id: document.id,
    ownerId: document.ownerId,
    departmentId: document.departmentId,
    metadata: document.metadata,
    currentVersion: document.currentVersion,
  };
}

function uploadMetadata(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function assertDynamicRules(
  requirement: RequirementContext,
  document: DocumentContext,
): Promise<void> {
  if (!requirement.dynamic) return;
  if (!document.currentVersion) {
    throw new BadRequestError(
      "Document upload must be verified before it can satisfy a dynamic requirement",
    );
  }
  const metadata = uploadMetadata(document.metadata);
  const expirationValue = metadata.expirationDate;
  const expirationDate =
    typeof expirationValue === "string" || expirationValue instanceof Date
      ? new Date(expirationValue)
      : undefined;
  await assertRequirementUploadValid(requirement.id, {
    filename: document.currentVersion.filename,
    mimeType: document.currentVersion.mimeType,
    sizeBytes: document.currentVersion.sizeBytes,
    pageCount: typeof metadata.pageCount === "number" ? metadata.pageCount : undefined,
    expirationDate:
      expirationDate && !Number.isNaN(expirationDate.getTime()) ? expirationDate : undefined,
    metadata,
  });
}

// If the document has a department, it must match the requirement's area
// department. Documents without a department are allowed (the sprint spec
// qualifies this check with "if applicable").
function assertDocumentBelongsToAreaDepartment(
  doc: DocumentContext,
  requirement: RequirementContext,
): void {
  if (doc.departmentId && doc.departmentId !== requirement.areaDepartmentId) {
    throw new BadRequestError("Document does not belong to the requirement's area department");
  }
}

// A submission may reference the AACCUP task it fulfils. The task must exist,
// belong to the same area as the requirement, still be open, and (if it names
// a requirement) match the requirement being submitted against.
async function assertTaskUsable(
  taskId: string | null | undefined,
  requirementId: string,
  areaId: string,
): Promise<void> {
  if (!taskId) return;
  const task = await prisma.aaccupTask.findFirst({
    where: { id: taskId, deletedAt: null },
    select: { areaId: true, status: true, requirementId: true },
  });
  if (!task) throw new BadRequestError("Referenced AACCUP task not found");
  if (task.areaId !== areaId) {
    throw new BadRequestError("Task does not belong to the submission's area");
  }
  if (task.status === "COMPLETED" || task.status === "CANCELLED") {
    throw new BadRequestError("Task is already closed and cannot accept submissions");
  }
  if (task.requirementId && task.requirementId !== requirementId) {
    throw new BadRequestError("Submission requirement does not match the task's requirement");
  }
}

// -----------------------------------------------------------------------------
// listSubmissions
// -----------------------------------------------------------------------------
export async function listSubmissions(
  query: ListSubmissionsQuery,
  actor: Actor,
): Promise<ListResult> {
  const where: Prisma.AaccupSubmissionWhereInput = { deletedAt: null };
  if (query.requirementId) where.requirementId = query.requirementId;
  if (query.documentId) where.documentId = query.documentId;
  if (query.submittedById) where.submittedBy = query.submittedById;
  if (query.reviewedById) where.reviewedBy = query.reviewedById;
  if (query.status) where.status = query.status;
  if (typeof query.isCurrent !== "undefined") {
    where.isCurrent = query.isCurrent === "true";
  }
  if (query.areaId || query.areaSet) {
    const requirementFilter: Prisma.AaccupRequirementWhereInput = {};
    if (query.areaId) requirementFilter.areaId = query.areaId;
    if (query.areaSet) requirementFilter.area = { areaSet: query.areaSet };
    where.requirement = requirementFilter;
  }

  // Scoping: non-reviewers / non-managers see only their own submissions.
  if (!isReviewer(actor) && !isManager(actor)) {
    where.submittedBy = actor.id;
  }

  if (query.q) {
    where.OR = [
      { remarks: { contains: query.q, mode: "insensitive" } },
      { document: { title: { contains: query.q, mode: "insensitive" } } },
      { requirement: { title: { contains: query.q, mode: "insensitive" } } },
    ];
  }

  const sortField = SORT_FIELDS.has(query.sort) ? query.sort : "submittedAt";
  const sortOrder = query.order;
  const page = query.page;
  const pageSize = query.pageSize;

  const { items, total } = await repo.list(where, page, pageSize, sortField, sortOrder);

  return {
    items,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

// -----------------------------------------------------------------------------
// getSubmission
// -----------------------------------------------------------------------------
export async function getSubmission(id: string, actor: Actor): Promise<AaccupSubmissionDetail> {
  const submission = await repo.findById(id);
  if (!submission) throw new NotFoundError("AACCUP submission not found");
  assertCanRead(actor, submission.submittedById);
  return submission;
}

// -----------------------------------------------------------------------------
// exportApprovedSubmissionsZip — admin-only approved-package export
// Streams a ZIP of every APPROVED + current submission across the selected
// areas, grouped into one folder per area. Each file is the exact submitted
// historical DocumentVersion (resolved from the immutable submission snapshot),
// never the current document version. The route hard-gates this to
// ROOT / ADMINISTRATOR; QAO cannot export.
// -----------------------------------------------------------------------------
export async function exportApprovedSubmissionsZip(
  areaIds: string[],
  areaSet: AreaSet | undefined,
  actor: Actor,
): Promise<{ filename: string; stream: Readable; fileCount: number; skipped: number }> {
  const areas = await prisma.aaccupArea.findMany({
    where: { id: { in: areaIds }, deletedAt: null },
    select: { id: true, code: true, name: true, areaSet: true },
  });
  if (areas.length !== new Set(areaIds).size) {
    throw new NotFoundError("One or more AACCUP areas were not found");
  }
  if (areaSet && areas.some((area) => area.areaSet !== areaSet)) {
    throw new BadRequestError(`Selected areas do not all belong to the ${areaSet} set`);
  }

  const submissions = await prisma.aaccupSubmission.findMany({
    where: {
      status: "APPROVED",
      isCurrent: true,
      deletedAt: null,
      requirement: {
        areaId: { in: areaIds },
        ...(areaSet ? { area: { areaSet } } : {}),
      },
    },
    select: {
      id: true,
      documentId: true,
      submittedAt: true,
      snapshotFilename: true,
      snapshotMimeType: true,
      snapshotSizeBytes: true,
      snapshotChecksum: true,
      requirement: {
        select: {
          id: true,
          documentCode: true,
          title: true,
          area: { select: { id: true, code: true, name: true, areaSet: true } },
        },
      },
    },
    orderBy: { submittedAt: "asc" },
  });

  const documentIds = [...new Set(submissions.map((submission) => submission.documentId))];
  const versions =
    documentIds.length > 0
      ? await prisma.documentVersion.findMany({
          where: { documentId: { in: documentIds } },
          select: {
            id: true,
            documentId: true,
            versionNumber: true,
            objectKey: true,
            filename: true,
            mimeType: true,
            sizeBytes: true,
            checksum: true,
          },
          orderBy: { versionNumber: "desc" },
        })
      : [];

  const plan = buildExportPlan(areas, submissions, versions);

  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `${(areaSet ?? "aaccup").toLowerCase()}-approved-submissions-${dateStamp}.zip`;
  const stream = streamZipArchive(plan.dirs, plan.files);

  // Exports are audited once at the service boundary (rule 23).
  await writeAudit({
    action: AUDIT_ACTIONS.AACCUP_SUBMISSIONS_EXPORTED,
    userId: actor.id,
    entity: "aaccup_submission",
    entityId: areaIds.join(","),
    newValue: {
      zip: true,
      areas: areaIds,
      areaSet: areaSet ?? null,
      fileCount: plan.fileCount,
      skipped: plan.skipped,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return { filename, stream, fileCount: plan.fileCount, skipped: plan.skipped };
}

// -----------------------------------------------------------------------------
// Archive folder management
// -----------------------------------------------------------------------------
// Every submitted document is filed into the repository under a per-set root
// folder (AACCUP / ISO / CERT) with a per-area subfolder named after the area:
//   <areaSet>/<area name>/<document>
// Folders are created lazily on first submission, scoped to the area's
// department so they surface in that department's File Archive.
// -----------------------------------------------------------------------------

async function ensureAreaArchiveFolder(
  tx: Prisma.TransactionClient,
  area: { id: string; name: string; areaSet: string; departmentId: string },
) {
  const setFolder =
    (await tx.folder.findFirst({
      where: { parentId: null, name: area.areaSet, deletedAt: null },
    })) ??
    (await tx.folder.create({
      data: { name: area.areaSet, departmentId: area.departmentId },
    }));
  const areaFolder =
    (await tx.folder.findFirst({
      where: { parentId: setFolder.id, name: area.name, deletedAt: null },
    })) ??
    (await tx.folder.create({
      data: { name: area.name, parentId: setFolder.id, departmentId: area.departmentId },
    }));
  return areaFolder;
}

// -----------------------------------------------------------------------------
// createSubmission
// -----------------------------------------------------------------------------
export async function createSubmission(
  input: CreateSubmissionInput,
  actor: Actor,
): Promise<AaccupSubmissionDetail> {
  assertCanCreate(actor);

  const [requirement, document] = await Promise.all([
    assertRequirementUsable(input.requirementId),
    assertDocumentUsable(input.documentId, actor),
  ]);
  assertDocumentBelongsToAreaDepartment(document, requirement);
  await assertDynamicRules(requirement, document);
  await assertTaskUsable(input.taskId, input.requirementId, requirement.area.id);

  // Create the submission + demote any prior "current" submissions for this
  // requirement in a single transaction so history is preserved but exactly
  // one current pointer exists at a time. The submitted document is also
  // filed into the area's archive folder (created lazily) in the same
  // transaction.
  const submission = await prisma.$transaction(async (tx) => {
    const created = await tx.aaccupSubmission.create({
      data: {
        requirementId: input.requirementId,
        documentId: input.documentId,
        submittedBy: actor.id,
        taskId: input.taskId ?? null,
        remarks: input.remarks ?? null,
        status: "PENDING",
        isCurrent: true,
        // Immutable evidence snapshot captured at submission time.
        snapshotFilename: document.currentVersion?.filename ?? null,
        snapshotMimeType: document.currentVersion?.mimeType ?? null,
        snapshotSizeBytes: document.currentVersion?.sizeBytes ?? null,
        snapshotChecksum: document.currentVersion?.checksum ?? null,
      },
    });
    const archiveFolder = await ensureAreaArchiveFolder(tx, requirement.area);
    await tx.document.update({
      where: { id: input.documentId },
      data: { folderId: archiveFolder.id },
    });
    await tx.aaccupSubmission.updateMany({
      where: {
        requirementId: input.requirementId,
        isCurrent: true,
        id: { not: created.id },
      },
      data: { isCurrent: false },
    });
    // Sprint 7.4.5 — bind a published workflow instance (if one is assigned
    // to the requirement's scope chain) inside the same transaction. No
    // assignment → legacy flow unchanged.
    const scopes = await scopesForAaccupSubmission(input.requirementId, tx);
    await bindWorkflowInstance({
      entityType: "AACCUP_SUBMISSION",
      entityId: created.id,
      scopes,
      actor,
      tx,
    });
    return created;
  });

  // Fetch the detail with relations outside the transaction (read-only).
  const detail = await repo.findById(submission.id);
  if (!detail) throw new NotFoundError("AACCUP submission not found");

  await writeAudit({
    action: AUDIT_ACTIONS.AACCUP_SUBMISSION_CREATED,
    userId: actor.id,
    entity: "aaccup_submission",
    entityId: submission.id,
    newValue: {
      requirementId: detail.requirementId,
      documentId: detail.documentId,
      status: detail.status,
      isCurrent: detail.isCurrent,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  // Rule 19: alert every reviewer (aaccup.submission.review / aaccup.manage)
  // that a new submission awaits their action (best-effort, once).
  await safeNotifyReviewers(detail);

  return detail;
}

/** Best-effort "new submission awaits review" notification — never fails creation. */
async function safeNotifyReviewers(detail: AaccupSubmissionDetail): Promise<void> {
  try {
    const reviewers = await prisma.user.findMany({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        role: {
          permissions: {
            some: {
              permission: { code: { in: ["aaccup.submission.review", "aaccup.manage"] } },
            },
          },
        },
      },
      select: { id: true, email: true },
    });
    if (reviewers.length === 0) return;
    await notifyUsers(
      reviewers.map((reviewer) => reviewer.id),
      "AACCUP_SUBMISSION_PENDING_REVIEW",
      {
        title: "New submission pending review",
        message: `"${detail.documentTitle}" (${detail.areaName}) was submitted and is awaiting your review.`,
        entity: "aaccup_submission",
        entityId: detail.id,
        // Contextual destination: the reviewer lands on the submissions view of
        // the originating set (AACCUP / ISO / CERT), oldest submissions first.
        actionUrl: `/aaccup?tab=submissions&areaSet=${encodeURIComponent(detail.areaSet)}`,
      },
    );
    await Promise.allSettled(
      reviewers.map((reviewer) =>
        sendEmail({
          to: reviewer.email,
          subject: "URS-DMS — Submission pending review",
          body: `<p><strong>${detail.documentTitle}</strong> (${detail.areaName}) was submitted and is awaiting your review.</p>`,
        }),
      ),
    );
  } catch {
    // notifications must never break the submission flow
  }
}

/** Notify reviewers when a submitter withdraws an active submission. */
async function safeNotifyReviewersOfWithdrawal(detail: AaccupSubmissionDetail): Promise<void> {
  try {
    const reviewers = await prisma.user.findMany({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        role: {
          permissions: {
            some: {
              permission: { code: { in: ["aaccup.submission.review", "aaccup.manage"] } },
            },
          },
        },
      },
      select: { id: true, email: true },
    });
    if (reviewers.length === 0) return;
    const message = `"${detail.documentTitle}" (${detail.areaName}) was withdrawn by the submitter${detail.status === "WITHDRAWN" && detail.withdrawalReason ? `: ${detail.withdrawalReason}` : "."}`;
    await notifyUsers(
      reviewers.map((reviewer) => reviewer.id),
      "AACCUP_SUBMISSION_WITHDRAWN",
      {
        title: "Submission withdrawn",
        message,
        entity: "aaccup_submission",
        entityId: detail.id,
        actionUrl: `/aaccup?tab=submissions&areaSet=${encodeURIComponent(detail.areaSet)}`,
        metadata: { withdrawnAt: detail.withdrawnAt?.toISOString() ?? null },
      },
    );
    await Promise.allSettled(
      reviewers.map((reviewer) =>
        sendEmail({
          to: reviewer.email,
          subject: "URS-DMS — Submission withdrawn",
          body: `<p><strong>${detail.documentTitle}</strong> (${detail.areaName}) was withdrawn by the submitter.</p><p>Please review the updated submission status in URS-DMS.</p>`,
        }),
      ),
    );
  } catch {
    // notifications must never break the unsubmit operation
  }
}

// -----------------------------------------------------------------------------
// updateSubmission (remarks only; preserves history)
// -----------------------------------------------------------------------------
export async function updateSubmission(
  id: string,
  input: UpdateSubmissionInput,
  actor: Actor,
): Promise<AaccupSubmissionDetail> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("AACCUP submission not found");
  assertCanUpdate(actor, existing.submittedById);

  const updated = await repo.updateRemarks(id, input.remarks ?? existing.remarks);

  await writeAudit({
    action: AUDIT_ACTIONS.AACCUP_SUBMISSION_UPDATED,
    userId: actor.id,
    entity: "aaccup_submission",
    entityId: id,
    oldValue: { remarks: existing.remarks },
    newValue: { remarks: updated.remarks },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return updated;
}

// -----------------------------------------------------------------------------
// unsubmitSubmission — preserves the approved/review history while reopening
// the requirement for a new submission version.
// -----------------------------------------------------------------------------
export async function unsubmitSubmission(
  id: string,
  input: UnsubmitSubmissionInput,
  actor: Actor,
): Promise<AaccupSubmissionDetail> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("AACCUP submission not found");
  assertCanUpdate(actor, existing.submittedById);

  if (!["PENDING", "APPROVED", "NEEDS_REVISION"].includes(existing.status)) {
    throw new ConflictError("Only pending, approved, or returned submissions can be unsubmitted");
  }

  const withdrawn = await repo.withdraw(id, input.reason?.trim() || null);

  await writeAudit({
    action: AUDIT_ACTIONS.AACCUP_SUBMISSION_WITHDRAWN,
    userId: actor.id,
    entity: "aaccup_submission",
    entityId: id,
    oldValue: {
      status: existing.status,
      isCurrent: existing.isCurrent,
      reviewedBy: existing.reviewedById,
      reviewedAt: existing.reviewedAt,
    },
    newValue: {
      status: withdrawn.status,
      isCurrent: withdrawn.isCurrent,
      withdrawnAt: withdrawn.withdrawnAt,
      withdrawalReason: withdrawn.withdrawalReason,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  await safeNotifyReviewersOfWithdrawal(withdrawn);
  return withdrawn;
}

// -----------------------------------------------------------------------------
// reviewSubmission (approve / reject / needs revision)
// State machine:
//   PENDING        → APPROVED | REJECTED | NEEDS_REVISION
//   NEEDS_REVISION → APPROVED | REJECTED | NEEDS_REVISION  (re-review allowed)
//   APPROVED       → no further transitions (terminal)
//   REJECTED       → no further transitions (terminal)
// Approving a submission promotes it to "current" for the requirement, moving
// the previous current row to history (transactional).
// -----------------------------------------------------------------------------
export async function reviewSubmission(
  id: string,
  input: ReviewSubmissionInput,
  actor: Actor,
): Promise<AaccupSubmissionDetail> {
  assertCanReview(actor);

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("AACCUP submission not found");

  // Status-transition validation.
  if (existing.status === "APPROVED" || existing.status === "REJECTED") {
    throw new ConflictError(
      `Submission is already ${existing.status.toLowerCase()} — review is closed`,
    );
  }
  // PENDING or NEEDS_REVISION may proceed.

  const reviewed = await prisma.$transaction(async (tx) => {
    // Sprint 7.4.5 — workflow gate: if a published workflow controls this
    // submission, the review decision must be an allowed action from the
    // current step (legacy fallback when no instance is bound). The
    // instance, action row, submission status and audit entry all update or
    // roll back together.
    const evaluation = await evaluateWorkflowAction(
      "AACCUP_SUBMISSION",
      id,
      REVIEW_DECISION_ACTIONS[input.decision],
      actor,
      tx,
    );
    const row = await tx.aaccupSubmission.update({
      where: { id },
      data: {
        status: input.decision,
        reviewedBy: actor.id,
        reviewedAt: new Date(),
        remarks: input.remarks ?? existing.remarks,
        updatedAt: new Date(),
        // Promotion to current happens only on approval; rejected / needs-
        // revision submissions do not become the current pointer.
        isCurrent: input.decision === "APPROVED" ? true : existing.isCurrent,
      },
    });
    if (input.decision === "APPROVED" && row.isCurrent) {
      await tx.aaccupSubmission.updateMany({
        where: {
          requirementId: existing.requirementId,
          isCurrent: true,
          id: { not: id },
        },
        data: { isCurrent: false },
      });
    }
    if (evaluation) {
      await recordWorkflowAction(tx, evaluation, actor, input.remarks ?? undefined);
    }
    return row;
  });

  const detail = await repo.findById(reviewed.id);
  if (!detail) throw new NotFoundError("AACCUP submission not found");

  await writeAudit({
    action: AUDIT_ACTIONS.AACCUP_SUBMISSION_REVIEWED,
    userId: actor.id,
    entity: "aaccup_submission",
    entityId: id,
    oldValue: { status: existing.status, reviewedBy: existing.reviewedById },
    newValue: {
      status: detail.status,
      reviewedBy: actor.id,
      remarks: detail.remarks,
      isCurrent: detail.isCurrent,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  // Rule 19: notify the submitter of the review outcome (best-effort, once).
  await safeNotifySubmitter(existing.submittedById, input.decision, id);

  return detail;
}

/** Best-effort submission-review notification — never fails the review. */
async function safeNotifySubmitter(
  submitterId: string,
  decision: "APPROVED" | "REJECTED" | "NEEDS_REVISION",
  submissionId: string,
): Promise<void> {
  try {
    if (decision === "APPROVED") {
      await notifyUser(submitterId, "AACCUP_SUBMISSION_APPROVED", {
        title: "Submission approved",
        message: "Your document submission has been approved.",
        entity: "aaccup_submission",
        entityId: submissionId,
        actionUrl: "/user/aaccup?tab=submissions&status=APPROVED",
      });
    } else if (decision === "NEEDS_REVISION") {
      await notifyUser(submitterId, "AACCUP_SUBMISSION_RETURNED", {
        title: "Submission returned",
        message: "Your document submission was returned for revision. Please review the remarks and resubmit.",
        entity: "aaccup_submission",
        entityId: submissionId,
        actionUrl: "/user/aaccup?tab=submissions&status=NEEDS_REVISION",
      });
    } else {
      await notifyUser(submitterId, "AACCUP_SUBMISSION_REJECTED", {
        title: "Submission rejected",
        message: "Your document submission has been rejected. Please review the remarks.",
        entity: "aaccup_submission",
        entityId: submissionId,
        actionUrl: "/user/aaccup?tab=submissions&status=REJECTED",
      });
    }
  } catch {
    // notifications must never break the review operation
  }
}

// -----------------------------------------------------------------------------
// archiveSubmission (soft delete)
// -----------------------------------------------------------------------------
export async function archiveSubmission(id: string, actor: Actor): Promise<AaccupSubmissionDetail> {
  assertCanArchive(actor);

  const existing = await repo.findById(id, false);
  if (!existing) throw new NotFoundError("AACCUP submission not found");

  const archived = await repo.archive(id);

  await writeAudit({
    action: AUDIT_ACTIONS.AACCUP_SUBMISSION_ARCHIVED,
    userId: actor.id,
    entity: "aaccup_submission",
    entityId: id,
    oldValue: { status: existing.status, isCurrent: existing.isCurrent },
    newValue: { deletedAt: archived.deletedAt, isCurrent: false },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return archived;
}

// -----------------------------------------------------------------------------
// restoreSubmission
// -----------------------------------------------------------------------------
export async function restoreSubmission(id: string, actor: Actor): Promise<AaccupSubmissionDetail> {
  // Reuse the archive permission for restore, per the sprint spec which lists
  // only read / create / review / update / archive.
  assertCanArchive(actor);

  const existing = await repo.findById(id, true);
  if (!existing) throw new NotFoundError("AACCUP submission not found");
  if (!existing.deletedAt) {
    throw new BadRequestError("Submission is not archived");
  }

  const restored = await repo.restore(id);

  await writeAudit({
    action: AUDIT_ACTIONS.AACCUP_SUBMISSION_RESTORED,
    userId: actor.id,
    entity: "aaccup_submission",
    entityId: id,
    oldValue: { deletedAt: existing.deletedAt },
    newValue: { deletedAt: null },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return restored;
}
