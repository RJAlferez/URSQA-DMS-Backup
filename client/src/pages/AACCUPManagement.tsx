import { useState, useEffect, type ReactNode } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  Search,
  Filter,
  Download,
  Award,
  CheckCircle,
  Clock,
  AlertCircle,
  TrendingUp,
  FileText,
  Calendar,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  Loader2,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { StatCard } from "@/components/layout/StatCard"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Badge } from "@/components/ui/Badge"
import { Avatar, AvatarFallback } from "@/components/ui/Avatar"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/Dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select"
import { AACCUPAreaDetailsModal } from "@/components/modals/AACCUPAreaDetailsModal"
import { CreateTaskModal } from "@/components/modals/CreateTaskModal"
import { AddSubmissionModal } from "@/components/modals/AddSubmissionModal"
import { AddAreaModal } from "@/components/modals/AddAreaModal"
import { useAuth } from "@/context/AuthContext"
import {
  listAllOnlineAaccupAreas,
  listAllOnlineSubmissions,
  archiveOnlineArea,
  exportApprovedSubmissionsZip,
  type OnlineAaccupArea,
  type OnlineSubmissionListItem,
  type AreaSet,
} from "@/services/aaccup"
import { cn } from "@/lib/utils"

interface AACCUPArea {
  id: number
  serverId: string
  title: string
  description: string
  status: "Completed" | "In Progress" | "Pending" | "Overdue"
  completion: number
  dueDate: string
  departmentId: string
  isActive: boolean
}

interface AACCUPManagementProps {
  areaSet?: AreaSet
  navigation?: ReactNode
}

const statusColors = {
  Completed: "bg-emerald-500",
  "In Progress": "bg-primary-500",
  Pending: "bg-amber-500",
  Overdue: "bg-red-500",
}

const statusBadge = {
  Completed: "success",
  "In Progress": "default",
  Pending: "warning",
  Overdue: "danger",
} as const

const SET_TITLES: Record<AreaSet, { title: string; description: string }> = {
  AACCUP: {
    title: "AACCUP Management",
    description: "Manage accreditation areas, submissions, and compliance tracking",
  },
  ISO: {
    title: "ISO 21001:2025",
    description: "Manage ISO accreditation areas, submissions, and compliance tracking",
  },
}

export default function AACCUPManagement({ areaSet = "AACCUP", navigation }: AACCUPManagementProps) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canExportPackage = user?.role === "root" || user?.role === "super_admin"
  const setMeta = SET_TITLES[areaSet]
  const [searchParams, setSearchParams] = useSearchParams()
  const [areas, setAreas] = useState<OnlineAaccupArea[]>([])
  const [submissions, setSubmissions] = useState<OnlineSubmissionListItem[]>([])
  const [selectedArea] = useState<AACCUPArea | null>(null)
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(() => searchParams.get("modal") === "create-task")
  const [isAddSubmissionOpen, setIsAddSubmissionOpen] = useState(false)
  const [isAddAreaModalOpen, setIsAddAreaModalOpen] = useState(false)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [exportAreaIds, setExportAreaIds] = useState<string[]>([])
  const [isExporting, setIsExporting] = useState(false)
  const [editingArea, setEditingArea] = useState<{
    id: string
    name: string
    description: string
    departmentId: string
    isActive: boolean
  } | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [detailsReloadKey, setDetailsReloadKey] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [areaFilter, setAreaFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [submissionFilter, setSubmissionFilter] = useState("all")

  useEffect(() => {
    fetchData()
    const poll = setInterval(fetchData, 20000)
    return () => clearInterval(poll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchData = async () => {
    const [areasData, submissionsData] = await Promise.all([
      listAllOnlineAaccupAreas({ areaSet }),
      listAllOnlineSubmissions({ areaSet })
    ])
    setAreas(areasData)
    setSubmissions(submissionsData)
  }

  const handleCloseCreateTaskModal = (open: boolean) => {
    setIsCreateTaskOpen(open)
    if (!open) {
      searchParams.delete("modal")
      setSearchParams(searchParams)
    }
  }

  const handleRemoveArea = async (id: string, title: string) => {
    if (!window.confirm(`Remove area "${title}"? Its tasks and submissions stay in the archive but it will no longer appear.`)) return
    try {
      await archiveOnlineArea(id)
      setSelectedIds((prev) => prev.filter((selected) => selected !== id))
      fetchData()
    } catch {
      window.alert("Failed to remove area. Please try again.")
    }
  }

  const handleRemoveSelected = async () => {
    if (selectedIds.length === 0) return
    if (!window.confirm(`Remove ${selectedIds.length} selected area(s)?`)) return
    try {
      await Promise.all(selectedIds.map((id) => archiveOnlineArea(id)))
      setSelectedIds([])
      fetchData()
    } catch {
      window.alert("Failed to remove one or more areas.")
    }
  }

  const handleExport = () => {
    const header = ["Area", "Status", "Completion %", "Submissions", "Approved", "Pending"]
    const rows = localAreas.map((area) => {
      const areaSubs = submissions.filter((s) => s.areaId === area.serverId)
      return [
        `"${area.title}"`,
        area.status,
        area.completion,
        areaSubs.length,
        areaSubs.filter((s) => s.status === "APPROVED").length,
        areaSubs.filter((s) => s.status === "PENDING" || s.status === "NEEDS_REVISION").length,
      ].join(",")
    })
    const csv = [header.join(","), ...rows].join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `${areaSet.toLowerCase()}-areas-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const openExportModal = () => {
    setExportAreaIds(areas.map((area) => area.id))
    setIsExportOpen(true)
  }

  const handleDownloadApprovedZip = async () => {
    if (exportAreaIds.length === 0) return
    setIsExporting(true)
    try {
      const { filename, blob } = await exportApprovedSubmissionsZip(exportAreaIds, areaSet)
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
      setIsExportOpen(false)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Export failed.")
    } finally {
      setIsExporting(false)
    }
  }

  const toLocalArea = (area: OnlineAaccupArea, index: number): AACCUPArea => {
    const areaSubs = submissions.filter(s => s.areaId === area.id)
    const completed = areaSubs.filter(s => s.status === "APPROVED").length
    const completion = areaSubs.length > 0 ? Math.round((completed / areaSubs.length) * 100) : 0
    const codeNumber = Number(area.code?.match(/\d+/)?.[0])
    const status: AACCUPArea["status"] =
      area.status === "INACTIVE" || areaSubs.length === 0
        ? "Pending"
        : completed === areaSubs.length
        ? "Completed"
        : "In Progress"
    return {
      id: Number.isFinite(codeNumber) ? codeNumber : index + 1,
      serverId: area.id,
      title: area.name,
      description: area.description ?? "",
      status,
      completion,
      dueDate: area.accreditationCycleName ?? area.updatedAt.slice(0, 10),
      departmentId: area.departmentId,
      isActive: area.status === "ACTIVE",
    }
  }

  const localAreas = areas.map((area, index) => toLocalArea(area, index))

  const filteredAreas = localAreas.filter((area) => {
    if (searchQuery) {
      const areaSubs = submissions.filter((s) => s.areaId === area.serverId)
      const haystack = [
        area.title,
        area.description,
        `Area ${area.id}`,
        ...areaSubs.map((s) => `${s.requirementTitle} ${s.documentTitle} ${s.submittedByName ?? ""}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      if (!haystack.includes(searchQuery.toLowerCase())) return false
    }
    if (areaFilter !== "all" && area.id.toString() !== areaFilter) return false
    if (statusFilter !== "all") {
      const normalized = statusFilter === "in-progress" ? "in progress" : statusFilter
      if (area.status.toLowerCase() !== normalized) return false
    }
    if (submissionFilter !== "all") {
      const areaSubs = submissions.filter((s) => s.areaId === area.serverId)
      const approved = areaSubs.filter((s) => s.status === "APPROVED").length
        const pending = areaSubs.filter((s) => s.status === "PENDING").length
        const returned = areaSubs.filter((s) => s.status === "NEEDS_REVISION" || s.status === "REJECTED").length
      if (submissionFilter === "approved" && approved === 0) return false
      if (submissionFilter === "pending" && pending === 0) return false
      if (submissionFilter === "returned" && returned === 0) return false
    }
    return true
  })

  const toEditableArea = (area: AACCUPArea) => ({
    id: area.serverId,
    name: area.title,
    description: area.description,
    departmentId: area.departmentId,
    isActive: area.isActive,
  })

  const handleViewArea = (area: AACCUPArea) => {
    const basePath = areaSet === "ISO" ? "/iso" : "/aaccup"
    navigate(`${basePath}/areas/${encodeURIComponent(area.serverId)}`)
  }

  const totalSubmissions = submissions.length
  const completedSubmissions = submissions.filter(s => s.status === "APPROVED").length
  const pendingSubmissions = submissions.filter(s => s.status === "PENDING").length

  const calculateOverallCompliance = () => {
    if (localAreas.length === 0) return 0
    const totalCompletion = localAreas.reduce((sum, area) => sum + area.completion, 0)
    return Math.round(totalCompletion / localAreas.length)
  }

  return (
    <>
      <div className="content-padding">
        <PageHeader
          title={setMeta.title}
          description={setMeta.description}
          actions={
            <>
              {canExportPackage && (
                <Button variant="outline" className="shadow-soft" onClick={openExportModal}>
                  <Download className="w-4 h-4 mr-2" />
                  Export Approved ZIP
                </Button>
              )}
              <Button className="shadow-soft" onClick={() => setIsAddAreaModalOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Area
              </Button>
            </>
          }
          />

          {navigation && <div className="mb-6 lg:mb-8">{navigation}</div>}

          <div className="grid grid-cols-2 lg:grid-cols-4 responsive-gap mb-6 lg:mb-8">
            <StatCard
              title="Total Submissions"
              value={totalSubmissions.toString()}
              icon={<Award className="w-5 h-5" />}
            />
            <StatCard
              title="Approved"
              value={completedSubmissions.toString()}
              icon={<CheckCircle className="w-5 h-5" />}
              trend={{
                value: totalSubmissions > 0 ? Math.round((completedSubmissions / totalSubmissions) * 100) : 0,
                positive: completedSubmissions > 0,
              }}
            />
            <StatCard
              title="Pending Review"
              value={pendingSubmissions.toString()}
              icon={<Clock className="w-5 h-5" />}
              trend={{
                value: totalSubmissions > 0 ? Math.round((pendingSubmissions / totalSubmissions) * 100) : 0,
                positive: false,
              }}
            />
            <StatCard
              title="Compliance Rate"
              value={`${calculateOverallCompliance()}%`}
              icon={<TrendingUp className="w-5 h-5" />}
            />
          </div>

          <Card className="border-border/70 shadow-soft mb-6">
            <CardContent className="p-0">
              <div className="toolbar-padding flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="flex-1">
                  <div className="relative max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      placeholder="Search areas or submissions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-10 h-10 bg-navy-50/40 border-0 hover:bg-navy-50 focus:bg-white focus:ring-1.5 focus:ring-primary/25"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Select value={areaFilter} onValueChange={setAreaFilter}>
                    <SelectTrigger className="w-[140px] h-10">
                      <Filter className="w-3.5 h-3.5 mr-2" />
                      <SelectValue placeholder="Area" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Areas</SelectItem>
                      {localAreas.map((area) => (
                        <SelectItem key={area.id} value={area.id.toString()}>
                          Area {area.id}: {area.title.substring(0, 20)}...
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[130px] h-10">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="in-progress">In Progress</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={submissionFilter} onValueChange={setSubmissionFilter}>
                    <SelectTrigger className="w-[150px] h-10">
                      <SelectValue placeholder="Submission" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Submissions</SelectItem>
                      <SelectItem value="approved">Approved</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="returned">Returned</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" className="h-10" onClick={handleExport}>
                    <Download className="w-4 h-4 mr-2" />
                    Export
                  </Button>
                  {(searchQuery || areaFilter !== "all" || statusFilter !== "all" || submissionFilter !== "all") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-10 text-gray-500"
                      onClick={() => {
                        setSearchQuery("")
                        setAreaFilter("all")
                        setStatusFilter("all")
                        setSubmissionFilter("all")
                      }}
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Reset
                    </Button>
                  )}
                  {selectedIds.length > 0 && (
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-10"
                      onClick={handleRemoveSelected}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Remove Selected ({selectedIds.length})
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {filteredAreas.length === 0 && (
              <div className="col-span-full py-10 text-center">
                <p className="text-[14px] text-gray-500">No areas match your filters.</p>
              </div>
            )}
            {filteredAreas.map((area) => {
              const areaSubs = submissions.filter(s => s.areaId === area.serverId)
              const stats = {
                total: areaSubs.length,
                completed: areaSubs.filter(s => s.status === "APPROVED").length,
                 pending: areaSubs.filter(s => s.status === "PENDING").length,
                 returned: areaSubs.filter(s => s.status === "NEEDS_REVISION" || s.status === "REJECTED").length
              }

              return (
                <Card
                  key={area.id}
                  className={cn(
                    "border-border/70 shadow-soft hover:shadow-lift transition-shadow cursor-pointer flex flex-col h-full",
                    selectedIds.includes(area.serverId) && "ring-2 ring-primary/40"
                  )}
                  onClick={() => handleViewArea(area)}
                >
                  <CardContent className="flex flex-1 flex-col p-5 text-center md:p-6">
                    <div className="mb-5 flex items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
                        <input
                          type="checkbox"
                          className="w-4 h-4 shrink-0 rounded border-gray-300 accent-primary cursor-pointer"
                          checked={selectedIds.includes(area.serverId)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => {
                            const { checked } = e.target
                            setSelectedIds((prev) =>
                              checked
                                ? [...prev, area.serverId]
                                : prev.filter((id) => id !== area.serverId)
                            )
                          }}
                        />
                        <div className={cn(
                          "w-10 h-10 rounded-xl shrink-0 flex items-center justify-center text-white font-bold text-[14px]",
                          statusColors[area.status]
                        )}>
                          {area.id}
                        </div>
                        <div className="min-w-0 text-center">
                          <h3 className="text-[14px] font-semibold text-gray-900 truncate">Area {area.id}</h3>
                          <p className="text-[12px] text-gray-500 line-clamp-1">{area.title}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant={statusBadge[area.status]} className="text-[10px]">
                          {area.status}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingArea(toEditableArea(area))
                            setIsAddAreaModalOpen(true)
                          }}                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-400 hover:text-red-600 hover:bg-red-50"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRemoveArea(area.serverId, area.title)
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="mb-5">
                      <div className="mb-2 flex items-center justify-center gap-3">
                        <span className="text-[12px] text-gray-500">Progress</span>
                        <span className="text-[14px] font-semibold text-primary">{area.completion}%</span>
                      </div>
                      <div className="w-full h-2 bg-navy-50 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", statusColors[area.status])}
                          style={{ width: `${area.completion}%` }}
                        />
                      </div>
                    </div>

                    <div className="mb-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-gray-500">
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5" />
                        <span>{stats.total} Submissions</span>
                      </div>
                      <div className="flex items-center justify-center gap-3.5">
                        <span className="flex items-center gap-1.5">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                          {stats.completed}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-amber-500" />
                          {stats.pending}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                          {stats.returned}
                        </span>
                      </div>
                    </div>

                    <div className="mt-auto flex items-center justify-center gap-5 border-t border-gray-100 pt-4">
                      <div className="flex -space-x-2 min-w-0">
                        {[...new Set(areaSubs.map(s => s.submittedByName).filter((name): name is string => Boolean(name)))].slice(0, 3).map((name, i) => (
                          <Avatar key={i} className="h-7 w-7 border-2 border-white bg-primary/10">
                            <AvatarFallback className="text-[10px] text-primary font-medium">
                              {name.split(" ").map(n => n[0]).join("")}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {areaSubs.length > 3 && (
                          <div className="w-7 h-7 rounded-full bg-gray-100 border-2 border-white flex items-center justify-center">
                            <span className="text-[10px] text-gray-500">+{areaSubs.length - 3}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[12px] text-gray-500 shrink-0">
                        <Calendar className="w-3.5 h-3.5" />
                        <span>{area.dueDate}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
</div>

      <AACCUPAreaDetailsModal
        key={detailsReloadKey}
        open={isDetailsOpen}
        onOpenChange={setIsDetailsOpen}
        area={selectedArea}
        areaSet={areaSet}
        onAddSubmission={() => setIsAddSubmissionOpen(true)}
        onCreateTask={() => setIsCreateTaskOpen(true)}
        onEditArea={() => {
          setIsDetailsOpen(false)
          if (selectedArea) setEditingArea(toEditableArea(selectedArea))
          setIsAddAreaModalOpen(true)
        }}
      />

      <AddSubmissionModal
        open={isAddSubmissionOpen}
        onOpenChange={setIsAddSubmissionOpen}
        areaId={selectedArea?.serverId}
        areaTitle={selectedArea?.title}
        areaSet={areaSet}
        departmentId={areas.find((a) => a.id === selectedArea?.serverId)?.departmentId}
        onSuccess={() => {
          setIsAddSubmissionOpen(false)
          setDetailsReloadKey((k) => k + 1)
          fetchData()
        }}
      />

      <CreateTaskModal
        open={isCreateTaskOpen}
        onOpenChange={handleCloseCreateTaskModal}
        areaId={selectedArea?.serverId}
        areaTitle={selectedArea?.title}
        onSuccess={() => {
          handleCloseCreateTaskModal(false)
          setDetailsReloadKey((k) => k + 1)
          fetchData()
        }}
      />

      <AddAreaModal
        open={isAddAreaModalOpen}
        onOpenChange={(open) => {
          setIsAddAreaModalOpen(open)
          if (!open) setEditingArea(null)
        }}
        areaSet={areaSet.toLowerCase() as "aaccup" | "iso"}
        area={editingArea}
        onSuccess={() => {
          setEditingArea(null)
          fetchData()
        }}
      />

      <Dialog open={isExportOpen} onOpenChange={setIsExportOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Export Approved Submissions</DialogTitle>
            <DialogDescription>
              Downloads a ZIP of every approved submission for the selected areas, grouped into one
              folder per area with the exact submitted document versions. ROOT and ADMINISTRATOR only.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
            {areas.length === 0 && (
              <p className="py-4 text-center text-[13px] text-gray-500">No areas found.</p>
            )}
            {areas.map((area) => (
              <label
                key={area.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-100 px-3 py-2 hover:bg-gray-50"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 cursor-pointer rounded border-gray-300 accent-primary"
                  checked={exportAreaIds.includes(area.id)}
                  onChange={(e) => {
                    setExportAreaIds((prev) =>
                      e.target.checked ? [...prev, area.id] : prev.filter((id) => id !== area.id),
                    )
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-gray-900">{area.name}</p>
                  <p className="text-[11px] text-gray-500">{area.code}</p>
                </div>
              </label>
            ))}
          </div>
          <DialogFooter className="mt-5">
            <Button variant="outline" size="sm" onClick={() => setIsExportOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isExporting || exportAreaIds.length === 0}
              onClick={() => void handleDownloadApprovedZip()}
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              {isExporting ? "Building archive…" : `Download ZIP (${exportAreaIds.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
