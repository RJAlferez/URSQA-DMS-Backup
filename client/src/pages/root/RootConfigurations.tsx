import { useEffect, useState, useCallback } from "react"
import {
  Search,
  RefreshCw,
  Edit3,
  History,
  Trash2,
  RotateCcw,
  Lock,
  Save,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Badge } from "@/components/ui/Badge"
import { Label } from "@/components/ui/Label"
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
  listConfigurations,
  listCategories,
  updateConfigurations,
  deleteConfiguration,
  listVersions,
  rollbackConfiguration,
  formatConfigValue,
  parseConfigValue,
  type RootConfig,
  type RootConfigCategory,
  type RootConfigVersion,
  type ConfigValueType,
} from "@/services/root"
import { ApiRequestError } from "@/lib/http"

const PAGE_SIZE = 10

export default function RootConfigurations() {
  const [configs, setConfigs] = useState<RootConfig[]>([])
  const [categories, setCategories] = useState<RootConfigCategory[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [category, setCategory] = useState<string>("all")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editing, setEditing] = useState<RootConfig | null>(null)
  const [editValue, setEditValue] = useState("")
  const [editNote, setEditNote] = useState("")
  const [saving, setSaving] = useState(false)

  const [versionTarget, setVersionTarget] = useState<RootConfig | null>(null)
  const [versions, setVersions] = useState<RootConfigVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<RootConfigVersion | null>(null)
  const [rollbackNote, setRollbackNote] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cfg, cats] = await Promise.all([
        listConfigurations({
          page,
          pageSize: PAGE_SIZE,
          category: category === "all" ? undefined : category,
          q: search.trim() || undefined,
        }),
        listCategories(),
      ])
      setConfigs(cfg.items)
      setTotal(cfg.meta.total)
      setTotalPages(Math.max(1, cfg.meta.totalPages))
      setCategories(cats)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load configurations")
    } finally {
      setLoading(false)
    }
  }, [page, category, search])

  useEffect(() => {
    void load()
  }, [load])

  const handleRefresh = () => void load()

  const openEdit = (config: RootConfig) => {
    setEditing(config)
    setEditValue(formatConfigValue(config.value))
    setEditNote("")
  }

  const handleSaveEdit = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const updated = await updateConfigurations([
        {
          key: editing.key,
          value: parseConfigValue(editValue, editing.valueType),
          changeNote: editNote || undefined,
        },
      ])
      toast.success(`"${updated[0].key}" updated to v${updated[0].version}`)
      setEditing(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (config: RootConfig) => {
    try {
      await deleteConfiguration(config.key)
      toast.success(`"${config.key}" deleted`)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    }
  }

  const openVersions = async (config: RootConfig) => {
    setVersionTarget(config)
    setVersions([])
    setRollbackTarget(null)
    setRollbackNote("")
    setVersionsLoading(true)
    try {
      setVersions(await listVersions(config.key))
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
      const updated = await rollbackConfiguration(
        versionTarget.key,
        rollbackTarget.version,
        rollbackNote || `Rolled back to version ${rollbackTarget.version}`,
      )
      toast.success(`"${updated.key}" rolled back to v${rollbackTarget.version} (now v${updated.version})`)
      setVersionTarget(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rollback failed")
    } finally {
      setSaving(false)
    }
  }

  const isUnauthorized = (err: unknown) =>
    err instanceof ApiRequestError && err.status === 401

  const valueInputFor = (config: RootConfig) => {
    switch (config.valueType) {
      case "BOOLEAN":
        return (
          <Select value={editValue} onValueChange={setEditValue}>
            <SelectTrigger className="h-10">
              <SelectValue placeholder="Select value" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">true</SelectItem>
              <SelectItem value="false">false</SelectItem>
            </SelectContent>
          </Select>
        )
      case "NUMBER":
        return (
          <Input
            type="number"
            className="h-10"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
          />
        )
      default:
        return (
          <Input
            className="h-10"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            placeholder={
              config.valueType === "LIST"
                ? "Comma-separated values, e.g. pdf, docx, png"
                : config.valueType === "JSON"
                  ? 'Raw JSON, e.g. {"key": "value"}'
                  : "Value"
            }
          />
        )
    }
  }

  const typeLabel = (t: ConfigValueType) => t.toLowerCase()

  return (
    <div className="content-padding">
      <PageHeader
        title="Configuration Engine"
        description="Versioned platform settings managed by the system administrator"
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} className="shadow-soft">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        }
      />

      <Card className="border-border/70 shadow-soft mb-4">
        <CardContent className="toolbar-padding flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              className="h-10 pl-9"
              placeholder="Search by key, name or description…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="h-10 w-full sm:w-[200px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            ) : configs.length === 0 ? (
              <div className="p-8 text-center text-[13px] text-gray-500">No configurations found.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Key</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configs.map((config) => (
                    <TableRow key={config.id}>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {config.isSystem && (
                            <Lock className="w-3.5 h-3.5 text-gray-400" aria-label="Seed-owned" />
                          )}
                          <div>
                            <div className="text-[13px] font-medium text-gray-900">{config.key}</div>
                            <div className="text-[12px] text-gray-500">{config.name}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-[13px] text-gray-600">{config.category.name}</TableCell>
                      <TableCell className="text-[13px] text-gray-600 max-w-[200px] truncate">
                        {formatConfigValue(config.value)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{typeLabel(config.valueType)}</Badge>
                      </TableCell>
                      <TableCell className="text-[13px] text-gray-600">v{config.version}</TableCell>
                      <TableCell>
                        <Badge variant={config.status === "ACTIVE" ? "success" : "default"}>
                          {config.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[12px] text-gray-500">
                        <div>{new Date(config.updatedAt).toLocaleDateString()}</div>
                        {config.updatedByName && (
                          <div className="text-gray-400">by {config.updatedByName}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title="Edit value"
                            onClick={() => openEdit(config)}
                          >
                            <Edit3 className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title="Version history"
                            onClick={() => void openVersions(config)}
                          >
                            <History className="w-4 h-4" />
                          </Button>
                          {config.isSystem ? (
                            <span title="Seed-owned configuration cannot be deleted">
                              <Trash2 className="w-4 h-4 text-gray-300 mx-2" />
                            </span>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
                              title="Delete (soft)"
                              onClick={() => void handleDelete(config)}
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
            <span className="text-[12px] text-gray-500">{total} configurations</span>
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

      {editing && (
        <Dialog open onOpenChange={(open) => !open && setEditing(null)}>
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[520px]">
            <DialogHeader className="pb-2">
              <DialogTitle className="text-lg">Edit Configuration</DialogTitle>
              <DialogDescription className="text-[14px]">
                {editing.key} · v{editing.version} · {editing.category.name}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-5 py-4">
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">
                  Value <span className="text-gray-400">({typeLabel(editing.valueType)})</span>
                </Label>
                {valueInputFor(editing)}
              </div>
              <div className="grid gap-2">
                <Label className="text-[13px] font-medium">Change note (optional)</Label>
                <Input
                  className="h-10"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="Why is this changing?"
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" className="h-9" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button className="h-9 shadow-soft" onClick={() => void handleSaveEdit()} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Saving…" : "Save (new version)"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {versionTarget && (
        <Dialog open onOpenChange={(open) => !open && setVersionTarget(null)}>
          <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-[640px]">
            <DialogHeader className="pb-2">
              <DialogTitle className="text-lg">Version History — {versionTarget.key}</DialogTitle>
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
                <div className="py-8 text-center text-[13px] text-gray-500">No versions recorded.</div>
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
                        </div>
                        <div className="text-[13px] text-gray-600 mt-0.5 break-all">
                          {formatConfigValue(v.value)}
                        </div>
                        {v.changeNote && (
                          <div className="text-[12px] text-gray-500 mt-0.5">{v.changeNote}</div>
                        )}
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          {new Date(v.createdAt).toLocaleString()} · {v.changedByName ?? "System"}
                        </div>
                      </div>
                      {v.version < versionTarget.version && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 flex-shrink-0"
                          onClick={() => {
                            setRollbackTarget(v)
                            setRollbackNote("")
                          }}
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
                <div className="grid gap-3">
                  <div className="text-[13px] text-gray-700">
                    Roll back <span className="font-medium">{versionTarget.key}</span> to{" "}
                    <span className="font-medium">v{rollbackTarget.version}</span>? A new version will be
                    created with the restored value.
                  </div>
                  <Input
                    className="h-10"
                    value={rollbackNote}
                    onChange={(e) => setRollbackNote(e.target.value)}
                    placeholder="Change note (optional)"
                  />
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
