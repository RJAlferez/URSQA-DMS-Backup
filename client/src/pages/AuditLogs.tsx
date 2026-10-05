import { useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import {
  Search,
  Download,
  RotateCcw,
  Activity,
  CheckCircle,
  XCircle,
  Trash2,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { StatCard } from "@/components/layout/StatCard"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Badge } from "@/components/ui/Badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import { Avatar, AvatarFallback } from "@/components/ui/Avatar"
import { ExportLogsModal } from "@/components/modals/ExportLogsModal"
import { listAuditEntries, exportAuditEntries, clearAuditLogs, type AuditEntry } from "@/services/admin"
import { apiGet } from "@/lib/http"
import { useAuth } from "@/context/AuthContext"
import { isRootRole } from "@/lib/permissions"
import { toast } from "@/lib/toast"

interface AuditLog {
  id: string
  timestamp: string
  user: string
  userRole: string
  initials: string
  action: string
  module: string
  ipAddress: string
  status: "Success" | "Warning" | "Failed" | "Denied"
  details: string
  device: string
  browser: string
  os: string
  category: string
  severity: string
  result: string
}

interface LoginGroup {
  ipAddress: string
  count: number
  firstAttempt: string
  lastAttempt: string
  items: AuditEntry[]
}

const PRESETS = [
  { label: "Today", params: {} as Record<string, string> },
  { label: "Last 7 Days", params: {} as Record<string, string> },
  { label: "Last 30 Days", params: {} as Record<string, string> },
  { label: "Login Activity", params: { category: "AUTHENTICATION" } },
  { label: "Failed Security", params: { category: "SECURITY", result: "FAILED" } },
  { label: "Submissions", params: { category: "SUBMISSION" } },
  { label: "Requests", params: { category: "REQUEST" } },
  { label: "Role/Permission", params: { category: "ACCESS_CONTROL" } },
  { label: "Critical Events", params: { severity: "CRITICAL" } },
]

export default function AuditLogs() {
  const { user } = useAuth()
  // Clearing the audit trail is a ROOT-only destructive action (server gate
  // matches); hiding the control keeps the UI aligned with the backend.
  const canClearLogs = isRootRole(user?.role)
  const [searchParams, setSearchParams] = useSearchParams()
  const [isExportLogsModalOpen, setIsExportLogsModalOpen] = useState(() => searchParams.get("modal") === "generate-report")
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [successTotal, setSuccessTotal] = useState(0)
  const [failedTotal, setFailedTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [activePreset, setActivePreset] = useState("")
  const [reloadKey, setReloadKey] = useState(0)
  const [loginGroups, setLoginGroups] = useState<LoginGroup[]>([])
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  const [showLoginGroups, setShowLoginGroups] = useState(false)

  const PAGE_SIZE = 50
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const rangeEnd = Math.min(page * PAGE_SIZE, total)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery)
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [searchQuery])

  function getPresetDates(label: string) {
    const now = new Date()
    if (label === "Today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      return { from: start.toISOString(), to: now.toISOString() }
    }
    if (label === "Last 7 Days") {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return { from: start.toISOString(), to: now.toISOString() }
    }
    if (label === "Last 30 Days") {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      return { from: start.toISOString(), to: now.toISOString() }
    }
    return null
  }

  function toAuditLog(entry: AuditEntry): AuditLog {
    const name = entry.actorName || entry.user?.name || "Unknown"
    return {
      id: entry.id,
      timestamp: new Date(entry.timestamp).toLocaleString(),
      user: name,
      userRole: entry.actorRole || entry.user?.role || "-",
      initials: name === "Unknown" ? "??" : name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase(),
      action: entry.action,
      module: entry.module,
      ipAddress: entry.ipAddress ?? "—",
      status: entry.status === "FAILED" ? "Failed" : entry.status === "DENIED" ? "Denied" : "Success",
      details: entry.entity?.type ? `${entry.entity.type} ${entry.entity.id ?? ""}`.trim() : "No additional details",
      device: "",
      browser: "",
      os: "",
      category: entry.category || "",
      severity: entry.severity || "",
      result: entry.result || "",
    }
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const preset = PRESETS.find((p) => p.label === activePreset)
    const dates = getPresetDates(activePreset)

    const loadPage = async () => {
      try {
        const result = await listAuditEntries({
          page,
          pageSize: PAGE_SIZE,
          q: debouncedQuery || undefined,
          action: actionFilter !== "all" ? actionFilter : undefined,
          status: statusFilter === "all" ? undefined : statusFilter === "success" ? "SUCCESS" : "FAILED",
          from: dates?.from,
          to: dates?.to,
          ...preset?.params,
        })
        if (cancelled) return
        setLogs(result.items.map(toAuditLog))
        setTotal(result.meta.total)
        if (result.meta.total > 0 && page > Math.max(1, Math.ceil(result.meta.total / PAGE_SIZE))) {
          setPage(Math.max(1, Math.ceil(result.meta.total / PAGE_SIZE)))
        }
      } catch {
        if (!cancelled) {
          setLogs([])
          setTotal(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadPage()

    return () => { cancelled = true }
  }, [debouncedQuery, actionFilter, statusFilter, activePreset, page, reloadKey])

  useEffect(() => {
    let cancelled = false
    const preset = PRESETS.find((p) => p.label === activePreset)
    const dates = getPresetDates(activePreset)
    const query = {
      page: 1,
      pageSize: 1,
      q: debouncedQuery || undefined,
      action: actionFilter !== "all" ? actionFilter : undefined,
      status: statusFilter === "all" ? undefined : statusFilter === "success" ? "SUCCESS" : "FAILED",
      from: dates?.from,
      to: dates?.to,
      ...preset?.params,
    }
    listAuditEntries({ ...query, status: "SUCCESS" })
      .then((res) => { if (!cancelled) setSuccessTotal(res.meta.total) })
      .catch(() => {})
    listAuditEntries({ ...query, status: "FAILED" })
      .then((res) => { if (!cancelled) setFailedTotal(res.meta.total) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [debouncedQuery, actionFilter, statusFilter, activePreset, reloadKey])

  const loadLoginGroups = async () => {
    try {
      const groups = await apiGet<LoginGroup[]>("/audit/login-groups?withinMinutes=10&minAttempts=3")
      setLoginGroups(groups ?? [])
      setShowLoginGroups(true)
    } catch { /* ignore */ }
  }

  const handlePreset = (label: string) => {
    if (activePreset === label) {
      setActivePreset("")
      setActionFilter("all")
      setStatusFilter("all")
    } else {
      setActivePreset(label)
      setActionFilter("all")
      setStatusFilter("all")
    }
    setPage(1)
  }

  const handleResetFilters = () => {
    setSearchQuery("")
    setActionFilter("all")
    setStatusFilter("all")
    setActivePreset("")
    setPage(1)
  }

  const handleClearLogs = async () => {
    setClearing(true)
    try {
      const cleared = await clearAuditLogs()
      toast.success(`Cleared ${cleared.toLocaleString()} audit log${cleared === 1 ? "" : "s"}`)
      setIsClearDialogOpen(false)
      handleResetFilters()
      setReloadKey((k) => k + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to clear audit logs")
    } finally { setClearing(false) }
  }

  const handleExportCSV = async () => {
    try {
      const dates = getPresetDates(activePreset)
      const result = await exportAuditEntries("csv", {
        q: searchQuery || undefined,
        action: actionFilter !== "all" ? actionFilter : undefined,
        status: statusFilter === "all" ? undefined : statusFilter === "success" ? "SUCCESS" : "FAILED",
        from: dates?.from,
        to: dates?.to,
      })
      const blob = new Blob([result.data], { type: "text/csv" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = result.filename; a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${result.count} records`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed")
    }
  }

  return (
    <div className="content-padding">
      <PageHeader
        title="Audit Logs"
        description="Track and monitor all system activities and user actions."
        actions={
          <>
            <Button variant="outline" onClick={() => loadLoginGroups()}>
              <ShieldAlert className="w-4 h-4 mr-2" />
              Failed Login Groups
            </Button>
            <Button variant="outline" onClick={handleExportCSV}>
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            {canClearLogs && (
              <Button variant="destructive" onClick={() => setIsClearDialogOpen(true)}>
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Logs
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <StatCard title="Total Activities" value={total.toLocaleString()} icon={<Activity className="w-5 h-5" />} />
        <StatCard title="Successful Actions" value={successTotal.toLocaleString()} icon={<CheckCircle className="w-5 h-5" />} />
        <StatCard title="Failed Actions" value={failedTotal.toLocaleString()} icon={<XCircle className="w-5 h-5" />} />
      </div>

      <div className="flex flex-wrap gap-1.5 mb-4">
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            variant={activePreset === p.label ? "default" : "outline"}
            size="sm"
            className="h-7 text-[11px]"
            onClick={() => handlePreset(p.label)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <Card className="border-border/70 shadow-soft mb-6">
        <CardContent className="p-0">
          <div className="toolbar-padding flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex-1">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search activities..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-9 bg-gray-50/50 border-0 hover:bg-gray-100 focus:bg-white focus:ring-1.5 focus:ring-gray-200"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1) }}>
                <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Action Type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Actions</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="upload">Upload</SelectItem>
                  <SelectItem value="edit">Edit</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="approve">Approve</SelectItem>
                  <SelectItem value="reject">Reject</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
                <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-9" onClick={handleResetFilters}>
                <RotateCcw className="w-4 h-4 mr-2" />Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {showLoginGroups && loginGroups.length > 0 && (
        <Card className="border-border/70 shadow-soft mb-6">
          <CardContent className="p-5 md:p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[14px] font-semibold text-gray-900">Failed Login Groups</h3>
              <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setShowLoginGroups(false)}>
                Hide
              </Button>
            </div>
            {loginGroups.map((g) => (
              <div key={g.ipAddress} className="border border-gray-100 rounded-md mb-2">
                <button
                  className="w-full flex items-center justify-between p-3 hover:bg-gray-50 text-left"
                  onClick={() => setExpandedGroup(expandedGroup === g.ipAddress ? null : g.ipAddress)}
                >
                  <div>
                    <span className="text-[13px] font-medium text-gray-900">Failed Login Attempts</span>
                    <span className="ml-2 text-[12px] text-gray-500">{g.ipAddress}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[12px] text-gray-500">
                    <Badge variant="warning" className="text-[11px]">{g.count} attempts</Badge>
                    <span className="hidden sm:inline">
                      {new Date(g.firstAttempt).toLocaleTimeString()} — {new Date(g.lastAttempt).toLocaleTimeString()}
                    </span>
                    {expandedGroup === g.ipAddress ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>
                {expandedGroup === g.ipAddress && (
                  <div className="border-t border-gray-100 p-2 bg-gray-50/50">
                    {g.items.slice(0, 20).map((e) => (
                      <div key={e.id} className="flex items-center justify-between px-3 py-1.5 text-[12px] text-gray-600">
                        <span className="font-mono">{new Date(e.timestamp).toLocaleTimeString()}</span>
                        <span className="text-red-600 font-medium">LOGIN_FAILED</span>
                        <span>{e.user?.name || "Unknown"}</span>
                        <span className="text-gray-400">{e.ipAddress}</span>
                      </div>
                    ))}
                    {g.count > 20 && (
                      <p className="text-[11px] text-gray-400 px-3 py-1">+{g.count - 20} more entries</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border-border/70 shadow-soft">
        <CardContent className="p-0">
          <div className="max-h-[70vh] overflow-y-auto">
          <Table>
            <TableHeader className="bg-white">
              <TableRow>
                <TableHead className="w-[170px]">Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Module</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && logs.length === 0 ? (
                 <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500 text-[14px]">Loading audit logs...</TableCell></TableRow>
              ) : logs.length === 0 ? (
                 <TableRow><TableCell colSpan={7} className="text-center py-8 text-gray-500 text-[14px]">No audit logs found</TableCell></TableRow>
              ) : loading ? (
                 <TableRow><TableCell colSpan={7} className="text-center py-4 text-gray-400 text-[13px]">Loading page...</TableCell></TableRow>
              ) : logs.map((log) => (
                <TableRow key={log.id} className="hover:bg-gray-50/50 transition-colors">
                  <TableCell><span className="text-[13px] text-gray-600 font-mono">{log.timestamp}</span></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-[11px] bg-gray-100 text-gray-700 font-medium">{log.initials}</AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-[14px] font-medium text-gray-900">{log.user}</p>
                        <p className="text-[11px] text-gray-500">{log.userRole}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><span className="inline-flex items-center px-2.5 py-1 rounded-md text-[12px] font-medium bg-gray-50 text-gray-600">{log.action}</span></TableCell>
                  <TableCell><span className="text-[13px] text-gray-600">{log.module}</span></TableCell>
                  <TableCell>{log.category ? <Badge variant="secondary" className="text-[11px]">{log.category}</Badge> : "—"}</TableCell>
                  <TableCell><span className="text-[13px] text-gray-500 font-mono">{log.ipAddress}</span></TableCell>
                  <TableCell>
                    <Badge
                      variant={log.result === "SUCCESS" ? "success" : log.result === "FAILED" ? "danger" : log.result === "DENIED" ? "warning" : "secondary"}
                      className="font-medium text-[11px]"
                    >
                      {log.result || log.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
          <div className="table-footer">
            <p className="text-[13px] text-gray-500">
              {total === 0 ? `0 of 0 logs` : `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${total.toLocaleString()} logs`}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[12px]"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-[12px] text-gray-500 whitespace-nowrap">Page {page.toLocaleString()} of {totalPages.toLocaleString()}</span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-[12px]"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ExportLogsModal open={isExportLogsModalOpen} onOpenChange={(open: boolean) => { setIsExportLogsModalOpen(open); if (!open) { searchParams.delete("modal"); setSearchParams(searchParams) } }} />

      <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-lg">Clear Audit Logs</DialogTitle>
            <DialogDescription className="text-[14px]">This will permanently delete every audit log entry. This action cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" className="h-9" onClick={() => setIsClearDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" className="h-9" disabled={clearing} onClick={() => void handleClearLogs()}>
              {clearing ? "Clearing..." : "Clear Logs"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
