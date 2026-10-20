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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select"
import { toast } from "@/lib/toast"
import {
  uploadOnlineRequirementDocument,
  submitOnlineRepositoryDocument,
  validateOnlineRequirementUpload,
  listOnlineRequirements,
  type OnlineAaccupTask,
  type OnlineAaccupRequirement,
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
  const [requirements, setRequirements] = useState<OnlineAaccupRequirement[]>([])
  const [selectedRequirementId, setSelectedRequirementId] = useState("")
  const [loadingRequirements, setLoadingRequirements] = useState(false)
  const requirementId = task?.requirementId ?? selectedRequirementId
  const selectedRequirement = requirements.find((item) => item.id === requirementId)

  useEffect(() => {
    setTitle(task?.requirementTitle ?? task?.title ?? "")
    setFile(null)
    setRepositoryDocument(null)
    setRemarks("")
    setValidationMessages([])
    setPickerOpen(false)
    setSelectedRequirementId(task?.mySubmission?.requirementId ?? "")
    setRequirements([])
    if (!task || task.requirementId) {
      setLoadingRequirements(false)
      return
    }
    let active = true
    setLoadingRequirements(true)
    void listOnlineRequirements(task.areaId).then((items) => {
      if (!active) return
      setRequirements(items)
      if (task.mySubmission?.requirementId && !items.some((item) => item.id === task.mySubmission?.requirementId)) setSelectedRequirementId("")
      if (!task.mySubmission?.requirementId && items.length === 1) setSelectedRequirementId(items[0].id)
      if (!items.length) setValidationMessages(["This area has no active evidence requirements. Ask an administrator to add one before uploading."])
    }).catch((err) => {
      if (active) setValidationMessages([err instanceof Error ? err.message : "Unable to load evidence requirements"])
    }).finally(() => { if (active) setLoadingRequirements(false) })
    return () => { active = false }
  }, [task])

  const handleSubmit = async () => {
    if (!task || !requirementId || uploading || (!file && !repositoryDocument) || !title.trim()) return
    setUploading(true)
    setValidationMessages([])
    try {
      if (repositoryDocument) {
        await submitOnlineRepositoryDocument({
          requirementId,
          documentId: repositoryDocument.id,
          taskId: task.id,
          remarks: remarks.trim() || undefined,
        })
        toast.success("Repository document submitted for this task")
        window.dispatchEvent(new Event("urs:notifications-updated"))
        onSubmitted?.()
        onClose()
        return
      }
      if (!file) return
      const input = {
        requirementId,
        departmentId: task.departmentId ?? "",
        title: title.trim(),
        areaName: task.areaName,
        requirementCode: task.requirementCode ?? selectedRequirement?.documentCode ?? undefined,
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
      window.dispatchEvent(new Event("urs:notifications-updated"))
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
    <Dialog open={Boolean(task)} onOpenChange={(open) => { if (!open && !uploading) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{task?.mySubmission ? "Resubmit Evidence" : "Submit Evidence"}</DialogTitle>
          <DialogDescription>
            {task?.title}{task?.requirementCode ? ` (${task.requirementCode})` : " — select the evidence requirement for your upload."}
            {task?.mySubmission && " — This version will need a new admin approval."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[68vh] space-y-4 overflow-y-auto py-3">
          {task && !task.requirementId && (
            <div className="space-y-2">
              <Label htmlFor="task-evidence-requirement">Evidence requirement</Label>
              <Select value={selectedRequirementId} onValueChange={setSelectedRequirementId} disabled={uploading || loadingRequirements}>
                <SelectTrigger id="task-evidence-requirement"><SelectValue placeholder={loadingRequirements ? "Loading requirements..." : "Select an evidence requirement"} /></SelectTrigger>
                <SelectContent>
                  {requirements.map((item) => <SelectItem key={item.id} value={item.id}>{item.documentCode} — {item.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
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
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.csv,.txt,.mp4"
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
          <Button variant="outline" onClick={onClose} disabled={uploading}>Cancel</Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={uploading || loadingRequirements || (!file && !repositoryDocument) || !title.trim() || !requirementId}
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
