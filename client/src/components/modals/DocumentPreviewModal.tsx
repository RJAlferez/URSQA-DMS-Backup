import { useState, useEffect, useRef } from "react"
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Printer,
  Download,
  CheckCircle,
  RotateCcw,
  XCircle,
  FileText,
  User,
  Building2,
  Calendar,
  HardDrive,
  Layout,
  MapPin,
  Info,
  Loader2,
  AlertCircle,
  FileArchive,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import { Button } from "@/components/ui/Button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar"
import { Badge } from "@/components/ui/Badge"
import type { Document } from "@/types/domain"
import { apiGet } from "@/lib/http"
import type { PreviewDownloadResult } from "@/components/preview/types"

interface DocumentPreviewModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: Document | null
  onReturn?: (documentId: string) => void
  onApprove?: (documentId: string) => void
  onReject?: (documentId: string) => void
  showAdminActions?: boolean
}

function bytesToReadable(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const getStatusBadge = (status: string) => {
  switch (status) {
    case "Approved":
      return <Badge variant="success">{status}</Badge>
    case "Pending":
      return <Badge variant="warning">{status}</Badge>
    case "Returned":
      return <Badge variant="danger">{status}</Badge>
    case "Archived":
      return <Badge variant="secondary">{status}</Badge>
    default:
      return <Badge variant="secondary">{status}</Badge>
  }
}

export function DocumentPreviewModal({
  open,
  onOpenChange,
  document,
  onReturn,
  onApprove,
  onReject,
  showAdminActions = false,
}: DocumentPreviewModalProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewMimeType, setPreviewMimeType] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages] = useState(1)
  const [zoomLevel, setZoomLevel] = useState(100)
  const [rotation, setRotation] = useState(0)
  const previewFrameRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!open || !document?.id) {
      setBlobUrl(null)
      setPreviewMimeType(null)
      return
    }
    setLoading(true)
    setError(null)
    setPreviewMimeType(null)
    apiGet<PreviewDownloadResult>(`/documents/${encodeURIComponent(document.id)}/preview`)
      .then((result) => {
        setPreviewMimeType(result.mimeType ?? null)
        return fetch(result.url)
      })
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load file preview")
        return response.blob()
      })
      .then((blob) => {
        setBlobUrl(URL.createObjectURL(blob))
        setLoading(false)
      })
      .catch(() => {
        setError("Failed to load file preview")
        setLoading(false)
      })
  }, [open, document?.id])

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [blobUrl])

  const isPdf = previewMimeType === "application/pdf" || document?.mimeType?.includes("pdf")
  const isImage = document?.mimeType?.startsWith("image/")
  const isPreviewable = isPdf || isImage

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 25, 200))
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 25, 50))
  const handlePrevPage = () => setCurrentPage((prev) => Math.max(prev - 1, 1))
  const handleNextPage = () => setCurrentPage((prev) => Math.min(prev + 1, totalPages))
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360)
  const handlePrint = () => {
    if (isImage && blobUrl) {
      const printWindow = window.open("", "_blank")
      if (!printWindow) return
      const image = printWindow.document.createElement("img")
      image.src = blobUrl
      image.alt = document?.name ?? "Document"
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
    if (isPdf && previewFrameRef.current?.contentWindow) {
      previewFrameRef.current.contentWindow.print()
      return
    }
    window.print()
  }
  const handleDownload = async () => {
    if (!document?.id) return
    const result = await apiGet<PreviewDownloadResult>(`/documents/${encodeURIComponent(document.id)}/download`)
    window.open(result.url, "_blank", "noopener,noreferrer")
  }
  const handleApprove = () => {
    if (!document) return
    onApprove?.(document.id)
    onOpenChange(false)
  }
  const handleReturn = () => {
    if (!document) return
    onReturn?.(document.id)
    onOpenChange(false)
  }
  const handleReject = () => {
    if (!document) return
    onReject?.(document.id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full h-[90vh] p-0 overflow-hidden flex flex-col max-md:max-w-none max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:rounded-none">
        <DialogHeader className="px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <DialogTitle className="text-lg">Preview Document</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden flex-col lg:flex-row">
          <div className="flex-1 flex flex-col bg-gray-100 min-h-[300px] lg:min-h-0 overflow-hidden">
            <div className="h-12 bg-white border-b border-border flex items-center justify-between px-4 flex-shrink-0">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-gray-600"
                  onClick={handlePrevPage}
                  disabled={currentPage === 1 || !isPreviewable}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-[13px] text-gray-600 px-2">
                  {isPreviewable ? `Page ${currentPage} of ${totalPages}` : "—"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-gray-600"
                  onClick={handleNextPage}
                  disabled={currentPage === totalPages || !isPreviewable}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-gray-600"
                  onClick={handleZoomOut}
                  disabled={!isPreviewable}
                >
                  <ZoomOut className="w-4 h-4" />
                </Button>
                <span className="text-[13px] text-gray-600 px-2 min-w-[50px] text-center">
                  {zoomLevel}%
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-gray-600"
                  onClick={handleZoomIn}
                  disabled={!isPreviewable}
                >
                  <ZoomIn className="w-4 h-4" />
                </Button>
                <div className="w-px h-5 bg-gray-200 mx-1" />
                <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-600" onClick={handleRotate} disabled={!isPreviewable}>
                  <RotateCw className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-600" onClick={handlePrint} disabled={!isPreviewable}>
                  <Printer className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-600" onClick={handleDownload} disabled={!blobUrl}>
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            </div>

          <div className="flex-1 overflow-y-auto p-3 sm:p-6 lg:p-8 flex items-start justify-center">
              {loading && (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Loader2 className="w-8 h-8 animate-spin mb-2" />
                  <span className="text-sm">Loading preview…</span>
                </div>
              )}
              {error && !loading && (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <AlertCircle className="w-8 h-8 mb-2" />
                  <span className="text-sm">{error}</span>
                </div>
              )}
              {!loading && !error && blobUrl && isPdf && (
                <iframe
                  ref={previewFrameRef}
                  src={blobUrl}
                  className="bg-white shadow-xl w-full max-w-[700px] aspect-[8.5/11]"
                  style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top center" }}
                  title={document?.name}
                />
              )}
              {!loading && !error && blobUrl && isImage && (
                <img
                  src={blobUrl}
                  alt={document?.name}
                  className="bg-white shadow-xl max-w-full max-h-full object-contain"
                  style={{ transform: `scale(${zoomLevel / 100}) rotate(${rotation}deg)`, transformOrigin: "top center" }}
                />
              )}
              {!loading && !error && !blobUrl && !isPreviewable && (
                <div className="bg-white shadow-xl w-full max-w-[700px] aspect-[8.5/11] flex flex-col items-center justify-center text-gray-400">
                  <FileArchive className="w-16 h-16 mb-4" />
                  <p className="text-sm font-medium mb-1">Preview not available</p>
                  <p className="text-xs text-gray-400 mb-4">
                    This file type ({document?.mimeType || "unknown"}) cannot be previewed.
                  </p>
                  <Button size="sm" onClick={handleDownload} className="flex items-center gap-2">
                    <Download className="w-4 h-4" />
                    Download File
                  </Button>
                </div>
              )}
              {!loading && !error && !blobUrl && isPreviewable && (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <FileText className="w-12 h-12 mb-2" />
                  <span className="text-sm">No preview data</span>
                </div>
              )}
            </div>
          </div>

          <div className="w-full lg:w-[340px] bg-white border-t lg:border-t-0 lg:border-l border-border flex flex-col flex-shrink-0 overflow-y-auto">
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-[15px] font-semibold text-gray-900 mb-1">Document Details</h3>
              <p className="text-[12px] text-gray-400">ID: {document?.id}</p>
            </div>

            <div className="p-5 space-y-4 flex-1">
              <div>
                <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                  <FileText className="w-3 h-3" />
                  Document Name
                </label>
                <p className="text-[14px] font-medium text-gray-900 leading-snug">
                  {document?.name}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                    <Layout className="w-3 h-3" />
                    Category
                  </label>
                  <p className="text-[13px] text-gray-700">{document?.categoryName}</p>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                    <MapPin className="w-3 h-3" />
                    Area
                  </label>
                  <p className="text-[13px] text-gray-700">{document?.area}</p>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                  <Building2 className="w-3 h-3" />
                  Department
                </label>
                <p className="text-[13px] text-gray-700">{document?.department}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                    <User className="w-3 h-3" />
                    Owner
                  </label>
                  <div className="flex items-center gap-2 mt-1">
                    <Avatar className="h-6 w-6">
                      <AvatarImage src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${document?.ownerName}`} />
                      <AvatarFallback className="text-[10px]">
                        {document?.ownerName?.split(" ").map((n) => n[0]).join("")}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-[13px] text-gray-700 truncate">{document?.ownerName}</span>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                    <Calendar className="w-3 h-3" />
                    Date Created
                  </label>
                  <p className="text-[13px] text-gray-700">{document?.dateCreated}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                    <HardDrive className="w-3 h-3" />
                    File Size
                  </label>
                  <p className="text-[13px] text-gray-700">{document ? bytesToReadable(document.size) : "—"}</p>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide flex items-center gap-1.5 mb-1.5">
                    <FileText className="w-3 h-3" />
                    MIME Type
                  </label>
                  <p className="text-[13px] text-gray-700">{document?.mimeType || "—"}</p>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2 block">
                  Status
                </label>
                {document && getStatusBadge(document.status)}
              </div>
            </div>

            {showAdminActions && (
              <div className="p-5 border-t border-gray-100 bg-gray-50/50">
                <p className="text-[12px] font-medium text-gray-700 mb-3">Admin Actions</p>
                <div className="flex flex-col gap-2">
                  <Button className="w-full h-10 flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white" onClick={handleApprove}>
                    <CheckCircle className="w-4 h-4" />
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full h-10 flex items-center gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
                    onClick={handleReturn}
                  >
                    <RotateCcw className="w-4 h-4" />
                    Return
                  </Button>
                  <Button variant="outline" className="w-full h-10 flex items-center gap-2 border-red-300 text-red-700 hover:bg-red-50" onClick={handleReject}>
                    <XCircle className="w-4 h-4" />
                    Reject
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 bg-primary-50/50 flex-shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Info className="w-4 h-4 text-primary-600" />
            </div>
            <div>
              <p className="text-[13px] font-medium text-blue-800">Review Reminder</p>
              <p className="text-[12px] text-primary-600/80 mt-0.5">
                Please ensure all documents meet the required standards before taking action. Review the complete document carefully.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
