import { Search, User, LogOut, Settings, ChevronDown, Bell, Command, FilePlus, Upload, GraduationCap } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { useAvatar } from "@/lib/avatar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/Avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { QuickActionButton } from "@/components/layout/QuickActionButton"

interface UserTopNavProps {
  onNavigate?: (page: string) => void
  onOpenCommandPalette?: () => void
  unreadNotifications?: number
}

export function UserTopNav({ onNavigate, onOpenCommandPalette, unreadNotifications = 0 }: UserTopNavProps) {
  const { user, logout } = useAuth()
  const { url: avatarUrl } = useAvatar(user?.id)

  const getInitials = (name: string) => {
    return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
  }

  const getRoleLabel = (role: string) => {
    const labels: Record<string, string> = {
      super_admin: "System Administrator",
      qa_office: "QA Office",
      department_head: "Department Head",
      faculty: "Faculty",
      staff: "Staff",
      student: "Student",
    }
    return labels[role] ?? "User"
  }

  return (
    <header className="h-16 bg-white/80 dark:bg-[#0B1121]/90 backdrop-blur-md border-b border-border dark:border-gray-800 flex-shrink-0">
      <div className="flex items-center justify-between h-full navbar-responsive">
        <div className="flex-1 max-w-xl">
          <button
            onClick={onOpenCommandPalette}
            className="w-full max-w-md group"
          >
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 group-focus-within:text-primary-500 transition-colors pointer-events-none" />
              <Input
                placeholder="Search documents, users, pages..."
                className="pl-10 pr-16 bg-navy-50/50 border-0 hover:bg-navy-50 focus:bg-white focus:ring-1.5 focus:ring-primary/25 transition-all text-[14px] cursor-pointer dark:bg-gray-800/60 dark:hover:bg-gray-800 dark:focus:bg-gray-800"
                readOnly
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
                <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-white px-1.5 font-mono text-[10px] font-medium text-gray-400 shadow-soft dark:border-gray-600 dark:bg-gray-800">
                  <Command className="w-2.5 h-2.5" />
                </kbd>
                <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-border bg-white px-1 font-mono text-[10px] font-medium text-gray-400 shadow-soft dark:border-gray-600 dark:bg-gray-800">
                  K
                </kbd>
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <QuickActionButton onNavigate={onNavigate} actions={[
            {
              label: "Request Files",
              icon: FilePlus,
              description: "Browse archive and request files",
              route: "/user/requests",
              page: "requests",
            },
            {
              label: "Upload Document",
              icon: Upload,
              description: "Open My Documents",
              route: "/user/documents",
              page: "documents",
            },
            {
              label: "Browse AACCUP",
              icon: GraduationCap,
              description: "Open AACCUP requirements",
              route: "/user/aaccup",
              page: "aaccup",
            },
          ]} />

          <Button
            variant="ghost"
            size="icon"
            className="relative h-10 w-10"
            onClick={() => onNavigate?.("notifications")}
          >
            <Bell className="w-4 h-4 text-gray-500" />
            {unreadNotifications > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unreadNotifications > 99 ? "99+" : unreadNotifications}
              </span>
            )}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2.5 p-1.5 pr-3 rounded-xl hover:bg-navy-50 transition-colors ml-1 dark:hover:bg-gray-800">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={avatarUrl ?? (user?.avatarSeed ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.avatarSeed}` : undefined)} />
                  <AvatarFallback className="bg-primary-50 text-primary-700 text-[12px] font-semibold dark:bg-gray-700 dark:text-slate-200">
                    {user?.name ? getInitials(user.name) : "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden md:block text-left">
                  <p className="text-[13px] font-semibold text-gray-900">{user?.name || "User"}</p>
                  <p className="text-[11px] text-gray-500">{user?.role ? getRoleLabel(user.role) : "User"}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 mt-1.5">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                  <p className="text-xs text-gray-500">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[13px]" onClick={() => onNavigate?.("profile")}>
                <User className="mr-2.5 w-4 h-4" />
                My Profile
              </DropdownMenuItem>
              <DropdownMenuItem className="text-[13px]" onClick={() => onNavigate?.("settings")}>
                <Settings className="mr-2.5 w-4 h-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[13px] text-red-600 cursor-pointer" onClick={logout}>
                <LogOut className="mr-2.5 w-4 h-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}