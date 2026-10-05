import { useState, useEffect } from "react"
import { Upload, X, FileText, Image, File } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import { Button } from "@/components/ui/Button"
import { Label } from "@/components/ui/Label"
import { Textarea } from "@/components/ui/Textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select"
import { listOnlineRequirements, uploadOnlineRequirementDocument } from "@/services/aaccup"
import { cn } from "@/lib/utils"

interface AddSubmissionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  areaId?: string
  areaTitle?: string
  areaSet?: "AACCUP" | "ISO"
  departmentId?: string
  onSuccess?: () => void
}

export function AddSubmissionModal({
  open,
  onOpenChange,
  areaId,
  areaTitle,
  areaSet = "AACCUP",
  departmentId,
  onSuccess,
}: AddSubmissionModalProps) {
  const [requirementId, setRequirementId] = useState("")
  const [requirements, setRequirements] = useState<Array<{ id: string; title: string; documentCode: string }>>([])
  const [files, setFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open || !areaId) return
    setError("")
    setRequirementId("")
    setFiles([])
    setRemarks("")
    listOnlineRequirements(areaId)
      .then((items) => {
        setRequirements(items)
        if (items.length === 1) setRequirementId(items[0].id)
      })
      .catch(() => setRequirements([]))
  }, [open, areaId])

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const dropped = Array.from(e.dataTransfer.files)
    setFiles((prev) => [...prev, ...dropped].slice(0, 1))
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files).slice(0, 1))
    }
  }

  const getFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) return Image
    if (type.includes("pdf")) return FileText
    return File
  }

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setRequirementId("")
      setFiles([])
      setRemarks("")
      setError("")
    }
    onOpenChange(isOpen)
  }

  const handleSubmit = async () => {
    setError("")
    if (!areaId) { setError("No area selected"); return }
    if (!requirementId) { setError("Please select a requirement"); return }
    if (files.length === 0) { setError("Please choose a file to submit"); return }

    const requirement = requirements.find((r) => r.id === requirementId)
    setSaving(true)
    try {
      await uploadOnlineRequirementDocument({
        requirementId,
        departmentId: departmentId ?? "",
        title: requirement ? `${requirement.documentCode} - ${requirement.title}` : files[0].name,
        areaName: areaTitle,
        requirementCode: requirement?.documentCode,
        file: files[0],
        remarks: remarks || undefined,
      })
      onSuccess?.()
      handleClose(false)
    } catch {
      setError("Failed to submit. Please check the file and try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" />
            Add Submission
          </DialogTitle>
          <DialogDescription className="text-[14px]">
            Submit a document for {areaTitle || "this area"} ({areaSet})
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-4">
          {error && (
            <div className="text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <div className="grid gap-2">
            <Label className="text-[13px] font-medium text-gray-700">
              Requirement <span className="text-red-500">*</span>
            </Label>
            <Select value={requirementId} onValueChange={setRequirementId}>
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select requirement" />
              </SelectTrigger>
              <SelectContent>
                {requirements.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.documentCode} — {item.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {requirements.length === 0 && (
              <p className="text-[12px] text-gray-500">
                No active requirements for this area yet.
              </p>
            )}
          </div>

          <div
            onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true) }}
            onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false) }}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => document.getElementById("file-upload-submission")?.click()}
            className={cn(
              "relative flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer transition-all duration-150",
              isDragging
                ? "border-primary bg-primary-500"
                : "border-border hover:border-gray-300 hover:bg-gray-50"
            )}
          >
            <input
              id="file-upload-submission"
              type="file"
              accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
              onChange={handleFileInput}
              className="hidden"
            />
            <div className="flex flex-col items-center justify-center">
              <div
                className={cn(
                  "w-12 h-12 mb-3 rounded-xl flex items-center justify-center transition-colors duration-150",
                  isDragging ? "bg-primary text-white" : "bg-gray-100 text-gray-400"
                )}
              >
                <Upload className="w-6 h-6" />
              </div>
              <p className="text-[14px] text-gray-700">
                <span className="font-medium">Click to upload</span> or drag and drop
              </p>
              <p className="text-[12px] text-gray-400 mt-1">
                PDF, DOC, DOCX, XLS, XLSX, JPG, PNG
              </p>
            </div>
          </div>

          {files.length > 0 && (
            <div className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50/50">
              <div className="flex items-center gap-3">
                {(() => {
                  const Icon = getFileIcon(files[0].type)
                  return (
                    <div className="w-10 h-10 rounded-lg bg-white border border-border flex items-center justify-center">
                      <Icon className="w-5 h-5 text-gray-500" />
                    </div>
                  )
                })()}
                <div>
                  <p className="text-[14px] font-medium text-gray-700 truncate max-w-[240px]">
                    {files[0].name}
                  </p>
                  <p className="text-[11px] text-gray-400">{getFileSize(files[0].size)}</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setFiles([])}
                className="h-8 w-8 text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          <div className="grid gap-2">
            <Label className="text-[13px] font-medium text-gray-700">
              Remarks
            </Label>
            <Textarea
              placeholder="Optional notes for the reviewer..."
              className="min-h-[80px] resize-none"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={() => handleClose(false)} className="h-10 px-5">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={saving || requirements.length === 0}
            className="h-10 px-5 shadow-soft"
          >
            {saving ? "Submitting..." : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
