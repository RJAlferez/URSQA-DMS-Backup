import { useState, useEffect } from "react"
import {
  FileText,
  FileSpreadsheet,
  Presentation,
  Image,
  File,
  FileX,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Download,
  Loader2,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/Button"
import { cn } from "@/lib/utils"
import { apiGet } from "@/lib/http"
import type { DocumentFile, PreviewDownloadResult } from "./types"

interface FilePreviewRendererProps {
  file: DocumentFile
  className?: string
}

async function downloadFile(file: DocumentFile) {
  try {
    const result = await apiGet<PreviewDownloadResult>(
      `/documents/${encodeURIComponent(file.id)}/download`,
    )
    window.open(result.url, "_blank", "noopener,noreferrer")
  } catch {
    // Download failures are surfaced by the surrounding preview state.
  }
}

const getFileTypeIcon = (type: DocumentFile["type"]) => {
  switch (type) {
    case "PDF":
      return <FileText className="w-16 h-16 text-red-500" />
    case "DOCX":
    case "DOC":
      return <FileText className="w-16 h-16 text-blue-500" />
    case "XLSX":
    case "XLS":
      return <FileSpreadsheet className="w-16 h-16 text-emerald-600" />
    case "PPTX":
    case "PPT":
      return <Presentation className="w-16 h-16 text-orange-500" />
    case "JPG":
    case "PNG":
    case "JPEG":
    case "WEBP":
      return <Image className="w-16 h-16 text-purple-500" />
    default:
      return <File className="w-16 h-16 text-gray-400" />
  }
}

const getFileTypeColor = (type: DocumentFile["type"]) => {
  switch (type) {
    case "PDF":
      return "bg-red-50 text-red-600"
    case "DOCX":
    case "DOC":
      return "bg-primary-50 text-primary-600"
    case "XLSX":
    case "XLS":
      return "bg-emerald-50 text-emerald-600"
    case "PPTX":
    case "PPT":
      return "bg-orange-50 text-orange-600"
    case "JPG":
    case "PNG":
    case "JPEG":
    case "WEBP":
      return "bg-purple-50 text-purple-600"
    default:
      return "bg-gray-50 text-gray-600"
  }
}

function PdfPreview({ file, blobUrl }: { file: DocumentFile; blobUrl: string | null }) {
  const [currentPage, setCurrentPage] = useState(1)
  const [zoomLevel, setZoomLevel] = useState(100)

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 25, 200))
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 25, 50))
  const handlePrevPage = () => setCurrentPage((prev) => Math.max(prev - 1, 1))
  const handleNextPage = () => setCurrentPage((prev) => prev + 1)
  const handleDownload = () => {
    void downloadFile(file)
  }

  if (!blobUrl) {
    return (
      <div className="flex flex-1 items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center text-gray-400">
          <Loader2 className="w-8 h-8 animate-spin mb-2" />
          <span className="text-sm">Loading PDF…</span>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-gray-50/50 flex-shrink-0">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-600"
            onClick={handlePrevPage}
            disabled={currentPage === 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-[12px] text-gray-600 px-2 min-w-[80px] text-center">
            Page {currentPage}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-600"
            onClick={handleNextPage}
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-600"
            onClick={handleZoomOut}
            disabled={zoomLevel <= 50}
            aria-label="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <span className="text-[12px] text-gray-600 px-1.5 min-w-[45px] text-center">
            {zoomLevel}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-600"
            onClick={handleZoomIn}
            disabled={zoomLevel >= 200}
            aria-label="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
          <div className="w-px h-4 bg-gray-300 mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-600"
            aria-label="Download"
            onClick={handleDownload}
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-100 p-4 flex items-start justify-center">
        <iframe
          src={blobUrl}
          className="bg-white shadow-lg"
          style={{
            width: `${(8.5 * zoomLevel) / 100 * 82.5}px`,
            height: `${(11 * zoomLevel) / 100 * 82.5}px`,
            minWidth: "640px",
            minHeight: "825px",
          }}
          title={file.name}
        />
      </div>
    </div>
  )
}

function ImagePreview({ file, blobUrl }: { file: DocumentFile; blobUrl: string | null }) {
  const [zoomLevel, setZoomLevel] = useState(100)

  const handleZoomIn = () => setZoomLevel((prev) => Math.min(prev + 25, 200))
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(prev - 25, 25))
  const handleDownload = () => {
    void downloadFile(file)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-gray-50/50 flex-shrink-0">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-600"
            onClick={handleZoomOut}
            disabled={zoomLevel <= 25}
            aria-label="Zoom out"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <span className="text-[12px] text-gray-600 px-1.5 min-w-[45px] text-center">
            {zoomLevel}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-600"
            onClick={handleZoomIn}
            disabled={zoomLevel >= 200}
            aria-label="Zoom in"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
          <div className="w-px h-4 bg-gray-300 mx-1" />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-600"
            aria-label="Download"
            onClick={handleDownload}
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-100 p-6 flex items-start justify-center">
        {!blobUrl ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin mb-2" />
            <span className="text-sm">Loading image…</span>
          </div>
        ) : (
          <img
            src={blobUrl}
            alt={file.name}
            className="bg-white shadow-lg object-contain transition-all duration-200"
            style={{
              width: `${Math.min(800 * zoomLevel / 100, 800)}px`,
              height: `${Math.min(600 * zoomLevel / 100, 600)}px`,
            }}
          />
        )}
      </div>
    </div>
  )
}

function OfficePreview({ file }: { file: DocumentFile }) {
  const handleDownload = () => {
    void downloadFile(file)
  }

  return (
    <div className="flex flex-col h-full items-center justify-center bg-gray-50 p-8">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-soft border border-border p-8">
        <div className="flex flex-col items-center text-center">
          <div className={cn("w-20 h-20 rounded-2xl flex items-center justify-center mb-4", getFileTypeColor(file.type))}>
            {getFileTypeIcon(file.type)}
          </div>

          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            Preview Not Available
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            This file type cannot be previewed directly. You can download the file to view it on your device.
          </p>

          <div className="w-full p-4 bg-gray-50 rounded-xl mb-4">
            <div className="flex items-center gap-3">
              <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", getFileTypeColor(file.type))}>
                {getFileTypeIcon(file.type)}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium text-gray-900 truncate" title={file.name}>{file.name}</p>
                <p className="text-xs text-gray-500">{file.size}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full">
            <Button variant="outline" className="flex-1 h-10" aria-label="Download file" onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              Download
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function UnsupportedPreview({ file }: { file: DocumentFile }) {
  const handleDownload = () => {
    void downloadFile(file)
  }

  return (
    <div className="flex flex-col h-full items-center justify-center bg-gray-50 p-8">
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-soft border border-border p-8">
        <div className="flex flex-col items-center text-center">
          <div className="w-20 h-20 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
            <FileX className="w-10 h-10 text-gray-400" />
          </div>

          <h3 className="text-lg font-semibold text-gray-900 mb-1">
            Preview Unavailable
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            This file type is not supported for preview. Please download the file to view it.
          </p>

          <Button variant="outline" className="h-10" aria-label="Download file" onClick={handleDownload}>
            <Download className="w-4 h-4 mr-2" />
            Download File
          </Button>
        </div>
      </div>
    </div>
  )
}

function NoPreviewAvailable({ file }: { file: DocumentFile }) {
  const handleDownload = () => {
    void downloadFile(file)
  }

  return (
    <div className="flex flex-col items-center justify-center h-full bg-gray-50">
      <div className="text-center">
        <AlertCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <p className="text-sm font-medium text-gray-500 mb-1">No preview data</p>
        <p className="text-xs text-gray-400 mb-4">
          This document has no associated file data.
        </p>
        <Button size="sm" onClick={handleDownload} className="flex items-center gap-2 mx-auto">
          <Download className="w-4 h-4" />
          Download
        </Button>
      </div>
    </div>
  )
}

export function FilePreviewRenderer({ file, className }: FilePreviewRendererProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [previewMimeType, setPreviewMimeType] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!file.id) {
      setBlobUrl(null)
      setPreviewMimeType(null)
      return
    }
    setLoading(true)
    setError(false)
    setPreviewMimeType(null)
    apiGet<PreviewDownloadResult>(`/documents/${encodeURIComponent(file.id)}/preview`)
      .then((result) => {
        setBlobUrl(result.url)
        setPreviewMimeType(result.mimeType ?? null)
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [file.id])

  useEffect(() => {
    return () => {
      if (blobUrl && blobUrl.startsWith("blob:")) {
        URL.revokeObjectURL(blobUrl)
      }
    }
  }, [blobUrl])

  const isPdf = file.mimeType?.includes("pdf") || file.type?.toUpperCase() === "PDF"
  const isImage = file.mimeType?.startsWith("image/") || ["JPG", "PNG", "JPEG", "WEBP"].includes(file.type?.toUpperCase())

  const renderPreview = () => {
    if (!file.id) return <NoPreviewAvailable file={file} />
    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center bg-gray-100">
          <div className="flex flex-col items-center text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin mb-2" />
            <span className="text-sm">Loading preview…</span>
          </div>
        </div>
      )
    }
    if (error) {
      return (
        <div className="flex flex-1 items-center justify-center bg-gray-100">
          <div className="flex flex-col items-center text-gray-400">
            <AlertCircle className="w-8 h-8 mb-2" />
            <span className="text-sm">Failed to load preview</span>
          </div>
        </div>
      )
    }
    if (isPdf || previewMimeType === "application/pdf") return <PdfPreview file={file} blobUrl={blobUrl} />
    if (isImage) return <ImagePreview file={file} blobUrl={blobUrl} />
    if (["DOCX", "DOC", "XLSX", "XLS", "PPTX", "PPT"].includes(file.type?.toUpperCase())) {
      return <OfficePreview file={file} />
    }
    return <UnsupportedPreview file={file} />
  }

  return (
    <div className={cn("flex flex-col h-full bg-white", className)}>
      {renderPreview()}
    </div>
  )
}

export { getFileTypeIcon, getFileTypeColor }
