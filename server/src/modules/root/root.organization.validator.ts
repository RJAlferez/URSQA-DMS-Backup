import { z } from "zod";

// =============================================================================
// URS-DMS â€” Root Â· Organization Management Engine validators (Sprint 7.4.2)
// -----------------------------------------------------------------------------
// Per-entity create/update schemas (colleges/departments share the Sprint 7.1
// rows; offices add parent/head links; programs add `level`). Query params
// mirror the admin surfaces (page/pageSize/q/includeArchived) plus optional
// parent filters. Body schemas are `.strict()` so unknown fields are rejected.
// =============================================================================

const nameSchema = z.string().trim().min(1).max(120);
const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Code must be alphanumeric with dots/underscores/hyphens");
const descriptionSchema = z.string().trim().max(500).nullable().optional();
const displayOrderSchema = z.number().int().min(0).max(9999).optional();
const optionalIdSchema = z.string().uuid().nullable().optional();

export const programLevelSchema = z.enum([
  "UNDERGRADUATE",
  "GRADUATE",
  "DOCTORAL",
  "CERTIFICATE",
  "DIPLOMA",
]);

export const orgIdParamSchema = z.object({ id: z.string().uuid() });
export type OrgIdParam = z.infer<typeof orgIdParamSchema>;

export const listOrganizationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(200).optional(),
  includeArchived: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  campusId: z.string().uuid().optional(),
  collegeId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});
export type ListOrganizationQuery = z.infer<typeof listOrganizationQuerySchema>;

// -----------------------------------------------------------------------------
// Create bodies
// -----------------------------------------------------------------------------
export const createCampusSchema = z
  .object({
    name: nameSchema,
    code: codeSchema,
    description: descriptionSchema,
    displayOrder: displayOrderSchema,
  })
  .strict();
export type CreateCampusBody = z.infer<typeof createCampusSchema>;

export const createCollegeSchema = z
  .object({
    name: nameSchema,
    code: codeSchema,
    description: descriptionSchema,
    displayOrder: displayOrderSchema,
    campusId: optionalIdSchema,
  })
  .strict();
export type CreateCollegeBody = z.infer<typeof createCollegeSchema>;

export const createDepartmentSchema = z
  .object({
    name: nameSchema,
    code: codeSchema,
    description: descriptionSchema,
    displayOrder: displayOrderSchema,
    campusId: optionalIdSchema,
    collegeId: optionalIdSchema,
  })
  .strict();
export type CreateDepartmentBody = z.infer<typeof createDepartmentSchema>;

export const createOfficeSchema = z
  .object({
    name: nameSchema,
    code: codeSchema,
    description: descriptionSchema,
    displayOrder: displayOrderSchema,
    campusId: optionalIdSchema,
    collegeId: optionalIdSchema,
    departmentId: optionalIdSchema,
    headId: optionalIdSchema,
  })
  .strict();
export type CreateOfficeBody = z.infer<typeof createOfficeSchema>;

export const createProgramSchema = z
  .object({
    name: nameSchema,
    code: codeSchema,
    description: descriptionSchema,
    displayOrder: displayOrderSchema,
    level: programLevelSchema.optional(),
    campusId: optionalIdSchema,
    collegeId: optionalIdSchema,
    departmentId: optionalIdSchema,
  })
  .strict();
export type CreateProgramBody = z.infer<typeof createProgramSchema>;

// -----------------------------------------------------------------------------
// Update bodies (every field optional; only provided fields are applied)
// -----------------------------------------------------------------------------
export const updateCampusSchema = z
  .object({
    name: nameSchema.optional(),
    code: codeSchema.optional(),
    description: descriptionSchema,
    displayOrder: displayOrderSchema,
  })
  .strict();
export type UpdateCampusBody = z.infer<typeof updateCampusSchema>;

export const updateCollegeSchema = z
  .object({
    name: nameSchema.optional(),
    code: codeSchema.optional(),
    description: descriptionSchema,
    displayOrder: displayOrderSchema,
    campusId: optionalIdSchema,
  })
  .strict();
export type UpdateCollegeBody = z.infer<typeof updateCollegeSchema>;

export const updateDepartmentSchema = z
  .object({
    name: nameSchema.optional(),
    code: codeSchema.optional(),
    description: descriptionSchema,
    displayOrder: displayOrderSchema,
    campusId: optionalIdSchema,
    collegeId: optionalIdSchema,
  })
  .strict();
export type UpdateDepartmentBody = z.infer<typeof updateDepartmentSchema>;

export const updateOfficeSchema = z
  .object({
    name: nameSchema.optional(),
    code: codeSchema.optional(),
    description: descriptionSchema,
    displayOrder: displayOrderSchema,
    campusId: optionalIdSchema,
    collegeId: optionalIdSchema,
    departmentId: optionalIdSchema,
    headId: optionalIdSchema,
  })
  .strict();
export type UpdateOfficeBody = z.infer<typeof updateOfficeSchema>;

export const updateProgramSchema = z
  .object({
    name: nameSchema.optional(),
    code: codeSchema.optional(),
    description: descriptionSchema,
    displayOrder: displayOrderSchema,
    level: programLevelSchema.optional(),
    campusId: optionalIdSchema,
    collegeId: optionalIdSchema,
    departmentId: optionalIdSchema,
  })
  .strict();
export type UpdateProgramBody = z.infer<typeof updateProgramSchema>;

export const rollbackOrganizationSchema = z
  .object({
    version: z.number().int().min(1),
  })
  .strict();
export type RollbackOrganizationBody = z.infer<typeof rollbackOrganizationSchema>;
