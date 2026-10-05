import { useState, useEffect, useCallback } from "react"
import { ArrowLeft, FileText, Info, Send } from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Label } from "@/components/ui/Label"
import { Textarea } from "@/components/ui/Textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table"
import { EmptyState } from "@/components/ui/EmptyState"
import { Skeleton } from "@/components/ui/Skeleton"
import { toast } from "@/lib/toast"
import { browseArchive, createRequest, type BrowseBucketItem } from "@/services/requests"
import { cn } from "@/lib/utils"

// =============================================================================
// UserBrowseArchive — department file bucket browser (Sprint).
// List-only surface: file name, type, owner, date uploaded and size. Files
// cannot be opened or downloaded here. The user selects up to 3 files and
// must provide an explanation before submitting ONE request for them.
// =============================================================================

const MAX_FILES = 3

function formatSize(sizeBytes: string | null): string {
  if (!sizeBytes) return "—"
  const bytes = Number(sizeBytes)
  if (!Number.isFinite(bytes) || bytes <= 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileTypeOf(item: BrowseBucketItem): string {
  if (item.filename) {
    const ext = item.filename.split(".").pop()
    if (ext) return ext.toUpperCase()
  }
  if (item.mimeType) return item.mimeType.split("/")[1]?.toUpperCase() ?? "FILE"
  return "FILE"
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

interface UserBrowseArchiveProps {
  onBack: () => void
  onSuccess?: () => void
}

export default function UserBrowseArchive({ onBack, onSuccess }: UserBrowseArchiveProps) {
  const [items, setItems] = useState<BrowseBucketItem[]>([])
  const [departmentName, setDepartmentName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [explanation, setExplanation] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const bucket = await browseArchive()
      setItems(bucket.items)
      setDepartmentName(bucket.departmentName)
    } catch {
      setItems([])
      setDepartmentName(null)
      toast.error("Unable to load the archive. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
        return next
      }
      if (next.size >= MAX_FILES) return prev
      next.add(id)
      return next
    })
  }

  const selectedItems = items.filter((item) => selectedIds.has(item.id))

  const handleSubmit = async () => {
    if (selectedItems.length === 0) {
      toast.error("Select at least one file to request")
      return
    }
    if (!explanation.trim()) {
      toast.error("Please provide an explanation for your request")
      return
    }
    setSubmitting(true)
    try {
      await createRequest({
        title: `Document Request - ${new Date().toISOString().slice(0, 10)}`,
        purpose: explanation.trim(),
        remarks: "",
        priority: "Normal",
        documents: selectedItems.map((item) => ({ documentId: item.id, documentName: item.title })),
      })
      toast.success("Request submitted for approval")
      onSuccess?.()
      onBack()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to submit the request")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="content-padding">
      <PageHeader
        title="Browse Archive"
        description={departmentName ? `Files from the ${departmentName} archive — preview and download are disabled while browsing.` : "Files from your department's archive"}
        actions={
          <Button variant="outline" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to My Requests
          </Button>
        }
      />

      <Card className="border-border/70 shadow-soft">
        <div className="px-5 pt-4 pb-0 flex items-center justify-between">
          <div className="flex items-center gap-2 text-[12px] text-gray-500">
            <Info className="w-4 h-4 text-gray-400" />
            Select up to {MAX_FILES} files to request. You will see only the file name, type, owner, date, and size.
          </div>
          <span
            className={cn(
              "text-[12px] font-medium",
              selectedIds.size >= MAX_FILES ? "text-amber-600" : "text-gray-500"
            )}
          >
            {selectedIds.size}/{MAX_FILES} selected
          </span>
        </div>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>File Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Date Uploaded</TableHead>
                <TableHead>Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={6} className="p-5">
                    <Skeleton variant="rectangular" className="h-16" />
                  </TableCell>
                </TableRow>
              )}
              {!loading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState
                      variant="archives"
                      title="No files in your department archive"
                      description="Files shared by your department will appear here once uploaded"
                    />
                  </TableCell>
                </TableRow>
              )}
              {!loading &&
                items.map((item) => {
                  const checked = selectedIds.has(item.id)
                  const disabled = !checked && selectedIds.size >= MAX_FILES
                  return (
                    <TableRow
                      key={item.id}
                      className={cn(
                        "hover:bg-gray-50/50 transition-colors cursor-pointer select-none",
                        checked && "bg-primary/5"
                      )}
                      onClick={() => toggleSelect(item.id)}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300 accent-primary cursor-pointer"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleSelect(item.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <span className="w-8 h-8 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
                            <FileText className="w-4 h-4 text-gray-500" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium text-gray-900 max-w-[280px] truncate">
                              {item.title}
                            </p>
                            {item.filename && item.filename !== item.title && (
                              <p className="text-[11px] text-gray-400 truncate max-w-[280px]">{item.filename}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="px-2 py-1 text-[11px] font-medium bg-gray-100 text-gray-700 rounded">
                          {fileTypeOf(item)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[13px] text-gray-700">{item.ownerName}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[13px] text-gray-500">{formatDate(item.uploadedAt)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[13px] text-gray-500">{formatSize(item.sizeBytes)}</span>
                      </TableCell>
                    </TableRow>
                  )
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-soft mt-6">
        <CardContent className="p-5">
          <div className="grid gap-3">
            <Label htmlFor="requestExplanation" className="text-[13px] font-medium text-gray-700">
              Explanation <span className="text-red-500">*</span>
            </Label>
            <Textarea
              id="requestExplanation"
              placeholder="Explain why you need access to the selected file(s)..."
              className="min-h-[110px] resize-none"
              value={explanation}
              onChange={(e) => setExplanation(e.target.value)}
              maxLength={2000}
            />
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <p className="text-[12px] text-gray-500">
                {selectedItems.length === 0
                  ? "No files selected"
                  : `Requesting ${selectedItems.length} file${selectedItems.length > 1 ? "s" : ""}: ${selectedItems.map((item) => item.title).join(", ")}`}
              </p>
              <Button
                onClick={() => void handleSubmit()}
                disabled={submitting || selectedItems.length === 0 || !explanation.trim()}
                className="shadow-soft"
              >
                <Send className="w-4 h-4 mr-2" />
                {submitting ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
