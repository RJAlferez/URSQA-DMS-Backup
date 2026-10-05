import type { Notification, NotificationType } from "@/types/domain"
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost } from "@/lib/http"

export interface ServerNotification {
  id: string
  type: string
  title: string
  message: string
  priority: string
  entity: string | null
  entityId: string | null
  actionUrl: string | null
  metadata: unknown
  isRead: boolean
  readAt: string | null
  createdAt: string
}

export type NotificationFrequency = "IMMEDIATE" | "DAILY" | "WEEKLY" | "MONTHLY"

export interface NotificationPreference {
  emailEnabled: boolean
  frequency: NotificationFrequency
  deadlineHours: number
  timezone: string
}

export interface AnnouncementAudienceOptions {
  campuses: Array<{ id: string; name: string }>
  colleges: Array<{ id: string; name: string }>
  departments: Array<{ id: string; name: string }>
  programs: Array<{ id: string; name: string }>
}

export async function getNotificationPreferences(): Promise<NotificationPreference> {
  return apiGet<NotificationPreference>("/notifications/preferences")
}

export async function updateNotificationPreferences(input: Partial<NotificationPreference>): Promise<NotificationPreference> {
  return apiPatch<NotificationPreference>("/notifications/preferences", input)
}

export async function getAnnouncementAudienceOptions(): Promise<AnnouncementAudienceOptions> {
  return apiGet<AnnouncementAudienceOptions>("/notifications/announcement-audience-options")
}

export async function createAnnouncement(input: {
  title: string
  message: string
  priority?: "LOW" | "MEDIUM" | "HIGH"
  actionUrl?: string | null
  audience?: { campusIds?: string[]; collegeIds?: string[]; departmentIds?: string[]; programIds?: string[] }
  metadata?: Record<string, unknown>
}): Promise<{ created: number; announcementId: string }> {
  return apiPost<{ created: number; announcementId: string }>("/notifications/announcements", input)
}

function toClientNotification(n: ServerNotification): Notification {
  return {
    id: n.id,
    userId: "",
    type: mapServerType(n.type),
    title: n.title,
    message: n.message,
    read: n.isRead,
    link: n.actionUrl ?? undefined,
    entity: n.entity ?? undefined,
    entityId: n.entityId ?? undefined,
    metadata: (n.metadata as Record<string, unknown>) ?? undefined,
    createdAt: n.createdAt,
  }
}

function mapServerType(serverType: string): NotificationType {
  const t = serverType.toLowerCase()
  if (t.includes("upload")) return "upload"
  if (t.includes("approved")) return "approval"
  if (t.includes("rejected")) return "rejection"
  if (t.includes("returned")) return "rejection"
  if (t.includes("request")) return "request"
  if (t.includes("submission")) return "submission"
  if (t.includes("task")) return "task"
  if (t.includes("document")) return "document"
  return "system"
}

type Listener = (notifications: Notification[]) => void
type UnreadCountListener = (count: number) => void

class NotificationService {
  private listListeners: Set<Listener> = new Set()
  private unreadListeners: Set<UnreadCountListener> = new Set()

  subscribe(fn: Listener): () => void {
    this.listListeners.add(fn)
    this.refresh()
    return () => this.listListeners.delete(fn)
  }

  subscribeUnread(fn: UnreadCountListener): () => void {
    this.unreadListeners.add(fn)
    this.refreshUnread()
    return () => this.unreadListeners.delete(fn)
  }

  private notify() {
    this.refresh()
    this.refreshUnread()
  }

  async refresh() {
    try {
      const page = await apiGetPage<ServerNotification>("/notifications?page=1&pageSize=50")
      const sorted = page.items.map(toClientNotification).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      this.listListeners.forEach((l) => l(sorted))
    } catch {
      this.listListeners.forEach((l) => l([]))
    }
  }

  async refreshUnread() {
    try {
      const data = await apiGet<{ unread: number }>("/notifications/unread-count")
      this.unreadListeners.forEach((l) => l(data.unread))
    } catch {
      this.unreadListeners.forEach((l) => l(0))
    }
  }

  async listForUser(): Promise<Notification[]> {
    try {
      const page = await apiGetPage<ServerNotification>("/notifications?page=1&pageSize=50")
      return page.items.map(toClientNotification).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    } catch {
      return []
    }
  }

  async listAll(): Promise<Notification[]> {
    return this.listForUser()
  }

  async unreadCountForUser(): Promise<number> {
    try {
      const data = await apiGet<{ unread: number }>("/notifications/unread-count")
      return data.unread
    } catch {
      return 0
    }
  }

  async markRead(id: string): Promise<void> {
    try {
      await apiPatch<ServerNotification>(`/notifications/${id}/read`)
    } catch {
      // Ignore races; the server remains the source of truth.
    }
    this.notify()
  }

  async markAllReadForUser(): Promise<void> {
    try {
      await apiPatch<{ success: true }>("/notifications/read-all")
    } catch {
      // Ignore; unread state is refreshed from the server below.
    }
    this.notify()
  }

  async create(): Promise<Notification> {
    throw new Error("Notifications are created server-side only")
  }

  async createBulk(): Promise<void> {
    throw new Error("Notifications are created server-side only")
  }

  async delete(id: string): Promise<void> {
    try {
      await apiDelete<{ success: true }>(`/notifications/${id}`)
    } catch {
      // Ignore; state refreshes from the server below.
    }
    this.notify()
  }
}

export const notificationService = new NotificationService()
