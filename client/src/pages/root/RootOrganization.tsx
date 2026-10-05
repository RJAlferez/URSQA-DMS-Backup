import { useEffect, useState, useCallback } from "react"
import {
  Search,
  RefreshCw,
  Plus,
  Edit3,
  History,
  Trash2,
  RotateCcw,
  Building2,
  Network,
  Layers,
  GraduationCap,
  MapPin,
  ChevronRight,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Textarea } from "@/components/ui/Textarea"
import { Badge } from "@/components/ui/Badge"
import { Label } from "@/components/ui/Label"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs"
import { toast } from "@/lib/toast"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/Pagination"
import {
  listOrgRecords,
  createOrgRecord,
  updateOrgRecord,
  archiveOrgRecord,
  restoreOrgRecord,
  listOrgVersions,
  rollbackOrgRecord,
  getOrganizationTree,
  type OrgEntity,
  type OrgRecord,
  type OrgVersion,
  type OrgWriteInput,
  type ProgramLevel,
  type OrgTreeNode,
  type OrganizationTree,
} from "@/services/root"
import { ApiRequestError } from "@/lib/http"

// =============================================================================
// URS-DMS — Root Console · Organization Management Engine
// -----------------------------------------------------------------------------
// Versioned master data for Campus → College → Programs / Offices
// with the version → history → rollback lifecycle. The Organization Tree tab
// renders the live hierarchy (campus → colleges → programs / offices +
// the Unassigned bucket). ROOT-only.
// =============================================================================

const PAGE_SIZE = 10

const ENTITIES: { id: OrgEntity; label: string; icon: React.ElementType; singular: string }[] = [
  { id: "campus", label: "Campuses", icon: MapPin, singular: "Campus" },
  { id: "college", label: "Colleges", icon: GraduationCap, singular: "College" },
  { id: "program", label: "Programs", icon: Layers, singular: "Program" },
  { id: "office", label: "Offices", icon: Building2, singular: "Office" },
]

const PROGRAM_LEVELS: ProgramLevel[] = [
  "UNDERGRADUATE",
  "GRADUATE",
  "DOCTORAL",
  "CERTIFICATE",
  "DIPLOMA",
]

const PROGRAM_LEVEL_COLORS: Record<ProgramLevel, "default" | "secondary" | "outline" | "success"> = {
  UNDERGRADUATE: "success",
  GRADUATE: "default",
  DOCTORAL: "default",
  CERTIFICATE: "secondary",
  DIPLOMA: "outline",
}

interface FormState {
  name: string
  code: string
  description: string
  level: ProgramLevel
  campusId: string
  collegeId: string
  departmentId: string
}

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  description: "",
  level: "UNDERGRADUATE",
  campusId: "",
  collegeId: "",
  departmentId: "",
}

// Radix Select disallows an empty-string item value (it uses "" to mean "clear
// the selection"). We use a sentinel for the "None" option and map it back to
// "" so the field just shows its placeholder when nothing is chosen.
const NONE_VALUE = "__none__"

export default function RootOrganization() {
  const [tab, setTab] = useState<OrgEntity>("campus")

  const [records, setRecords] = useState<OrgRecord[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState("")
  const [includeArchived, setIncludeArchived] = useState(false)
  const [campusFilter, setCampusFilter] = useState<string>("all")
  const [collegeFilter, setCollegeFilter] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [campuses, setCampuses] = useState<OrgRecord[]>([])
  const [colleges, setColleges] = useState<OrgRecord[]>([])

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<OrgRecord | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [versionTarget, setVersionTarget] = useState<OrgRecord | null>(null)
  const [versions, setVersions] = useState<OrgVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<OrgVersion | null>(null)

  const [tree, setTree] = useState<OrganizationTree | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)

  const entity = ENTITIES.find((e) => e.id === tab) ?? ENTITIES[0]

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listOrgRecords(tab, {
        page,
        pageSize: PAGE_SIZE,
        q: search.trim() || undefined,
        includeArchived: includeArchived || undefined,
        campusId: campusFilter !== "all" ? campusFilter : undefined,
        collegeId: collegeFilter !== "all" ? collegeFilter : undefined,
      })
      setRecords(result.items)
      setTotal(result.meta.total)
      setTotalPages(Math.max(1, result.meta.totalPages))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load records")
    } finally {
      setLoading(false)
    }
  }, [tab, page, search, includeArchived, campusFilter, collegeFilter])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setPage(1)
    setCampusFilter("all")
    setCollegeFilter("all")
    setSearch("")
    setIncludeArchived(false)
  }, [tab])

  useEffect(() => {
    void (async () => {
      try {
        const [c, l] = await Promise.all([
          listOrgRecords("campus", { pageSize: 200 }),
          listOrgRecords("college", { pageSize: 200 }),
        ])
        setCampuses(c.items)
        setColleges(l.items)
      } catch {
        // option lists are best-effort
      }
    })()
  }, [])

  const loadTree = useCallback(async () => {
    setTreeLoading(true)
    try {
      setTree(await getOrganizationTree())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load the organization tree")
    } finally {
      setTreeLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === "campus") void loadTree()
  }, [tab, loadTree])

  const isUnauthorized = (err: unknown) =>
    err instanceof ApiRequestError && err.status === 401

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  const openEdit = (record: OrgRecord) => {
    setEditing(record)
    setForm({
      name: record.name,
      code: record.code,
      description: record.description ?? "",
      level: record.level ?? "UNDERGRADUATE",
      campusId: record.campusId ?? "",
      collegeId: record.collegeId ?? "",
      departmentId: record.departmentId ?? "",
    })
    setFormOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error("Name and code are required")
      return
    }
    setSaving(true)
    // Only send the fields that apply to this entity. Fields that don't apply
    // are set to `undefined` (omitted by JSON.stringify) — not `null` — because
    // the backend schemas are `.strict()` and reject null parent keys.
    const input: OrgWriteInput = {
      name: form.name.trim(),
      code: form.code.trim(),
      description: form.description.trim() || null,
      level: tab === "program" ? form.level : undefined,
    }
    if (tab !== "campus" && form.campusId) input.campusId = form.campusId
    if ((tab === "office" || tab === "program") && form.collegeId)
      input.collegeId = form.collegeId
    try {
      if (editing) {
        const updated = await updateOrgRecord(tab, editing.id, input)
        toast.success(`${entity.singular} "${updated.name}" updated to v${updated.version}`)
      } else {
        const created = await createOrgRecord(tab, input)
        toast.success(`${entity.singular} "${created.name}" created`)
      }
      setFormOpen(false)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const handleArchive = async (record: OrgRecord) => {
    try {
      const archived = await archiveOrgRecord(tab, record.id)
      toast.success(`"${archived.name}" archived`)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Archive failed")
    }
  }

  const handleRestore = async (record: OrgRecord) => {
    try {
      const restored = await restoreOrgRecord(tab, record.id)
      toast.success(`"${restored.name}" restored`)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed")
    }
  }

  const openVersions = async (record: OrgRecord) => {
    setVersionTarget(record)
    setVersions([])
    setRollbackTarget(null)
    setVersionsLoading(true)
    try {
      setVersions(await listOrgVersions(tab, record.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load versions")
    } finally {
      setVersionsLoading(false)
    }
  }

  const handleRollback = async () => {
    if (!versionTarget || !rollbackTarget) return
    setSaving(true)
    try {
      const updated = await rollbackOrgRecord(tab, versionTarget.id, rollbackTarget.version)
      toast.success(`"${updated.name}" rolled back to v${rollbackTarget.version} (now v${updated.version})`)
      setVersionTarget(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rollback failed")
    } finally {
      setSaving(false)
    }
  }

  const availableColleges = colleges.filter(
    (c) => !form.campusId || c.campusId === form.campusId,
  )

  const parentCell = (record: OrgRecord) => {
    const bits: string[] = []
    if (record.campusName) bits.push(record.campusName)
    if (record.collegeName) bits.push(record.collegeName)
    if (bits.length === 0) return <span className="text-gray-400">—</span>
    return <span>{bits.join(" · ")}</span>
  }

  const renderTreeNode = (node: OrgTreeNode, depth: number) => {
    const hasChildren =
      node.colleges.length > 0 ||
      node.departments.length > 0 ||
      node.offices.length > 0 ||
      node.programs.length > 0
    return (
      <div key={node.id || node.name} style={{ marginLeft: depth * 20 }}>
        <div className="flex items-center gap-2 py-1.5">
          <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-[13px] font-medium text-gray-900">{node.name}</span>
          {node.code && <span className="text-[11px] text-gray-400">{node.code}</span>}
          {node.level && (
            <Badge variant={PROGRAM_LEVEL_COLORS[node.level]}>{node.level}</Badge>
          )}
          {!hasChildren && node.id && (
            <span className="text-[11px] text-gray-300">no children</span>
          )}
          {!node.id && (
            <span className="text-[11px] text-gray-400 italic">(unassigned)</span>
          )}
        </div>
        {node.colleges.map((c) => renderTreeNode(c, depth + 1))}
        {node.departments.map((d) => renderTreeNode(d, depth + 1))}
        {node.offices.map((o) => renderTreeNode(o, depth + 1))}
        {node.programs.map((p) => renderTreeNode(p, depth + 1))}
      </div>
    )
  }

  return (
    <div className="content-padding">
      <PageHeader
        title="Organization"
        description="Campuses, colleges, programs and offices — versioned master data managed by the system administrator"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} className="shadow-soft">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as OrgEntity)}>
        <TabsList className="mb-4 h-auto w-full justify-start overflow-x-auto p-1">
          {ENTITIES.map((e) => {
            const Icon = e.icon
            return (
              <TabsTrigger key={e.id} value={e.id} className="gap-2">
                <Icon className="w-4 h-4" />
                {e.label}
              </TabsTrigger>
            )
          })}
          <TabsTrigger value="tree" className="gap-2">
            <Network className="w-4 h-4" />
            Organization Tree
          </TabsTrigger>
        </TabsList>

        {ENTITIES.map((e) => (
          <TabsContent key={e.id} value={e.id}>
            <Card className="border-border/70 shadow-soft mb-4">
              <CardContent className="toolbar-padding flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <Input
                    className="h-10 pl-9"
                    placeholder={`Search ${e.label.toLowerCase()} by name or code…`}
                    value={search}
                    onChange={(ev) => {
                      setSearch(ev.target.value)
                      setPage(1)
                    }}
                  />
                </div>
                {e.id !== "campus" && (
                  <Select
                    value={campusFilter}
                    onValueChange={(v) => {
                      setCampusFilter(v)
                      setCollegeFilter("all")
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className="h-10 w-full sm:w-[190px]">
                      <SelectValue placeholder="Campus" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All campuses</SelectItem>
                      {campuses.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {(e.id === "office" || e.id === "program") && (
                  <Select
                    value={collegeFilter}
                    onValueChange={(v) => {
                      setCollegeFilter(v)
                      setPage(1)
                    }}
                  >
                    <SelectTrigger className="h-10 w-full sm:w-[190px]">
                      <SelectValue placeholder="College" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All colleges</SelectItem>
                      {colleges
                        .filter((c) => campusFilter === "all" || c.campusId === campusFilter)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  variant={includeArchived ? "default" : "outline"}
                  size="sm"
                  className="h-10 shadow-soft"
                  onClick={() => {
                    setIncludeArchived((v) => !v)
                    setPage(1)
                  }}
                >
                  {includeArchived ? "Showing archived" : "Show archived"}
                </Button>
                <Button className="h-10 shadow-soft" onClick={openCreate}>
                  <Plus className="w-4 h-4 mr-2" />
                  New {e.singular}
                </Button>
              </CardContent>
            </Card>

            {isUnauthorized(error) && !loading ? (
              <Card className="border-border/70 shadow-soft">
                <CardContent className="p-8 text-center text-[13px] text-gray-500">
                  Backend session expired — log out and sign back in as the ROOT user to reconnect.
                </CardContent>
              </Card>
            ) : (
              <Card className="border-border/70 shadow-soft">
                <CardContent className="p-0">
                  {loading ? (
                    <div className="min-h-[280px] flex items-center justify-center">
                      <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : records.length === 0 ? (
                    <div className="p-8 text-center text-[13px] text-gray-500">
                      No {e.label.toLowerCase()} found.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Code</TableHead>
                          {e.id !== "campus" && <TableHead>Campus / College</TableHead>}
                          {e.id === "program" && <TableHead>Level</TableHead>}
                          {e.id === "office" && <TableHead>Head</TableHead>}
                          <TableHead>Version</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Updated</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {records.map((record) => (
                          <TableRow key={record.id}>
                            <TableCell>
                              <div>
                                <div className="text-[13px] font-medium text-gray-900">{record.name}</div>
                                {record.description && (
                                  <div className="text-[12px] text-gray-500 max-w-[260px] truncate">
                                    {record.description}
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-[13px] text-gray-600">{record.code}</TableCell>
                            {e.id !== "campus" && (
                              <TableCell className="text-[13px] text-gray-600">{parentCell(record)}</TableCell>
                            )}
                            {e.id === "program" && record.level && (
                              <TableCell>
                                <Badge variant={PROGRAM_LEVEL_COLORS[record.level]}>
                                  {record.level}
                                </Badge>
                              </TableCell>
                            )}
                            {e.id === "office" && (
                              <TableCell className="text-[13px] text-gray-600">
                                {record.headName ?? <span className="text-gray-400">—</span>}
                              </TableCell>
                            )}
                            <TableCell className="text-[13px] text-gray-600">
                              {record.version > 0 ? `v${record.version}` : "—"}
                            </TableCell>
                            <TableCell>
                              {record.deletedAt ? (
                                <Badge variant="default">Archived</Badge>
                              ) : (
                                <Badge variant="success">Active</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-[12px] text-gray-500">
                              {new Date(record.updatedAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  title="Edit"
                                  onClick={() => openEdit(record)}
                                >
                                  <Edit3 className="w-4 h-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  title="Version history"
                                  onClick={() => void openVersions(record)}
                                >
                                  <History className="w-4 h-4" />
                                </Button>
                                {record.deletedAt ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700"
                                    title="Restore"
                                    onClick={() => void handleRestore(record)}
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                                    title="Archive (soft delete)"
                                    onClick={() => void handleArchive(record)}
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
                <div className="table-footer">
                  <span className="text-[12px] text-gray-500">
                    {total} {e.label.toLowerCase()}
                  </span>
                  <Pagination>
                    <PaginationContent>
                      <PaginationItem>
                        <PaginationPrevious
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          className={page <= 1 ? "pointer-events-none opacity-50" : ""}
                        />
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationLink isActive>{page}</PaginationLink>
                      </PaginationItem>
                      <PaginationItem>
                        <PaginationNext
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
                        />
                      </PaginationItem>
                    </PaginationContent>
                  </Pagination>
                  <span className="text-[12px] text-gray-500">
                    page {page} of {totalPages}
                  </span>
                </div>
              </Card>
            )}
          </TabsContent>
        ))}

        <TabsContent value="tree">
          <Card className="border-border/70 shadow-soft">
            <CardContent className="p-4 sm:p-6">
              {treeLoading ? (
                <div className="min-h-[280px] flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : !tree ? (
                <div className="p-8 text-center text-[13px] text-gray-500">
                  Failed to load the organization tree.
                </div>
              ) : tree.campuses.length === 0 && tree.unassigned.colleges.length === 0 &&
                tree.unassigned.departments.length === 0 &&
                tree.unassigned.offices.length === 0 && tree.unassigned.programs.length === 0 ? (
                <div className="p-8 text-center text-[13px] text-gray-500">
                  No organization records yet — create a campus to get started.
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                    Campuses ({tree.campuses.length})
                  </div>
                  {tree.campuses.map((c) => renderTreeNode(c, 0))}
                  {(tree.unassigned.colleges.length > 0 ||
                    tree.unassigned.departments.length > 0 ||
                    tree.unassigned.offices.length > 0 ||
                    tree.unassigned.programs.length > 0) && (
                    <>
                      <div className="text-[12px] font-semibold uppercase tracking-wider text-gray-400 mb-2 mt-6">
                        Unassigned
                      </div>
                      {renderTreeNode(tree.unassigned, 0)}
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Create / edit dialog ─────────────────────────────────────────────── */}
      {formOpen && (
        <Dialog open onOpenChange={(open) => !open && setFormOpen(false)}>
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[520px]">
            <DialogHeader className="pb-2">
              <DialogTitle className="text-lg">
                {editing ? `Edit ${entity.singular}` : `New ${entity.singular}`}
              </DialogTitle>
              <DialogDescription className="text-[14px]">
                {editing
                  ? `v${editing.version} — saving creates a new version snapshot`
                  : "Saving creates version 1 and writes an audit entry"}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Name</Label>
                <Input
                  className="h-10"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={`e.g. ${entity.id === "campus" ? "URS Morong Campus" : entity.id === "program" ? "Computer Science" : "College of Engineering"}`}
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Code</Label>
                <Input
                  className="h-10"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="e.g. URS-MORONG / COE / BSCS"
                />
              </div>
              {tab === "program" && (
                <div className="grid gap-2">
                  <Label className="text-[13px] font-medium">Level</Label>
                  <Select
                    value={form.level}
                    onValueChange={(v) => setForm((f) => ({ ...f, level: v as ProgramLevel }))}
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Level" />
                    </SelectTrigger>
                    <SelectContent>
                      {PROGRAM_LEVELS.map((l) => (
                        <SelectItem key={l} value={l}>
                          {l}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {tab !== "campus" && (
                <div className="grid gap-2">
                  <Label className="text-[13px] font-medium">Campus</Label>
                  <Select
                    value={form.campusId}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, campusId: v === NONE_VALUE ? "" : v, collegeId: "", departmentId: "" }))
                    }
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select campus" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>None</SelectItem>
                      {campuses.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {tab === "college" && (
                <div className="text-[12px] text-gray-500">
                  A college is assigned to a campus. Add programs and offices under it after saving.
                </div>
              )}
              {(tab === "office" || tab === "program") && (
                <div className="grid gap-2">
                  <Label className="text-[13px] font-medium">College</Label>
                  <Select
                    value={form.collegeId}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, collegeId: v === NONE_VALUE ? "" : v, departmentId: "" }))
                    }
                  >
                    <SelectTrigger className="h-10">
                      <SelectValue placeholder="Select college" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>None</SelectItem>
                      {availableColleges.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Description (optional)</Label>
                <Textarea
                  className="min-h-[70px]"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Short description"
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-9" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button className="h-9 shadow-soft" onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving…" : editing ? "Save (new version)" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Version history / rollback dialog ────────────────────────────────── */}
      {versionTarget && (
        <Dialog open onOpenChange={(open) => !open && setVersionTarget(null)}>
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[640px]">
            <DialogHeader className="pb-2">
              <DialogTitle className="text-lg">
                Version History — {versionTarget.name}
              </DialogTitle>
              <DialogDescription className="text-[14px]">
                Current version: v{versionTarget.version} · rollback creates a new version
              </DialogDescription>
            </DialogHeader>
            <div className="py-2 max-h-[380px] overflow-y-auto">
              {versionsLoading ? (
                <div className="py-8 flex justify-center">
                  <div className="w-7 h-7 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : versions.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-gray-500">
                  No versions recorded for this record yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {versions.map((v) => (
                    <div
                      key={v.id}
                      className={`rounded-lg border p-3 flex items-start gap-3 ${
                        v.version === versionTarget.version
                          ? "border-gray-900 bg-gray-50"
                          : "border-gray-100"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-gray-900">v{v.version}</span>
                          {v.version === versionTarget.version && (
                            <Badge variant="success">Current</Badge>
                          )}
                          <Badge variant="secondary">{v.changeType}</Badge>
                        </div>
                        <div className="text-[13px] text-gray-600 mt-0.5">
                          {String(v.data?.name ?? "")}
                          {v.data?.code ? (
                            <span className="text-gray-400"> · {String(v.data.code)}</span>
                          ) : null}
                          {v.data?.level ? (
                            <span className="text-gray-400"> · {String(v.data.level)}</span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          {new Date(v.createdAt).toLocaleString()} · {v.changedByName ?? "System"}
                        </div>
                      </div>
                      {v.version < versionTarget.version && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 flex-shrink-0"
                          onClick={() => setRollbackTarget(v)}
                        >
                          <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                          Roll back
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {rollbackTarget && (
              <div className="border-t border-gray-100 pt-4">
                <div className="text-[13px] text-gray-700">
                  Roll back <span className="font-medium">{versionTarget.name}</span> to{" "}
                  <span className="font-medium">v{rollbackTarget.version}</span>? A new version
                  will be created with the restored values.
                </div>
                <DialogFooter className="gap-2 mt-4">
                  <Button variant="outline" className="h-9" onClick={() => setRollbackTarget(null)}>
                    Cancel
                  </Button>
                  <Button className="h-9 shadow-soft" onClick={() => void handleRollback()} disabled={saving}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {saving ? "Rolling back…" : "Confirm rollback"}
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
