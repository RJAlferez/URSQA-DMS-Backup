import { useEffect } from "react"
import { useAuth } from "@/context/AuthContext"
import { ACTION_FEEDBACK_EVENT, setFeedbackOwner, type ActionFeedback } from "@/lib/actionFeedback"
import { apiPost } from "@/lib/http"
import { toastStore } from "@/lib/toast"
import { notificationService } from "@/services/notifications"

/** Keep operation receipts in the inbox/email queue, retrying after reconnect. */
export function ActionFeedbackBridge() {
  const { user } = useAuth()
  const userId = user?.id
  useEffect(() => {
    setFeedbackOwner(userId ?? null)
    if (!userId) return
    const storageKey = `urs_action_receipts_${userId}`
    let queue: ActionFeedback[] = []
    let active = true
    let sending = false
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
      if (Array.isArray(saved)) queue = saved.filter((item): item is ActionFeedback =>
        item?.ownerId === userId && typeof item.eventId === "string" &&
        typeof item.message === "string" && ["success", "error"].includes(item.outcome),
      ).slice(-100)
    } catch { /* Receipts still work when browser storage is unavailable. */ }
    const save = () => {
      try { localStorage.setItem(storageKey, JSON.stringify(queue.slice(-100))) } catch { /* Keep the in-memory queue. */ }
    }
    const flush = async () => {
      if (sending || !active || !navigator.onLine) return
      sending = true
      let delivered = false
      try {
        while (active && queue.length) {
          const item = queue[0]
          try {
            await apiPost("/notifications/action-results", {
              eventId: item.eventId, outcome: item.outcome, message: item.message,
              ...(/^\/[a-zA-Z0-9/_-]*$/.test(item.actionUrl) ? { actionUrl: item.actionUrl } : {}),
            })
          } catch { break }
          if (!active) break
          queue.shift()
          delivered = true
          save()
        }
      } finally {
        sending = false
        if (active && delivered) {
          void notificationService.refresh()
          void notificationService.refreshUnread()
          window.dispatchEvent(new Event("urs:notifications-updated"))
        }
      }
    }
    const receive = (event: Event) => {
      const result = (event as CustomEvent<ActionFeedback>).detail
      if (!result || result.ownerId !== userId) return
      if (!result.popupShown) toastStore.add({ type: result.outcome, message: result.message }, false)
      if (result.serverRecorded) {
        void notificationService.refresh()
        void notificationService.refreshUnread()
        window.dispatchEvent(new Event("urs:notifications-updated"))
        return
      }
      queue.push(result)
      save()
      void flush()
    }
    const online = () => { void flush() }
    window.addEventListener(ACTION_FEEDBACK_EVENT, receive)
    window.addEventListener("online", online)
    const retry = setInterval(online, 15000)
    void flush()
    return () => {
      active = false
      setFeedbackOwner(null)
      clearInterval(retry)
      window.removeEventListener(ACTION_FEEDBACK_EVENT, receive)
      window.removeEventListener("online", online)
    }
  }, [userId])
  return null
}
