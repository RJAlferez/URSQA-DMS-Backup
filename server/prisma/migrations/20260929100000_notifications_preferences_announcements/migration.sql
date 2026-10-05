CREATE TYPE "NotificationFrequency" AS ENUM ('IMMEDIATE', 'DAILY', 'WEEKLY', 'MONTHLY');

CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "frequency" "NotificationFrequency" NOT NULL DEFAULT 'IMMEDIATE',
    "deadlineHours" INTEGER NOT NULL DEFAULT 24,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
    "lastDigestAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notification_preferences_userId_key" UNIQUE ("userId"),
    CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'HIGH',
    "actionUrl" TEXT,
    "metadata" JSONB,
    "audience" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "announcements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "notification_preferences_frequency_idx" ON "notification_preferences"("frequency");
CREATE INDEX "announcements_createdAt_idx" ON "announcements"("createdAt");
CREATE INDEX "announcements_createdById_idx" ON "announcements"("createdById");

ALTER TYPE "NotificationType" ADD VALUE 'AACCUP_TASK_DEADLINE';
