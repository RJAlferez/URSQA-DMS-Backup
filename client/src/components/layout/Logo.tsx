import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { API_BASE, getAccessToken } from "@/lib/http"

const LOGO_CACHE_KEY = "urs_logo_url"
const LOGO_CACHE_TIME_KEY = "urs_logo_cache_time"
const CACHE_TTL_MS = 30 * 60 * 1000 // 30 min
const UNIVERSITY_LOGO_URL = "/urs-university-seal-transparent.png"

async function fetchLogoUrl(): Promise<string | null> {
  try {
    const token = getAccessToken()
    if (!token) return null
    const cached = localStorage.getItem(LOGO_CACHE_KEY)
    const cachedAt = localStorage.getItem(LOGO_CACHE_TIME_KEY)
    if (cached && cachedAt && Date.now() - Number(cachedAt) < CACHE_TTL_MS) {
      return cached
    }
    const resp = await fetch(`${API_BASE}/root/setup/logo`, {
      headers: { Authorization: `Bearer ${token}` },
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
  lg: "w-16 h-16",
}

export function Logo({ size = "md", showText = true, subtitle, className, onDark = false }: LogoProps) {
  const [logoUrl, setLogoUrl] = useState(UNIVERSITY_LOGO_URL)

  useEffect(() => {
    let active = true
    fetchLogoUrl().then((url) => {
      if (active && url) setLogoUrl(url)
    })
    return () => { active = false }
  }, [])

  const sizeClass = sizes[size]

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className={cn("flex items-center justify-center flex-shrink-0", sizeClass)}>
        <img
          src={logoUrl}
          alt="University of Rizal System logo"
          className={cn("w-full h-full object-contain", logoUrl === UNIVERSITY_LOGO_URL && "scale-[1.4]")}
          onError={() => {
            if (logoUrl === UNIVERSITY_LOGO_URL) return
            setLogoUrl(UNIVERSITY_LOGO_URL)
            try {
              localStorage.removeItem(LOGO_CACHE_KEY)
              localStorage.removeItem(LOGO_CACHE_TIME_KEY)
            } catch {
              // Keep the local university seal when storage is unavailable.
            }
          }}
        />
      </div>
      {showText && (
        <div className="min-w-0">
          <h1 className={cn("text-[15px] font-extrabold tracking-tight truncate", onDark ? "text-white" : "text-gray-900 dark:text-gray-100")}>URS-QA DMS</h1>
          {subtitle && <p className={cn("text-[11px] font-medium", onDark ? "text-slate-400" : "text-gray-500 dark:text-gray-400")}>{subtitle}</p>}
        </div>
      )}
    </div>
  )
}
