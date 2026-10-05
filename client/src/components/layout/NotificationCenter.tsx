import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Bell, Check, CheckCheck, X } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { cn } from "@/lib/utils"
import { notificationService } from "@/services/notifications"
import { resolveNotificationRoute, buildNotificationUrl } from "@/lib/notificationNav"
import type { Notification } from "@/types/domain"

// Notifications are background convenience data. Polling every three seconds
// consumed the shared API rate-limit budget during normal use and could block
// the refresh/login endpoints after enough activity. Keep this aligned with
// the dashboard polling cadence instead.
const POLL_INTERVAL_MS = 30_000

const typeMeta: Record<string, { label: string; color: string; bg: string }> = {
  approval:     { label: "Approvals",    color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/30" },
  rejection:    { label: "Rejections",   color: "text-red-600",     bg: "bg-red-50 dark:bg-red-900/30" },
  upload:       { label: "Uploads",      color: "text-primary-600",    bg: "bg-primary-50 dark:bg-blue-900/30" },
  document:     { label: "Documents",    color: "text-primary-600",    bg: "bg-primary-50 dark:bg-blue-900/30" },
  submission:   { label: "Submissions",  color: "text-violet-600",  bg: "bg-violet-50 dark:bg-violet-900/30" },
  task:         { label: "Tasks",        color: "text-orange-600",  bg: "bg-orange-50 dark:bg-orange-900/30" },
  request:      { label: "Requests",     color: "text-amber-600",   bg: "bg-amber-50 dark:bg-amber-900/30" },
  system:       { label: "System",       color: "text-gray-600",    bg: "bg-gray-100 dark:bg-gray-800" },
}

function getMeta(notif: Notification) {
  return typeMeta[notif.type] ?? typeMeta.system
}

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<string>("All")
  const navigate = useNavigate()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const loadInFlightRef = useRef<Promise<void> | null>(null)

  const load = useCallback(async () => {
    if (loadInFlightRef.current) return loadInFlightRef.current
    const request = notificationService.listAll()
      .then((n) => {
        setNotifications(n)
        setLoading(false)
      })
      .catch(() => { /* silent */ })
      .finally(() => {
        loadInFlightRef.current = null
      })
    loadInFlightRef.current = request
    return request
  }, [])

  useEffect(() => {
    void load()
    intervalRef.current = setInterval(() => { void load() }, POLL_INTERVAL_MS)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [load])

  const unreadCount = notifications.filter((n) => !n.read).length

  const grouped: Record<string, Notification[]> = {}
  notifications.forEach((n) => {
    const label = getMeta(n).label
    if (!grouped[label]) grouped[label] = []
    grouped[label].push(n)
  })
  const tabs = ["All", ...Object.keys(grouped).filter((k) => grouped[k].length > 0)]

  const displayedNotifications =
    activeTab === "All"
      ? notifications
      : notifications.filter((n) => getMeta(n).label === activeTab)

  const getNotificationsByGroup = (group: string) =>
    notifications.filter((n) => getMeta(n).label === group)

  const markRead = (id: string) => {
    notificationService.markRead(id)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  const markAllRead = () => {
    notificationService.markAllReadForUser()
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  const handleViewNotification = (notif: Notification) => {
    if (!notif.read) markRead(notif.id)
    // Admin bell: submission notifications (e.g. "new submission pending
    // review") must land in the admin portal (/aaccup?tab=submissions…),
    // never the user portal. The actionUrl link wins when present.
    const route = resolveNotificationRoute(notif, "admin")
    if (!route) return
    const url = buildNotificationUrl(route, notif.entityId)
    setIsOpen(false)
    navigate(url)
  }

  const formatTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return "Just now"
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days === 1) return "Yesterday"
    return `${days}d ago`
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="relative w-9 h-9 text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-400"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Bell className="w-[18px] h-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full" />
        )}
      </Button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/5" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-2 w-96 rounded-xl border border-border bg-white shadow-2xl z-[60] dark:border-gray-700 dark:bg-[#111827] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold text-gray-900 dark:text-gray-100">Notifications</h3>
                {unreadCount > 0 && (
                  <Badge variant="high" className="text-[10px]">{unreadCount} new</Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button onClick={markAllRead} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md text-[12px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                  <CheckCheck className="w-3.5 h-3.5" /> Mark all read
                </button>
                <button onClick={() => setIsOpen(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md">
                  <X className="w-4 h-4 text-gray-400" />
                </button>
              </div>
            </div>

            <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-100 dark:border-gray-700 overflow-x-auto">
              {tabs.map((tab) => {
                const count = tab === "All"
                  ? unreadCount
                  : getNotificationsByGroup(tab).filter((n) => !n.read).length
                return (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-[12px] font-medium whitespace-nowrap transition-colors",
                      activeTab === tab
                        ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                    )}
                  >
                    {tab}
                    {count > 0 && (
                      <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/20 text-[10px] text-primary px-1">
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <div className="max-h-96 overflow-y-auto">
              {loading && notifications.length === 0 ? (
                <div className="py-12 text-center text-[13px] text-gray-500">Loading...</div>
              ) : displayedNotifications.length === 0 ? (
                <div className="py-12 text-center">
                  <Bell className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                  <p className="text-[13px] text-gray-500">No notifications</p>
                </div>
              ) : (
                displayedNotifications.map((notif) => {
                  const meta = getMeta(notif)
                  const route = resolveNotificationRoute(notif)
                  return (
                    <div
                      key={notif.id}
                      className={cn(
                        "flex items-start gap-3 px-4 py-3 border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer",
                        !notif.read && "bg-primary/5 dark:bg-primary/10"
                      )}
                      onClick={() => handleViewNotification(notif)}
                    >
                      <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5", meta.bg)}>
                        <Check className={cn("w-4 h-4", meta.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-medium text-gray-900 dark:text-gray-100">{notif.title}</p>
                          {!notif.read && (
                            <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                          )}
                        </div>
                        <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{notif.message}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-[11px] text-gray-400 dark:text-gray-500">{formatTime(notif.createdAt)}</p>
                          {route && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleViewNotification(notif) }}
                              className="text-[11px] text-primary dark:text-blue-400 hover:underline font-medium"
                            >
                              View
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50">
              <button
                onClick={() => { setIsOpen(false); navigate("/notifications") }}
                className="w-full text-center text-[12px] text-primary hover:text-primary font-medium"
              >
                View all notifications
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
