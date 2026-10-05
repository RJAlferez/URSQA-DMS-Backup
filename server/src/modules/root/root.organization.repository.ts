import { prisma } from "@/lib/prisma";
import type {
  OrganizationChangeType,
  OrganizationEntity,
  Prisma,
  ProgramLevel,
} from "@prisma/client";
import type {
  OrgEntityConfig,
  OrganizationRecordRow,
  OrganizationVersionRow,
  OrgSnapshotData,
} from "@/modules/root/root.organization.types";

// =============================================================================
// URS-DMS — Root · Organization Management Engine repository (Sprint 7.4.2)
// -----------------------------------------------------------------------------
// Pure data access over the master-data tables (campuses are the Sprint 7.4.9
// top level; colleges + departments reuse the Sprint 7.1 tables; offices +
// programs are the 7.4.2 tables). Every mutation is transactional: the record
// write and its version snapshot are committed together so
// `organization_versions.version` can never drift from the record's snapshot
// history.
//
// Raw rows from the per-entity selects are normalized onto the shared
// OrganizationRecordRow shape; version numbers come from organization_versions
// (records predating the engine report version 0).
// =============================================================================

export interface RawOrgRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  displayOrder: number;
  campusId: string | null;
  collegeId: string | null;
  departmentId: string | null;
  headId: string | null;
  level: ProgramLevel | null;
  campus: { id: string; name: string } | null;
  college: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  head: { id: string; firstName: string; lastName: string } | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const selects = {
  campus: {
    id: true,
    name: true,
    code: true,
    description: true,
    displayOrder: true,
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  } satisfies Prisma.CampusSelect,
  college: {
    id: true,
    name: true,
    code: true,
    description: true,
    displayOrder: true,
    campusId: true,
    campus: { select: { id: true, name: true } },
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  } satisfies Prisma.CollegeSelect,
  department: {
    id: true,
    name: true,
    code: true,
    description: true,
    displayOrder: true,
    campusId: true,
    campus: { select: { id: true, name: true } },
    collegeId: true,
    college: { select: { id: true, name: true } },
    headId: true,
    head: { select: { id: true, firstName: true, lastName: true } },
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  } satisfies Prisma.DepartmentSelect,
  office: {
    id: true,
    name: true,
    code: true,
    description: true,
    displayOrder: true,
    campusId: true,
    campus: { select: { id: true, name: true } },
    collegeId: true,
    college: { select: { id: true, name: true } },
    departmentId: true,
    department: { select: { id: true, name: true } },
    headId: true,
    head: { select: { id: true, firstName: true, lastName: true } },
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  } satisfies Prisma.OfficeSelect,
  program: {
    id: true,
    name: true,
    code: true,
    description: true,
    displayOrder: true,
    level: true,
    campusId: true,
    campus: { select: { id: true, name: true } },
    collegeId: true,
    college: { select: { id: true, name: true } },
    departmentId: true,
    department: { select: { id: true, name: true } },
    createdAt: true,
    updatedAt: true,
    deletedAt: true,
  } satisfies Prisma.ProgramSelect,
} as const;

export interface OrgListFilter {
  q?: string;
  includeArchived?: boolean;
  campusId?: string;
  collegeId?: string;
  departmentId?: string;
}

function normalize(
  row: RawOrgRow,
  version: number,
): OrganizationRecordRow {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    displayOrder: row.displayOrder ?? 0,
    campusId: row.campusId ?? null,
    campusName: row.campus?.name ?? null,
    collegeId: row.collegeId ?? null,
    collegeName: row.college?.name ?? null,
    departmentId: row.departmentId ?? null,
    departmentName: row.department?.name ?? null,
    headId: row.headId ?? null,
    headName: row.head ? `${row.head.firstName} ${row.head.lastName}` : null,
    level: row.level ?? null,
    version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function snapshotData(row: RawOrgRow): OrgSnapshotData {
  return {
    name: row.name,
    code: row.code,
    description: row.description,
    displayOrder: row.displayOrder ?? 0,
    campusId: row.campusId ?? null,
    collegeId: row.collegeId ?? null,
    departmentId: row.departmentId ?? null,
    headId: row.headId ?? null,
    level: row.level ?? null,
  };
}

async function nextVersion(
  tx: Prisma.TransactionClient,
  entity: OrganizationEntity,
  entityId: string,
): Promise<number> {
  const agg = await tx.organizationVersion.aggregate({
    where: { entity, entityId },
    _max: { version: true },
  });
  return (agg._max.version ?? 0) + 1;
}

async function snapshotInTx(
  tx: Prisma.TransactionClient,
  entity: OrganizationEntity,
  entityId: string,
  changeType: OrganizationChangeType,
  data: OrgSnapshotData,
  actorId: string | null,
): Promise<number> {
  const version = await nextVersion(tx, entity, entityId);
  await tx.organizationVersion.create({
    data: {
      entity,
      entityId,
      version,
      changeType,
      data: data as unknown as Prisma.InputJsonValue,
      changedById: actorId,
    },
  });
  return version;
}

// -----------------------------------------------------------------------------
// Lookups
// -----------------------------------------------------------------------------
function buildWhere(cfg: OrgEntityConfig, filter: OrgListFilter): Record<string, unknown> {
  const base: Record<string, unknown> = filter.includeArchived
    ? {}
    : { deletedAt: null };
  if (filter.q) {
    base.OR = [
      { name: { contains: filter.q, mode: "insensitive" } },
      { code: { contains: filter.q, mode: "insensitive" } },
    ];
  }
  if (filter.campusId && cfg.model !== "campus") {
    base.campusId = filter.campusId;
  }
  if (filter.collegeId && (cfg.model === "department" || cfg.model === "office" || cfg.model === "program")) {
    base.collegeId = filter.collegeId;
  }
  if (filter.departmentId && (cfg.model === "office" || cfg.model === "program")) {
    base.departmentId = filter.departmentId;
  }
  return base;
}

async function findManyRaw(
  cfg: OrgEntityConfig,
  where: Record<string, unknown>,
  page: number,
  pageSize: number,
): Promise<{ rows: RawOrgRow[]; total: number }> {
  const skip = (page - 1) * pageSize;
  switch (cfg.model) {
    case "campus": {
      const [items, total] = await Promise.all([
        prisma.campus.findMany({
          where: where as Prisma.CampusWhereInput,
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
          skip,
          take: pageSize,
          select: selects.campus,
        }),
        prisma.campus.count({ where: where as Prisma.CampusWhereInput }),
      ]);
      return { rows: items as unknown as RawOrgRow[], total };
    }
    case "college": {
      const [items, total] = await Promise.all([
        prisma.college.findMany({
          where: where as Prisma.CollegeWhereInput,
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
          skip,
          take: pageSize,
          select: selects.college,
        }),
        prisma.college.count({ where: where as Prisma.CollegeWhereInput }),
      ]);
      return { rows: items as unknown as RawOrgRow[], total };
    }
    case "department": {
      const [items, total] = await Promise.all([
        prisma.department.findMany({
          where: where as Prisma.DepartmentWhereInput,
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
          skip,
          take: pageSize,
          select: selects.department,
        }),
        prisma.department.count({ where: where as Prisma.DepartmentWhereInput }),
      ]);
      return { rows: items as unknown as RawOrgRow[], total };
    }
    case "office": {
      const [items, total] = await Promise.all([
        prisma.office.findMany({
          where: where as Prisma.OfficeWhereInput,
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
          skip,
          take: pageSize,
          select: selects.office,
        }),
        prisma.office.count({ where: where as Prisma.OfficeWhereInput }),
      ]);
      return { rows: items as unknown as RawOrgRow[], total };
    }
    case "program": {
      const [items, total] = await Promise.all([
        prisma.program.findMany({
          where: where as Prisma.ProgramWhereInput,
          orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
          skip,
          take: pageSize,
          select: selects.program,
        }),
        prisma.program.count({ where: where as Prisma.ProgramWhereInput }),
      ]);
      return { rows: items as unknown as RawOrgRow[], total };
    }
  }
}

async function currentVersions(
  cfg: OrgEntityConfig,
  ids: string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const grouped = await prisma.organizationVersion.groupBy({
    by: ["entityId"],
    where: { entity: cfg.entity, entityId: { in: ids } },
    _max: { version: true },
  });
  return new Map(grouped.map((g) => [g.entityId, g._max.version ?? 0]));
}

export async function listRecords(
  cfg: OrgEntityConfig,
  filter: OrgListFilter,
  page: number,
  pageSize: number,
): Promise<{ items: OrganizationRecordRow[]; total: number }> {
  const { rows, total } = await findManyRaw(cfg, buildWhere(cfg, filter), page, pageSize);
  const versions = await currentVersions(
    cfg,
    rows.map((r) => r.id),
  );
  return {
    items: rows.map((r) => normalize(r, versions.get(r.id) ?? 0)),
    total,
  };
}

export async function findRecordById(
  cfg: OrgEntityConfig,
  id: string,
  includeDeleted = false,
): Promise<OrganizationRecordRow | null> {
  let row: RawOrgRow | null = null;
  switch (cfg.model) {
    case "campus":
      row = (await prisma.campus.findFirst({
        where: includeDeleted ? { id } : { id, deletedAt: null },
        select: selects.campus,
      })) as unknown as RawOrgRow | null;
      break;
    case "college":
      row = (await prisma.college.findFirst({
        where: includeDeleted ? { id } : { id, deletedAt: null },
        select: selects.college,
      })) as unknown as RawOrgRow | null;
      break;
    case "department":
      row = (await prisma.department.findFirst({
        where: includeDeleted ? { id } : { id, deletedAt: null },
        select: selects.department,
      })) as unknown as RawOrgRow | null;
      break;
    case "office":
      row = (await prisma.office.findFirst({
        where: includeDeleted ? { id } : { id, deletedAt: null },
        select: selects.office,
      })) as unknown as RawOrgRow | null;
      break;
    case "program":
      row = (await prisma.program.findFirst({
        where: includeDeleted ? { id } : { id, deletedAt: null },
        select: selects.program,
      })) as unknown as RawOrgRow | null;
      break;
  }
  if (!row) return null;
  const version = (await currentVersions(cfg, [id])).get(id) ?? 0;
  return normalize(row, version);
}

export async function codeTaken(
  cfg: OrgEntityConfig,
  code: string,
  excludeId?: string,
): Promise<boolean> {
  const notSelf = excludeId ? { NOT: { id: excludeId } } : {};
  switch (cfg.model) {
    case "campus":
      return Boolean(
        await prisma.campus.findFirst({
          where: { code, ...notSelf } as Prisma.CampusWhereInput,
          select: { id: true },
        }),
      );
    case "college":
      return Boolean(
        await prisma.college.findFirst({
          where: { code, ...notSelf } as Prisma.CollegeWhereInput,
          select: { id: true },
        }),
      );
    case "department":
      return Boolean(
        await prisma.department.findFirst({
          where: { code, ...notSelf } as Prisma.DepartmentWhereInput,
          select: { id: true },
        }),
      );
    case "office":
      return Boolean(
        await prisma.office.findFirst({
          where: { code, ...notSelf } as Prisma.OfficeWhereInput,
          select: { id: true },
        }),
      );
    case "program":
      return Boolean(
        await prisma.program.findFirst({
          where: { code, ...notSelf } as Prisma.ProgramWhereInput,
          select: { id: true },
        }),
      );
  }
}

// -----------------------------------------------------------------------------
// Mutations (record write + version snapshot in one transaction)
// -----------------------------------------------------------------------------
export async function parentExists(
  kind: "campus" | "college" | "department" | "user",
  id: string,
): Promise<boolean> {
  switch (kind) {
    case "campus":
      return Boolean(
        await prisma.campus.findFirst({
          where: { id, deletedAt: null },
          select: { id: true },
        }),
      );
    case "college":
      return Boolean(
        await prisma.college.findFirst({
          where: { id, deletedAt: null },
          select: { id: true },
        }),
      );
    case "department":
      return Boolean(
        await prisma.department.findFirst({
          where: { id, deletedAt: null },
          select: { id: true },
        }),
      );
    case "user":
      return Boolean(
        await prisma.user.findFirst({
          where: { id, deletedAt: null },
          select: { id: true },
        }),
      );
  }
}

export interface OrgWriteFields {
  name: string;
  code: string;
  description: string | null;
  displayOrder?: number;
  campusId?: string | null;
  collegeId?: string | null;
  departmentId?: string | null;
  headId?: string | null;
  level?: ProgramLevel | null;
}

export async function createWithSnapshot(
  cfg: OrgEntityConfig,
  data: OrgWriteFields,
  actorId: string | null,
): Promise<OrganizationRecordRow> {
  switch (cfg.model) {
    case "campus": {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.campus.create({
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
          },
          select: selects.campus,
        });
        const raw = created as unknown as RawOrgRow;
        await snapshotInTx(tx, cfg.entity, created.id, "CREATED", snapshotData(raw), actorId);
        return raw;
      });
      return normalize(row, 1);
    }
    case "college": {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.college.create({
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            campusId: data.campusId ?? null,
          },
          select: selects.college,
        });
        const raw = created as unknown as RawOrgRow;
        await snapshotInTx(tx, cfg.entity, created.id, "CREATED", snapshotData(raw), actorId);
        return raw;
      });
      return normalize(row, 1);
    }
    case "department": {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.department.create({
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            campusId: data.campusId ?? null,
            collegeId: data.collegeId ?? null,
            headId: data.headId ?? null,
          },
          select: selects.department,
        });
        const raw = created as unknown as RawOrgRow;
        await snapshotInTx(tx, cfg.entity, created.id, "CREATED", snapshotData(raw), actorId);
        return raw;
      });
      return normalize(row, 1);
    }
    case "office": {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.office.create({
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            campusId: data.campusId ?? null,
            collegeId: data.collegeId ?? null,
            departmentId: data.departmentId ?? null,
            headId: data.headId ?? null,
          },
          select: selects.office,
        });
        const raw = created as unknown as RawOrgRow;
        await snapshotInTx(tx, cfg.entity, created.id, "CREATED", snapshotData(raw), actorId);
        return raw;
      });
      return normalize(row, 1);
    }
    case "program": {
      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.program.create({
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            level: data.level ?? "UNDERGRADUATE",
            campusId: data.campusId ?? null,
            collegeId: data.collegeId ?? null,
            departmentId: data.departmentId ?? null,
          },
          select: selects.program,
        });
        const raw = created as unknown as RawOrgRow;
        await snapshotInTx(tx, cfg.entity, created.id, "CREATED", snapshotData(raw), actorId);
        return raw;
      });
      return normalize(row, 1);
    }
  }
}

export async function updateWithSnapshot(
  cfg: OrgEntityConfig,
  id: string,
  data: OrgWriteFields,
  actorId: string | null,
): Promise<OrganizationRecordRow> {
  switch (cfg.model) {
    case "campus":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.campus.update({
          where: { id },
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
          },
          select: selects.campus,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "UPDATED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "college":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.college.update({
          where: { id },
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            campusId: data.campusId ?? null,
          },
          select: selects.college,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "UPDATED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "department":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.department.update({
          where: { id },
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            campusId: data.campusId ?? null,
            collegeId: data.collegeId ?? null,
            headId: data.headId ?? null,
          },
          select: selects.department,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "UPDATED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "office":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.office.update({
          where: { id },
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            campusId: data.campusId ?? null,
            collegeId: data.collegeId ?? null,
            departmentId: data.departmentId ?? null,
            headId: data.headId ?? null,
          },
          select: selects.office,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "UPDATED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "program":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.program.update({
          where: { id },
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            level: data.level ?? "UNDERGRADUATE",
            campusId: data.campusId ?? null,
            collegeId: data.collegeId ?? null,
            departmentId: data.departmentId ?? null,
          },
          select: selects.program,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "UPDATED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
  }
}

export async function setArchivedWithSnapshot(
  cfg: OrgEntityConfig,
  id: string,
  deletedAt: Date,
  actorId: string | null,
): Promise<OrganizationRecordRow> {
  switch (cfg.model) {
    case "campus":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.campus.update({
          where: { id },
          data: { deletedAt },
          select: selects.campus,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "ARCHIVED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "college":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.college.update({
          where: { id },
          data: { deletedAt },
          select: selects.college,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "ARCHIVED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "department":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.department.update({
          where: { id },
          data: { deletedAt },
          select: selects.department,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "ARCHIVED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "office":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.office.update({
          where: { id },
          data: { deletedAt },
          select: selects.office,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "ARCHIVED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "program":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.program.update({
          where: { id },
          data: { deletedAt },
          select: selects.program,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "ARCHIVED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
  }
}

export async function setRestoredWithSnapshot(
  cfg: OrgEntityConfig,
  id: string,
  actorId: string | null,
): Promise<OrganizationRecordRow> {
  switch (cfg.model) {
    case "campus":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.campus.update({
          where: { id },
          data: { deletedAt: null },
          select: selects.campus,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "RESTORED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "college":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.college.update({
          where: { id },
          data: { deletedAt: null },
          select: selects.college,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "RESTORED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "department":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.department.update({
          where: { id },
          data: { deletedAt: null },
          select: selects.department,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "RESTORED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "office":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.office.update({
          where: { id },
          data: { deletedAt: null },
          select: selects.office,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "RESTORED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "program":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.program.update({
          where: { id },
          data: { deletedAt: null },
          select: selects.program,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "RESTORED", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
  }
}

export async function rollbackToVersion(
  cfg: OrgEntityConfig,
  id: string,
  data: OrgSnapshotData,
  actorId: string | null,
): Promise<OrganizationRecordRow> {
  switch (cfg.model) {
    case "campus":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.campus.update({
          where: { id },
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            deletedAt: null,
          },
          select: selects.campus,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "ROLLED_BACK", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "college":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.college.update({
          where: { id },
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            campusId: data.campusId ?? null,
            deletedAt: null,
          },
          select: selects.college,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "ROLLED_BACK", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "department":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.department.update({
          where: { id },
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            campusId: data.campusId ?? null,
            collegeId: data.collegeId ?? null,
            headId: data.headId ?? null,
            deletedAt: null,
          },
          select: selects.department,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "ROLLED_BACK", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "office":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.office.update({
          where: { id },
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            campusId: data.campusId ?? null,
            collegeId: data.collegeId ?? null,
            departmentId: data.departmentId ?? null,
            headId: data.headId ?? null,
            deletedAt: null,
          },
          select: selects.office,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "ROLLED_BACK", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
    case "program":
      return prisma.$transaction(async (tx) => {
        const updated = await tx.program.update({
          where: { id },
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            displayOrder: data.displayOrder ?? 0,
            level: data.level ?? "UNDERGRADUATE",
            campusId: data.campusId ?? null,
            collegeId: data.collegeId ?? null,
            departmentId: data.departmentId ?? null,
            deletedAt: null,
          },
          select: selects.program,
        });
        const raw = updated as unknown as RawOrgRow;
        const version = await snapshotInTx(tx, cfg.entity, id, "ROLLED_BACK", snapshotData(raw), actorId);
        return normalize(raw, version);
      });
  }
}

// -----------------------------------------------------------------------------
// Versions
// -----------------------------------------------------------------------------
export async function listVersions(
  cfg: OrgEntityConfig,
  entityId: string,
): Promise<OrganizationVersionRow[]> {
  const rows = await prisma.organizationVersion.findMany({
    where: { entity: cfg.entity, entityId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      entity: true,
      entityId: true,
      version: true,
      changeType: true,
      data: true,
      changedById: true,
      createdAt: true,
      changedBy: { select: { firstName: true, lastName: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    entity: r.entity,
    entityId: r.entityId,
    version: r.version,
    changeType: r.changeType,
    data: (r.data ?? null) as unknown as OrgSnapshotData,
    changedById: r.changedById,
    changedByName: r.changedBy
      ? `${r.changedBy.firstName} ${r.changedBy.lastName}`
      : null,
    createdAt: r.createdAt,
  }));
}

export async function findVersion(
  cfg: OrgEntityConfig,
  entityId: string,
  version: number,
): Promise<OrgSnapshotData | null> {
  const row = await prisma.organizationVersion.findUnique({
    where: { entity_entityId_version: { entity: cfg.entity, entityId, version } },
    select: { data: true },
  });
  return row ? ((row.data ?? null) as unknown as OrgSnapshotData) : null;
}

// -----------------------------------------------------------------------------
// Organization tree (live rows only) — campus → college → department →
// offices/programs.
// -----------------------------------------------------------------------------
export interface TreeCampusRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
}
export interface TreeCollegeRow extends TreeCampusRow {
  campusId: string | null;
}
export interface TreeDeptRow extends TreeCollegeRow {
  collegeId: string | null;
}
export interface TreeOfficeRow extends TreeDeptRow {
  departmentId: string | null;
}
export interface TreeProgramRow extends TreeDeptRow {
  departmentId: string | null;
  level: ProgramLevel;
}

export async function getTreeData(): Promise<{
  campuses: TreeCampusRow[];
  colleges: TreeCollegeRow[];
  departments: TreeDeptRow[];
  offices: TreeOfficeRow[];
  programs: TreeProgramRow[];
}> {
  const [campuses, colleges, departments, offices, programs] = await Promise.all([
    prisma.campus.findMany({
      where: { deletedAt: null },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, description: true },
    }),
    prisma.college.findMany({
      where: { deletedAt: null },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, code: true, description: true, campusId: true },
    }),
    prisma.department.findMany({
      where: { deletedAt: null },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        campusId: true,
        collegeId: true,
      },
    }),
    prisma.office.findMany({
      where: { deletedAt: null },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        campusId: true,
        collegeId: true,
        departmentId: true,
      },
    }),
    prisma.program.findMany({
      where: { deletedAt: null },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        code: true,
        description: true,
        level: true,
        campusId: true,
        collegeId: true,
        departmentId: true,
      },
    }),
  ]);
  return { campuses, colleges, departments, offices, programs };
}
