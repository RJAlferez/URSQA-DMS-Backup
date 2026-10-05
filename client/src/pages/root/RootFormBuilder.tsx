import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Plus,
  Search,
  Filter,
  Eye,
  Copy,
  Archive,
  ArchiveRestore,
  Link2,
  History,
  Trash2,
  ArrowUp,
  ArrowDown,
  FileText,
  FilePlus2,
  Send,
  Save,
  Pencil,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Label } from "@/components/ui/Label"
import { Textarea } from "@/components/ui/Textarea"
import { Badge } from "@/components/ui/Badge"
import { Switch } from "@/components/ui/Switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table"
import { ApiRequestError } from "@/lib/http"
import {
  listForms,
  createForm,
  getForm,
  archiveForm,
  restoreForm,
  duplicateForm,
  saveFormDraft,
  publishForm,
  getFormPreview,
  createFormField,
  updateFormField,
  removeFormField,
  reorderFormFields,
  listFormVersions,
  rollbackForm,
  listFormHistory,
  assignForm,
  unassignForm,
  listFormAssignmentTargetOptions,
  type FormTemplateDetail,
  type FormTemplateListItem,
  type FormFieldType,
  type FormFieldInput,
  type FormFieldView,
  type FormAssignmentTargetType,
  type FormVersionView,
  type FormHistoryView,
  type FormPreviewView,
} from "@/services/root"

const FIELD_TYPES: Array<{ type: FormFieldType; label: string }> = [
  { type: "TEXT", label: "Text Field" },
  { type: "TEXTAREA", label: "Text Area" },
  { type: "NUMBER", label: "Number" },
  { type: "EMAIL", label: "Email" },
  { type: "DATE", label: "Date" },
  { type: "TIME", label: "Time" },
  { type: "DROPDOWN", label: "Dropdown" },
  { type: "RADIO", label: "Radio Button" },
  { type: "CHECKBOX", label: "Checkbox" },
  { type: "MULTI_SELECT", label: "Multi Select" },
  { type: "FILE", label: "File Upload" },
  { type: "SECTION", label: "Section Header" },
]

const SELECTION_TYPES = new Set<FormFieldType>(["DROPDOWN", "RADIO", "CHECKBOX", "MULTI_SELECT"])

const ASSIGNMENT_TARGETS: Array<{ type: FormAssignmentTargetType; label: string }> = [
  { type: "REQUIREMENT_TEMPLATE", label: "Requirement Template" },
  { type: "WORKFLOW_STEP", label: "Workflow Step" },
  { type: "AACCUP_AREA", label: "AACCUP Area" },
  { type: "FOLDER_TEMPLATE", label: "Folder Template" },
  { type: "UNIVERSITY", label: "University (global)" },
]

const statusVariant: Record<string, "success" | "warning" | "secondary" | "danger"> = {
  PUBLISHED: "success",
  DRAFT: "warning",
  ARCHIVED: "secondary",
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  return err instanceof Error ? err.message : fallback
}

export default function RootFormBuilder() {
  const [forms, setForms] = useState<FormTemplateListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("ALL")
  const [sort, setSort] = useState("updatedAt")

  // Dialogs
  const [createOpen, setCreateOpen] = useState(false)
  const [createFormState, setCreateFormState] = useState({ code: "", name: "", description: "" })
  const [creating, setCreating] = useState(false)

  const [builder, setBuilder] = useState<FormTemplateDetail | null>(null)
  const [builderLoading, setBuilderLoading] = useState(false)

  const [fieldDialog, setFieldDialog] = useState<{ open: boolean; field?: FormFieldView }>({
    open: false,
  })

  const [preview, setPreview] = useState<FormPreviewView | null>(null)

  const [assignDialog, setAssignDialog] = useState<FormTemplateDetail | null>(null)
  const [assignTargetType, setAssignTargetType] = useState<FormAssignmentTargetType>("AACCUP_AREA")
  const [assignTargetId, setAssignTargetId] = useState("")
  const [assignTargetOptions, setAssignTargetOptions] = useState<Array<{ id: string; label: string }>>([])
  const [assignPriority, setAssignPriority] = useState("0")

  const [versions, setVersions] = useState<FormVersionView[]>([])
  const [history, setHistory] = useState<FormHistoryView[]>([])
  const [versionsTab, setVersionsTab] = useState<"versions" | "history">("versions")
  const [versionsFor, setVersionsFor] = useState<FormTemplateListItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listForms({
        q: search || undefined,
        status: statusFilter === "ALL" ? undefined : (statusFilter as "DRAFT" | "PUBLISHED" | "ARCHIVED"),
        includeArchived: statusFilter === "ARCHIVED",
        sort,
        pageSize: 100,
      })
      setForms(result.items)
    } catch (err) {
      setError(errorMessage(err, "Failed to load form templates"))
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, sort])

  useEffect(() => {
    load()
  }, [load])

  const openBuilder = async (template: FormTemplateListItem) => {
    setBuilderLoading(true)
    try {
      setBuilder(await getForm(template.id))
    } catch (err) {
      setError(errorMessage(err, "Failed to load form template"))
    } finally {
      setBuilderLoading(false)
    }
  }

  // ── Create form ────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    setCreating(true)
    try {
      await createForm(createFormState)
      setCreateOpen(false)
      setCreateFormState({ code: "", name: "", description: "" })
      await load()
    } catch (err) {
      window.alert(errorMessage(err, "Failed to create form"))
    } finally {
      setCreating(false)
    }
  }

  // ── Builder actions ────────────────────────────────────────────────────────

  const handleSaveDraft = async () => {
    if (!builder) return
    try {
      const result = await saveFormDraft(builder.id, "Manual save")
      await openBuilder({ ...builder, version: result.version } as FormTemplateListItem)
    } catch (err) {
      window.alert(errorMessage(err, "Failed to save draft"))
    }
  }

  const handlePublish = async () => {
    if (!builder) return
    if (!window.confirm(`Publish "${builder.name}"? Published forms are immutable until rolled back.`)) return
    try {
      await publishForm(builder.id, "Published")
      await load()
      await openBuilder(builder)
    } catch (err) {
      window.alert(errorMessage(err, "Failed to publish form"))
    }
  }

  const handleDuplicate = async (template: FormTemplateListItem) => {
    try {
      await duplicateForm(template.id)
      await load()
    } catch (err) {
      window.alert(errorMessage(err, "Failed to duplicate form"))
    }
  }

  const handleArchive = async (template: FormTemplateListItem) => {
    if (!window.confirm(`Archive "${template.name}"?`)) return
    try {
      await archiveForm(template.id)
      await load()
    } catch (err) {
      window.alert(errorMessage(err, "Failed to archive form"))
    }
  }

  const handleRestore = async (template: FormTemplateListItem) => {
    try {
      await restoreForm(template.id)
      await load()
    } catch (err) {
      window.alert(errorMessage(err, "Failed to restore form"))
    }
  }

  const handleRemoveField = async (field: FormFieldView) => {
    if (!builder) return
    if (!window.confirm(`Remove field "${field.label}"?`)) return
    try {
      const updated = await removeFormField(builder.id, field.id)
      setBuilder(updated)
    } catch (err) {
      window.alert(errorMessage(err, "Failed to remove field"))
    }
  }

  const handleMoveField = async (index: number, direction: -1 | 1) => {
    if (!builder) return
    const target = index + direction
    if (target < 0 || target >= builder.fields.length) return
    const ids = builder.fields.map((f) => f.id)
    const next = [...ids]
    const tmp = next[target]
    next[target] = next[index]
    next[index] = tmp
    try {
      const updated = await reorderFormFields(builder.id, next)
      setBuilder(updated)
    } catch (err) {
      window.alert(errorMessage(err, "Failed to reorder fields"))
    }
  }

  // ── Field editor ───────────────────────────────────────────────────────────

  const fieldEditor = useMemo(() => {
    const target = fieldDialog.field
    return {
      label: target?.label ?? "",
      type: target?.type ?? ("TEXT" as FormFieldType),
      description: target?.description ?? "",
      placeholder: target?.placeholder ?? "",
      required: target?.required ?? false,
      defaultValue: target ? String(target.defaultValue ?? "") : "",
      options: target?.options?.length
        ? target.options.map((o) => ({ label: o.label, value: o.value }))
        : [{ label: "", value: "" }],
      minLength: target?.validation?.minLength?.toString() ?? "",
      maxLength: target?.validation?.maxLength?.toString() ?? "",
      min: target?.validation?.min?.toString() ?? "",
      max: target?.validation?.max?.toString() ?? "",
      pattern: target?.validation?.pattern ?? "",
      helpText: target?.helpText ?? "",
    }
  }, [fieldDialog])

  const [fieldState, setFieldState] = useState({
    label: "", type: "TEXT" as FormFieldType, description: "", placeholder: "",
    required: false, defaultValue: "", options: [{ label: "", value: "" }],
    minLength: "", maxLength: "", min: "", max: "", pattern: "", helpText: "",
  })
  const [savingField, setSavingField] = useState(false)

  useEffect(() => {
    setFieldState({ ...fieldEditor })
  }, [fieldEditor])

  const handleSaveField = async () => {
    if (!builder || !fieldState.label.trim()) return
    setSavingField(true)
    try {
      const input: FormFieldInput = {
        label: fieldState.label.trim(),
        type: fieldState.type,
        description: fieldState.description || undefined,
        placeholder: fieldState.placeholder || undefined,
        required: fieldState.required,
        helpText: fieldState.helpText || undefined,
        validation: {
          ...(fieldState.minLength ? { minLength: Number(fieldState.minLength) } : {}),
          ...(fieldState.maxLength ? { maxLength: Number(fieldState.maxLength) } : {}),
          ...(fieldState.min ? { min: Number(fieldState.min) } : {}),
          ...(fieldState.max ? { max: Number(fieldState.max) } : {}),
          ...(fieldState.pattern ? { pattern: fieldState.pattern } : {}),
        },
      }
      if (SELECTION_TYPES.has(fieldState.type)) {
        input.options = fieldState.options
          .filter((o) => o.label.trim() || o.value.trim())
          .map((o) => ({ label: o.label.trim(), value: o.value.trim() || o.label.trim() }))
      } else if (fieldState.type !== "SECTION" && fieldState.defaultValue !== "") {
        input.defaultValue =
          fieldState.type === "NUMBER"
            ? Number(fieldState.defaultValue)
            : fieldState.type === "CHECKBOX"
              ? fieldState.defaultValue === "true"
              : fieldState.defaultValue
      }
      const updated = fieldDialog.field
        ? await updateFormField(builder.id, fieldDialog.field.id, input)
        : await createFormField(builder.id, input)
      setBuilder(updated)
      setFieldDialog({ open: false })
    } catch (err) {
      window.alert(errorMessage(err, "Failed to save field"))
    } finally {
      setSavingField(false)
    }
  }

  // ── Preview ────────────────────────────────────────────────────────────────

  const openPreview = async (template: FormTemplateListItem) => {
    try {
      setPreview(await getFormPreview(template.id))
    } catch (err) {
      window.alert(errorMessage(err, "Failed to load preview"))
    }
  }

  // ── Assignments ────────────────────────────────────────────────────────────

  const openAssignments = (template: FormTemplateDetail) => {
    setAssignDialog(template)
    setAssignTargetType("AACCUP_AREA")
    setAssignTargetId("")
    setAssignTargetOptions([])
    setAssignPriority("0")
  }

  const loadTargetOptions = async (targetType: FormAssignmentTargetType) => {
    setAssignTargetId("")
    if (targetType === "UNIVERSITY") {
      setAssignTargetOptions([])
      return
    }
    try {
      setAssignTargetOptions(await listFormAssignmentTargetOptions(targetType))
    } catch {
      setAssignTargetOptions([])
    }
  }

  const handleAssign = async () => {
    if (!assignDialog) return
    try {
      const updated = await assignForm(assignDialog.id, {
        targetType: assignTargetType,
        targetId: assignTargetType === "UNIVERSITY" ? null : assignTargetId,
        priority: Number(assignPriority) || 0,
      })
      setAssignDialog(updated)
    } catch (err) {
      window.alert(errorMessage(err, "Failed to assign form"))
    }
  }

  const handleUnassign = async (assignmentId: string) => {
    if (!assignDialog) return
    try {
      setAssignDialog(await unassignForm(assignDialog.id, assignmentId))
    } catch (err) {
      window.alert(errorMessage(err, "Failed to remove assignment"))
    }
  }

  // ── Versions / history ─────────────────────────────────────────────────────

  const openVersions = async (template: FormTemplateListItem) => {
    setVersionsFor(template)
    setVersionsTab("versions")
    try {
      const [versionRows, historyRows] = await Promise.all([
        listFormVersions(template.id),
        listFormHistory(template.id),
      ])
      setVersions(versionRows)
      setHistory(historyRows)
    } catch (err) {
      window.alert(errorMessage(err, "Failed to load versions"))
    }
  }

  const handleRollback = async (version: number) => {
    if (!versionsFor) return
    if (!window.confirm(`Roll "${versionsFor.name}" back to version ${version}? Current state becomes a new draft version.`)) return
    try {
      await rollbackForm(versionsFor.id, version)
      setVersionsFor(null)
      await load()
    } catch (err) {
      window.alert(errorMessage(err, "Failed to roll back form"))
    }
  }

  return (
    <div className="content-padding">
      <PageHeader
        title="Dynamic Form Builder"
        description="Design reusable, versioned form templates assignable to requirements, workflow steps, AACCUP areas, folder templates and future modules"
        actions={
          <Button className="shadow-soft" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Form
          </Button>
        }
      />

      <Card className="border-border/70 shadow-soft mb-6">
        <CardContent className="p-0">
          <div className="toolbar-padding flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search forms..."
                className="pl-10 h-9 bg-gray-50/50 border-0 hover:bg-gray-100 focus:bg-white"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px] h-9">
                  <Filter className="w-3.5 h-3.5 mr-2" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  <SelectItem value="DRAFT">Draft</SelectItem>
                  <SelectItem value="PUBLISHED">Published</SelectItem>
                  <SelectItem value="ARCHIVED">Archived</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-[160px] h-9">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updatedAt">Last updated</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="code">Code</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                  <SelectItem value="version">Version</SelectItem>
                  <SelectItem value="createdAt">Created</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-red-200 bg-red-50/50 mb-6">
          <CardContent className="p-4 text-[13px] text-red-700">{error}</CardContent>
        </Card>
      )}

      <Card className="border-border/70 shadow-soft">
        <CardHeader className="pb-3">
          <CardTitle className="text-[14px]">Form Templates ({forms.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent bg-gray-50/50">
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Version</TableHead>
                <TableHead className="text-center">Fields</TableHead>
                <TableHead className="text-center">Assignments</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-[13px] text-gray-400">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : forms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-[13px] text-gray-400">
                    No form templates found
                  </TableCell>
                </TableRow>
              ) : (
                forms.map((template) => (
                  <TableRow key={template.id} className="hover:bg-gray-50/50 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                          <FileText className="w-4 h-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-[14px] font-medium text-gray-900">{template.name}</p>
                          <p className="text-[11px] text-gray-400">{template.description ?? "—"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-[13px] text-gray-600 font-mono">{template.code}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[template.status]} className="text-[10px]">
                        {template.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-[13px] text-gray-700">v{template.version}</TableCell>
                    <TableCell className="text-center text-[13px] text-gray-700">{template.fieldCount}</TableCell>
                    <TableCell className="text-center text-[13px] text-gray-700">{template.assignmentCount}</TableCell>
                    <TableCell className="text-[12px] text-gray-500">
                      {new Date(template.updatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {template.status !== "ARCHIVED" && (
                          <Button variant="ghost" size="sm" className="h-8 text-[12px] text-primary"
                            onClick={() => void openBuilder(template)}>
                            <Pencil className="w-3.5 h-3.5 mr-1" />
                            Edit
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-700"
                          title="Preview" onClick={() => void openPreview(template)}>
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-700"
                          title="Versions & history" onClick={() => void openVersions(template)}>
                          <History className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-700"
                          title="Assignments" onClick={() => void openBuilder(template).then(() => openAssignments(builder!))}>
                          <Link2 className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-700"
                          title="Duplicate" onClick={() => void handleDuplicate(template)}>
                          <Copy className="w-4 h-4" />
                        </Button>
                        {template.status === "ARCHIVED" ? (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-emerald-600"
                            title="Restore" onClick={() => void handleRestore(template)}>
                            <ArchiveRestore className="w-4 h-4" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600"
                            title="Archive" onClick={() => void handleArchive(template)}>
                            <Archive className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Create form dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2">
              <FilePlus2 className="w-5 h-5 text-primary" />
              New Form Template
            </DialogTitle>
            <DialogDescription className="text-[14px]">
              Create a reusable, fully dynamic form template.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid gap-2">
              <Label className="text-[13px] font-medium">Name <span className="text-red-500">*</span></Label>
              <Input className="h-10" placeholder="e.g. Annual Accreditation Survey" value={createFormState.name}
                onChange={(e) => setCreateFormState((s) => ({ ...s, name: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label className="text-[13px] font-medium">Code <span className="text-red-500">*</span></Label>
              <Input className="h-10 font-mono" placeholder="e.g. annual-accreditation-survey" value={createFormState.code}
                onChange={(e) => setCreateFormState((s) => ({ ...s, code: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label className="text-[13px] font-medium">Description</Label>
              <Textarea className="min-h-[80px] resize-none" placeholder="Optional description" value={createFormState.description}
                onChange={(e) => setCreateFormState((s) => ({ ...s, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={creating || !createFormState.name.trim() || !createFormState.code.trim()}
              className="h-10 px-5 shadow-soft">
              {creating ? "Creating..." : "Create Form"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Builder dialog ── */}
      <Dialog open={builder !== null} onOpenChange={(open) => !open && setBuilder(null)}>
        <DialogContent className="max-w-[92vw] w-[92vw] h-[90vh] max-h-[90vh] p-0 overflow-hidden flex flex-col [&>button]:hidden">
          {builder && (
            <>
              <DialogHeader className="px-6 py-4 border-b border-gray-100 flex-shrink-0">
                <div className="flex items-center justify-between gap-4 pr-12">
                  <div className="min-w-0">
                    <DialogTitle className="text-lg">{builder.name}</DialogTitle>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-[12px] text-gray-500 font-mono">{builder.code}</span>
                      <Badge variant={statusVariant[builder.status]} className="text-[10px]">{builder.status}</Badge>
                      <span className="text-[12px] text-gray-500">v{builder.version}</span>
                      <span className="text-[12px] text-gray-500">{builder.fields.length} fields</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {builder.status === "DRAFT" && (
                      <>
                        <Button variant="outline" size="sm" className="h-9" onClick={() => void handleSaveDraft()}>
                          <Save className="w-4 h-4 mr-2" /> Save Draft
                        </Button>
                        <Button size="sm" className="h-9 shadow-soft" onClick={() => void handlePublish()}>
                          <Send className="w-4 h-4 mr-2" /> Publish
                        </Button>
                      </>
                    )}
                    <Button variant="outline" size="sm" className="h-9" onClick={() => void openAssignments(builder)}>
                      <Link2 className="w-4 h-4 mr-2" /> Assignments
                    </Button>
                    <Button variant="outline" size="sm" className="h-9" onClick={() => void openPreview(builder)}>
                      <Eye className="w-4 h-4 mr-2" /> Preview
                    </Button>
                    {builder.status === "DRAFT" && (
                      <Button variant="outline" size="sm" className="h-9"
                        onClick={() => { setFieldDialog({ open: true }); }}>
                        <Plus className="w-4 h-4 mr-2" /> Add Field
                      </Button>
                    )}
                  </div>
                </div>
              </DialogHeader>

              <div className="flex-1 overflow-auto p-6">
                {builderLoading ? (
                  <div className="min-h-[300px] flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : builder.fields.length === 0 ? (
                  <div className="min-h-[300px] flex flex-col items-center justify-center text-center border-2 border-dashed border-border rounded-xl bg-gray-50/30">
                    <FileText className="w-10 h-10 text-gray-300 mb-3" />
                    <p className="text-[14px] text-gray-600 font-medium">No fields yet</p>
                    <p className="text-[12px] text-gray-400 mt-1">
                      {builder.status === "DRAFT" ? "Add text fields, dropdowns, file uploads and more." : "This published form has no fields."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {builder.fields.map((field, index) => (
                      <div key={field.id} className="flex items-center gap-3 p-3.5 rounded-xl border border-gray-100 bg-white hover:border-border transition-colors">
                        <div className="flex flex-col gap-0.5">
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-gray-700" disabled={index === 0}
                            onClick={() => void handleMoveField(index, -1)}>
                            <ArrowUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-gray-700" disabled={index === builder.fields.length - 1}
                            onClick={() => void handleMoveField(index, 1)}>
                            <ArrowDown className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-[14px] font-medium text-gray-900">{field.label}</p>
                            {field.required && <span className="text-red-500 text-[12px]">*</span>}
                            <Badge variant="secondary" className="text-[10px]">{field.type}</Badge>
                          </div>
                          {field.description && <p className="text-[12px] text-gray-500 mt-0.5">{field.description}</p>}
                          <p className="text-[11px] text-gray-400 mt-0.5 font-mono">{field.key}</p>
                        </div>
                        {builder.status === "DRAFT" && (
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-700"
                              onClick={() => setFieldDialog({ open: true, field })}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600"
                              onClick={() => void handleRemoveField(field)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Field editor dialog ── */}
      <Dialog open={fieldDialog.open} onOpenChange={(open) => !open && setFieldDialog({ open: false })}>
        <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-auto">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2">
              <FilePlus2 className="w-5 h-5 text-primary" />
              {fieldDialog.field ? "Edit Field" : "Add Field"}
            </DialogTitle>
            <DialogDescription className="text-[14px]">
              {fieldDialog.field ? `Editing "${fieldDialog.field.label}"` : "Add a new field to this form template"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Field Type <span className="text-red-500">*</span></Label>
                <Select value={fieldState.type}
                  onValueChange={(v) => setFieldState((s) => ({ ...s, type: v as FormFieldType }))}
                  disabled={Boolean(fieldDialog.field)}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((item) => (
                      <SelectItem key={item.type} value={item.type}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Label <span className="text-red-500">*</span></Label>
                <Input className="h-10" placeholder="e.g. Full Name" value={fieldState.label}
                  onChange={(e) => setFieldState((s) => ({ ...s, label: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label className="text-[13px] font-medium">Description</Label>
              <Input className="h-10" placeholder="Optional helper description shown under the label" value={fieldState.description}
                onChange={(e) => setFieldState((s) => ({ ...s, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Placeholder</Label>
                <Input className="h-10" placeholder="Placeholder text" value={fieldState.placeholder}
                  onChange={(e) => setFieldState((s) => ({ ...s, placeholder: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Help Text</Label>
                <Input className="h-10" placeholder="Shown below the field" value={fieldState.helpText}
                  onChange={(e) => setFieldState((s) => ({ ...s, helpText: e.target.value }))} />
              </div>
            </div>

            {fieldState.type !== "SECTION" && (
              <div className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50/50">
                <div>
                  <p className="text-[14px] font-medium text-gray-700">Required</p>
                  <p className="text-[12px] text-gray-500">Reject submissions missing this field</p>
                </div>
                <Switch checked={fieldState.required} onCheckedChange={(v) => setFieldState((s) => ({ ...s, required: v }))} />
              </div>
            )}

            {fieldState.type !== "SECTION" && !SELECTION_TYPES.has(fieldState.type) && (
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Default Value</Label>
                <Input className="h-10"
                  type={fieldState.type === "NUMBER" ? "number" : fieldState.type === "DATE" ? "date" : fieldState.type === "TIME" ? "time" : fieldState.type === "EMAIL" ? "email" : "text"}
                  placeholder="Optional default value"
                  value={fieldState.type === "CHECKBOX" ? (fieldState.defaultValue ? "true" : "false") : fieldState.defaultValue}
                  onChange={(e) => setFieldState((s) => ({ ...s, defaultValue: fieldState.type === "CHECKBOX" ? (e.target.checked ? "true" : "false") : e.target.value }))} />
              </div>
            )}

            {SELECTION_TYPES.has(fieldState.type) && (
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Options <span className="text-red-500">*</span></Label>
                <div className="space-y-2">
                  {fieldState.options.map((option, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input className="h-9 flex-1" placeholder="Label" value={option.label}
                        onChange={(e) => {
                          const next = [...fieldState.options]
                          next[index] = { ...next[index], label: e.target.value }
                          setFieldState((s) => ({ ...s, options: next }))
                        }} />
                      <Input className="h-9 flex-1 font-mono" placeholder="Value" value={option.value}
                        onChange={(e) => {
                          const next = [...fieldState.options]
                          next[index] = { ...next[index], value: e.target.value }
                          setFieldState((s) => ({ ...s, options: next }))
                        }} />
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600"
                        onClick={() => setFieldState((s) => ({ ...s, options: s.options.filter((_, i) => i !== index) }))}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="h-8"
                    onClick={() => setFieldState((s) => ({ ...s, options: [...s.options, { label: "", value: "" }] }))}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Option
                  </Button>
                </div>
              </div>
            )}

            <div className="rounded-xl border border-gray-100 p-4">
              <p className="text-[13px] font-medium text-gray-700 mb-3">Validation Rules</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-[12px] text-gray-500">Min (number / min length)</Label>
                  <Input className="h-9" type="number" value={fieldState.minLength} placeholder="Min length"
                    onChange={(e) => setFieldState((s) => ({ ...s, minLength: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-[12px] text-gray-500">Max (number / max length)</Label>
                  <Input className="h-9" type="number" value={fieldState.maxLength} placeholder="Max length"
                    onChange={(e) => setFieldState((s) => ({ ...s, maxLength: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-[12px] text-gray-500">Numeric min</Label>
                  <Input className="h-9" type="number" value={fieldState.min}
                    onChange={(e) => setFieldState((s) => ({ ...s, min: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-[12px] text-gray-500">Numeric max</Label>
                  <Input className="h-9" type="number" value={fieldState.max}
                    onChange={(e) => setFieldState((s) => ({ ...s, max: e.target.value }))} />
                </div>
                <div className="grid gap-1.5 col-span-2">
                  <Label className="text-[12px] text-gray-500">Pattern (regex)</Label>
                  <Input className="h-9 font-mono" placeholder="e.g. ^[A-Z0-9._-]+$" value={fieldState.pattern}
                    onChange={(e) => setFieldState((s) => ({ ...s, pattern: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFieldDialog({ open: false })} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => void handleSaveField()} disabled={savingField || !fieldState.label.trim()} className="h-10 px-5 shadow-soft">
              {savingField ? "Saving..." : fieldDialog.field ? "Save Field" : "Add Field"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Preview dialog ── */}
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-auto">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2">
              <Eye className="w-5 h-5 text-primary" />
              {preview?.template.name}
            </DialogTitle>
            <DialogDescription className="text-[14px]">
              {preview?.template.code} · v{preview?.template.version} · {preview?.fields.length} fields
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            {preview?.fields.length === 0 && (
              <p className="text-[13px] text-gray-500 text-center py-6">No fields defined.</p>
            )}
            {preview?.fields.map((field) => (
              <div key={field.id} className="grid gap-1.5">
                {field.type === "SECTION" ? (
                  <div className="pt-3 border-t border-gray-100">
                    <p className="text-[15px] font-semibold text-gray-900">{field.label}</p>
                  </div>
                ) : (
                  <>
                    <Label className="text-[13px] font-medium text-gray-700">
                      {field.label} {field.required && <span className="text-red-500">*</span>}
                      <span className="ml-2 text-[11px] text-gray-400 font-normal">{field.type}</span>
                    </Label>
                    {field.type === "TEXTAREA" ? (
                      <Textarea className="min-h-[70px] resize-none" placeholder={field.placeholder ?? ""} disabled />
                    ) : field.type === "DROPDOWN" || field.type === "MULTI_SELECT" ? (
                      <div className="h-10 px-3 py-2.5 rounded-lg border border-border bg-gray-50 text-[13px] text-gray-500">
                        {field.options.map((o) => o.label).join(", ")}
                      </div>
                    ) : field.type === "RADIO" || field.type === "CHECKBOX" ? (
                      <div className="flex flex-wrap gap-3">
                        {field.options.map((o) => (
                          <label key={o.value} className="flex items-center gap-1.5 text-[13px] text-gray-700">
                            <input type={field.type === "RADIO" ? "radio" : "checkbox"} disabled className="accent-primary" />
                            {o.label}
                          </label>
                        ))}
                      </div>
                    ) : field.type === "FILE" ? (
                      <div className="h-10 px-3 py-2.5 rounded-lg border border-dashed border-gray-300 bg-gray-50 text-[13px] text-gray-500">
                        Upload file ({field.validation?.allowedTypes?.join(", ") ?? "any type"})
                      </div>
                    ) : (
                      <Input className="h-10" type={field.type === "NUMBER" ? "number" : field.type === "EMAIL" ? "email" : field.type === "DATE" ? "date" : field.type === "TIME" ? "time" : "text"}
                        placeholder={field.placeholder ?? ""} disabled />
                    )}
                    {field.description && <p className="text-[12px] text-gray-500">{field.description}</p>}
                  </>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Assignments dialog ── */}
      <Dialog open={assignDialog !== null} onOpenChange={(open) => !open && setAssignDialog(null)}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-auto">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2">
              <Link2 className="w-5 h-5 text-primary" />
              Assign "{assignDialog?.name}"
            </DialogTitle>
            <DialogDescription className="text-[14px]">
              Attach this form to requirements, workflow steps, AACCUP areas, folder templates or the university scope.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Target Type</Label>
                <Select value={assignTargetType}
                  onValueChange={(v) => {
                    setAssignTargetType(v as FormAssignmentTargetType)
                    void loadTargetOptions(v as FormAssignmentTargetType)
                  }}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNMENT_TARGETS.map((item) => (
                      <SelectItem key={item.type} value={item.type}>{item.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Priority</Label>
                <Input className="h-10" type="number" min={0} value={assignPriority}
                  onChange={(e) => setAssignPriority(e.target.value)} />
              </div>
            </div>
            {assignTargetType !== "UNIVERSITY" && (
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Target <span className="text-red-500">*</span></Label>
                <Select value={assignTargetId} onValueChange={setAssignTargetId}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select target" />
                  </SelectTrigger>
                  <SelectContent>
                    {assignTargetOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button size="sm" className="h-9 justify-self-start shadow-soft"
              disabled={assignTargetType !== "UNIVERSITY" && !assignTargetId}
              onClick={() => void handleAssign()}>
              <Plus className="w-4 h-4 mr-2" /> Add Assignment
            </Button>

            <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
              {assignDialog?.assignments.length === 0 && (
                <p className="px-3 py-4 text-center text-[12px] text-gray-400">No assignments yet</p>
              )}
              {assignDialog?.assignments.map((assignment) => (
                <div key={assignment.id} className="flex items-center justify-between px-3 py-2.5">
                  <div>
                    <p className="text-[13px] text-gray-900 font-medium">{assignment.targetType}</p>
                    <p className="text-[11px] text-gray-400">priority {assignment.priority} · {new Date(assignment.createdAt).toLocaleDateString()}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600"
                    onClick={() => void handleUnassign(assignment.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Versions / history dialog ── */}
      <Dialog open={versionsFor !== null} onOpenChange={(open) => !open && setVersionsFor(null)}>
        <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-auto">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2">
              <History className="w-5 h-5 text-primary" />
              Versions & History — {versionsFor?.name}
            </DialogTitle>
            <DialogDescription className="text-[14px]">
              Every mutation is versioned. Rollback replays a snapshot as a new draft.
            </DialogDescription>
          </DialogHeader>
          <div className="flex rounded-lg border border-border p-1 bg-gray-50/50 mb-3 w-fit">
            <button type="button" onClick={() => setVersionsTab("versions")}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${versionsTab === "versions" ? "bg-white text-gray-900 shadow-soft" : "text-gray-500 hover:text-gray-700"}`}>
              Versions ({versions.length})
            </button>
            <button type="button" onClick={() => setVersionsTab("history")}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${versionsTab === "history" ? "bg-white text-gray-900 shadow-soft" : "text-gray-500 hover:text-gray-700"}`}>
              History ({history.length})
            </button>
          </div>
          {versionsTab === "versions" ? (
            <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
              {versions.length === 0 && <p className="px-3 py-4 text-center text-[12px] text-gray-400">No versions</p>}
              {versions.map((version) => (
                <div key={version.id} className="flex items-center justify-between px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-10 text-[13px] font-semibold text-gray-900">v{version.version}</span>
                    <div>
                      <p className="text-[13px] text-gray-900">{version.changeType}{version.changeNote ? ` — ${version.changeNote}` : ""}</p>
                      <p className="text-[11px] text-gray-400">{version.changedByName ?? "—"} · {new Date(version.createdAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="h-8 text-[12px]"
                    onClick={() => void handleRollback(version.version)}>
                    Rollback
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
              {history.length === 0 && <p className="px-3 py-4 text-center text-[12px] text-gray-400">No history</p>}
              {history.map((entry) => (
                <div key={entry.id} className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{entry.action}</Badge>
                    {entry.versionFrom !== null && (
                      <span className="text-[12px] text-gray-500">v{entry.versionFrom} → v{entry.versionTo}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">{entry.actorName ?? "—"} · {new Date(entry.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}