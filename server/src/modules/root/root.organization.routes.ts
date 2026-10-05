import { Router } from "express";
import { requirePermission } from "@/middlewares/authorize";
import { asyncHandler } from "@/utils/asyncHandler";
import { validateBody, validateParams, validateQuery } from "@/middlewares/validate";
import { ORG_ENTITIES } from "@/modules/root/root.organization.types";
import {
  createCampusSchema,
  createCollegeSchema,
  createDepartmentSchema,
  createOfficeSchema,
  createProgramSchema,
  listOrganizationQuerySchema,
  orgIdParamSchema,
  rollbackOrganizationSchema,
  updateCampusSchema,
  updateCollegeSchema,
  updateDepartmentSchema,
  updateOfficeSchema,
  updateProgramSchema,
} from "@/modules/root/root.organization.validator";
import {
  getOrganizationTreeHandler,
  makeArchiveHandler,
  makeCreateHandler,
  makeGetHandler,
  makeListHandler,
  makeListVersionsHandler,
  makeRestoreHandler,
  makeRollbackHandler,
  makeUpdateHandler,
} from "@/modules/root/root.organization.controller";

// =============================================================================
// URS-DMS — Root · Organization Management Engine routes (Sprint 7.4.2)
// -----------------------------------------------------------------------------
// Mounted inside the /root router (which already gates authenticate +
// requireRole("ROOT")), so every endpoint here is Root-only twice over: the
// hard role gate and the ROOT-exclusive organization.* codes. Each entity
// router is mounted BOTH at /root/organization/<collection> (canonical, per
// the sprint spec "API under /root/organization") and at /root/<collection>
// (short alias, e.g. /root/colleges — also spec'd).
//
// Permission map:
//   - organization.read     → list / detail / tree / versions
//   - organization.create   → POST create
//   - organization.update   → PATCH update
//   - organization.archive  → DELETE archive + POST restore
//   - organization.rollback → POST rollback
// Read-only endpoints do NOT write audit entries (project convention,
// AI_CONTEXT §8); mutations audit via the service (COLLEGE_*/DEPARTMENT_*/
// OFFICE_*/PROGRAM_* + rollback actions).
// =============================================================================

export const organizationRouter: Router = Router();

// GET /root/organization/tree — full org hierarchy (colleges → departments →
// offices/programs, plus the Unassigned bucket).
organizationRouter.get(
  "/organization/tree",
  requirePermission("organization.read"),
  asyncHandler(getOrganizationTreeHandler),
);

const ENTITY_ROUTE_DEFS = [
  { cfg: ORG_ENTITIES.campus, createSchema: createCampusSchema, updateSchema: updateCampusSchema },
  { cfg: ORG_ENTITIES.college, createSchema: createCollegeSchema, updateSchema: updateCollegeSchema },
  { cfg: ORG_ENTITIES.department, createSchema: createDepartmentSchema, updateSchema: updateDepartmentSchema },
  { cfg: ORG_ENTITIES.office, createSchema: createOfficeSchema, updateSchema: updateOfficeSchema },
  { cfg: ORG_ENTITIES.program, createSchema: createProgramSchema, updateSchema: updateProgramSchema },
] as const;

for (const { cfg, createSchema, updateSchema } of ENTITY_ROUTE_DEFS) {
  const entityRouter: Router = Router();

  // GET  /:collection            — paginated list (q / includeArchived /
  //                                 collegeId / departmentId filters)
  entityRouter.get(
    "/",
    requirePermission("organization.read"),
    validateQuery(listOrganizationQuerySchema),
    asyncHandler(makeListHandler(cfg)),
  );
  // POST /:collection            — create (version 1 snapshot + audit)
  entityRouter.post(
    "/",
    requirePermission("organization.create"),
    validateBody(createSchema),
    asyncHandler(makeCreateHandler(cfg)),
  );
  // GET  /:collection/:id        — detail (current version number included)
  entityRouter.get(
    "/:id",
    requirePermission("organization.read"),
    validateParams(orgIdParamSchema),
    asyncHandler(makeGetHandler(cfg)),
  );
  // PATCH /:collection/:id       — update (appends a UPDATED snapshot)
  entityRouter.patch(
    "/:id",
    requirePermission("organization.update"),
    validateBody(updateSchema),
    asyncHandler(makeUpdateHandler(cfg)),
  );
  // DELETE /:collection/:id      — archive (soft delete + ARCHIVED snapshot)
  entityRouter.delete(
    "/:id",
    requirePermission("organization.archive"),
    validateParams(orgIdParamSchema),
    asyncHandler(makeArchiveHandler(cfg)),
  );
  // POST /:collection/:id/restore — restore (RESTORED snapshot)
  entityRouter.post(
    "/:id/restore",
    requirePermission("organization.archive"),
    validateParams(orgIdParamSchema),
    asyncHandler(makeRestoreHandler(cfg)),
  );
  // GET /:collection/:id/versions — version snapshots (rollback source data)
  entityRouter.get(
    "/:id/versions",
    requirePermission("organization.read"),
    validateParams(orgIdParamSchema),
    asyncHandler(makeListVersionsHandler(cfg)),
  );
  // POST /:collection/:id/rollback — roll back to an earlier snapshot
  entityRouter.post(
    "/:id/rollback",
    requirePermission("organization.rollback"),
    validateParams(orgIdParamSchema),
    validateBody(rollbackOrganizationSchema),
    asyncHandler(makeRollbackHandler(cfg)),
  );

  organizationRouter.use(`/organization/${cfg.path}`, entityRouter);
  organizationRouter.use(`/${cfg.path}`, entityRouter);
}
