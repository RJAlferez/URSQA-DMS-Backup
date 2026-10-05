import type {
  OrganizationChangeType,
  OrganizationEntity,
  ProgramLevel,
} from "@prisma/client";
import { AUDIT_ACTIONS, type AuditAction } from "@/config/constants";

// =============================================================================
// URS-DMS â€” Root Â· Organization Management Engine types (Sprint 7.4.2)
// -----------------------------------------------------------------------------
// One entity config per master-data record type. Colleges and departments
// reuse the Sprint 7.1 physical tables (`colleges`, `departments`); offices
// and programs are the 7.4.2 tables. `path` is the route collection segment
// (mounted at /root/organization/<path> AND aliased at /root/<path>), `model`
// is the Prisma model key, and `audit` carries the per-action audit constants.
// =============================================================================

export type OrgEntityName = "campus" | "college" | "department" | "office" | "program";

export interface OrgEntityConfig {
  entity: OrganizationEntity;
  name: OrgEntityName;
  path: string;
  label: string;
  model: "campus" | "college" | "department" | "office" | "program";
  audit: {
    created: AuditAction;
    updated: AuditAction;
    archived: AuditAction;
    restored: AuditAction;
    rolledBack: AuditAction;
  };
}

export const ORG_ENTITIES: Record<OrgEntityName, OrgEntityConfig> = {
  campus: {
    entity: "CAMPUS",
    name: "campus",
    path: "campuses",
    label: "Campus",
    model: "campus",
    audit: {
      created: AUDIT_ACTIONS.CAMPUS_CREATED,
      updated: AUDIT_ACTIONS.CAMPUS_UPDATED,
      archived: AUDIT_ACTIONS.CAMPUS_ARCHIVED,
      restored: AUDIT_ACTIONS.CAMPUS_RESTORED,
      rolledBack: AUDIT_ACTIONS.ORGANIZATION_CAMPUS_ROLLED_BACK,
    },
  },
  college: {
    entity: "COLLEGE",
    name: "college",
    path: "colleges",
    label: "College",
    model: "college",
    audit: {
      created: AUDIT_ACTIONS.COLLEGE_CREATED,
      updated: AUDIT_ACTIONS.COLLEGE_UPDATED,
      archived: AUDIT_ACTIONS.COLLEGE_ARCHIVED,
      restored: AUDIT_ACTIONS.COLLEGE_RESTORED,
      rolledBack: AUDIT_ACTIONS.ORGANIZATION_COLLEGE_ROLLED_BACK,
    },
  },
  department: {
    entity: "DEPARTMENT",
    name: "department",
    path: "departments",
    label: "Department",
    model: "department",
    audit: {
      created: AUDIT_ACTIONS.DEPARTMENT_CREATED,
      updated: AUDIT_ACTIONS.DEPARTMENT_UPDATED,
      archived: AUDIT_ACTIONS.DEPARTMENT_ARCHIVED,
      restored: AUDIT_ACTIONS.DEPARTMENT_RESTORED,
      rolledBack: AUDIT_ACTIONS.ORGANIZATION_DEPARTMENT_ROLLED_BACK,
    },
  },
  office: {
    entity: "OFFICE",
    name: "office",
    path: "offices",
    label: "Office",
    model: "office",
    audit: {
      created: AUDIT_ACTIONS.OFFICE_CREATED,
      updated: AUDIT_ACTIONS.OFFICE_UPDATED,
      archived: AUDIT_ACTIONS.OFFICE_ARCHIVED,
      restored: AUDIT_ACTIONS.OFFICE_RESTORED,
      rolledBack: AUDIT_ACTIONS.ORGANIZATION_OFFICE_ROLLED_BACK,
    },
  },
  program: {
    entity: "PROGRAM",
    name: "program",
    path: "programs",
    label: "Program",
    model: "program",
    audit: {
      created: AUDIT_ACTIONS.PROGRAM_CREATED,
      updated: AUDIT_ACTIONS.PROGRAM_UPDATED,
      archived: AUDIT_ACTIONS.PROGRAM_ARCHIVED,
      restored: AUDIT_ACTIONS.PROGRAM_RESTORED,
      rolledBack: AUDIT_ACTIONS.ORGANIZATION_PROGRAM_ROLLED_BACK,
    },
  },
};

export const ORG_ENTITY_LIST = Object.values(ORG_ENTITIES) as OrgEntityConfig[];

// -----------------------------------------------------------------------------
// Row shape returned to the API. Every entity normalizes onto this shared
// shape; fields the entity does not own are null.
// -----------------------------------------------------------------------------
export interface OrganizationRecordRow {
  id: string;
  name: string;
  code: string;
  description: string | null;
  displayOrder: number;
  campusId: string | null;
  campusName: string | null;
  collegeId: string | null;
  collegeName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  headId: string | null;
  headName: string | null;
  level: ProgramLevel | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

// Snapshot payload for a version (the record's editable fields).
export interface OrgSnapshotData {
  name: string;
  code: string;
  description: string | null;
  displayOrder: number;
  campusId: string | null;
  collegeId: string | null;
  departmentId: string | null;
  headId: string | null;
  level: ProgramLevel | null;
}

export interface OrganizationVersionRow {
  id: string;
  entity: OrganizationEntity;
  entityId: string;
  version: number;
  changeType: OrganizationChangeType;
  data: OrgSnapshotData;
  changedById: string | null;
  changedByName: string | null;
  createdAt: Date;
}

export interface ListResult {
  items: OrganizationRecordRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

// Tree node shapes.
export interface OrgTreeNode {
  id: string;
  name: string;
  code: string;
  description: string | null;
  level: ProgramLevel | null;
  colleges: OrgTreeNode[];
  departments: OrgTreeNode[];
  offices: OrgTreeNode[];
  programs: OrgTreeNode[];
}

export interface OrganizationTree {
  campuses: OrgTreeNode[];
  unassigned: OrgTreeNode;
}
