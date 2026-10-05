import { useEffect, useRef, useState } from "react"
import {
  X, Download, Pencil, Move, Trash2, Info, Loader2, FileText, Printer, Activity,
  ChevronDown, ChevronRight, ZoomIn, ZoomOut, RotateCw, CheckCircle, RotateCcw,
  XCircle, Volume2
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Label } from "@/components/ui/Label"
import { Skeleton } from "@/components/ui/Skeleton"
import { openOnlineDocument, getOnlineDocumentUrl, getDocumentActivity, type DocumentActivity } from "@/services/documents"
import type { Document } from "@/types/domain"
import { cn } from "@/lib/utils"

interface FilePreviewModalProps {
  document: Document | null
  onClose: () => void
  onRename?: (document: Document, title: string) => Promise<void>
  onMove?: (document: Document) => void
  onDelete?: (document: Document) => void
  showAdminActions?: boolean
  onApprove?: (document: Document) => void
  onReturn?: (document: Document) => void
  onReject?: (document: Document) => void
  adminLoading?: boolean
}

function formatSize(bytes: number): string {
  if (!bytes) return "—"
  const units = ["B", "KB", "MB", "GB"]
  let i = 0; let value = bytes
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}

function submissionBadge(doc: Document) {
  if (!doc.submissionStatus) return null
  const config = {
    PENDING: { label: "Pending", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800" },
    APPROVED: { label: "Approved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800" },
    REJECTED: { label: "Rejected", cls: "bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800" },
    NEEDS_REVISION: { label: "Returned", cls: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800" },
    WITHDRAWN: { label: "Withdrawn", cls: "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-900/30 dark:text-slate-400 dark:border-slate-800" },
  } as const
  const cfg = config[doc.submissionStatus]
  return <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap", cfg.cls)}>{cfg.label}</span>
}

export function FilePreviewModal({ document, onClose, onRename, onMove, onDelete, showAdminActions, onApprove, onReturn, onReject, adminLoading }: FilePreviewModalProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState("")
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<"preview" | "activity">("preview")
  const [activity, setActivity] = useState<DocumentActivity | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [zoom, setZoom] = useState(100)
  const [rotation, setRotation] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!document) return
    let previewObjectUrl: string | null = null
    let cancelled = false
    setUrl(null); setError(null); setEditing(false); setTab("preview"); setActivity(null)
    setZoom(100); setRotation(0)
    setLoading(true)
    getOnlineDocumentUrl(document, true)
      .then(async (previewUrl) => {
        const response = await fetch(previewUrl)
        if (!response.ok) throw new Error("Unable to load file preview")
        const preview = await response.blob()
        previewObjectUrl = URL.createObjectURL(preview)
        if (cancelled) {
          URL.revokeObjectURL(previewObjectUrl)
          return
        }
        setUrl(previewObjectUrl)
      })
      .catch(() => {
        if (!cancelled) setError("Unable to generate a preview link")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl)
    }
  }, [document, previewAttempt])

  useEffect(() => {
    if (!document || tab !== "activity") return
    setActivityLoading(true)
    getDocumentActivity(document.id).then(setActivity).catch(() => setActivity(null)).finally(() => setActivityLoading(false))
  }, [document, tab])

  if (!document) return null

  const type = document.type?.toLowerCase() ?? ""
  const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(type)
  const isVideo = ["mp4", "webm", "mov", "avi", "mkv"].includes(type)
  const isAudio = ["mp3", "wav", "ogg", "m4a", "aac"].includes(type)
  const isPdf = type === "pdf"
  const printable = isPdf || isImage || ["txt", "csv"].includes(type)

  const submitRename = async () => {
    if (!title.trim() || !document) return
    setSaving(true)
    try { await onRename?.(document, title.trim()); setEditing(false) } finally { setSaving(false) }
  }

  const printPreview = () => {
    if (isImage && url) {
      const printWindow = window.open("", "_blank")
      if (!printWindow) return
      const image = printWindow.document.createElement("img")
      image.src = url
      image.alt = document.name
      image.style.maxWidth = "100%"
      image.style.maxHeight = "100vh"
      image.style.objectFit = "contain"
      printWindow.document.body.style.margin = "0"
      printWindow.document.body.style.display = "flex"
      printWindow.document.body.style.justifyContent = "center"
      printWindow.document.body.style.alignItems = "center"
      image.onload = () => {
        printWindow.focus()
        printWindow.print()
        printWindow.close()
      }
      printWindow.document.body.appendChild(image)
      return
    }
    try { iframeRef.current?.contentWindow?.print() } catch { return }
  }

  const mediaStyle = {
    transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
    transition: "transform 0.2s ease",
  }

  return (
    <Dialog open={Boolean(document)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[94vw] w-[94vw] h-[92vh] max-h-[92vh] p-0 overflow-hidden flex flex-col [&>button]:hidden dark:bg-[#0B1121] max-md:w-full max-md:max-w-none max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:rounded-none">
        {/* Header */}
        <DialogHeader className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 max-md:px-4 max-md:pt-[max(0.75rem,env(safe-area-inset-top))] max-md:pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pr-10">
            <div className="min-w-0 pr-9 sm:pr-0">
              <DialogTitle className="text-[15px] truncate flex items-center gap-2 dark:text-gray-100">
                {document.name}
                {submissionBadge(document)}
              </DialogTitle>
              <p className="text-[12px] text-gray-500 dark:text-gray-400 mt-0.5">
                {document.type?.toUpperCase()} · {formatSize(document.size)} · {new Date(document.dateModified).toLocaleString()}
              </p>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 flex-shrink-0 max-md:-mx-1 max-md:px-1 sm:flex-wrap sm:overflow-visible">
              <div className="flex shrink-0 rounded-lg border border-border dark:border-gray-700 p-0.5 bg-gray-50/50 dark:bg-gray-800/50 sm:mr-1">
                <button type="button" onClick={() => setTab("preview")} className={cn("px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors", tab === "preview" ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-soft" : "text-gray-500 dark:text-gray-400 hover:text-gray-700")}>Preview</button>
                <button type="button" onClick={() => setTab("activity")} className={cn("px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors", tab === "activity" ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-soft" : "text-gray-500 dark:text-gray-400 hover:text-gray-700")}>Details &amp; Activity</button>
              </div>

              {/* Zoom controls for images */}
              {(isImage || isPdf) && tab === "preview" && (
                <div className="hidden items-center gap-0.5 mr-1 sm:flex">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(25, z - 25))} title="Zoom out"><ZoomOut className="w-3.5 h-3.5" /></Button>
                  <span className="text-[11px] text-gray-500 w-10 text-center tabular-nums">{zoom}%</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(300, z + 25))} title="Zoom in"><ZoomIn className="w-3.5 h-3.5" /></Button>
                  {isImage && <Button variant="ghost" size="icon" className="h-7 w-7 ml-1" onClick={() => setRotation((r) => r + 90)} title="Rotate"><RotateCw className="w-3.5 h-3.5" /></Button>}
                </div>
              )}

              <Button variant="outline" size="sm" className="h-8 shrink-0 text-[12px] max-md:w-8 max-md:px-0" title="Download" onClick={() => void openOnlineDocument(document)}><Download className="w-3.5 h-3.5 sm:mr-1.5" /><span className="sr-only sm:not-sr-only">Download</span></Button>
              {tab === "preview" && printable && <Button variant="outline" size="sm" className="h-8 shrink-0 text-[12px] max-md:w-8 max-md:px-0" title="Print" onClick={printPreview}><Printer className="w-3.5 h-3.5 sm:mr-1.5" /><span className="sr-only sm:not-sr-only">Print</span></Button>}
              {onRename && <Button variant="outline" size="sm" className="h-8 shrink-0 text-[12px] max-md:w-8 max-md:px-0" title="Rename" onClick={() => { setTitle(document.name); setEditing(true) }}><Pencil className="w-3.5 h-3.5 sm:mr-1.5" /><span className="sr-only sm:not-sr-only">Rename</span></Button>}
              {onMove && <Button variant="outline" size="sm" className="h-8 shrink-0 text-[12px] max-md:w-8 max-md:px-0" title="Move" onClick={() => onMove(document)}><Move className="w-3.5 h-3.5 sm:mr-1.5" /><span className="sr-only sm:not-sr-only">Move</span></Button>}
              {onDelete && <Button variant="outline" size="sm" className="h-8 shrink-0 text-[12px] text-red-600 hover:text-red-700 max-md:w-8 max-md:px-0" title="Delete" onClick={() => onDelete(document)}><Trash2 className="w-3.5 h-3.5 sm:mr-1.5" /><span className="sr-only sm:not-sr-only">Delete</span></Button>}
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-gray-400 sm:hidden" title="Close preview" onClick={onClose}><X className="w-4 h-4" /></Button>
            </div>
          </div>
        </DialogHeader>

        {/* Admin Actions Panel */}
        {showAdminActions && tab === "preview" && (
          <div className="px-5 py-2.5 border-b border-gray-100 dark:border-gray-800 bg-primary-50/50 dark:bg-blue-900/20 flex items-center gap-2 flex-shrink-0 overflow-x-auto max-md:px-4 max-md:py-2">
            <p className="text-[12px] font-medium text-blue-700 dark:text-blue-400 mr-2">Decision:</p>
            <Button size="sm" variant="default" className="h-8 text-[12px] bg-emerald-600 hover:bg-emerald-700" onClick={() => onApprove?.(document)} disabled={adminLoading}><CheckCircle className="w-3.5 h-3.5 mr-1.5" /> Approve</Button>
            <Button size="sm" variant="outline" className="h-8 text-[12px] border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => onReturn?.(document)} disabled={adminLoading}><RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Return</Button>
            <Button size="sm" variant="outline" className="h-8 text-[12px] border-red-300 text-red-600 hover:bg-red-50" onClick={() => onReject?.(document)} disabled={adminLoading}><XCircle className="w-3.5 h-3.5 mr-1.5" /> Reject</Button>
            {adminLoading && <Loader2 className="w-4 h-4 animate-spin text-primary-600 ml-2" />}
          </div>
        )}

        {/* Body */}
          <div className="flex-1 overflow-auto bg-gray-50 dark:bg-[#0F1520] p-3 sm:p-6">
          {editing && (
            <div className="mb-4 flex flex-col gap-2 max-w-md sm:flex-row sm:items-end">
              <div className="grid gap-1.5 flex-1"><Label className="text-[12px] text-gray-500">File name</Label><Input className="h-9" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <Button size="sm" className="h-9" onClick={() => void submitRename()} disabled={saving || !title.trim()}>{saving ? "Saving..." : "Save"}</Button>
              <Button size="sm" variant="outline" className="h-9" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          )}

          {tab === "activity" ? (
            <div className="h-full overflow-auto">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 sm:gap-3 max-w-2xl mb-4">
                {[
                  { label: "Name", value: document.name },
                  { label: "Type", value: `${document.type} · ${formatSize(document.size)}` },
                  { label: "Owner", value: document.ownerName || "—" },
                  { label: "Location", value: document.folderId ? "Filed in a folder" : "Repository root" },
                  { label: "Created", value: new Date(document.dateCreated).toLocaleString() },
                  { label: "Modified", value: new Date(document.dateModified).toLocaleString() },
                  { label: "Submission", value: submissionBadge(document) ?? "Not submitted" },
                  { label: "Downloads", value: activity?.downloadCount ?? "—" },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-[#111827] p-3">
                    <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold">{label}</p>
                    {label === "Submission" ? <div className="mt-1">{typeof value === "string" ? <p className="text-[13px] text-gray-400">{value}</p> : value}</div> : <p className="text-[13px] text-gray-900 dark:text-gray-100 font-medium mt-0.5 break-all">{String(value)}</p>}
                  </div>
                ))}
              </div>

              <button type="button" onClick={() => setShowAdvanced((p) => !p)} className="flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-3">
                {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Advanced
              </button>
              {showAdvanced && (
                <div className="rounded-lg border border-gray-100 dark:border-gray-700 bg-white dark:bg-[#111827] p-3 mb-4 max-w-2xl">
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold mb-1">SHA-256 Checksum</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 break-all font-mono">{document.checksum ?? "—"}</p>
                  <p className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold mt-3 mb-1">File UUID</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 font-mono">{document.id}</p>
                </div>
              )}

              <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-300 mb-2"><Activity className="w-3.5 h-3.5 inline mr-1.5" />Activity timeline</p>
              {activityLoading ? (
                <div className="space-y-2 py-2">
                  <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-3/4" /><Skeleton className="h-10 w-1/2" />
                </div>
              ) : !activity || activity.events.length === 0 ? (
                <p className="text-[12px] text-gray-400 dark:text-gray-500 py-4">No activity recorded for this file yet.</p>
              ) : (
                <div className="space-y-0 max-w-2xl">
                  {activity.events.map((event) => (
                    <div key={event.id} className="flex items-start gap-3 py-2 border-b border-gray-50 dark:border-gray-800 last:border-0">
                      <span className={cn("mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0", event.status === "FAILURE" ? "bg-red-400" : "bg-blue-400")} />
                      <div className="min-w-0">
                        <p className="text-[12px] text-gray-800 dark:text-gray-200 font-medium break-all">{event.action}</p>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">{event.timestamp ? new Date(event.timestamp).toLocaleString() : ""}{event.actorName ? ` · ${event.actorName}` : ""}{event.status === "FAILURE" ? " · FAILED" : ""}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : error ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <FileText className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-3" />
              <p className="text-[14px] text-gray-600 dark:text-gray-400">{error}</p>
              <div className="flex items-center gap-2 mt-4">
                <Button size="sm" variant="outline" onClick={() => setPreviewAttempt((attempt) => attempt + 1)}><RotateCw className="w-3.5 h-3.5 mr-1.5" /> Retry</Button>
                <Button size="sm" variant="outline" onClick={() => void openOnlineDocument(document)}><Download className="w-3.5 h-3.5 mr-1.5" /> Open file instead</Button>
              </div>
            </div>
          ) : loading || !url ? (
            <div className="h-full flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-7 h-7 text-primary animate-spin" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : isVideo ? (
            <div className="flex items-center justify-center h-full">
              <div className="max-w-full max-h-full bg-black rounded-lg overflow-hidden shadow-lg">
                <video src={url} controls className="max-w-full max-h-[70vh]" autoPlay={false}>
                  Your browser does not support the video tag.
                </video>
              </div>
            </div>
          ) : isAudio ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="w-20 h-20 rounded-full bg-primary-50 dark:bg-blue-900/30 flex items-center justify-center mb-4 shadow-soft">
                <Volume2 className="w-8 h-8 text-blue-500 dark:text-blue-400" />
              </div>
              <p className="text-[14px] text-gray-700 dark:text-gray-300 font-medium mb-1">{document.name}</p>
              <p className="text-[12px] text-gray-400 mb-4">{document.type?.toUpperCase()} · {formatSize(document.size)}</p>
              <audio src={url} controls className="w-full max-w-md" />
            </div>
          ) : isImage ? (
            <div className="flex h-full w-full items-center justify-center overflow-auto p-2">
              <img src={url} alt={document.name} className="block max-h-full max-w-full rounded-lg object-contain shadow-lg" style={mediaStyle} />
            </div>
          ) : (
            <iframe ref={iframeRef} src={url} title={document.name} className="w-full h-full min-h-[60vh] rounded-lg bg-white dark:bg-[#111827] shadow-soft" />
          )}
        </div>

        {/* Footer */}
        <div className="hidden px-5 py-2.5 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 items-center gap-2 text-[12px] text-gray-400 dark:text-gray-500 flex-wrap sm:flex">
          <Info className="w-3.5 h-3.5 flex-shrink-0" />
          <span>Version {document.versionCount} · Modified {new Date(document.dateModified).toLocaleString()}{document.folderId ? " · Filed in a folder" : " · At repository root"}</span>
          <Activity className="w-3.5 h-3.5 ml-2 flex-shrink-0" />
          <span>{activity?.downloadCount ?? "—"} downloads</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
