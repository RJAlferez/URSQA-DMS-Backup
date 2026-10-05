import { useEffect, useState, useCallback } from "react"
import { Search, RefreshCw, Users, KeyRound, Loader2 } from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Badge } from "@/components/ui/Badge"
import { Label } from "@/components/ui/Label"
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
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/Pagination"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import { listSystemUsers, type RootSystemUser } from "@/services/root"
import { resetUserPassword } from "@/services/admin"
import { toast } from "@/lib/toast"

const PAGE_SIZE = 15

function statusBadge(status: string): "success" | "warning" | "danger" | "default" {
  if (status === "ACTIVE") return "success"
  if (status === "SUSPENDED") return "danger"
  if (status === "PENDING") return "warning"
  return "default"
}

export default function RootUsers() {
  const [users, setUsers] = useState<RootSystemUser[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resetTarget, setResetTarget] = useState<RootSystemUser | null>(null)
  const [newPassword, setNewPassword] = useState("")
  const [mustChange, setMustChange] = useState(true)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await listSystemUsers({
        page,
        pageSize: PAGE_SIZE,
        search: search.trim() || undefined,
        status: status === "all" ? undefined : status,
      })
      setUsers(result.items)
      setTotal(result.meta.total)
      setTotalPages(Math.max(1, result.meta.totalPages))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users")
    } finally {
      setLoading(false)
    }
  }, [page, search, status])

  useEffect(() => {
    void load()
  }, [load])

  const handleResetPassword = async () => {
    if (!resetTarget || !newPassword || newPassword.length < 8) return
    setResetting(true)
    try {
      await resetUserPassword(resetTarget.id, { newPassword, mustChangePassword: mustChange })
      toast.success(`Password reset for ${resetTarget.firstName} ${resetTarget.lastName}`)
      setResetTarget(null)
      setNewPassword("")
      setMustChange(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset password")
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="content-padding">
      <PageHeader
        title="System Users"
        description="All platform accounts — system administrator view"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} className="shadow-soft">
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
              placeholder="Search by name, email or employee ID…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v); setPage(1) }}>
            <SelectTrigger className="h-10 w-full sm:w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="ACTIVE">Active</SelectItem>
              <SelectItem value="SUSPENDED">Suspended</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="border-border/70 shadow-soft">
        <CardContent className="p-0">
          {loading ? (
            <div className="min-h-[280px] flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error ? (
            <div className="p-8 text-center text-[13px] text-gray-500">{error}</div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-[13px] text-gray-500">
              <Users className="w-6 h-6 mx-auto mb-2 text-gray-300" />
              No users found.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="text-[13px] font-medium text-gray-900">{user.firstName} {user.middleName ?? ""} {user.lastName} {user.suffix ?? ""}</div>
                      <div className="text-[12px] text-gray-500">{user.email}</div>
                    </TableCell>
                    <TableCell className="text-[13px] text-gray-600">{user.employeeId}</TableCell>
                    <TableCell>
                      <Badge variant={user.roleName === "ROOT" ? "danger" : "secondary"}>{user.roleName}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadge(user.status)}>{user.status}</Badge>
                    </TableCell>
                    <TableCell className="text-[12px] text-gray-500">
                      {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-[12px] text-gray-500">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-gray-400 hover:text-primary-600"
                        title="Reset password"
                        onClick={() => { setResetTarget(user); setNewPassword(""); setMustChange(true) }}
                      >
                        <KeyRound className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <div className="table-footer">
          <span className="text-[12px] text-gray-500">{total} users</span>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious onClick={() => setPage((p) => Math.max(1, p - 1))} className={page <= 1 ? "pointer-events-none opacity-50" : ""} />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink isActive>{page}</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className={page >= totalPages ? "pointer-events-none opacity-50" : ""} />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
          <span className="text-[12px] text-gray-500">page {page} of {totalPages}</span>
        </div>
      </Card>

      <Dialog open={resetTarget !== null} onOpenChange={(open) => { if (!open) setResetTarget(null) }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-primary-600" />
              Reset Password
            </DialogTitle>
            <DialogDescription className="text-[14px]">
              Set a new password for <strong>{resetTarget?.firstName} {resetTarget?.lastName}</strong> ({resetTarget?.email})
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-[13px] font-medium mb-1.5 block">New Password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 8 characters"
                className="h-10"
                autoFocus
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={mustChange}
                onChange={(e) => setMustChange(e.target.checked)}
                className="w-4 h-4 rounded accent-primary"
              />
              <span className="text-[13px] text-gray-600">Require password change on next login</span>
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setResetTarget(null)} className="h-10">Cancel</Button>
            <Button
              onClick={() => void handleResetPassword()}
              disabled={resetting || newPassword.length < 8}
              className="h-10"
            >
              {resetting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
