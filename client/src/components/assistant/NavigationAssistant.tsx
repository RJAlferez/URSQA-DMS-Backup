import { useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Bot, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { apiPost, ApiRequestError } from "@/lib/http"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/Button"
import { Textarea } from "@/components/ui/Textarea"

type AssistantMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  pending?: boolean
  actions?: AssistantAction[]
}

type AssistantActionTarget = "DASHBOARD" | "MY_DOCUMENTS" | "MY_REQUESTS" | "REQUESTS" | "AACCUP" | "ISO" | "NOTIFICATIONS" | "MY_ACTIVITY" | "PROFILE" | "SETTINGS" | "USER_MANAGEMENT" | "AUDIT_LOGS" | "ORGANIZATION" | "ROOT_CONSOLE" | "ROLES_PERMISSIONS"
type AssistantAction = { label: string; target: AssistantActionTarget }

const WELCOME = "Hi! I can help you navigate URS-QA DMS. Ask me where to find a feature or how to use a page."
const MAX_MESSAGE_LENGTH = 1000

const suggestions = {
  user: [
    "How do I upload a document?",
    "Where are my requests?",
    "How do I submit to AACCUP?",
    "Where can I find ISO?",
  ],
  admin: [
    "Where can I review submissions?",
    "How do I open an Area?",
    "Where are Audit Logs?",
    "How do I manage users?",
  ],
  root: [
    "Where can I add a department?",
    "Where is Roles & Permissions?",
    "How do I open System Audit?",
    "Where is Organization?",
  ],
} as const

function assistantAudience(role?: string): keyof typeof suggestions {
  if (role === "root") return "root"
  if (role === "super_admin" || role === "qa_office" || role === "department_head") return "admin"
  return "user"
}

function welcomeFor(audience: keyof typeof suggestions): string {
  if (audience === "root") return "I can help you navigate URS-QA DMS and Root Console features."
  if (audience === "admin") return "I can help you navigate submissions, accreditation areas, requests, users, and audit tools."
  return "I can help you with My Documents, My Requests, AACCUP/ISO, Notifications, and other User Portal features."
}

function renderAssistantContent(content: string) {
  return content.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`} className="font-bold">{part.slice(2, -2)}</strong>
    }
    return <span key={`${part}-${index}`}>{part}</span>
  })
}

export function NavigationAssistant() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const audience = assistantAudience(user?.role)
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<AssistantMessage[]>([
    { id: "welcome", role: "assistant", content: `${WELCOME}\n\n${welcomeFor(audience)}` },
  ])
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages([{ id: `welcome-${user?.id ?? "guest"}`, role: "assistant", content: `${WELCOME}\n\n${welcomeFor(audience)}` }])
    setInput("")
    setSending(false)
    setOpen(false)
  }, [user?.id, audience])

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, open])

  const sendMessage = async (message = input) => {
    const content = message.trim()
    if (!content || sending || content.length > MAX_MESSAGE_LENGTH) return
    setInput("")
    const requestId = `assistant-${Date.now()}`
    const pendingId = `${requestId}-pending`
    setMessages((current) => [
      ...current,
      { id: requestId, role: "user", content },
      { id: pendingId, role: "assistant", content: "Thinking", pending: true },
    ])
    setSending(true)
    try {
      const response = await apiPost<{ message: string; actions: AssistantAction[] }>("/assistant/navigation", { message: content })
      setMessages((current) => current.map((item) => item.id === pendingId ? { id: pendingId, role: "assistant", content: response.message, actions: response.actions } : item))
    } catch (error) {
      const errorMessage = error instanceof ApiRequestError && error.status === 429
        ? "You've sent several requests quickly. Please wait a moment and try again."
        : "The URS-QA DMS Assistant is temporarily unavailable. Please try again."
      setMessages((current) => current.map((item) => item.id === pendingId ? { id: pendingId, role: "assistant", content: errorMessage } : item))
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void sendMessage()
    }
  }

  return (
    <>
      {open && (
        <section
          aria-label="URS-QA DMS Assistant"
          className="fixed inset-x-4 bottom-20 z-[80] flex h-[min(600px,calc(100dvh-6rem))] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-[0_20px_60px_rgba(15,23,42,0.2)] dark:bg-gray-900 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:h-[560px] lg:w-[380px]"
        >
          <header className="flex shrink-0 items-center justify-between bg-navy-900 px-4 py-3.5 text-white">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-200">
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-[14px] font-bold">URS-QA DMS Assistant</h2>
                <p className="text-[11px] text-blue-200">Navigation Guide</p>
              </div>
            </div>
            <Button variant="ghost" size="icon" aria-label="Close URS-QA DMS Assistant" onClick={() => setOpen(false)} className="h-9 w-9 text-blue-100 hover:bg-white/10 hover:text-white">
              <X className="h-4 w-4" />
            </Button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50/70 p-4 dark:bg-gray-950">
            {messages.map((message) => (
              <div key={message.id} className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-[13px] leading-5",
                  message.role === "user"
                    ? "rounded-br-md bg-primary text-white shadow-soft"
                    : "rounded-bl-md border border-border/70 bg-white text-gray-700 shadow-soft dark:bg-gray-900 dark:text-gray-200",
                )}>
                  {message.pending ? <span className="inline-flex items-center gap-1.5 text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Thinking...</span> : renderAssistantContent(message.content)}
                  {!message.pending && message.actions && message.actions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-border/60 pt-2.5">
                      {message.actions.map((action) => (
                        <button
                          key={action.target}
                          type="button"
                          onClick={() => {
                            const route = routeForAction(audience, action.target)
                            if (route) navigate(route)
                          }}
                          className="rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-[11px] font-semibold text-primary-700 transition-colors hover:bg-primary-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {messages.length === 1 && (
              <div className="pt-1">
                <p className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400"><Sparkles className="h-3.5 w-3.5 text-primary" /> Suggested questions</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions[audience].map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => void sendMessage(suggestion)} disabled={sending} className="rounded-xl border border-border/70 bg-white px-3 py-2 text-left text-[11px] font-medium text-gray-600 transition-colors hover:border-primary-200 hover:bg-primary-50 hover:text-primary-800 disabled:opacity-50 dark:bg-gray-900 dark:text-gray-300">
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(event) => { event.preventDefault(); void sendMessage() }} className="flex shrink-0 items-end gap-2 border-t border-border bg-white p-3 dark:bg-gray-900">
            <label htmlFor="assistant-message" className="sr-only">Ask about URS-QA DMS</label>
            <Textarea id="assistant-message" value={input} maxLength={MAX_MESSAGE_LENGTH} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask about URS-QA DMS..." rows={2} disabled={sending} className="min-h-[44px] resize-none py-2.5 text-[13px]" />
            <Button type="submit" size="icon" aria-label="Send message" disabled={sending || !input.trim()} className="h-10 w-10 shrink-0">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </section>
      )}
      <Button type="button" size="icon" aria-label={open ? "Close URS-QA DMS Assistant" : "Open URS-QA DMS Assistant"} onClick={() => setOpen((current) => !current)} className="fixed bottom-20 right-4 z-[80] h-12 w-12 rounded-2xl shadow-lift shadow-primary/25 lg:bottom-6 lg:right-6">
        {open ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </Button>
    </>
  )
}

function routeForAction(audience: keyof typeof suggestions, target: AssistantActionTarget): string | null {
  const routes: Record<keyof typeof suggestions, Partial<Record<AssistantActionTarget, string>>> = {
    user: {
      DASHBOARD: "/user/dashboard",
      MY_DOCUMENTS: "/user/documents",
      MY_REQUESTS: "/user/requests",
      AACCUP: "/user/aaccup",
      ISO: "/user/iso",
      NOTIFICATIONS: "/user/notifications",
      MY_ACTIVITY: "/user/activity",
      PROFILE: "/user/profile",
      SETTINGS: "/user/settings",
    },
    admin: {
      DASHBOARD: "/dashboard",
      MY_DOCUMENTS: "/documents",
      REQUESTS: "/requests",
      AACCUP: "/aaccup",
      ISO: "/iso",
      USER_MANAGEMENT: "/users",
      AUDIT_LOGS: "/audit",
      PROFILE: "/profile",
      SETTINGS: "/settings",
    },
    root: {
      DASHBOARD: "/dashboard",
      MY_DOCUMENTS: "/documents",
      AACCUP: "/aaccup",
      ISO: "/iso",
      USER_MANAGEMENT: "/root-users",
      AUDIT_LOGS: "/root-audit",
      PROFILE: "/profile",
      SETTINGS: "/settings",
      ORGANIZATION: "/root-organization",
      ROOT_CONSOLE: "/root",
      ROLES_PERMISSIONS: "/root-roles-permissions",
    },
  }
  return routes[audience][target] ?? null
}
