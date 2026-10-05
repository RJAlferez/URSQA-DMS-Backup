import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import {
  Search,
  FileText,
  Users,
  ArrowRight,
  Command,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/Badge"
import { cn } from "@/lib/utils"
import { listOnlineDocuments } from "@/services/documents"
import { listSystemUsers } from "@/services/admin"

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (page: string, query?: Record<string, string>) => void
  isUser?: boolean
}

interface SearchResult {
  id: string
  type: "document" | "user" | "page"
  title: string
  subtitle: string
  badge?: string
  page?: string
  query?: Record<string, string>
}

const staticPages: SearchResult[] = [
  { id: "p-dashboard", type: "page", title: "Dashboard", subtitle: "Go to Dashboard", page: "dashboard" },
  { id: "p-aaccup", type: "page", title: "Accreditation", subtitle: "AACCUP and ISO submissions", page: "aaccup" },
  { id: "p-iso", type: "page", title: "ISO 21001:2025", subtitle: "Go to ISO 21001:2025", page: "iso" },
  { id: "p-submissions", type: "page", title: "Submissions", subtitle: "Review AACCUP submissions", page: "submissions" },
  { id: "p-requests", type: "page", title: "Requests", subtitle: "Review file requests", page: "requests" },
  { id: "p-documents", type: "page", title: "Document Repository", subtitle: "Go to Document Repository", page: "documents" },
  { id: "p-users", type: "page", title: "User Management", subtitle: "Go to User Management", page: "users" },
  { id: "p-audit", type: "page", title: "Audit Logs", subtitle: "Go to Audit Logs", page: "audit" },
  { id: "p-settings", type: "page", title: "Settings", subtitle: "Go to Settings", page: "settings" },
]

const typeConfig = {
  document: { icon: FileText, color: "text-gray-500", bg: "bg-gray-100" },
  user: { icon: Users, color: "text-violet-600", bg: "bg-violet-50" },
  page: { icon: ArrowRight, color: "text-gray-500", bg: "bg-gray-100" },
}

export function CommandPalette({ open, onOpenChange, onNavigate, isUser }: CommandPaletteProps) {
  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const portalPages = useMemo(
    () => (isUser ? staticPages.filter((p) => p.page !== "users" && p.page !== "audit") : staticPages),
    [isUser]
  )

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(portalPages)
      return
    }    setLoading(true)
    const documentPromise = listOnlineDocuments({ search: query }).catch(() => [])
    Promise.all(
      isUser
        ? [documentPromise]
        : [documentPromise, listSystemUsers({ search: query, pageSize: 50 }).catch(() => ({ items: [], meta: { page: 1, pageSize: 50, total: 0, totalPages: 1 } }))]
    )
      .then(([docs, users]) => {
        const documentResults: SearchResult[] = docs.map((doc) => ({
          id: `doc-${doc.id}`,
          type: "document",
          title: doc.name,
          subtitle: `${doc.department} · ${doc.area}`,
          badge: doc.status,
          page: "documents",
          query: { highlight: doc.id },
        }))
        const userResults: SearchResult[] = (users?.items ?? []).map((user) => ({
          id: `user-${user.id}`,
          type: "user",
          title: [user.firstName, user.middleName, user.lastName].filter(Boolean).join(" ").trim(),
          subtitle: user.email,
          badge: user.status,
          page: "users",
          query: { highlight: user.id },
        }))
        setResults(isUser ? documentResults : [...documentResults, ...userResults])
        setLoading(false)
      })
      .catch(() => { setResults(portalPages); setLoading(false) })
  }, [query, isUser, portalPages])

  useEffect(() => {
    if (open) {
      setQuery("")
      setSelectedIndex(0)
      setResults(portalPages)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, portalPages])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  const handleSelect = useCallback(
    (result: SearchResult) => {
      if (result.page) {
        onNavigate(result.page, result.query)
      }
      onOpenChange(false)
    },
    [onNavigate, onOpenChange]
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1))
          break
        case "ArrowUp":
          e.preventDefault()
          setSelectedIndex((i) => Math.max(i - 1, 0))
          break
        case "Enter":
          e.preventDefault()
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex])
          }
          break
        case "Escape":
          e.preventDefault()
          onOpenChange(false)
          break
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, results, selectedIndex, handleSelect, onOpenChange])

  useEffect(() => {
    const selected = listRef.current?.querySelector(`[data-selected="true"]`)
    selected?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-border overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search documents, users, pages..."
            className="flex-1 text-[14px] outline-none bg-transparent text-gray-900 placeholder:text-gray-400"
          />
          <kbd className="hidden sm:inline-flex h-5 items-center gap-1 rounded border border-border bg-gray-50 px-1.5 font-mono text-[10px] font-medium text-gray-500">
            ESC
          </kbd>
          {query && (
            <button
              onClick={() => setQuery("")}
              className="p-0.5 hover:bg-gray-100 rounded"
            >
              <X className="w-3.5 h-3.5 text-gray-400" />
            </button>
          )}
        </div>

        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-2">
          {loading ? (
            <div className="py-8 text-center text-[13px] text-gray-500">Searching...</div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-[13px] text-gray-500">
              No results found for "{query}"
            </div>
          ) : (
            <>
              {!query.trim() && (
                <div className="px-3 py-1.5">
                  <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide px-2 mb-1">
                    Navigation
                  </p>
                </div>
              )}
              {results.map((result, index) => {
                const config = typeConfig[result.type]
                const Icon = config.icon
                return (
                  <button
                    key={result.id}
                    data-selected={index === selectedIndex}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      index === selectedIndex ? "bg-gray-50" : "hover:bg-gray-50/50"
                    )}
                  >
                    <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0", config.bg)}>
                      <Icon className={cn("w-4 h-4", config.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-gray-900 truncate">
                        {result.title}
                      </p>
                      <p className="text-[12px] text-gray-500 truncate">{result.subtitle}</p>
                    </div>
                    {result.badge && (
                      <Badge
                        variant={
                          result.badge === "Approved"
                            ? "success"
                            : result.badge === "Pending"
                            ? "warning"
                            : "secondary"
                        }
                        className="text-[10px] flex-shrink-0"
                      >
                        {result.badge}
                      </Badge>
                    )}
                    {result.type === "page" && (
                      <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    )}
                  </button>
                )
              })}
            </>
          )}
        </div>

        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-1 text-[11px] text-gray-400">
            <kbd className="inline-flex h-4 items-center gap-0.5 rounded border border-border bg-white px-1 font-mono text-[10px]">
              <Command className="w-2.5 h-2.5" />
            </kbd>
            <span>+</span>
            <kbd className="inline-flex h-4 items-center gap-0.5 rounded border border-border bg-white px-1 font-mono text-[10px]">
              K
            </kbd>
            <span className="ml-1">to open</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-gray-400">
            <kbd className="inline-flex h-4 items-center rounded border border-border bg-white px-1 font-mono text-[10px]">
              ↑
            </kbd>
            <kbd className="inline-flex h-4 items-center rounded border border-border bg-white px-1 font-mono text-[10px]">
              ↓
            </kbd>
            <span className="ml-1">to navigate</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-gray-400">
            <kbd className="inline-flex h-4 items-center rounded border border-border bg-white px-1 font-mono text-[10px]">
              ↵
            </kbd>
            <span className="ml-1">to select</span>
          </div>
        </div>
      </div>
    </div>
  )
}
