import { Router } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import { authenticate } from "@/middlewares/authenticate";
import { requirePermission } from "@/middlewares/authorize";
import { validateBody, validateParams, validateQuery } from "@/middlewares/validate";
import {
  createAnnouncementSchema,
  listNotificationsQuerySchema,
  notificationIdParamSchema,
  updateNotificationPreferenceSchema,
} from "@/modules/notifications/notifications.validator";
import {
  createAnnouncementHandler,
  deleteNotificationHandler,
  getUnreadCountHandler,
  listNotificationsHandler,
  markAllReadHandler,
  markReadHandler,
  getNotificationPreferenceHandler,
  updateNotificationPreferenceHandler,
  listAnnouncementAudienceOptionsHandler,
} from "@/modules/notifications/notifications.controller";

// =============================================================================
// URS-DMS — Notifications routes (Sprint 7.3)
// -----------------------------------------------------------------------------
// Mounted under /api/v1/notifications. Authentication is mounted ONCE here
// (this router is a top-level surface, not nested under admin). The user
// surface is scoped to the authenticated user's own inbox and gated by
// `notification.read` (bound to every role in DEFAULT_ROLE_MATRIX); the admin
// announcement surface is gated by `notification.manage` (ADMINISTRATOR-only
// via the catalog auto-inherit).
//
//   GET    /                     → notification.read — own inbox (paginated)
//   GET    /unread-count         → notification.read — bell-badge count
//   PATCH  /:id/read             → notification.read — mark one read
//   PATCH  /read-all             → notification.read — mark all read
//   DELETE /:id                  → notification.read — delete one (soft)
//   POST   /announcements        → notification.manage — system-wide fan-out
// =============================================================================

export const notificationsRouter: Router = Router();

notificationsRouter.use(authenticate);

notificationsRouter.get(
  "/",
  requirePermission("notification.read"),
  validateQuery(listNotificationsQuerySchema),
  asyncHandler(listNotificationsHandler),
);

notificationsRouter.get(
  "/unread-count",
  requirePermission("notification.read"),
  asyncHandler(getUnreadCountHandler),
);

notificationsRouter.get(
  "/preferences",
  requirePermission("notification.read"),
  asyncHandler(getNotificationPreferenceHandler),
);

notificationsRouter.patch(
  "/preferences",
  requirePermission("notification.read"),
  validateBody(updateNotificationPreferenceSchema),
  asyncHandler(updateNotificationPreferenceHandler),
);

notificationsRouter.patch(
  "/:id/read",
  requirePermission("notification.read"),
  validateParams(notificationIdParamSchema),
  asyncHandler(markReadHandler),
);

notificationsRouter.patch(
  "/read-all",
  requirePermission("notification.read"),
  asyncHandler(markAllReadHandler),
);

notificationsRouter.delete(
  "/:id",
  requirePermission("notification.read"),
  validateParams(notificationIdParamSchema),
  asyncHandler(deleteNotificationHandler),
);

notificationsRouter.post(
  "/announcements",
  requirePermission("notification.manage"),
  validateBody(createAnnouncementSchema),
  asyncHandler(createAnnouncementHandler),
);

notificationsRouter.get(
  "/announcement-audience-options",
  requirePermission("notification.manage"),
  asyncHandler(listAnnouncementAudienceOptionsHandler),
);
