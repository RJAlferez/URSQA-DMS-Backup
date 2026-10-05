import { useCallback, useEffect, useState } from "react"
import {
  ArrowRight, Clock3, RotateCcw, Send, ClipboardList,
  Folder, FileText, Star, AlertCircle,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Skeleton } from "@/components/ui/Skeleton"
import { useAuth } from "@/context/AuthContext"
import { hasServerPermission } from "@/lib/permissions"
import { listOnlineDocuments } from "@/services/documents"
import { listRepositoryFolders } from "@/services/documents"
import { listFavoriteOnlineDocuments } from "@/services/documents"
import { listMyActivity, type AuditEntry } from "@/services/admin"
import { listOnlineAaccupAreas, listOnlineRequirements, type AreaSet } from "@/services/aaccup"
import { refreshUserAttention, subscribeUserAttention, type UserAttention } from "@/lib/userAttention"
import { cn } from "@/lib/utils"

interface UserDashboardProps {
  onNavigate?: (page: string, query?: Record<string, string>) => void
}

type SectionState<T> = { data: T | null; error: boolean }

type ProgressRow = {
  key: AreaSet
  label: string
  page: string
  total: number
  approved: number
  pending: number
  returned: number
  missing: number
  pct: number
}

function activityDest(entry: AuditEntry): { page: string; query?: Record<string, string> } | null {
  const entity = entry.entity?.type?.toLowerCase()
  const id = entry.entity?.id ?? entry.targetId ?? undefined
  if ((entity === "submission" || entity === "aaccup_submission") && id) return { page: "aaccup", query: { tab: "submissions", highlight: id } }
  if ((entity === "request" || entity === "document_request") && id) return { page: "requests", query: { highlight: id } }
  if ((entity === "task" || entity === "aaccup_task") && id) return { page: "aaccup", query: { tab: "tasks", highlight: id } }
  return null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export default function UserDashboard({ onNavigate }: UserDashboardProps) {
  const { user } = useAuth()
  const [attention, setAttention] = useState<UserAttention>({
    returnedSubmissions: 0, dueSoonTasks: 0, overdueTasks: 0, openTasks: 0,
    pendingRequests: 0, fulfilledRequests: 0, refusedRequests: 0, approvedRequests: 0,
    allSubmissions: [], returnedSubmissionsList: [], overdueTasksList: [], dueSoonTasksList: [], recentRequestUpdates: [],
    loading: true,
  })
  const [docCount, setDocCount] = useState<SectionState<{ files: number; folders: number; favorites: number }>>({ data: null, error: false })
  const [activity, setActivity] = useState<SectionState<AuditEntry[]>>({ data: null, error: false })
  const [progressRows, setProgressRows] = useState<ProgressRow[]>([])
  const [progressError, setProgressError] = useState(false)

  const firstName = user?.name?.split(" ")[0] ?? "User"
  const canReadAaccup = hasServerPermission(user, "aaccup.read")
  const canReadRequirements = hasServerPermission(user, "aaccup.requirement.read")

  useEffect(() => {
    if (!user) return
    const unsub = subscribeUserAttention(setAttention, user.id)
    void refreshUserAttention(user.id, user.permissions)
    return unsub
  }, [user])

  useEffect(() => {
    if (!user) return
    const poll = setInterval(() => refreshUserAttention(user.id, user.permissions), 30000)
    return () => clearInterval(poll)
  }, [user])

  const loadSecondaryData = useCallback(() => {
    if (!user) return Promise.resolve()
    return Promise.all([
      listOnlineDocuments({ ownerId: user.id, archived: false }),
      listRepositoryFolders({ ownerId: user.id }),
      listFavoriteOnlineDocuments(),
    ]).then(([docs, folders, favs]) => {
      setDocCount({ data: { files: docs.length, folders: folders.length, favorites: favs.length }, error: false })
    }).catch(() => setDocCount({ data: null, error: true }))
      .then(() => listMyActivity({ page: 1, pageSize: 8 }))
      .then((page) => setActivity({ data: page.items, error: false }))
      .catch(() => setActivity({ data: null, error: true }))
  }, [user])

  useEffect(() => {
    void loadSecondaryData()
    const interval = window.setInterval(() => void loadSecondaryData(), 30000)
    const refreshOnFocus = () => void loadSecondaryData()
    window.addEventListener("focus", refreshOnFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", refreshOnFocus)
    }
  }, [loadSecondaryData])

  const { loading: attentionLoading, allSubmissions } = attention

  useEffect(() => {
    if (!canReadAaccup || !canReadRequirements) {
      setProgressRows([])
      return
    }
    if (attentionLoading) return
    let cancelled = false
    const loadProgress = async () => {
      try {
        const rows = await Promise.all(([
          ["AACCUP", "AACCUP", "aaccup"],
          ["ISO", "ISO 21001:2025", "iso"],
        ] as const).map(async ([key, label, page]) => {
          const areas = await listOnlineAaccupAreas(key)
          const requirements = (await Promise.all(areas.map((area) => listOnlineRequirements(area.id)))).flat()
          const requirementIds = new Set(requirements.map((requirement) => requirement.id))
          const latest = new Map<string, (typeof allSubmissions)[number]>()
          allSubmissions.filter((submission) => submission.areaSet === key && requirementIds.has(submission.requirementId)).forEach((submission) => {
            const current = latest.get(submission.requirementId)
            if (!current || submission.submittedAt > current.submittedAt) latest.set(submission.requirementId, submission)
          })
          const statuses = [...latest.values()]
          const approved = statuses.filter((submission) => submission.status === "APPROVED").length
          const pending = statuses.filter((submission) => submission.status === "PENDING").length
          const returned = statuses.filter((submission) => submission.status === "NEEDS_REVISION" || submission.status === "REJECTED").length
          return { key, label, page, total: requirements.length, approved, pending, returned, missing: Math.max(0, requirements.length - statuses.length), pct: requirements.length ? Math.round((approved / requirements.length) * 100) : 0 }
        }))
        if (!cancelled) {
          setProgressRows(rows)
          setProgressError(false)
        }
      } catch {
        if (!cancelled) setProgressError(true)
      }
    }
    void loadProgress()
    return () => { cancelled = true }
  }, [canReadAaccup, canReadRequirements, attentionLoading, allSubmissions])

  const nav = (page: string, query?: Record<string, string>) => onNavigate?.(page, query)

  return (
    <div className="content-padding">
      <PageHeader
        title={`Good morning, ${firstName}`}
        description="Here's what needs your attention."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 responsive-gap mb-6 lg:mb-8">
        <Card className="border-border/70 shadow-soft hover:shadow-lift hover:-translate-y-0.5 transition-all duration-200 cursor-pointer" onClick={() => nav("aaccup", { tab: "tasks", taskFilter: "due-soon" })}>
          <CardContent className="p-5 md:p-6">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[12px] font-medium text-gray-500 md:text-[13px]">Tasks needing action</span>
              <Clock3 className="h-4 w-4 text-primary-600" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 md:text-3xl">{attention.loading ? <Skeleton className="h-9 w-12" /> : attention.dueSoonTasks + attention.overdueTasks}</p>
            <p className="mt-3 text-[11px] text-gray-500">{attention.loading ? "Checking deadlines..." : `${attention.overdueTasks} overdue · ${attention.dueSoonTasks} due soon`}</p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-soft hover:shadow-lift hover:-translate-y-0.5 transition-all duration-200 cursor-pointer" onClick={() => nav("aaccup", { tab: "submissions", status: "NEEDS_REVISION" })}>
          <CardContent className="p-5 md:p-6">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[12px] font-medium text-gray-500 md:text-[13px]">Submissions to revise</span>
              <RotateCcw className="h-4 w-4 text-orange-600" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 md:text-3xl">{attention.loading ? <Skeleton className="h-9 w-12" /> : attention.returnedSubmissions}</p>
            <p className="mt-3 text-[11px] text-gray-500">Returned by an administrator</p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-soft hover:shadow-lift hover:-translate-y-0.5 transition-all duration-200 cursor-pointer" onClick={() => nav("requests")}>
          <CardContent className="p-5 md:p-6">
            <div className="flex items-start justify-between gap-3">
              <span className="text-[12px] font-medium text-gray-500 md:text-[13px]">Request updates</span>
              <Send className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-navy-900 md:text-3xl">{attention.loading ? <Skeleton className="h-9 w-12" /> : attention.approvedRequests + attention.fulfilledRequests + attention.refusedRequests}</p>
            <p className="mt-3 text-[11px] text-gray-500">Approved, delivered, or rejected</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 shadow-soft mb-6 lg:mb-8">
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px] font-semibold">My Accreditation Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!canReadAaccup || !canReadRequirements ? (
            <p className="py-3 text-center text-[13px] text-gray-400">Accreditation progress is not available for your role.</p>
          ) : progressError ? (
            <p className="py-3 text-center text-[13px] text-red-500">Accreditation progress is unavailable.</p>
          ) : attention.loading || progressRows.length === 0 ? (
            <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} variant="rectangular" className="h-12" />)}</div>
          ) : (
            progressRows.map((row) => (
              <div key={row.key}>
                <button
                  type="button"
                  className="block w-full rounded-xl p-2 text-left transition hover:bg-primary-50/40 focus:outline-none focus:ring-2 focus:ring-primary"
                  onClick={() => nav(row.page)}
                >
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-semibold text-gray-800">{row.label}</span>
                    <span className="font-extrabold text-navy-900">{row.pct}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-navy-50">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${row.pct}%` }} />
                  </div>
                </button>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 px-2 text-xs">
                   <button type="button" className="text-emerald-600 hover:underline font-semibold" onClick={() => nav(row.page, { tab: "submissions", status: "APPROVED" })}>Approved {row.approved}</button>
                   <button type="button" className="text-amber-600 hover:underline font-semibold" onClick={() => nav(row.page, { tab: "submissions", status: "PENDING" })}>Pending {row.pending}</button>
                   <button type="button" className="text-orange-600 hover:underline font-semibold" onClick={() => nav(row.page, { tab: "submissions", status: "NEEDS_REVISION" })}>Returned {row.returned}</button>
                   <span className="text-gray-400">Missing {row.missing}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-soft mb-6 lg:mb-8">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[15px] font-semibold">Needs Your Attention</CardTitle>
            <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary" onClick={() => nav("aaccup", { tab: "tasks" })}>View All</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {attention.loading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} variant="rectangular" className="h-10" />)}</div>
          ) : attention.returnedSubmissionsList.length + attention.overdueTasksList.length + attention.dueSoonTasksList.length + attention.recentRequestUpdates.length === 0 ? (
            <p className="text-[13px] text-gray-400 py-3 text-center">Nothing needs your attention right now.</p>
          ) : (
            <>
              {attention.returnedSubmissionsList.slice(0, 3).map((sub) => (
                <button key={`ret-${sub.id}`} type="button" onClick={() => nav("aaccup", { tab: "submissions", highlight: sub.id, status: "NEEDS_REVISION" })} className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-primary-50/40 transition-colors text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center flex-shrink-0">
                      <RotateCcw className="w-4 h-4 text-orange-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-gray-900 truncate">{sub.documentTitle}</p>
                      <p className="text-[12px] text-gray-500">{sub.areaSet} · {sub.areaName}</p>
                    </div>
                  </div>
                  <Badge variant="warning" className="text-[10px]">Returned</Badge>
                </button>
              ))}
              {attention.overdueTasksList.slice(0, 2).map((task) => (
                <button key={`ovr-${task.id}`} type="button" onClick={() => nav("aaccup", { tab: "tasks", highlight: task.id, taskFilter: "overdue" })} className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-primary-50/40 transition-colors text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                      <Clock3 className="w-4 h-4 text-red-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-gray-900 truncate">{task.title}</p>
                      <p className="text-[12px] text-gray-500">{task.areaSet} · Overdue {formatDate(task.dueDate)}</p>
                    </div>
                  </div>
                  <Badge variant="danger" className="text-[10px]">Overdue</Badge>
                </button>
              ))}
               {attention.dueSoonTasksList.slice(0, 2).map((task) => (
                <button key={`soon-${task.id}`} type="button" onClick={() => nav("aaccup", { tab: "tasks", highlight: task.id, taskFilter: "due-soon" })} className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-primary-50/40 transition-colors text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                      <Clock3 className="w-4 h-4 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-gray-900 truncate">{task.title}</p>
                      <p className="text-[12px] text-gray-500">{task.areaSet} · Due {formatDate(task.dueDate)}</p>
                    </div>
                  </div>
                  <Badge variant="warning" className="text-[10px]">Due Soon</Badge>
                </button>
               ))}
              {attention.recentRequestUpdates.slice(0, 3).map((request) => (
                <button key={`req-${request.id}`} type="button" onClick={() => nav("requests", { highlight: request.id })} className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-primary-50/40 transition-colors text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0"><Send className="w-4 h-4 text-primary-600" /></div>
                    <div className="min-w-0"><p className="text-[13px] text-gray-900 font-semibold truncate">{request.title}</p><p className="text-[12px] text-gray-500">Request updated · {formatDate(request.updatedAt)}</p></div>
                  </div>
                  <Badge variant={request.status === "Rejected" ? "danger" : request.status === "Fulfilled" ? "success" : "default"} className="text-[10px]">{request.status}</Badge>
                </button>
              ))}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 responsive-gap mb-6 lg:mb-8">
        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[15px] font-semibold">My Documents</CardTitle>
              <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary" onClick={() => nav("documents")}>Open<ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
            </div>
          </CardHeader>
          <CardContent>
            {docCount.error ? (
              <p className="text-[13px] text-red-500">Documents are unavailable.</p>
            ) : docCount.data === null ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} variant="rectangular" className="h-7" />)}</div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-[13px]"><span className="flex items-center gap-2.5 text-gray-600 font-medium"><FileText className="w-4 h-4 text-primary-400" />Files</span><span className="font-bold text-navy-900">{docCount.data.files}</span></div>
                <div className="flex items-center justify-between text-[13px]"><span className="flex items-center gap-2.5 text-gray-600 font-medium"><Folder className="w-4 h-4 text-amber-500" />Folders</span><span className="font-bold text-navy-900">{docCount.data.folders}</span></div>
                <div className="flex items-center justify-between text-[13px]"><span className="flex items-center gap-2.5 text-gray-600 font-medium"><Star className="w-4 h-4 text-amber-500" />Favorites</span><span className="font-bold text-navy-900">{docCount.data.favorites}</span></div>
                {attention.fulfilledRequests > 0 && (
                  <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />{attention.fulfilledRequests} requested document(s) delivered
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[15px] font-semibold">My Requests</CardTitle>
              <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary" onClick={() => nav("requests")}>View All<ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
            </div>
          </CardHeader>
          <CardContent>
            {attention.loading ? (
              <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} variant="rectangular" className="h-8" />)}</div>
            ) : (
              <div className="space-y-1">
                <button type="button" onClick={() => nav("requests", { tab: "pending" })} className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-[13px] hover:bg-primary-50/40 transition-colors">
                  <span className="text-gray-600 font-medium">Pending</span>
                  <span className={cn("font-bold", attention.pendingRequests > 0 ? "text-amber-600" : "text-gray-400")}>{attention.pendingRequests}</span>
                </button>
                <button type="button" onClick={() => nav("requests", { tab: "approved" })} className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-[13px] hover:bg-primary-50/40 transition-colors">
                  <span className="text-gray-600 font-medium">Approved</span>
                  <span className={cn("font-bold", attention.approvedRequests > 0 ? "text-emerald-600" : "text-gray-400")}>{attention.approvedRequests}</span>
                </button>
                <button type="button" onClick={() => nav("requests", { tab: "fulfilled" })} className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-[13px] hover:bg-primary-50/40 transition-colors">
                  <span className="text-gray-600 font-medium">Fulfilled</span>
                  <span className={cn("font-bold", attention.fulfilledRequests > 0 ? "text-primary-600" : "text-gray-400")}>{attention.fulfilledRequests}</span>
                </button>
                <button type="button" onClick={() => nav("requests", { tab: "rejected" })} className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-[13px] hover:bg-primary-50/40 transition-colors">
                  <span className="text-gray-600 font-medium">Rejected</span>
                  <span className={cn("font-bold", attention.refusedRequests > 0 ? "text-red-600" : "text-gray-400")}>{attention.refusedRequests}</span>
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 shadow-soft">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[15px] font-semibold">Recent Activity</CardTitle>
            <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary" onClick={() => nav("activity")}>My Activity<ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {activity.error ? (
            <p className="text-[13px] text-red-500 py-2">Recent activity is unavailable.</p>
          ) : activity.data === null ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} variant="rectangular" className="h-9" />)}</div>
          ) : activity.data.length === 0 ? (
            <p className="text-[13px] text-gray-400 py-2 text-center">No recent activity.</p>
          ) : (
            activity.data.slice(0, 5).map((entry) => {
              const dest = activityDest(entry)
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => dest ? nav(dest.page, dest.query) : nav("activity")}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-primary-50/40 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                    <ClipboardList className="w-4 h-4 text-primary-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-gray-900 font-semibold truncate">{entry.description ?? entry.action}</p>
                    <p className="text-[12px] text-gray-400">{entry.actorName ?? "System"} · {formatDate(entry.timestamp)}</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                </button>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
