import { useState, useEffect } from "react"
import {
  Shield,
  Bell,
  Settings2,
  Palette,
  FolderArchive,
  KeyRound,
  Monitor,
  Moon,
  Smartphone,
  Lock,
  LogOut,
  Sun,
} from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
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
import { ChangePasswordModal } from "@/components/modals/ChangePasswordModal"
import { SessionManagementModal } from "@/components/modals/SessionManagementModal"
import { useAuth } from "@/context/AuthContext"
import { useTheme } from "@/lib/theme"
import { toast } from "@/lib/toast"
import { ROLE_LABELS, hasServerPermission } from "@/lib/permissions"
import { getSystemSettings, updateSystemSettings, type SystemSettingsView } from "@/services/admin"
import { getDashboardStorage, type StorageStats } from "@/services/dashboard"
import { authService } from "@/services/auth"
import {
  createAnnouncement,
  getAnnouncementAudienceOptions,
  getNotificationPreferences,
  updateNotificationPreferences,
  type AnnouncementAudienceOptions,
  type NotificationFrequency,
} from "@/services/notifications"
import { Textarea } from "@/components/ui/Textarea"
import { cn } from "@/lib/utils"

type SettingsSection = "security" | "notifications" | "system" | "appearance" | "files" | "access"

const navItems = [
  { id: "security" as const, label: "Account Security", icon: Shield },
  { id: "notifications" as const, label: "Notification Preferences", icon: Bell },
  { id: "system" as const, label: "System Preferences", icon: Settings2 },
  { id: "appearance" as const, label: "Appearance", icon: Palette },
  { id: "files" as const, label: "File Management", icon: FolderArchive },
  { id: "access" as const, label: "Access Control", icon: KeyRound },
]

export default function Settings() {
  const { user, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const [activeSection, setActiveSection] = useState<SettingsSection>("security")
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false)
  const [isSessionManagementOpen, setIsSessionManagementOpen] = useState(false)
  const [settings, setSettings] = useState<SystemSettingsView | null>(null)
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null)

  const [language, setLanguage] = useState<"en" | "fil">("en")
  const [newFileType, setNewFileType] = useState("")
  const [timezone, setTimezone] = useState("Asia/Manila")
  const [dateFormat, setDateFormat] = useState<"mdy" | "dmy" | "ymd">("mdy")
  const [dashboardView, setDashboardView] = useState<"overview" | "submissions" | "documents">("overview")
  const [notificationEmailEnabled, setNotificationEmailEnabled] = useState(true)
  const [notificationFrequency, setNotificationFrequency] = useState<NotificationFrequency>("IMMEDIATE")
  const [deadlineHours, setDeadlineHours] = useState(24)
  const [audienceOptions, setAudienceOptions] = useState<AnnouncementAudienceOptions | null>(null)
  const [announcementTitle, setAnnouncementTitle] = useState("")
  const [announcementMessage, setAnnouncementMessage] = useState("")
  const [announcementAttachment, setAnnouncementAttachment] = useState<File | null>(null)
  const [announcementAudience, setAnnouncementAudience] = useState({ campusIds: [] as string[], collegeIds: [] as string[], departmentIds: [] as string[], programIds: [] as string[] })

  const [notifications, setNotifications] = useState<{
    submissions: boolean
    approvals: boolean
    announcements: boolean
    security: boolean
  }>(() => {
    const stored = localStorage.getItem("notificationPreferences")
    if (stored) {
      try {
        return { submissions: true, approvals: true, announcements: false, security: true, ...JSON.parse(stored) }
      } catch {
        /* ignore malformed stored preferences */
      }
    }
    return { submissions: true, approvals: true, announcements: false, security: true }
  })

  useEffect(() => {
    // Department Coordinators reach the admin portal without admin.settings.read;
    // requesting the singleton anyway would 403 and write a PERMISSION_DENIED
    // audit event on every Settings visit.
    if (hasServerPermission(user, "admin.settings.read")) {
      getSystemSettings().then(setSettings).catch((err) => console.error("Failed to load settings:", err))
    }
    getDashboardStorage().then(setStorageStats).catch((err) => console.error("Failed to load storage stats:", err))
  }, [user])

  useEffect(() => {
    getNotificationPreferences().then((preference) => {
      setNotificationEmailEnabled(preference.emailEnabled)
      setNotificationFrequency(preference.frequency)
      setDeadlineHours(preference.deadlineHours)
    }).catch(() => undefined)
    if (hasServerPermission(user, "notification.manage")) {
      getAnnouncementAudienceOptions().then(setAudienceOptions).catch(() => setAudienceOptions(null))
    }
  }, [user])

  const handleSaveSettings = async (patch: Partial<Omit<SystemSettingsView, "updatedAt" | "updatedById">>) => {
    const updated = settings ? { ...settings, ...patch } : null
    setSettings(updated)
    if (!updated) return
    try {
      const saved = await updateSystemSettings(patch)
      setSettings(saved)
      toast.success("Settings saved")
    } catch (err) {
      setSettings(settings)
      toast.error(err instanceof Error ? err.message : "Failed to save settings")
    }
  }

  const handleAddFileType = async () => {
    const type = newFileType.trim().replace(/^\./, "").toLowerCase()
    if (!type) return
    const current = settings?.allowedFileTypes ?? []
    if (current.includes(type)) {
      toast.error("That file type is already allowed")
      return
    }
    setNewFileType("")
    await handleSaveSettings({ allowedFileTypes: [...current, type] })
  }

  const handleRemoveFileType = async (type: string) => {
    const current = settings?.allowedFileTypes ?? []
    await handleSaveSettings({ allowedFileTypes: current.filter((t) => t !== type) })
  }

  const handleSaveNotifications = async () => {
    localStorage.setItem("notificationPreferences", JSON.stringify(notifications))
    try {
      await updateNotificationPreferences({ emailEnabled: notificationEmailEnabled, frequency: notificationFrequency, deadlineHours, timezone })
      toast.success("Notification preferences saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save notification preferences")
    }
  }

  const publishAnnouncement = async () => {
    if (!announcementTitle.trim() || !announcementMessage.trim()) {
      toast.error("Enter an announcement title and message")
      return
    }
    try {
      let metadata: Record<string, unknown> | undefined
      if (announcementAttachment) {
        if (announcementAttachment.size > 600_000) {
          toast.error("Reference files must be 600 KB or smaller")
          return
        }
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error("Could not read the attachment"))
          reader.readAsDataURL(announcementAttachment)
        })
        metadata = { attachment: { name: announcementAttachment.name, mimeType: announcementAttachment.type || "application/octet-stream", dataUrl } }
      }
      const result = await createAnnouncement({ title: announcementTitle.trim(), message: announcementMessage.trim(), audience: announcementAudience, metadata })
      toast.success(`Announcement sent to ${result.created} user${result.created === 1 ? "" : "s"}`)
      setAnnouncementTitle("")
      setAnnouncementMessage("")
      setAnnouncementAttachment(null)
      setAnnouncementAudience({ campusIds: [], collegeIds: [], departmentIds: [], programIds: [] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to publish announcement")
    }
  }

  const handleLogoutAll = async () => {
    try { await authService.logout(); logout() } catch {
      // The local session can still be cleared if the server is unavailable.
    }
  }

  const roleLabel = user?.role ? ROLE_LABELS[user.role] ?? user.role : "User"
  const storageUsed = Number(storageStats?.totalStorageUsedBytes ?? 0)
  const storageAvailable = Number(storageStats?.availableStorageBytes ?? 0)
  const storageTotal = storageUsed + storageAvailable
  const storagePercent = storageTotal > 0 ? Math.round((storageUsed / storageTotal) * 100) : 0

  function bytesToReadable(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
    const units = ["B", "KB", "MB", "GB", "TB"]
    let i = 0
    let value = bytes
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024
      i++
    }
    return `${value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0)} ${units[i]}`
  }

  return (
    <div className="content-padding">
      <PageHeader
            title="Settings"
            description="Manage your account settings and preferences"
          />

          <div className="flex flex-col lg:flex-row responsive-gap">
            <div className="w-full lg:w-64 flex-shrink-0">
              <Card className="border-border/70 shadow-soft">
                <CardContent className="p-2">
                  <nav className="space-y-1">
                    {navItems.map((item) => {
                      const Icon = item.icon
                      const isActive = activeSection === item.id
                      return (
                        <button
                          key={item.id}
                          onClick={() => setActiveSection(item.id)}
                          className={cn(
                            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-medium transition-all duration-150",
                            isActive
                              ? "bg-primary text-white"
                              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                          )}
                        >
                          <Icon className="w-[18px] h-[18px]" />
                          {item.label}
                        </button>
                      )
                    })}
                  </nav>
                </CardContent>
              </Card>
            </div>

            <div className="flex-1 min-w-0">
              {activeSection === "security" && (
                <div className="space-y-6">
                  <Card className="border-border/70 shadow-soft">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-[16px] font-semibold">Password</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-[14px] text-gray-600">
                        Update your password regularly to keep your account secure.
                      </p>
                      <Button onClick={() => setIsChangePasswordOpen(true)} className="h-10 px-5 shadow-soft">
                        <Lock className="w-4 h-4 mr-2" />
                        Change Password
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="border-border/70 shadow-soft">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-[16px] font-semibold">Two-Factor Authentication</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[14px] font-medium text-gray-900">Authenticator App</p>
                          <p className="text-[13px] text-gray-500 mt-0.5">
                            Use an authenticator app to get verification codes.
                          </p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-border/70 shadow-soft">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-[16px] font-semibold">Active Sessions</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-[14px] text-gray-600">
                        Manage your active sessions across all devices.
                      </p>
                      <div className="flex gap-3">
                        <Button onClick={() => setIsSessionManagementOpen(true)} variant="outline" className="h-10 px-5">
                          <Monitor className="w-4 h-4 mr-2" />
                          Manage Sessions
                        </Button>
                        <Button variant="outline" className="h-10 px-5 text-red-600 border-red-200 hover:bg-red-50" onClick={handleLogoutAll}>
                          <LogOut className="w-4 h-4 mr-2" />
                          Logout All
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {activeSection === "notifications" && (
                <div className="space-y-6">
                  <Card className="border-border/70 shadow-soft">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-[16px] font-semibold">Notification Preferences</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {[
                        { key: "submissions", label: "Submission Alerts", desc: "Get notified when documents are submitted" },
                        { key: "approvals", label: "Approval Alerts", desc: "Get notified on approval/rejection actions" },
                        { key: "announcements", label: "System Announcements", desc: "Receive system-wide announcements" },
                        { key: "security", label: "Security Notifications", desc: "Get alerts for security-related events" },
                      ].map((item) => (
                        <div key={item.key} className="flex items-center justify-between py-3 border-b border-gray-50 last:border-0">
                          <div>
                            <p className="text-[14px] font-medium text-gray-900">{item.label}</p>
                            <p className="text-[13px] text-gray-500 mt-0.5">{item.desc}</p>
                          </div>
                          <Switch checked={notifications[item.key as keyof typeof notifications]} onCheckedChange={(checked) => setNotifications((prev) => ({ ...prev, [item.key]: checked }))} />
                        </div>
                      ))}
                      <div className="grid gap-4 border-t border-gray-100 pt-4 md:grid-cols-3">
                        <div className="flex items-center justify-between gap-3 md:col-span-3">
                          <div><p className="text-[14px] font-medium text-gray-900">Email notifications</p><p className="text-[13px] text-gray-500">Send notification updates to your registered email.</p></div>
                          <Switch checked={notificationEmailEnabled} onCheckedChange={setNotificationEmailEnabled} />
                        </div>
                        <div className="grid gap-2"><Label className="text-[13px] font-medium text-gray-700">Email schedule</Label><Select value={notificationFrequency} onValueChange={(value) => setNotificationFrequency(value as NotificationFrequency)}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="IMMEDIATE">Immediately</SelectItem><SelectItem value="DAILY">Daily digest</SelectItem><SelectItem value="WEEKLY">Weekly digest</SelectItem><SelectItem value="MONTHLY">Monthly digest</SelectItem></SelectContent></Select></div>
                        <div className="grid gap-2"><Label className="text-[13px] font-medium text-gray-700">Deadline reminder</Label><Select value={String(deadlineHours)} onValueChange={(value) => setDeadlineHours(Number(value))}><SelectTrigger className="h-10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">1 hour before</SelectItem><SelectItem value="3">3 hours before</SelectItem><SelectItem value="6">6 hours before</SelectItem><SelectItem value="24">24 hours before</SelectItem><SelectItem value="72">3 days before</SelectItem></SelectContent></Select></div>
                        <div className="flex items-end"><p className="text-[12px] text-gray-500">Digest emails group ordinary notifications. Deadline reminders remain separate.</p></div>
                      </div>
                    </CardContent>
                    <div className="flex justify-end px-5 pb-5 md:px-6 md:pb-6"><Button className="h-10 px-5 shadow-soft" onClick={handleSaveNotifications}>Save Preferences</Button></div>
                  </Card>

                  {hasServerPermission(user, "notification.manage") && (
                    <Card className="border-border/70 shadow-soft">
                      <CardHeader className="pb-4"><CardTitle className="text-[16px] font-semibold">Create Announcement</CardTitle><p className="text-[13px] text-gray-500">Send an in-app and email announcement to selected campuses, colleges, departments, or programs.</p></CardHeader>
                      <CardContent className="space-y-4">
                        <Input value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} placeholder="Announcement title" />
                        <Textarea value={announcementMessage} onChange={(event) => setAnnouncementMessage(event.target.value)} placeholder="Write your announcement..." rows={5} />
                        <div className="grid gap-2"><Label className="text-[13px] font-medium text-gray-700">Reference image or file (optional, 600 KB max)</Label><Input type="file" onChange={(event) => setAnnouncementAttachment(event.target.files?.[0] ?? null)} /></div>
                        <p className="text-[12px] text-gray-500">Leave all audience lists empty to notify every active user. Multiple selections are combined.</p>
                        {audienceOptions && <div className="grid gap-4 md:grid-cols-2">
                          {(["campuses", "colleges", "departments", "programs"] as const).map((key) => <div key={key} className="grid gap-2"><Label className="text-[13px] font-medium capitalize text-gray-700">{key}</Label><select multiple value={announcementAudience[`${key.slice(0, -1)}Ids` as "campusIds" | "collegeIds" | "departmentIds" | "programIds"]} onChange={(event) => setAnnouncementAudience((previous) => ({ ...previous, [`${key.slice(0, -1)}Ids`]: Array.from(event.target.selectedOptions, (option) => option.value) }))} className="min-h-24 rounded-xl border border-border bg-white px-3 py-2 text-[13px]">{audienceOptions[key].map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></div>)}
                        </div>}
                      </CardContent>
                      <div className="flex justify-end px-5 pb-5 md:px-6"><Button className="h-10 px-5 shadow-soft" onClick={() => void publishAnnouncement()}>Publish Announcement</Button></div>
                    </Card>
                  )}
                </div>
              )}

              {activeSection === "system" && (
                <Card className="border-border/70 shadow-soft">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-[16px] font-semibold">System Preferences</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid grid-cols-2 gap-5">
                      <div className="grid gap-2">
                        <Label className="text-[13px] font-medium text-gray-700">Language</Label>
                        <Select value={language} onValueChange={(v) => setLanguage(v as "en" | "fil")}>
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="en">English (US)</SelectItem>
                            <SelectItem value="fil">Filipino</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label className="text-[13px] font-medium text-gray-700">Timezone</Label>
                        <Select value={timezone} onValueChange={setTimezone}>
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Asia/Manila">Philippines (UTC+8)</SelectItem>
                            <SelectItem value="utc">UTC</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-5">
                      <div className="grid gap-2">
                        <Label className="text-[13px] font-medium text-gray-700">Date Format</Label>
                        <Select value={dateFormat} onValueChange={(v) => setDateFormat(v as "mdy" | "dmy" | "ymd")}>
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mdy">MM/DD/YYYY</SelectItem>
                            <SelectItem value="dmy">DD/MM/YYYY</SelectItem>
                            <SelectItem value="ymd">YYYY-MM-DD</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-2">
                        <Label className="text-[13px] font-medium text-gray-700">Default Dashboard View</Label>
                        <Select value={dashboardView} onValueChange={(v) => setDashboardView(v as "submissions" | "documents" | "overview")}>
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="overview">Overview</SelectItem>
                            <SelectItem value="submissions">Submissions</SelectItem>
                            <SelectItem value="documents">Documents</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeSection === "appearance" && (
                <Card className="border-border/70 shadow-soft">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-[16px] font-semibold">Appearance</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                      <button
                        onClick={() => setTheme("light")}
                        className={cn(
                          "p-4 rounded-xl border-2 transition-all",
                          theme === "light"
                            ? "border-primary bg-primary-500"
                            : "border-border hover:border-gray-300"
                        )}
                      >
                        <div className="w-full h-24 bg-white border border-border rounded-lg mb-3 flex items-center justify-center">
                          <Sun className="w-8 h-8 text-amber-500" />
                        </div>
                        <p className="text-[14px] font-medium text-gray-900">Light</p>
                        <p className="text-[12px] text-gray-500 mt-0.5">Light mode interface</p>
                      </button>

                      <button
                        onClick={() => setTheme("dark")}
                        className={cn(
                          "p-4 rounded-xl border-2 transition-all",
                          theme === "dark"
                            ? "border-primary bg-primary-500"
                            : "border-border hover:border-gray-300"
                        )}
                      >
                        <div className="w-full h-24 bg-gray-900 rounded-lg mb-3 flex items-center justify-center">
                          <Moon className="w-8 h-8 text-gray-300" />
                        </div>
                        <p className="text-[14px] font-medium text-gray-900">Dark</p>
                        <p className="text-[12px] text-gray-500 mt-0.5">Dark mode interface</p>
                      </button>

                      <button
                        onClick={() => setTheme("system")}
                        className={cn(
                          "p-4 rounded-xl border-2 transition-all",
                          theme === "system"
                            ? "border-primary bg-primary-500"
                            : "border-border hover:border-gray-300"
                        )}
                      >
                        <div className="w-full h-24 bg-gradient-to-r from-white to-gray-900 rounded-lg mb-3 flex items-center justify-center">
                          <Smartphone className="w-8 h-8 text-gray-600" />
                        </div>
                        <p className="text-[14px] font-medium text-gray-900">System</p>
                        <p className="text-[12px] text-gray-500 mt-0.5">Match system settings</p>
                      </button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeSection === "files" && (
                <Card className="border-border/70 shadow-soft">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-[16px] font-semibold">File Management</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="grid gap-5">
                      <div className="grid gap-2">
                        <Label className="text-[13px] font-medium text-gray-700">Storage Threshold Warning</Label>
                        <Select
                          value={String(settings?.storageThresholdWarning ?? 80)}
                          onValueChange={(v) => handleSaveSettings({ storageThresholdWarning: Number(v) })}
                        >
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="60">60%</SelectItem>
                            <SelectItem value="70">70%</SelectItem>
                            <SelectItem value="80">80%</SelectItem>
                            <SelectItem value="90">90%</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid gap-2">
                      <Label className="text-[13px] font-medium text-gray-700">Allowed File Types</Label>
                      <div className="flex flex-wrap gap-2 p-3 rounded-lg border border-border bg-gray-50/50">
                        {(settings?.allowedFileTypes?.length
                          ? settings.allowedFileTypes
                          : ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "jpg", "png", "zip"]
                        ).map((type) => (
                          <span key={type} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-border text-[12px] font-medium text-gray-600">
                            .{type.replace(/^\./, "").toUpperCase()}
                            <button
                              type="button"
                              className="text-gray-400 hover:text-red-500 transition-colors"
                              onClick={() => handleRemoveFileType(type.replace(/^\./, "").toLowerCase())}
                              title="Remove file type"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={newFileType}
                          onChange={(e) => setNewFileType(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAddFileType() } }}
                          placeholder="e.g. pdf, docx"
                          className="h-9 w-48"
                        />
                        <Button variant="outline" size="sm" className="h-9" onClick={() => void handleAddFileType()}>
                          Add
                        </Button>
                      </div>
                      <p className="text-[12px] text-gray-500">
                        {settings?.allowedFileTypes?.length ? `${settings.allowedFileTypes.length} file type(s) allowed` : "All file types are currently allowed"}
                      </p>
                    </div>

                    <div className="grid gap-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[13px] font-medium text-gray-700">Storage Used</Label>
                        <span className="text-[13px] text-gray-500">{bytesToReadable(storageUsed)} / {bytesToReadable(storageTotal)}</span>
                      </div>
                      <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${storagePercent}%` }} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {activeSection === "access" && (
                <Card className="border-border/70 shadow-soft">
                  <CardHeader className="pb-4">
                    <CardTitle className="text-[16px] font-semibold">Access Control</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-[14px] text-gray-600">
                      Your current role permissions and access levels.
                    </p>

                    <div className="p-4 rounded-xl border border-primary/20 bg-primary-500">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-lg bg-primary flex items-center justify-center">
                          <Shield className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <p className="text-[15px] font-semibold text-gray-900">{roleLabel}</p>
                          <p className="text-[13px] text-gray-600">{user?.role === "super_admin" ? "Full access to all system features" : "Limited access based on your role"}</p>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: "View Documents", granted: true },
                        { label: "Upload Documents", granted: true },
                        { label: "Edit Documents", granted: true },
                        { label: "Delete Documents", granted: true },
                        { label: "Manage Users", granted: true },
                        { label: "View Audit Logs", granted: true },
                        { label: "Manage Settings", granted: true },
                        { label: "Approve Submissions", granted: true },
                      ].map((perm, i) => (
                        <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-gray-50/50 border border-gray-100">
                          <span className="text-[13px] text-gray-700">{perm.label}</span>
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
                            perm.granted ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                          }`}>
                            {perm.granted ? "Granted" : "Denied"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          <ChangePasswordModal
        open={isChangePasswordOpen}
        onOpenChange={setIsChangePasswordOpen}
      />

      <SessionManagementModal
        open={isSessionManagementOpen}
        onOpenChange={setIsSessionManagementOpen}
      />
    </div>
  )
}
