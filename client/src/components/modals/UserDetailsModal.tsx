import { useState, useEffect } from "react"
import {
  User as UserIcon,
  Mail,
  Building2,
  Shield,
  KeyRound,
  Trash2,
  AlertTriangle,
  Loader2,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Label } from "@/components/ui/Label"
import { Switch } from "@/components/ui/Switch"
import { Badge } from "@/components/ui/Badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select"
import { cn } from "@/lib/utils"
import type { User } from "@/types/domain"
import { listSystemDepartments, listSystemRoles, type SystemDepartment, type SystemRole } from "@/services/admin"
import { toast } from "@/lib/toast"

interface UserDetailsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: User | null
  onResetPassword?: () => void
  onDelete?: () => void
  onSave?: (userId: string, data: { status: "Active" | "Inactive" | "Suspended"; departmentId?: string | null; roleId?: string }) => void | Promise<void>
}

const roleBadgeVariant: Record<string, "default" | "secondary" | "success" | "warning" | "danger"> = {
  "System Administrator": "default",
  "Document Manager": "success",
  "Reviewer": "warning",
  "Editor": "secondary",
  "Viewer": "secondary",
  "Department User": "secondary",
}

export function UserDetailsModal({
  open,
  onOpenChange,
  user,
  onResetPassword,
  onDelete,
  onSave,
}: UserDetailsModalProps) {
  const [isActive, setIsActive] = useState(user?.status === "Active")
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [departments, setDepartments] = useState<SystemDepartment[]>([])
  const [roles, setRoles] = useState<SystemRole[]>([])
  const [selectedDepartment, setSelectedDepartment] = useState(user?.departmentId ?? "")
  const [selectedRole, setSelectedRole] = useState("")
  const [loadingOptions, setLoadingOptions] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !user) return
    setIsActive(user.status === "Active")
    setSelectedDepartment(user.departmentId ?? "unassigned")
    setSelectedRole("")
    setLoadingOptions(true)
    Promise.all([
      listSystemDepartments({ page: 1, pageSize: 200 }),
      listSystemRoles({ page: 1, pageSize: 50 }),
    ])
      .then(([deptPage, rolePage]) => {
        setDepartments(deptPage.items.filter((d) => !d.deletedAt))
        setRoles(rolePage.items.filter((r) => !r.deletedAt))
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : "Failed to load department and role options"))
      .finally(() => setLoadingOptions(false))
  }, [open, user])

  const handleSave = async () => {
    if (!user || !onSave || saving) return
    setSaving(true)
    try {
      await onSave(user.id, {
        status: isActive === (user.status === "Active") ? user.status : isActive ? "Active" : "Inactive",
        ...(selectedDepartment !== (user.departmentId ?? "unassigned")
          ? { departmentId: selectedDepartment === "unassigned" ? null : selectedDepartment } : {}),
        ...(selectedRole ? { roleId: selectedRole } : {}),
      })
      toast.success("User changes saved.")
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save user changes")
    } finally {
      setSaving(false)
    }
  }

  if (!user) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving) onOpenChange(nextOpen) }}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader className="pb-3">
          <DialogTitle className="text-lg">User Details</DialogTitle>
          <DialogDescription className="text-[14px]">
            View and manage user account information
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="flex items-center gap-4 p-4 rounded-xl bg-gray-50/50 border border-gray-100">
            <Avatar className="h-14 w-14">
              <AvatarImage src={user.photoUrl ?? (user.avatarSeed ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.avatarSeed}` : undefined)} />
              <AvatarFallback className="text-lg bg-primary-50 text-primary-700">
                {(user.name || "?").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h3 className="text-[16px] font-semibold text-gray-900">{user.name}</h3>
              <p className="text-[13px] text-gray-500">{user.email}</p>
              <div className="flex items-center gap-2 mt-1.5">
                <Badge variant={roleBadgeVariant[user.role] || "secondary"}>
                  {user.role}
                </Badge>
                <Badge variant={user.status === "Active" ? "success" : "danger"}>
                  {user.status}
                </Badge>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-3">
              Account Information
            </p>
            <div className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-[12px] text-gray-500 flex items-center gap-1.5">
                    <UserIcon className="w-3 h-3" />
                    Full Name
                  </Label>
                  <Input
                    defaultValue={user.name}
                    className="h-9 text-[14px]"
                  />
                </div>
                <div className="grid gap-2">
                  <Label className="text-[12px] text-gray-500 flex items-center gap-1.5">
                    <Mail className="w-3 h-3" />
                    Email Address
                  </Label>
                  <Input
                    type="email"
                    defaultValue={user.email}
                    className="h-9 text-[14px]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-[12px] text-gray-500 flex items-center gap-1.5">
                    <Building2 className="w-3 h-3" />
                    Department
                  </Label>
                  <Select value={selectedDepartment} onValueChange={setSelectedDepartment} disabled={loadingOptions}>
                    <SelectTrigger className="h-9 text-[14px]">
                      {loadingOptions ? <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" /> : <SelectValue placeholder="Select department..." />}
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-[12px] text-gray-500 flex items-center gap-1.5">
                    <Shield className="w-3 h-3" />
                    Role
                  </Label>
                  <Select value={selectedRole} onValueChange={setSelectedRole} disabled={loadingOptions}>
                    <SelectTrigger className="h-9 text-[14px]">
                      {loadingOptions ? <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" /> : <SelectValue placeholder="Select role..." />}
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg border border-gray-100 bg-white">
                <div className="flex flex-col gap-0.5">
                  <Label htmlFor="editUserActive" className="text-[14px] font-medium text-gray-700 cursor-pointer">
                    Active Status
                  </Label>
                  <p className="text-[12px] text-gray-500">
                    {isActive ? "User can access the system" : "User is blocked from accessing"}
                  </p>
                </div>
                <Switch
                  id="editUserActive"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-3">
              Security
            </p>
            <div className="space-y-2">
              <button
                onClick={onResetPassword}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-100 bg-white hover:bg-gray-50 transition-colors"
              >
                <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center">
                  <KeyRound className="w-4 h-4 text-amber-600" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[14px] font-medium text-gray-700">Reset Password</p>
                  <p className="text-[12px] text-gray-500">Send password reset link to user</p>
                </div>
              </button>
            </div>
          </div>

          <div className={cn(
            "p-4 rounded-xl border transition-all duration-200",
            isDeleteConfirmOpen ? "border-red-200 bg-red-50/50" : "border-gray-100 bg-gray-50/50"
          )}>
            {isDeleteConfirmOpen ? (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                  </div>
                  <div>
                    <p className="text-[14px] font-medium text-red-700">Confirm Deletion</p>
                    <p className="text-[12px] text-red-600/80 mt-0.5">
                      Are you sure you want to delete this user? This action cannot be undone.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsDeleteConfirmOpen(false)}
                    className="h-8"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      onDelete?.()
                      setIsDeleteConfirmOpen(false)
                      onOpenChange(false)
                    }}
                    className="h-8"
                  >
                    Delete User
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setIsDeleteConfirmOpen(true)}
                className="w-full flex items-center gap-3"
              >
                <div className="w-9 h-9 rounded-xl bg-red-50 flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-red-600" />
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[14px] font-medium text-red-600">Delete User</p>
                  <p className="text-[12px] text-red-500/80">Permanently remove this user account</p>
                </div>
              </button>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="h-10 px-5"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving || loadingOptions}
            className="h-10 px-5 shadow-soft"
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
