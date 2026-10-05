import { useCallback, useEffect, useState } from "react"
import {
  Shield,
  User as UserIcon,
  Smartphone,
  Monitor,
  Laptop,
  LogOut,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Camera,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Label } from "@/components/ui/Label"
import { Badge } from "@/components/ui/Badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar"
import { Skeleton } from "@/components/ui/Skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import { toast } from "@/lib/toast"
import { authService } from "@/services/auth"
import { useAuth } from "@/context/AuthContext"
import { useAvatar, uploadAvatar } from "@/lib/avatar"
import { ROLE_LABELS } from "@/lib/permissions"
import { ChangePasswordModal } from "@/components/modals/ChangePasswordModal"
import type { ServerUser, UserSession } from "@/types/domain"
import { cn } from "@/lib/utils"

// =============================================================================
// AccountSecurity — shared self-service Account & Security page (Sprint 8.1).
// Used identically by the user portal and the admin portal: profile edit
// (whitelisted name fields), read-only login identity, change password, and
// active-session management (revoke one / revoke all others).
// =============================================================================

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function DeviceIcon({ device }: { device: string | null }) {
  const label = (device ?? "").toLowerCase()
  if (label.includes("mobile") || label.includes("android") || label.includes("iphone")) {
    return <Smartphone className="w-4 h-4 text-gray-500" />
  }
  if (label.includes("tablet") || label.includes("ipad")) {
    return <Monitor className="w-4 h-4 text-gray-500" />
  }
  return <Laptop className="w-4 h-4 text-gray-500" />
}

export default function AccountSecurity() {
  const { user } = useAuth()
  const { url: avatarUrl, set: setAvatar } = useAvatar(user?.id)

  const handleAvatarChange = async (file: File) => {
    if (!user) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Profile picture must be 2MB or smaller.")
      return
    }
    try {
      const photoUrl = await uploadAvatar(file)
      setAvatar(photoUrl)
      toast.success("Profile picture updated.")
    } catch {
      toast.error("Could not read the selected image.")
    }
  }

  const [profile, setProfile] = useState<ServerUser | null>(null)
  const [firstName, setFirstName] = useState("")
  const [middleName, setMiddleName] = useState("")
  const [lastName, setLastName] = useState("")
  const [suffix, setSuffix] = useState("")
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState("")

  const [sessions, setSessions] = useState<UserSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false)
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false)

  const loadProfile = useCallback(async () => {
    try {
      const server = await authService.meRaw()
      setProfile(server)
      setFirstName(server.firstName)
      setMiddleName(server.middleName ?? "")
      setLastName(server.lastName)
      setSuffix(server.suffix ?? "")
      setLoadError("")
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Unable to load your profile")
    }
  }, [])

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      setSessions(await authService.getUserSessions())
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Unable to load sessions")
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProfile()
    void loadSessions()
  }, [loadProfile, loadSessions])

  const nameChanged =
    profile !== null &&
    (firstName !== profile.firstName ||
      (middleName ?? "") !== (profile.middleName ?? "") ||
      lastName !== profile.lastName ||
      (suffix ?? "") !== (profile.suffix ?? ""))

  const handleSave = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First and last name are required")
      return
    }
    setSaving(true)
    try {
      const result = await authService.updateProfile({
        firstName: firstName.trim(),
        middleName: middleName.trim() || null,
        lastName: lastName.trim(),
        suffix: suffix.trim() || null,
      })
      if (!result.success) {
        toast.error(result.error ?? "Failed to update profile")
      } else {
        toast.success("Profile updated")
        await loadProfile()
        await authService.me()
      }
    } finally {
      setSaving(false)
    }
  }

  const handleRevokeSession = async (sessionId: string) => {
    setRevokingId(sessionId)
    try {
      await authService.killSession(sessionId)
      toast.success("Session signed out")
      await loadSessions()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to revoke session")
    } finally {
      setRevokingId(null)
    }
  }

  const handleRevokeAllOthers = async () => {
    setRevokingAll(true)
    try {
      const result = await authService.killAllOtherSessions()
      toast.success(
        result > 0 ? `Signed out ${result} other device${result > 1 ? "s" : ""}` : "No other active sessions",
      )
      await loadSessions()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to sign out other devices")
    } finally {
      setRevokingAll(false)
      setConfirmRevokeAll(false)
    }
  }

  const otherSessions = sessions.filter((s) => !s.current)

  return (
    <div className="content-padding">
      <PageHeader
        title="Account & Security"
        description="Manage your profile, password, and active sessions."
      />

      {loadError && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-red-900">Profile unavailable</p>
            <p className="mt-1 text-[12px] text-red-700">{loadError}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void loadProfile()}>Retry</Button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          {/* PROFILE */}
          <Card className="border-border/70 shadow-soft">
            <CardHeader className="pb-4">
              <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
                <UserIcon className="w-4 h-4 text-primary" />
                Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <Avatar className="h-16 w-16">
                    <AvatarImage src={avatarUrl ?? undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary text-[18px] font-semibold">
                      {profile
                        ? [profile.firstName, profile.lastName].filter(Boolean).map((n) => n[0]).join("").toUpperCase()
                        : "U"}
                    </AvatarFallback>
                  </Avatar>
                  <label className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center hover:bg-gray-700 transition-colors cursor-pointer">
                    <Camera className="w-3.5 h-3.5" />
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void handleAvatarChange(f)
                      e.target.value = ""
                    }} />
                  </label>
                </div>
                <div>
                  <p className="text-[16px] font-semibold text-gray-900">
                    {profile ? [profile.firstName, profile.middleName, profile.lastName, profile.suffix].filter(Boolean).join(" ") : "Loading..."}
                  </p>
                  <p className="text-[13px] text-gray-500">{profile?.email ?? ""}</p>
                  {profile && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge variant="default" className="text-[11px]">
                        {ROLE_LABELS[user?.role ?? "staff"] ?? profile.role}
                      </Badge>
                      {profile.status === "ACTIVE" ? (
                        <Badge variant="success" className="text-[11px]">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[11px]">{profile.status}</Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Employee ID</Label>
                  <p className="text-[14px] text-gray-700 mt-1">{profile?.employeeId ?? "—"}</p>
                </div>
                <div>
                  <Label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Department</Label>
                  <p className="text-[14px] text-gray-700 mt-1">{profile?.departmentName ?? "—"}</p>
                </div>
                <div>
                  <Label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Member Since</Label>
                  <p className="text-[14px] text-gray-700 mt-1">{formatDate(profile?.createdAt)}</p>
                </div>
                <div>
                  <Label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Last Login</Label>
                  <p className="text-[14px] text-gray-700 mt-1">{formatDate(profile?.lastLogin)}</p>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-[13px] font-medium text-gray-800 mb-3">Edit Name</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="acctFirstName" className="text-[13px] font-medium text-gray-700">
                      First Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="acctFirstName"
                      className="h-10"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="acctMiddleName" className="text-[13px] font-medium text-gray-700">
                      Middle Name
                    </Label>
                    <Input
                      id="acctMiddleName"
                      className="h-10"
                      value={middleName}
                      onChange={(e) => setMiddleName(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="acctLastName" className="text-[13px] font-medium text-gray-700">
                      Last Name <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="acctLastName"
                      className="h-10"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="acctSuffix" className="text-[13px] font-medium text-gray-700">
                      Suffix
                    </Label>
                    <Input
                      id="acctSuffix"
                      className="h-10"
                      value={suffix}
                      onChange={(e) => setSuffix(e.target.value)}
                      placeholder="e.g. Jr., III"
                      disabled={saving}
                    />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Button onClick={() => void handleSave()} disabled={saving || !nameChanged || !profile}>
                    {saving ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Save Changes
                      </>
                    )}
                  </Button>
                  {nameChanged && !saving && (
                    <p className="text-[12px] text-gray-500">You have unsaved changes</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* ACTIVE SESSIONS */}
          <Card className="border-border/70 shadow-soft">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-primary" />
                  Active Sessions
                </CardTitle>
                {otherSessions.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 border-red-200 text-red-600 hover:bg-red-50"
                    disabled={revokingAll}
                    onClick={() => setConfirmRevokeAll(true)}
                  >
                    <LogOut className="w-4 h-4 mr-2" />
                    Sign Out All Other Devices
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {sessionsLoading ? (
                <div className="space-y-2">
                  <Skeleton variant="rectangular" className="h-16" />
                  <Skeleton variant="rectangular" className="h-16" />
                </div>
              ) : sessions.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-gray-400">No active sessions.</p>
              ) : (
                sessions.map((session) => (
                  <div
                    key={session.id}
                    className={cn(
                      "flex items-center justify-between gap-3 p-3 rounded-lg border transition-colors",
                      session.current ? "border-primary/30 bg-primary/5" : "border-gray-100 bg-gray-50/50"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-white border border-border flex items-center justify-center flex-shrink-0">
                        <DeviceIcon device={session.device} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[13px] font-medium text-gray-900 truncate">
                            {session.device !== "Unknown device" ? session.device : "Device"}
                          </p>
                          {session.current && (
                            <Badge variant="default" className="text-[10px]">
                              Current Session
                            </Badge>
                          )}
                        </div>
                        <p className="text-[12px] text-gray-500 truncate">
                          {session.browser} · {session.ipAddress || "IP not recorded"}
                        </p>
                        <p className="text-[11px] text-gray-400">
                          Signed in {formatDate(session.createdAt)} · Expires {formatDate(session.expiresAt)}
                        </p>
                      </div>
                    </div>
                    {!session.current && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-[12px] text-red-600 hover:bg-red-50 flex-shrink-0"
                        disabled={revokingId === session.id || revokingAll}
                        onClick={() => void handleRevokeSession(session.id)}
                      >
                        {revokingId === session.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        ) : (
                          <LogOut className="w-3.5 h-3.5 mr-1.5" />
                        )}
                        Sign Out
                      </Button>
                    )}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* SECURITY */}
        <div className="space-y-5">
          <Card className="border-border/70 shadow-soft">
            <CardHeader className="pb-4">
              <CardTitle className="text-[15px] font-semibold flex items-center gap-2">
                <Shield className="w-4 h-4 text-primary" />
                Security
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Email (Login Identity)</Label>
                <p className="text-[14px] text-gray-700 mt-1">{profile?.email ?? "—"}</p>
                <p className="text-[12px] text-gray-500 mt-1">
                  Your email is your login identity and cannot be changed.
                </p>
              </div>
              <div>
                <Label className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Role</Label>
                <p className="text-[14px] text-gray-700 mt-1">
                  {ROLE_LABELS[user?.role ?? "staff"] ?? profile?.role ?? "—"}
                </p>
              </div>
              <div className="border-t border-gray-100 pt-4">
                <Button
                  variant="outline"
                  className="w-full h-10"
                  onClick={() => setIsChangePasswordOpen(true)}
                >
                  <KeyRound className="w-4 h-4 mr-2" />
                  Change Password
                </Button>
                <p className="text-[11px] text-gray-400 mt-2">
                  Changing your password signs out all other devices.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirm revoke all other sessions */}
      <Dialog open={confirmRevokeAll} onOpenChange={setConfirmRevokeAll}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="text-lg">Sign out all other devices?</DialogTitle>
            <DialogDescription className="text-[14px]">
              This will immediately revoke {otherSessions.length} active session
              {otherSessions.length !== 1 ? "s" : ""} on other devices. Your current session stays signed in.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmRevokeAll(false)} className="h-10 px-5">
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="h-10 px-5"
              disabled={revokingAll}
              onClick={() => void handleRevokeAllOthers()}
            >
              {revokingAll ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing Out...
                </>
              ) : (
                "Sign Out All Other Devices"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ChangePasswordModal open={isChangePasswordOpen} onOpenChange={setIsChangePasswordOpen} />
    </div>
  )
}
