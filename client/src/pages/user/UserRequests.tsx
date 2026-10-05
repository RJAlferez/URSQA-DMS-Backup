import { useState, useEffect, useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { Search, FileText, FilePlus, FolderArchive, Eye, XCircle, FileCheck2, CalendarDays, Paperclip } from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Badge } from "@/components/ui/Badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import { toast } from "@/lib/toast"
import { useAuth } from "@/context/AuthContext"
import { listRequests, cancelRequest } from "@/services/requests"
import type { DocumentRequest } from "@/types/domain"
import { cn } from "@/lib/utils"

const getStatusBadge = (status: string) => {
  switch (status) {
    case "Approved": return <Badge variant="success">{status}</Badge>
    case "Fulfilled": return <Badge variant="default">{status}</Badge>
    case "Rejected": return <Badge variant="danger">{status}</Badge>
    case "Pending": return <Badge variant="warning">{status}</Badge>
    default: return <Badge variant="secondary">{status}</Badge>
  }
}

const getPriorityBadge = (priority: string) => {
  switch (priority) {
    case "Urgent": return <Badge variant="high">{priority}</Badge>
    case "Normal": return <Badge variant="low">{priority}</Badge>
    default: return <Badge variant="secondary">{priority}</Badge>
  }
}

interface UserRequestsProps {
  onBrowseArchive?: () => void
}

const REQUESTS_TABS = ["all", "pending", "approved", "fulfilled", "rejected"] as const
type RequestsTab = (typeof REQUESTS_TABS)[number]
const isRequestsTab = (value: string | null): value is RequestsTab =>
  !!value && (REQUESTS_TABS as readonly string[]).includes(value)

export default function UserRequests({ onBrowseArchive }: UserRequestsProps) {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [requests, setRequests] = useState<DocumentRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const highlightId = searchParams.get("highlight")
  const [selected, setSelected] = useState<DocumentRequest | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      const data = await listRequests({ submittedBy: user.id })
      setRequests(data)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { void refresh() }, [refresh])

  // URL query param is the single source of truth for the active filter tab.
  // The URL is updated directly in the click handler (replace:true), so the
  // page can never snap back to a stale "last selected" tab.
  const activeTab: RequestsTab = isRequestsTab(searchParams.get("tab")) ? searchParams.get("tab") as RequestsTab : "all"

  const selectTab = (tab: RequestsTab) => {
    const next = new URLSearchParams(searchParams)
    if (tab === "all") next.delete("tab")
    else next.set("tab", tab)
    setSearchParams(next, { replace: true })
  }

  const filteredRequests = requests.filter((req) => {
    const matchesSearch = req.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      req.purpose.toLowerCase().includes(searchQuery.toLowerCase())
    const tabMap: Record<string, string> = { pending: "Pending", approved: "Approved", fulfilled: "Fulfilled", rejected: "Rejected" }
    const matchesTab = activeTab === "all" || req.status === tabMap[activeTab]
    return matchesSearch && matchesTab
  })

  const handleCancel = async (request: DocumentRequest) => {
    if (!window.confirm(`Cancel request "${request.title}"?`)) return
    setCancelling(true)
    try {
      await cancelRequest(request.id)
      toast.success("Request cancelled")
      setSelected(null)
      await refresh()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to cancel the request")
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="content-padding">
      <PageHeader
        title="My Requests"
        description="Track and manage your document access and issuance requests"
        actions={
          <Button onClick={onBrowseArchive} className="h-9 rounded-lg px-4 text-xs">
            <FilePlus className="mr-2 size-3.5" />
            Request Files
          </Button>
        }
      />

      <div className="mb-5 flex items-center gap-1 overflow-x-auto border-b border-slate-200 pb-4 dark:border-slate-800">
        {REQUESTS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => selectTab(tab)}
            className={cn(
              "h-8 rounded-full px-4 text-xs font-medium transition-colors whitespace-nowrap",
              activeTab === tab
                ? "bg-primary text-white shadow-soft shadow-primary/20"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800",
            )}
          >
            {tab === "all" ? "All" : tab === "pending" ? "Pending" : tab === "approved" ? "Approved" : tab === "fulfilled" ? "Fulfilled" : "Rejected"}
          </button>
        ))}
      </div>

      <div className="relative mb-4 max-w-none">
        <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Search requests by title, keyword, or reference number..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 border-slate-200 bg-white pl-8 text-xs shadow-none placeholder:text-slate-400 hover:border-slate-300 focus:bg-white dark:bg-slate-900"
        />
      </div>

      {loading ? (
        <Card className="border-border/70 shadow-soft">
          <CardContent className="p-8 text-center">
            <p className="text-[14px] text-gray-500">Loading requests...</p>
          </CardContent>
        </Card>
      ) : filteredRequests.length === 0 ? (
        <Card className="border-border/70 shadow-soft">
          <CardContent className="p-8 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-[14px] text-gray-500 mb-4">No requests found</p>
            <Button variant="outline" onClick={onBrowseArchive}>
              <FolderArchive className="w-4 h-4 mr-2" />
              Browse Archive
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filteredRequests.map((request) => (
              <Card key={request.id} className={cn("border-slate-200/80 bg-white shadow-xs transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700", request.id === highlightId && "ring-2 ring-blue-300 bg-primary-50")}>
               <CardContent className="p-4 sm:px-4 sm:py-3.5 md:px-4 md:py-3.5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <FileText className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">{request.title}</h3>
                      <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">Explanation: {request.purpose}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400 dark:text-slate-500">
                        <span className="inline-flex items-center gap-1"><CalendarDays className="size-3" />Submitted: {new Date(request.dateSubmitted).toLocaleDateString()}</span>
                        <span className="text-slate-300">•</span>
                        <span className="inline-flex items-center gap-1">Priority: {getPriorityBadge(request.priority)}</span>
                        {request.documents.length > 0 && (
                          <>
                            <span className="text-slate-300">•</span>
                            <span className="inline-flex items-center gap-1">
                              <Paperclip className="size-3" />
                              {request.documents.length} file{request.documents.length > 1 ? "s" : ""}
                            </span>
                          </>
                        )}
                      </div>
                      {request.remarks && request.status === "Rejected" && (
                        <p className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
                          Decision: {request.remarks}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
                    {getStatusBadge(request.status)}
                    <Button variant="ghost" size="icon" className="size-7 text-slate-400 hover:text-slate-700" title="View details" onClick={() => setSelected(request)}>
                      <Eye className="size-3.5" />
                    </Button>
                    {request.status === "Pending" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-red-500 hover:bg-red-50"
                        title="Cancel request"
                        onClick={() => void handleCancel(request)}
                      >
                        <XCircle className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 px-1 text-[11px] text-slate-400 dark:text-slate-500">
        <p>Showing {filteredRequests.length} of {requests.length} requests</p>
        <p className="hidden sm:block">Request status updates appear here after refresh.</p>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-[540px]">
          <DialogHeader>
            <DialogTitle className="text-lg">{selected?.title}</DialogTitle>
            <DialogDescription className="text-[14px]">
              Submitted {selected ? new Date(selected.dateSubmitted).toLocaleDateString() : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {selected && (
              <>
                <div className="flex items-center gap-2">
                  {getStatusBadge(selected.status)}
                  {getPriorityBadge(selected.priority)}
                </div>
                {selected.documents.length > 0 && (
                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">
                      Requested Files ({selected.documents.length})
                    </p>
                    <div className="flex flex-col gap-1">
                      {selected.documents.map((doc) => (
                        <p key={doc.documentId} className="text-[13px] text-gray-700 truncate flex items-center gap-2">
                          <FileCheck2 className="w-4 h-4 text-gray-400 shrink-0" />
                          {doc.documentName}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">Explanation</p>
                  <p className="text-[13px] text-gray-700 whitespace-pre-line">{selected.purpose}</p>
                </div>
                {selected.handledByName && (
                  <div>
                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1">
                      {selected.status === "Approved" ? "Approved by" : "Decision by"}
                    </p>
                    <p className="text-[13px] text-gray-700">{selected.handledByName}</p>
                    {selected.remarks && <p className="text-[12px] text-gray-500 mt-1 whitespace-pre-line">{selected.remarks}</p>}
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter className="gap-2">
            {selected?.status === "Pending" && (
              <Button
                variant="outline"
                className="border-red-300 text-red-600 hover:bg-red-50"
                disabled={cancelling}
                onClick={() => void handleCancel(selected)}
              >
                <XCircle className="w-4 h-4 mr-2" />
                {cancelling ? "Cancelling..." : "Cancel Request"}
              </Button>
            )}
            <Button variant="outline" onClick={() => setSelected(null)} className="h-10 px-5">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
