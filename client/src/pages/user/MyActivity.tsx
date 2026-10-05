import { useState, useEffect, useCallback } from "react"
import { Search, Clock, CheckCircle, XCircle, ShieldAlert, CalendarDays, Download, ChevronRight } from "lucide-react"
import { listMyActivity, type AuditEntry } from "@/services/admin"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent } from "@/components/ui/Card"
import { Badge } from "@/components/ui/Badge"
import { Input } from "@/components/ui/Input"
import { Button } from "@/components/ui/Button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select"
import { cn } from "@/lib/utils"

const CATEGORY_COLORS: Record<string, string> = {
  AUTHENTICATION: "bg-primary-50 text-blue-700 border-blue-200",
  SUBMISSION: "bg-purple-50 text-purple-700 border-purple-200",
  REQUEST: "bg-amber-50 text-amber-700 border-amber-200",
  SECURITY: "bg-red-50 text-red-700 border-red-200",
  ACCESS_CONTROL: "bg-orange-50 text-orange-700 border-orange-200",
  SYSTEM: "bg-gray-50 text-gray-700 border-border",
  REPOSITORY: "bg-emerald-50 text-emerald-700 border-emerald-200",
}

const RESULT_BADGES: Record<string, { color: string; icon: React.ReactNode }> = {
  SUCCESS: { color: "bg-emerald-50 text-emerald-700", icon: <CheckCircle className="w-3 h-3" /> },
  FAILED: { color: "bg-red-50 text-red-700", icon: <XCircle className="w-3 h-3" /> },
  DENIED: { color: "bg-amber-50 text-amber-700", icon: <ShieldAlert className="w-3 h-3" /> },
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
  } catch {
    return iso
  }
}

function actionLabel(action: string): string {
  return action
    .replace(/[._]+/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

interface ActivityTab {
  id: "all" | "security" | "authentication" | "access" | "system" | "errors"
  label: string
  category?: string
  result?: string
}

const ACTIVITY_TABS: readonly ActivityTab[] = [
  { id: "all", label: "All" },
  { id: "security", label: "Security", category: "SECURITY" },
  { id: "authentication", label: "Authentication", category: "AUTHENTICATION" },
  { id: "access", label: "Access", category: "ACCESS_CONTROL" },
  { id: "system", label: "System", category: "SYSTEM" },
  { id: "errors", label: "Errors", result: "FAILED" },
]

function getDateRangeStart(days: string): string | undefined {
  if (days === "all") return undefined
  const date = new Date()
  date.setDate(date.getDate() - Number(days))
  return date.toISOString()
}

export default function MyActivity() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState("")
  const [activeTab, setActiveTab] = useState<ActivityTab["id"]>("all")
  const [dateRange, setDateRange] = useState("30")
  const [detailId, setDetailId] = useState<string | null>(null)
  const selectedTab = ACTIVITY_TABS.find((tab) => tab.id === activeTab) ?? ACTIVITY_TABS[0]

  const fetch = useCallback(
    async (p: number) => {
      setLoading(true)
      try {
        const res = await listMyActivity({
          page: p,
          pageSize: 20,
          q: q || undefined,
          category: selectedTab.category,
          result: selectedTab.result,
          from: getDateRangeStart(dateRange),
        })
        setEntries(res.items)
        setTotalPages(res.meta.totalPages)
        setTotal(res.meta.total)
      } catch {
        setEntries([])
      } finally {
        setLoading(false)
      }
    },
    [q, dateRange, selectedTab],
  )

  useEffect(() => {
    fetch(page)
  }, [page, fetch])

  const handleSearch = () => {
    setPage(1)
    fetch(1)
  }

  const selectTab = (tab: ActivityTab["id"]) => {
    setActiveTab(tab)
    setPage(1)
  }

  const handleExport = () => {
    const escape = (value: string | null | undefined) => `"${(value ?? "").replace(/"/g, '""')}"`
    const rows = entries.map((entry) => [
      formatTimestamp(entry.timestamp),
      actionLabel(entry.action),
      entry.category,
      entry.result,
      entry.targetName,
      entry.ipAddress,
      entry.description,
    ].map(escape).join(","))
    const csv = ["Timestamp,Action,Category,Result,Target,IP Address,Description", ...rows].join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "my-activity.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="content-padding section-stack">
      <PageHeader
        title="My Activity"
        description={`Your recent activity across URS-DMS${total > 0 ? ` · ${total} entries` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            <Select value={dateRange} onValueChange={(value) => { setDateRange(value); setPage(1) }}>
              <SelectTrigger className="h-9 w-[132px] rounded-lg px-3 text-xs">
                <CalendarDays className="mr-1.5 size-3.5" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Past 7 Days</SelectItem>
                <SelectItem value="30">Past 30 Days</SelectItem>
                <SelectItem value="90">Past 90 Days</SelectItem>
                <SelectItem value="all">All Time</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleExport} className="h-9 rounded-lg px-3 text-xs" disabled={entries.length === 0}>
              <Download className="mr-1.5 size-3.5" />
              Export CSV
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-1 overflow-x-auto border-b border-slate-200 pb-4 dark:border-slate-800">
        {ACTIVITY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => selectTab(tab.id)}
            className={cn(
              "h-8 rounded-full px-4 text-xs font-medium whitespace-nowrap transition-colors",
              activeTab === tab.id
                ? "bg-primary text-white shadow-soft shadow-primary/20"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search activity, IP address, or event..."
            className="h-9 border-slate-200 bg-white pl-8 text-sm shadow-none placeholder:text-slate-400 hover:border-slate-300 focus:bg-white dark:bg-slate-900"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
      </div>

      {loading ? (
        <div className="py-20 text-center text-[13px] text-gray-500">
          <div className="w-6 h-6 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          Loading activity...
        </div>
      ) : entries.length === 0 ? (
        <div className="py-20 text-center">
          <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-[13px] text-gray-500">No activity found</p>
          <p className="text-[12px] text-gray-400 mt-1">
            {q || activeTab !== "all" ? "Try adjusting your filters." : "Your actions will appear here as you use URS-DMS."}
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {entries.map((entry) => (
              <Card
                key={entry.id}
                className={cn(
                  "cursor-pointer border-slate-200/80 bg-white shadow-xs transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700",
                  detailId === entry.id && "ring-2 ring-[#2563EB]",
                )}
                onClick={() => setDetailId(detailId === entry.id ? null : entry.id)}
              >
                <CardContent className="p-4 sm:px-4 sm:py-3 md:px-4 md:py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex-shrink-0">
                        {RESULT_BADGES[entry.result] && (
                          <span className={cn("inline-flex size-8 items-center justify-center rounded-lg", RESULT_BADGES[entry.result].color)}>
                            {RESULT_BADGES[entry.result].icon}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                          {actionLabel(entry.action)}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">
                          {formatTimestamp(entry.timestamp)}
                          {entry.targetName && <span> &middot; {entry.targetName}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {entry.category && (
                        <Badge variant="secondary" className={cn("border px-2 py-0.5 text-[10px] font-medium", CATEGORY_COLORS[entry.category] ?? "bg-gray-50 text-gray-600")}>
                          {entry.category.replace(/_/g, " ")}
                        </Badge>
                      )}
                      <Badge variant={entry.result === "SUCCESS" ? "success" : entry.result === "FAILED" ? "danger" : "warning"} className="gap-1 px-2 py-0.5 text-[10px] font-medium">
                        <span className="size-1 rounded-full bg-current" />
                        {entry.result === "DENIED" ? "Denied" : entry.result}
                      </Badge>
                      <ChevronRight className={cn("size-4 text-slate-400 transition-transform", detailId === entry.id && "rotate-90")} />
                    </div>
                  </div>
                  {detailId === entry.id && (
                    <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px]">
                      <div>
                        <p className="text-gray-400">Action</p>
                        <p className="text-gray-700 font-medium">{actionLabel(entry.action)}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Category</p>
                        <p className="text-gray-700">{entry.category || "—"}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Result</p>
                        <p className="text-gray-700">{entry.result}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Timestamp</p>
                        <p className="text-gray-700">{formatTimestamp(entry.timestamp)}</p>
                      </div>
                      {entry.targetType && (
                        <div>
                          <p className="text-gray-400">Target</p>
                          <p className="text-gray-700">{entry.targetType}{entry.targetId ? `: ${entry.targetId.slice(0, 8)}...` : ""}</p>
                        </div>
                      )}
                      {entry.ipAddress && (
                        <div>
                          <p className="text-gray-400">IP Address</p>
                          <p className="text-gray-700">{entry.ipAddress}</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 pt-2 dark:border-slate-800">
              <p className="text-xs text-slate-500">
                Showing {entries.length} of {total} entries
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 rounded-md px-2 text-xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span className="flex size-8 items-center justify-center rounded-md bg-primary text-xs font-medium text-white">{page}</span>
                <Button variant="outline" size="sm" className="h-8 rounded-md px-2 text-xs" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
