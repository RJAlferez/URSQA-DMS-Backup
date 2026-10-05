import { useState, useEffect, useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import {
  CheckCircle,
  XCircle,
  Search,
  FileText,
  Inbox,
  RefreshCw,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { StatCard } from "@/components/layout/StatCard"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Badge } from "@/components/ui/Badge"
import { Avatar, AvatarFallback } from "@/components/ui/Avatar"
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
import { Label } from "@/components/ui/Label"
import { Textarea } from "@/components/ui/Textarea"
import { EmptyState } from "@/components/ui/EmptyState"
import { listRequests, handleRequest } from "@/services/requests"
import type { DocumentRequest } from "@/types/domain"
import { cn } from "@/lib/utils"

// =============================================================================
// RequestsReview — admin review surface for user file requests (Sprint).
// Managers (request.manage) see every request and can Approve (optional note)
// or Reject (reason required). One request may contain up to 3 files.
// =============================================================================

const statusVariant: Record<string, "success" | "warning" | "danger" | "secondary"> = {
  Pending: "warning",
  Approved: "success",
  Fulfilled: "success",
  Rejected: "danger",
}

function getStatusBadge(status: string) {
  return <Badge variant={statusVariant[status] ?? "secondary"}>{status}</Badge>
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

type DecisionKind = "Approved" | "Rejected" | null

export default function RequestsReview() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [requests, setRequests] = useState<DocumentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const initialStatus = searchParams.get("status")
  const highlightId = searchParams.get("highlight")
  const [statusFilter, setStatusFilter] = useState<string>(
    initialStatus === "PENDING" ? "Pending" : initialStatus === "APPROVED" ? "Approved" : initialStatus === "FULFILLED" ? "Fulfilled" : initialStatus === "REJECTED" ? "Rejected" : "all",
  )
  const [searchQuery, setSearchQuery] = useState("")
  const [target, setTarget] = useState<DocumentRequest | null>(null)
  const [decision, setDecision] = useState<DecisionKind>(null)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRequests(await listRequests())
    } catch {
      setRequests([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const status = searchParams.get("status")
    if (!status) { setStatusFilter("all"); return }
    if (status === "PENDING") setStatusFilter("Pending")
    else if (status === "APPROVED") setStatusFilter("Approved")
    else if (status === "FULFILLED") setStatusFilter("Fulfilled")
    else if (status === "REJECTED") setStatusFilter("Rejected")
  }, [searchParams])

  useEffect(() => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous)
      if (statusFilter === "all") next.delete("status")
      else next.set("status", statusFilter === "Pending" ? "PENDING" : statusFilter === "Approved" ? "APPROVED" : statusFilter === "Fulfilled" ? "FULFILLED" : "REJECTED")
      return next
    }, { replace: true })
  }, [statusFilter, setSearchParams])

  const filtered = requests.filter((r) => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false
    if (searchQuery && !r.title.toLowerCase().includes(searchQuery.toLowerCase()) && !r.submittedByName.toLowerCase().includes(searchQuery.toLowerCase())) return false
    return true
  })

  const pendingCount = requests.filter((r) => r.status === "Pending").length
  const approvedCount = requests.filter((r) => r.status === "Approved").length
  const rejectedCount = requests.filter((r) => r.status === "Rejected").length

  const openDecision = (request: DocumentRequest, kind: Exclude<DecisionKind, null>) => {
    setTarget(request)
    setDecision(kind)
    setNote("")
    setError("")
  }

  const closeDecision = () => {
    setTarget(null)
    setDecision(null)
    setNote("")
    setError("")
  }

  const submitDecision = async () => {
    if (!target || !decision) return
    setError("")
    if (decision === "Rejected" && !note.trim()) {
      setError("A reason is required when rejecting a request")
      return
    }
    setSaving(true)
    try {
      await handleRequest(target.id, decision, decision === "Rejected" ? note.trim() : (note.trim() || undefined))
      closeDecision()
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update the request")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="content-padding">
      <PageHeader
        title="File Requests"
        description="Approve or reject document access requests from users."
        actions={
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 responsive-gap mb-6 lg:mb-8">
        <StatCard title="All Requests" value={String(requests.length)} icon={<Inbox className="w-5 h-5" />} />
        <StatCard
          title="Pending"
          value={String(pendingCount)}
          icon={<FileText className="w-5 h-5" />}
          trend={{
            value: requests.length > 0 ? Math.round((pendingCount / requests.length) * 100) : 0,
            positive: false,
          }}
        />
        <StatCard
          title="Approved"
          value={String(approvedCount)}
          icon={<CheckCircle className="w-5 h-5" />}
          trend={{
            value: requests.length > 0 ? Math.round((approvedCount / requests.length) * 100) : 0,
            positive: approvedCount > 0,
          }}
        />
        <StatCard title="Rejected" value={String(rejectedCount)} icon={<XCircle className="w-5 h-5" />} />
      </div>

      <Card className="border-border/70 shadow-soft mb-6">
        <CardContent className="p-0">
          <div className="toolbar-padding flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="flex-1">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search requests or requesters..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 h-9 bg-gray-50/50 border-0 hover:bg-gray-100 focus:bg-white focus:ring-1.5 focus:ring-gray-200"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px] h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Approved">Approved</SelectItem>
                <SelectItem value="Fulfilled">Fulfilled</SelectItem>
                <SelectItem value="Rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-soft">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Requester</TableHead>
                <TableHead>Files</TableHead>
                <TableHead>Explanation</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      variant="search"
                      title="No requests found"
                      description="Requests from users will appear here for review"
                    />
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((request) => (
                  <TableRow key={request.id} className={cn("hover:bg-gray-50/50 transition-colors align-top", request.id === highlightId && "bg-primary-50 ring-1 ring-inset ring-blue-300")}>
                  <TableCell>
                    <div>
                      <p className="text-[14px] font-medium text-gray-900 max-w-[220px] truncate">{request.title}</p>
                      <p className="text-[12px] text-gray-500">{request.id}</p>
                      {request.handledByName && (
                        <p className="text-[11px] text-gray-400 mt-1">
                          by {request.handledByName}
                          {request.remarks ? ` — ${request.remarks}` : ""}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px] bg-gray-100 text-gray-600">
                          {(request.submittedByName || "U").split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="text-[13px] text-gray-700">{request.submittedByName}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {request.documents.length === 0 && <span className="text-[12px] text-gray-400">—</span>}
                      {request.documents.map((doc) => (
                        <span key={doc.documentId} className="text-[12px] text-gray-600 max-w-[180px] truncate">
                          {doc.documentName}
                        </span>
                      ))}
                      {request.documents.length > 1 && (
                        <Badge variant="secondary" className="w-fit text-[10px]">
                          {request.documents.length} files
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="text-[12px] text-gray-600 max-w-[260px] line-clamp-3">{request.purpose}</p>
                  </TableCell>
                  <TableCell>
                    <span className="text-[13px] text-gray-500">{formatDate(request.dateSubmitted)}</span>
                  </TableCell>
                  <TableCell>{getStatusBadge(request.status)}</TableCell>
                  <TableCell className="text-right">
                    {request.status === "Pending" ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-emerald-600 hover:bg-emerald-50"
                          title="Approve"
                          onClick={() => openDecision(request, "Approved")}
                        >
                          <CheckCircle className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-600 hover:bg-red-50"
                          title="Reject"
                          onClick={() => openDecision(request, "Rejected")}
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[12px] text-gray-400">
                        {request.status === "Approved" ? "Reviewed" : "Closed"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {loading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-gray-400 text-[13px] py-8">
                    Loading requests...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <div className="table-footer">
            <p className="text-[13px] text-gray-500">
              Showing {filtered.length} of {requests.length} requests
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(target && decision)} onOpenChange={(open) => !open && closeDecision()}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className={cn("flex items-center gap-2")}>
              {decision === "Approved" ? (
                <CheckCircle className="w-5 h-5 text-emerald-500" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500" />
              )}
              {decision === "Approved" ? "Approve Request" : "Reject Request"}
            </DialogTitle>
            <DialogDescription className="text-[14px]">
              {target?.title} — {target?.submittedByName}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {target && target.documents.length > 0 && (
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">
                  Requested Files ({target.documents.length})
                </p>
                <div className="flex flex-col gap-1">
                  {target.documents.map((doc) => (
                    <p key={doc.documentId} className="text-[13px] text-gray-700 truncate">
                      {doc.documentName}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {error && (
              <div className="text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="decisionNote" className="text-[13px] font-medium text-gray-700">
                {decision === "Approved" ? "Note" : "Reason"} {decision === "Rejected" && <span className="text-red-500">*</span>}
              </Label>
              <Textarea
                id="decisionNote"
                placeholder={
                  decision === "Rejected"
                    ? "Explain why the request is being rejected (required)"
                    : "Optional note for the requester"
                }
                className="min-h-[100px] resize-none"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeDecision} className="h-10 px-5">
              Cancel
            </Button>
            <Button
              onClick={() => void submitDecision()}
              disabled={saving || (decision === "Rejected" && !note.trim())}
              className={cn("h-10 px-5 shadow-soft", decision === "Approved" && "bg-emerald-600 hover:bg-emerald-700")}
            >
              {saving ? "Saving..." : decision === "Approved" ? "Approve Request" : "Reject Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
