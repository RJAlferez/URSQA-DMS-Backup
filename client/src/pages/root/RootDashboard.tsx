import { useEffect, useState, useCallback } from "react"
import {
  ServerCog,
  Database,
  HardDrive,
  Network,
  Mail,
  RefreshCw,
  Activity,
  Settings2,
  Lock,
  Award,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { StatCard } from "@/components/layout/StatCard"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table"
import { getOverview, formatConfigValue, getAuditSummary, type RootPlatformOverview } from "@/services/root"
import { getDashboardOverview, type DashboardOverview } from "@/services/dashboard"
import { ApiRequestError } from "@/lib/http"

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatBytes(raw: string): string {
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  if (n === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1)
  return `${(n / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

function StatusPill({ ok, okLabel = "Operational" }: { ok: boolean; okLabel?: string }) {
  return ok ? <Badge variant="success">{okLabel}</Badge> : <Badge variant="danger">Down</Badge>
}

function actionBadgeVariant(action: string): "success" | "warning" | "danger" | "default" | "secondary" {
  switch (action) {
    case "CREATED":
      return "success"
    case "UPDATED":
      return "warning"
    case "ROLLED_BACK":
      return "default"
    case "DELETED":
      return "danger"
    default:
      return "secondary"
  }
}

export default function RootDashboard() {
  const [overview, setOverview] = useState<RootPlatformOverview | null>(null)
  const [accreditation, setAccreditation] = useState<DashboardOverview | null>(null)
  const [auditSummary, setAuditSummary] = useState<Awaited<ReturnType<typeof getAuditSummary>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getOverview()
      setOverview(data)
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setError("No backend session. Log out and sign back in as the ROOT user to reconnect.")
      } else {
        setError(err instanceof Error ? err.message : "Failed to load platform overview")
      }
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAccreditation = useCallback(() => {
    getDashboardOverview()
      .then(setAccreditation)
      .catch(() => setAccreditation((prev) => prev))
  }, [])

  useEffect(() => {
    void load()
    loadAccreditation()
    getAuditSummary().then(setAuditSummary).catch(() => {})
    const poll = setInterval(() => {
      void load()
      loadAccreditation()
      getAuditSummary().then(setAuditSummary).catch(() => {})
    }, 30000)
    return () => clearInterval(poll)
  }, [load, loadAccreditation])

  if (loading && !overview) {
    return (
      <div className="content-padding">
        <PageHeader title="Platform Overview" description="System administrator console" />
        <div className="min-h-[320px] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    )
  }

  if (error && !overview) {
    return (
      <div className="content-padding">
        <PageHeader title="Platform Overview" description="System administrator console" />
        <Card className="border-border/70 shadow-soft">
          <CardContent className="p-8 flex flex-col items-center text-center gap-4">
            <Lock className="w-8 h-8 text-gray-400" />
            <p className="text-[14px] text-gray-600 max-w-md">{error}</p>
            <Button onClick={() => void load()} className="shadow-soft">
              <RefreshCw className="w-4 h-4 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!overview) return null

  const { platform, configuration, storage, database, minio, api, queue } = overview

  return (
    <div className="content-padding">
      <PageHeader
        title="Platform Overview"
        description={`System administrator console · ${platform.environment} · v${platform.version}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} className="shadow-soft">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 responsive-gap mb-6 lg:mb-8">
        <StatCard
          title="Platform Status"
          value={platform.status === "ok" ? "Operational" : platform.status}
          icon={<ServerCog className="w-5 h-5" />}
        />
        <StatCard
          title="Uptime"
          value={formatUptime(platform.uptimeSeconds)}
          icon={<Activity className="w-5 h-5" />}
        />
        <StatCard
          title="Configurations"
          value={configuration.totalConfigs}
          icon={<Settings2 className="w-5 h-5" />}
        />
        <StatCard
          title="Config Versions"
          value={configuration.totalVersions}
          icon={<HardDrive className="w-5 h-5" />}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 responsive-gap mb-6 lg:mb-8">
        {(
          [
            { key: "AACCUP", label: "AACCUP", bg: "bg-amber-50", text: "text-amber-600" },
            { key: "ISO", label: "ISO 21001:2025", bg: "bg-primary-50", text: "text-primary-600" },
          ] as const
        ).map(({ key, label, bg, text }) => {
          const stats = accreditation?.aaccup.byAreaSet[key]
          return (
            <Card key={key} className="border-border/70 shadow-soft">
              <CardContent className="p-5 md:p-6">
                <div className="flex items-center justify-between">
                  <div className={`w-9 h-9 md:w-11 md:h-11 rounded-lg ${bg} flex items-center justify-center ${text}`}>
                    <Award className="w-5 h-5" />
                  </div>
                  {stats && (
                    <span className="text-[11px] md:text-[12px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600">
                      {stats.overallCompliancePercentage}%
                    </span>
                  )}
                </div>
                <div className="mt-3 md:mt-4">
                  <p className="text-[12px] md:text-[13px] text-gray-500 font-medium">{label} Accreditation</p>
                  <p className="text-[18px] md:text-[22px] font-semibold text-gray-900 mt-0.5 tracking-tight">
                    {stats ? `${stats.totalAreas} areas` : "—"}
                  </p>
                  <p className="text-[12px] text-gray-500 mt-0.5">
                    {stats
                      ? `${stats.totalRequirements} requirements · ${stats.totalSubmissions} submissions · ${stats.approved} approved`
                      : "Loading…"}
                  </p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 responsive-gap mb-6 lg:mb-8">
        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] flex items-center gap-2">
              <Database className="w-4 h-4 text-gray-500" />
              Database
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-gray-500">Latency</span>
              <span className="text-[13px] font-medium text-gray-900">{database.latencyMs} ms</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[13px] text-gray-500">Status</span>
              <StatusPill ok={database.status === "up"} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-gray-500" />
              Object Storage (MinIO)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-gray-500">Bucket</span>
              <span className="text-[13px] font-medium text-gray-900">{minio.bucket}</span>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[13px] text-gray-500">Status</span>
              <StatusPill ok={minio.status === "up" && minio.exists} okLabel="Ready" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px] flex items-center gap-2">
              <Network className="w-4 h-4 text-gray-500" />
              API + Email Queue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-gray-500">API</span>
              <StatusPill ok={api.status === "up"} />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[13px] text-gray-500">Emails pending / failed</span>
              <span className="text-[13px] font-medium text-gray-900">
                <Mail className="w-3.5 h-3.5 inline -mt-0.5 mr-1 text-gray-400" />
                {queue.emailPending} / {queue.emailFailed}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {auditSummary && (
        <div className="mb-6 lg:mb-8">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Lock className="w-4 h-4" /> Security &amp; Audit
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <StatCard
              title="Failed Logins Today"
              value={String(auditSummary.failedLoginsToday)}
              icon={<Lock className="w-4 h-4" />}
            />
            <StatCard
              title="Critical Events"
              value={String(auditSummary.criticalEventsToday)}
              icon={<Activity className="w-4 h-4" />}
            />
            <StatCard
              title="Unreviewed Critical"
              value={String(auditSummary.unreviewedCritical)}
              icon={<RefreshCw className="w-4 h-4" />}
            />
            <StatCard
              title="Retention"
              value={`${auditSummary.retentionYears}y`}
              icon={<Settings2 className="w-4 h-4" />}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-3">
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">Recent Role Changes</p>
              <p className="text-base font-semibold text-gray-900">{auditSummary.recentRoleChanges}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">Permission Changes</p>
              <p className="text-base font-semibold text-gray-900">{auditSummary.recentPermissionChanges}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">Last Archive</p>
              <p className="text-base font-semibold text-gray-900">
                {auditSummary.lastArchive
                  ? new Date(auditSummary.lastArchive).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "Never"}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-100">
              <p className="text-[11px] text-gray-500 uppercase tracking-wide">Total Records</p>
              <p className="text-base font-semibold text-gray-900">{auditSummary.totalRecords.toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 responsive-gap mb-6 lg:mb-8">
        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px]">Active Modules</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Module</TableHead>
                  <TableHead className="text-right">Permissions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.activeModules.map((m) => (
                  <TableRow key={m.module}>
                    <TableCell className="text-[13px] font-medium text-gray-900">{m.module}</TableCell>
                    <TableCell className="text-right text-[13px] text-gray-600">
                      {m.permissionCount}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-2">
            <CardTitle className="text-[14px]">Storage</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-[13px] text-gray-600">Total documents</TableCell>
                  <TableCell className="text-right text-[13px] font-medium text-gray-900">
                    {storage.totalDocuments}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-[13px] text-gray-600">Total size</TableCell>
                  <TableCell className="text-right text-[13px] font-medium text-gray-900">
                    {formatBytes(storage.totalBytes)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-[13px] text-gray-600">Archived documents</TableCell>
                  <TableCell className="text-right text-[13px] font-medium text-gray-900">
                    {storage.archivedDocuments}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70 shadow-soft">
        <CardHeader className="pb-2">
          <CardTitle className="text-[14px]">Recent Configuration Changes</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {overview.recentChanges.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-gray-500">No changes recorded yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Configuration</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead className="text-right">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {overview.recentChanges.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="text-[13px] font-medium text-gray-900">{c.configurationKey}</div>
                      <div className="text-[12px] text-gray-500">{c.configurationName}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={actionBadgeVariant(c.action)}>{c.action}</Badge>
                    </TableCell>
                    <TableCell className="text-[13px] text-gray-600 max-w-[220px] truncate">
                      {formatConfigValue(c.newValue)}
                    </TableCell>
                    <TableCell className="text-[13px] text-gray-600">
                      {c.versionFrom ?? "—"} → {c.versionTo ?? "—"}
                    </TableCell>
                    <TableCell className="text-[13px] text-gray-600">{c.actorName ?? "System"}</TableCell>
                    <TableCell className="text-right text-[12px] text-gray-500">
                      {new Date(c.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-[11px] text-gray-400">
        Last updated {new Date(platform.timestamp).toLocaleString()} · cache {configuration.cache.size} entries
        (TTL {configuration.cache.ttlMs} ms)
      </p>
    </div>
  )
}
