import type { NotificationType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, NotFoundError } from "@/utils/errors";
import { sendEmail } from "@/modules/email/email.service";
import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import {
  NOTIFICATION_EVENTS,
  type NotificationEventSpec,
} from "@/modules/notifications/notifications.events";
import * as repo from "@/modules/notifications/notifications.repository";
import type { NotificationRow } from "@/modules/notifications/notifications.repository";
import type {
  CreateAnnouncementInput,
  NotificationListItem,
  NotifyInput,
  NotificationPreferenceView,
  UnreadCountResult,
} from "@/modules/notifications/notifications.types";
import type { ListNotificationsQuery, UpdateNotificationPreferenceBody } from "@/modules/notifications/notifications.validator";

// =============================================================================
// URS-DMS — Notifications service (Sprint 7.3)
// -----------------------------------------------------------------------------
// Two surfaces, one module:
//
//   * User surface (actor-scoped, permission `notification.read`) — own-inbox
//     list / unread-count / mark-read / mark-all-read / delete. The repository
//     enforces ownership; the service adds RBAC re-assertion, mapping and
//     audit. Read/deletion of one's own row is a per-user action, so
//     `notification.read` covers the whole surface (no separate "write"
//     permission — the spec's notification.manage is the admin surface).
//
//   * Admin surface (permission `notification.manage`) — createAnnouncement
//     fans out a SYSTEM_ANNOUNCEMENT row to every ACTIVE user.
//
// Programmatic emit surface (notifyUser / notifyUsers): the module-agnostic
// entry point for future event emitters (document / request / aaccup /
// auth flows). Events fill their title/message/priority from the catalog in
// notifications.events.ts when the caller omits them; an optional `email`
// payload additionally routes through the durable email queue. Programmatic
// notifications are NOT audited (they are system-generated, not actor actions
// — announcing them would flood the log; see constants.ts).
// =============================================================================

export interface Actor {
  id: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

function assertPermission(actor: Actor, permission: string): void {
  if (!actor.permissions.includes(permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}

function toListItem(row: NotificationRow): NotificationListItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    priority: row.priority,
    entity: row.entity,
    entityId: row.entityId,
    actionUrl: row.actionUrl,
    metadata: row.metadata,
    isRead: row.readAt !== null,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// -----------------------------------------------------------------------------
// User surface
// -----------------------------------------------------------------------------
export async function listNotifications(
  query: ListNotificationsQuery,
  actor: Actor,
): Promise<{ items: NotificationListItem[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
  assertPermission(actor, "notification.read");
  const { items, total } = await repo.listByUser(actor.id, query);
  return {
    items: items.map(toListItem),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  };
}

export async function getUnreadCount(actor: Actor): Promise<UnreadCountResult> {
  assertPermission(actor, "notification.read");
  return { unread: await repo.countUnread(actor.id) };
}

export async function markNotificationRead(id: string, actor: Actor): Promise<NotificationListItem> {
  assertPermission(actor, "notification.read");
  const row = await repo.findOwned(actor.id, id);
  if (!row) throw new NotFoundError("Notification not found");
  const updated = await repo.markRead(actor.id, id);
  if (updated > 0) {
    void writeAudit({
      action: AUDIT_ACTIONS.NOTIFICATION_MARKED_READ,
      userId: actor.id,
      entity: "notification",
      entityId: id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }
  return toListItem({ ...row, readAt: new Date() });
}

export async function markAllNotificationsRead(
  actor: Actor,
): Promise<{ updated: number }> {
  assertPermission(actor, "notification.read");
  const updated = await repo.markAllRead(actor.id);
  if (updated > 0) {
    void writeAudit({
      action: AUDIT_ACTIONS.NOTIFICATION_MARKED_READ,
      userId: actor.id,
      entity: "notification",
      newValue: { count: updated },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }
  return { updated };
}

export async function deleteNotification(id: string, actor: Actor): Promise<void> {
  assertPermission(actor, "notification.read");
  const row = await repo.findOwned(actor.id, id);
  if (!row) throw new NotFoundError("Notification not found");
  const deleted = await repo.softDelete(actor.id, id);
  if (deleted > 0) {
    void writeAudit({
      action: AUDIT_ACTIONS.NOTIFICATION_DELETED,
      userId: actor.id,
      entity: "notification",
      entityId: id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }
}

// -----------------------------------------------------------------------------
// Admin surface
// -----------------------------------------------------------------------------
export async function createAnnouncement(
  input: CreateAnnouncementInput,
  actor: Actor,
): Promise<{ created: number; announcementId: string }> {
  assertPermission(actor, "notification.manage");
  const audience = input.audience ?? {};
  const hasAudience = Object.values(audience).some((values) => (values?.length ?? 0) > 0);
  const audienceOr: Prisma.UserWhereInput[] = [];
  if (audience.campusIds?.length) {
    audienceOr.push({ program: { campusId: { in: audience.campusIds } } });
    audienceOr.push({ departments: { some: { campusId: { in: audience.campusIds } } } });
  }
  if (audience.collegeIds?.length) {
    audienceOr.push({ program: { collegeId: { in: audience.collegeIds } } });
    audienceOr.push({ departments: { some: { collegeId: { in: audience.collegeIds } } } });
  }
  if (audience.departmentIds?.length) {
    audienceOr.push({ departmentId: { in: audience.departmentIds } });
    audienceOr.push({ departments: { some: { id: { in: audience.departmentIds } } } });
  }
  if (audience.programIds?.length) audienceOr.push({ programId: { in: audience.programIds } });
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      deletedAt: null,
      ...(hasAudience && audienceOr.length > 0 ? { OR: audienceOr } : {}),
    },
    select: { id: true, email: true },
  });
  const announcement = await prisma.announcement.create({
    data: {
      title: input.title,
      message: input.message,
      priority: input.priority ?? "HIGH",
      actionUrl: input.actionUrl ?? null,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      audience: (hasAudience ? audience : undefined) as Prisma.InputJsonValue | undefined,
      createdById: actor.id,
    },
  });
  const created = await repo.createManyForUsers(
    users.map((u) => u.id),
    {
      type: "SYSTEM_ANNOUNCEMENT",
      title: input.title,
      message: input.message,
      priority: input.priority ?? "HIGH",
      actionUrl: input.actionUrl ?? null,
      metadata: input.metadata,
    },
  );
  await queueEmails(
    users.map((user) => user.id),
    `URS-DMS — ${input.title}`,
    `<h2>${input.title}</h2><p>${input.message}</p>${input.actionUrl ? `<p><a href="${input.actionUrl}">Open URS-DMS</a></p>` : ""}`,
  );
  if (created > 0) {
    void writeAudit({
      action: AUDIT_ACTIONS.NOTIFICATION_CREATED,
      userId: actor.id,
      entity: "notification",
      newValue: { type: "SYSTEM_ANNOUNCEMENT", recipients: created, announcementId: announcement.id, audience },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }
  return { created, announcementId: announcement.id };
}

async function queueEmails(userIds: string[], subject: string, body: string): Promise<void> {
  if (userIds.length === 0) return;
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] }, status: "ACTIVE", deletedAt: null },
    select: { email: true, notificationPreference: { select: { emailEnabled: true, frequency: true } } },
  });
  await Promise.allSettled(
    users
      .filter((user) => user.notificationPreference?.emailEnabled !== false && (user.notificationPreference?.frequency ?? "IMMEDIATE") === "IMMEDIATE")
      .map((user) => sendEmail({ to: user.email, subject, body })),
  );
}

export async function getNotificationPreference(actor: Actor): Promise<NotificationPreferenceView> {
  assertPermission(actor, "notification.read");
  const preference = await prisma.notificationPreference.findUnique({ where: { userId: actor.id } });
  return {
    emailEnabled: preference?.emailEnabled ?? true,
    frequency: preference?.frequency ?? "IMMEDIATE",
    deadlineHours: preference?.deadlineHours ?? 24,
    timezone: preference?.timezone ?? "Asia/Manila",
  };
}

export async function updateNotificationPreference(
  input: UpdateNotificationPreferenceBody,
  actor: Actor,
): Promise<NotificationPreferenceView> {
  assertPermission(actor, "notification.read");
  const preference = await prisma.notificationPreference.upsert({
    where: { userId: actor.id },
    create: { userId: actor.id, ...input },
    update: input,
  });
  return {
    emailEnabled: preference.emailEnabled,
    frequency: preference.frequency,
    deadlineHours: preference.deadlineHours,
    timezone: preference.timezone,
  };
}

export async function listAnnouncementAudienceOptions(actor: Actor): Promise<{
  campuses: Array<{ id: string; name: string }>;
  colleges: Array<{ id: string; name: string }>;
  departments: Array<{ id: string; name: string }>;
  programs: Array<{ id: string; name: string }>;
}> {
  assertPermission(actor, "notification.manage");
  const [campuses, colleges, departments, programs] = await Promise.all([
    prisma.campus.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.college.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.program.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { campuses, colleges, departments, programs };
}

// -----------------------------------------------------------------------------
// Programmatic emit surface
// -----------------------------------------------------------------------------
function resolveSpec(type: NotificationType): NotificationEventSpec {
  const spec = NOTIFICATION_EVENTS[type];
  if (!spec) {
    throw new Error(`Unknown notification type: ${type}`);
  }
  return spec;
}

function buildPayload(
  type: NotificationType,
  input: NotifyInput,
): { title: string; message: string; priority: NotificationPriorityLike; email?: { subject: string; body: string } } {
  const spec = resolveSpec(type);
  return {
    title: input.title ?? spec.defaultTitle,
    message: input.message ?? spec.defaultMessage,
    priority: input.priority ?? spec.defaultPriority,
    ...(input.email
      ? { email: input.email }
      : spec.email
        ? { email: spec.email }
        : {}),
  };
}

export async function notifyUser(
  userId: string,
  type: NotificationType,
  input: NotifyInput = {},
): Promise<NotificationListItem | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, notificationPreference: { select: { emailEnabled: true, frequency: true } } },
  });
  if (!user) throw new NotFoundError("Recipient user not found");

  const payload = buildPayload(type, input);
  const row = await repo.createForUser(userId, {
    type,
    title: payload.title,
    message: payload.message,
    priority: payload.priority,
    entity: input.entity,
    entityId: input.entityId,
    actionUrl: input.actionUrl,
    metadata: input.metadata,
  });
  if (payload.email && user.notificationPreference?.emailEnabled !== false && (user.notificationPreference?.frequency ?? "IMMEDIATE") === "IMMEDIATE") {
    await sendEmail({ to: user.email, ...payload.email }).catch(() => undefined);
  }

  return toListItem(row);
}

export async function notifyUsers(
  userIds: string[],
  type: NotificationType,
  input: NotifyInput = {},
): Promise<number> {
  if (userIds.length === 0) return 0;
  const payload = buildPayload(type, input);
  const uniqueIds = [...new Set(userIds)];
  const users = await prisma.user.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, email: true, notificationPreference: { select: { emailEnabled: true, frequency: true } } },
  });
  const foundIds = users.map((u) => u.id);
  const created = await repo.createManyForUsers(foundIds, {
    type,
    title: payload.title,
    message: payload.message,
    priority: payload.priority,
    entity: input.entity,
    entityId: input.entityId,
    actionUrl: input.actionUrl,
    metadata: input.metadata,
  });
  if (payload.email) {
    await Promise.allSettled(
      users
        .filter((user) => user.notificationPreference?.emailEnabled !== false && (user.notificationPreference?.frequency ?? "IMMEDIATE") === "IMMEDIATE")
        .map((user) => sendEmail({ to: user.email, ...payload.email! })),
    );
  }
  return created;
}

type NotificationPriorityLike = "LOW" | "MEDIUM" | "HIGH";
