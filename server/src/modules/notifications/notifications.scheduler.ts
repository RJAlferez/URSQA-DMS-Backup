import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/modules/email/email.service";
import { notifyUser } from "@/modules/notifications/notifications.service";

const TICK_MS = 15 * 60 * 1000;

function digestWindow(frequency: "DAILY" | "WEEKLY" | "MONTHLY"): number {
  if (frequency === "MONTHLY") return 30 * 24 * 60 * 60 * 1000;
  if (frequency === "WEEKLY") return 7 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

export async function runNotificationSchedulePass(): Promise<void> {
  const now = new Date();
  const preferences = await prisma.notificationPreference.findMany({
    where: { emailEnabled: true, frequency: { in: ["DAILY", "WEEKLY", "MONTHLY"] } },
    include: { user: { select: { id: true, email: true, firstName: true } } },
  });

  for (const preference of preferences) {
    if (preference.frequency === "IMMEDIATE") continue;
    const windowMs = digestWindow(preference.frequency);
    const since = preference.lastDigestAt ?? new Date(now.getTime() - windowMs);
    if (now.getTime() - since.getTime() < windowMs) continue;
    const notifications = await prisma.notification.findMany({
      where: { userId: preference.userId, deletedAt: null, createdAt: { gt: since, lte: now } },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { title: true, message: true },
    });
    if (notifications.length > 0) {
      const items = notifications.map((item) => `<li><strong>${item.title}</strong> — ${item.message}</li>`).join("");
      await sendEmail({
        to: preference.user.email,
        subject: `URS-DMS — ${preference.frequency.toLowerCase()} notification digest`,
        body: `<p>Hello ${preference.user.firstName},</p><p>Here are your recent URS-DMS notifications:</p><ul>${items}</ul>`,
      });
    }
    await prisma.notificationPreference.update({ where: { id: preference.id }, data: { lastDigestAt: now } });
  }

  const deadlinePreferences = await prisma.notificationPreference.findMany({
    where: { emailEnabled: true },
    select: { userId: true, emailEnabled: true, deadlineHours: true, user: { select: { email: true } } },
  });
  for (const preference of deadlinePreferences) {
    const from = new Date(now.getTime() + preference.deadlineHours * 60 * 60 * 1000 - TICK_MS);
    const to = new Date(now.getTime() + preference.deadlineHours * 60 * 60 * 1000 + TICK_MS);
    const tasks = await prisma.aaccupTask.findMany({
      where: { assigneeType: "USER", assigneeId: preference.userId, status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null, dueDate: { gte: from, lte: to } },
      select: { id: true, title: true, dueDate: true },
    });
    for (const task of tasks) {
      const alreadySent = await prisma.notification.findFirst({ where: { userId: preference.userId, type: "AACCUP_TASK_DEADLINE", entityId: task.id, createdAt: { gte: new Date(now.getTime() - 26 * 60 * 60 * 1000) } }, select: { id: true } });
      if (alreadySent) continue;
      await notifyUser(preference.userId, "AACCUP_TASK_DEADLINE", { title: "Task deadline approaching", message: `Task "${task.title}" is due ${task.dueDate?.toLocaleString() ?? "soon"}.`, entity: "aaccup_task", entityId: task.id, actionUrl: "/user/aaccup?tab=tasks" });
      await sendEmail({ to: preference.user.email, subject: "URS-DMS — Task deadline approaching", body: `<p>Your task <strong>${task.title}</strong> is due ${task.dueDate?.toLocaleString() ?? "soon"}.</p>` });
    }
  }
}

export function startNotificationScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => void runNotificationSchedulePass().catch(() => undefined), TICK_MS);
  void runNotificationSchedulePass().catch(() => undefined);
  return timer;
}
