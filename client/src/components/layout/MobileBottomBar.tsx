import {
  LayoutDashboard,
  FolderArchive,
  FolderOpen,
  GraduationCap,
  Bell,
  Inbox,
  User,
  Users,
  Settings,
  ClipboardList,
  Clock,
  Shield,
  Ellipsis,
  ShieldCheck,
  FileText,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import { hasServerPermission } from "@/lib/permissions"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu"

interface BottomTab {
  id: string
  icon: React.ElementType
  label: string
  badge?: number
}

interface MobileBottomBarProps {
  activePage: string
  onNavigate: (page: string) => void
  showRoot?: boolean
  isUser?: boolean
  badges?: Record<string, number>
}

const adminMainTabs: BottomTab[] = [
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "documents", icon: FolderArchive, label: "Documents" },
  { id: "aaccup", icon: GraduationCap, label: "Accreditation" },
  { id: "requests", icon: Inbox, label: "Requests" },
]

const adminMoreTabs: BottomTab[] = [
  { id: "users", icon: Users, label: "User Management" },
  { id: "audit", icon: ClipboardList, label: "Audit Logs" },
  { id: "profile", icon: User, label: "Account" },
  { id: "settings", icon: Settings, label: "Settings" },
]

const rootMoreTabs: BottomTab[] = [
  { id: "root", icon: Shield, label: "Root Console" },
  { id: "root-roles-permissions", icon: Shield, label: "Roles" },
]

const userMainTabs: BottomTab[] = [
  { id: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { id: "documents", icon: FolderOpen, label: "Documents" },
  { id: "aaccup", icon: GraduationCap, label: "Accreditation" },
  { id: "requests", icon: Inbox, label: "Requests" },
]

const userMoreTabs: BottomTab[] = [
  { id: "notifications", icon: Bell, label: "Notifications" },
  { id: "activity", icon: Clock, label: "My Activity" },
  { id: "profile", icon: User, label: "Profile" },
  { id: "settings", icon: Settings, label: "Settings" },
]

export function MobileBottomBar({ activePage, onNavigate, showRoot, isUser: userProp, badges }: MobileBottomBarProps) {
  const { user } = useAuth()
  const canViewAudit = hasServerPermission(user, "audit.read")
  const canViewAccreditation = hasServerPermission(user, "aaccup.read")
  const canUseRequests =
    hasServerPermission(user, "request.create") || hasServerPermission(user, "request.manage")
  const isUser = userProp ?? (!showRoot && activePage !== "users" && activePage !== "audit" && activePage !== "settings")
  const mainTabs = isUser
    ? userMainTabs.filter((tab) => {
        if (tab.id === "aaccup") return canViewAccreditation
        if (tab.id === "requests") return canUseRequests
        return true
      })
    : adminMainTabs
  const moreTabs = isUser
    ? userMoreTabs
    : showRoot
      ? [...adminMoreTabs, ...rootMoreTabs]
      : adminMoreTabs.filter((tab) => tab.id !== "audit" || canViewAudit)
  const isTabActive = (id: string) => {
    if (id === "aaccup") {
       return ["aaccup", "iso", "aaccup-area", "iso-area", "submissions", "tasks"].includes(activePage)
    }
    return id === activePage
  }

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-[#0B1121] border-t border-border dark:border-gray-700 safe-bottom">
      <div className="flex justify-around items-center h-16 px-1">
        {mainTabs.map((tab) => {
          const isActive = isTabActive(tab.id)
          const badgeCount = badges?.[tab.id] ?? 0
          if (tab.id === "aaccup") {
            return (
              <DropdownMenu key={tab.id}>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      "relative flex flex-col items-center justify-center gap-0.5 min-w-0 flex-1 h-full py-1 transition-colors",
                      isActive
                        ? isUser
                          ? "mx-1 my-1 h-full rounded-xl bg-primary text-white shadow-lift shadow-primary/30"
                          : "text-primary dark:text-blue-400"
                        : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300",
                    )}
                  >
                    <tab.icon className="w-5 h-5" />
                    <span className="text-[10px] font-medium leading-none">{tab.label}</span>
                    {badgeCount > 0 && <span className="absolute -top-0.5 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{badgeCount > 99 ? "99+" : badgeCount}</span>}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="top" className="mb-2 w-48">
                   <DropdownMenuItem onClick={() => onNavigate("aaccup")} className={cn("text-[13px] gap-2.5", activePage === "aaccup" && "bg-primary/10 dark:bg-primary/20")}><GraduationCap className="h-4 w-4" />AACCUP</DropdownMenuItem>
                   <DropdownMenuItem onClick={() => onNavigate("iso")} className={cn("text-[13px] gap-2.5", activePage === "iso" && "bg-primary/10 dark:bg-primary/20")}><ShieldCheck className="h-4 w-4" />ISO 21001:2025</DropdownMenuItem>
                   <DropdownMenuItem onClick={() => onNavigate("submissions")} className={cn("text-[13px] gap-2.5", activePage === "submissions" && "bg-primary/10 dark:bg-primary/20")}><FileText className="h-4 w-4" />{isUser ? "My Submissions" : "Submissions"}</DropdownMenuItem>
                   <DropdownMenuItem onClick={() => onNavigate("tasks")} className={cn("text-[13px] gap-2.5", activePage === "tasks" && "bg-primary/10 dark:bg-primary/20")}><ClipboardList className="h-4 w-4" />{isUser ? "My Tasks" : "Tasks"}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          }
          return (
            <button
              key={tab.id}
              onClick={() => onNavigate(tab.id)}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5 min-w-0 flex-1 h-full py-1 transition-colors",
                isActive
                   ? isUser
                     ? "mx-1 my-1 h-full rounded-xl bg-primary text-white shadow-lift shadow-primary/30"
                     : "text-primary dark:text-blue-400"
                   : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300",
              )}
            >
              <tab.icon className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-none">{tab.label}</span>
              {badgeCount > 0 && (
                <span className="absolute -top-0.5 right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </button>
          )
        })}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 min-w-0 flex-1 h-full py-1 transition-colors",
                moreTabs.some((t) => isTabActive(t.id))
                  ? isUser
                    ? "mx-1 my-1 h-full rounded-xl bg-primary text-white shadow-lift shadow-primary/30"
                    : "text-primary dark:text-blue-400"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300",
              )}
            >
              <Ellipsis className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-none">More</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="mb-2 w-48">
            {moreTabs.map((tab) => (
              <DropdownMenuItem
                key={tab.id}
                onClick={() => onNavigate(tab.id)}
                className={cn("text-[13px]", isTabActive(tab.id) && "bg-primary/10 dark:bg-primary/20")}
              >
                <tab.icon className="w-4 h-4 mr-2.5" />
                {tab.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  )
}
