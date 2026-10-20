import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/modules/email/email.service";
import { escapeNotificationHtml, notifyUser } from "@/modules/notifications/notifications.service";

const TICK_MS = 15 * 60 * 1000;

function digestWindow(frequency: "DAILY" | "WEEKLY" | "MONTHLY"): number {
  if (frequency === "MONTHLY") return 30 * 24 * 60 * 60 * 1000;
  if (frequency === "WEEKLY") return 7 * 24 * 60 * 60 * 1000;
  return 24 * 60 * 60 * 1000;
}

function formatDeadline(date: Date, timezone: string): string {
  try {
    return date.toLocaleString("en-PH", { timeZone: timezone });
  } catch {
    return date.toLocaleString("en-PH", { timeZone: "Asia/Manila" });
  }
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
      const items = notifications.map((item) => `<li><strong>${escapeNotificationHtml(item.title)}</strong> — ${escapeNotificationHtml(item.message)}</li>`).join("");
      await sendEmail({
        to: preference.user.email,
        subject: `URS-QA DMS — ${preference.frequency.toLowerCase()} notification digest`,
        body: `<p>Hello ${escapeNotificationHtml(preference.user.firstName)},</p><p>Here are your recent URS-QA DMS notifications:</p><ul>${items}</ul>`,
      });
    }
    await prisma.notificationPreference.update({ where: { id: preference.id }, data: { lastDigestAt: now } });
  }

  // Missing preference rows use the same defaults as the settings API. In-app
  // reminders must also work when email is disabled or the app missed a tick.
  const recipients = await prisma.user.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, departmentId: true, notificationPreference: { select: { deadlineHours: true, emailEnabled: true, timezone: true } } },
  });
  for (const recipient of recipients) {
    const preference = recipient.notificationPreference;
    const to = new Date(now.getTime() + (preference?.deadlineHours ?? 24) * 60 * 60 * 1000);
    const tasks = await prisma.aaccupTask.findMany({
      where: {
        OR: [
          { assigneeType: "USER", assigneeId: recipient.id },
          ...(recipient.departmentId ? [{ assigneeType: "DEPARTMENT" as const, assigneeId: recipient.departmentId }] : []),
        ],
        status: { in: ["OPEN", "IN_PROGRESS"] }, deletedAt: null,
        area: { deletedAt: null },
        submissions: { none: { submittedBy: recipient.id, deletedAt: null, isCurrent: true, status: { in: ["PENDING", "APPROVED"] } } },
      },
      select: { id: true, title: true, dueDate: true, createdAt: true, area: { select: { name: true } } },
    });
    for (const task of tasks) {
      const due = task.dueDate ? formatDeadline(task.dueDate, preference?.timezone ?? "Asia/Manila") : null;
      // Recover missed assignment alerts, including users who joined an assigned
      // department later. Keep read/deleted alerts as history; never recreate them.
      // Give the task-creation fan-out time to finish before attempting recovery.
      if (task.createdAt.getTime() <= now.getTime() - 60_000) {
        const assigned = await prisma.notification.findFirst({
          where: { userId: recipient.id, type: "AACCUP_TASK_ASSIGNED", entityId: task.id }, select: { id: true },
        });
        if (!assigned) {
          await notifyUser(recipient.id, "AACCUP_TASK_ASSIGNED", {
            title: "Task assigned",
            message: `You have a pending task: "${task.title}" (${task.area.name}).${due ? ` Due ${due}.` : " No deadline is set."}`,
            entity: "aaccup_task", entityId: task.id, actionUrl: `/user/aaccup?tab=tasks&highlight=${task.id}`,
            forceEmail: preference?.emailEnabled !== false,
          });
        }
      }
      if (!task.dueDate || task.dueDate > to) continue;
      const alreadySent = await prisma.notification.findFirst({ where: { userId: recipient.id, type: "AACCUP_TASK_DEADLINE", entityId: task.id, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } }, select: { id: true } });
      if (alreadySent) continue;
      const overdue = Boolean(task.dueDate && task.dueDate <= now);
      await notifyUser(recipient.id, "AACCUP_TASK_DEADLINE", {
        title: overdue ? "Task overdue" : "Task deadline approaching",
        message: `Task "${task.title}" (${task.area.name}) ${overdue ? "was due" : "is due"} ${due}. Please submit your work.`,
        priority: overdue ? "HIGH" : "MEDIUM",
        entity: "aaccup_task", entityId: task.id, actionUrl: `/user/aaccup?tab=tasks&highlight=${task.id}`,
        forceEmail: preference?.emailEnabled !== false,
        metadata: { dueDate: task.dueDate.toISOString(), overdue },
      });
    }
  }
}

export function startNotificationScheduler(): NodeJS.Timeout {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void runNotificationSchedulePass().catch(() => undefined).finally(() => { running = false; });
  };
  const timer = setInterval(run, TICK_MS);
  run();
  return timer;
}
