import { writeAudit } from "@/modules/audit/audit.service";
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "@/utils/errors";
import * as repo from "@/modules/root/root.organization.repository";
import {
  ORG_ENTITIES,
  type ListResult,
  type OrgEntityName,
  type OrganizationRecordRow,
  type OrganizationTree,
  type OrganizationVersionRow,
} from "@/modules/root/root.organization.types";
import type { ListOrganizationQuery } from "@/modules/root/root.organization.validator";

// =============================================================================
// URS-DMS — Root · Organization Management Engine service (Sprint 7.4.2)
// -----------------------------------------------------------------------------
// Business logic + RBAC re-checks (defence in depth — the route layer's
// requirePermission(...) is the first gate; the service re-asserts the same
// permission so a wiring mistake can never bypass RBAC). No role checks —
// only permission codes.
//
// RBAC model (matches the catalog in permissions.constants.ts):
//   - organization.read     → list / detail / tree / versions
//   - organization.create   → create
//   - organization.update   → update
//   - organization.archive  → archive + restore
//   - organization.rollback → roll back to a version snapshot
// All codes are ROOT-only by construction (ROOT_ONLY_CODES in
// roles.constants.ts), and the router additionally requires role ROOT.
//
// Configuration Engine integration: every mutation writes a version snapshot
// (organization_versions) inside the same transaction as the record write —
// the same version → rollback lifecycle the engine applies to configuration
// values. Rollback replays an older snapshot's fields onto the record and
// appends a ROLLED_BACK snapshot.
// =============================================================================

export interface Actor {
  id: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

type OrgLevel = "UNDERGRADUATE" | "GRADUATE" | "DOCTORAL" | "CERTIFICATE" | "DIPLOMA";

export interface OrgCreateInput {
  name: string;
  code: string;
  description?: string | null;
  displayOrder?: number;
  campusId?: string | null;
  collegeId?: string | null;
  departmentId?: string | null;
  headId?: string | null;
  level?: OrgLevel | null;
}

export interface OrgUpdateInput {
  name?: string;
  code?: string;
  description?: string | null;
  displayOrder?: number;
  campusId?: string | null;
  collegeId?: string | null;
  departmentId?: string | null;
  headId?: string | null;
  level?: OrgLevel | null;
}

function assertCanRead(actor: Actor): void {
  if (!actor.permissions.includes("organization.read")) {
    throw new ForbiddenError("You do not have access to the organization engine");
  }
}

function assertCanCreate(actor: Actor): void {
  if (!actor.permissions.includes("organization.create")) {
    throw new ForbiddenError("You do not have permission to create organization records");
  }
}

function assertCanUpdate(actor: Actor): void {
  if (!actor.permissions.includes("organization.update")) {
    throw new ForbiddenError("You do not have permission to update organization records");
  }
}

function assertCanArchive(actor: Actor): void {
  if (!actor.permissions.includes("organization.archive")) {
    throw new ForbiddenError("You do not have permission to archive or restore organization records");
  }
}

function assertCanRollback(actor: Actor): void {
  if (!actor.permissions.includes("organization.rollback")) {
    throw new ForbiddenError("You do not have permission to roll back organization records");
  }
}

// -----------------------------------------------------------------------------
// Parent validation — a parent must exist AND be live (archived parents are
// rejected with a friendly message rather than a FK error).
// -----------------------------------------------------------------------------
interface ParentRefs {
  campusId?: string | null;
  collegeId?: string | null;
  departmentId?: string | null;
  headId?: string | null;
}

async function assertParentsValid(refs: ParentRefs): Promise<void> {
  if (refs.campusId) {
    const ok = await repo.parentExists("campus", refs.campusId);
    if (!ok) throw new BadRequestError("The referenced campus does not exist or is archived");
  }
  if (refs.collegeId) {
    const ok = await repo.parentExists("college", refs.collegeId);
    if (!ok) throw new BadRequestError("The referenced college does not exist or is archived");
  }
  if (refs.departmentId) {
    const ok = await repo.parentExists("department", refs.departmentId);
    if (!ok) throw new BadRequestError("The referenced department does not exist or is archived");
  }
  if (refs.headId) {
    const ok = await repo.parentExists("user", refs.headId);
    if (!ok) throw new BadRequestError("The referenced user does not exist or is archived");
  }
}

// -----------------------------------------------------------------------------
// listRecords
// -----------------------------------------------------------------------------
export async function listRecords(
  entity: OrgEntityName,
  query: ListOrganizationQuery,
  actor: Actor,
): Promise<ListResult> {
  assertCanRead(actor);
  const cfg = ORG_ENTITIES[entity];
  const { items, total } = await repo.listRecords(
    cfg,
    {
      q: query.q,
      includeArchived: query.includeArchived,
      campusId: query.campusId,
      collegeId: query.collegeId,
      departmentId: query.departmentId,
    },
    query.page,
    query.pageSize,
  );
  return {
    items,
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

// -----------------------------------------------------------------------------
// getRecord
// -----------------------------------------------------------------------------
export async function getRecord(
  entity: OrgEntityName,
  id: string,
  actor: Actor,
): Promise<OrganizationRecordRow> {
  assertCanRead(actor);
  const record = await repo.findRecordById(ORG_ENTITIES[entity], id);
  if (!record) throw new NotFoundError("Record not found");
  return record;
}

// -----------------------------------------------------------------------------
// createRecord
// -----------------------------------------------------------------------------
export async function createRecord(
  entity: OrgEntityName,
  input: OrgCreateInput,
  actor: Actor,
): Promise<OrganizationRecordRow> {
  assertCanCreate(actor);
  const cfg = ORG_ENTITIES[entity];

  if (await repo.codeTaken(cfg, input.code)) {
    throw new ConflictError(`A ${cfg.label.toLowerCase()} with this code already exists`);
  }
  await assertParentsValid(input);

  const record = await repo.createWithSnapshot(
    cfg,
    {
      name: input.name,
      code: input.code,
      description: input.description ?? null,
      displayOrder: input.displayOrder ?? 0,
      campusId: input.campusId ?? null,
      collegeId: input.collegeId ?? null,
      departmentId: input.departmentId ?? null,
      headId: input.headId ?? null,
      level: input.level ?? null,
    },
    actor.id,
  );

  await writeAudit({
    action: cfg.audit.created,
    userId: actor.id,
    entity: cfg.name,
    entityId: record.id,
    newValue: { name: record.name, code: record.code },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return record;
}

// -----------------------------------------------------------------------------
// updateRecord
// -----------------------------------------------------------------------------
export async function updateRecord(
  entity: OrgEntityName,
  id: string,
  input: OrgUpdateInput,
  actor: Actor,
): Promise<OrganizationRecordRow> {
  assertCanUpdate(actor);
  const cfg = ORG_ENTITIES[entity];

  const existing = await repo.findRecordById(cfg, id);
  if (!existing) throw new NotFoundError("Record not found");
  if (existing.deletedAt) {
    throw new BadRequestError("Record is archived; restore it before updating");
  }

  const nextCode = input.code ?? existing.code;
  if (nextCode !== existing.code && (await repo.codeTaken(cfg, nextCode, id))) {
    throw new ConflictError(`A ${cfg.label.toLowerCase()} with this code already exists`);
  }
  await assertParentsValid({
    campusId: input.campusId !== undefined ? input.campusId : existing.campusId,
    collegeId: input.collegeId !== undefined ? input.collegeId : existing.collegeId,
    departmentId: input.departmentId !== undefined ? input.departmentId : existing.departmentId,
    headId: input.headId !== undefined ? input.headId : existing.headId,
  });

  const updated = await repo.updateWithSnapshot(
    cfg,
    id,
    {
      name: input.name ?? existing.name,
      code: nextCode,
      description:
        input.description !== undefined ? input.description : existing.description,
      displayOrder: input.displayOrder ?? existing.displayOrder,
      campusId: input.campusId !== undefined ? input.campusId : existing.campusId,
      collegeId: input.collegeId !== undefined ? input.collegeId : existing.collegeId,
      departmentId:
        input.departmentId !== undefined ? input.departmentId : existing.departmentId,
      headId: input.headId !== undefined ? input.headId : existing.headId,
      level: input.level !== undefined ? input.level : existing.level,
    },
    actor.id,
  );

  await writeAudit({
    action: cfg.audit.updated,
    userId: actor.id,
    entity: cfg.name,
    entityId: id,
    oldValue: { name: existing.name, code: existing.code },
    newValue: { name: updated.name, code: updated.code },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return updated;
}

// -----------------------------------------------------------------------------
// archiveRecord / restoreRecord (soft delete lifecycle, versioned)
// -----------------------------------------------------------------------------
export async function archiveRecord(
  entity: OrgEntityName,
  id: string,
  actor: Actor,
): Promise<OrganizationRecordRow> {
  assertCanArchive(actor);
  const cfg = ORG_ENTITIES[entity];

  const existing = await repo.findRecordById(cfg, id);
  if (!existing) throw new NotFoundError("Record not found");

  const archived = await repo.setArchivedWithSnapshot(cfg, id, new Date(), actor.id);

  await writeAudit({
    action: cfg.audit.archived,
    userId: actor.id,
    entity: cfg.name,
    entityId: id,
    oldValue: { name: existing.name, code: existing.code, deletedAt: null },
    newValue: { name: archived.name, code: archived.code, deletedAt: archived.deletedAt },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return archived;
}

export async function restoreRecord(
  entity: OrgEntityName,
  id: string,
  actor: Actor,
): Promise<OrganizationRecordRow> {
  assertCanArchive(actor);
  const cfg = ORG_ENTITIES[entity];

  const existing = await repo.findRecordById(cfg, id, true);
  if (!existing) throw new NotFoundError("Record not found");
  if (!existing.deletedAt) throw new BadRequestError("Record is not archived");

  const restored = await repo.setRestoredWithSnapshot(cfg, id, actor.id);

  await writeAudit({
    action: cfg.audit.restored,
    userId: actor.id,
    entity: cfg.name,
    entityId: id,
    oldValue: { name: existing.name, code: existing.code, deletedAt: existing.deletedAt },
    newValue: { name: restored.name, code: restored.code, deletedAt: null },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return restored;
}

// -----------------------------------------------------------------------------
// listVersions / rollbackRecord — Configuration Engine integration
// -----------------------------------------------------------------------------
export async function listVersions(
  entity: OrgEntityName,
  id: string,
  actor: Actor,
): Promise<OrganizationVersionRow[]> {
  assertCanRead(actor);
  const cfg = ORG_ENTITIES[entity];

  const existing = await repo.findRecordById(cfg, id, true);
  if (!existing) throw new NotFoundError("Record not found");

  return repo.listVersions(cfg, id);
}

export async function rollbackRecord(
  entity: OrgEntityName,
  id: string,
  toVersion: number,
  actor: Actor,
): Promise<OrganizationRecordRow> {
  assertCanRollback(actor);
  const cfg = ORG_ENTITIES[entity];

  const existing = await repo.findRecordById(cfg, id, true);
  if (!existing) throw new NotFoundError("Record not found");

  if (existing.version === 0) {
    throw new BadRequestError("Record has no version history to roll back to");
  }
  if (toVersion >= existing.version) {
    throw new BadRequestError("Cannot roll back to the current or a newer version");
  }

  const snapshot = await repo.findVersion(cfg, id, toVersion);
  if (!snapshot) throw new NotFoundError(`Version ${toVersion} not found`);

  const rolled = await repo.rollbackToVersion(cfg, id, snapshot, actor.id);

  await writeAudit({
    action: cfg.audit.rolledBack,
    userId: actor.id,
    entity: cfg.name,
    entityId: id,
    oldValue: { name: existing.name, code: existing.code },
    newValue: { name: rolled.name, code: rolled.code },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return rolled;
}

// -----------------------------------------------------------------------------
// getOrganizationTree — campus → college → department → offices/programs (+
// orphans under Unassigned).
// -----------------------------------------------------------------------------
export async function getOrganizationTree(actor: Actor): Promise<OrganizationTree> {
  assertCanRead(actor);
  const raw = await repo.getTreeData();

  type TreeNode = OrganizationTree["campuses"][number];
  const baseNode = (): TreeNode => ({
    id: "",
    name: "",
    code: "",
    description: null,
    level: null,
    colleges: [],
    departments: [],
    offices: [],
    programs: [],
  });
  const deptNode = (d: repo.TreeDeptRow): TreeNode => ({ ...baseNode(), id: d.id, name: d.name, code: d.code, description: d.description });
  const officeNode = (o: repo.TreeOfficeRow): TreeNode => ({ ...baseNode(), id: o.id, name: o.name, code: o.code, description: o.description });
  const programNode = (p: repo.TreeProgramRow): TreeNode => ({ ...baseNode(), id: p.id, name: p.name, code: p.code, description: p.description, level: p.level });
  const collegeNode = (c: repo.TreeCollegeRow): TreeNode => ({ ...baseNode(), id: c.id, name: c.name, code: c.code, description: c.description });

  // Campus nodes (root level) with their own colleges arrays.
  const campuses: TreeNode[] = raw.campuses.map((c) => ({
    ...baseNode(),
    id: c.id,
    name: c.name,
    code: c.code,
    description: c.description,
  }));
  const campusMap = new Map(campuses.map((c) => [c.id, c]));

  // College nodes; attach to their campus (or Unassigned).
  const collegeMap = new Map<string, TreeNode>();
  for (const c of raw.colleges) {
    const node = collegeNode(c);
    collegeMap.set(c.id, node);
  }
  const unassigned = { ...baseNode(), name: "Unassigned" };
  for (const c of raw.colleges) {
    const node = collegeMap.get(c.id)!;
    if (c.campusId && campusMap.has(c.campusId)) campusMap.get(c.campusId)!.colleges.push(node);
    else unassigned.colleges.push(node);
  }

  // Department nodes; attach to their college (or Unassigned).
  const deptNodes = new Map<string, TreeNode>();
  for (const d of raw.departments) {
    const node = deptNode(d);
    deptNodes.set(d.id, node);
    if (d.collegeId && collegeMap.has(d.collegeId)) collegeMap.get(d.collegeId)!.departments.push(node);
    else unassigned.departments.push(node);
  }

  // Offices / programs → department node, else college node, else Unassigned.
  for (const o of raw.offices) {
    if (o.departmentId && deptNodes.has(o.departmentId)) deptNodes.get(o.departmentId)!.offices.push(officeNode(o));
    else if (o.collegeId && collegeMap.has(o.collegeId)) collegeMap.get(o.collegeId)!.offices.push(officeNode(o));
    else unassigned.offices.push(officeNode(o));
  }
  for (const p of raw.programs) {
    if (p.departmentId && deptNodes.has(p.departmentId)) deptNodes.get(p.departmentId)!.programs.push(programNode(p));
    else if (p.collegeId && collegeMap.has(p.collegeId)) collegeMap.get(p.collegeId)!.programs.push(programNode(p));
    else unassigned.programs.push(programNode(p));
  }

  return { campuses, unassigned };
}
