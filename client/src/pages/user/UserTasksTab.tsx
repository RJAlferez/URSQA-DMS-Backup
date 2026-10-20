import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useSearchParams } from "react-router-dom"
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Flag,
  RefreshCw,
  Upload,
  Undo2,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { EmptyState } from "@/components/ui/EmptyState"
import { Skeleton } from "@/components/ui/Skeleton"
import { toast } from "@/lib/toast"
import { notificationService } from "@/services/notifications"
import { useAuth } from "@/context/AuthContext"
import { hasServerPermission } from "@/lib/permissions"
import {
  listMyOnlineTasks,
  listOnlineTasks,
  updateOnlineTask,
  unsubmitOnlineSubmission,
  type OnlineAaccupTask,
} from "@/services/aaccup"
import { TaskSubmitDialog } from "@/components/aaccup/TaskSubmitDialog"

// =============================================================================
// UserTasksTab — "My Tasks" inside the AACCUP group. Shows the tasks
// assigned to the current user (or their department). Assigned work is ready
// for direct upload without a manual Start step. Shared with the admin group tab.
// =============================================================================

function taskStatusBadge(status: OnlineAaccupTask["status"]) {
  switch (status) {
    case "COMPLETED": return <Badge variant="success">Completed</Badge>
    case "IN_PROGRESS": return <Badge variant="default">In Progress</Badge>
    case "CANCELLED": return <Badge variant="danger">Cancelled</Badge>
    default: return <Badge variant="default">Ready to submit</Badge>
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

export function UserTasksTab({ navigation }: { navigation?: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id
  const manager = hasServerPermission(user, "aaccup.manage")
  const [searchParams] = useSearchParams()
  const [tasks, setTasks] = useState<OnlineAaccupTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [submitTask, setSubmitTask] = useState<OnlineAaccupTask | null>(null)

  const load = useCallback(async (background = false) => {
    if (!userId) return
    if (!background) setLoading(true)
    setError(null)
    try {
      setTasks(await (manager ? listOnlineTasks() : listMyOnlineTasks()))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load your tasks")
    } finally {
      if (!background) setLoading(false)
    }
  }, [manager, userId])

  useEffect(() => {
    void load()
    const refresh = () => { void load(true) }
    const poll = setInterval(refresh, 30_000)
    window.addEventListener("focus", refresh)
    window.addEventListener("urs:notifications-updated", refresh)
    return () => {
      clearInterval(poll)
      window.removeEventListener("focus", refresh)
      window.removeEventListener("urs:notifications-updated", refresh)
    }
  }, [load])

  const handleComplete = async (task: OnlineAaccupTask) => {
    setUpdatingId(task.id)
    try {
      await updateOnlineTask(task.id, { status: "COMPLETED" })
      toast.success("Task marked as completed")
      void notificationService.refreshUnread()
      window.dispatchEvent(new Event("urs:notifications-updated"))
      await load()
    } catch (changeError) {
      toast.error(changeError instanceof Error ? changeError.message : "Failed to update task")
    } finally {
      setUpdatingId(null)
    }
  }

  const actionable = (task: OnlineAaccupTask) => task.status === "OPEN" || task.status === "IN_PROGRESS"
  const handleUnsubmit = async (task: OnlineAaccupTask) => {
    if (!window.confirm("Unsubmit your work? Any previous approval will no longer apply. After you upload again, an admin must approve the new submission.")) return
    setUpdatingId(task.id)
    try {
      if (task.mySubmission && ["PENDING", "APPROVED", "NEEDS_REVISION"].includes(task.mySubmission.status)) {
        await unsubmitOnlineSubmission(task.mySubmission.id, undefined, task.id)
      } else {
        await updateOnlineTask(task.id, { status: "IN_PROGRESS" })
      }
      toast.success("Work unsubmitted. Your admin has been notified; you can update and resubmit.")
      await load()
    } catch (unsubmitError) {
      toast.error(unsubmitError instanceof Error ? unsubmitError.message : "Unable to unsubmit your work")
    } finally {
      setUpdatingId(null)
    }
  }
  const taskFilter = searchParams.get("taskFilter")
  const highlightTaskId = searchParams.get("highlight")
  const visibleTasks = tasks.filter((task) => {
    if (task.id === highlightTaskId) return true
    if (taskFilter === "completed") return task.status === "COMPLETED"
    if (taskFilter === "overdue") return task.status !== "COMPLETED" && task.status !== "CANCELLED" && Boolean(task.dueDate) && new Date(task.dueDate!).getTime() < Date.now()
    if (taskFilter === "due-soon") {
      const due = task.dueDate ? new Date(task.dueDate).getTime() : NaN
      return task.status !== "COMPLETED" && task.status !== "CANCELLED" && Number.isFinite(due) && due >= Date.now() && due <= Date.now() + 7 * 24 * 60 * 60 * 1000
    }
    return true
  })

  useEffect(() => {
    if (!highlightTaskId || loading) return
    document.getElementById(`task-${highlightTaskId}`)?.scrollIntoView({ block: "center" })
  }, [highlightTaskId, visibleTasks.length, loading])

  return (
    <div className="content-padding">
      <PageHeader
        title={manager ? "Tasks" : "My Tasks"}
        description={manager ? "Monitor tasks assigned across users and departments." : "Tasks assigned to you or your department — submit evidence and track progress."}
        actions={
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        }
      />
      {navigation && <div className="mb-6 lg:mb-8">{navigation}</div>}

      {error && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div>
              <p className="text-[13px] font-semibold text-red-900">Tasks unavailable</p>
              <p className="mt-1 text-[12px] text-red-700">{error}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button>
        </div>
      )}

      <div className="grid gap-4">
        {loading ? (
          Array.from({ length: 3 }, (_, index) => <Skeleton key={index} variant="rectangular" className="h-28" />)
        ) : visibleTasks.length === 0 ? (
          <Card className="border-slate-200/70">
            <CardContent className="p-8">
              <EmptyState
                variant="tasks"
                title="No tasks assigned"
                description="When an admin or QAO assigns a task to you or your department, it will appear here."
              />
            </CardContent>
          </Card>
        ) : (
          visibleTasks.map((task) => {
            const canChange = actionable(task)
            const submission = task.mySubmission
            const hasSubmittedWork = Boolean(submission && ["PENDING", "APPROVED", "NEEDS_REVISION"].includes(submission.status))
            const assignedToMe = task.assigneeType === "USER" ? task.assigneeId === userId : Boolean(user?.departmentId && task.assigneeId === user.departmentId)
            const canUnsubmit = hasSubmittedWork || (task.status === "COMPLETED" && assignedToMe)
            return (
              <Card id={`task-${task.id}`} key={task.id} className={task.id === highlightTaskId ? "border-blue-400 shadow-md ring-2 ring-blue-100" : "border-slate-200/70 shadow-soft"}>
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
                        <ClipboardList className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[14px] font-semibold text-slate-900">{task.title}</p>
                          {taskStatusBadge(task.status)}
                          {submission && <Badge variant={submission.status === "APPROVED" ? "success" : submission.status === "WITHDRAWN" ? "secondary" : "warning"}>
                            {submission.status === "PENDING" ? "Awaiting approval" : submission.status === "APPROVED" ? "Approved" : submission.status === "WITHDRAWN" ? "Unsubmitted" : submission.status === "NEEDS_REVISION" ? "Returned for revision" : "Rejected"}
                          </Badge>}
                          <Badge
                            variant={task.priority === "URGENT" || task.priority === "HIGH" ? "warning" : "secondary"}
                            className="text-[10px]"
                          >
                            <Flag className="mr-1 h-3 w-3" />
                            {task.priority.charAt(0) + task.priority.slice(1).toLowerCase()}
                          </Badge>
                        </div>
                        <p className="mt-1 text-[12px] text-slate-500">
                          {task.areaName} · {task.areaSet} · Due {formatDate(task.dueDate)}
                        </p>
                        {manager && <p className="mt-1 text-[12px] text-slate-500">Assigned to: {task.assigneeLabel ?? "Unassigned"}</p>}
                        {task.description && (
                          <p className="mt-1.5 text-[12px] text-slate-600 line-clamp-2">{task.description}</p>
                        )}
                        {submission && <p className="mt-1.5 truncate text-[12px] text-slate-500">Your evidence: {submission.documentTitle}</p>}
                        {task.requirementTemplateName ? (
                          <p className="mt-1.5 text-[11px] text-primary-700">
                            Complete requirement template: {task.requirementTemplateName} (v{task.requirementTemplateVersion})
                          </p>
                        ) : task.requirementTitle && (
                          <p className="mt-1.5 text-[11px] text-slate-400">
                            Evidence requirement: {task.requirementCode} — {task.requirementTitle}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {canUnsubmit && <Button size="sm" variant="outline" disabled={updatingId === task.id} onClick={() => void handleUnsubmit(task)}>
                        <Undo2 className="mr-1.5 h-3.5 w-3.5" />Unsubmit
                      </Button>}
                      {canChange && !task.requirementId && !hasSubmittedWork && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          disabled={updatingId === task.id}
                          onClick={() => void handleComplete(task)}
                        >
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                          Mark Complete
                        </Button>
                      )}
                      {canChange && !hasSubmittedWork ? (
                        <Button size="sm" className="shadow-soft" disabled={updatingId === task.id} onClick={() => setSubmitTask(task)}>
                          <Upload className="mr-1.5 h-3.5 w-3.5" />
                          {submission ? "Resubmit Evidence" : "Upload Evidence"}
                        </Button>
                      ) : (
                        canChange && !task.requirementId && (
                          <Badge variant="secondary" className="text-[10px]">
                            {hasSubmittedWork ? "Awaiting review" : "Select a requirement when uploading"}
                          </Badge>
                        )
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      <TaskSubmitDialog
        task={submitTask}
        onClose={() => setSubmitTask(null)}
        onSubmitted={() => void load()}
      />
    </div>
  )
}
