import type { User, UserRole, ServerUser, UserSession } from "@/types/domain"
import { apiGet, apiPost, apiPatch, getAccessToken, clearServerToken, setServerToken, ApiRequestError } from "@/lib/http"

export type AuthStatus = "INITIALIZING" | "AUTHENTICATED" | "UNAUTHENTICATED"

interface AuthState {
  isLoading: boolean
  isAuthenticated: boolean
  user: User | null
  token: string | null
  authStatus: AuthStatus
}

type AuthListener = (state: AuthState) => void

const ROLE_MAP: Record<string, UserRole> = {
  ROOT: "root",
  ADMINISTRATOR: "super_admin",
  QUALITY_ASSURANCE_OFFICER: "qa_office",
  DEPARTMENT_COORDINATOR: "department_head",
  FACULTY: "faculty",
  STAFF: "staff",
  READ_ONLY: "student",
}

// Map server auth errors to precise, non-leaky user-facing messages. The
// previous implementation always showed "Invalid email or password", hiding
// lockouts, deactivated accounts and rate limiting.
function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    switch (err.code) {
      case "ACCOUNT_LOCKED":
        return "Your account is temporarily locked after too many failed attempts. Please try again later."
      case "ACCOUNT_INACTIVE":
        return "This account is not active. Contact your administrator."
      case "RATE_LIMITED":
        return "Too many sign-in attempts. Please wait a few minutes and try again."
      case "VALIDATION_ERROR":
        return err.message
      default:
        return "Invalid email or password. Please try again."
    }
  }
  return "Invalid email or password. Please try again."
}

export function toClientUser(server: ServerUser): User {
  const role = ROLE_MAP[server.role] ?? "staff"
  const createdAt = "createdAt" in server ? (server as unknown as { createdAt?: string }).createdAt : undefined
  return {
    id: server.id,
    name: [server.firstName, server.middleName, server.lastName, server.suffix]
      .filter(Boolean)
      .join(" ")
      .trim(),
    email: server.email,
    role,
    department: server.departmentName ?? server.departmentId ?? "",
    departmentId: server.departmentId ?? undefined,
    status: server.status === "ACTIVE" ? "Active" : "Inactive",
    memberSince: createdAt ?? new Date().toISOString(),
    lastLogin: server.lastLogin ?? undefined,
    createdAt: createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    permissions: server.permissions,
    avatarSeed: server.profilePhotoKey ?? undefined,
  }
}

class AuthService {
  private state: AuthState = {
    isLoading: true,
    isAuthenticated: false,
    user: null,
    token: null,
    authStatus: "INITIALIZING",
  }
  private listeners: Set<AuthListener> = new Set()
  private initialized = false

  subscribe(fn: AuthListener): () => void {
    this.listeners.add(fn)
    fn(this.state)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.listeners.forEach((l) => l(this.state))
  }

  private update(patch: Partial<AuthState>) {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  async init(): Promise<void> {
    if (this.initialized) return
    this.initialized = true

    if (!getAccessToken()) {
      this.update({ isLoading: false, isAuthenticated: false, user: null, token: null, authStatus: "UNAUTHENTICATED" })
      return
    }

    try {
      const server = await apiGet<ServerUser>("/auth/me")
      this.update({
        isLoading: false,
        isAuthenticated: true,
        user: toClientUser(server),
        token: getAccessToken(),
        authStatus: "AUTHENTICATED",
      })
    } catch {
      clearServerToken()
      this.update({ isLoading: false, isAuthenticated: false, user: null, token: null, authStatus: "UNAUTHENTICATED" })
    }
  }

  async login(email: string, password: string): Promise<{ success: boolean; user?: User; error?: string }> {
    // In-flight guard: state is mutated synchronously, so a rapid double
    // submit can never create two sessions / two auth.login.success events,
    // even if React has not yet re-rendered the disabled button.
    if (this.state.isLoading) {
      return { success: false, error: "A sign-in is already in progress." }
    }
    this.update({ isLoading: true })
    try {
      const data = await apiPost<{ accessToken: string; user: ServerUser }>("/auth/login", {
        identifier: email,
        password,
      })
      setServerToken(data.accessToken)
      const user = toClientUser(data.user)
      this.update({ isLoading: false, isAuthenticated: true, user, token: data.accessToken, authStatus: "AUTHENTICATED" })
      return { success: true, user }
    } catch (err) {
      this.update({ isLoading: false, isAuthenticated: false, user: null, token: null, authStatus: "UNAUTHENTICATED" })
      return { success: false, error: loginErrorMessage(err) }
    }
  }

  async logout(): Promise<void> {
    try {
      await apiPost<{ success: true }>("/auth/logout", {})
    } catch {
      // Logout is idempotent; local token removal must still happen.
    } finally {
      clearServerToken()
    }
    this.update({ isAuthenticated: false, user: null, token: null, authStatus: "UNAUTHENTICATED" })
  }

  async forgotPassword(email: string): Promise<{ success: boolean; message: string }> {
    try {
      const data = await apiPost<{ message: string }>("/auth/forgot-password", { email })
      return { success: true, message: data.message }
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Could not send the reset email. Please try again.",
      }
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
      await apiPost<{ success: true }>("/auth/reset-password", { token, newPassword })
      // The reset revoked every session; clear local tokens so the app
      // returns to the login screen.
      clearServerToken()
      this.update({ isAuthenticated: false, user: null, token: null, authStatus: "UNAUTHENTICATED" })
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Password reset failed. Please try again.",
      }
    }
  }

  async me(): Promise<User | null> {
    if (!this.state.user) return null
    try {
      const server = await apiGet<ServerUser>("/auth/me")
      const user = toClientUser(server)
      this.update({ user, authStatus: "AUTHENTICATED" })
      return user
    } catch {
      return this.state.user
    }
  }

  async updateProfile(patch: {
    firstName?: string
    middleName?: string | null
    lastName?: string
    suffix?: string | null
  }): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
      const server = await apiPatch<ServerUser>("/users/me", patch)
      const user = toClientUser(server)
      this.update({ user, authStatus: "AUTHENTICATED" })
      return { success: true, user }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to update profile",
      }
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    try {
      await apiPost<{ success: true }>("/auth/change-password", {
        currentPassword,
        newPassword,
      })
      return { success: true }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Password change failed",
      }
    }
  }
  getCurrentUser(): User | null {
    return this.state.user
  }
  getState(): AuthState {
    return this.state
  }

  async getUserSessions(): Promise<UserSession[]> {
    const data = await apiGet<{ sessions: Array<{
      id: string
      device: string | null
      browser: string | null
      ipAddress: string | null
      createdAt: string
      expiresAt: string
      current: boolean
    }> }>("/auth/sessions")
    return data.sessions.map((s) => ({
      id: s.id,
      userId: this.state.user?.id ?? "",
      token: "",
      device: s.device ?? "Unknown device",
      browser: s.browser ?? "Unknown browser",
      os: "",
      ipAddress: s.ipAddress ?? "",
      location: "",
      lastActive: s.createdAt,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      current: s.current,
    }))
  }

  async killSession(sessionId: string): Promise<void> {
    await apiPost<{ success: true }>(`/auth/sessions/${encodeURIComponent(sessionId)}/kill`)
  }

  async killAllOtherSessions(): Promise<number> {
    const data = await apiPost<{ success: true; revoked: number }>("/auth/sessions/kill-all")
    return data.revoked ?? 0
  }

  async meRaw(): Promise<ServerUser> {
    return apiGet<ServerUser>("/auth/me")
  }
}

export const authService = new AuthService()
