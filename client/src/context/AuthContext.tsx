import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import { authService, type AuthStatus } from "@/services/auth"
import { confirmLeaveIfUploading } from "@/lib/uploadBus"
import type { User, UserRole } from "@/types/domain"

interface AuthContextType {
  isAuthenticated: boolean
  isLoading: boolean
  authStatus: AuthStatus
  user: User | null
  login: (email: string, password: string) => Promise<{ success: boolean; role?: UserRole; error?: string }>
  logout: () => Promise<void>
  rememberMe: boolean
  setRememberMe: (value: boolean) => void
  init: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const REMEMBER_ME_KEY = "urs_dms_remember_me"

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [authStatus, setAuthStatus] = useState<AuthStatus>("INITIALIZING")
  const [rememberMe, setRememberMe] = useState(false)
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem(REMEMBER_ME_KEY)
    if (stored === "true") setRememberMe(true)
    authService.init().then(() => {
      const state = authService.getState()
      setIsAuthenticated(state.isAuthenticated)
      setIsLoading(false)
      setAuthStatus(state.authStatus)
      if (state.user) setUser(state.user)
      else setIsLoading(false)
    })
  }, [])

  useEffect(() => {
    const unsub = authService.subscribe((state) => {
      setIsAuthenticated(state.isAuthenticated)
      setIsLoading(state.isLoading)
      setAuthStatus(state.authStatus)
      setUser(state.user as User | null)
    })
    // Expired session (refresh failed): force local logout so protected
    // routes redirect to the login screen (Sprint 7.8 acceptance).
    const onSessionExpired = () => {
      void authService.logout()
    }
    window.addEventListener("urs:session-expired", onSessionExpired)
    return () => {
      unsub()
      window.removeEventListener("urs:session-expired", onSessionExpired)
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const result = await authService.login(email, password)
    if (result.success && result.user) {
      if (rememberMe) {
        localStorage.setItem(REMEMBER_ME_KEY, "true")
      }
      return { success: true, role: result.user.role }
    }
    return { success: false, error: result.error }
  }, [rememberMe])

  const logout = useCallback(async () => {
    // Rule 6: warn when uploads are still active before logging out.
    if (!confirmLeaveIfUploading()) return
    await authService.logout()
    // Never restore another account's last page after a re-login (e.g. a ROOT
    // page restored for a plain administrator, which would fire /root/* calls
    // that 403 and write PERMISSION_DENIED audit events).
    localStorage.removeItem("activePage")
    if (!rememberMe) {
      localStorage.removeItem(REMEMBER_ME_KEY)
    }
  }, [rememberMe])

  const handleSetRememberMe = useCallback((value: boolean) => {
    setRememberMe(value)
    if (value) {
      localStorage.setItem(REMEMBER_ME_KEY, "true")
    } else {
      localStorage.removeItem(REMEMBER_ME_KEY)
    }
  }, [])

  const init = useCallback(async () => {
    setIsLoading(true)
    await authService.init()
    const state = authService.getState()
    setIsAuthenticated(state.isAuthenticated)
    setUser(state.user as User | null)
    setAuthStatus(state.authStatus)
    setIsLoading(false)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isLoading,
        authStatus,
        user,
        login,
        logout,
        rememberMe,
        setRememberMe: handleSetRememberMe,
        init,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}
