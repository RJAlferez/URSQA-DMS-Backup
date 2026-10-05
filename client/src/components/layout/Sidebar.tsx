import {
  LayoutDashboard,
  FolderArchive,
  Users,
  ClipboardList,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  GraduationCap,
  Inbox,
  ServerCog,
  ScrollText,
  Network,
  FolderTree,
  FileCheck2,
  HardDrive,
  Shield,
  ShieldCheck,
  LogOut,
  GitBranch,
  Sliders,
  Wand2,
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
  { id: "documents", icon: FolderArchive, label: "My Documents" },
  { id: "aaccup", icon: GraduationCap, label: "Accreditation" },
  { id: "requests", icon: Inbox, label: "Requests" },
  { id: "users", icon: Users, label: "User Management" },
  { id: "audit", icon: ClipboardList, label: "Audit Logs" },
  { id: "settings", icon: Settings, label: "Settings" },
]

const rootConsoleItems: SidebarItem[] = [
  { id: "root", icon: ServerCog, label: "Platform Overview" },
  { id: "root-organization", icon: Network, label: "Organization" },
  { id: "root-folder-builder", icon: FolderTree, label: "Folder Builder" },
  { id: "root-requirement-builder", icon: FileCheck2, label: "Requirement Builder" },
  { id: "root-workflow-builder", icon: GitBranch, label: "Workflow Builder" },
  { id: "root-form-builder", icon: ClipboardList, label: "Form Builder" },
  { id: "root-setup-wizard", icon: Wand2, label: "Setup Wizard" },
  { id: "root-config", icon: Sliders, label: "Configuration Engine" },
  { id: "root-maintenance", icon: HardDrive, label: "Storage Maintenance" },
  { id: "root-roles-permissions", icon: Shield, label: "Roles & Permissions" },
  { id: "root-audit", icon: ScrollText, label: "System Audit" },
  { id: "root-users", icon: Users, label: "System Users" },
]

interface SidebarProps {
  collapsed?: boolean
  onToggle?: () => void
  activePage?: string
  onNavigate?: (page: string) => void
  showRoot?: boolean
  className?: string
}

export function Sidebar({ collapsed = false, onToggle, activePage = "dashboard", onNavigate, showRoot = false, className }: SidebarProps) {
  const [rootConsoleOpen, setRootConsoleOpen] = useState(true)
  const { logout, user } = useAuth()
  // Department Coordinators reach the admin portal but do not hold audit.read;
  // hiding the item keeps the UI aligned with the server gate.
  const canViewAudit = hasServerPermission(user, "audit.read")
  const visibleItems = sidebarItems.filter((item) => item.id !== "audit" || canViewAudit)
  const accreditationActive = ["aaccup", "iso", "aaccup-area", "iso-area", "submissions", "tasks"].includes(activePage)
  const [aaccupOpen, setAaccupOpen] = useState(accreditationActive)
  const rootConsoleActive = rootConsoleItems.some((item) => item.id === activePage)
  const rootConsoleHighlighted = rootConsoleActive

  useEffect(() => {
    if (accreditationActive) setAaccupOpen(true)
  }, [accreditationActive])

  // Rule 6: warn before navigating away while uploads are active.
  const handleNavigate = (page: string) => {
    if (!confirmLeaveIfUploading()) return
    onNavigate?.(page)
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
            <Logo size="sm" showText={!collapsed} subtitle="Document System" onDark />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <div className="space-y-1">
            {visibleItems.map((item) => {
              const Icon = item.icon
              const isActive = activePage === item.id
              if (item.id === "aaccup") {
                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      onClick={() => setAaccupOpen((open) => !open)}
                      aria-expanded={!collapsed && aaccupOpen}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-150",
                        accreditationActive ? "bg-primary text-white shadow-lift shadow-primary/30" : "text-slate-300 hover:bg-white/5 hover:text-white",
                      )}
                    >
                      <Icon className={cn("w-[18px] h-[18px] flex-shrink-0", accreditationActive ? "text-white" : "text-slate-400")} />
                      {!collapsed && <span className="flex-1 text-left">Accreditation</span>}
                      {!collapsed && <ChevronDown className={cn("w-4 h-4 transition-transform", !aaccupOpen && "-rotate-90")} />}
                    </button>
                    {!collapsed && aaccupOpen && (
                      <div className="mt-1 ml-5 space-y-1 border-l border-white/10 pl-3">
                        {[
                          { id: "aaccup", label: "AACCUP", icon: GraduationCap },
                          { id: "iso", label: "ISO 21001:2025", icon: ShieldCheck },
                          { id: "submissions", label: "Submissions", icon: FileCheck2 },
                          { id: "tasks", label: "Tasks", icon: ClipboardList },
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
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[14px] font-medium transition-all duration-150",
                      isActive
                        ? "bg-primary text-white shadow-lift shadow-primary/30"
                        : "text-slate-300 hover:bg-white/5 hover:text-white",
                    )}
                  >
                    <Icon className={cn(
                      "w-[18px] h-[18px] flex-shrink-0",
                      isActive ? "text-white" : "text-slate-400",
                    )} />
                  {!collapsed && <span>{item.label}</span>}
                </button>
              )
            })}
            {showRoot && (
              <div className="mt-4 border-t border-white/5 pt-3">
                <button
                  onClick={() => setRootConsoleOpen((open) => !open)}
                  aria-expanded={rootConsoleOpen}
                  className={cn(
                    "w-full h-11 flex items-center gap-3 rounded-xl px-3 text-[14px] font-semibold transition-all duration-150",
                    rootConsoleHighlighted
                      ? "bg-white/10 text-white"
                      : "text-slate-400 hover:bg-white/5 hover:text-white",
                    )}
                >
                  <ServerCog className="h-[18px] w-[18px] flex-shrink-0 text-blue-300" />
                  {!collapsed && <span className="flex-1 text-left">Root Console</span>}
                  {!collapsed && (
                    <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", !rootConsoleOpen && "-rotate-90")} />
                  )}
                </button>
                {(rootConsoleOpen || collapsed) && (
                  <div className={cn("mt-2 space-y-1", !collapsed && "ml-3 border-l-2 border-white/10 pl-2")}>
                    {rootConsoleItems.map((item) => {
                      const Icon = item.icon
                      const isActive = activePage === item.id
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleNavigate(item.id)}
                          className={cn(
                            "w-full flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-150",
                            isActive
                              ? "bg-primary/20 text-white ring-1 ring-primary/40"
                              : "text-slate-400 hover:bg-white/5 hover:text-white",
                            )}
                        >
                          <Icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-blue-300" : "text-slate-500")} />
                          {!collapsed && <span>{item.label}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </nav>

          <div className="space-y-1 border-t border-white/5 px-3 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggle}
            className="w-full justify-start text-slate-300 hover:text-white hover:bg-white/5 px-3">
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
            onClick={() => {
              if (!confirmLeaveIfUploading()) return
              logout()
            }}
            className="w-full justify-start px-3 text-red-300 hover:bg-white/5 hover:text-red-200">
            <LogOut className="h-[18px] w-[18px] flex-shrink-0" />
            {!collapsed && <span className="text-[13px]">Logout</span>}
          </Button>
        </div>
      </div>
    </aside>
  )
}
