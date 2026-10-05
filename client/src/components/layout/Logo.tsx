import { useState, useEffect } from "react"
import { FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import { API_BASE, getAccessToken } from "@/lib/http"

const LOGO_CACHE_KEY = "urs_logo_url"
const LOGO_CACHE_TIME_KEY = "urs_logo_cache_time"
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 min

async function fetchLogoUrl(): Promise<string | null> {
  try {
    const cached = localStorage.getItem(LOGO_CACHE_KEY)
    const cachedAt = localStorage.getItem(LOGO_CACHE_TIME_KEY)
    if (cached && cachedAt && Date.now() - Number(cachedAt) < CACHE_TTL_MS) {
      return cached
    }
    const token = getAccessToken()
    const resp = await fetch(`${API_BASE}/root/setup/logo`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!resp.ok) return null
    const data = await resp.json()
    const url = data?.data?.url ?? null
    if (url) {
      try {
        localStorage.setItem(LOGO_CACHE_KEY, url)
        localStorage.setItem(LOGO_CACHE_TIME_KEY, String(Date.now()))
      } catch {
        // The logo is still usable for this render when storage is unavailable.
      }
    }
    return url
  } catch {
    return null
  }
}

interface LogoProps {
  size?: "sm" | "md" | "lg"
  showText?: boolean
  subtitle?: string
  className?: string
  onDark?: boolean
}

const sizes = {
  sm: "w-8 h-8",
  md: "w-10 h-10",
  lg: "w-12 h-12",
}

export function Logo({ size = "md", showText = true, subtitle, className, onDark = false }: LogoProps) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null)

  useEffect(() => {
    fetchLogoUrl().then(setLogoUrl)
  }, [])

  const sizeClass = sizes[size]

  if (logoUrl) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <div className={cn("rounded-xl bg-white flex items-center justify-center overflow-hidden flex-shrink-0 shadow-navy", sizeClass)}>
          <img src={logoUrl} alt="URS Logo" className="w-full h-full object-contain p-1" />
        </div>
        {showText && (
          <div className="min-w-0">
            <h1 className={cn("text-[15px] font-extrabold tracking-tight truncate", onDark ? "text-white" : "text-gray-900 dark:text-gray-100")}>URS-DMS</h1>
            {subtitle && <p className={cn("text-[11px] font-medium", onDark ? "text-slate-400" : "text-gray-500 dark:text-gray-400")}>{subtitle}</p>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className={cn("rounded-xl flex items-center justify-center flex-shrink-0", onDark ? "bg-white/10" : "bg-primary", sizeClass)}>
        <FileText className={cn(onDark ? "text-blue-300" : "text-white", size === "sm" ? "w-4 h-4" : size === "lg" ? "w-6 h-6" : "w-5 h-5")} />
      </div>
      {showText && (
        <div className="min-w-0">
          <h1 className={cn("text-[15px] font-extrabold tracking-tight truncate", onDark ? "text-white" : "text-gray-900 dark:text-gray-100")}>URS-DMS</h1>
          {subtitle && <p className={cn("text-[11px] font-medium", onDark ? "text-slate-400" : "text-gray-500 dark:text-gray-400")}>{subtitle}</p>}
        </div>
      )}
    </div>
  )
}
