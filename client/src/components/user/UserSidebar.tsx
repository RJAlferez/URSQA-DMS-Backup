import {
  LayoutDashboard,
  FolderOpen,
  FileText,
  GraduationCap,
  Bell,
  User,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Activity,
  ChevronDown,
  ShieldCheck,
  ClipboardList,
} from "lucide-react"
import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"
import { confirmLeaveIfUploading } from "@/lib/uploadBus"
import { Button } from "@/components/ui/Button"
import { Logo } from "@/components/layout/Logo"
import { useAuth } from "@/context/AuthContext"
import { hasServerPermission } from "@/lib/permissions"

interface SidebarItem {
  id: string
  icon: React.ElementType
  label: string
}

const sidebarItems: SidebarItem[] = [
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "documents", icon: FolderOpen, label: "My Documents" },
  { id: "requests", icon: FileText, label: "My Requests" },
  { id: "aaccup", icon: GraduationCap, label: "Accreditation" },
  { id: "notifications", icon: Bell, label: "Notifications" },
  { id: "activity", icon: Activity, label: "My Activity" },
  { id: "profile", icon: User, label: "Profile" },
  { id: "settings", icon: Settings, label: "Settings" },
]

interface UserSidebarProps {
  collapsed?: boolean
  onToggle?: () => void
  activePage?: string
  onNavigate?: (page: string) => void
  onLogout?: () => void
  unreadNotifications?: number
  attention?: { returned: number; tasks: number; requests: number; documents: number }
  className?: string
}

export function UserSidebar({
  collapsed = false,
  onToggle,
  activePage = "dashboard",
  onNavigate,
  onLogout,
  unreadNotifications = 0,
  attention,
  className,
}: UserSidebarProps) {
  const { logout, user } = useAuth()
  // READ_ONLY accounts hold neither aaccup.* nor request.* permissions; showing
  // those items would only lead to 403s and PERMISSION_DENIED audit noise.
  const canViewAccreditation = hasServerPermission(user, "aaccup.read")
  const canUseRequests =
    hasServerPermission(user, "request.create") || hasServerPermission(user, "request.manage")
  const visibleItems = sidebarItems.filter((item) => {
    if (item.id === "aaccup") return canViewAccreditation
    if (item.id === "requests") return canUseRequests
    return true
  })
  const accreditationActive = ["aaccup", "iso", "submissions", "tasks"].includes(activePage)
  const [aaccupOpen, setAaccupOpen] = useState(accreditationActive)
  const activeNavPage = accreditationActive
    ? "aaccup"
    : activePage

  useEffect(() => {
    if (accreditationActive) setAaccupOpen(true)
  }, [accreditationActive])

  // Rule 6: warn before navigating away while uploads are active.
  const handleNavigate = (page: string) => {
    if (!confirmLeaveIfUploading()) return
    onNavigate?.(page)
  }

  const handleLogout = () => {
    if (!confirmLeaveIfUploading()) return
    logout()
    onLogout?.()
  }

  return (
    <aside
      className={cn(
        "h-screen bg-gradient-to-b from-navy-900 to-navy-950 border-r border-white/5 transition-all duration-300 flex-shrink-0",
        collapsed ? "w-20" : "w-64",
        className,
      )}
    >
      <div className="flex flex-col h-full">
        <div className={cn(
          "flex items-center border-b border-white/5",
          collapsed ? "justify-center px-5 py-5" : "justify-between px-5 py-5"
        )}>
          <button
            onClick={() => handleNavigate("dashboard")}
            className="hover:opacity-90 transition-opacity"
          >
            <Logo size="sm" showText={!collapsed} subtitle="User Portal" onDark />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <div className="space-y-1">
            {visibleItems.map((item) => {
              const Icon = item.icon
              const isActive = activeNavPage === item.id
              if (item.id === "aaccup") {
                const badgeCount = attention ? attention.returned + attention.tasks : 0
                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      onClick={() => setAaccupOpen((open) => !open)}
                      aria-expanded={!collapsed && aaccupOpen}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-150 relative",
                        accreditationActive ? "bg-primary text-white shadow-lift shadow-primary/30" : "text-slate-300 hover:bg-white/5 hover:text-white",
                        collapsed && "justify-center",
                      )}
                    >
                      <Icon className={cn("w-[18px] h-[18px] flex-shrink-0", accreditationActive ? "text-white" : "text-slate-400")} />
                       {!collapsed && <span className="flex-1 text-left">Accreditation</span>}
                      {badgeCount > 0 && !collapsed && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{badgeCount > 99 ? "99+" : badgeCount}</span>}
                      {!collapsed && <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", !aaccupOpen && "-rotate-90")} />}
                    </button>
                    {!collapsed && aaccupOpen && (
                      <div className="mt-1 ml-5 space-y-1 border-l border-white/10 pl-3">
                        {[
                          { id: "tasks", label: "My Tasks", icon: ClipboardList },
                          { id: "submissions", label: "My Submissions", icon: FileText },
                          { id: "aaccup", label: "AACCUP", icon: GraduationCap },
                          { id: "iso", label: "ISO 21001:2025", icon: ShieldCheck },
                        ].map((child) => {
                          const ChildIcon = child.icon
                          return (
                            <button
                              key={child.id}
                              type="button"
                              onClick={() => handleNavigate(child.id)}
                              className={cn(
                                "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors",
                                activePage === child.id ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5 hover:text-white",
                              )}
                            >
                              <ChildIcon className={cn("w-4 h-4 flex-shrink-0", activePage === child.id ? "text-blue-300" : "text-slate-500")} />
                              {child.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              }
              let badgeCount = 0
              if (item.id === "notifications") badgeCount = unreadNotifications
              else if (item.id === "aaccup" && attention) badgeCount = attention.returned + attention.tasks
              else if (item.id === "requests" && attention) badgeCount = attention.requests
              else if (item.id === "documents" && attention) badgeCount = attention.documents
              const showBadge = badgeCount > 0

              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-150 relative",
                    isActive
                      ? "bg-primary text-white shadow-lift shadow-primary/30"
                      : "text-slate-300 hover:bg-white/5 hover:text-white",
                    collapsed && "justify-center"
                  )}
                >
                  <Icon className={cn("w-[18px] h-[18px] flex-shrink-0", isActive ? "text-white" : "text-slate-400")} />
                  {!collapsed && <span>{item.label}</span>}
                  {showBadge && !collapsed && (
                    <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                      {badgeCount > 99 ? "99+" : badgeCount}
                    </span>
                  )}
                  {showBadge && collapsed && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />
                  )}
                </button>
              )
            })}
          </div>
        </nav>

        <div className="px-3 py-4 border-t border-white/5 space-y-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className={cn(
              "w-full justify-start text-slate-300 hover:text-white hover:bg-white/5 px-3",
              collapsed && "justify-center px-2"
            )}
          >
            {collapsed ? (
              <ChevronRight className="w-[18px] h-[18px]" />
            ) : (
              <>
                <ChevronLeft className="w-[18px] h-[18px] mr-2.5" />
                <span className="text-[13px]">Collapse</span>
              </>
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className={cn(
              "w-full justify-start text-red-300 hover:text-red-200 hover:bg-white/5 px-3",
              collapsed && "justify-center px-2"
            )}
          >
            <LogOut className={cn("w-[18px] h-[18px] flex-shrink-0", !collapsed && "mr-2.5")} />
            {!collapsed && <span className="text-[13px]">Logout</span>}
          </Button>
        </div>
      </div>
    </aside>
  )
}
