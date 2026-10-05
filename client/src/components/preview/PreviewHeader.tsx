import { X, Download, Share2, Maximize2, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { apiGet } from "@/lib/http"
import type { DocumentFile, PreviewDownloadResult } from "./types"

interface PreviewHeaderProps {
  file: DocumentFile
  onClose: () => void
}

const getFileTypeBadge = (type: DocumentFile["type"]) => {
  switch (type) {
    case "PDF":
      return <Badge variant="danger" className="text-[10px] px-2 py-0.5">PDF</Badge>
    case "DOCX":
    case "DOC":
      return <Badge className="bg-primary-50 text-primary-600 text-[10px] px-2 py-0.5">DOCX</Badge>
    case "XLSX":
    case "XLS":
      return <Badge className="bg-emerald-50 text-emerald-600 text-[10px] px-2 py-0.5">XLSX</Badge>
    case "PPTX":
    case "PPT":
      return <Badge className="bg-orange-50 text-orange-600 text-[10px] px-2 py-0.5">PPTX</Badge>
    case "JPG":
    case "PNG":
    case "JPEG":
    case "WEBP":
      return <Badge className="bg-purple-50 text-purple-600 text-[10px] px-2 py-0.5">IMAGE</Badge>
    default:
      return <Badge variant="secondary" className="text-[10px] px-2 py-0.5">{type}</Badge>
  }
}

export function PreviewHeader({ file, onClose }: PreviewHeaderProps) {
  const handleDownload = async () => {
    try {
      const result = await apiGet<PreviewDownloadResult>(
        `/documents/${encodeURIComponent(file.id)}/download`,
      )
      window.open(result.url, "_blank", "noopener,noreferrer")
    } catch {
      // The preview remains open when the download request fails.
    }
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-white flex-shrink-0">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-[15px] font-semibold text-gray-900 truncate" title={file.name}>
            {file.name}
          </h2>
          {getFileTypeBadge(file.type)}
        </div>
        
        {file.folderPath?.length ? (
          <div className="hidden sm:flex items-center gap-1 text-[12px] text-gray-500">
            <ChevronRight className="w-3 h-3" />
            <span className="truncate max-w-[150px]" title={file.folderPath.join(" / ")}>{file.folderPath.join(" / ")}</span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1 flex-shrink-0 ml-4">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-600 hover:text-gray-900 hover:bg-gray-100"
          onClick={handleDownload}
          title="Download"
        >
          <Download className="w-4 h-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-400 cursor-not-allowed"
          title="Share (not implemented)"
          disabled
        >
          <Share2 className="w-4 h-4" />
        </Button>
        
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-400 cursor-not-allowed"
          title="Fullscreen (not implemented)"
          disabled
        >
          <Maximize2 className="w-4 h-4" />
        </Button>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
          onClick={onClose}
          title="Close"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  )
}
