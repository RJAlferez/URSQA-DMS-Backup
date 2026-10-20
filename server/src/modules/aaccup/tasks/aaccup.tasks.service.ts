import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import { acknowledgeEntityNotifications, notifyUser, notifyUsers } from "@/modules/notifications/notifications.service";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/utils/errors";
import * as repo from "@/modules/aaccup/tasks/aaccup.tasks.repository";
import { resolveRequirementAssignmentForArea } from "@/modules/requirements/requirement.runtime";
import type { Prisma } from "@prisma/client";
import type {
  CreateTaskInput,
  ListTasksQuery,
  UpdateTaskInput,
} from "@/modules/aaccup/tasks/aaccup.tasks.validator";
import type {
  AaccupTaskDetail,
  AaccupTaskListItem,
} from "@/modules/aaccup/tasks/aaccup.tasks.types";

// =============================================================================
// URS-DMS — AACCUP task service
// RBAC model (mirrors the Area / Requirement services):
//   - "managers" = users holding aaccup.manage (admins + QAOs). Mutations are
//     manager-only; reads require aaccup.read OR manager status.
//   - Assignees are validated at create/update time: USER targets must exist
//     and be ACTIVE; DEPARTMENT targets must exist and not be archived. The
//     display label is snapshotted at write time.
// No `if (role === "admin")` anywhere.
// =============================================================================

export interface ListResult {
  items: AaccupTaskListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface Actor {
  id: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

function isManager(actor: Actor): boolean {
  return actor.permissions.includes("aaccup.manage");
}

function assertCanManage(actor: Actor): void {
  if (!isManager(actor)) {
    throw new ForbiddenError("Only managers can manage AACCUP accreditation tasks");
  }
}

function assertCanRead(actor: Actor): void {
  if (!actor.permissions.includes("aaccup.read") && !isManager(actor)) {
    throw new ForbiddenError("You do not have access to AACCUP accreditation tasks");
  }
}

async function assertAreaExists(areaId: string): Promise<void> {
  const area = await prisma.aaccupArea.findFirst({
    where: { id: areaId, deletedAt: null },
    select: { id: true },
  });
  if (!area) {
    throw new BadRequestError("Referenced AACCUP area not found");
  }
}

// A task may optionally reference a requirement, but only one that belongs to
// the task's own area (and is not archived).
async function assertRequirementForArea(
  areaId: string,
  requirementId: string | null | undefined,
): Promise<void> {
  if (requirementId === undefined || requirementId === null) return;
  const requirement = await prisma.aaccupRequirement.findFirst({
    where: { id: requirementId, deletedAt: null },
    select: { id: true, areaId: true },
  });
  if (!requirement) {
    throw new BadRequestError("Referenced requirement not found");
  }
  if (requirement.areaId !== areaId) {
    throw new BadRequestError("Requirement does not belong to the task's area");
  }
}

export async function listTaskRequirementTemplates(
  areaId: string,
  actor: Actor,
): Promise<Array<{ id: string; name: string; code: string; version: number }>> {
  assertCanRead(actor);
  await assertAreaExists(areaId);
  const assignment = await resolveRequirementAssignmentForArea(areaId);
  if (!assignment) return [];
  const template = await prisma.requirementTemplate.findFirst({
    where: { id: assignment.templateId, status: "ACTIVE", deletedAt: null },
    select: { id: true, name: true, code: true, version: true },
  });
  return template ? [template] : [];
}

async function assertRequirementTemplateForArea(areaId: string, templateId: string | null | undefined): Promise<void> {
  if (templateId === undefined || templateId === null) return;
  const assignment = await resolveRequirementAssignmentForArea(areaId);
  if (!assignment || assignment.templateId !== templateId) {
    throw new BadRequestError("Selected requirement template is not active for this area");
  }
}

function normalizeAssigneeType(assigneeType: "USER" | "DEPARTMENT"): "USER" | "DEPARTMENT" {
  return assigneeType === "DEPARTMENT" ? "DEPARTMENT" : "USER";
}

// Resolve an assignee target to a display label, validating existence.
// USER targets must be ACTIVE and not archived; DEPARTMENT targets must not
// be archived.
async function resolveAssignee(
  assigneeType: "USER" | "DEPARTMENT",
  assigneeId: string,
): Promise<string> {
  if (assigneeType === "DEPARTMENT") {
    const department = await prisma.department.findFirst({
      where: { id: assigneeId, deletedAt: null },
      select: { name: true },
    });
    if (!department) {
      throw new BadRequestError("Referenced department not found");
    }
    return department.name;
  }

  const user = await prisma.user.findFirst({
    where: { id: assigneeId, deletedAt: null },
    select: { firstName: true, lastName: true, status: true },
  });
  if (!user) {
    throw new BadRequestError("Referenced user not found");
  }
  if (user.status !== "ACTIVE") {
    throw new BadRequestError("Tasks can only be assigned to active users");
  }
  return `${user.firstName} ${user.lastName}`.trim();
}

// -----------------------------------------------------------------------------
// listTaskAssignees — the aaccup.read-scoped picker for the Create Task modal
// (active users + non-archived departments). QAOs can populate their task
// assignee dropdowns without needing the admin `user.read` permission.
// -----------------------------------------------------------------------------
export async function listTaskAssignees(
  actor: Actor,
): Promise<{ users: Array<{ id: string; fullName: string }>; departments: Array<{ id: string; name: string }> }> {
  assertCanRead(actor);
  const [users, departments] = await Promise.all([
    prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, firstName: true, middleName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.department.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    users: users.map((u) => ({
      id: u.id,
      fullName: [u.firstName, u.middleName, u.lastName].filter(Boolean).join(" ").trim(),
    })),
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
  };
}

/** Best-effort "you have been assigned a task" notification — never fails creation. */
async function safeNotifyAssignee(
  assigneeType: "USER" | "DEPARTMENT",
  assigneeId: string,
  task: AaccupTaskDetail,
): Promise<void> {
  try {
    const base = {
      title: "New task assigned",
      message: `You have been assigned a new task: "${task.title}" (${task.areaName}).${task.dueDate ? ` Due ${task.dueDate.toLocaleString("en-PH", { timeZone: "Asia/Manila" })}.` : " No deadline is set."}`,
      entity: "aaccup_task",
      entityId: task.id,
      actionUrl: `/user/aaccup?tab=tasks&highlight=${task.id}`,
      forceEmail: true,
    };
    if (assigneeType === "USER") {
      await notifyUser(assigneeId, "AACCUP_TASK_ASSIGNED", base);
      return;
    }
    const members = await prisma.user.findMany({
      where: { departmentId: assigneeId, status: "ACTIVE", deletedAt: null },
      select: { id: true },
    });
    await notifyUsers(
      members.map((m) => m.id),
      "AACCUP_TASK_ASSIGNED",
      base,
    );
  } catch {
    // notifications must never break task creation
  }
}

const SORT_FIELDS = new Set(["title", "status", "priority", "dueDate", "createdAt", "updatedAt"]);

// -----------------------------------------------------------------------------
// listTasks
// -----------------------------------------------------------------------------
export async function listTasks(query: ListTasksQuery, actor: Actor): Promise<ListResult> {
  assertCanRead(actor);

  const where: Prisma.AaccupTaskWhereInput = {
    deletedAt: null,
    area: { deletedAt: null },
  };
  if (query.areaId) {
    await assertAreaExists(query.areaId);
    where.areaId = query.areaId;
  }
  if (query.status) where.status = query.status;
  if (query.priority) where.priority = query.priority;
  if (query.assigneeType) where.assigneeType = query.assigneeType;

  // `mine=true` — tasks assigned to the caller (USER target) or to a
  // DEPARTMENT the caller belongs to. Used by the user portal "My Tasks" tab.
  if (query.mine === "true") {
    const me = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { departmentId: true },
    });
    where.AND = [
      {
        OR: [
          { assigneeType: "USER", assigneeId: actor.id },
          { assigneeType: "DEPARTMENT", assigneeId: me?.departmentId ?? "__none__" },
        ],
      },
    ];
  }

  if (query.q) {
    where.OR = [
      { title: { contains: query.q, mode: "insensitive" } },
      { description: { contains: query.q, mode: "insensitive" } },
      { assigneeLabel: { contains: query.q, mode: "insensitive" } },
      {
        area: {
          OR: [
            { name: { contains: query.q, mode: "insensitive" } },
            { code: { contains: query.q, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  const sortField = SORT_FIELDS.has(query.sort ?? "") ? (query.sort as string) : "createdAt";
  const sortOrder = query.order;
  const page = query.page;
  const pageSize = query.pageSize;

  const { items, total } = await repo.list(where, page, pageSize, sortField, sortOrder);
  const ownSubmissions = items.length ? await repo.latestOwnSubmissions(items.map((task) => task.id), actor.id, items.flatMap((task) => task.requirementId ? [task.requirementId] : [])) : [];
  const submissionsByTask = new Map<string, typeof ownSubmissions[number]>();
  for (const submission of ownSubmissions) {
    if (submission.taskId && !submissionsByTask.has(submission.taskId)) submissionsByTask.set(submission.taskId, submission);
  }
  const legacyByRequirement = new Map(ownSubmissions.filter((submission) => !submission.taskId).map((submission) => [submission.requirementId, submission]));

  return {
    items: items.map((task) => {
      const submission = submissionsByTask.get(task.id) ?? (task.requirementId ? legacyByRequirement.get(task.requirementId) : undefined);
      return { ...task, mySubmission: submission ? {
        id: submission.id, status: submission.status, requirementId: submission.requirementId,
        documentTitle: submission.document.title, submittedAt: submission.submittedAt,
      } : null };
    }),
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

// -----------------------------------------------------------------------------
// getTask
// -----------------------------------------------------------------------------
export async function getTask(id: string, actor: Actor): Promise<AaccupTaskDetail> {
  assertCanRead(actor);
  const task = await repo.findById(id);
  if (!task) throw new NotFoundError("AACCUP task not found");
  return task;
}

// -----------------------------------------------------------------------------
// createTask
// -----------------------------------------------------------------------------
export async function createTask(input: CreateTaskInput, actor: Actor): Promise<AaccupTaskDetail> {
  assertCanManage(actor);
  await assertAreaExists(input.areaId);
  await assertRequirementForArea(input.areaId, input.requirementId);
  await assertRequirementTemplateForArea(input.areaId, input.requirementTemplateId);

  const assigneeType = normalizeAssigneeType(input.assigneeType);
  const assigneeLabel = await resolveAssignee(assigneeType, input.assigneeId);

  const task = await repo.create({
    areaId: input.areaId,
    title: input.title,
    description: input.description?.trim() ? input.description : null,
    category: input.category ?? null,
    priority: input.priority,
    dueDate: input.dueDate ?? null,
    requirementId: input.requirementId ?? null,
    requirementTemplateId: input.requirementTemplateId ?? null,
    assigneeType,
    assigneeId: input.assigneeId,
    assigneeLabel,
    createdBy: actor.id,
  });

  await writeAudit({
    action: AUDIT_ACTIONS.AACCUP_TASK_CREATED,
    userId: actor.id,
    entity: "aaccup_task",
    entityId: task.id,
    newValue: {
      areaId: task.areaId,
      title: task.title,
      assigneeType,
      assigneeId: input.assigneeId,
      assigneeLabel,
      priority: task.priority,
      status: task.status,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  await safeNotifyAssignee(assigneeType, input.assigneeId, task);

  return task;
}

// -----------------------------------------------------------------------------
// updateTask
// -----------------------------------------------------------------------------
// Managers (aaccup.manage) may edit everything. The ASSIGNEE (USER target
// matching the caller, or any member of the assigned DEPARTMENT) may only
// complete tasks without evidence requirements. New tasks start IN_PROGRESS;
// legacy OPEN tasks remain directly actionable without a separate Start step.
// Evidence-linked tasks complete through approval of their submission.
// -----------------------------------------------------------------------------
const ASSIGNEE_STATUS_TRANSITIONS: Record<string, string[]> = {
  OPEN: ["IN_PROGRESS", "COMPLETED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: ["IN_PROGRESS"],
  CANCELLED: [],
};

async function isAssignee(actorId: string, task: AaccupTaskDetail): Promise<boolean> {
  if (task.assigneeType === "USER") return task.assigneeId === actorId;
  if (task.assigneeType === "DEPARTMENT") {
    const me = await prisma.user.findUnique({
      where: { id: actorId },
      select: { departmentId: true },
    });
    return Boolean(me?.departmentId && me.departmentId === task.assigneeId);
  }
  return false;
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
  actor: Actor,
): Promise<AaccupTaskDetail> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("AACCUP task not found");

  const manager = isManager(actor);
  if (!manager) {
    const assignee = await isAssignee(actor.id, existing);
    if (!assignee) {
      throw new ForbiddenError("Only managers or the assigned user can update this task");
    }
    const statusOnly = Object.keys(input).every((key) => key === "status");
    if (!statusOnly) {
      throw new ForbiddenError("Assignees may only update the task status");
    }
    if (input.status === "COMPLETED") {
      const evidence = await prisma.aaccupSubmission.findFirst({
        where: { taskId: id, submittedBy: actor.id, deletedAt: null, status: { in: ["PENDING", "APPROVED", "NEEDS_REVISION"] } },
        select: { id: true },
      });
      if (existing.requirementId || evidence) throw new ConflictError("Submit your evidence for admin approval to complete this task.");
    }
    if (existing.status === "COMPLETED" && input.status === "IN_PROGRESS") {
      const evidence = await prisma.aaccupSubmission.findFirst({
        where: { submittedBy: actor.id, deletedAt: null,
          OR: [{ taskId: id }, ...(existing.requirementId ? [{ taskId: null, requirementId: existing.requirementId }] : [])] },
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }], select: { status: true },
      });
      if (evidence && ["PENDING", "APPROVED", "NEEDS_REVISION"].includes(evidence.status)) throw new ConflictError("Unsubmit your own evidence to reopen this task.");
    }
  }

  // Status transition validation (applies to managers too — no arbitrary jumps).
  if (input.status !== undefined && input.status !== existing.status) {
    const allowed = manager
      ? ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]
      : ASSIGNEE_STATUS_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot move task from ${existing.status} to ${input.status}`,
      );
    }
  }

  // If the related requirement changes, it must belong to the task's area.
  if (input.requirementId !== undefined && input.requirementId !== existing.requirementId) {
    await assertRequirementForArea(existing.areaId, input.requirementId);
  }
  if (input.requirementTemplateId !== undefined && input.requirementTemplateId !== existing.requirementTemplateId) {
    await assertRequirementTemplateForArea(existing.areaId, input.requirementTemplateId);
  }

  // Re-resolve the assignee whenever the target (type or id) changes.
  const newAssigneeType = input.assigneeType
    ? normalizeAssigneeType(input.assigneeType)
    : existing.assigneeType;
  const newAssigneeId = input.assigneeId ?? existing.assigneeId;
  const assigneeChanged =
    (input.assigneeType !== undefined && input.assigneeType !== existing.assigneeType) ||
    (input.assigneeId !== undefined && input.assigneeId !== existing.assigneeId);
  let assigneeData:
    | { assigneeType: "USER" | "DEPARTMENT"; assigneeId: string; assigneeLabel: string }
    | undefined;
  if (assigneeChanged) {
    if (!newAssigneeId) throw new BadRequestError("Assignee is required");
    assigneeData = {
      assigneeType: newAssigneeType,
      assigneeId: newAssigneeId,
      assigneeLabel: await resolveAssignee(newAssigneeType, newAssigneeId),
    };
  }

  const completedAt =
    input.status === "COMPLETED"
      ? new Date()
      : input.status != null
        ? null
        : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const task = await repo.update({
      id,
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.requirementId !== undefined ? { requirementId: input.requirementId } : {}),
        ...(input.requirementTemplateId !== undefined ? { requirementTemplateId: input.requirementTemplateId } : {}),
        ...(assigneeData ? { ...assigneeData } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
        updatedBy: actor.id,
      },
    }, tx);
    if (input.status === "COMPLETED") {
      await acknowledgeEntityNotifications("aaccup_task", [id], actor, tx);
    }
    return task;
  });

  await writeAudit({
    action: AUDIT_ACTIONS.AACCUP_TASK_UPDATED,
    userId: actor.id,
    entity: "aaccup_task",
    entityId: id,
    oldValue: {
      title: existing.title,
      status: existing.status,
      assigneeLabel: existing.assigneeLabel,
      priority: existing.priority,
    },
    newValue: {
      title: updated.title,
      status: updated.status,
      assigneeLabel: updated.assigneeLabel,
      priority: updated.priority,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  if (assigneeChanged && updated.assigneeId) {
    await safeNotifyAssignee(updated.assigneeType, updated.assigneeId, updated);
  }
  if (existing.status === "COMPLETED" && updated.status === "IN_PROGRESS") {
    const reviewers = await prisma.user.findMany({
      where: { status: "ACTIVE", deletedAt: null, role: { permissions: { some: { permission: { code: { in: ["aaccup.submission.review", "aaccup.manage"] } } } } } },
      select: { id: true },
    });
    await notifyUsers(reviewers.map((user) => user.id), "SYSTEM_ANNOUNCEMENT", {
      title: "Task unsubmitted", message: `"${updated.title}" was reopened by its assignee for changes.`,
      entity: "aaccup_task", entityId: id, actionUrl: `/aaccup?tab=tasks&highlight=${id}`, forceEmail: true,
    }).catch(() => undefined);
  }
  return updated;
}

// -----------------------------------------------------------------------------
// archiveTask (soft delete)
// -----------------------------------------------------------------------------
export async function archiveTask(id: string, actor: Actor): Promise<AaccupTaskDetail> {
  assertCanManage(actor);
  const existing = await repo.findById(id, false);
  if (!existing) throw new NotFoundError("AACCUP task not found");

  const archived = await repo.archive(id, actor.id);

  await writeAudit({
    action: AUDIT_ACTIONS.AACCUP_TASK_ARCHIVED,
    userId: actor.id,
    entity: "aaccup_task",
    entityId: id,
    oldValue: { title: existing.title, status: existing.status },
    newValue: { deletedAt: archived.deletedAt },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return archived;
}

// -----------------------------------------------------------------------------
// restoreTask
// -----------------------------------------------------------------------------
export async function restoreTask(id: string, actor: Actor): Promise<AaccupTaskDetail> {
  assertCanManage(actor);
  const existing = await repo.findById(id, true);
  if (!existing) throw new NotFoundError("AACCUP task not found");
  if (!existing.deletedAt) throw new BadRequestError("Task is not archived");

  await assertAreaExists(existing.areaId);

  const restored = await repo.restore(id, actor.id);

  await writeAudit({
    action: AUDIT_ACTIONS.AACCUP_TASK_RESTORED,
    userId: actor.id,
    entity: "aaccup_task",
    entityId: id,
    oldValue: { status: existing.status, deletedAt: existing.deletedAt },
    newValue: { status: restored.status, deletedAt: null },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return restored;
}
