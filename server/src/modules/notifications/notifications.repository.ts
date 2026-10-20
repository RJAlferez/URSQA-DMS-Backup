import { prisma } from "@/lib/prisma";
import type { Prisma, NotificationPriority } from "@prisma/client";

// =============================================================================
// URS-DMS — Notifications repository (Sprint 7.3)
// -----------------------------------------------------------------------------
// Every read/write is scoped by `userId` — the repository IS the ownership
// boundary. No caller can ever see or mutate another user's inbox rows, and
// soft-deleted rows (deletedAt NOT NULL) are invisible to every inbox query.
// =============================================================================

const inboxSelect = {
  id: true,
  type: true,
  title: true,
  message: true,
  priority: true,
  entity: true,
  entityId: true,
  actionUrl: true,
  metadata: true,
  readAt: true,
  createdAt: true,
  deletedAt: true,
} as const satisfies Prisma.NotificationSelect;

export type NotificationRow = Prisma.NotificationGetPayload<{
  select: typeof inboxSelect;
}>;

export async function findActionResult(userId: string, eventId: string): Promise<NotificationRow | null> {
  return prisma.notification.findFirst({
    where: { userId, metadata: { path: ["eventId"], equals: eventId } },
    select: inboxSelect,
  });
}

function inboxWhere(userId: string, extra: Prisma.NotificationWhereInput = {}): Prisma.NotificationWhereInput {
  return { userId, deletedAt: null, ...extra };
}

export async function listByUser(
  userId: string,
  args: {
    page: number;
    pageSize: number;
    unreadOnly?: boolean;
    type?: string;
    sort: "newest" | "oldest";
  },
): Promise<{ items: NotificationRow[]; total: number }> {
  const where = inboxWhere(userId, {
    ...(args.unreadOnly ? { readAt: null } : {}),
    ...(args.type ? { type: args.type as never } : {}),
  });
  const orderBy: Prisma.NotificationOrderByWithRelationInput = {
    createdAt: args.sort === "newest" ? "desc" : "asc",
  };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      select: inboxSelect,
      orderBy,
      skip: (args.page - 1) * args.pageSize,
      take: args.pageSize,
    }),
    prisma.notification.count({ where }),
  ]);
  return { items, total };
}

export async function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({
    where: inboxWhere(userId, { readAt: null }),
  });
}

/** Owned + not deleted. Returns the row or null (also when it belongs to someone else). */
export async function findOwned(userId: string, id: string): Promise<NotificationRow | null> {
  return prisma.notification.findFirst({
    where: { id, userId, deletedAt: null },
    select: inboxSelect,
  });
}

/** Marks ONE unread row read. Idempotent: already-read rows are not re-counted. */
export async function markRead(userId: string, id: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { id, userId, readAt: null, deletedAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null, deletedAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function softDelete(userId: string, id: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { id, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return result.count;
}

export async function createForUser(
  userId: string,
  data: {
    type: string;
    title: string;
    message: string;
    priority: NotificationPriority;
    entity?: string | null;
    entityId?: string | null;
    actionUrl?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<NotificationRow> {
  return prisma.notification.create({
    data: {
      userId,
      type: data.type as never,
      title: data.title,
      message: data.message,
      priority: data.priority,
      entity: data.entity ?? null,
      entityId: data.entityId ?? null,
      actionUrl: data.actionUrl ?? null,
      metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
    select: inboxSelect,
  });
}

export async function createManyForUsers(
  userIds: string[],
  data: {
    type: string;
    title: string;
    message: string;
    priority: NotificationPriority;
    entity?: string | null;
    entityId?: string | null;
    actionUrl?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<number> {
  if (userIds.length === 0) return 0;
  const result = await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: data.type as never,
      title: data.title,
      message: data.message,
      priority: data.priority,
      entity: data.entity ?? null,
      entityId: data.entityId ?? null,
      actionUrl: data.actionUrl ?? null,
      metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });
  return result.count;
}
