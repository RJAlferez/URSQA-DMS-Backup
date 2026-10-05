import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

export type ThemeMode = "light" | "dark" | "system"

const THEME_KEY = "urs_dms_theme"

function getSystemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
}

function resolveDark(mode: ThemeMode): boolean {
  return mode === "dark" || (mode === "system" && getSystemDark())
}

function storedTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === "light" || saved === "dark" || saved === "system") return saved
  } catch {
    // Use the light theme when browser storage is unavailable.
  }
  return "light"
}

function applyTheme(mode: ThemeMode) {
  const dark = resolveDark(mode)
  document.documentElement.classList.toggle("dark", dark)
  document.documentElement.style.colorScheme = dark ? "dark" : "light"
}

interface ThemeContextValue {
  theme: ThemeMode
  setTheme: (mode: ThemeMode) => void
  isDark: boolean
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
  isDark: false,
})

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(storedTheme)
  const [isDark, setIsDark] = useState(() => resolveDark(storedTheme()))

  useEffect(() => {
    applyTheme(theme)
    if (theme !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setIsDark(resolveDark("system"))
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = (mode: ThemeMode) => {
    setThemeState(mode)
    setIsDark(resolveDark(mode))
    try {
      localStorage.setItem(THEME_KEY, mode)
    } catch {
      // Theme state remains active for the current tab when storage fails.
    }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, isDark }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
