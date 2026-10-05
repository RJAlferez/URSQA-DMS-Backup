import { Router } from "express";
import { authenticate } from "@/middlewares/authenticate";
import { requirePermission, requireRole } from "@/middlewares/authorize";
import { validateQuery } from "@/middlewares/validate";
import {
  listAuditQuerySchema,
  exportAuditQuerySchema,
  archiveAuditQuerySchema,
  purgeAuditQuerySchema,
  retentionConfigSchema,
  myActivityQuerySchema,
  reviewUpdateSchema,
  summaryQuerySchema,
  loginGroupsQuerySchema,
  archiveDownloadParamsSchema,
} from "@/modules/audit/audit.validator";
import * as ctrl from "@/modules/audit/audit.controller";

const router = Router();

// ROOT-only management
router.get("/retention", authenticate, requireRole("ROOT"), ctrl.getRetentionHandler);
router.put("/retention", authenticate, requireRole("ROOT"), validateQuery(retentionConfigSchema), ctrl.setRetentionHandler);
router.get("/archives", authenticate, requireRole("ROOT"), ctrl.listArchivesHandler);
router.post("/archive", authenticate, requireRole("ROOT"), validateQuery(archiveAuditQuerySchema), ctrl.archiveAuditHandler);
router.post("/purge", authenticate, requireRole("ROOT"), validateQuery(purgeAuditQuerySchema), ctrl.purgeAuditHandler);

// Phase 2 — Summary, presets, login groups, review
router.get("/summary", authenticate, requirePermission("audit.read"), validateQuery(summaryQuerySchema), ctrl.getSummaryHandler);
router.get("/presets", authenticate, ctrl.getPresetsHandler);
router.get("/login-groups", authenticate, requirePermission("audit.read"), validateQuery(loginGroupsQuerySchema), ctrl.getLoginGroupsHandler);
router.get("/:id/review", authenticate, requireRole("ROOT"), ctrl.getReviewHandler);
router.put("/:id/review", authenticate, requireRole("ROOT"), validateQuery(reviewUpdateSchema), ctrl.upsertReviewHandler);

// Archive download (ROOT only)
router.get("/archives/:id/download", authenticate, requireRole("ROOT"), validateQuery(archiveDownloadParamsSchema), ctrl.downloadArchiveHandler);

// User-scoped activity
router.get("/my-activity", authenticate, validateQuery(myActivityQuerySchema), ctrl.myActivityHandler);

// Export (before :id)
router.get("/export", authenticate, requirePermission("audit.export"), validateQuery(exportAuditQuerySchema), ctrl.exportAuditHandler);

// List
router.get("/", authenticate, requirePermission("audit.read"), validateQuery(listAuditQuerySchema), ctrl.listAuditHandler);

// Detail
router.get("/:id", authenticate, requirePermission("audit.read"), ctrl.getAuditHandler);

// Clear — destructive, ROOT-only. Wiping the entire audit trail must not be
// reachable with the read/export permission an ADMINISTRATOR holds; the
// ROOT-gated /audit/purge path is the sanctioned archive-then-delete flow.
router.delete("/", authenticate, requireRole("ROOT"), ctrl.clearAuditHandler);

export { router as auditRouter };
export default router;
