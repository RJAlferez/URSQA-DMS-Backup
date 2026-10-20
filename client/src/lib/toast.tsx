import { useEffect, useState, useCallback } from "react"
import { captureActionToast } from "@/lib/actionFeedback"
import { CheckCircle, AlertTriangle, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useAuth } from "@/context/AuthContext"
import { isAdminRole } from "@/lib/permissions"

export type ToastType = "success" | "error" | "info" | "warning"

export interface ToastMessage {
  id: string
  type: ToastType
  message: string
  duration?: number
}

type Listener = (toasts: ToastMessage[]) => void

class ToastStore {
  private listeners: Set<Listener> = new Set()
  private toasts: ToastMessage[] = []

  subscribe(l: Listener): () => void {
    this.listeners.add(l)
    l(this.toasts)
    return () => this.listeners.delete(l)
  }

  private emit() {
    this.listeners.forEach((l) => l(this.toasts))
  }

  add(toast: Omit<ToastMessage, "id">, report = true): string {
    const duplicate = this.toasts.find((item) => item.type === toast.type && item.message === toast.message)
    if (duplicate) return duplicate.id
    if (report && (toast.type === "success" || toast.type === "error")) captureActionToast(toast.type, toast.message)
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const item: ToastMessage = { ...toast, id, duration: toast.duration ?? (toast.type === "error" ? 7000 : 4000) }
    this.toasts = [...this.toasts, item]
    this.emit()
    if (item.duration && item.duration > 0) {
      setTimeout(() => this.dismiss(id), item.duration)
    }
    return id
  }

  dismiss(id: string) {
    this.toasts = this.toasts.filter((t) => t.id !== id)
    this.emit()
  }

  success(message: string, duration?: number) {
    return this.add({ type: "success", message, duration: duration ?? 4000 })
  }
  error(message: string, duration?: number) {
    return this.add({ type: "error", message, duration })
  }
  info(message: string, duration?: number) {
    return this.add({ type: "info", message, duration })
  }
  warning(message: string, duration?: number) {
    return this.add({ type: "warning", message, duration })
  }
}

export const toastStore = new ToastStore()

export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  useEffect(() => toastStore.subscribe(setToasts), [])
  return {
    toasts,
    success: useCallback((m: string, d?: number) => toastStore.success(m, d), []),
    error: useCallback((m: string, d?: number) => toastStore.error(m, d), []),
    info: useCallback((m: string, d?: number) => toastStore.info(m, d), []),
    warning: useCallback((m: string, d?: number) => toastStore.warning(m, d), []),
    dismiss: useCallback((id: string) => toastStore.dismiss(id), []),
  }
}

const palette: Record<ToastType, { bg: string; border: string; text: string; Icon: typeof CheckCircle }> = {
  success: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-800",
    Icon: CheckCircle,
  },
  error: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-800",
    Icon: AlertTriangle,
  },
  warning: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-800",
    Icon: AlertTriangle,
  },
  info: {
    bg: "bg-primary-50",
    border: "border-blue-200",
    text: "text-blue-800",
    Icon: Info,
  },
}

export function ToastContainer() {
  const { toasts, dismiss } = useToasts()
  const { user } = useAuth()
  const adminToast = isAdminRole(user?.role)

  if (toasts.length === 0) return null

  return (
    <div className={cn("fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2", adminToast && "admin-toast-container")}>
      {toasts.map((t) => {
        const { bg, border, text, Icon } = palette[t.type]
        const iconColor =
          t.type === "success"
            ? "text-emerald-600"
            : t.type === "error"
              ? "text-red-600"
              : t.type === "warning"
                ? "text-amber-600"
                : "text-primary-600"
        return (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            className={cn(
              "flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg animate-in slide-in-from-bottom-2",
              adminToast && "admin-toast",
              bg,
              border,
              text
            )}
          >
            <Icon className={cn("w-5 h-5 flex-shrink-0", iconColor)} />
            <span className="text-[14px] font-medium flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="hover:opacity-70">
              <X className="w-4 h-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export const toast = {
  success: (m: string, d?: number) => toastStore.success(m, d),
  error: (m: string, d?: number) => toastStore.error(m, d),
  info: (m: string, d?: number) => toastStore.info(m, d),
  warning: (m: string, d?: number) => toastStore.warning(m, d),
}
