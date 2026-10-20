import type { Notification, NotificationType } from "@/types/domain"
import { apiDelete, apiGet, apiGetPage, apiPatch, apiPost, getAccessToken } from "@/lib/http"

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
  if (t.includes("failed")) return "rejection"
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

// Used only to discard responses from an account/session that has changed.
// Server authentication and authorization remain authoritative.
function notificationSession(): string | null {
  const token = getAccessToken()
  if (!token) return null
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { sub: string; sessionId: string }
    return `${payload.sub}:${payload.sessionId}`
  } catch { return token }
}

class NotificationService {
  private listListeners: Set<Listener> = new Set()
  private unreadListeners: Set<UnreadCountListener> = new Set()
  private poll: ReturnType<typeof setInterval> | null = null
  private listRequest: Promise<Notification[]> | null = null
  private unreadRequest: Promise<void> | null = null
  private listSession: string | null = null
  private unreadSession: string | null = null

  private updatePolling() {
    if (this.listListeners.size || this.unreadListeners.size) {
      if (this.poll) return
      this.poll = setInterval(this.notify, 30_000)
      window.addEventListener("focus", this.notify)
      window.addEventListener("online", this.notify)
      window.addEventListener("urs:notifications-updated", this.notify)
    } else if (this.poll) {
      clearInterval(this.poll)
      this.poll = null
      window.removeEventListener("focus", this.notify)
      window.removeEventListener("online", this.notify)
      window.removeEventListener("urs:notifications-updated", this.notify)
    }
  }

  subscribe(fn: Listener): () => void {
    this.listListeners.add(fn)
    this.updatePolling()
    void this.refresh()
    return () => { this.listListeners.delete(fn); this.updatePolling() }
  }

  subscribeUnread(fn: UnreadCountListener): () => void {
    this.unreadListeners.add(fn)
    this.updatePolling()
    void this.refreshUnread()
    return () => { this.unreadListeners.delete(fn); this.updatePolling() }
  }

  private notify = () => {
    // A mutation may finish while an older poll is in flight. Refresh after it
    // settles so its pre-action response cannot leave a stale badge behind.
    void Promise.allSettled([this.listRequest, this.unreadRequest]).then(() => {
      if (this.listListeners.size) void this.refresh()
      if (this.unreadListeners.size) void this.refreshUnread()
    })
  }

  async refresh() {
    try {
      const session = notificationSession()
      const sorted = await this.listForUser()
      if (session !== notificationSession()) return
      this.listListeners.forEach((l) => l(sorted))
    } catch {
      // Keep the last confirmed inbox during a temporary connection failure.
    }
  }

  async refreshUnread() {
    const session = notificationSession()
    if (this.unreadRequest && this.unreadSession === session) return this.unreadRequest
    this.unreadSession = session
    const request = apiGet<{ unread: number }>("/notifications/unread-count")
      .then((data) => {
        if (session === notificationSession()) this.unreadListeners.forEach((l) => l(data.unread))
      })
      .catch(() => { /* Preserve the last confirmed count on a network failure. */ })
      .finally(() => { if (this.unreadRequest === request) this.unreadRequest = null })
    this.unreadRequest = request
    return request
  }

  async listForUser(): Promise<Notification[]> {
    const session = notificationSession()
    if (this.listRequest && this.listSession === session) return this.listRequest
    this.listSession = session
    const request = (async () => {
      const items: ServerNotification[] = []
      let page = 1
      let totalPages: number
      do {
        const result = await apiGetPage<ServerNotification>(`/notifications?page=${page}&pageSize=100`)
        if (session !== notificationSession()) return []
        items.push(...result.items)
        totalPages = result.meta.totalPages
        page++
      } while (page <= totalPages)
      return [...new Map(items.map((item) => [item.id, toClientNotification(item)])).values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    })().finally(() => { if (this.listRequest === request) this.listRequest = null })
    this.listRequest = request
    return request
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
    await apiPatch<ServerNotification>(`/notifications/${encodeURIComponent(id)}/read`)
    this.notify()
  }

  async markAllReadForUser(): Promise<void> {
    await apiPatch<{ updated: number }>("/notifications/read-all")
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
