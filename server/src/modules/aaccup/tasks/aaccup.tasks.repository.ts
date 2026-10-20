import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type {
  AaccupTaskDetail,
  AaccupTaskListItem,
} from "@/modules/aaccup/tasks/aaccup.tasks.types";

// =============================================================================
// URS-DMS — AACCUP task repository
// =============================================================================

const TASK_INCLUDE = {
  area: { select: { id: true, code: true, name: true, areaSet: true, departmentId: true } },
  requirement: { select: { id: true, title: true, documentCode: true } },
  requirementTemplate: { select: { id: true, name: true, version: true } },
  createdByUser: { select: { firstName: true, lastName: true } },
  updatedByUser: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AaccupTaskInclude;

type TaskWithRelations = Prisma.AaccupTaskGetPayload<{
  include: typeof TASK_INCLUDE;
}>;

function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

function toListItem(row: TaskWithRelations): AaccupTaskListItem {
  return {
    id: row.id,
    areaId: row.areaId,
    areaCode: row.area?.code ?? "",
    areaName: row.area?.name ?? "",
    areaSet: row.area?.areaSet ?? "AACCUP",
    departmentId: row.area?.departmentId ?? null,
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    dueDate: row.dueDate,
    requirementId: row.requirementId,
    requirementTitle: row.requirement?.title ?? null,
    requirementCode: row.requirement?.documentCode ?? null,
    requirementTemplateId: row.requirementTemplateId,
    requirementTemplateName: row.requirementTemplate?.name ?? null,
    requirementTemplateVersion: row.requirementTemplate?.version ?? null,
    assigneeType: row.assigneeType === "DEPARTMENT" ? "DEPARTMENT" : "USER",
    assigneeId: row.assigneeId,
    assigneeLabel: row.assigneeLabel,
    createdBy: row.createdBy,
    createdByName: row.createdByUser
      ? fullName(row.createdByUser.firstName, row.createdByUser.lastName)
      : "",
    updatedBy: row.updatedBy,
    updatedByName: row.updatedByUser
      ? fullName(row.updatedByUser.firstName, row.updatedByUser.lastName)
      : null,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: TaskWithRelations): AaccupTaskDetail {
  return { ...toListItem(row), deletedAt: row.deletedAt };
}

export async function list(
  where: Prisma.AaccupTaskWhereInput,
  page: number,
  pageSize: number,
  sortField: string,
  sortOrder: "asc" | "desc",
): Promise<{ items: AaccupTaskListItem[]; total: number }> {
  const [rows, total] = await Promise.all([
    prisma.aaccupTask.findMany({
      where,
      include: TASK_INCLUDE,
      orderBy: {
        [sortField]: sortOrder,
      } as Prisma.AaccupTaskOrderByWithRelationInput,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.aaccupTask.count({ where }),
  ]);

  return { items: rows.map(toListItem), total };
}

export async function findById(
  id: string,
  includeDeleted = false,
): Promise<AaccupTaskDetail | null> {
  const row = await prisma.aaccupTask.findFirst({
    where: includeDeleted ? { id } : { id, deletedAt: null },
    include: TASK_INCLUDE,
  });
  return row ? toDetail(row) : null;
}

export async function latestOwnSubmissions(taskIds: string[], userId: string, requirementIds: string[]) {
  return prisma.aaccupSubmission.findMany({
    where: { submittedBy: userId, deletedAt: null, OR: [
      { taskId: { in: taskIds } },
      { taskId: null, requirementId: { in: requirementIds } },
    ] },
    distinct: ["taskId", "requirementId"],
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    select: {
      id: true, taskId: true, requirementId: true, status: true, submittedAt: true,
      document: { select: { title: true } },
    },
  });
}

export interface CreateTaskArgs {
  areaId: string;
  title: string;
  description: string | null;
  category: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueDate: Date | null;
  requirementId: string | null;
  requirementTemplateId: string | null;
  assigneeType: "USER" | "DEPARTMENT";
  assigneeId: string;
  assigneeLabel: string;
  createdBy: string;
}

export async function create(args: CreateTaskArgs): Promise<AaccupTaskDetail> {
  const row = await prisma.aaccupTask.create({
    data: {
      areaId: args.areaId,
      title: args.title,
      description: args.description,
      category: args.category,
      priority: args.priority,
      dueDate: args.dueDate,
      requirementId: args.requirementId,
      requirementTemplateId: args.requirementTemplateId,
      assigneeType: args.assigneeType,
      assigneeId: args.assigneeId,
      assigneeLabel: args.assigneeLabel,
      createdBy: args.createdBy,
    },
    include: TASK_INCLUDE,
  });
  return toDetail(row);
}

export interface UpdateTaskArgs {
  id: string;
  data: {
    title?: string;
    description?: string | null;
    category?: string | null;
    priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
    status?: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
    dueDate?: Date | null;
    requirementId?: string | null;
    requirementTemplateId?: string | null;
    assigneeType?: "USER" | "DEPARTMENT";
    assigneeId?: string;
    assigneeLabel?: string;
    completedAt?: Date | null;
    updatedBy?: string;
  };
}

export async function update(args: UpdateTaskArgs): Promise<AaccupTaskDetail> {
  const row = await prisma.aaccupTask.update({
    where: { id: args.id },
    data: {
      ...(args.data.title !== undefined ? { title: args.data.title } : {}),
      ...(args.data.description !== undefined ? { description: args.data.description } : {}),
      ...(args.data.category !== undefined ? { category: args.data.category } : {}),
      ...(args.data.priority !== undefined ? { priority: args.data.priority } : {}),
      ...(args.data.status !== undefined ? { status: args.data.status } : {}),
      ...(args.data.dueDate !== undefined ? { dueDate: args.data.dueDate } : {}),
      ...(args.data.requirementId !== undefined ? { requirementId: args.data.requirementId } : {}),
      ...(args.data.requirementTemplateId !== undefined ? { requirementTemplateId: args.data.requirementTemplateId } : {}),
      ...(args.data.assigneeType !== undefined ? { assigneeType: args.data.assigneeType } : {}),
      ...(args.data.assigneeId !== undefined ? { assigneeId: args.data.assigneeId } : {}),
      ...(args.data.assigneeLabel !== undefined ? { assigneeLabel: args.data.assigneeLabel } : {}),
      ...(args.data.completedAt !== undefined ? { completedAt: args.data.completedAt } : {}),
      ...(args.data.updatedBy !== undefined ? { updatedBy: args.data.updatedBy } : {}),
      updatedAt: new Date(),
    },
    include: TASK_INCLUDE,
  });
  return toDetail(row);
}

export async function archive(id: string, updatedBy: string): Promise<AaccupTaskDetail> {
  const row = await prisma.aaccupTask.update({
    where: { id },
    data: { deletedAt: new Date(), updatedAt: new Date(), updatedBy },
    include: TASK_INCLUDE,
  });
  return toDetail(row);
}

export async function restore(id: string, updatedBy: string): Promise<AaccupTaskDetail> {
  const row = await prisma.aaccupTask.update({
    where: { id },
    data: { deletedAt: null, updatedAt: new Date(), updatedBy },
    include: TASK_INCLUDE,
  });
  return toDetail(row);
}
