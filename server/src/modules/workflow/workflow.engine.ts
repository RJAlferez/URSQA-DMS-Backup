import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import { getRequestId } from "@/middlewares/requestContext";
import {
  invalidateWorkflowCache,
  workflowCacheGet,
  workflowCacheSet,
} from "@/modules/workflow/workflow.cache";
import type {
  WorkflowEntityType,
  WorkflowInstanceStatus,
  WorkflowSnapshot,
  WorkflowSnapshotStep,
  WorkflowSnapshotTransition,
  WorkflowTargetType,
} from "@/modules/workflow/workflow.types";
import { ConflictError, ForbiddenError, NotFoundError } from "@/utils/errors";
import type { Prisma } from "@prisma/client";

// =============================================================================
// Workflow Engine — runtime resolution + execution (Sprint 7.4.5)
// -----------------------------------------------------------------------------
// Resolution precedence (platform-first, never hardcoded):
//   1. most specific active assignment scope (AACCUP_AREA > ACCREDITATION_CYCLE
//      > DEPARTMENT > COLLEGE > UNIVERSITY; REQUEST/DOCUMENT scopes derive
//      from the department chain),
//   2. assignment `priority` (higher wins),
//   3. newest effective assignment (createdAt desc).
// If no published assignment resolves, callers keep their legacy behavior
// (fail-open). Instances execute the IMMUTABLE version snapshot pinned at
// bind time — later authoring edits can never corrupt running instances.
// =============================================================================

export interface WorkflowScope {
  targetType: WorkflowTargetType;
  targetId: string | null;
}

export interface WorkflowActor {
  id: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

export interface ResolvedWorkflow {
  assignmentId: string;
  definitionId: string;
  definitionCode: string;
  definitionName: string;
  versionId: string;
  version: number;
  snapshot: WorkflowSnapshot;
}

function resolveCacheKey(entityType: WorkflowEntityType, scopes: WorkflowScope[]): string {
  return `workflow-resolve:${entityType}:${scopes
    .map((scope) => `${scope.targetType}:${scope.targetId ?? "~"}`)
    .join("|")}`;
}

function parseSnapshot(data: Prisma.JsonValue, fallbackName: string): WorkflowSnapshot {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Corrupt workflow snapshot data (${fallbackName})`);
  }
  return data as unknown as WorkflowSnapshot;
}

export async function resolveWorkflowForEntity(
  entityType: WorkflowEntityType,
  scopes: WorkflowScope[],
  tx?: Prisma.TransactionClient,
): Promise<ResolvedWorkflow | null> {
  const db = tx ?? prisma;
  const key = resolveCacheKey(entityType, scopes);
  const cached = workflowCacheGet<ResolvedWorkflow | null>(key);
  if (cached !== undefined) return cached;

  const assignments = await db.workflowAssignment.findMany({
    where: {
      deletedAt: null,
      OR: scopes.map((scope) => ({ targetType: scope.targetType, targetId: scope.targetId })),
      definition: { deletedAt: null, status: "PUBLISHED" },
    },
    select: {
      id: true,
      targetType: true,
      targetId: true,
      priority: true,
      createdAt: true,
      definitionId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  let resolved: ResolvedWorkflow | null = null;
  for (const scope of scopes) {
    const candidates = assignments
      .filter((a) => a.targetType === scope.targetType && a.targetId === scope.targetId)
      .sort((a, b) => b.priority - a.priority || b.createdAt.getTime() - a.createdAt.getTime());
    if (candidates.length === 0) continue;

    const assignment = candidates[0]!;
    const definition = await db.workflowDefinition.findFirst({
      where: { id: assignment.definitionId, deletedAt: null, status: "PUBLISHED" },
      select: { id: true, code: true, name: true, version: true },
    });
    if (!definition) continue;

    const version = await db.workflowVersion.findFirst({
      where: { definitionId: definition.id, version: definition.version },
      select: { id: true, data: true },
    });
    if (!version) {
      throw new Error(
        `Published workflow "${definition.code}" v${definition.version} has no version snapshot`,
      );
    }
    resolved = {
      assignmentId: assignment.id,
      definitionId: definition.id,
      definitionCode: definition.code,
      definitionName: definition.name,
      versionId: version.id,
      version: definition.version,
      snapshot: parseSnapshot(version.data, definition.code),
    };
    break;
  }

  workflowCacheSet(key, resolved);
  return resolved;
}

// -----------------------------------------------------------------------------
// Scope derivation per entity type (dynamic records, never hardcoded)
// -----------------------------------------------------------------------------

export async function scopesForAaccupSubmission(
  requirementId: string,
  tx?: Prisma.TransactionClient,
): Promise<WorkflowScope[]> {
  const db = tx ?? prisma;
  const requirement = await db.aaccupRequirement.findFirst({
    where: { id: requirementId, deletedAt: null },
    select: {
      area: {
        select: {
          id: true,
          accreditationCycleId: true,
          accreditationCycle: { select: { status: true, deletedAt: true } },
          department: { select: { id: true, collegeId: true } },
        },
      },
    },
  });
  if (!requirement?.area) throw new NotFoundError("AACCUP requirement not found");
  const area = requirement.area;
  const scopes: WorkflowScope[] = [{ targetType: "AACCUP_AREA", targetId: area.id }];
  if (
    area.accreditationCycleId &&
    area.accreditationCycle?.deletedAt === null &&
    area.accreditationCycle.status === "ACTIVE"
  ) {
    scopes.push({ targetType: "ACCREDITATION_CYCLE", targetId: area.accreditationCycleId });
  }
  if (area.department.id) scopes.push({ targetType: "DEPARTMENT", targetId: area.department.id });
  if (area.department.collegeId) {
    scopes.push({ targetType: "COLLEGE", targetId: area.department.collegeId });
  }
  scopes.push({ targetType: "UNIVERSITY", targetId: null });
  return scopes;
}

export async function scopesForDocumentRequest(
  requesterId: string,
  tx?: Prisma.TransactionClient,
): Promise<WorkflowScope[]> {
  const db = tx ?? prisma;
  const user = await db.user.findFirst({
    where: { id: requesterId, deletedAt: null },
    select: {
      departmentId: true,
      departments: { where: { deletedAt: null }, select: { id: true, collegeId: true } },
    },
  });
  const departmentId = user?.departmentId ?? user?.departments[0]?.id ?? null;
  let collegeId: string | null = null;
  if (departmentId) {
    const department = await db.department.findFirst({
      where: { id: departmentId },
      select: { collegeId: true },
    });
    collegeId = department?.collegeId ?? null;
  }
  const scopes: WorkflowScope[] = [];
  if (departmentId) {
    scopes.push({ targetType: "DEPARTMENT", targetId: departmentId });
    if (collegeId) scopes.push({ targetType: "COLLEGE", targetId: collegeId });
  }
  scopes.push({ targetType: "UNIVERSITY", targetId: null });
  return scopes;
}

export async function scopesForDocument(
  documentId: string,
  tx?: Prisma.TransactionClient,
): Promise<WorkflowScope[]> {
  const db = tx ?? prisma;
  const document = await db.document.findFirst({
    where: { id: documentId, deletedAt: null },
    select: {
      department: { select: { id: true, collegeId: true } },
      folder: { select: { departmentId: true } },
    },
  });
  const departmentId = document?.department?.id ?? document?.folder?.departmentId ?? null;
  const scopes: WorkflowScope[] = [];
  if (departmentId) {
    scopes.push({ targetType: "DEPARTMENT", targetId: departmentId });
    if (document?.department?.collegeId) {
      scopes.push({ targetType: "COLLEGE", targetId: document.department.collegeId });
    }
  }
  scopes.push({ targetType: "UNIVERSITY", targetId: null });
  return scopes;
}

// -----------------------------------------------------------------------------
// Instance lifecycle
// -----------------------------------------------------------------------------

async function writeAuditInTx(
  tx: Prisma.TransactionClient | undefined,
  entry: {
    action: string;
    userId?: string | null;
    entity?: string;
    entityId?: string;
    oldValue?: unknown;
    newValue?: unknown;
    ipAddress?: string;
    userAgent?: string;
  },
): Promise<void> {
  if (tx) {
    await tx.auditLog.create({
      data: {
        action: entry.action,
        userId: entry.userId ?? null,
        entity: entry.entity ?? null,
        entityId: entry.entityId ?? null,
        oldValue: (entry.oldValue as object | null) ?? undefined,
        newValue: (entry.newValue as object | null) ?? undefined,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
        correlationId: getRequestId() ?? null,
      },
    });
    return;
  }
  await writeAudit(entry as Parameters<typeof writeAudit>[0]);
}

export interface BindWorkflowInput {
  entityType: WorkflowEntityType;
  entityId: string;
  scopes: WorkflowScope[];
  actor: WorkflowActor;
  tx?: Prisma.TransactionClient;
}

export interface BindWorkflowResult {
  bound: boolean;
  instanceId?: string;
  startStepCode?: string;
}

export async function bindWorkflowInstance(input: BindWorkflowInput): Promise<BindWorkflowResult> {
  const resolved = await resolveWorkflowForEntity(input.entityType, input.scopes, input.tx);
  if (!resolved) return { bound: false };
  const startStep = resolved.snapshot.steps.find((step) => step.type === "START");
  if (!startStep) {
    throw new ConflictError(
      `Workflow "${resolved.definitionCode}" has no start step; cannot bind instance`,
    );
  }
  const db = input.tx ?? prisma;
  const instance = await db.workflowInstance.create({
    data: {
      definitionId: resolved.definitionId,
      versionId: resolved.versionId,
      entityType: input.entityType,
      entityId: input.entityId,
      currentStepCode: startStep.code,
      startedById: input.actor.id,
      data: {
        definitionCode: resolved.definitionCode,
        definitionName: resolved.definitionName,
        version: resolved.version,
        assignmentId: resolved.assignmentId,
      },
    },
    select: { id: true },
  });
  await db.workflowStepInstance.create({
    data: {
      instanceId: instance.id,
      stepCode: startStep.code,
      stepName: startStep.name,
      stepType: startStep.type,
      status: "ACTIVE",
      activatedAt: new Date(),
      actorId: input.actor.id,
    },
  });
  await writeAuditInTx(input.tx, {
    action: AUDIT_ACTIONS.WORKFLOW_INSTANCE_STARTED,
    userId: input.actor.id,
    entity: "WorkflowInstance",
    entityId: instance.id,
    newValue: {
      entityType: input.entityType,
      entityId: input.entityId,
      definitionCode: resolved.definitionCode,
      definitionName: resolved.definitionName,
      version: resolved.version,
      startStep: startStep.code,
    },
    ipAddress: input.actor.ipAddress,
    userAgent: input.actor.userAgent,
  });
  return { bound: true, instanceId: instance.id, startStepCode: startStep.code };
}

export interface EvaluatedTransition {
  instance: {
    id: string;
    definitionId: string;
    versionId: string;
    entityType: WorkflowEntityType;
    entityId: string;
    currentStepCode: string | null;
  };
  snapshot: WorkflowSnapshot;
  fromStep: WorkflowSnapshotStep;
  transition: WorkflowSnapshotTransition;
  nextStep: WorkflowSnapshotStep;
}

export async function evaluateWorkflowAction(
  entityType: WorkflowEntityType,
  entityId: string,
  actionCode: string,
  actor: WorkflowActor,
  tx?: Prisma.TransactionClient,
): Promise<EvaluatedTransition | null> {
  const db = tx ?? prisma;
  const instance = await db.workflowInstance.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });
  if (!instance) return null; // no workflow bound → legacy path

  if (instance.status !== "RUNNING") {
    throw new ConflictError("Workflow instance is not running");
  }

  const version = await db.workflowVersion.findUnique({
    where: { id: instance.versionId },
    select: { data: true },
  });
  if (!version) throw new NotFoundError("Workflow version snapshot not found");
  const snapshot = parseSnapshot(version.data, instance.definitionId);

  const fromStep = snapshot.steps.find((step) => step.code === instance.currentStepCode);
  if (!fromStep) {
    throw new ConflictError("Workflow instance is not on an active step");
  }

  const transition = snapshot.transitions.find(
    (t) => t.fromStepId === fromStep.id && t.actionCode === actionCode,
  );
  if (!transition) {
    throw new ConflictError(
      `Action "${actionCode}" is not allowed from step "${fromStep.code}"`,
    );
  }

  await assertActorSatisfiesStep(fromStep, actor, db);
  if (transition.requiredPermission && !actor.permissions.includes(transition.requiredPermission)) {
    throw new ForbiddenError(
      `Transition "${actionCode}" requires permission "${transition.requiredPermission}"`,
    );
  }

  const nextStep = snapshot.steps.find((step) => step.id === transition.toStepId);
  if (!nextStep) {
    throw new ConflictError(`Transition "${actionCode}" targets a missing step`);
  }

  return { instance, snapshot, fromStep, transition, nextStep };
}

async function assertActorSatisfiesStep(
  step: WorkflowSnapshotStep,
  actor: WorkflowActor,
  db: Prisma.TransactionClient | typeof prisma,
): Promise<void> {
  if (step.roleName) {
    const user = await db.user.findFirst({
      where: { id: actor.id, deletedAt: null },
      select: { role: { select: { name: true } } },
    });
    if (!user || user.role.name !== step.roleName) {
      throw new ForbiddenError(`Step "${step.code}" requires role "${step.roleName}"`);
    }
  }
  if (step.permissionCode && !actor.permissions.includes(step.permissionCode)) {
    throw new ForbiddenError(
      `Step "${step.code}" requires permission "${step.permissionCode}"`,
    );
  }
}

export interface PerformWorkflowActionInput {
  entityType: WorkflowEntityType;
  entityId: string;
  actionCode: string;
  actor: WorkflowActor;
  note?: string;
}

export interface PerformWorkflowActionResult {
  performed: boolean;
  instanceId?: string;
  fromStepCode?: string;
  nextStepCode?: string;
  nextStepType?: string;
  completed?: boolean;
}

export async function performWorkflowAction(
  input: PerformWorkflowActionInput,
): Promise<PerformWorkflowActionResult> {
  const evaluation = await evaluateWorkflowAction(
    input.entityType,
    input.entityId,
    input.actionCode,
    input.actor,
  );
  if (!evaluation) return { performed: false };

  return prisma.$transaction(async (tx) => {
    return recordWorkflowAction(tx, evaluation, input.actor, input.note);
  });
}

export async function recordWorkflowAction(
  tx: Prisma.TransactionClient,
  evaluation: EvaluatedTransition,
  actor: WorkflowActor,
  note?: string,
): Promise<PerformWorkflowActionResult> {
  const { instance, snapshot, fromStep, nextStep } = evaluation;
  const completed = nextStep.type === "END";
  const now = new Date();

  // Optimistic concurrency claim: only a RUNNING instance on the expected
  // step can advance. Concurrent stale transitions get HTTP 409.
  const claim = await tx.workflowInstance.updateMany({
    where: { id: instance.id, status: "RUNNING", currentStepCode: fromStep.code },
    data: {
      currentStepCode: completed ? null : nextStep.code,
      status: completed ? "COMPLETED" : "RUNNING",
      completedAt: completed ? now : null,
    },
  });
  if (claim.count === 0) {
    throw new ConflictError("Workflow instance state changed concurrently; refresh and retry");
  }

  await tx.workflowStepInstance.updateMany({
    where: { instanceId: instance.id, stepCode: fromStep.code, status: "ACTIVE" },
    data: { status: "COMPLETED", completedAt: now },
  });
  if (!completed) {
    await tx.workflowStepInstance.upsert({
      where: { instanceId_stepCode: { instanceId: instance.id, stepCode: nextStep.code } },
      create: {
        instanceId: instance.id,
        stepCode: nextStep.code,
        stepName: nextStep.name,
        stepType: nextStep.type,
        status: "ACTIVE",
        activatedAt: now,
        actorId: actor.id,
      },
      update: { status: "ACTIVE", activatedAt: now, actorId: actor.id },
    });
  }

  await tx.workflowAction.create({
    data: {
      instanceId: instance.id,
      stepCode: fromStep.code,
      stepName: fromStep.name,
      stepType: fromStep.type,
      actionCode: evaluation.transition.actionCode,
      fromStepCode: fromStep.code,
      toStepCode: nextStep.code,
      actorId: actor.id,
      note: note ?? null,
      data: {
        definitionCode: snapshot.code,
        version: snapshot.version,
        entityType: instance.entityType,
        entityId: instance.entityId,
        completed,
      },
    },
  });

  await tx.auditLog.create({
    data: {
      action: completed
        ? AUDIT_ACTIONS.WORKFLOW_INSTANCE_COMPLETED
        : AUDIT_ACTIONS.WORKFLOW_INSTANCE_TRANSITIONED,
      userId: actor.id,
      entity: "WorkflowInstance",
      entityId: instance.id,
      newValue: {
        entityType: instance.entityType,
        entityId: instance.entityId,
        action: evaluation.transition.actionCode,
        fromStep: fromStep.code,
        toStep: nextStep.code,
        completed,
      },
      ipAddress: actor.ipAddress ?? null,
      userAgent: actor.userAgent ?? null,
      correlationId: getRequestId() ?? null,
    },
  });

  return {
    performed: true,
    instanceId: instance.id,
    fromStepCode: fromStep.code,
    nextStepCode: nextStep.code,
    nextStepType: nextStep.type,
    completed,
  };
}

export interface OverrideWorkflowInstanceInput {
  instanceId: string;
  action: "COMPLETE" | "TERMINATE";
  actor: WorkflowActor;
  note?: string;
}

export async function overrideWorkflowInstance(
  input: OverrideWorkflowInstanceInput,
): Promise<{ id: string; status: WorkflowInstanceStatus }> {
  const targetStatus: WorkflowInstanceStatus = input.action === "COMPLETE" ? "COMPLETED" : "TERMINATED";
  return prisma.$transaction(async (tx) => {
    const claim = await tx.workflowInstance.updateMany({
      where: { id: input.instanceId, status: "RUNNING" },
      data: { status: targetStatus, currentStepCode: null, completedAt: new Date() },
    });
    if (claim.count === 0) {
      throw new ConflictError("Workflow instance is not running");
    }
    const active = await tx.workflowStepInstance.findMany({
      where: { instanceId: input.instanceId, status: "ACTIVE" },
      select: { id: true },
    });
    if (active.length > 0) {
      await tx.workflowStepInstance.updateMany({
        where: { id: { in: active.map((row) => row.id) } },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        action: AUDIT_ACTIONS.WORKFLOW_INSTANCE_OVERRIDDEN,
        userId: input.actor.id,
        entity: "WorkflowInstance",
        entityId: input.instanceId,
        newValue: { action: input.action, status: targetStatus, note: input.note ?? null },
        ipAddress: input.actor.ipAddress ?? null,
        userAgent: input.actor.userAgent ?? null,
        correlationId: getRequestId() ?? null,
      },
    });
    return { id: input.instanceId, status: targetStatus };
  });
}

export { invalidateWorkflowCache };
