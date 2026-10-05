import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/utils/asyncHandler";
import { authenticate } from "@/middlewares/authenticate";
import { requirePermission } from "@/middlewares/authorize";
import { validateBody, validateParams, validateQuery } from "@/middlewares/validate";
import {
  copyFolderSchema,
  createFolderSchema,
  folderIdParamSchema,
  listFoldersQuerySchema,
  restoreFolderSchema,
  updateFolderSchema,
} from "@/modules/folders/folders.validator";
import {
  createFolderHandler,
  deleteFolderHandler,
  getFolderHandler,
  listFoldersHandler,
  resolveMyFolderStructureHandler,
  updateFolderHandler,
} from "@/modules/folders/folders.controller";
import { folderShareSchema, folderShareUpdateSchema } from "@/modules/folders/folderSharing.validator";
import { listFolderSharesHandler, shareFolderHandler, updateFolderShareHandler, removeFolderShareHandler, listSharedWithMeHandler, listShareableUsersHandler } from "@/modules/folders/folderSharing.controller";
import {
  copyFolderHandler,
  downloadFolderZipHandler,
  getCopyJobHandler,
  getFolderInfoHandler,
  listCopyJobsHandler,
  listDeletedFoldersHandler,
  listPinnedFoldersHandler,
  permanentDeleteFolderHandler,
  pinFolderHandler,
  restoreFolderHandler,
  unpinFolderHandler,
} from "@/modules/folders/folders.controller";

// =============================================================================
// URS-DMS — folders routes
// All routes require authentication. Mutations require the appropriate
// permission. No `if (role === "admin")` anywhere.
// =============================================================================

export const foldersRouter: Router = Router();

foldersRouter.use(authenticate);

foldersRouter.get("/shared-with-me", requirePermission("folders.read"), asyncHandler(listSharedWithMeHandler));
foldersRouter.get("/shareable-users", requirePermission("folders.read"), asyncHandler(listShareableUsersHandler));

// GET /folders/resolve — resolved repository structure for the current user
// (Sprint 7.4.3: Folder Builder template assigned to DEPARTMENT → COLLEGE →
// UNIVERSITY; falls back to legacy folders when nothing is assigned).
// Registered BEFORE /:id so the fixed segment wins the match.
foldersRouter.get(
  "/resolve",
  requirePermission("folders.read"),
  asyncHandler(resolveMyFolderStructureHandler),
);

// GET /folders/deleted — owner's recycle bin (fixed segment before /:id)
foldersRouter.get("/deleted", requirePermission("folders.read"), asyncHandler(listDeletedFoldersHandler));

// GET /folders/pins — quick access list (fixed segment before /:id)
foldersRouter.get("/pins", requirePermission("folders.read"), asyncHandler(listPinnedFoldersHandler));

// GET /folders/jobs — persisted background copy jobs (fixed segment before /:id)
foldersRouter.get("/jobs", requirePermission("folders.read"), asyncHandler(listCopyJobsHandler));

// GET /folders/jobs/:id — copy-job progress (fixed segment before /:id)
foldersRouter.get("/jobs/:id", requirePermission("folders.read"), asyncHandler(getCopyJobHandler));

// GET /folders
foldersRouter.get(
  "/",
  requirePermission("folders.read"),
  validateQuery(listFoldersQuerySchema),
  asyncHandler(listFoldersHandler),
);

// POST /folders
foldersRouter.post(
  "/",
  requirePermission("folders.create"),
  validateBody(createFolderSchema),
  asyncHandler(createFolderHandler),
);

// GET /folders/:id
foldersRouter.get(
  "/:id",
  requirePermission("folders.read"),
  validateParams(folderIdParamSchema),
  asyncHandler(getFolderHandler),
);

foldersRouter.get("/:id/shares", requirePermission("folders.read"), validateParams(folderIdParamSchema), asyncHandler(listFolderSharesHandler));
foldersRouter.post("/:id/shares", requirePermission("folders.update"), validateParams(folderIdParamSchema), validateBody(folderShareSchema), asyncHandler(shareFolderHandler));
foldersRouter.patch("/:id/shares/:shareId", requirePermission("folders.update"), validateParams(z.object({ id: z.string().uuid(), shareId: z.string().uuid() })), validateBody(folderShareUpdateSchema), asyncHandler(updateFolderShareHandler));
foldersRouter.delete("/:id/shares/:shareId", requirePermission("folders.update"), validateParams(z.object({ id: z.string().uuid(), shareId: z.string().uuid() })), asyncHandler(removeFolderShareHandler));

// PATCH /folders/:id
foldersRouter.patch(
  "/:id",
  requirePermission("folders.update"),
  validateParams(folderIdParamSchema),
  validateBody(updateFolderSchema),
  asyncHandler(updateFolderHandler),
);

// DELETE /folders/:id — soft delete (cascades to children)
foldersRouter.delete(
  "/:id",
  requirePermission("folders.delete"),
  validateParams(folderIdParamSchema),
  asyncHandler(deleteFolderHandler),
);

// POST /folders/:id/restore — restore from recycle bin (conflict-aware)
foldersRouter.post(
  "/:id/restore",
  requirePermission("folders.update"),
  validateParams(folderIdParamSchema),
  validateBody(restoreFolderSchema),
  asyncHandler(restoreFolderHandler),
);

// POST /folders/:id/copy — copy subtree (merge/keep_both/cancel; background job for large copies)
foldersRouter.post(
  "/:id/copy",
  requirePermission("folders.create"),
  validateParams(folderIdParamSchema),
  validateBody(copyFolderSchema),
  asyncHandler(copyFolderHandler),
);

// GET /folders/:id/info — recursive counts + size (rule 12)
foldersRouter.get(
  "/:id/info",
  requirePermission("folders.read"),
  validateParams(folderIdParamSchema),
  asyncHandler(getFolderInfoHandler),
);

// GET /folders/:id/zip — streaming ZIP of the active subtree (rule 14)
foldersRouter.get(
  "/:id/zip",
  requirePermission("folders.read"),
  validateParams(folderIdParamSchema),
  asyncHandler(downloadFolderZipHandler),
);

// DELETE /folders/:id/permanent — hard delete the subtree
foldersRouter.delete(
  "/:id/permanent",
  requirePermission("folders.delete"),
  validateParams(folderIdParamSchema),
  asyncHandler(permanentDeleteFolderHandler),
);

// POST /folders/:id/pin — quick access
foldersRouter.post(
  "/:id/pin",
  requirePermission("folders.update"),
  validateParams(folderIdParamSchema),
  asyncHandler(pinFolderHandler),
);

// DELETE /folders/:id/pin — remove from quick access
foldersRouter.delete(
  "/:id/pin",
  requirePermission("folders.update"),
  validateParams(folderIdParamSchema),
  asyncHandler(unpinFolderHandler),
);
