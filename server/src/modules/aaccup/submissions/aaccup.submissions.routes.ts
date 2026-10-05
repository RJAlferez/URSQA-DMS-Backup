import { Router } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import { requirePermission, requireRole } from "@/middlewares/authorize";
import { validateBody, validateParams, validateQuery } from "@/middlewares/validate";
import {
  submissionIdParamSchema,
  createSubmissionSchema,
  exportSubmissionsQuerySchema,
  listSubmissionsQuerySchema,
  updateSubmissionSchema,
  reviewSubmissionSchema,
  unsubmitSubmissionSchema,
} from "@/modules/aaccup/submissions/aaccup.submissions.validator";
import {
  archiveSubmissionHandler,
  createSubmissionHandler,
  exportSubmissionsZipHandler,
  getSubmissionHandler,
  listSubmissionsHandler,
  restoreSubmissionHandler,
  reviewSubmissionHandler,
  unsubmitSubmissionHandler,
  updateSubmissionHandler,
} from "@/modules/aaccup/submissions/aaccup.submissions.controller";

// =============================================================================
// URS-DMS — AACCUP submission routes
// Mounted under /aaccup in aaccup.routes.ts. The parent authenticates, so
// submission routes need only gate via the granular aaccup.submission.* codes.
// Note: the sprint spec lists read / create / review / update / archive — the
// restore endpoint reuses the archive permission. The approved-package ZIP
// export is the single hard-role exception: it requires ROOT or ADMINISTRATOR
// (requireRole), so QAO can review but never package approved submissions.
// =============================================================================

export const aaccupSubmissionsRouter: Router = Router();

// GET /aaccup/submissions
aaccupSubmissionsRouter.get(
  "/",
  requirePermission("aaccup.submission.read"),
  validateQuery(listSubmissionsQuerySchema),
  asyncHandler(listSubmissionsHandler),
);

// POST /aaccup/submissions
aaccupSubmissionsRouter.post(
  "/",
  requirePermission("aaccup.submission.create"),
  validateBody(createSubmissionSchema),
  asyncHandler(createSubmissionHandler),
);

// GET /aaccup/submissions/export — approved-package ZIP (ROOT / ADMINISTRATOR
// only). Registered before /:id so the literal segment is never captured as a
// UUID parameter.
aaccupSubmissionsRouter.get(
  "/export",
  requireRole("ROOT", "ADMINISTRATOR"),
  validateQuery(exportSubmissionsQuerySchema),
  asyncHandler(exportSubmissionsZipHandler),
);

// GET /aaccup/submissions/:id
aaccupSubmissionsRouter.get(
  "/:id",
  requirePermission("aaccup.submission.read"),
  validateParams(submissionIdParamSchema),
  asyncHandler(getSubmissionHandler),
);

// PATCH /aaccup/submissions/:id
aaccupSubmissionsRouter.patch(
  "/:id",
  requirePermission("aaccup.submission.update"),
  validateParams(submissionIdParamSchema),
  validateBody(updateSubmissionSchema),
  asyncHandler(updateSubmissionHandler),
);

// POST /aaccup/submissions/:id/review
aaccupSubmissionsRouter.post(
  "/:id/review",
  requirePermission("aaccup.submission.review"),
  validateParams(submissionIdParamSchema),
  validateBody(reviewSubmissionSchema),
  asyncHandler(reviewSubmissionHandler),
);

// POST /aaccup/submissions/:id/unsubmit — submitter may withdraw any active
// submission, including one already approved; the historical row is retained.
aaccupSubmissionsRouter.post(
  "/:id/unsubmit",
  requirePermission("aaccup.submission.update"),
  validateParams(submissionIdParamSchema),
  validateBody(unsubmitSubmissionSchema),
  asyncHandler(unsubmitSubmissionHandler),
);

// DELETE /aaccup/submissions/:id  (soft delete = archive)
aaccupSubmissionsRouter.delete(
  "/:id",
  requirePermission("aaccup.submission.archive"),
  validateParams(submissionIdParamSchema),
  asyncHandler(archiveSubmissionHandler),
);

// POST /aaccup/submissions/:id/restore
aaccupSubmissionsRouter.post(
  "/:id/restore",
  requirePermission("aaccup.submission.archive"),
  validateParams(submissionIdParamSchema),
  asyncHandler(restoreSubmissionHandler),
);
