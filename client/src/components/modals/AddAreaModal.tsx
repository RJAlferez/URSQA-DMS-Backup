import { useState, useEffect } from "react"
import { Award, Pencil } from "lucide-react"
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
import { Textarea } from "@/components/ui/Textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select"
import { createOnlineArea, updateOnlineArea } from "@/services/aaccup"
import { listSystemDepartments, type SystemDepartment } from "@/services/admin"
import { cn } from "@/lib/utils"

interface AddAreaModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  areaSet?: "aaccup" | "iso"
  area?: {
    id: string
    name: string
    description: string
    departmentId: string
    isActive: boolean
  } | null
  onSuccess?: (area: { id: string; title: string }) => void
}

const setLabel = {
  aaccup: "AACCUP",
  iso: "ISO",
} as const

const setBadgeIcon = {
  aaccup: "bg-amber-100 text-amber-600",
  iso: "bg-blue-100 text-primary-600",
} as const

// Server requires codes of [A-Z0-9._-] (uppercase). Derive a valid code from
// the area name so the "Create Area" flow never fails on formatting.
function toAreaCode(name: string): string {
  const sanitized = name
    .toUpperCase()
    .replace(/[^A-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
  return sanitized || "AREA"
}

export function AddAreaModal({ open, onOpenChange, areaSet = "aaccup", area, onSuccess }: AddAreaModalProps) {
  const isEditing = Boolean(area)
  const [areaName, setAreaName] = useState("")
  const [description, setDescription] = useState("")
  const [department, setDepartment] = useState("")
  const [status, setStatus] = useState<"ACTIVE" | "INACTIVE">("ACTIVE")
  const [departments, setDepartments] = useState<SystemDepartment[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!open) return
    setError("")
    setAreaName(area?.name ?? "")
    setDescription(area?.description ?? "")
    setDepartment(area?.departmentId ?? "")
    setStatus(area ? (area.isActive ? "ACTIVE" : "INACTIVE") : "ACTIVE")
    listSystemDepartments({ pageSize: 100 })
      .then((page) => setDepartments(page.items))
      .catch(() => setDepartments([]))
  }, [open, area])

  const isValid = areaName.trim().length > 0 && department

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setAreaName(""); setDescription(""); setDepartment(""); setStatus("ACTIVE"); setError("")
    }
    onOpenChange(isOpen)
  }

  const handleSubmit = async () => {
    setError("")
    if (!isValid) return
    setSaving(true)
    try {
      const name = areaName.trim()
      if (isEditing && area) {
        const updated = await updateOnlineArea(area.id, {
          name,
          description: description.trim() || "",
          departmentId: department,
          status,
        })
        onSuccess?.({ id: updated.id, title: updated.name })
      } else {
        const created = await createOnlineArea({
          code: toAreaCode(name),
          name,
          description: description.trim() || "",
          departmentId: department,
          areaSet: areaSet.toUpperCase() as "AACCUP" | "ISO",
        })
        onSuccess?.({ id: created.id, title: created.name })
      }
      setAreaName(""); setDescription(""); setDepartment(""); setStatus("ACTIVE")
      onOpenChange(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : isEditing ? "Failed to update area" : "Failed to create area")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", setBadgeIcon[areaSet])}>
              {isEditing ? <Pencil className="w-4 h-4" /> : <Award className="w-4 h-4" />}
            </div>
            <DialogTitle className="text-lg">{isEditing ? "Edit" : "Add"} {setLabel[areaSet]} Area</DialogTitle>
          </div>
          <DialogDescription className="text-[14px]">
            {isEditing
              ? "Update the details of this accreditation area."
              : `Create and assign a new ${setLabel[areaSet]} accreditation area.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-4">
          {error && (
            <div className="text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor="areaName" className="text-[13px] font-medium">
              Area Name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="areaName"
              autoFocus
              placeholder="e.g. Area I - Instruction"
              className="h-10"
              value={areaName}
              onChange={(e) => setAreaName(e.target.value)}
            />
            <p className="text-[11px] text-gray-500">
              Name of the {setLabel[areaSet]} accreditation area
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="areaDescription" className="text-[13px] font-medium">
              Description
            </Label>
            <Textarea
              id="areaDescription"
              placeholder="Optional description of the area..."
              className="min-h-[80px] resize-none"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="department" className="text-[13px] font-medium">
              Department <span className="text-red-500">*</span>
            </Label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger id="department" className="h-10">
                <SelectValue placeholder="Select department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>
                    {dept.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-gray-500">
              Assign the responsible department
            </p>
          </div>

          <div className="grid gap-2">
            <Label className="text-[13px] font-medium">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as "ACTIVE" | "INACTIVE")}>
              <SelectTrigger className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-gray-500">
              Inactive areas stop accepting new submissions
            </p>
          </div>
        </div>

        <div className="border-t border-gray-100 my-2" />

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleClose(false)} className="h-9">
            Cancel
          </Button>
          <Button onClick={handleSubmit} className="h-9 shadow-soft" disabled={!isValid || saving}>
            {saving ? (isEditing ? "Saving..." : "Creating...") : isEditing ? "Save Changes" : "Create Area"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
