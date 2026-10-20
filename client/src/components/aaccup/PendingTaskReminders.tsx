import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ClipboardList, Clock3 } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { hasServerPermission } from "@/lib/permissions"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/Button"
import { Card, CardContent } from "@/components/ui/Card"
import { listMyOnlineTasks, listOnlineTasks, type OnlineAaccupTask } from "@/services/aaccup"

/** Live work reminders are independent of whether assignment alerts were read. */
export function PendingTaskReminders() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const manager = hasServerPermission(user, "aaccup.manage")
  const canRead = manager || hasServerPermission(user, "aaccup.read")
  const [tasks, setTasks] = useState<OnlineAaccupTask[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !canRead) return
    let active = true
    let inFlight = false
    setTasks([])
    setLoading(true)
    const refresh = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const items = await (manager ? listOnlineTasks() : listMyOnlineTasks())
        if (!active) return
        setTasks(items.filter((task) =>
          ["OPEN", "IN_PROGRESS"].includes(task.status) &&
          (manager || !task.mySubmission || !["PENDING", "APPROVED"].includes(task.mySubmission.status)),
        ).sort((a, b) => {
          const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity
          const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity
          return aDue - bDue || b.createdAt.localeCompare(a.createdAt)
        }))
        setError(null)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Unable to load task reminders")
      } finally {
        inFlight = false
        if (active) setLoading(false)
      }
    }
    const onUpdate = () => { void refresh() }
    onUpdate()
    const poll = setInterval(onUpdate, 30_000)
    window.addEventListener("focus", onUpdate)
    window.addEventListener("urs:notifications-updated", onUpdate)
    return () => {
      active = false
      clearInterval(poll)
      window.removeEventListener("focus", onUpdate)
      window.removeEventListener("urs:notifications-updated", onUpdate)
    }
  }, [user, canRead, manager])

  if (!canRead) return null
  const taskUrl = (id?: string) => `${manager ? "" : "/user"}/aaccup?tab=tasks${id ? `&highlight=${encodeURIComponent(id)}` : ""}`

  return (
    <section className="mb-6" aria-labelledby="pending-task-reminders">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 id="pending-task-reminders" className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <ClipboardList className="size-4 text-primary" />
            {manager ? "Active assigned tasks" : "Your pending tasks"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">Reading a notification does not complete a task.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate(taskUrl())}>{manager ? "View tasks" : "My Tasks"}</Button>
      </div>
      {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}
      {loading ? <p className="text-sm text-slate-500">Loading tasks...</p> : tasks.length === 0 ? (
        <p className="text-sm text-slate-500">No pending tasks.</p>
      ) : (
        <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {tasks.map((task) => {
            const overdue = Boolean(task.dueDate && new Date(task.dueDate).getTime() < Date.now())
            return (
              <Card key={task.id} className={cn("shadow-none", overdue && "border-amber-300 dark:border-amber-800")}>
                <CardContent className="p-0">
                  <button type="button" onClick={() => navigate(taskUrl(task.id))} className="w-full rounded-xl p-4 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-slate-800">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{task.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{task.areaName}{manager ? ` · ${task.assigneeLabel ?? "Unassigned"}` : ""}</p>
                    <p className={cn("mt-2 flex items-center gap-1.5 text-xs", overdue ? "font-medium text-amber-700 dark:text-amber-400" : "text-slate-600 dark:text-slate-300")}>
                      <Clock3 className="size-3.5 shrink-0" />
                      {task.dueDate ? `${overdue ? "Overdue" : "Due"}: ${new Date(task.dueDate).toLocaleString()}` : "No deadline set"}
                    </p>
                  </button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}
