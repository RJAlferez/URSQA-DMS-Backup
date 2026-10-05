import React, { useCallback, useState, useEffect } from "react"
import { useSearchParams } from "react-router-dom"
import {
  Plus,
  Upload,
  ChevronDown,
  ChevronRight,
  FileText,
  Calendar,
  CheckCircle,
  Clock,
  AlertCircle,
  TrendingUp,
  Activity,
  X,
  Pencil,
  RotateCcw,
  XCircle,
  FileCheck2,
  Trash2,
} from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog"
import { Button } from "@/components/ui/Button"
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
  listAllOnlineSubmissions,
  listOnlineAreaRequirements,
  listOnlineAreaTasks,
  reviewOnlineSubmission,
  archiveOnlineRequirement,
  updateOnlineTask,
  type OnlineAaccupRequirement,
  type OnlineAaccupTask,
  type OnlineSubmissionListItem,
} from "@/services/aaccup"
import { ReturnSubmissionModal } from "@/components/modals/ReturnSubmissionModal"
import { RequirementModal } from "@/components/modals/RequirementModal"
import { TaskSubmitDialog } from "@/components/aaccup/TaskSubmitDialog"
import { FilePreviewModal } from "@/components/preview/FilePreviewModal"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import { hasPermission } from "@/lib/permissions"
import type { Document, DocumentStatus } from "@/types/domain"

interface AACCUPArea {
  id: number
  serverId: string
  title: string
  description: string
  status: "Completed" | "In Progress" | "Pending" | "Overdue"
  completion: number
  dueDate: string
}

interface AACCUPAreaDetailsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  area: AACCUPArea | null
  areaSet?: "AACCUP" | "ISO"
  onAddSubmission: () => void
  onCreateTask: () => void
  onEditArea?: () => void
  page?: boolean
}

interface AreaSubmission {
  id: string
  title: string
  fileName: string
  fileSize: string
  submittedBy: string
  department: string
  dateSubmitted: string
  status: "Approved" | "Pending" | "Returned" | "Rejected" | "Withdrawn"
}

const submissionStatusVariant: Record<AreaSubmission["status"], "success" | "warning" | "danger"> = {
  Approved: "success",
  Pending: "warning",
  Returned: "danger",
  Rejected: "danger",
  Withdrawn: "warning",
}

const areaStatusVariant = {
  Completed: "success",
  "In Progress": "default",
  Pending: "warning",
  Overdue: "danger",
} as const

const statusLabel: Record<OnlineSubmissionListItem["status"], AreaSubmission["status"]> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  NEEDS_REVISION: "Returned",
  WITHDRAWN: "Withdrawn",
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

const EmptyState = ({ icon: Icon, message }: { icon: React.ElementType; message: string }) => (
  <div className="flex flex-col items-center justify-center py-6 text-center">
    <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center mb-2">
      <Icon className="w-5 h-5 text-gray-400" />
    </div>
    <p className="text-[13px] text-gray-500">{message}</p>
  </div>
)

export function AACCUPAreaDetailsModal({
  open,
  onOpenChange,
  area,
  areaSet = "AACCUP",
  onAddSubmission,
  onCreateTask,
  onEditArea,
  page = false,
}: AACCUPAreaDetailsModalProps) {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const canManageTasks = Boolean(user && hasPermission(user.role, "canManageAACCUP"))
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [view, setView] = useState<"submissions" | "tasks" | "requirements">(() => {
    const tab = searchParams.get("tab")
    return tab === "tasks" || tab === "requirements" ? tab : "submissions"
  })
  const [submissions, setSubmissions] = useState<AreaSubmission[]>([])
  const [rawSubmissions, setRawSubmissions] = useState<OnlineSubmissionListItem[]>([])
  const [tasks, setTasks] = useState<OnlineAaccupTask[]>([])
  const [requirements, setRequirements] = useState<OnlineAaccupRequirement[]>([])
  const [isRequirementModalOpen, setIsRequirementModalOpen] = useState(false)
  const [editingRequirement, setEditingRequirement] = useState<OnlineAaccupRequirement | null>(null)
  const [stats, setStats] = useState({ completed: 0, pending: 0, returned: 0, total: 0 })
  const [isReturnModalOpen, setIsReturnModalOpen] = useState(false)
  const [returnTarget, setReturnTarget] = useState<{ id: string; title: string } | null>(null)
  const [submitTask, setSubmitTask] = useState<OnlineAaccupTask | null>(null)
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null)
  const [previewDocument, setPreviewDocument] = useState<Document | null>(null)

  useEffect(() => {
    if (!page) return
    const tab = searchParams.get("tab")
    if ((tab === "submissions" || tab === "tasks" || tab === "requirements") && tab !== view) setView(tab)
  }, [page, searchParams, view])

  const changeView = (next: "submissions" | "tasks" | "requirements") => {
    setView(next)
    if (page) {
      const nextParams = new URLSearchParams(searchParams)
      nextParams.set("tab", next)
      setSearchParams(nextParams, { replace: true })
    }
  }

  const loadSubmissions = useCallback(() => {
    if (!area) return
    listAllOnlineSubmissions({ areaId: area.serverId, areaSet })
      .then((items) => {
        setRawSubmissions(items)
        const mapped: AreaSubmission[] = items.map((submission) => ({
          id: submission.id,
          title: submission.requirementTitle,
          fileName: submission.documentTitle,
          fileSize: "",
          submittedBy: submission.submittedByName ?? "Unknown",
          department: submission.departmentName ?? "—",
          dateSubmitted: formatDate(submission.submittedAt),
          status: statusLabel[submission.status],
        }))
        setSubmissions(mapped)
        setStats({
          completed: items.filter((s) => s.status === "APPROVED").length,
          pending: items.filter((s) => s.status === "PENDING").length,
          returned: items.filter((s) => s.status === "NEEDS_REVISION" || s.status === "REJECTED").length,
          total: items.length,
        })
      })
      .catch(() => {
        setSubmissions([])
        setRawSubmissions([])
        setStats({ completed: 0, pending: 0, returned: 0, total: 0 })
      })
  }, [area, areaSet])

  useEffect(() => {
    if (!open || !area) return
    setSubmissions([])
    setStats({ completed: 0, pending: 0, returned: 0, total: 0 })
    setTasks([])
    setRequirements([])
    loadSubmissions()
    listOnlineAreaTasks(area.serverId)
      .then(setTasks)
      .catch(() => setTasks([]))
    listOnlineAreaRequirements(area.serverId)
      .then(setRequirements)
      .catch(() => setRequirements([]))
  }, [open, area, loadSubmissions])

  const loadRequirements = () => {
    if (!area) return
    listOnlineAreaRequirements(area.serverId)
      .then(setRequirements)
      .catch(() => setRequirements([]))
  }

  const handleArchiveRequirement = async (requirement: OnlineAaccupRequirement) => {
    if (!window.confirm(`Archive requirement "${requirement.title}"? It will no longer accept submissions.`)) return
    try {
      await archiveOnlineRequirement(requirement.id)
      loadRequirements()
    } catch {
      window.alert("Failed to archive the requirement. Please try again.")
    }
  }

  const handleTaskStatusChange = async (task: OnlineAaccupTask, status: "IN_PROGRESS" | "COMPLETED") => {
    setUpdatingTaskId(task.id)
    try {
      await updateOnlineTask(task.id, { status })
      const next = await listOnlineAreaTasks(task.areaId)
      setTasks(next)
    } catch {
      window.alert("Failed to update the task status.")
    } finally {
      setUpdatingTaskId(null)
    }
  }

  const taskStatusLabel: Record<OnlineAaccupTask["status"], string> = {
    OPEN: "Open",
    IN_PROGRESS: "In Progress",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  }

  const handleReview = async (submissionId: string, decision: "APPROVED" | "REJECTED") => {
    if (!submissionId) return
    if (decision === "REJECTED" && !window.confirm("Reject this submission? This closes the review.")) return
    try {
      await reviewOnlineSubmission(submissionId, { decision })
      loadSubmissions()
    } catch {
      window.alert("Review action failed. Please try again.")
    }
  }

  const handleReturn = (submissionId: string, submissionTitle: string) => {
    setExpandedRow(null)
    setReturnTarget({ id: submissionId, title: submissionTitle })
    setIsReturnModalOpen(true)
  }

  const closeReturnModal = () => {
    setIsReturnModalOpen(false)
    setReturnTarget(null)
    loadSubmissions()
  }

  if (!area) return null

  const recentActivity = submissions.map((submission) => ({
    user: submission.submittedBy,
    action: `submitted "${submission.title}"`,
    time: submission.dateSubmitted,
  }))
  const completion = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : area.completion

  const content = (
    <>
      <div className={cn(
        "flex flex-col overflow-hidden",
        page ? "min-h-[calc(100vh-9rem)] rounded-xl border border-border/70 bg-white shadow-soft" : "h-full",
      )}>
        <DialogHeader className="px-6 py-4 border-b border-gray-100 flex-shrink-0 bg-white relative">
          <div className="flex items-center justify-between gap-4 pr-12">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-gray-900 flex items-center justify-center text-white font-bold text-[14px] flex-shrink-0">
                {area.id}
              </div>
              <div className="min-w-0">
                {page ? (
                  <h1 className="text-lg font-semibold text-gray-900 truncate">Area {area.id}: {area.title}</h1>
                ) : (
                  <DialogTitle className="text-lg truncate">Area {area.id}: {area.title}</DialogTitle>
                )}
                <div className="flex items-center gap-3 mt-1.5">
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full"
                         style={{ width: `${completion}%` }}
                      />
                    </div>
                     <span className="text-[13px] font-medium text-primary">{completion}%</span>
                  </div>
                  <Badge variant={areaStatusVariant[area.status]} className="text-[10px] flex-shrink-0">
                    {area.status}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="flex max-w-full flex-wrap items-center justify-end gap-2 flex-shrink-0">
              {canManageTasks && onEditArea && (
                <Button variant="outline" size="sm" className="h-9" onClick={onEditArea}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit
                </Button>
              )}
              {canManageTasks && (
                <Button variant="outline" size="sm" className="h-9" onClick={onCreateTask}>
                  <Plus className="w-4 h-4 mr-2" />
                  New Task
                </Button>
              )}
              <Button size="sm" className="h-9 shadow-soft" onClick={onAddSubmission}>
                <Upload className="w-4 h-4 mr-2" />
                Add Submission
              </Button>
            </div>
          </div>
          {!page && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </DialogHeader>

        <div className="flex-1 flex overflow-hidden bg-gray-50/50">
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-6 py-3 bg-white border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-4 mb-3">
                <div className="flex rounded-lg border border-border p-1 bg-gray-50/50">
                  <button
                   type="button"
                     onClick={() => changeView("submissions")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors",
                       view === "submissions" ? "bg-white text-gray-900 shadow-soft" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                     <FileText className="w-3.5 h-3.5" />
                     Submissions ({submissions.length})
                  </button>
                  <button
                    type="button"
                     onClick={() => changeView("tasks")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors",
                      view === "tasks" ? "bg-white text-gray-900 shadow-soft" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Tasks ({tasks.length})
                  </button>
                  <button
                    type="button"
                     onClick={() => changeView("requirements")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors",
                      view === "requirements" ? "bg-white text-gray-900 shadow-soft" : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    <FileCheck2 className="w-3.5 h-3.5" />
                    Requirements ({requirements.length})
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[12px]">
                <span className="flex items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-1.5 font-medium text-emerald-700">
                  <CheckCircle className="h-4 w-4 text-emerald-600" /> {stats.completed} Approved
                </span>
                <span className="flex items-center gap-1.5 rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-1.5 font-medium text-amber-700">
                  <Clock className="h-4 w-4 text-amber-600" /> {stats.pending} Pending
                </span>
                <span className="flex items-center gap-1.5 rounded-lg border border-red-100 bg-red-50/70 px-3 py-1.5 font-medium text-red-700">
                  <AlertCircle className="h-4 w-4 text-red-600" /> {stats.returned} Returned
                </span>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {view === "requirements" ? (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-[14px] font-semibold text-gray-900">Submission Requirements</h3>
                      <p className="text-[12px] text-gray-500">
                        {requirements.some((r) => r.sourceTemplateId || r.sourceNodeId)
                          ? "This area is managed by the Root Requirement Builder — manage requirements there."
                          : "Users submit evidence against these requirements."}
                      </p>
                    </div>
                    {canManageTasks && !requirements.some((r) => r.sourceTemplateId || r.sourceNodeId) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() => {
                          setEditingRequirement(null)
                          setIsRequirementModalOpen(true)
                        }}
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Requirement
                      </Button>
                    )}
                  </div>
                  <div className="bg-white rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent bg-gray-50/50">
                          <TableHead>Requirement</TableHead>
                          <TableHead>Code</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {requirements.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6}>
                              <EmptyState icon={FileCheck2} message="No requirements for this area yet" />
                            </TableCell>
                          </TableRow>
                        ) : (
                          requirements.map((requirement) => (
                            <TableRow key={requirement.id} className="border-b border-gray-100">
                              <TableCell>
                                <p className="text-[14px] font-medium text-gray-900">{requirement.title}</p>
                                {requirement.description && (
                                  <p className="text-[12px] text-gray-500 mt-0.5 line-clamp-1">{requirement.description}</p>
                                )}
                              </TableCell>
                              <TableCell>
                                <span className="font-mono text-[12px] text-gray-600">{requirement.documentCode}</span>
                              </TableCell>
                              <TableCell className="text-[13px] text-gray-600">
                                {requirement.category ?? "—"}
                              </TableCell>
                              <TableCell>
                                {requirement.isRequired ? (
                                  <Badge variant="warning" className="text-[11px]">Required</Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-[11px]">Optional</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={requirement.status === "ACTIVE" ? "success" : "secondary"}
                                  className="text-[11px]"
                                >
                                  {requirement.status === "ACTIVE" ? "Active" : "Inactive"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {canManageTasks && !requirement.sourceTemplateId && !requirement.sourceNodeId ? (
                                  <div className="flex items-center justify-end gap-0.5">
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-gray-500 hover:text-gray-700 hover:bg-gray-100"
                                      title="Edit"
                                      onClick={() => {
                                        setEditingRequirement(requirement)
                                        setIsRequirementModalOpen(true)
                                      }}
                                    >
                                      <Pencil className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-gray-400 hover:text-red-600 hover:bg-red-50"
                                      title="Archive"
                                      onClick={() => void handleArchiveRequirement(requirement)}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-gray-400">
                                    {requirement.sourceTemplateId ? "Builder-managed" : "—"}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : view === "tasks" ? (
                <div className="bg-white rounded-lg border border-border">
                  <Table>
                      <TableHeader>
                      <TableRow className="hover:bg-transparent bg-gray-50/50">
                        <TableHead>Task</TableHead>
                        <TableHead>Requirement</TableHead>
                        <TableHead>Assigned To</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead>Status</TableHead>
                        {canManageTasks && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tasks.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={canManageTasks ? 7 : 6}>
                            <EmptyState icon={CheckCircle} message="No tasks for this area yet" />
                          </TableCell>
                        </TableRow>
                      ) : (
                        tasks.map((task) => {
                          const actionable = task.status === "OPEN" || task.status === "IN_PROGRESS"
                          return (
                          <TableRow key={task.id} className="border-b border-gray-100">
                            <TableCell>
                              <p className="text-[14px] font-medium text-gray-900">{task.title}</p>
                              {task.description && (
                                <p className="text-[12px] text-gray-500 mt-0.5 line-clamp-1">{task.description}</p>
                              )}
                            </TableCell>
                            <TableCell>
                              {task.requirementTitle ? (
                                <div>
                                  <p className="text-[13px] text-gray-700">{task.requirementTitle}</p>
                                  <p className="text-[11px] text-gray-500">{task.requirementCode}</p>
                                </div>
                              ) : (
                                <span className="text-[12px] text-gray-400">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Avatar className="h-7 w-7">
                                  <AvatarFallback className="text-[11px] bg-gray-100 text-gray-700">
                                    {(task.assigneeLabel ?? "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="text-[13px] text-gray-700">{task.assigneeLabel ?? "Unassigned"}</p>
                                  <p className="text-[11px] text-gray-500">{task.assigneeType === "DEPARTMENT" ? "Department" : "User"}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={task.priority === "URGENT" || task.priority === "HIGH" ? "warning" : "secondary"} className="text-[11px]">
                                {task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-[13px] text-gray-600">
                              {task.dueDate ? formatDate(task.dueDate) : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  task.status === "COMPLETED" ? "success" :
                                  task.status === "IN_PROGRESS" ? "default" :
                                  task.status === "CANCELLED" ? "danger" : "warning"
                                }
                                className="text-[11px]"
                              >
                                {taskStatusLabel[task.status]}
                              </Badge>
                            </TableCell>
                            {canManageTasks && (
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {actionable && task.status === "OPEN" && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 text-[12px]"
                                      disabled={updatingTaskId === task.id}
                                      onClick={() => void handleTaskStatusChange(task, "IN_PROGRESS")}
                                    >
                                      Start
                                    </Button>
                                  )}
                                  {actionable && task.status === "IN_PROGRESS" && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-8 text-[12px] border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                      disabled={updatingTaskId === task.id}
                                      onClick={() => void handleTaskStatusChange(task, "COMPLETED")}
                                    >
                                      Mark Complete
                                    </Button>
                                  )}
                                  {actionable && task.requirementId && (
                                    <Button
                                      size="sm"
                                      className="h-8 text-[12px] shadow-soft"
                                      onClick={() => setSubmitTask(task)}
                                    >
                                      Submit Evidence
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="bg-white rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent bg-gray-50/50">
                      <TableHead className="w-6"></TableHead>
                      <TableHead>Submission</TableHead>
                      <TableHead>Submitted By</TableHead>
                      <TableHead>Date Submitted</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submissions.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6}>
                          <EmptyState icon={FileText} message="No submissions for this area yet" />
                        </TableCell>
                      </TableRow>
                    ) : (
                      submissions.map((submission) => (
                        <React.Fragment key={submission.id}>
              <TableRow
                onDoubleClick={() => {
                  const raw = rawSubmissions.find((item) => item.id === submission.id)
                  if (!raw) return
                  setPreviewDocument({
                    id: raw.documentId,
                    name: raw.documentTitle,
                    type: raw.documentTitle.split(".").pop()?.toUpperCase() || "FILE",
                    categoryId: raw.requirementId,
                    categoryName: raw.requirementCode,
                    area: raw.areaName,
                    department: raw.departmentName ?? "Unassigned",
                    ownerId: raw.submittedById ?? "",
                    ownerName: raw.submittedByName ?? "Unknown",
                    size: 0,
                    status: (raw.status === "APPROVED" ? "Approved" : raw.status === "REJECTED" ? "Rejected" : raw.status === "NEEDS_REVISION" ? "Returned" : "Pending") as DocumentStatus,
                    blobId: `online:${raw.documentId}`,
                    currentVersionId: "",
                    versionCount: 1,
                    archived: false,
                    dateModified: raw.submittedAt,
                    dateCreated: raw.submittedAt,
                     mimeType: mimeTypeForFilename(raw.documentTitle),
                    tags: [],
                    createdAt: raw.submittedAt,
                    updatedAt: raw.submittedAt,
                  })
                }}
                className={cn(
                              "border-b border-gray-100 transition-colors cursor-pointer hover:bg-gray-50/50",
                              expandedRow === submission.id && "bg-primary/5"
                            )}
                          >
                            <TableCell>
                              <button
                                onClick={() => setExpandedRow(expandedRow === submission.id ? null : submission.id)}
                                className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                              >
                                {expandedRow === submission.id ? (
                                  <ChevronDown className="w-4 h-4 text-gray-500" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-gray-500" />
                                )}
                              </button>
                            </TableCell>
                            <TableCell>
                              <div>
                                <p className="text-[14px] font-medium text-gray-900">{submission.title}</p>
                                <div className="flex items-center gap-3 mt-1">
                                  <span className="flex items-center gap-1 text-[12px] text-gray-500">
                                    <FileText className="w-3 h-3" />
                                    {submission.fileName}
                                  </span>
                                  <span className="text-[12px] text-gray-400">{submission.fileSize}</span>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Avatar className="h-7 w-7">
                                  <AvatarFallback className="text-[11px] bg-gray-100 text-gray-700">
                                    {submission.submittedBy.split(" ").map(n => n[0]).join("")}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="text-[13px] text-gray-700">{submission.submittedBy}</p>
                                  <p className="text-[11px] text-gray-500">{submission.department}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5 text-[13px] text-gray-600">
                                <Calendar className="w-3.5 h-3.5" />
                                {submission.dateSubmitted}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant={submissionStatusVariant[submission.status]} className="text-[11px]">
                                {submission.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-0.5">
                                {(() => {
                                  const raw = rawSubmissions.find((s) => s.id === submission.id)
                                   const reviewable = canManageTasks && raw?.status === "PENDING"
                                  return (
                                    <>
                                      {reviewable && (
                                        <>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-emerald-600 hover:bg-emerald-50"
                                            title="Approve"
                                            onClick={() => void handleReview(submission.id, "APPROVED")}
                                          >
                                            <CheckCircle className="w-4 h-4" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-amber-600 hover:bg-amber-50"
                                            title="Return for revision"
                                            onClick={() => handleReturn(submission.id, submission.title)}
                                          >
                                            <RotateCcw className="w-4 h-4" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-red-600 hover:bg-red-50"
                                            title="Reject"
                                            onClick={() => void handleReview(submission.id, "REJECTED")}
                                          >
                                            <XCircle className="w-4 h-4" />
                                          </Button>
                                        </>
                                      )}
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 text-[13px] text-primary hover:text-primary"
                                        onClick={() => setExpandedRow(expandedRow === submission.id ? null : submission.id)}
                                      >
                                        {expandedRow === submission.id ? "Hide" : "View"}
                                      </Button>
                                    </>
                                  )
                                })()}
                              </div>
                            </TableCell>
                          </TableRow>

                          {expandedRow === submission.id && (
                            <TableRow key={`${submission.id}-expanded`} className="bg-gray-50/50">
                              <TableCell colSpan={6}>
                                <div className="p-5 pl-12 grid grid-cols-3 gap-6">
                                  <div>
                                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2">Document Details</p>
                                    <p className="text-[14px] text-gray-700 leading-relaxed">
                                      {submission.title} submitted to Area {area.id}: {area.title}
                                    </p>
                                    <p className="text-[13px] text-gray-500 mt-2">
                                      File: {submission.fileName} ({submission.fileSize})
                                    </p>
                                  </div>

                                  <div>
                                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-3">File Information</p>
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2">
                                        <FileText className="w-4 h-4 text-gray-400" />
                                        <span className="text-[13px] text-gray-700">{submission.fileName}</span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <Calendar className="w-4 h-4 text-gray-400" />
                                        <span className="text-[13px] text-gray-700">Submitted: {submission.dateSubmitted}</span>
                                      </div>
                                    </div>

                                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mt-4 mb-2">Department</p>
                                    <p className="text-[13px] text-gray-700">{submission.department}</p>
                                  </div>

                                  <div>
                                    <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-3">Activity</p>
                                    <div className="space-y-3">
                                      <div className="flex items-start gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5" />
                                        <div>
                                          <p className="text-[13px] text-gray-700">
                                            <span className="font-medium">{submission.submittedBy}</span> submitted this document
                                          </p>
                                          <p className="text-[11px] text-gray-400">{submission.dateSubmitted}</p>
                                        </div>
                                      </div>
                                      <div className="flex items-start gap-2">
                                        <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5" />
                                        <div>
                                          <p className="text-[13px] text-gray-700">
                                            Document under review by {submission.department}
                                          </p>
                                          <p className="text-[11px] text-gray-400">Awaiting review</p>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
              )}
            </div>
          </div>

          <div
            className={cn(
              "w-72 border-l border-border bg-white flex-shrink-0 flex flex-col transition-all duration-200",
              isPanelCollapsed && "w-10"
            )}
          >
            <div className="p-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              {!isPanelCollapsed && (
                <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Summary</p>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setIsPanelCollapsed(!isPanelCollapsed)}
              >
                <ChevronRight className={cn("w-4 h-4 transition-transform", !isPanelCollapsed && "rotate-180")} />
              </Button>
            </div>

            {!isPanelCollapsed && (
              <div className="flex-1 overflow-auto p-4 space-y-4">
                <div className="p-4 rounded-xl bg-gray-50 border border-gray-100">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[13px] font-medium text-gray-700">Area Completion</span>
                     <span className="text-[20px] font-bold text-primary">{completion}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                     <div className="h-full bg-primary rounded-full" style={{ width: `${completion}%` }} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-lg bg-primary-50 border border-blue-100 text-center">
                    <p className="text-[18px] font-bold text-primary-600">{requirements.length}</p>
                    <p className="text-[11px] text-primary-600/80">Requirements</p>
                  </div>
                  <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-center">
                    <p className="text-[18px] font-bold text-indigo-600">{tasks.length}</p>
                    <p className="text-[11px] text-indigo-600/80">Tasks</p>
                  </div>
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-100 text-center">
                    <p className="text-[18px] font-bold text-amber-600">{tasks.filter((task) => task.status === "OPEN").length}</p>
                    <p className="text-[11px] text-amber-600/80">Open tasks</p>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100 text-center">
                    <p className="text-[18px] font-bold text-emerald-600">{tasks.filter((task) => task.status === "COMPLETED").length}</p>
                    <p className="text-[11px] text-emerald-600/80">Completed tasks</p>
                  </div>
                </div>

                <div className={cn(
                  "p-3 rounded-xl border",
                   completion >= 80 ? "bg-emerald-50 border-emerald-100" : "bg-amber-50 border-amber-100"
                )}>
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className={cn(
                      "w-4 h-4",
                       completion >= 80 ? "text-emerald-600" : "text-amber-600"
                    )} />
                    <span className={cn(
                      "text-[13px] font-medium",
                       completion >= 80 ? "text-emerald-700" : "text-amber-700"
                    )}>
                       {completion >= 80 ? "Ready for Review" : "In Progress"}
                    </span>
                  </div>
                  <p className={cn(
                    "text-[12px]",
                     completion >= 80 ? "text-emerald-600/80" : "text-amber-600/80"
                  )}>
                     {completion >= 80
                      ? "This area meets the minimum requirements for accreditation review."
                       : "Review the requirements and assign the remaining work."}
                  </p>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" />
                    Recent Activity
                  </p>
                  {recentActivity.length === 0 ? (
                    <EmptyState icon={Activity} message="No recent activity" />
                  ) : (
                    <div className="space-y-3">
                      {recentActivity.map((item, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5" />
                          <div>
                            <p className="text-[13px] text-gray-700">
                              <span className="font-medium">{item.user}</span> {item.action}
                            </p>
                            <p className="text-[11px] text-gray-400">{item.time}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <ReturnSubmissionModal
        open={isReturnModalOpen}
        onOpenChange={closeReturnModal}
        submissionId={returnTarget?.id ?? ""}
        submissionTitle={returnTarget?.title}
        onSuccess={closeReturnModal}
      />

      {area && (
        <RequirementModal
          open={isRequirementModalOpen}
          onOpenChange={setIsRequirementModalOpen}
          areaId={area.serverId}
          areaTitle={area.title}
          requirement={editingRequirement}
          onSuccess={() => {
            setEditingRequirement(null)
            loadRequirements()
          }}
        />
      )}

      <TaskSubmitDialog
        task={submitTask}
        onClose={() => setSubmitTask(null)}
        onSubmitted={() => {
          if (!area) return
          listOnlineAreaTasks(area.serverId)
            .then(setTasks)
            .catch(() => setTasks([]))
        }}
      />
      {previewDocument && (
        <FilePreviewModal
          document={previewDocument}
          onClose={() => setPreviewDocument(null)}
        />
      )}
    </>
  )

  if (page) return content

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[92vw] max-h-[90vh] w-[92vw] h-[90vh] p-0 overflow-hidden flex flex-col [&>button]:hidden">
        {content}
      </DialogContent>
    </Dialog>
  )
}

function mimeTypeForFilename(filename: string): string {
  const extension = filename.split(".").pop()?.toLowerCase()
  const types: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
  }
  return (extension && types[extension]) || "application/octet-stream"
}
