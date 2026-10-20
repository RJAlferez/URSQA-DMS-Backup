export type ActionOutcome = "success" | "error"

export interface ActionFeedback {
  eventId: string
  ownerId: string
  outcome: ActionOutcome
  message: string
  actionUrl: string
  popupShown: boolean
  serverRecorded?: boolean
}

export const ACTION_FEEDBACK_EVENT = "urs:action-feedback"
let ownerId: string | null = null
const pending = new Map<string, { feedback: ActionFeedback; timer: ReturnType<typeof setTimeout> }>()

export function setFeedbackOwner(id: string | null) { ownerId = id }

function safeMessage(message: string) {
  return message.replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, "$1[redacted]").slice(0, 1000)
}

function receiptId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function enqueue(outcome: ActionOutcome, message: string, popupShown: boolean, serverRecorded = false) {
  if (!ownerId || typeof window === "undefined") return
  const feedback: ActionFeedback = {
    eventId: receiptId(), ownerId, outcome,
    message: safeMessage(message),
    actionUrl: window.location.pathname.slice(0, 300), popupShown, serverRecorded,
  }
  const timer = setTimeout(() => {
    pending.delete(feedback.eventId)
    window.dispatchEvent(new CustomEvent<ActionFeedback>(ACTION_FEEDBACK_EVENT, { detail: feedback }))
  }, 250)
  pending.set(feedback.eventId, { feedback, timer })
}

/** An explicit UI message replaces the nearby transport fallback. */
export function captureActionToast(outcome: ActionOutcome, message: string) {
  const waiting = [...pending.values()].reverse().find((item) => item.feedback.ownerId === ownerId && item.feedback.outcome === outcome && !item.feedback.popupShown)
  if (waiting) {
    waiting.feedback.message = safeMessage(message)
    waiting.feedback.popupShown = true
  } else {
    enqueue(outcome, message, true)
  }
}

export function recordRequestAction(method: string, path: string, outcome: ActionOutcome, error?: string) {
  if (method === "GET" || /^\/(notifications|auth|assistant)(\/|\?|$)/.test(path)) return
  if (outcome === "success" && /\/documents\/[^/]+\/versions\/[^/]+\/verify$/.test(path)) {
    enqueue("success", "File uploaded successfully.", false, true)
    return
  }
  if (outcome === "success" && (path === "/documents" || /\/(version|verify|validate-upload|upload-url|presign)(?:\?|$)/.test(path))) return
  const operation = path.split("?")[0].split("/").filter(Boolean).pop()
  const message = outcome === "error" ? (error || "The action failed. Please try again.")
    : operation === "unsubmit" ? "Work unsubmitted. Your admin has been notified."
    : path === "/aaccup/submissions" ? "Evidence submitted for admin approval."
    : operation === "review" ? "Submission review saved."
    : method === "DELETE" ? "Item removed successfully."
    : method === "PATCH" ? "Changes saved successfully."
    : "Action completed successfully."
  enqueue(outcome, message, false)
}

export function recordClientAction(outcome: ActionOutcome, message: string) {
  enqueue(outcome, message, false)
}
