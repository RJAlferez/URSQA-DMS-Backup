import { useCallback, useEffect, useState } from "react"
import { Users, Building2, UserPlus, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/Dialog"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Label } from "@/components/ui/Label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select"
import { useAuth } from "@/context/AuthContext"
import { listFolderShares, listShareableUsers, removeFolderShare, shareRepositoryFolder, updateFolderShare, type FolderSharePermission, type FolderShareRow, type ShareableUser } from "@/services/documents"
import { toast } from "@/lib/toast"

interface ShareFolderModalProps {
  open: boolean
  folderId: string | null
  folderName: string
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

function displayName(user: { firstName: string; lastName: string }) { return `${user.firstName} ${user.lastName}`.trim() }

export function ShareFolderModal({ open, folderId, folderName, onOpenChange, onSuccess }: ShareFolderModalProps) {
  const { user } = useAuth()
  const [mode, setMode] = useState<"USER" | "DEPARTMENT">("USER")
  const [permission, setPermission] = useState<FolderSharePermission>("VIEWER")
  const [query, setQuery] = useState("")
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
  const [users, setUsers] = useState<ShareableUser[]>([])
  const [shares, setShares] = useState<FolderShareRow[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!folderId) return
    try {
      const [available, current] = await Promise.all([listShareableUsers(), listFolderShares(folderId)])
      setUsers(available)
      setShares(current)
    } catch { toast.error("Unable to load sharing details") }
  }, [folderId])

  useEffect(() => {
    if (!open) return
    setMode("USER")
    setPermission("VIEWER")
    setQuery("")
    setSelectedUsers(new Set())
    void load()
  }, [open, folderId, load])

  const filteredUsers = users.filter((candidate) => displayName(candidate).toLowerCase().includes(query.toLowerCase()))
  const submit = async () => {
    if (!folderId || saving) return
    setSaving(true)
    try {
      await shareRepositoryFolder(folderId, mode === "USER"
        ? { recipientType: "USER", userIds: [...selectedUsers], permission }
        : { recipientType: "DEPARTMENT", departmentId: user?.departmentId, permission })
      toast.success("Folder access updated")
      await load()
      setSelectedUsers(new Set())
      onSuccess?.()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to share folder") }
    finally { setSaving(false) }
  }

  const changeShare = async (share: FolderShareRow, next: FolderSharePermission) => {
    if (!folderId) return
    try { await updateFolderShare(folderId, share.id, next); await load() }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update access") }
  }

  const removeShare = async (share: FolderShareRow) => {
    if (!folderId) return
    try { await removeFolderShare(folderId, share.id); await load(); toast.success("Access removed") }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to remove access") }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" />Share Folder</DialogTitle>
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{folderName}</p>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-1.5 dark:bg-gray-800">
            <Button type="button" variant={mode === "USER" ? "default" : "ghost"} className="h-9" onClick={() => setMode("USER")}><UserPlus className="mr-2 h-4 w-4" />Specific Users</Button>
            <Button type="button" variant={mode === "DEPARTMENT" ? "default" : "ghost"} className="h-9" onClick={() => setMode("DEPARTMENT")}><Building2 className="mr-2 h-4 w-4" />Entire Department</Button>
          </div>
          {mode === "USER" ? (
            <div className="grid gap-2">
              <Label htmlFor="share-user-search">Search users</Label>
              <Input id="share-user-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search users..." />
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
                {filteredUsers.length === 0 && <p className="px-2 py-4 text-center text-sm text-gray-500">No eligible users found.</p>}
                {filteredUsers.map((candidate) => (
                  <label key={candidate.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-gray-50 dark:hover:bg-gray-800">
                    <input type="checkbox" checked={selectedUsers.has(candidate.id)} onChange={() => setSelectedUsers((current) => { const next = new Set(current); if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id); return next })} className="h-4 w-4 accent-primary" />
                    <span className="text-sm text-gray-800 dark:text-gray-200">{displayName(candidate)}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-3 text-sm text-gray-700 dark:border-primary-900 dark:bg-primary-900/20 dark:text-gray-200">
              This shares the folder with current members of <strong>{user?.department || "your department"}</strong>. Membership is checked by the server.
            </div>
          )}
          <div className="grid gap-2">
            <Label>Permission</Label>
            <Select value={permission} onValueChange={(value) => setPermission(value as FolderSharePermission)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="VIEWER">Viewer</SelectItem><SelectItem value="EDITOR">Editor</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>People with access</Label>
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-border p-2">
              {shares.length === 0 && <p className="px-2 py-3 text-sm text-gray-500">No one else has access yet.</p>}
              {shares.map((share) => (
                <div key={share.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{share.recipientType === "DEPARTMENT" ? `${share.department?.name || "Department"} Department` : share.user ? displayName(share.user) : "User"}</p><p className="text-xs text-gray-500">{share.recipientType === "DEPARTMENT" ? "Current department members" : "Direct access"}</p></div>
                  <Select value={share.permission === "WRITE" ? "EDITOR" : "VIEWER"} onValueChange={(value) => void changeShare(share, value as FolderSharePermission)}><SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="VIEWER">Viewer</SelectItem><SelectItem value="EDITOR">Editor</SelectItem></SelectContent></Select>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-gray-400 hover:text-red-600" aria-label="Remove access" onClick={() => void removeShare(share)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button><Button type="button" onClick={() => void submit()} disabled={saving || (mode === "USER" && selectedUsers.size === 0)}>{saving ? "Sharing..." : mode === "DEPARTMENT" ? "Share with Department" : "Share"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
