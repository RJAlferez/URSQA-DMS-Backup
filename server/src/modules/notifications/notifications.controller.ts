import type { Request, Response } from "express";
import { sendNoContent, sendSuccess } from "@/utils/apiResponse";
import * as service from "@/modules/notifications/notifications.service";
import type {
  CreateAnnouncementBody,
  ListNotificationsQuery,
  UpdateNotificationPreferenceBody,
} from "@/modules/notifications/notifications.validator";

// =============================================================================
// URS-DMS — Notifications controller (thin)
// =============================================================================
// Controllers stay thin: they build an `Actor` from `req.auth` + `req.context`
// and delegate to the service. No business logic, no Prisma access.
// =============================================================================

function toActor(req: Request): service.Actor {
  return {
    id: req.auth!.userId,
    permissions: req.auth!.permissions,
    ipAddress: req.context.ipAddress,
    userAgent: req.context.userAgent,
  };
}

export async function listNotificationsHandler(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListNotificationsQuery;
  const result = await service.listNotifications(query, toActor(req));
  sendSuccess(res, result.items, 200, result.meta);
}

export async function getUnreadCountHandler(req: Request, res: Response): Promise<void> {
  const result = await service.getUnreadCount(toActor(req));
  sendSuccess(res, result);
}

export async function markReadHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const item = await service.markNotificationRead(id, toActor(req));
  sendSuccess(res, item);
}

export async function markAllReadHandler(req: Request, res: Response): Promise<void> {
  const result = await service.markAllNotificationsRead(toActor(req));
  sendSuccess(res, result);
}

export async function deleteNotificationHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  await service.deleteNotification(id, toActor(req));
  sendNoContent(res);
}

export async function createAnnouncementHandler(req: Request, res: Response): Promise<void> {
  const input = req.body as CreateAnnouncementBody;
  const result = await service.createAnnouncement(input, toActor(req));
  sendSuccess(res, result, 201);
}

export async function getNotificationPreferenceHandler(req: Request, res: Response): Promise<void> {
  const result = await service.getNotificationPreference(toActor(req));
  sendSuccess(res, result);
}

export async function updateNotificationPreferenceHandler(req: Request, res: Response): Promise<void> {
  const input = req.body as UpdateNotificationPreferenceBody;
  const result = await service.updateNotificationPreference(input, toActor(req));
  sendSuccess(res, result);
}

export async function listAnnouncementAudienceOptionsHandler(req: Request, res: Response): Promise<void> {
  const result = await service.listAnnouncementAudienceOptions(toActor(req));
  sendSuccess(res, result);
}
