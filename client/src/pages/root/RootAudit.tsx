import { useEffect, useState, useCallback } from "react"
import { Search, RefreshCw, ScrollText } from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
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
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/Pagination"
import { listSystemAudit, type RootAuditEntry } from "@/services/root"

const PAGE_SIZE = 15

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

const SEV_BADGES: Record<string, "success" | "warning" | "danger" | "default"> = {
  INFO: "success",
  WARNING: "warning",
  CRITICAL: "danger",
}

export default function RootAudit() {
  const [entries, setEntries] = useState<RootAuditEntry[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState("")
  const [module, setModule] = useState("all")
  const [status, setStatus] = useState("all")
  const [activePreset, setActivePreset] = useState("")
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
    const preset = PRESETS.find((p) => p.label === activePreset)
    const result = await listSystemAudit({
        page,
        pageSize: PAGE_SIZE,
        q: search.trim() || undefined,
        module: module === "all" ? undefined : module,
        status: status === "all" ? undefined : status,
        ...preset?.params,
      } as Parameters<typeof listSystemAudit>[0])
      setEntries(result.items)
      setTotal(result.meta.total)
      setTotalPages(Math.max(1, result.meta.totalPages))
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [page, search, module, status, activePreset])

  useEffect(() => {
    void load()
  }, [load])

  const handlePreset = (label: string) => {
    if (activePreset === label) {
      setActivePreset("")
    } else {
      setActivePreset(label)
      setPage(1)
    }
  }

  return (
    <div className="content-padding">
      <PageHeader
        title="System Audit"
        description="Full platform audit trail"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} className="shadow-soft">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        }
      />

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

      <Card className="border-border/70 shadow-soft mb-4">
        <CardContent className="toolbar-padding flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              className="h-10 pl-9"
              placeholder="Search actions, users, entities…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <Select value={module} onValueChange={(v) => { setModule(v); setPage(1) }}>
            <SelectTrigger className="h-10 w-full sm:w-[160px]">
              <SelectValue placeholder="Module" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modules</SelectItem>
              <SelectItem value="auth">auth</SelectItem>
              <SelectItem value="root">root</SelectItem>
              <SelectItem value="configuration">configuration</SelectItem>
              <SelectItem value="admin">admin</SelectItem>
              <SelectItem value="documents">documents</SelectItem>
              <SelectItem value="requests">requests</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
            <SelectTrigger className="h-10 w-full sm:w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="SUCCESS">Success</SelectItem>
              <SelectItem value="FAILURE">Failure</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-soft">
        <CardContent className="p-0">
          {loading ? (
            <div className="min-h-[280px] flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-gray-500">
              <ScrollText className="w-6 h-6 mx-auto mb-2 text-gray-300" />
              No audit entries found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(entries as RootAuditEntry[]).map((entry) => {
                  const e = entry
                  return (
                  <TableRow key={entry.id}>
                    <TableCell className="text-[12px] text-gray-500 whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-[13px] font-medium text-gray-900 max-w-[180px] truncate">
                      {entry.action}
                    </TableCell>
                    <TableCell>
                      {e.category ? (
                        <Badge variant="secondary" className="text-[11px]">{e.category}</Badge>
                      ) : (
                        <Badge variant="secondary">{entry.module}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {e.severity ? (
                        <Badge variant={SEV_BADGES[e.severity] ?? "default"} className="text-[11px]">{e.severity}</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-[13px] text-gray-600">
                      {entry.user ? (
                        <div>
                          <div>{e.actorName || entry.user.name}</div>
                          <div className="text-[11px] text-gray-400">{e.actorRole || entry.user.role}</div>
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-[13px] text-gray-600">
                      {entry.entity ? (
                        <div>
                          <div>{entry.entity.type}</div>
                          <div className="text-[11px] text-gray-400 truncate max-w-[120px]">
                            {e.targetName || entry.entity.id}
                          </div>
                        </div>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          e.result === "SUCCESS" ? "success"
                          : e.result === "FAILED" ? "danger"
                          : e.result === "DENIED" ? "warning"
                          : entry.status === "SUCCESS" ? "success"
                          : entry.status === "FAILURE" ? "danger"
                          : "default"
                        }
                        className="text-[11px]"
                      >
                        {e.result || entry.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )})}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <div className="table-footer">
          <span className="text-[12px] text-gray-500">{total} entries</span>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={page <= 1 ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
              <PaginationItem><PaginationLink isActive>{page}</PaginationLink></PaginationItem>
              <PaginationItem>
                <PaginationNext
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          <span className="text-[12px] text-gray-500">page {page} of {totalPages}</span>
        </div>
      </Card>
    </div>
  )
}
