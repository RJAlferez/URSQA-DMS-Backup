import { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react"
import { AACCUPAreaDetailsModal } from "@/components/modals/AACCUPAreaDetailsModal"
import { AddAreaModal } from "@/components/modals/AddAreaModal"
import { AddSubmissionModal } from "@/components/modals/AddSubmissionModal"
import { CreateTaskModal } from "@/components/modals/CreateTaskModal"
import { Button } from "@/components/ui/Button"
import { getOnlineArea, listAllOnlineSubmissions, type AreaSet, type OnlineAaccupArea, type OnlineSubmissionListItem } from "@/services/aaccup"

function areaNumber(area: OnlineAaccupArea): number {
  const match = area.code.match(/\d+/)
  return match ? Number(match[0]) : 1
}

export default function AdminAreaDetailPage({ areaSet }: { areaSet: AreaSet }) {
  const navigate = useNavigate()
  const { areaId } = useParams<{ areaId: string }>()
  const [area, setArea] = useState<OnlineAaccupArea | null>(null)
  const [submissions, setSubmissions] = useState<OnlineSubmissionListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<"not-found" | "forbidden" | "error" | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [createTaskOpen, setCreateTaskOpen] = useState(false)
  const [addSubmissionOpen, setAddSubmissionOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    if (!areaId) {
      setError("not-found")
      setLoading(false)
      return () => { active = false }
    }
    void getOnlineArea(areaId)
      .then(async (result) => {
        if (!active) return
        if (result.areaSet !== areaSet) {
          setError("not-found")
          return
        }
        setArea(result)
        try {
          setSubmissions(await listAllOnlineSubmissions({ areaId, areaSet }))
        } catch {
          // The workspace has its own scoped loaders and empty states; a
          // transient summary/list failure must not hide a valid area.
          setSubmissions([])
        }
      })
      .catch((reason: unknown) => {
        if (!active) return
        const message = reason instanceof Error ? reason.message.toLowerCase() : ""
        setError(message.includes("access") || message.includes("forbidden") ? "forbidden" : "not-found")
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [areaId, areaSet])

  const backPath = areaSet === "ISO" ? "/iso" : "/aaccup"
  const setTitle = areaSet === "ISO" ? "ISO" : "AACCUP"

  if (loading) {
    return <div className="flex min-h-[420px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
  }

  if (error || !area) {
    return (
      <div className="content-padding">
        <div className="mx-auto flex max-w-lg flex-col items-center rounded-xl border border-border bg-white p-10 text-center shadow-soft">
          <AlertTriangle className="mb-3 h-8 w-8 text-amber-500" />
          <h1 className="text-lg font-semibold text-gray-900">{error === "forbidden" ? "You do not have access to this Area" : "Area not found"}</h1>
          <p className="mt-1 text-sm text-gray-500">The requested {setTitle} area is unavailable.</p>
          <Button className="mt-5" onClick={() => navigate(backPath)}>Back to {setTitle}</Button>
        </div>
      </div>
    )
  }

  const number = areaNumber(area)
  const approved = submissions.filter((submission) => submission.status === "APPROVED").length
  const completion = submissions.length > 0 ? Math.round((approved / submissions.length) * 100) : 0
  const pageArea = {
    id: number,
    serverId: area.id,
    title: area.name,
    description: area.description ?? "",
    status: completion === 100 && submissions.length > 0 ? "Completed" as const : submissions.length > 0 ? "In Progress" as const : "Pending" as const,
    completion,
    dueDate: area.accreditationCycleName ?? area.updatedAt.slice(0, 10),
  }

  return (
    <div className="content-padding">
      <nav className="mb-4 flex items-center gap-1.5 text-[13px] text-gray-500" aria-label="Breadcrumb">
        <button type="button" onClick={() => navigate(backPath)} className="font-medium text-primary hover:underline">{setTitle}</button>
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="truncate text-gray-700">Area {number}: {area.name}</span>
      </nav>

      <AACCUPAreaDetailsModal
        key={`${area.id}-${reloadKey}`}
        open
        page
        onOpenChange={() => navigate(backPath)}
        area={pageArea}
        areaSet={areaSet}
        onAddSubmission={() => setAddSubmissionOpen(true)}
        onCreateTask={() => setCreateTaskOpen(true)}
        onEditArea={() => setEditOpen(true)}
      />

      <AddSubmissionModal
        open={addSubmissionOpen}
        onOpenChange={setAddSubmissionOpen}
        areaId={area.id}
        areaTitle={area.name}
        areaSet={areaSet}
        departmentId={area.departmentId}
        onSuccess={() => {
          setAddSubmissionOpen(false)
          setReloadKey((key) => key + 1)
        }}
      />
      <CreateTaskModal
        open={createTaskOpen}
        onOpenChange={setCreateTaskOpen}
        areaId={area.id}
        areaTitle={area.name}
        onSuccess={() => {
          setCreateTaskOpen(false)
          setReloadKey((key) => key + 1)
        }}
      />
      <AddAreaModal
        open={editOpen}
        onOpenChange={setEditOpen}
        areaSet={areaSet.toLowerCase() as "aaccup" | "iso"}
        area={{ id: area.id, name: area.name, description: area.description ?? "", departmentId: area.departmentId, isActive: area.status === "ACTIVE" }}
        onSuccess={() => {
          setEditOpen(false)
          setReloadKey((key) => key + 1)
          void getOnlineArea(area.id).then(setArea).catch(() => undefined)
        }}
      />
    </div>
  )
}
