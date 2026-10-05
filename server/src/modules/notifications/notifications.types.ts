import type { NotificationPriority, NotificationType } from "@prisma/client";

// =============================================================================
// URS-DMS — Notifications module · shared types (Sprint 7.3)
// =============================================================================

export interface NotificationListItem {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  priority: NotificationPriority;
  entity: string | null;
  entityId: string | null;
  actionUrl: string | null;
  metadata: unknown;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResult {
  items: NotificationListItem[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface UnreadCountResult {
  unread: number;
}

/** Admin surface — system-wide announcement to every ACTIVE user. */
export interface CreateAnnouncementInput {
  title: string;
  message: string;
  priority?: NotificationPriority;
  actionUrl?: string | null;
  metadata?: Record<string, unknown>;
  audience?: {
    campusIds?: string[];
    collegeIds?: string[];
    departmentIds?: string[];
    programIds?: string[];
  };
}

export type NotificationFrequency = "IMMEDIATE" | "DAILY" | "WEEKLY" | "MONTHLY";

export interface NotificationPreferenceView {
  emailEnabled: boolean;
  frequency: NotificationFrequency;
  deadlineHours: number;
  timezone: string;
}

/** Programmatic emit surface for other modules (module-agnostic). */
export interface NotifyInput {
  title?: string;
  message?: string;
  priority?: NotificationPriority;
  entity?: string;
  entityId?: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  /** When set, the recipient also receives an email through the email queue. */
  email?: { subject: string; body: string };
}
