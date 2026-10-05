import { useState, useCallback, useEffect } from "react"
import { HardDrive, RefreshCw, ScanSearch, Trash2, Recycle } from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table"
import { Skeleton } from "@/components/ui/Skeleton"
import { toast } from "@/lib/toast"
import { apiGet, apiPost } from "@/lib/http"
import { cn } from "@/lib/utils"

// =============================================================================
// RootMaintenance — Root Console storage maintenance (Sprint 8.3).
// ROOT-only surface (server enforces requireRole("ROOT") + root.access):
// storage statistics, job history, orphan candidates, and controlled
// maintenance actions. Every destructive action requires confirmation;
// dry-run mode previews without deleting anything.
// =============================================================================

interface MaintenanceStatus {
  jobs: Array<{
    jobId: string
    jobType: string
    status: string
    triggerSource: string
    dryRun: boolean
    totalScanned: number
    eligibleCount: number
    removedCount: number
    failedCount: number
    bytesReclaimed: string
    error: string | null
    startedAt: string | null
    completedAt: string | null
    createdAt: string
  }>
  locks: Array<{ jobType: string; lockExpiresAt: string }>
  orphanCandidates: Record<string, number>
  orphanReadyForCleanup: number
  stats: {
    objectStorageUsedBytes: string
    storedObjectCount: number
    activeFileCount: number
    recycleBinStorageBytes: string
    pendingOrphanStorageBytes: string
    pendingOrphanCount: number
    availableCapacityBytes: number | null
    totalCapacityBytes: number | null
    minio: { status: string; bucketExists: boolean }
  }
}

interface OrphanCandidate {
  objectKey: string
  status: string
  firstSeenAt: string
  lastSeenAt: string
  sizeBytes: string
  removedAt: string | null
}

function formatBytes(value: string): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(value: string | null): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

const jobBadge: Record<string, "success" | "warning" | "danger" | "secondary"> = {
  COMPLETED: "success",
  RUNNING: "warning",
  FAILED: "danger",
  PENDING: "secondary",
}

export default function RootMaintenance() {
  const [status, setStatus] = useState<MaintenanceStatus | null>(null)
  const [orphans, setOrphans] = useState<OrphanCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<"recycle" | "orphans" | null>(null)
  const [dryRunMode, setDryRunMode] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [statusData, orphanData] = await Promise.all([
        apiGet<MaintenanceStatus>("/root/maintenance/status"),
        apiGet<OrphanCandidate[]>("/root/maintenance/orphans?limit=100"),
      ])
      setStatus(statusData)
      setOrphans(orphanData)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Unable to load maintenance status")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const runAction = async (endpoint: string) => {
    setRunning(endpoint)
    try {
      const result = await apiPost<{ jobId: string; dryRun: boolean }>(`/root/maintenance/${endpoint}`, {
        dryRun: dryRunMode,
        confirm: true,
      })
      toast.success(
        result.dryRun
          ? `Dry run complete (job ${result.jobId}) — nothing was deleted`
          : `Cleanup complete (job ${result.jobId})`,
      )
      setConfirmAction(null)
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Maintenance action failed")
    } finally {
      setRunning(null)
    }
  }

  const stats = status?.stats

  return (
    <div className="content-padding">
      <PageHeader
        title="Storage Maintenance"
        description="Recycle Bin retention, orphaned object cleanup, and storage integrity — ROOT only."
        actions={
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-[13px] text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={dryRunMode}
                onChange={(e) => setDryRunMode(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 accent-primary"
              />
              Dry run (preview, delete nothing)
            </label>
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 responsive-gap mb-6 lg:mb-8">
        <Card className="border-border/70 shadow-soft">
          <CardContent className="p-5 md:p-6">
            <p className="text-[12px] text-gray-500">Object Storage Used</p>
            <p className="text-[18px] font-semibold text-gray-900 mt-1">
              {stats ? formatBytes(stats.objectStorageUsedBytes) : "—"}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">{stats?.storedObjectCount ?? "—"} stored objects</p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-soft">
          <CardContent className="p-5 md:p-6">
            <p className="text-[12px] text-gray-500">Active Files</p>
            <p className="text-[18px] font-semibold text-gray-900 mt-1">{stats?.activeFileCount ?? "—"}</p>
            <p className="text-[11px] text-gray-400 mt-1">
              Recycle Bin: {stats ? formatBytes(stats.recycleBinStorageBytes) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-soft">
          <CardContent className="p-5 md:p-6">
            <p className="text-[12px] text-gray-500">Orphan Candidates</p>
            <p className="text-[18px] font-semibold text-gray-900 mt-1">{status?.orphanCandidates.CANDIDATE ?? 0}</p>
            <p className="text-[11px] text-gray-400 mt-1">
              Ready (past 7-day grace): {status?.orphanReadyForCleanup ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-soft">
          <CardContent className="p-5 md:p-6">
            <p className="text-[12px] text-gray-500">MinIO</p>
            <p className="text-[18px] font-semibold text-gray-900 mt-1">
              <Badge variant={stats?.minio.status === "up" ? "success" : "danger"}>
                {stats?.minio.status === "up" ? "Connected" : "Down"}
              </Badge>
            </p>
            <p className="text-[11px] text-gray-400 mt-1">Server capacity: not exposed (untrustworthy at this layer)</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 shadow-soft mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-primary" />
            Maintenance Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" disabled={running !== null} onClick={() => void runAction("scan")}>
            <ScanSearch className="w-4 h-4 mr-2" />
            {running === "scan" ? "Scanning..." : "Run Storage Scan"}
          </Button>
          <Button
            variant="outline"
            className="border-amber-300 text-amber-700 hover:bg-amber-50"
            disabled={running !== null}
            onClick={() => setConfirmAction("recycle")}
          >
            <Recycle className="w-4 h-4 mr-2" />
            Recycle Bin Cleanup
          </Button>
          <Button
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-50"
            disabled={running !== null}
            onClick={() => setConfirmAction("orphans")}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Cleanup Verified Orphans
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2 mb-6">
        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px] font-semibold">Recent Maintenance Jobs</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Counts</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={4}><Skeleton variant="rectangular" className="h-10" /></TableCell></TableRow>
                ) : !status || status.jobs.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-gray-400 text-[13px] py-6">No maintenance jobs yet</TableCell></TableRow>
                ) : (
                  status.jobs.map((job) => (
                    <TableRow key={job.jobId}>
                      <TableCell>
                        <p className="text-[13px] font-medium text-gray-900">{job.jobType}</p>
                        <p className="text-[11px] text-gray-400">{job.jobId} · {job.triggerSource}{job.dryRun ? " · dry run" : ""}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={jobBadge[job.status] ?? "secondary"} className="text-[10px]">{job.status}</Badge>
                        {job.error && <p className="text-[10px] text-red-500 mt-1 max-w-[140px] truncate">{job.error}</p>}
                      </TableCell>
                      <TableCell className="text-[12px] text-gray-600">
                        scanned {job.totalScanned} · removed {job.removedCount} · failed {job.failedCount}
                      </TableCell>
                      <TableCell className="text-[12px] text-gray-500">{formatDate(job.completedAt ?? job.startedAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-3">
            <CardTitle className="text-[15px] font-semibold">Orphan Candidates</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Object</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>First Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={4}><Skeleton variant="rectangular" className="h-10" /></TableCell></TableRow>
                ) : orphans.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-gray-400 text-[13px] py-6">No orphan candidates</TableCell></TableRow>
                ) : (
                  orphans.map((candidate) => (
                    <TableRow key={candidate.objectKey}>
                      <TableCell className="text-[12px] font-mono text-gray-700 max-w-[220px] truncate">{candidate.objectKey}</TableCell>
                      <TableCell>
                        <Badge
                          variant={candidate.status === "REMOVED" ? "success" : candidate.status === "RE_REFERENCED" ? "secondary" : "warning"}
                          className="text-[10px]"
                        >
                          {candidate.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[12px] text-gray-600">{formatBytes(candidate.sizeBytes)}</TableCell>
                      <TableCell className="text-[12px] text-gray-500">{formatDate(candidate.firstSeenAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-lg">
              {confirmAction === "recycle" ? "Run Recycle Bin Cleanup?" : "Run Verified Orphan Cleanup?"}
            </DialogTitle>
            <DialogDescription className="text-[14px]">
              {dryRunMode
                ? "Dry run: this will preview what WOULD be removed without deleting anything."
                : confirmAction === "recycle"
                ? "Files and folders older than 30 days in the Recycle Bin will be permanently removed. Snapshot-referenced and shared-blob objects are preserved."
                : "MinIO objects with no database reference and past the 7-day grace period will be permanently deleted after re-verification."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmAction(null)} className="h-10 px-5">Cancel</Button>
            <Button
              className={cn("h-10 px-5 shadow-soft", !dryRunMode && confirmAction === "orphans" && "bg-red-600 hover:bg-red-700")}
              disabled={running !== null}
              onClick={() => void runAction(confirmAction === "recycle" ? "cleanup-recycle" : "cleanup-orphans")}
            >
              {running ? "Running..." : dryRunMode ? "Preview" : "Confirm & Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
