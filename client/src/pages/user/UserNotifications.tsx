import { useState, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { Bell, Check, CheckCheck, Search, FileText, GraduationCap, Inbox, Upload, AlertTriangle, RotateCcw, type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import { notificationService } from "@/services/notifications"
import { resolveNotificationRoute, buildNotificationUrl } from "@/lib/notificationNav"
import type { Notification } from "@/types/domain"

interface NotificationItem {
  id: string
  type: Notification["type"]
  title: string
  message: string
  read: boolean
  createdAt: string
  entity?: string
  entityId?: string
}

interface NotificationVisual {
  Icon: LucideIcon
  className: string
}

const getNotificationVisual = (notif: NotificationItem): NotificationVisual => {
  const text = `${notif.title} ${notif.message}`.toLowerCase()

  if (notif.type === "rejection" && /(return|revision)/.test(text)) {
    return { Icon: RotateCcw, className: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" }
  }
  if (notif.type === "rejection") {
    return { Icon: AlertTriangle, className: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400" }
  }
  if (notif.type === "approval") {
    return { Icon: Check, className: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400" }
  }
  if (notif.type === "document" || notif.type === "upload" || notif.entity === "folder") {
    return { Icon: notif.type === "upload" ? Upload : FileText, className: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400" }
  }
  if (notif.type === "request") {
    return { Icon: Inbox, className: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400" }
  }
  if (notif.type === "submission") {
    return { Icon: GraduationCap, className: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400" }
  }
  return { Icon: Bell, className: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400" }
}

const getTimeAgo = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)
  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? "s" : ""} ago`
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? "s" : ""} ago`
  return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`
}

export default function UserNotifications() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [notifs, setNotifs] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [activeTab, setActiveTab] = useState("all")

  const refresh = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const data = await notificationService.listForUser()
      setNotifs(data)
    } finally { setLoading(false) }
  }, [user])

  useEffect(() => { refresh() }, [refresh])

  const unreadCount = notifs.filter((n) => !n.read).length

  const filteredNotifs = notifs.filter((notif) => {
    const matchesSearch =
      notif.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      notif.message.toLowerCase().includes(searchQuery.toLowerCase())
    const entity = notif.entity || ""
    const matchesTab =
      activeTab === "all" ||
      (activeTab === "unread" && !notif.read) ||
      (activeTab === "requests" && entity === "request") ||
      (activeTab === "documents" && (entity === "document" || notif.type === "upload")) ||
      (activeTab === "submissions" && entity === "aaccup_submission") ||
      (activeTab === "tasks" && entity === "aaccup_task")
    return matchesSearch && matchesTab
  })

  const markAsRead = async (id: string) => {
    try {
      await notificationService.markRead(id)
      setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))
    } catch {
      // The local list remains unchanged when the server update fails.
    }
  }

  const markAllAsRead = async () => {
    if (!user) return
    try {
      await notificationService.markAllReadForUser()
      setNotifs((prev) => prev.map((n) => ({ ...n, read: true })))
    } catch {
      // The local list remains unchanged when the server update fails.
    }
  }

  const handleViewNotification = (notif: Notification) => {
    if (!notif.read) markAsRead(notif.id)
    // User portal: submission notifications (approval / return / rejection)
    // must land in /user/aaccup?tab=submissions…, never the admin portal.
    const route = resolveNotificationRoute(notif, "user")
    if (!route) return
    const url = buildNotificationUrl(route, notif.entityId)
    navigate(url)
  }

  return (
    <div className="content-padding">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between lg:mb-8">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 dark:text-gray-100 sm:text-[26px]">Notifications</h1>
          <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-300">
            {unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllAsRead} className="h-8 rounded-lg px-3 text-xs">
            <CheckCheck className="mr-1.5 size-3.5" />
            Mark All as Read
          </Button>
        )}
      </div>

      <div className="mb-4 flex items-center gap-1 overflow-x-auto border-b border-slate-200 pb-4 dark:border-slate-800">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="h-auto w-full justify-start gap-1.5 overflow-x-auto rounded-none bg-transparent p-0 dark:bg-transparent">
            <TabsTrigger value="all" className="h-8 rounded-full border-0 bg-transparent px-4 text-xs font-medium text-slate-500 shadow-none hover:bg-slate-100 hover:text-slate-900 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-soft data-[state=active]:shadow-primary/20 data-[state=active]:ring-0 dark:hover:bg-slate-800">All</TabsTrigger>
            <TabsTrigger value="unread" className="h-8 rounded-full border-0 bg-transparent px-4 text-xs font-medium text-slate-500 shadow-none hover:bg-slate-100 hover:text-slate-900 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-soft data-[state=active]:shadow-primary/20 data-[state=active]:ring-0 dark:hover:bg-slate-800">Unread</TabsTrigger>
            <TabsTrigger value="requests" className="h-8 rounded-full border-0 bg-transparent px-4 text-xs font-medium text-slate-500 shadow-none hover:bg-slate-100 hover:text-slate-900 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-soft data-[state=active]:shadow-primary/20 data-[state=active]:ring-0 dark:hover:bg-slate-800">Requests</TabsTrigger>
            <TabsTrigger value="documents" className="h-8 rounded-full border-0 bg-transparent px-4 text-xs font-medium text-slate-500 shadow-none hover:bg-slate-100 hover:text-slate-900 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-soft data-[state=active]:shadow-primary/20 data-[state=active]:ring-0 dark:hover:bg-slate-800">Documents</TabsTrigger>
            <TabsTrigger value="submissions" className="h-8 rounded-full border-0 bg-transparent px-4 text-xs font-medium text-slate-500 shadow-none hover:bg-slate-100 hover:text-slate-900 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-soft data-[state=active]:shadow-primary/20 data-[state=active]:ring-0 dark:hover:bg-slate-800">Submissions</TabsTrigger>
            <TabsTrigger value="tasks" className="h-8 rounded-full border-0 bg-transparent px-4 text-xs font-medium text-slate-500 shadow-none hover:bg-slate-100 hover:text-slate-900 data-[state=active]:bg-primary data-[state=active]:text-white data-[state=active]:shadow-soft data-[state=active]:shadow-primary/20 data-[state=active]:ring-0 dark:hover:bg-slate-800">Tasks</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="relative mb-5 w-full">
        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Search notifications..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 border-slate-200 bg-white pl-8 text-sm shadow-none placeholder:text-slate-400 hover:border-slate-300 focus:bg-white dark:bg-slate-900"
        />
      </div>

      <div className="space-y-2.5">
        {loading ? (
          <Card className="border-border/60 dark:border-gray-700 shadow-soft">
            <CardContent className="p-8 text-center">
              <p className="text-[14px] text-gray-500">Loading notifications...</p>
            </CardContent>
          </Card>
        ) : filteredNotifs.length === 0 ? (
          <Card className="border-border/60 dark:border-gray-700 shadow-soft">
            <CardContent className="p-8 text-center">
              <Bell className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-[14px] text-gray-500">No notifications found</p>
            </CardContent>
          </Card>
        ) : (
          filteredNotifs.map((notif) => {
            const route = resolveNotificationRoute(notif)
            const item: NotificationItem = notif
            const { Icon, className: iconClassName } = getNotificationVisual(item)
            return (
              <Card
                key={notif.id}
                onDoubleClick={() => handleViewNotification(notif)}
                title={route ? "Double-click to view" : undefined}
                className={cn(
                  "bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 border-l-4 border-l-transparent rounded-xl shadow-xs transition-colors hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer",
                  !notif.read && "border-l-blue-600"
                )}
              >
                <CardContent className="p-5 sm:px-5 sm:py-4 md:px-5 md:py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className={cn("size-8 rounded-full flex items-center justify-center shrink-0", iconClassName)}>
                        <Icon className="size-4" aria-hidden="true" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{notif.title}</h3>
                          {!notif.read && <span className="size-1.5 rounded-full bg-blue-600 inline-block" aria-label="Unread" />}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{notif.message}</p>
                        {(() => {
                          const attachment = notif.metadata && typeof notif.metadata === "object" && "attachment" in notif.metadata ? (notif.metadata as { attachment?: { name?: string; dataUrl?: string } }).attachment : undefined
                          return attachment?.dataUrl ? <a href={attachment.dataUrl} download={attachment.name ?? "announcement-reference"} onClick={(event) => event.stopPropagation()} className="mt-1 inline-block text-xs font-medium text-blue-600 hover:underline">Download reference: {attachment.name ?? "attached file"}</a> : null
                        })()}
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
                          <span>{getTimeAgo(notif.createdAt)}</span>
                        {route && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleViewNotification(notif) }}
                            className="text-blue-600 hover:underline font-medium"
                          >
                            View
                          </button>
                        )}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={notif.read}
                      aria-hidden={notif.read}
                      onClick={(e) => { e.stopPropagation(); markAsRead(notif.id) }}
                      className={cn(
                        "self-center whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200",
                        notif.read && "invisible pointer-events-none"
                      )}
                    >
                      Mark as read
                    </button>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
