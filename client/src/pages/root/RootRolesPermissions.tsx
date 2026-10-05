import { useState, useCallback, useEffect, useMemo } from "react"
import { Search, Save, Undo2, Shield, ShieldAlert, ShieldCheck } from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Badge } from "@/components/ui/Badge"
import { Input } from "@/components/ui/Input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import { Skeleton } from "@/components/ui/Skeleton"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import {
  getRolesPermissionMatrix,
  updateRolePermissions,
  type ServerPermissionCatalogEntry,
  type ServerRolesPermissionMatrix,
} from "@/services/admin"

type ModifiedSet = Map<string, Set<string>>

export default function RootRolesPermissions() {
  const [matrix, setMatrix] = useState<ServerRolesPermissionMatrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null)
  const [modified, setModified] = useState<ModifiedSet>(new Map())
  const [search, setSearch] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingSave, setPendingSave] = useState<string | null>(null)
  const [filterModule, setFilterModule] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getRolesPermissionMatrix()
      setMatrix(data)
      setModified(new Map())
      setSelectedRoleId((current) => {
        if (current && data.roles.some((r) => r.id === current)) return current
        return data.roles.find((r) => !r.deletedAt)?.id ?? current
      })
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Unable to load roles & permissions")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const selectedRole = useMemo(
    () => matrix?.roles.find((r) => r.id === selectedRoleId) ?? null,
    [matrix, selectedRoleId],
  )

  const boundSet = useMemo(() => {
    if (!selectedRole) return new Set<string>()
    const mods = modified.get(selectedRole.id)
    if (mods) return new Set(mods)
    return new Set(selectedRole.boundPermissions)
  }, [selectedRole, modified])

  const isDirty = useMemo(() => {
    if (!selectedRole) return false
    const mods = modified.get(selectedRole.id)
    if (!mods) return false
    const orig = new Set(selectedRole.boundPermissions)
    if (mods.size !== orig.size) return true
    for (const code of mods) {
      if (!orig.has(code)) return true
    }
    return false
  }, [selectedRole, modified])

  const togglePermission = (code: string) => {
    if (!selectedRole || selectedRole.name === "ROOT") return
    const mods = new Set(modified.get(selectedRole.id) ?? selectedRole.boundPermissions)
    if (mods.has(code)) {
      mods.delete(code)
    } else {
      mods.add(code)
    }
    const next = new Map(modified)
    next.set(selectedRole.id, mods)
    setModified(next)
  }

  const isProtected = (code: string) =>
    selectedRole?.name === "ROOT" || (selectedRole?.name === "ADMINISTRATOR" && matrix?.rootOnlyCodes.includes(code))

  const modules = useMemo(() => {
    if (!matrix) return []
    const seen = new Set<string>()
    const result: string[] = []
    for (const cat of matrix.catalog) {
      if (!seen.has(cat.module)) {
        seen.add(cat.module)
        result.push(cat.module)
      }
    }
    return result.sort()
  }, [matrix])

  const filteredCatalog = useMemo(() => {
    if (!matrix) return []
    let items = matrix.catalog
    if (search) {
      const q = search.toLowerCase()
      items = items.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.module.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q),
      )
    }
    if (filterModule) {
      items = items.filter((c) => c.module === filterModule)
    }
    return items
  }, [matrix, search, filterModule])

  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, ServerPermissionCatalogEntry[]>()
    for (const cat of filteredCatalog) {
      const list = groups.get(cat.module) ?? []
      list.push(cat)
      groups.set(cat.module, list)
    }
    return groups
  }, [filteredCatalog])

  const handleSave = async (roleId: string) => {
    if (matrix?.rootOnlyCodes && pendingSave) {
      const role = matrix.roles.find((r) => r.id === pendingSave)
      if (role?.name === "ROOT") return
    }
    setSaving(roleId)
    try {
      const mods = modified.get(roleId)
      if (!mods) return
      const perms = Array.from(mods)
      const result = await updateRolePermissions(roleId, perms)
      setModified((prev) => {
        const next = new Map(prev)
        next.delete(roleId)
        return next
      })
      const role = matrix?.roles.find((r) => r.id === roleId)
      toast.success(
        `Saved ${role?.name ?? "role"} (${result.added.length} added, ${result.removed.length} removed)`,
      )
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to save permissions")
    } finally {
      setSaving(null)
      setConfirmOpen(false)
      setPendingSave(null)
    }
  }

  const handleCancel = (roleId: string) => {
    setModified((prev) => {
      const next = new Map(prev)
      next.delete(roleId)
      return next
    })
  }

  if (loading) {
    return (
      <div className="content-padding">
        <PageHeader title="Roles & Permissions" description="Configure system access and capabilities." />
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mt-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64 lg:col-span-3" />
        </div>
      </div>
    )
  }

  return (
    <div className="content-padding">
      <PageHeader
        title="Roles &amp; Permissions"
        description="Configure system access and capabilities — ROOT only."
      />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mt-6">
        {/* Role list panel */}
        <Card className="lg:col-span-1">
          <CardHeader className="px-4 py-3">
            <CardTitle className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">
              Roles
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2 py-0">
            <div className="space-y-0.5 max-h-[calc(100vh-280px)] overflow-y-auto">
              {matrix?.roles.map((role) => (
                <button
                  key={role.id}
                  onClick={() => setSelectedRoleId(role.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-md transition-colors flex items-center gap-2.5",
                    selectedRoleId === role.id
                      ? "bg-primary-50 text-blue-700 font-medium"
                      : "hover:bg-gray-50 text-gray-700",
                    role.deletedAt && "opacity-50",
                  )}
                >
                  <span
                    className={cn(
                      "w-2 h-2 rounded-full flex-shrink-0",
                      role.name === "ROOT"
                        ? "bg-red-500"
                        : role.name === "ADMINISTRATOR"
                          ? "bg-amber-500"
                          : role.deletedAt
                            ? "bg-gray-300"
                            : "bg-emerald-500",
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] leading-tight truncate">
                      {role.name === "ROOT"
                        ? "System Root"
                        : role.name === "ADMINISTRATOR"
                          ? "Administrator"
                          : role.name
                              .replace(/_/g, " ")
                              .replace(/\b\w/g, (c) => c.toUpperCase())}
                    </div>
                    <div className="text-[11px] text-gray-400 truncate">
                      {role.permissionCount} permissions · {role.userCount} users
                    </div>
                  </div>
                  {modified.has(role.id) && (
                    <Badge variant="warning" className="text-[10px] px-1.5 py-0">
                      Modified
                    </Badge>
                  )}
                </button>
              ))}
              {matrix?.roles.length === 0 && (
                <div className="text-center text-gray-400 text-[13px] py-6">No roles found</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Permission matrix panel */}
        <Card className="lg:col-span-3">
          <CardHeader className="px-4 py-3">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <CardTitle className="text-[13px] font-semibold uppercase tracking-wider text-gray-500">
                  Permissions — {selectedRole?.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) ?? "Select a role"}
                </CardTitle>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search permissions..."
                    className="pl-7 h-8 text-[12px] w-48"
                  />
                </div>
                {isDirty && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => selectedRole && handleCancel(selectedRole.id)}
                      className="h-8 text-[12px]"
                    >
                      <Undo2 className="h-3.5 w-3.5 mr-1" />
                      Reset
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setPendingSave(selectedRole?.id ?? null)
                        setConfirmOpen(true)
                      }}
                      disabled={saving === selectedRole?.id}
                      className="h-8 text-[12px]"
                    >
                      <Save className="h-3.5 w-3.5 mr-1" />
                      {saving === selectedRole?.id ? "Saving..." : "Save Changes"}
                    </Button>
                  </>
                )}
              </div>
            </div>
            {/* Module filter pills */}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <button
                onClick={() => setFilterModule(null)}
                className={cn(
                  "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                  !filterModule ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200",
                )}
              >
                All
              </button>
              {modules.map((mod) => (
                <button
                  key={mod}
                  onClick={() => setFilterModule(mod === filterModule ? null : mod)}
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] font-medium transition-colors capitalize",
                    filterModule === mod
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200",
                  )}
                >
                  {mod}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="px-4 py-2 max-h-[calc(100vh-380px)] overflow-y-auto">
            {selectedRole?.deletedAt ? (
              <div className="text-center text-gray-400 text-[13px] py-12">
                <ShieldAlert className="h-8 w-8 mx-auto mb-2 opacity-40" />
                This role is archived. Restore it to manage permissions.
              </div>
            ) : filteredCatalog.length === 0 ? (
              <div className="text-center text-gray-400 text-[13px] py-12">
                No permissions match the current filter.
              </div>
            ) : (
              <div className="space-y-4">
                {Array.from(groupedCatalog.entries()).map(([module, entries]) => (
                  <div key={module}>
                    <h3 className="text-[11px] font-semibold uppercase text-gray-400 tracking-wider mb-1.5 capitalize">
                      {module}
                    </h3>
                    <div className="space-y-0.5">
                      {entries.map((entry) => {
                        const checked = boundSet.has(entry.code)
                        const locked = isProtected(entry.code)
                        return (
                          <label
                            key={entry.code}
                            className={cn(
                              "flex items-center gap-2.5 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer transition-colors",
                              locked && "cursor-not-allowed opacity-70",
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={locked}
                              onChange={() => togglePermission(entry.code)}
                              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary"
                            />
                            <div className="flex-1 min-w-0">
                              <code className="text-[12px] text-gray-800 font-medium">
                                {entry.code}
                              </code>
                              <div className="text-[11px] text-gray-400 truncate">
                                {entry.description}
                              </div>
                            </div>
                            {locked && (
                              <Shield className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                            )}
                            {matrix?.rootOnlyCodes.includes(entry.code) && (
                              <Badge variant="default" className="text-[9px] px-1 py-0 bg-red-50 text-red-600 border-red-200 flex-shrink-0">
                                ROOT ONLY
                              </Badge>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) setConfirmOpen(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary-600" />
              Confirm Permission Changes
            </DialogTitle>
            <DialogDescription className="text-[13px]">
              You are about to change permissions for{" "}
              <strong>{selectedRole?.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <PermissionsDiff roleId={selectedRole?.id ?? ""} modified={modified} matrix={matrix} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (pendingSave) void handleSave(pendingSave)
              }}
              disabled={saving === selectedRole?.id}
            >
              {saving === selectedRole?.id ? "Saving..." : "Confirm Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PermissionsDiff({
  roleId,
  modified,
  matrix,
}: {
  roleId: string
  modified: ModifiedSet
  matrix: ServerRolesPermissionMatrix | null
}) {
  const role = matrix?.roles.find((r) => r.id === roleId)
  if (!role) return null

  const original = role.boundPermissions
  const updated = modified.get(roleId)
  if (!updated) return null

  const modArray = Array.from(updated)
  const added = modArray.filter((c) => !original.includes(c))
  const removed = original.filter((c) => !modArray.includes(c))

  return (
    <div className="text-[12px]">
      {added.length > 0 && (
        <div className="mb-2">
          <div className="font-medium text-emerald-700 mb-1">Permissions added ({added.length}):</div>
          <div className="flex flex-wrap gap-1">
            {added.map((c) => (
              <code key={c} className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded text-[11px]">
                + {c}
              </code>
            ))}
          </div>
        </div>
      )}
      {removed.length > 0 && (
        <div>
          <div className="font-medium text-red-700 mb-1">Permissions removed ({removed.length}):</div>
          <div className="flex flex-wrap gap-1">
            {removed.map((c) => (
              <code key={c} className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded text-[11px]">
                - {c}
              </code>
            ))}
          </div>
        </div>
      )}
      {added.length === 0 && removed.length === 0 && (
        <div className="text-gray-400">No changes detected.</div>
      )}
    </div>
  )
}
