import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileText,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/Tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import { Label } from "@/components/ui/Label"
import { Input } from "@/components/ui/Input"
import { Textarea } from "@/components/ui/Textarea"
import { Dropzone } from "@/components/ui/Dropzone"
import { Skeleton } from "@/components/ui/Skeleton"
import { EmptyState } from "@/components/ui/EmptyState"
import { toast } from "@/lib/toast"
import { hasPermission } from "@/lib/permissions"
import { useAuth } from "@/context/AuthContext"
import {
  listAllOnlineSubmissions,
  listMyAaccupSubmissions,
  listOnlineAaccupAreas,
  listOnlineRequirements,
  submitOnlineRepositoryDocument,
  uploadOnlineRequirementDocument,
  validateOnlineRequirementUpload,
  type AreaSet,
  type OnlineAaccupArea,
  type OnlineAaccupRequirement,
  type OnlineAaccupSubmission,
} from "@/services/aaccup"
import { RepositoryDocumentPicker } from "@/components/aaccup/RepositoryDocumentPicker"
import type { Document } from "@/types/domain"

// =============================================================================
// UserAccreditationView — shared accreditation surface for the user portal
// -----------------------------------------------------------------------------
// Renders one accreditation set (AACCUP / ISO) with its own
// record set — areas, requirements and the user's own submissions are scoped
// by `areaSet`, matching the admin-side tab separation exactly.
// =============================================================================

const SET_META: Record<AreaSet, { title: string; description: string }> = {
  AACCUP: {
    title: "AACCUP Management",
    description: "Manage accreditation areas, submissions, and compliance tracking.",
  },
  ISO: {
    title: "ISO 21001:2025",
    description: "Manage ISO accreditation areas, submissions, and compliance tracking.",
  },
}

function statusBadge(status: OnlineAaccupSubmission["status"] | "MISSING") {
  switch (status) {
    case "APPROVED": return <Badge variant="success">Approved</Badge>
    case "PENDING": return <Badge variant="warning">Pending Review</Badge>
    case "NEEDS_REVISION": return <Badge variant="warning">Needs Revision</Badge>
    case "REJECTED": return <Badge variant="danger">Rejected</Badge>
    default: return <Badge variant="secondary">Not Submitted</Badge>
  }
}

function statusIcon(status: OnlineAaccupSubmission["status"] | "MISSING") {
  if (status === "APPROVED") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (status === "REJECTED" || status === "NEEDS_REVISION") return <AlertCircle className="h-4 w-4 text-amber-600" />
  return <Clock3 className="h-4 w-4 text-slate-400" />
}

function requiredMetadataKeys(requirement: OnlineAaccupRequirement): string[] {
  return requirement.validations.flatMap((rule) => {
    if (rule.type !== "METADATA" || !Array.isArray(rule.config.requiredKeys)) return []
    return rule.config.requiredKeys.filter((value): value is string => typeof value === "string")
  })
}

function groups(requirements: OnlineAaccupRequirement[]): Array<[string, OnlineAaccupRequirement[]]> {
  const map = new Map<string, OnlineAaccupRequirement[]>()
  for (const requirement of requirements) {
    const category = requirement.category || "General Requirements"
    map.set(category, [...(map.get(category) ?? []), requirement])
  }
  return [...map.entries()]
}

export function UserAccreditationView({ areaSet, navigation }: { areaSet: AreaSet; navigation?: ReactNode }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canUpload = Boolean(user && hasPermission(user.role, "canUpload"))
  const [areas, setAreas] = useState<OnlineAaccupArea[]>([])
  const [activeAreaId, setActiveAreaId] = useState("")
  const [requirements, setRequirements] = useState<OnlineAaccupRequirement[]>([])
  const [submissions, setSubmissions] = useState<OnlineAaccupSubmission[]>([])
  const [areaSubmissionCounts, setAreaSubmissionCounts] = useState<Record<string, number>>({})
  const [areasLoading, setAreasLoading] = useState(true)
  const [requirementsLoading, setRequirementsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [uploadRequirement, setUploadRequirement] = useState<OnlineAaccupRequirement | null>(null)
  const [title, setTitle] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [repositoryDocument, setRepositoryDocument] = useState<Document | null>(null)
  const [repositoryPickerOpen, setRepositoryPickerOpen] = useState(false)
  const [remarks, setRemarks] = useState("")
  const [pageCount, setPageCount] = useState("")
  const [expirationDate, setExpirationDate] = useState("")
  const [metadata, setMetadata] = useState<Record<string, string>>({})
  const [uploading, setUploading] = useState(false)
  const [validationMessages, setValidationMessages] = useState<string[]>([])

  const activeArea = areas.find((area) => area.id === activeAreaId) ?? null
  const meta = SET_META[areaSet]

  const loadAreas = useCallback(async () => {
    setAreasLoading(true)
    setError(null)
    try {
      const nextAreas = await listOnlineAaccupAreas(areaSet)
      setAreas(nextAreas)
      setActiveAreaId((current) => current || nextAreas[0]?.id || "")
      const ownSubmissions = await listAllOnlineSubmissions({ areaSet })
      setAreaSubmissionCounts(
        ownSubmissions.reduce<Record<string, number>>((acc, submission) => {
          acc[submission.areaId] = (acc[submission.areaId] ?? 0) + 1
          return acc
        }, {}),
      )
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : `Unable to load dynamic ${meta.title} areas`)
    } finally {
      setAreasLoading(false)
    }
  }, [areaSet, meta.title])

  const loadAreaData = useCallback(async (areaId: string) => {
    setRequirementsLoading(true)
    setError(null)
    try {
      const [nextRequirements, nextSubmissions] = await Promise.all([
        listOnlineRequirements(areaId),
        listMyAaccupSubmissions(areaId),
      ])
      setRequirements(nextRequirements)
      setSubmissions(nextSubmissions)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load dynamic requirements")
      setRequirements([])
      setSubmissions([])
    } finally {
      setRequirementsLoading(false)
    }
  }, [])

  useEffect(() => { void loadAreas() }, [loadAreas])
  useEffect(() => { if (activeAreaId) void loadAreaData(activeAreaId) }, [activeAreaId, loadAreaData])

  const submissionByRequirement = new Map(
    submissions
      .filter((submission) => submission.isCurrent)
      .map((submission) => [submission.requirementId, submission]),
  )
  const required = requirements.filter((requirement) => requirement.isRequired)
  const approved = required.filter(
    (requirement) => submissionByRequirement.get(requirement.id)?.status === "APPROVED",
  ).length
  const completion = required.length ? Math.round((approved / required.length) * 100) : 0
  const pending = submissions.filter((submission) => submission.status === "PENDING").length
  const needsRevision = submissions.filter(
    (submission) => submission.status === "NEEDS_REVISION" || submission.status === "REJECTED",
  ).length

  const openUpload = (requirement: OnlineAaccupRequirement) => {
    setUploadRequirement(requirement)
    setTitle(requirement.title)
    setFile(null)
    setRepositoryDocument(null)
    setRemarks("")
    setPageCount("")
    setExpirationDate("")
    setMetadata(Object.fromEntries(requiredMetadataKeys(requirement).map((key) => [key, ""])))
    setValidationMessages([])
  }

  const handleUpload = async () => {
    if (!uploadRequirement || !activeArea || (!file && !repositoryDocument) || !title.trim()) return
    setUploading(true)
    setValidationMessages([])
    try {
      if (repositoryDocument) {
        await submitOnlineRepositoryDocument({
          requirementId: uploadRequirement.id,
          documentId: repositoryDocument.id,
          remarks: remarks.trim() || undefined,
        })
        toast.success("Repository document submitted for review")
        setUploadRequirement(null)
        await loadAreaData(activeArea.id)
        return
      }
      if (!file) return
      const input = {
        requirementId: uploadRequirement.id,
        departmentId: activeArea.departmentId,
        title: title.trim(),
        areaName: activeArea.name,
        requirementCode: uploadRequirement.documentCode,
        file,
        remarks: remarks.trim() || undefined,
        pageCount: pageCount ? Number(pageCount) : undefined,
        expirationDate: expirationDate || undefined,
        metadata,
      }
      const validation = await validateOnlineRequirementUpload(input)
      if (!validation.valid) {
        setValidationMessages(validation.errors.map((issue) => issue.message))
        return
      }
      if (validation.warnings.length > 0) {
        toast.warning(validation.warnings.map((issue) => issue.message).join(" "))
      }
      await uploadOnlineRequirementDocument(input)
      toast.success("Document uploaded and submitted for review")
      setUploadRequirement(null)
      await loadAreaData(activeArea.id)
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "Upload failed"
      setValidationMessages([message])
      toast.error(message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="content-padding">
      <PageHeader
        title={meta.title}
        description={meta.description}
        actions={<Button variant="outline" onClick={() => void loadAreas()}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>}
      />
      {navigation && <div className="mb-6 lg:mb-8">{navigation}</div>}

      {error && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" /><div><p className="text-[13px] font-semibold text-red-900">Dynamic requirements unavailable</p><p className="mt-1 text-[12px] text-red-700">{error}</p></div></div>
          <Button size="sm" variant="outline" onClick={() => void loadAreas()}>Retry</Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="border-border/70"><CardContent className="p-5 pt-7 md:p-6 md:pt-7"><div className="flex items-center justify-between"><span className="text-[12px] font-medium text-slate-500">Required Progress</span><FileCheck2 className="h-4 w-4 text-primary" /></div><p className="mt-2 text-2xl font-semibold text-navy-900">{completion}%</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-navy-50"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completion}%` }} /></div><p className="mt-2 text-[11px] text-slate-500">{approved} of {required.length} approved</p></CardContent></Card>
        <Card className="border-border/70"><CardContent className="p-5 pt-7 md:p-6 md:pt-7"><div className="flex items-center justify-between"><span className="text-[12px] font-medium text-slate-500">Approved</span><CheckCircle2 className="h-4 w-4 text-emerald-500" /></div><p className="mt-2 text-2xl font-semibold text-navy-900">{submissions.filter((submission) => submission.status === "APPROVED").length}</p><p className="mt-3 text-[11px] text-slate-500">Approved submissions in this set</p></CardContent></Card>
        <Card className="border-border/70"><CardContent className="p-5 pt-7 md:p-6 md:pt-7"><div className="flex items-center justify-between"><span className="text-[12px] font-medium text-slate-500">Pending Review</span><Clock3 className="h-4 w-4 text-amber-500" /></div><p className="mt-2 text-2xl font-semibold text-navy-900">{pending}</p><p className="mt-3 text-[11px] text-slate-500">Current submissions awaiting QA action</p></CardContent></Card>
        <Card className="border-border/70"><CardContent className="p-5 pt-7 md:p-6 md:pt-7"><div className="flex items-center justify-between"><span className="text-[12px] font-medium text-slate-500">Needs Attention</span><AlertCircle className="h-4 w-4 text-rose-500" /></div><p className="mt-2 text-2xl font-semibold text-navy-900">{needsRevision}</p><p className="mt-3 text-[11px] text-slate-500">Rejected or revision-requested submissions</p></CardContent></Card>
      </div>

      <Card className="mt-5 overflow-hidden border-border/70">
        <CardContent className="p-2 pt-2 pb-2 md:p-2 md:pt-2 md:pb-2">
          {areasLoading ? <Skeleton variant="rectangular" className="h-11" />
            : areas.length === 0 ? <p className="py-3 text-center text-[12px] text-slate-500">No active {meta.title} areas are assigned to your account.</p>
              : <Tabs value={activeAreaId} onValueChange={setActiveAreaId}><TabsList className="flex h-9 w-full justify-start gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{areas.map((area) => {
                const count = areaSubmissionCounts[area.id] ?? 0
                return (
                  <TabsTrigger key={area.id} value={area.id} className="min-w-max px-4 py-1.5 text-[12px]">
                    {area.code}
                    {count > 0 && (
                      <span className="ml-2 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-primary-100 px-1 text-[10px] font-semibold text-primary-600">
                        {count}
                      </span>
                    )}
                  </TabsTrigger>
                )
              })}</TabsList></Tabs>}
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden border-border/70">
          <CardHeader className="border-b border-border/70 bg-primary-50/40 p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><CardTitle className="text-[15px] truncate">{activeArea?.name ?? "Select an area"}</CardTitle><p className="mt-1 text-[12px] text-gray-500 truncate">{activeArea?.description ?? "Requirements load from active ROOT assignments."}</p></div>
              {activeArea?.accreditationCycleName && <Badge variant="outline"><ShieldCheck className="mr-1 h-3 w-3" />{activeArea.accreditationCycleName}</Badge>}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {requirementsLoading ? <div className="space-y-3 p-5">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} variant="rectangular" className="h-16" />)}</div>
              : requirements.length === 0 ? <EmptyState variant="tasks" title="No active requirements" description="A ROOT administrator must assign an active Requirement Builder template to this area or its organization scope." />
                : groups(requirements).map(([category, rows]) => (
                  <section key={category}>
                    <div className="border-b border-t border-border/70 bg-slate-50 px-4 py-2.5 first:border-t-0 sm:px-5"><h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{category}</h3></div>
                    <div className="divide-y divide-slate-100">
                      {rows.map((requirement) => {
                        const submission = submissionByRequirement.get(requirement.id)
                        const status = submission?.status ?? "MISSING"
                        return (
                          <div key={requirement.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                            <div className="flex min-w-0 items-start gap-3">
                              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-50">{statusIcon(status)}</span>
                              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-[13px] font-semibold text-navy-900">{requirement.title}</p>{requirement.isRequired && <Badge variant="warning">Required</Badge>}</div><p className="mt-1 font-mono text-[10px] text-slate-400">{requirement.documentCode}</p>{requirement.description && <p className="mt-1 text-[11px] text-slate-500">{requirement.description}</p>}<div className="mt-2 flex flex-wrap gap-1">{requirement.validations.map((rule) => <Badge key={rule.id} variant="outline">{rule.type.replace(/_/g, " ")}</Badge>)}</div></div>
                            </div>
                            <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">{statusBadge(status)}<Button size="sm" disabled={!canUpload || status === "APPROVED"} onClick={() => openUpload(requirement)}><Upload className="mr-1.5 h-3.5 w-3.5" />{submission ? "Replace" : "Submit"}</Button></div>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ))}
          </CardContent>
        </Card>

        <Card className="h-fit border-border/70">
          <CardHeader className="pb-3"><CardTitle className="text-[14px]">Recent Submissions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {submissions.length === 0 ? <p className="py-6 text-center text-[12px] text-slate-500">No submissions for this area.</p>
              : submissions.slice(0, 8).map((submission) => <div key={submission.id} className="rounded-lg border border-border/70 p-3"><div className="flex items-start gap-2"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium text-navy-900">{submission.documentTitle}</p><p className="mt-1 truncate text-[10px] text-slate-500">{submission.requirementTitle}</p><div className="mt-2 flex items-center justify-between">{statusBadge(submission.status)}<span className="text-[10px] text-slate-400">{new Date(submission.submittedAt).toLocaleDateString()}</span></div></div></div></div>)}
            <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => navigate(`/user/submissions?areaSet=${areaSet}`)}>My Submissions</Button>
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(uploadRequirement)} onOpenChange={(open) => !open && setUploadRequirement(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Submit Evidence</DialogTitle><DialogDescription>{uploadRequirement?.title} ({uploadRequirement?.documentCode})</DialogDescription></DialogHeader>
          <div className="max-h-[68vh] space-y-4 overflow-y-auto py-3">
            <div className="space-y-2"><Label>Document Title</Label><Input value={title} onChange={(event) => setTitle(event.target.value)} /></div>
            <div className="space-y-2"><Label>Evidence source</Label>
              {repositoryDocument ? (
                <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-primary-50 p-3"><FileText className="h-5 w-5 shrink-0 text-primary-600" /><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium text-blue-900">{repositoryDocument.name}</p><p className="text-[11px] text-blue-700">Selected from My Documents</p></div><Button type="button" size="sm" variant="outline" onClick={() => setRepositoryDocument(null)}>Change</Button></div>
              ) : (<><Dropzone accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.csv,.txt,.mp4,.webm,.mov,.avi,.mkv" onChange={(files) => { setFile(files[0] ?? null); setRepositoryDocument(null) }} /><div className="flex items-center gap-2"><span className="h-px flex-1 bg-slate-200" /><span className="text-[10px] uppercase tracking-wider text-slate-400">or</span><span className="h-px flex-1 bg-slate-200" /></div><Button type="button" variant="outline" className="w-full" onClick={() => setRepositoryPickerOpen(true)}><FileText className="mr-2 h-4 w-4" />Choose from My Documents</Button></>)}
            </div>
            {uploadRequirement?.validations.some((rule) => rule.type === "PAGE_COUNT") && <div className="space-y-2"><Label>Page Count</Label><Input type="number" min="1" value={pageCount} onChange={(event) => setPageCount(event.target.value)} /></div>}
            {uploadRequirement?.validations.some((rule) => rule.type === "EXPIRATION_DATE") && <div className="space-y-2"><Label>Expiration Date</Label><Input type="date" value={expirationDate} onChange={(event) => setExpirationDate(event.target.value)} /></div>}
            {uploadRequirement && requiredMetadataKeys(uploadRequirement).map((key) => <div key={key} className="space-y-2"><Label>{key}</Label><Input value={metadata[key] ?? ""} onChange={(event) => setMetadata((current) => ({ ...current, [key]: event.target.value }))} /></div>)}
            <div className="space-y-2"><Label>Remarks</Label><Textarea value={remarks} onChange={(event) => setRemarks(event.target.value)} placeholder="Optional context for the reviewer" /></div>
            {validationMessages.length > 0 && <div className="rounded-lg border border-red-200 bg-red-50 p-3">{validationMessages.map((message) => <p key={message} className="text-[12px] text-red-700">{message}</p>)}</div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setUploadRequirement(null)}>Cancel</Button><Button onClick={() => void handleUpload()} disabled={uploading || (!file && !repositoryDocument) || !title.trim()}>{uploading ? "Submitting..." : repositoryDocument ? "Submit Selected Document" : "Upload and Submit"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <RepositoryDocumentPicker open={repositoryPickerOpen} onOpenChange={setRepositoryPickerOpen} onSelect={(document) => { setRepositoryDocument(document); setFile(null) }} />
    </div>
  )
}
