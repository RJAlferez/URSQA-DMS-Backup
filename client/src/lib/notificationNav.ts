import type { Notification } from "@/types/domain"

export interface ResolvedRoute {
  page: string
  tab?: string
  query?: Record<string, string>
  portal: "admin" | "user"
}

export function resolveNotificationRoute(notif: Notification, preferredPortal?: "admin" | "user"): ResolvedRoute | null {
  const entity = notif.entity
  const link = notif.link
  const type = notif.type

  const mapping: Record<string, ResolvedRoute> = {
    aaccup_task: { page: "aaccup", tab: "tasks", portal: "user" },
    aaccup_area: { page: "aaccup", portal: "admin" },
    aaccup_submission: { page: "aaccup", tab: "submissions", portal: "user" },
    request: { page: "requests", portal: "user" },
    document: { page: "documents", portal: "user" },
    folder: { page: "documents", portal: "user" },
    audit_log: { page: "audit", portal: "admin" },
    notification: { page: "notifications", portal: "user" },
    session: { page: "profile", portal: "user" },
    user: { page: "profile", portal: "user" },
  }

  const linkParams = new URLSearchParams(link?.split("?")[1] ?? "")
  const linkRoute: { page: string; portal: "admin" | "user" } | null = link
    ? (() => {
        const path = link.split("?")[0]
        if (path.startsWith("/user/")) return { page: path.replace("/user/", ""), portal: "user" as const }
        return { page: path.replace(/^\//, ""), portal: "admin" as const }
      })()
    : null
  const base = ((entity && mapping[entity]) || (!entity && linkRoute)) as ResolvedRoute | null
  if (base) {
    const query: Record<string, string> = {}
    linkParams.forEach((value, key) => { query[key] = value })
    if (base.tab === "submissions" && !query.status) {
      if (type === "rejection") query.status = "REJECTED"
      if (type === "approval") query.status = "APPROVED"
    }
    return {
      ...base,
      portal: preferredPortal ?? linkRoute?.portal ?? base.portal,
      tab: linkParams.get("tab") ?? base.tab,
      query: Object.keys(query).length > 0 ? query : undefined,
    }
  }

  if (!entity) {
    if (type === "request") return { page: "requests", portal: "user" }
    if (type === "submission") return { page: "aaccup", tab: "submissions", portal: "admin" }
    if (type === "task") return { page: "aaccup", tab: "tasks", portal: "user" }
    if (type === "document" || type === "upload") return { page: "documents", portal: "user" }
    if (type === "approval" || type === "rejection") return { page: "aaccup", tab: "submissions", portal: "admin" }
  }

  if (link) {
    return linkRoute ? { ...linkRoute, tab: linkParams.get("tab") ?? undefined } : null
  }

  return null
}

export function buildNotificationUrl(
  route: ResolvedRoute,
  entityId?: string,
): string {
  const base = route.portal === "user" ? `/user/${route.page}` : `/${route.page}`
  const params = new URLSearchParams()
  Object.entries(route.query ?? {}).forEach(([key, value]) => params.set(key, value))
  if (route.tab) params.set("tab", route.tab)
  if (entityId) params.set("highlight", entityId)
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}
