import { useEffect, useState } from "react"
import { FileText, Upload } from "lucide-react"
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
import { Input } from "@/components/ui/Input"
import { Textarea } from "@/components/ui/Textarea"
import { Dropzone } from "@/components/ui/Dropzone"
import { toast } from "@/lib/toast"
import {
  uploadOnlineRequirementDocument,
  submitOnlineRepositoryDocument,
  validateOnlineRequirementUpload,
  type OnlineAaccupTask,
} from "@/services/aaccup"
import { RepositoryDocumentPicker } from "@/components/aaccup/RepositoryDocumentPicker"
import type { Document } from "@/types/domain"
import { cn } from "@/lib/utils"

// =============================================================================
// TaskSubmitDialog — submit evidence into an assigned task. Shared by the
// user "My Tasks" tab and the admin area details modal so both surfaces act
// identically.
// =============================================================================

interface TaskSubmitDialogProps {
  task: OnlineAaccupTask | null
  onClose: () => void
  onSubmitted?: () => void
}

export function TaskSubmitDialog({ task, onClose, onSubmitted }: TaskSubmitDialogProps) {
  const [title, setTitle] = useState(task?.requirementTitle ?? task?.title ?? "")
  const [file, setFile] = useState<File | null>(null)
  const [repositoryDocument, setRepositoryDocument] = useState<Document | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [uploading, setUploading] = useState(false)
  const [validationMessages, setValidationMessages] = useState<string[]>([])

  useEffect(() => {
    setTitle(task?.requirementTitle ?? task?.title ?? "")
    setFile(null)
    setRepositoryDocument(null)
    setRemarks("")
    setValidationMessages([])
  }, [task])

  const handleSubmit = async () => {
    if (!task || !task.requirementId || (!file && !repositoryDocument) || !title.trim()) return
    setUploading(true)
    setValidationMessages([])
    try {
      if (repositoryDocument) {
        await submitOnlineRepositoryDocument({
          requirementId: task.requirementId,
          documentId: repositoryDocument.id,
          taskId: task.id,
          remarks: remarks.trim() || undefined,
        })
        toast.success("Repository document submitted for this task")
        onSubmitted?.()
        onClose()
        return
      }
      if (!file) return
      const input = {
        requirementId: task.requirementId,
        departmentId: task.departmentId ?? "",
        title: title.trim(),
        areaName: task.areaName,
        requirementCode: task.requirementCode ?? undefined,
        taskId: task.id,
        file,
        remarks: remarks.trim() || undefined,
      }
      const validation = await validateOnlineRequirementUpload(input)
      if (!validation.valid) {
        const messages = validation.errors.map((issue) => issue.message)
        setValidationMessages(messages)
        toast.error(`Evidence upload failed: ${messages.join(" ")}`)
        return
      }
      if (validation.warnings.length > 0) {
        toast.warning(validation.warnings.map((issue) => issue.message).join(" "))
      }
      await uploadOnlineRequirementDocument(input)
      toast.success("Evidence submitted for this task")
      onSubmitted?.()
      onClose()
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed"
      setValidationMessages([message])
      toast.error(message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={Boolean(task)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{task?.mySubmission ? "Resubmit Evidence" : "Submit Evidence"}</DialogTitle>
          <DialogDescription>
            {task?.title} ({task?.requirementCode})
            {task?.mySubmission && " — This version will need a new admin approval."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[68vh] space-y-4 overflow-y-auto py-3">
          <div className="space-y-2">
            <Label>Document Title</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Evidence source</Label>
            {repositoryDocument ? (
              <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-primary-50 p-3"><FileText className="h-5 w-5 shrink-0 text-primary-600" /><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium text-blue-900">{repositoryDocument.name}</p><p className="text-[11px] text-blue-700">Selected from My Documents</p></div><Button type="button" size="sm" variant="outline" onClick={() => setRepositoryDocument(null)}>Change</Button></div>
            ) : (
              <>
                <Dropzone
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.csv,.txt"
                  onChange={(files) => { setFile(files[0] ?? null); setRepositoryDocument(null) }}
                />
                <div className="flex items-center gap-2"><span className="h-px flex-1 bg-slate-200" /><span className="text-[10px] uppercase tracking-wider text-slate-400">or</span><span className="h-px flex-1 bg-slate-200" /></div>
                <Button type="button" variant="outline" className="w-full" onClick={() => setPickerOpen(true)}><FileText className="mr-2 h-4 w-4" />Choose from My Documents</Button>
              </>
            )}
          </div>
          <div className="space-y-2">
            <Label>Remarks</Label>
            <Textarea
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              placeholder="Optional context for the reviewer"
            />
          </div>
          {validationMessages.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3">
              {validationMessages.map((message) => (
                <p key={message} className={cn("text-[12px] text-red-700")}>{message}</p>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={uploading || (!file && !repositoryDocument) || !title.trim() || !task?.requirementId}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {uploading ? "Submitting..." : repositoryDocument ? "Submit Selected Document" : "Upload and Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
      <RepositoryDocumentPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={(document) => { setRepositoryDocument(document); setFile(null) }} />
    </Dialog>
  )
}
