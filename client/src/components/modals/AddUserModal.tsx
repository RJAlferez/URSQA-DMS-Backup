import { useState, useEffect } from "react"
import { UserPlus } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select"
import { createSystemUser, listSystemRoles, listSystemDepartments, listSystemColleges, type SystemRole, type SystemDepartment } from "@/services/admin"

const CATEGORIZED_COLLEGES = [
  "College of Science",
  "College of Engineering",
  "College of Industrial Technology",
  "College of Education",
]

interface AddUserModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: (userData: { name: string; email: string; role: string; department: string }) => void
}

export function AddUserModal({ open, onOpenChange, onSuccess }: AddUserModalProps) {
  const [isActive, setIsActive] = useState(true)
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [department, setDepartment] = useState("")
  const [role, setRole] = useState("")
  const [roles, setRoles] = useState<SystemRole[]>([])
  const [departments, setDepartments] = useState<SystemDepartment[]>([])
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    listSystemRoles({ pageSize: 100 })
      .then((page) => {
        setRoles(page.items)
        if (page.items.length > 0) {
          setRole((current) => current || page.items[0]!.id)
        }
      })
      .catch(() => setRoles([]))
    Promise.all([
      listSystemDepartments({ pageSize: 100 }).then((page) => page.items),
      listSystemColleges({ pageSize: 100 }).then((page) => page.items),
    ])
      .then(([depts, colleges]) => {
        const categorized = new Set(
          colleges
            .filter((c) => CATEGORIZED_COLLEGES.includes(c.name))
            .map((c) => c.id),
        )
        setDepartments(depts.filter((d) => d.collegeId && categorized.has(d.collegeId)))
      })
      .catch(() => setDepartments([]))
  }, [open])

  const handleSubmit = async () => {
    setError("")
    if (!fullName.trim()) { setError("Full name is required"); return }
    if (!email.trim()) { setError("Email is required"); return }
    if (!password) { setError("Password is required"); return }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return }
    if (password !== confirmPassword) { setError("Passwords do not match"); return }
    if (!department) { setError("Department is required"); return }
    if (!role) { setError("Role is required"); return }
    setSaving(true)
    try {
      const nameParts = fullName.trim().split(/\s+/)
      const firstName = nameParts[0] ?? fullName.trim()
      const lastName = nameParts.slice(1).join(" ") || firstName
      // Employee IDs allow only letters/digits/'-'/'_' (server regex). The
      // email local part often contains dots, so sanitize before sending.
      const derivedEmployeeId = email.split("@")[0].replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 64)
      await createSystemUser({
        employeeId: derivedEmployeeId.length >= 2 ? derivedEmployeeId : "USER",
        email,
        password,
        firstName,
        lastName,
        roleId: role,
        departmentId: department,
        mustChangePassword: false,
      })
      const roleName = roles.find((r) => r.id === role)?.name ?? role
      const deptName = departments.find((d) => d.id === department)?.name ?? department
      onSuccess?.({ name: fullName, email, role: roleName, department: deptName })
      onOpenChange(false)
      setFullName(""); setEmail(""); setPassword(""); setConfirmPassword(""); setDepartment(""); setRole(roles[0]?.id ?? ""); setIsActive(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create user")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-lg flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-primary" />
            Add New User
          </DialogTitle>
          <DialogDescription className="text-[14px]">
            Create a new user account. All fields marked with * are required.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-4">
          {error && (
            <div className="text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="fullName" className="text-[13px] font-medium text-gray-700">
              Full Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="fullName"
              autoFocus
              placeholder="Enter full name"
              className="h-10"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="email" className="text-[13px] font-medium text-gray-700">
              Email Address <span className="text-red-500">*</span>
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="Enter email address"
              className="h-10"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="password" className="text-[13px] font-medium text-gray-700">
                Password <span className="text-red-500">*</span>
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter password"
                className="h-10"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword" className="text-[13px] font-medium text-gray-700">
                Confirm Password <span className="text-red-500">*</span>
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="Confirm password"
                className="h-10"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label className="text-[13px] font-medium text-gray-700">
                College / Department <span className="text-red-500">*</span>
              </Label>
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select college" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label className="text-[13px] font-medium text-gray-700">
                Role <span className="text-red-500">*</span>
              </Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center justify-between p-3 rounded-xl border border-gray-100 bg-gray-50/50">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="userActive" className="text-[14px] font-medium text-gray-700 cursor-pointer">
                Active Status
              </Label>
              <p className="text-[12px] text-gray-500">
                Enable to allow this user to access the system
              </p>
            </div>
            <Switch
              id="userActive"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 px-5"
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} className="h-10 px-5 shadow-soft" disabled={saving}>
            {saving ? "Creating..." : "Create User"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
