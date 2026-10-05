import { useEffect, useMemo, useState } from "react"
import { ArrowRight, Clock3, FileCheck2, Send, ClipboardList, Globe2, UserRound } from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { Skeleton } from "@/components/ui/Skeleton"
import { getDashboardOverview, type DashboardOverview } from "@/services/dashboard"
import { listAllOnlineSubmissions, listOnlineTasks, type OnlineAaccupTask, type OnlineSubmissionListItem } from "@/services/aaccup"
import { listRequests } from "@/services/requests"
import { listAuditEntries, type AuditEntry } from "@/services/admin"
import type { DocumentRequest } from "@/types/domain"
import { useAuth } from "@/context/AuthContext"
import { hasServerPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"

interface AdminDashboardProps {
  onNavigate: (page: string, query?: Record<string, string>) => void
}

type SectionState<T> = { data: T | null; error: boolean }

const statusLabel: Record<string, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  NEEDS_REVISION: "Returned",
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function formatAuditDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function formatAuditTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" })
}

function isDueSoon(task: OnlineAaccupTask, now = Date.now()): boolean {
  if (!task.dueDate || task.status === "COMPLETED" || task.status === "CANCELLED") return false
  const due = new Date(task.dueDate).getTime()
  return due >= now && due <= now + 7 * 24 * 60 * 60 * 1000
}

function isOverdue(task: OnlineAaccupTask, now = Date.now()): boolean {
  if (!task.dueDate || task.status === "COMPLETED" || task.status === "CANCELLED") return false
  return new Date(task.dueDate).getTime() < now
}

export default function AdminDashboard({ onNavigate }: AdminDashboardProps) {
  const { user } = useAuth()
  // Department Coordinators have admin-portal access but no `audit.read`; firing
  // the request anyway would 403 and write a PERMISSION_DENIED audit event on
  // every dashboard load.
  const canReadAudit = hasServerPermission(user, "audit.read")
  const [overview, setOverview] = useState<SectionState<DashboardOverview>>({ data: null, error: false })
  const [submissions, setSubmissions] = useState<SectionState<OnlineSubmissionListItem[]>>({ data: null, error: false })
  const [requests, setRequests] = useState<SectionState<DocumentRequest[]>>({ data: null, error: false })
  const [tasks, setTasks] = useState<SectionState<OnlineAaccupTask[]>>({ data: null, error: false })
  const [activity, setActivity] = useState<SectionState<AuditEntry[]>>({ data: null, error: false })

  useEffect(() => {
    const pending: Promise<unknown>[] = [
      getDashboardOverview().then((data) => setOverview({ data, error: false })).catch(() => setOverview({ data: null, error: true })),
      listAllOnlineSubmissions().then((data) => setSubmissions({ data, error: false })).catch(() => setSubmissions({ data: null, error: true })),
      listRequests().then((data) => setRequests({ data, error: false })).catch(() => setRequests({ data: null, error: true })),
      listOnlineTasks().then((data) => setTasks({ data, error: false })).catch(() => setTasks({ data: null, error: true })),
    ]
    if (canReadAudit) {
      pending.push(
        listAuditEntries({ page: 1, pageSize: 8 }).then((page) => setActivity({ data: page.items, error: false })).catch(() => setActivity({ data: null, error: true })),
      )
    } else {
      setActivity({ data: [], error: false })
    }
    void Promise.all(pending)
  }, [canReadAudit])

  const pendingSubmissions = submissions.data?.filter((s) => s.status === "PENDING").length ?? 0
  const pendingRequests = requests.data?.filter((r) => r.status === "Pending").length ?? 0
  const now = Date.now()
  const overdueTasks = tasks.data?.filter((t) => isOverdue(t, now)).length ?? 0
  const dueSoonTasks = tasks.data?.filter((t) => isDueSoon(t, now)).length ?? 0
  const completedTasks = tasks.data?.filter((t) => t.status === "COMPLETED").length ?? 0

  const recentSubmissions = useMemo(
    () => [...(submissions.data ?? [])].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 5),
    [submissions.data],
  )

  const recentActivity = useMemo(
    () => [...(activity.data ?? [])]
      .sort((a, b) => {
        const timestampOrder = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        return timestampOrder || b.id.localeCompare(a.id)
      })
      .slice(0, 6),
    [activity.data],
  )

  const nav = (page: string, query?: Record<string, string>) => onNavigate(page, query)

  return (
    <div className="content-padding">
      <PageHeader title="Good morning, Admin" description="Review what needs attention and monitor accreditation progress." />

      <div className="grid grid-cols-1 sm:grid-cols-3 responsive-gap mb-6 lg:mb-8">
        <Card className="border-border/70 shadow-soft hover:shadow-lift hover:-translate-y-0.5 transition-all duration-200 cursor-pointer" onClick={() => nav("submissions", { tab: "submissions", status: "PENDING" })}>
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 md:w-11 md:h-11 rounded-xl bg-primary-50 flex items-center justify-center text-primary-600">
                <FileCheck2 className="w-5 h-5" />
              </div>
              {pendingSubmissions > 0 && <Badge variant="warning" className="text-[10px]">Pending</Badge>}
            </div>
            <p className="text-[12px] md:text-[13px] text-gray-500 font-semibold mt-3 md:mt-4">Submissions</p>
            <p className="text-[24px] md:text-[30px] font-extrabold text-navy-900 mt-0.5 tracking-tight">{submissions.data ? pendingSubmissions : "…"}</p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-soft hover:shadow-lift hover:-translate-y-0.5 transition-all duration-200 cursor-pointer" onClick={() => nav("requests", { status: "PENDING" })}>
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 md:w-11 md:h-11 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
                <Send className="w-5 h-5" />
              </div>
              {pendingRequests > 0 && <Badge variant="warning" className="text-[10px]">Pending</Badge>}
            </div>
            <p className="text-[12px] md:text-[13px] text-gray-500 font-semibold mt-3 md:mt-4">Requests</p>
            <p className="text-[24px] md:text-[30px] font-extrabold text-navy-900 mt-0.5 tracking-tight">{requests.data ? pendingRequests : "…"}</p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-soft hover:shadow-lift hover:-translate-y-0.5 transition-all duration-200 cursor-pointer" onClick={() => nav("aaccup", { tab: "tasks", taskFilter: "due-soon" })}>
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center justify-between">
              <div className="w-10 h-10 md:w-11 md:h-11 rounded-xl bg-red-50 flex items-center justify-center text-red-600">
                <Clock3 className="w-5 h-5" />
              </div>
              {dueSoonTasks > 0 && <Badge variant="danger" className="text-[10px]">Due Soon</Badge>}
            </div>
            <p className="text-[12px] md:text-[13px] text-gray-500 font-semibold mt-3 md:mt-4">Tasks</p>
            <p className="text-[24px] md:text-[30px] font-extrabold text-navy-900 mt-0.5 tracking-tight">{tasks.data ? dueSoonTasks : "…"}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 shadow-soft mb-6 lg:mb-8">
        <CardHeader className="pb-4">
          <CardTitle className="text-[15px] font-semibold">Accreditation Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {overview.error ? (
            <p className="text-sm text-red-600">Accreditation progress is unavailable.</p>
          ) : overview.data === null ? (
            <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} variant="rectangular" className="h-12" />)}</div>
          ) : (
            (["AACCUP", "ISO"] as const).map((key) => {
              const stats = overview.data!.aaccup.byAreaSet[key]
              const label = key === "AACCUP" ? "AACCUP" : "ISO 21001:2025"
              const page = key === "AACCUP" ? "aaccup" : "iso"
              return (
                <div key={key}>
                  <button type="button" className="block w-full rounded-xl p-2 text-left transition hover:bg-primary-50/40 focus:outline-none focus:ring-2 focus:ring-primary" onClick={() => nav(page)}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="font-semibold text-gray-800">{label}</span>
                      <span className="font-extrabold text-navy-900">{stats ? `${stats.overallCompliancePercentage}%` : "—"}</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-navy-50">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${stats?.overallCompliancePercentage ?? 0}%` }} />
                    </div>
                  </button>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 px-2 text-xs">
                    <button type="button" className="text-emerald-600 hover:underline font-semibold" onClick={() => nav("submissions", { status: "APPROVED" })}>Approved {overview.data!.aaccup.approved}</button>
                    <button type="button" className="text-amber-600 hover:underline font-semibold" onClick={() => nav("submissions", { status: "PENDING" })}>Pending {overview.data!.aaccup.pending}</button>
                    <button type="button" className="text-orange-600 hover:underline font-semibold" onClick={() => nav("submissions", { status: "NEEDS_REVISION" })}>Returned {overview.data!.aaccup.needsRevision}</button>
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-soft mb-6 lg:mb-8">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-[15px] font-semibold">Recent Submissions</CardTitle>
            <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary" onClick={() => nav("submissions", { tab: "submissions" })}>View All</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {submissions.error ? (
            <p className="text-[13px] text-red-500 py-2">Recent submissions are unavailable.</p>
          ) : submissions.data === null ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} variant="rectangular" className="h-10" />)}</div>
          ) : recentSubmissions.length === 0 ? (
            <p className="text-[13px] text-gray-400 py-2 text-center">No submissions recorded yet.</p>
          ) : (
            recentSubmissions.map((item) => (
              <button key={item.id} type="button" onClick={() => nav("submissions", { tab: "submissions", highlight: item.id, areaSet: item.areaSet })} className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-primary-50/40 transition-colors text-left">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                    <FileCheck2 className="w-4 h-4 text-primary-600" />
                  </div>
                  <div className="min-w-0 flex-1 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 items-baseline sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <span className="text-[13px] font-semibold text-gray-900 truncate">{item.documentTitle}</span>
                    <span className="hidden sm:block text-[12px] text-gray-500 truncate">{item.submittedByName ?? "Unknown"}</span>
                    <span className="hidden sm:block text-[12px] text-gray-500 truncate">{item.areaSet} · {item.areaName}</span>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">{statusLabel[item.status]} · {formatDate(item.submittedAt)}</span>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 responsive-gap mb-6 lg:mb-8">
        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[15px] font-semibold">Requests</CardTitle>
              <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary" onClick={() => nav("requests")}>Manage<ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
            </div>
          </CardHeader>
          <CardContent>
            {requests.error ? (
              <p className="text-[13px] text-red-500">Requests are unavailable.</p>
            ) : requests.data === null ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} variant="rectangular" className="h-8" />)}</div>
            ) : (
              <div className="space-y-1">
                <button type="button" onClick={() => nav("requests", { status: "PENDING" })} className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-[13px] hover:bg-primary-50/40 transition-colors">
                  <span className="text-gray-600 font-medium">Pending</span>
                  <span className={cn("font-bold", pendingRequests > 0 ? "text-amber-600" : "text-gray-400")}>{pendingRequests}</span>
                </button>
                <button type="button" onClick={() => nav("requests", { status: "APPROVED" })} className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-[13px] hover:bg-primary-50/40 transition-colors">
                  <span className="text-gray-600 font-medium">Approved</span>
                  <span className={cn("font-bold", (requests.data?.filter((r) => r.status === "Approved").length ?? 0) > 0 ? "text-emerald-600" : "text-gray-400")}>{requests.data?.filter((r) => r.status === "Approved").length ?? 0}</span>
                </button>
                <button type="button" onClick={() => nav("requests", { status: "FULFILLED" })} className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-[13px] hover:bg-primary-50/40 transition-colors">
                  <span className="text-gray-600 font-medium">Fulfilled</span>
                  <span className={cn("font-bold", (requests.data?.filter((r) => r.status === "Fulfilled").length ?? 0) > 0 ? "text-primary-600" : "text-gray-400")}>{requests.data?.filter((r) => r.status === "Fulfilled").length ?? 0}</span>
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-[15px] font-semibold">Tasks</CardTitle>
              <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary" onClick={() => nav("aaccup", { tab: "tasks" })}>View Tasks<ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
            </div>
          </CardHeader>
          <CardContent>
            {tasks.data === null ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} variant="rectangular" className="h-8" />)}</div>
            ) : (
              <div className="space-y-1">
                <button type="button" onClick={() => nav("aaccup", { tab: "tasks", taskFilter: "overdue" })} className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-[13px] hover:bg-primary-50/40 transition-colors">
                  <span className="text-gray-600 font-medium">Overdue</span>
                  <span className={cn("font-bold", overdueTasks > 0 ? "text-red-600" : "text-gray-400")}>{overdueTasks}</span>
                </button>
                <button type="button" onClick={() => nav("aaccup", { tab: "tasks", taskFilter: "due-soon" })} className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-[13px] hover:bg-primary-50/40 transition-colors">
                  <span className="text-gray-600 font-medium">Due Soon</span>
                  <span className={cn("font-bold", dueSoonTasks > 0 ? "text-amber-600" : "text-gray-400")}>{dueSoonTasks}</span>
                </button>
                <button type="button" onClick={() => nav("aaccup", { tab: "tasks", taskFilter: "completed" })} className="flex w-full items-center justify-between rounded-xl px-2 py-2 text-[13px] hover:bg-primary-50/40 transition-colors">
                  <span className="text-gray-600 font-medium">Completed</span>
                  <span className={cn("font-bold", completedTasks > 0 ? "text-emerald-600" : "text-gray-400")}>{completedTasks}</span>
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
            <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary" onClick={() => nav("audit")}>View Audit<ArrowRight className="w-3.5 h-3.5 ml-1" /></Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {activity.error ? (
            <p className="text-[13px] text-red-500 py-2">Recent activity is unavailable.</p>
          ) : activity.data === null ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} variant="rectangular" className="h-9" />)}</div>
          ) : recentActivity.length === 0 ? (
            <p className="text-[13px] text-gray-400 py-2 text-center">No recent activity.</p>
          ) : (
            recentActivity.map((entry) => {
              const entity = entry.entity?.type?.toLowerCase()
              const id = entry.entity?.id ?? entry.targetId ?? undefined
              let dest: { page: string; query?: Record<string, string> } | null = null
              if ((entity === "submission" || entity === "aaccup_submission") && id) dest = { page: "submissions", query: { tab: "submissions", highlight: id } }
              else if ((entity === "request" || entity === "document_request") && id) dest = { page: "requests", query: { highlight: id } }
              else if ((entity === "task" || entity === "aaccup_task") && id) dest = { page: "aaccup", query: { tab: "tasks", highlight: id } }
              else if (entity === "user" && id) dest = { page: "users", query: { highlight: id } }
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => dest ? nav(dest.page, dest.query) : nav("audit")}
                  className="group w-full rounded-xl border border-transparent px-3 py-3 text-left transition-colors hover:border-border hover:bg-primary-50/30"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                      <ClipboardList className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-gray-900">{entry.description ?? entry.action}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                          <UserRound className="h-3 w-3 text-slate-400" />
                          {entry.user?.name ?? entry.actorName ?? "System"}
                        </span>
                        <span>{formatAuditDate(entry.timestamp)}</span>
                        <span>{formatAuditTime(entry.timestamp)}</span>
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-400">
                          <Globe2 className="h-3 w-3" />
                          {entry.ipAddress ?? "IP unavailable"}
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="mt-2 h-4 w-4 flex-shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary-500" />
                  </div>
                </button>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
