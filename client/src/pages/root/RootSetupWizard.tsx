import { useCallback, useEffect, useState } from "react"
import {
  Rocket,
  Building2,
  FolderTree,
  FileCheck2,
  Workflow,
  ClipboardList,
  Users,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  Save,
  Upload,
  Plus,
  Pencil,
  Trash2,
  Mail,
  KeyRound,
  RefreshCw,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Label } from "@/components/ui/Label"
import { Textarea } from "@/components/ui/Textarea"
import { Badge } from "@/components/ui/Badge"
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
import { ApiRequestError } from "@/lib/http"
import {
  getSetupState,
  startSetup,
  saveSetupProgress,
  uploadSetupLogo,
  getSetupLogoUrl,
  completeSetup,
  reopenSetup,
  sendSetupCredentials,
  categoryConfigurations,
  updateConfigurations,
  listOrgRecords,
  createOrgRecord,
  updateOrgRecord,
  archiveOrgRecord,
  listFolderTemplates,
  createFolderTemplate,
  createFolderNode,
  listRequirementTemplates,
  createRequirementTemplate,
  createRequirementNode,
  listWorkflowDefinitions,
  assignWorkflowDefinition,
  listForms,
  assignForm,
  listFormAssignmentTargetOptions,
  type SetupStateView,
  type OrgEntity,
  type OrgRecord,
  type FormAssignmentTargetType,
} from "@/services/root"
import { createSystemUser, listSystemUsers, listSystemDepartments, listSystemRoles } from "@/services/admin"
import { cn } from "@/lib/utils"

const STEPS = [
  { id: 1, label: "Platform", icon: Rocket },
  { id: 2, label: "Organization", icon: Building2 },
  { id: 3, label: "Folders", icon: FolderTree },
  { id: 4, label: "Requirements", icon: FileCheck2 },
  { id: 5, label: "Workflows", icon: Workflow },
  { id: 6, label: "Forms", icon: ClipboardList },
  { id: 7, label: "Administrators", icon: Users },
  { id: 8, label: "Summary", icon: CheckCircle2 },
]

const ORG_ENTITIES: Array<{ key: OrgEntity; label: string }> = [
  { key: "campus", label: "Campuses" },
  { key: "college", label: "Colleges" },
  { key: "program", label: "Programs" },
  { key: "office", label: "Offices" },
]

// Radix Select disallows an empty-string item value; use a sentinel for "None".
const NONE_VALUE = "__none__"

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) return err.message
  return err instanceof Error ? err.message : fallback
}

export default function RootSetupWizard() {
  const [state, setState] = useState<SetupStateView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const s = await getSetupState()
      setState(s)
      setStep(s.status === "COMPLETED" ? 8 : s.currentStep)
    } catch (err) {
      setError(errorMessage(err, "Failed to load setup state"))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const flash = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 3500)
  }

  const persistProgress = async (nextStep: number) => {
    if (!state || state.status !== "IN_PROGRESS") return
    const completed = new Set(state.completedSteps)
    if (nextStep > 0) completed.add(nextStep - 1 >= 1 ? nextStep - 1 : 1)
    const next = [...completed].sort((a, b) => a - b)
    try {
      const updated = await saveSetupProgress(nextStep, next)
      setState(updated)
    } catch {
      // non-fatal — progress saves on every navigation
    }
  }

  const goNext = async () => {
    if (step >= 8) return
    await persistProgress(step + 1)
    setStep(step + 1)
  }

  const goBack = () => {
    if (step <= 1) return
    setStep(step - 1)
  }

  const handleStart = async () => {
    try {
      setState(await startSetup())
      setStep(1)
      flash("Setup started")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to start setup"))
    }
  }

  const handleFinish = async () => {
    if (!window.confirm("Finish platform setup? The wizard will be locked until reopened from the control center.")) return
    try {
      setState(await completeSetup())
      flash("Setup completed — the platform is ready for use")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to complete setup"))
    }
  }

  const handleReopen = async () => {
    try {
      setState(await reopenSetup())
      setStep(1)
      flash("Wizard reopened")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to reopen wizard"))
    }
  }

  if (loading) {
    return (
      <div className="content-padding">
        <PageHeader title="Platform Setup Wizard" description="Configure a newly installed URS-DMS instance" />
        <div className="min-h-[320px] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="content-padding">
        <PageHeader title="Platform Setup Wizard" description="Configure a newly installed URS-DMS instance" />
        <Card className="border-red-200 bg-red-50/50">
          <CardContent className="p-6 text-[13px] text-red-700">{error}</CardContent>
        </Card>
      </div>
    )
  }

  const completed = state?.status === "COMPLETED"
  const notStarted = state?.status === "NOT_STARTED"

  return (
    <div className="content-padding">
      <PageHeader
        title="Platform Setup Wizard"
        description={
          completed
            ? "Platform setup completed — reopen the wizard to make changes"
            : "Configure a newly installed URS-DMS instance"
        }
        actions={
          completed ? (
            <Button variant="outline" className="shadow-soft" onClick={() => void handleReopen()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Reopen Wizard
            </Button>
          ) : notStarted ? (
            <Button className="shadow-soft" onClick={() => void handleStart()}>
              <Rocket className="w-4 h-4 mr-2" />
              Start Setup
            </Button>
          ) : (
            <Button variant="outline" className="shadow-soft" onClick={() => void persistProgress(step)}>
              <Save className="w-4 h-4 mr-2" />
              Save Progress
            </Button>
          )
        }
      />

      {toast && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-[13px] text-emerald-700">
          {toast}
        </div>
      )}

      {notStarted ? (
        <Card className="border-border/70 shadow-soft">
          <CardContent className="p-10 flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Rocket className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-[18px] font-semibold text-gray-900">Welcome to the URS-DMS Setup Wizard</h2>
            <p className="text-[14px] text-gray-500 max-w-lg">
              This guided wizard configures your new instance: university identity, organization structure,
              folder and requirement templates, workflow and form assignments, and administrator accounts.
              Everything you create is stored permanently in the database — you can resume at any time.
            </p>
            <Button className="shadow-soft mt-2" onClick={() => void handleStart()}>
              <Rocket className="w-4 h-4 mr-2" />
              Start Setup
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Progress indicator */}
          <Card className="border-border/70 shadow-soft mb-6">
            <CardContent className="p-5 md:p-6">
              <div className="flex items-center gap-1 overflow-x-auto">
                {STEPS.map((item) => {
                  const Icon = item.icon
                  const isDone = state?.completedSteps.includes(item.id)
                  const isActive = step === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => !completed && setStep(item.id)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium whitespace-nowrap transition-colors",
                        isActive
                          ? "bg-primary text-white"
                          : isDone
                            ? "text-emerald-600 hover:bg-emerald-50"
                            : "text-gray-500 hover:bg-gray-100"
                      )}
                    >
                      {isDone && !isActive ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Step body */}
          <Card className="border-border/70 shadow-soft mb-6">
            <CardContent className="p-6">
              {step === 1 && <StepPlatform state={state} flash={flash} setSaving={setSaving} />}
              {step === 2 && <StepOrganization flash={flash} />}
              {step === 3 && <StepFolders flash={flash} />}
              {step === 4 && <StepRequirements flash={flash} />}
              {step === 5 && <StepWorkflows flash={flash} />}
              {step === 6 && <StepForms flash={flash} />}
              {step === 7 && <StepAdministrators flash={flash} />}
              {step === 8 && <StepSummary state={state} />}
            </CardContent>
          </Card>

          {/* Navigation */}
          {!completed && (
            <div className="flex items-center justify-between">
              <Button variant="outline" onClick={goBack} disabled={step <= 1} className="h-10 px-5">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Previous
              </Button>
              {step < 8 ? (
                <Button onClick={() => void goNext()} disabled={saving} className="h-10 px-6 shadow-soft">
                  Next
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              ) : (
                <Button onClick={() => void handleFinish()} className="h-10 px-6 shadow-soft">
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Finish Setup
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Step 1 · Platform Information ────────────────────────────────────────────

function StepPlatform({
  state,
  flash,
  setSaving,
}: {
  state: SetupStateView | null
  flash: (message: string) => void
  setSaving: (value: boolean) => void
}) {
  const [form, setForm] = useState({
    universityName: "",
    academicYear: "",
    semester: "",
    primaryColor: "#2563EB",
    secondaryColor: "#10B981",
    timezone: "Asia/Manila",
    language: "en",
  })
  const [logo, setLogo] = useState<File | null>(null)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loaded) return
    Promise.all([
      categoryConfigurations("university"),
      categoryConfigurations("academic"),
      getSetupLogoUrl(),
    ])
      .then(([university, academic, logo]) => {
        const get = (key: string) => {
          const row = [...university, ...academic].find((c) => c.key === key)
          return typeof row?.value === "string" ? row.value : ""
        }
        setForm({
          universityName: get("university.name"),
          academicYear: get("academic.year"),
          semester: get("academic.semester"),
          primaryColor: get("university.primary_color") || "#2563EB",
          secondaryColor: get("university.secondary_color") || "#10B981",
          timezone: get("university.timezone") || "Asia/Manila",
          language: get("university.language") || "en",
        })
        if (logo?.url) setLogoUrl(logo.url)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [loaded])

  const handleLogo = async (file: File) => {
    try {
      const result = await uploadSetupLogo({
        filename: file.name,
        mimeType: file.type || "image/png",
        sizeBytes: file.size,
      })
      const headers = Object.fromEntries(
        Object.entries(result.headers).filter(([key]) => key.toLowerCase() !== "content-length"),
      )
      const upload = await fetch(result.uploadUrl, { method: "PUT", headers, body: file })
      if (!upload.ok) throw new Error("Logo upload failed")
      setLogo(file)
      const logoResult = await getSetupLogoUrl()
      if (logoResult?.url) setLogoUrl(logoResult.url)
      flash("Logo uploaded to object storage")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to upload logo"))
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateConfigurations([
        { key: "university.name", value: form.universityName },
        { key: "academic.year", value: form.academicYear },
        { key: "academic.semester", value: form.semester },
        { key: "university.primary_color", value: form.primaryColor },
        { key: "university.secondary_color", value: form.secondaryColor },
        { key: "university.timezone", value: form.timezone },
        { key: "university.language", value: form.language },
      ])
      flash("Platform information saved")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to save platform information"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900">Platform Information</h3>
        <p className="text-[13px] text-gray-500 mt-0.5">Identity and defaults for this URS-DMS instance</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label className="text-[13px] font-medium">University Name</Label>
          <Input className="h-10" placeholder="University of Rizal System" value={form.universityName}
            onChange={(e) => setForm((f) => ({ ...f, universityName: e.target.value }))} />
        </div>
        <div className="grid gap-2">
          <Label className="text-[13px] font-medium">University Logo</Label>
          <div className="flex items-center gap-3">
            {logoUrl && (
              <img src={logoUrl} alt="logo" className="w-10 h-10 rounded-lg border border-border object-contain bg-white" />
            )}
            <label className="flex-1">
              <input type="file" accept="image/*" className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleLogo(file)
                }} />
              <div className="h-10 flex items-center justify-center rounded-lg border border-dashed border-gray-300 text-[13px] text-gray-500 cursor-pointer hover:bg-gray-50">
                <Upload className="w-4 h-4 mr-2" />
                {logo ? "Replace logo" : "Upload logo"}
              </div>
            </label>
          </div>
        </div>
        <div className="grid gap-2">
          <Label className="text-[13px] font-medium">Academic Year</Label>
          <Input className="h-10" placeholder="2025-2026" value={form.academicYear}
            onChange={(e) => setForm((f) => ({ ...f, academicYear: e.target.value }))} />
        </div>
        <div className="grid gap-2">
          <Label className="text-[13px] font-medium">Semester</Label>
          <Input className="h-10" placeholder="1st Semester" value={form.semester}
            onChange={(e) => setForm((f) => ({ ...f, semester: e.target.value }))} />
        </div>
        <div className="grid gap-2">
          <Label className="text-[13px] font-medium">Primary Color</Label>
          <div className="flex items-center gap-2">
            <input type="color" value={form.primaryColor}
              onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))}
              className="w-10 h-10 rounded-lg border border-border cursor-pointer" />
            <Input className="h-10 font-mono" value={form.primaryColor}
              onChange={(e) => setForm((f) => ({ ...f, primaryColor: e.target.value }))} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label className="text-[13px] font-medium">Secondary Color</Label>
          <div className="flex items-center gap-2">
            <input type="color" value={form.secondaryColor}
              onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))}
              className="w-10 h-10 rounded-lg border border-border cursor-pointer" />
            <Input className="h-10 font-mono" value={form.secondaryColor}
              onChange={(e) => setForm((f) => ({ ...f, secondaryColor: e.target.value }))} />
          </div>
        </div>
        <div className="grid gap-2">
          <Label className="text-[13px] font-medium">Timezone</Label>
          <Select value={form.timezone} onValueChange={(v) => setForm((f) => ({ ...f, timezone: v }))}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Asia/Manila">Asia/Manila (UTC+8)</SelectItem>
              <SelectItem value="Asia/Singapore">Asia/Singapore (UTC+8)</SelectItem>
              <SelectItem value="UTC">UTC</SelectItem>
              <SelectItem value="America/New_York">America/New_York</SelectItem>
              <SelectItem value="Europe/London">Europe/London</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label className="text-[13px] font-medium">Language</Label>
          <Select value={form.language} onValueChange={(v) => setForm((f) => ({ ...f, language: v }))}>
            <SelectTrigger className="h-10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="fil">Filipino</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} className="h-9 shadow-soft">
          <Save className="w-4 h-4 mr-2" />
          Save Platform Info
        </Button>
      </div>
      <p className="text-[11px] text-gray-400">Stored in the Configuration Engine (versioned) · logo stored in MinIO. Wizard state: step {state?.currentStep ?? 0}/8</p>
    </div>
  )
}

// ── Step 2 · Organization ────────────────────────────────────────────────────

function StepOrganization({ flash }: { flash: (message: string) => void }) {
  const [tab, setTab] = useState<OrgEntity>("campus")
  const [records, setRecords] = useState<OrgRecord[]>([])
  const [campuses, setCampuses] = useState<OrgRecord[]>([])
  const [colleges, setColleges] = useState<OrgRecord[]>([])
  const [dialog, setDialog] = useState<{ open: boolean; record?: OrgRecord }>({ open: false })
  const [form, setForm] = useState({ name: "", code: "", description: "", campusId: "", collegeId: "", level: "UNDERGRADUATE" })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const [rows, c, l] = await Promise.all([
        listOrgRecords(tab, { pageSize: 200 }),
        listOrgRecords("campus", { pageSize: 200 }),
        listOrgRecords("college", { pageSize: 200 }),
      ])
      setRecords(rows.items)
      setCampuses(c.items)
      setColleges(l.items)
    } catch {
      setRecords([])
    }
  }, [tab])

  useEffect(() => {
    load()
  }, [load])

  const openCreate = () => {
    setForm({ name: "", code: "", description: "", campusId: "", collegeId: "", level: "UNDERGRADUATE" })
    setDialog({ open: true })
  }

  const openEdit = (record: OrgRecord) => {
    setForm({
      name: record.name,
      code: record.code,
      description: record.description ?? "",
      campusId: record.campusId ?? "",
      collegeId: record.collegeId ?? "",
      level: record.level ?? "UNDERGRADUATE",
    })
    setDialog({ open: true, record })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const input: Record<string, unknown> = {
        name: form.name,
        code: form.code,
        description: form.description || null,
        level: tab === "program" ? form.level : undefined,
        campusId: tab !== "campus" ? form.campusId || null : undefined,
        collegeId: (tab === "office" || tab === "program") ? form.collegeId || null : undefined,
      }
      if (dialog.record) {
        await updateOrgRecord(tab, dialog.record.id, input)
      } else {
        await createOrgRecord(tab, input)
      }
      setDialog({ open: false })
      await load()
      flash(dialog.record ? "Record updated" : "Record created")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to save record"))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (record: OrgRecord) => {
    if (!window.confirm(`Archive "${record.name}"?`)) return
    try {
      await archiveOrgRecord(tab, record.id)
      await load()
      flash("Record archived")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to archive record"))
    }
  }

  const availableColleges = colleges.filter((c) => !form.campusId || c.campusId === form.campusId)

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900">Organization</h3>
        <p className="text-[13px] text-gray-500 mt-0.5">Campuses, colleges, programs and offices</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {ORG_ENTITIES.map((item) => (
          <button key={item.key} type="button" onClick={() => setTab(item.key)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors",
              tab === item.key ? "bg-primary text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            )}>
            {item.label}
          </button>
        ))}
        <Button size="sm" className="h-8 ml-auto shadow-soft" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1.5" /> Add {tab}
        </Button>
      </div>

      <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
        {records.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-gray-400">No {tab}s yet</p>}
        {records.map((record) => (
          <div key={record.id} className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-gray-900">{record.name}</p>
              <p className="text-[12px] text-gray-400 font-mono">{record.code}{record.campusName ? ` · ${record.campusName}` : ""}{record.collegeName ? ` · ${record.collegeName}` : ""}</p>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-gray-700"
                onClick={() => openEdit(record)}>
                <Pencil className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600"
                onClick={() => void handleDelete(record)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={dialog.open} onOpenChange={(open) => !open && setDialog({ open: false })}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg">{dialog.record ? "Edit" : "Add"} {tab}</DialogTitle>
            <DialogDescription className="text-[14px]">
              {dialog.record ? `Editing "${dialog.record.name}"` : `Create a new ${tab}`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Name <span className="text-red-500">*</span></Label>
                <Input className="h-10" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Code <span className="text-red-500">*</span></Label>
                <Input className="h-10 font-mono" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
              </div>
            </div>
            {tab !== "campus" && (
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Campus</Label>
                <Select value={form.campusId} onValueChange={(v) => setForm((f) => ({ ...f, campusId: v === NONE_VALUE ? "" : v, collegeId: "" }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select campus" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>None</SelectItem>
                    {campuses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(tab === "office" || tab === "program") && (
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">College</Label>
                <Select value={form.collegeId} onValueChange={(v) => setForm((f) => ({ ...f, collegeId: v === NONE_VALUE ? "" : v }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select college" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>None</SelectItem>
                    {availableColleges.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {tab === "program" && (
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Level</Label>
                <Select value={form.level} onValueChange={(v) => setForm((f) => ({ ...f, level: v }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["UNDERGRADUATE", "GRADUATE", "DOCTORAL", "CERTIFICATE", "DIPLOMA"].map((level) => (
                      <SelectItem key={level} value={level}>{level}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label className="text-[13px] font-medium">Description</Label>
              <Textarea className="min-h-[70px] resize-none" value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialog({ open: false })} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving || !form.name.trim() || !form.code.trim()} className="h-10 px-5 shadow-soft">
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Steps 3–6 · Templates & assignments (compact) ───────────────────────────

function StepFolders({ flash }: { flash: (message: string) => void }) {
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; code: string; description: string | null }>>([])
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [desc, setDesc] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await listFolderTemplates({ pageSize: 100 })
      setTemplates(result.items)
    } catch {
      setTemplates([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setSaving(true)
    try {
      const template = await createFolderTemplate({ name, code, description: desc || undefined })
      await createFolderNode(template.template.id, { name: "General Documents" })
      setName(""); setCode(""); setDesc("")
      await load()
      flash("Folder template created")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to create folder template"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900">Folder Templates</h3>
        <p className="text-[13px] text-gray-500 mt-0.5">Reusable folder structures with nested folders</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Input className="h-10" placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="h-10 font-mono" placeholder="Code (e.g. institutional-folder)" value={code} onChange={(e) => setCode(e.target.value)} />
        <div className="flex gap-2">
          <Input className="h-10" placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Button className="h-10 shadow-soft" onClick={() => void handleCreate()} disabled={saving || !name.trim() || !code.trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
        {templates.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-gray-400">No folder templates yet</p>}
        {templates.map((template) => (
          <div key={template.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-[14px] font-medium text-gray-900">{template.name}</p>
              <p className="text-[12px] text-gray-400 font-mono">{template.code}</p>
            </div>
            <Badge variant="secondary" className="text-[10px]">+ nested folders</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

function StepRequirements({ flash }: { flash: (message: string) => void }) {
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; code: string }>>([])
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [areaName, setAreaName] = useState("")
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await listRequirementTemplates({ pageSize: 100 })
      setTemplates(result.items)
    } catch {
      setTemplates([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setSaving(true)
    try {
      const template = await createRequirementTemplate({
        name,
        code,
        description: "Created by setup wizard",
      })
      await createRequirementNode(template.template.id, {
        code: "core-requirements",
        name: "Core Requirements",
        type: "SECTION",
      })
      if (areaName.trim()) {
        await createRequirementNode(template.template.id, {
          code: "area-1",
          name: areaName.trim(),
          type: "REQUIREMENT",
        })
      }
      setName(""); setCode(""); setAreaName("")
      await load()
      flash("Requirement template created")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to create requirement template"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900">Requirement Templates</h3>
        <p className="text-[13px] text-gray-500 mt-0.5">Areas, requirements, groups and validation rules</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Input className="h-10" placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input className="h-10 font-mono" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Input className="h-10" placeholder="First area name (optional)" value={areaName} onChange={(e) => setAreaName(e.target.value)} />
        <Button className="h-10 shadow-soft" onClick={() => void handleCreate()} disabled={saving || !name.trim() || !code.trim()}>
          <Plus className="w-4 h-4 mr-2" /> Create Template
        </Button>
      </div>
      <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
        {templates.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-gray-400">No requirement templates yet</p>}
        {templates.map((template) => (
          <div key={template.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-[14px] font-medium text-gray-900">{template.name}</p>
              <p className="text-[12px] text-gray-400 font-mono">{template.code}</p>
            </div>
            <Badge variant="secondary" className="text-[10px]">areas + requirements</Badge>
          </div>
        ))}
      </div>
    </div>
  )
}

function StepWorkflows({ flash }: { flash: (message: string) => void }) {
  const [definitions, setDefinitions] = useState<Array<{ id: string; name: string; code: string; status: string }>>([])
  const [selected, setSelected] = useState("")
  const [targetType, setTargetType] = useState("AACCUP_AREA")
  const [targetId, setTargetId] = useState("")
  const [targetOptions, setTargetOptions] = useState<Array<{ id: string; name: string }>>([])
  const [assigned, setAssigned] = useState<Record<string, string[]>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await listWorkflowDefinitions({ pageSize: 100 })
      setDefinitions(result.items)
    } catch {
      setDefinitions([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleAssign = async () => {
    if (!selected) return
    setSaving(true)
    try {
      const definition = definitions.find((d) => d.id === selected)
      if (!definition) return
      await assignWorkflowDefinition(
        definition.id,
        targetType as "AACCUP_AREA" | "UNIVERSITY",
        targetType === "UNIVERSITY" ? null : targetId,
      )
      setAssigned((a) => ({ ...a, [selected]: [...(a[selected] ?? []), targetType === "UNIVERSITY" ? "University (global)" : targetId] }))
      flash("Workflow assigned")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to assign workflow"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900">Workflow Assignment</h3>
        <p className="text-[13px] text-gray-500 mt-0.5">Bind workflow templates to areas or the university scope</p>
      </div>
      {definitions.length === 0 && (
        <p className="text-[13px] text-gray-500 bg-gray-50 rounded-lg p-4">
          No workflow templates yet — create them in the Workflow Builder first, then return here to assign them.
        </p>
      )}
      {definitions.map((definition) => (
        <div key={definition.id} className="rounded-lg border border-gray-100 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[14px] font-medium text-gray-900">{definition.name}</p>
              <p className="text-[12px] text-gray-400 font-mono">{definition.code} · {definition.status}</p>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              {(assigned[definition.id] ?? []).length} assignment(s)
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Select value={selected === definition.id ? targetType : ""} onValueChange={(v) => { setSelected(definition.id); setTargetType(v); setTargetId(""); setTargetOptions([]) }}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="Scope" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AACCUP_AREA">AACCUP Area</SelectItem>
                <SelectItem value="UNIVERSITY">University (global)</SelectItem>
              </SelectContent>
            </Select>
            {selected === definition.id && targetType === "AACCUP_AREA" && (
              <Button variant="ghost" size="sm" className="h-9 text-[12px] text-primary"
                onClick={() => {
                  void (async () => {
                    const areas = await (await import("@/services/aaccup")).listAllOnlineAaccupAreas({})
                    setTargetOptions(areas.map((a) => ({ id: a.id, name: a.name })))
                  })()
                }}>
                Load areas
              </Button>
            )}
            {selected === definition.id && targetType === "AACCUP_AREA" && targetOptions.length > 0 && (
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="h-9 w-[220px]">
                  <SelectValue placeholder="Select area" />
                </SelectTrigger>
                <SelectContent>
                  {targetOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" className="h-9 shadow-soft" onClick={() => void handleAssign()}
              disabled={saving || selected !== definition.id || (targetType === "AACCUP_AREA" && !targetId)}>
              <Plus className="w-4 h-4 mr-1.5" /> Assign
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

function StepForms({ flash }: { flash: (message: string) => void }) {
  const [forms, setForms] = useState<Array<{ id: string; name: string; code: string; status: string }>>([])
  const [selected, setSelected] = useState("")
  const [targetType, setTargetType] = useState<FormAssignmentTargetType>("REQUIREMENT_TEMPLATE")
  const [targetId, setTargetId] = useState("")
  const [targetOptions, setTargetOptions] = useState<Array<{ id: string; label: string }>>([])
  const [assigned, setAssigned] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await listForms({ pageSize: 100 })
      setForms(result.items)
    } catch {
      setForms([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const loadTargets = async (type: FormAssignmentTargetType) => {
    setTargetId("")
    if (type === "UNIVERSITY") {
      setTargetOptions([])
      return
    }
    try {
      setTargetOptions(await listFormAssignmentTargetOptions(type))
    } catch {
      setTargetOptions([])
    }
  }

  const handleAssign = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await assignForm(selected, {
        targetType,
        targetId: targetType === "UNIVERSITY" ? null : targetId,
      })
      setAssigned((a) => ({ ...a, [selected]: (a[selected] ?? 0) + 1 }))
      flash("Form assigned")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to assign form"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900">Form Assignment</h3>
        <p className="text-[13px] text-gray-500 mt-0.5">Attach forms to requirements, workflow steps or areas</p>
      </div>
      {forms.length === 0 && (
        <p className="text-[13px] text-gray-500 bg-gray-50 rounded-lg p-4">
          No forms yet — create them in the Form Builder first, then return here to assign them.
        </p>
      )}
      {forms.map((form) => (
        <div key={form.id} className="rounded-lg border border-gray-100 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[14px] font-medium text-gray-900">{form.name}</p>
              <p className="text-[12px] text-gray-400 font-mono">{form.code} · {form.status}</p>
            </div>
            <Badge variant="secondary" className="text-[10px]">{(assigned[form.id] ?? 0)} assignment(s)</Badge>
          </div>
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Select value={selected === form.id ? targetType : ""}
              onValueChange={(v) => { setSelected(form.id); const t = v as FormAssignmentTargetType; setTargetType(t); void loadTargets(t) }}>
              <SelectTrigger className="h-9 w-[220px]">
                <SelectValue placeholder="Target type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="REQUIREMENT_TEMPLATE">Requirement Template</SelectItem>
                <SelectItem value="WORKFLOW_STEP">Workflow Step</SelectItem>
                <SelectItem value="AACCUP_AREA">AACCUP Area</SelectItem>
                <SelectItem value="FOLDER_TEMPLATE">Folder Template</SelectItem>
                <SelectItem value="UNIVERSITY">University (global)</SelectItem>
              </SelectContent>
            </Select>
            {selected === form.id && targetType !== "UNIVERSITY" && (
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="h-9 w-[240px]">
                  <SelectValue placeholder="Select target" />
                </SelectTrigger>
                <SelectContent>
                  {targetOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" className="h-9 shadow-soft" onClick={() => void handleAssign()}
              disabled={saving || selected !== form.id || (targetType !== "UNIVERSITY" && !targetId)}>
              <Plus className="w-4 h-4 mr-1.5" /> Assign
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Step 7 · Administrators ──────────────────────────────────────────────────

function StepAdministrators({ flash }: { flash: (message: string) => void }) {
  const [admins, setAdmins] = useState<Array<{ id: string; name: string; email: string; departmentName: string | null }>>([])
  const [departments, setDepartments] = useState<Array<{ id: string; name: string }>>([])
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([])
  const [dialog, setDialog] = useState(false)
  const [form, setForm] = useState({ name: "", email: "", password: "", departmentId: "", roleId: "" })
  const [sending, setSending] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const [userRows, deptRows, roleRows] = await Promise.all([
        listSystemUsers({ pageSize: 100 }),
        listSystemDepartments({ pageSize: 100 }),
        listSystemRoles({ pageSize: 100 }),
      ])
      setAdmins(
        userRows.items
          .filter((user) => user.roleName === "ADMINISTRATOR")
          .map((user) => ({
            id: user.id,
            name: [user.firstName, user.lastName].filter(Boolean).join(" "),
            email: user.email,
            departmentName: user.departmentName,
          })),
      )
      setDepartments(deptRows.items)
      setRoles(roleRows.items)
    } catch {
      setAdmins([])
      setDepartments([])
      setRoles([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    setSaving(true)
    try {
      const nameParts = form.name.trim().split(/\s+/)
      await createSystemUser({
        employeeId: `ADMIN-${Date.now().toString(36).toUpperCase()}`,
        email: form.email,
        password: form.password,
        firstName: nameParts[0] ?? form.name,
        lastName: nameParts.slice(1).join(" ") || (nameParts[0] ?? "User"),
        roleId: form.roleId,
        departmentId: form.departmentId || null,
        mustChangePassword: true,
      })
      setDialog(false)
      setForm({ name: "", email: "", password: "", departmentId: "", roleId: "" })
      await load()
      flash("Administrator account created")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to create administrator"))
    } finally {
      setSaving(false)
    }
  }

  const handleSendCredentials = async (admin: { id: string; name: string; email: string }) => {
    setSending(admin.id)
    try {
      await sendSetupCredentials({
        email: admin.email,
        name: admin.name,
        password: "ChangeMe-12345",
        roleName: "ADMINISTRATOR",
      })
      flash("Initial password email queued")
    } catch (err) {
      window.alert(errorMessage(err, "Failed to queue email"))
    } finally {
      setSending(null)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900">Administrator Setup</h3>
        <p className="text-[13px] text-gray-500 mt-0.5">Create administrator accounts with department and role assignment</p>
      </div>
      <div className="flex justify-end">
        <Button size="sm" className="h-9 shadow-soft" onClick={() => setDialog(true)}>
          <Plus className="w-4 h-4 mr-1.5" /> Add Administrator
        </Button>
      </div>
      <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
        {admins.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-gray-400">No administrator accounts yet</p>}
        {admins.map((admin) => (
          <div key={admin.id} className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                <Users className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-[14px] font-medium text-gray-900">{admin.name}</p>
                <p className="text-[12px] text-gray-400">{admin.email} · {admin.departmentName ?? "No department"}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-8 text-[12px]" disabled={sending === admin.id}
              onClick={() => void handleSendCredentials(admin)}>
              <Mail className="w-3.5 h-3.5 mr-1.5" />
              {sending === admin.id ? "Sending..." : "Send Initial Password"}
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary" />
              New Administrator
            </DialogTitle>
            <DialogDescription className="text-[14px]">
              The account is created through the user administration service; the initial password can be emailed afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <div className="grid gap-2">
              <Label className="text-[13px] font-medium">Full Name <span className="text-red-500">*</span></Label>
              <Input className="h-10" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label className="text-[13px] font-medium">Email <span className="text-red-500">*</span></Label>
              <Input className="h-10" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label className="text-[13px] font-medium">Initial Password <span className="text-red-500">*</span></Label>
              <Input className="h-10" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Role <span className="text-red-500">*</span></Label>
                <Select value={form.roleId} onValueChange={(v) => setForm((f) => ({ ...f, roleId: v }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Department</Label>
                <Select value={form.departmentId} onValueChange={(v) => setForm((f) => ({ ...f, departmentId: v === NONE_VALUE ? "" : v }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="No department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>No department</SelectItem>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialog(false)} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={saving || !form.name.trim() || !form.email.trim() || !form.password || !form.roleId}
              className="h-10 px-5 shadow-soft">
              {saving ? "Creating..." : "Create Account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Step 8 · Summary ─────────────────────────────────────────────────────────

function StepSummary({ state }: { state: SetupStateView | null }) {
  const s = state?.summary
  const rows = [
    { label: "Campuses", value: s?.organizations.campuses ?? 0 },
    { label: "Colleges", value: s?.organizations.colleges ?? 0 },
    { label: "Programs", value: s?.organizations.programs ?? 0 },
    { label: "Offices", value: s?.organizations.offices ?? 0 },
    { label: "Folder templates", value: s?.folderTemplates ?? 0 },
    { label: "Requirement templates", value: s?.requirementTemplates ?? 0 },
    { label: "Workflow definitions", value: s?.workflows ?? 0 },
    { label: "Form templates", value: s?.forms ?? 0 },
    { label: "Administrators", value: s?.administrators ?? 0 },
    { label: "Config keys configured", value: s?.configKeysConfigured ?? 0 },
  ]
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-[15px] font-semibold text-gray-900">Setup Summary</h3>
        <p className="text-[13px] text-gray-500 mt-0.5">
          Everything below was created through the platform engines and is stored permanently in PostgreSQL.
          {state?.status === "COMPLETED" ? " The wizard is complete." : " Finish the wizard to lock it."}
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {rows.map((row) => (
          <div key={row.label} className="p-4 rounded-xl border border-gray-100 bg-gray-50/50">
            <p className="text-[22px] font-semibold text-gray-900">{row.value}</p>
            <p className="text-[12px] text-gray-500 mt-0.5">{row.label}</p>
          </div>
        ))}
      </div>
      {state?.status === "COMPLETED" && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          <div>
            <p className="text-[14px] font-medium text-emerald-800">Platform setup completed</p>
            <p className="text-[12px] text-emerald-700/80">
              Completed {state.completedAt ? new Date(state.completedAt).toLocaleString() : ""} — log in as an administrator to start using the platform.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}