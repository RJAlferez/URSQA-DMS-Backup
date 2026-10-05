import { z } from "zod";

// =============================================================================
// URS-DMS — AACCUP submission validators
// =============================================================================

const idParam = z.object({ id: z.string().uuid() });

export const submissionIdParamSchema = idParam;

export const listSubmissionsQuerySchema = z.object({
  requirementId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional(),
  areaSet: z.enum(["AACCUP", "ISO", "CERT"]).optional(),
  documentId: z.string().uuid().optional(),
  submittedById: z.string().uuid().optional(),
  reviewedById: z.string().uuid().optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "NEEDS_REVISION", "WITHDRAWN"]).optional(),
  isCurrent: z.enum(["true", "false"]).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(["submittedAt", "createdAt", "updatedAt", "status"])
    .default("submittedAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListSubmissionsQuery = z.infer<typeof listSubmissionsQuerySchema>;

export const createSubmissionSchema = z.object({
  requirementId: z.string().uuid(),
  documentId: z.string().uuid(),
  taskId: z.string().uuid().nullable().optional(),
  remarks: z.string().trim().max(2000).optional(),
});
export type CreateSubmissionInput = z.infer<typeof createSubmissionSchema>;

export const updateSubmissionSchema = z
  .object({
    remarks: z.string().trim().max(2000).optional(),
  })
  .strict();
export type UpdateSubmissionInput = z.infer<typeof updateSubmissionSchema>;

export const reviewSubmissionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "NEEDS_REVISION"]),
  remarks: z.string().trim().max(2000).optional(),
});
export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;

export const unsubmitSubmissionSchema = z.object({
  reason: z.string().trim().max(2000).optional(),
});
export type UnsubmitSubmissionInput = z.infer<typeof unsubmitSubmissionSchema>;

// Admin-only approved-package export. `areaIds` may arrive as a repeated query
// param (?areaIds=a&areaIds=b) or a comma-separated value (?areaIds=a,b); both
// normalize to a non-empty array of UUIDs.
export const exportSubmissionsQuerySchema = z.object({
  areaIds: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : value.split(",")))
    .transform((value) => value.map((item) => item.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1)),
  areaSet: z.enum(["AACCUP", "ISO", "CERT"]).optional(),
});
export type ExportSubmissionsQuery = z.infer<typeof exportSubmissionsQuerySchema>;
