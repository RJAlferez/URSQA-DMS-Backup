import { useState, useEffect, useCallback } from "react"
import { Sun, Moon, Smartphone } from "lucide-react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Label } from "@/components/ui/Label"
import { Switch } from "@/components/ui/Switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/Select"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { getSystemSettings } from "@/services/admin"
import type { AppSettings } from "@/types/domain"
import { getNotificationPreferences, updateNotificationPreferences, type NotificationFrequency } from "@/services/notifications"
import { toast } from "@/lib/toast"

export default function UserSettings() {
  const { theme, setTheme } = useTheme()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    const saved = localStorage.getItem("userViewMode")
    return (saved as "grid" | "list") || "list"
  })
  const [compactMode, setCompactMode] = useState(false)
  const [collapsedSidebar, setCollapsedSidebar] = useState(false)
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [frequency, setFrequency] = useState<NotificationFrequency>("IMMEDIATE")
  const [deadlineHours, setDeadlineHours] = useState(24)
  const fetchSettings = useCallback(async () => {
    try {
      const s = await getSystemSettings()
      if (s) {
        setSettings({
          id: "system",
          theme: "light",
          uploadSizeLimit: Number(s.maxUploadSizeBytes ?? 0),
          retentionDays: 0,
          language: "en",
          timezone: "",
          dateFormat: "mdy",
          defaultDashboardView: "overview",
           notifications: { submissions: true, approvals: true, announcements: true, security: true },
          compactMode: false,
          collapsedSidebar: false,
          storageQuotaGB: 10,
        })
        setCompactMode(false)
        setCollapsedSidebar(false)
      }
    } catch {
      // Settings are optional; retain the local defaults when unavailable.
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  useEffect(() => {
    getNotificationPreferences().then((preference) => {
      setEmailEnabled(preference.emailEnabled)
      setFrequency(preference.frequency)
      setDeadlineHours(preference.deadlineHours)
    }).catch(() => undefined)
  }, [])

  const saveEmailPreferences = async () => {
    try {
      await updateNotificationPreferences({ emailEnabled, frequency, deadlineHours })
      toast.success("Email notification preferences saved")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save preferences")
    }
  }

  const handleToggle = (field: keyof AppSettings, value: boolean) => {
    const patch = { [field]: value }
    setSettings((prev) => prev ? { ...prev, ...patch } : prev)
  }

  const handleNotificationToggle = (key: keyof AppSettings["notifications"], value: boolean) => {
    if (!settings) return
    const newNotifs = { ...settings.notifications, [key]: value }
    setSettings((prev) => prev ? { ...prev, notifications: newNotifs } : prev)
  }

  const handleViewModeChange = (mode: "grid" | "list") => {
    setViewMode(mode)
    localStorage.setItem("userViewMode", mode)
  }

  return (
    <div className="content-padding">
      <PageHeader title="Settings" description="Manage your preferences" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-4">
            <CardTitle className="text-[15px] font-semibold text-gray-900">Notification Preferences</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { key: "submissions", label: "Submission Alerts", desc: "Get notified when documents are submitted" },
              { key: "approvals", label: "Approval Alerts", desc: "Get notified on approval/rejection actions" },
              { key: "announcements", label: "System Announcements", desc: "Receive system-wide announcements" },
              { key: "security", label: "Security Notifications", desc: "Get alerts for security-related events" },
            ].map(({ key, label, desc }) => (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <Label className="text-[14px] font-medium text-gray-900">{label}</Label>
                  <p className="text-[12px] text-gray-500">{desc}</p>
                </div>
                <Switch
                  checked={settings?.notifications[key as keyof typeof settings.notifications] ?? true}
                  onCheckedChange={(v) => handleNotificationToggle(key as keyof AppSettings["notifications"], v)}
                />
              </div>
            ))}
            <div className="grid gap-4 border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between"><div><Label className="text-[14px] font-medium text-gray-900">Email notifications</Label><p className="text-[12px] text-gray-500">Use your registered email address.</p></div><Switch checked={emailEnabled} onCheckedChange={setEmailEnabled} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2"><Label className="text-[13px]">Email schedule</Label><Select value={frequency} onValueChange={(value) => setFrequency(value as NotificationFrequency)}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="IMMEDIATE">Immediately</SelectItem><SelectItem value="DAILY">Daily digest</SelectItem><SelectItem value="WEEKLY">Weekly digest</SelectItem><SelectItem value="MONTHLY">Monthly digest</SelectItem></SelectContent></Select></div>
                <div className="grid gap-2"><Label className="text-[13px]">Deadline reminder</Label><Select value={String(deadlineHours)} onValueChange={(value) => setDeadlineHours(Number(value))}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">1 hour before</SelectItem><SelectItem value="3">3 hours before</SelectItem><SelectItem value="6">6 hours before</SelectItem><SelectItem value="24">24 hours before</SelectItem><SelectItem value="72">3 days before</SelectItem></SelectContent></Select></div>
              </div>
              <div className="flex justify-end"><Button size="sm" onClick={() => void saveEmailPreferences()}>Save email preferences</Button></div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-4">
            <CardTitle className="text-[15px] font-semibold text-gray-900">Display Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[14px] font-medium text-gray-900">Default View</Label>
                <p className="text-[12px] text-gray-500">Documents view style</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className={cn("h-8", viewMode === "grid" ? "bg-primary text-white" : "")} onClick={() => handleViewModeChange("grid")}>Grid</Button>
                <Button variant="outline" size="sm" className={cn("h-8", viewMode === "list" ? "bg-primary text-white" : "")} onClick={() => handleViewModeChange("list")}>List</Button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[14px] font-medium text-gray-900">Compact Mode</Label>
                <p className="text-[12px] text-gray-500">Show more items in less space</p>
              </div>
              <Switch checked={compactMode} onCheckedChange={(v) => handleToggle("compactMode", v)} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label className="text-[14px] font-medium text-gray-900">Sidebar Collapsed</Label>
                <p className="text-[12px] text-gray-500">Start with sidebar minimized</p>
              </div>
              <Switch checked={collapsedSidebar} onCheckedChange={(v) => handleToggle("collapsedSidebar", v)} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft lg:col-span-2">
          <CardHeader className="pb-4">
            <CardTitle className="text-[15px] font-semibold text-gray-900">Theme</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { mode: "light" as const, label: "Light", desc: "Light mode interface", icon: Sun, preview: "bg-white border border-border" },
                { mode: "dark" as const, label: "Dark", desc: "Dark mode interface", icon: Moon, preview: "bg-gray-900" },
                { mode: "system" as const, label: "System", desc: "Match system settings", icon: Smartphone, preview: "bg-gradient-to-r from-white to-gray-900 border border-border" },
              ].map(({ mode, label, desc, icon: Icon, preview }) => (
                <button
                  key={mode}
                  onClick={() => setTheme(mode)}
                  className={cn(
                    "p-4 rounded-xl border-2 transition-all text-left",
                    theme === mode
                      ? "border-primary bg-primary-500"
                      : "border-border hover:border-gray-300"
                  )}
                >
                  <div className={cn("w-full h-16 rounded-lg mb-3 flex items-center justify-center", preview)}>
                    <Icon className={cn("w-6 h-6", mode === "dark" ? "text-gray-300" : "text-gray-600")} />
                  </div>
                  <p className="text-[14px] font-medium text-gray-900">{label}</p>
                  <p className="text-[12px] text-gray-500 mt-0.5">{desc}</p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-soft">
          <CardHeader className="pb-4">
            <CardTitle className="text-[15px] font-semibold text-gray-900">About</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[13px] text-gray-500">
            <p><strong className="text-gray-900">URS-DMS</strong> v1.0.0</p>
            <p>University Research Services - Document Management System</p>
            <p>Developed for URS accreditation management</p>
          </CardContent>
        </Card>
      </div>

    </div>
  )
}
