import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileText,
  Plus,
  Upload,
  Search,
  Pencil,
  Trash2,
  Move,
  Download,
  Eye,
  Copy,
  Star,
  Pin,
  Clock,
  Trash,
  LayoutGrid,
  List,
  X,
  Filter,
  RefreshCw,
  ArchiveRestore,
  Palette,
  Undo2,
  AlertTriangle,
  Inbox,
  FileArchive,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Users,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Label } from "@/components/ui/Label"
import { Skeleton } from "@/components/ui/Skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/Select"
import { useAuth } from "@/context/AuthContext"
import { toast } from "@/lib/toast"
import {
  listOnlineDocuments,
  listRepositoryFolders,
  createRepositoryFolder,
  renameRepositoryFolder,
  customizeFolder,
  moveRepositoryFolder,
  deleteRepositoryFolder,
  restoreRepositoryFolder,
  copyRepositoryFolder,
  permanentDeleteRepositoryFolder,
  listDeletedRepositoryFolders,
  pinRepositoryFolder,
  unpinRepositoryFolder,
  listPinnedRepositoryFolders,
  moveOnlineDocument,
  renameOnlineDocument,
  copyOnlineDocument,
  deleteOnlineDocument,
  restoreOnlineDocument,
  permanentDeleteOnlineDocument,
  listDeletedOnlineDocuments,
  listRequestedOnlineDocuments,
  favoriteOnlineDocument,
  unfavoriteOnlineDocument,
  listFavoriteOnlineDocuments,
  listOnlineRecents,
  uploadOnlineDocumentWithProgress,
  addOnlineDocumentVersion,
  openOnlineDocument,
  getOnlineDocumentUrl,
  getOnlineDocumentThumbnail,
  getFolderInfo,
  downloadFolderZip,
  listCopyJobs,
  type FolderInfo,
  type FolderCopyJob,
  type FolderCopyResult,
  type RepositoryFolderRow,
  type RecentItem,
  listSharedWithMe,
} from "@/services/documents"
import { getRepositoryStorage, type StorageSummary } from "@/services/repository"
import { registerUpload } from "@/lib/uploadBus"
import { sha256 as sha256Buffer } from "@/lib/sha256"
import type { Document } from "@/types/domain"
import { FilePreviewModal } from "@/components/preview/FilePreviewModal"
import { cn } from "@/lib/utils"
import { ShareFolderModal } from "@/components/repository/ShareFolderModal"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu"

// =============================================================================
// RepositoryExplorer — personal, owner-scoped file management with the full
// file lifecycle: upload queue + progress, copy/move, recycle bin (restore /
// permanent), favorites, recents, quick access, search, sort, grid/list
// views, Windows-Explorer interactions and the shared preview modal.
// =============================================================================

interface TreeNode {
  folder: RepositoryFolderRow
  children: TreeNode[]
}

type UploadStatus = "Waiting" | "Preparing" | "Uploading" | "Verifying" | "Complete" | "Failed" | "Cancelled"

interface UploadItem {
  id: string
  file: File
  progress: number
  bytesUploaded: number
  status: UploadStatus
  error?: string
  xhr?: XMLHttpRequest
  destination: string
  targetFolderId?: string | null
  startedAt?: number
  speedBytesPerSec?: number
  etaSeconds?: number
}

type ViewMode = "list" | "grid"
type Section = "all" | "shared" | "favorites" | "recent" | "requested" | "recycle"

export interface RepositoryExplorerHandle {
  openCreateFolder: () => void
  openUpload: () => void
}

function formatSize(bytes: number): string {
  if (!bytes) return "—"
  const units = ["B", "KB", "MB", "GB"]
  let i = 0
  let value = bytes
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}

function fileIconClasses(doc: Document): string {
  const type = doc.type?.toLowerCase() ?? ""
  if (["pdf"].includes(type)) return "bg-red-50 text-red-500 dark:bg-red-900/30 dark:text-red-400"
  if (["xls", "xlsx", "csv"].includes(type)) return "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
  if (["doc", "docx", "txt"].includes(type)) return "bg-primary-50 text-primary-600 dark:bg-blue-900/30 dark:text-blue-400"
  if (["ppt", "pptx"].includes(type)) return "bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400"
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(type)) return "bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
  if (["mp4", "webm", "mov", "avi", "mkv"].includes(type)) return "bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
  return "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
}

function isImageType(doc: Document): boolean {
  const t = doc.type?.toLowerCase() ?? ""
  return ["png", "jpg", "jpeg", "gif", "webp"].includes(t)
}

function isPdfType(doc: Document): boolean {
  return (doc.type?.toLowerCase() ?? "") === "pdf"
}

function isVideoType(doc: Document): boolean {
  const t = doc.type?.toLowerCase() ?? ""
  return ["mp4", "webm", "mov", "avi", "mkv"].includes(t)
}

function fileTypeLabel(doc: Document): string {
  return (doc.type?.toUpperCase() ?? "") || "FILE"
}

// Lazy thumbnail — fetches presigned URL only when visible via IntersectionObserver
function LazyThumbnail({ doc }: { doc: Document; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)
  const [loading, setLoading] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const fetched = useRef(false)

  useEffect(() => {
    if (fetched.current) return
    if (!isImageType(doc) && !isPdfType(doc) && !isVideoType(doc)) return
    fetched.current = true
    setLoading(true)
    const previewRequest = isVideoType(doc)
      ? getOnlineDocumentUrl(doc, true)
      : getOnlineDocumentThumbnail(doc).catch((error) => {
          // An older upload may not have a generated thumbnail yet. Images can
          // still render safely from their authorized original preview URL.
          if (isImageType(doc)) return getOnlineDocumentUrl(doc, true)
          throw error
        })
    previewRequest
      .then((u) => setUrl(u))
      .catch(() => setErrored(true))
      .finally(() => setLoading(false))
  }, [doc])

  useEffect(() => () => {
    if (url?.startsWith("blob:")) URL.revokeObjectURL(url)
  }, [url])

  const showFallback = errored || !isImageType(doc) && !isPdfType(doc) && !isVideoType(doc)

  if (showFallback) {
    return (
      <div className={cn("w-full h-full flex items-center justify-center rounded-t-xl", fileIconClasses(doc))}>
        <FileText className="w-8 h-8" />
      </div>
    )
  }

  if (loading && !url) {
    return (
      <div className="w-full h-full rounded-t-xl p-3 bg-gray-50 dark:bg-gray-800" aria-busy="true" aria-label="Loading thumbnail">
        <Skeleton className="h-full w-full" variant="rectangular" />
      </div>
    )
  }

  if (isImageType(doc) && url) {
    return (
      <div className="relative h-full w-full overflow-hidden rounded-t-xl bg-gray-50 dark:bg-gray-800" aria-busy={!imageLoaded}>
        {!imageLoaded && <Skeleton className="absolute inset-0 h-full w-full" variant="rectangular" />}
        <img
          src={url}
          alt={doc.name}
          className={cn("h-full w-full object-cover transition-opacity duration-300", imageLoaded ? "opacity-100" : "opacity-0")}
          loading="lazy"
          onLoad={() => setImageLoaded(true)}
          onError={() => setErrored(true)}
        />
      </div>
    )
  }

  if (isPdfType(doc) && url) {
    return (
      <div className="w-full h-full relative rounded-t-xl overflow-hidden bg-gray-100 dark:bg-gray-800">
        {!imageLoaded && <Skeleton className="absolute inset-0 h-full w-full" variant="rectangular" />}
        <img src={url} alt={doc.name} className={cn("w-full h-full object-cover transition-opacity duration-300", imageLoaded ? "opacity-100" : "opacity-0")} loading="lazy" onLoad={() => setImageLoaded(true)} onError={() => setErrored(true)} />
        <div className="absolute inset-0 rounded-t-xl ring-1 ring-inset ring-black/5 pointer-events-none" />
      </div>
    )
  }

  if (isVideoType(doc) && url) {
    return (
      <div className="w-full h-full relative rounded-t-xl overflow-hidden bg-gray-900">
        <video
          src={url}
          preload="metadata"
          crossOrigin="anonymous"
          className="w-full h-full object-cover"
          muted
          playsInline
          onLoadedData={(event) => {
            // Ask the browser to paint the first decoded frame as the card preview.
            event.currentTarget.currentTime = 0
          }}
          onError={() => setErrored(true)}
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
          <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
            <div className="w-0 h-0 border-l-[12px] border-l-white border-y-[8px] border-y-transparent ml-0.5" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex items-center justify-center rounded-t-xl bg-gray-50 dark:bg-gray-800">
      <FileText className="w-8 h-8 text-gray-400" />
    </div>
  )
}

const UPLOAD_MIME_TYPES = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.csv,.txt,.mp3,.wav,.ogg,.m4a,.aac,.mp4,.webm,.mov,.avi,.mkv"

export const RepositoryExplorer = forwardRef<RepositoryExplorerHandle>(function RepositoryExplorer(_props, ref) {
  const { user } = useAuth()
  const [folders, setFolders] = useState<RepositoryFolderRow[]>([])
  const [docs, setDocs] = useState<Document[]>([])
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)
  const [section, setSection] = useState<Section>("all")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<"newest" | "oldest" | "name" | "name-desc" | "size" | "size-asc">("newest")
  const [view, setView] = useState<ViewMode>("grid")
  const [loading, setLoading] = useState(true)

  // Queue
  const [queue, setQueue] = useState<UploadItem[]>([])
  const [queueOpen, setQueueOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const handleFilesRef = useRef<((files: FileList | null, targetFolderId?: string | null) => void) | null>(null)
  const versionInputRef = useRef<HTMLInputElement>(null)
  const [versionTarget, setVersionTarget] = useState<Document | null>(null)

  // Sections data
  const [pins, setPins] = useState<RepositoryFolderRow[]>([])
  const [favorites, setFavorites] = useState<Document[]>([])
  const [recents, setRecents] = useState<RecentItem[]>([])
  const [deletedFolders, setDeletedFolders] = useState<RepositoryFolderRow[]>([])
  const [deletedDocs, setDeletedDocs] = useState<Document[]>([])
  const [requestedDocs, setRequestedDocs] = useState<Document[]>([])
  const [sharedFolders, setSharedFolders] = useState<RepositoryFolderRow[]>([])
  const [searchResults, setSearchResults] = useState<Document[] | null>(null)
  const [storage, setStorage] = useState<StorageSummary | null>(null)
  const [folderInfo, setFolderInfo] = useState<FolderInfo | null>(null)
  const [folderDetailsTarget, setFolderDetailsTarget] = useState<{ folder: RepositoryFolderRow; info: FolderInfo | null } | null>(null)
  const [jobs, setJobs] = useState<FolderCopyJob[]>([])
  const [copyDialog, setCopyDialog] = useState<{ folder: RepositoryFolderRow; targetParentId: string; conflictMode: "keep_both" | "merge" | "cancel" } | null>(null)
  const [fileCopyDialog, setFileCopyDialog] = useState<{ docs: Document[]; targetFolderId: string; conflictMode: "keep_both" | "replace" | "cancel" } | null>(null)
  const [bulkCopyDialog, setBulkCopyDialog] = useState<{ items: Array<{ type: "folder" | "file"; id: string; name: string }>; targetFolderId: string; conflictMode: "keep_both" | "replace" | "cancel" } | null>(null)
  const [restoreDialog, setRestoreDialog] = useState<{ type: "folder" | "file"; id: string; name: string } | null>(null)
  const [restoreTargetFolderId, setRestoreTargetFolderId] = useState<string>("original")
  const [restoreConflictMode, setRestoreConflictMode] = useState<"keep_both" | "replace" | "cancel">("keep_both")
  const [duplicateDialog, setDuplicateDialog] = useState<{ name: string; resolve: (mode: "keep_both" | "cancel") => void } | null>(null)

  // Dialogs
  const [folderDialog, setFolderDialog] = useState<{ open: boolean; mode: "create" | "rename"; folder?: RepositoryFolderRow }>({
    open: false,
    mode: "create",
  })
  const [folderName, setFolderName] = useState("")
  const [renameTarget, setRenameTarget] = useState<Document | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [moveTarget, setMoveTarget] = useState<{ type: "folder" | "file"; id: string } | null>(null)
  const [moveFolderId, setMoveFolderId] = useState("root")
  const [deleteTarget, setDeleteTarget] = useState<{ type: "folder" | "file"; id: string; name: string } | null>(null)
  const [customizeTarget, setCustomizeTarget] = useState<RepositoryFolderRow | null>(null)
  const [customizeColor, setCustomizeColor] = useState("#3b82f6")
  const [emptyBinConfirm, setEmptyBinConfirm] = useState(false)
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [permanentTarget, setPermanentTarget] = useState<{ type: "folder" | "file"; id: string; name: string } | null>(null)
  const [preview, setPreview] = useState<Document | null>(null)
  const [shareTarget, setShareTarget] = useState<RepositoryFolderRow | null>(null)
  const [conflictDialog, setConflictDialog] = useState<{ name: string; resolve: (mode: "replace" | "keep_both" | "cancel") => void } | null>(null)

  const ownerId = user?.id

  useEffect(() => {
    if (!ownerId) return
    const saved = localStorage.getItem(`repository-view:${ownerId}`) ?? localStorage.getItem("userViewMode")
    if (saved === "grid" || saved === "list") setView(saved)
  }, [ownerId])

  const changeView = (next: ViewMode) => {
    setView(next)
    if (ownerId) localStorage.setItem(`repository-view:${ownerId}`, next)
  }

  const load = useCallback(async () => {
    if (!ownerId) return
    setLoading(true)
    try {
      const [sharedRows, folderRows, docRows, pinRows, favRows, recentRows, delFolders, delDocs, reqRows, storageRow, jobRows] = await Promise.all([
        listSharedWithMe().catch(() => [] as RepositoryFolderRow[]),
        section === "shared" && currentFolderId === null ? Promise.resolve([] as RepositoryFolderRow[]) : listRepositoryFolders({ parentId: currentFolderId, ownerId: section === "shared" ? undefined : ownerId }),
        listOnlineDocuments({ folderId: currentFolderId, ownerId: section === "shared" ? undefined : ownerId }),
        listPinnedRepositoryFolders(),
        listFavoriteOnlineDocuments(),
        listOnlineRecents(),
        listDeletedRepositoryFolders(),
        listDeletedOnlineDocuments(),
        listRequestedOnlineDocuments(),
        getRepositoryStorage().catch(() => null),
        listCopyJobs().catch(() => [] as FolderCopyJob[]),
      ])
      setFolders(folderRows)
      setSharedFolders(sharedRows)
      setDocs(docRows)
      setPins(pinRows)
      setFavorites(favRows)
      setRecents(recentRows)
      setDeletedFolders(delFolders)
      setDeletedDocs(delDocs)
      setRequestedDocs(reqRows)
      setStorage(storageRow)
      setJobs(jobRows)
    } catch {
      setFolders([])
      setDocs([])
    } finally {
      setLoading(false)
    }
  }, [ownerId, currentFolderId, section])

  useEffect(() => {
    load()
  }, [load])

  // ── Repository-wide search ─────────────────────────────────────────────────
  // In the "My Documents" view a non-empty query searches the owner's WHOLE
  // repository through the backend (q + ownerId, no folder scoping) instead
  // of only filtering the open folder. Folder matches are filtered client-side
  // over the full tree already in state. Debounced 300ms.

  useEffect(() => {
    if (section !== "all" || !ownerId) {
      setSearchResults(null)
      return
    }
    const q = search.trim()
    if (!q) {
      setSearchResults(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const rows = await listOnlineDocuments({ search: q, ownerId })
        if (!cancelled) setSearchResults(rows)
      } catch {
        if (!cancelled) setSearchResults([])
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search, section, ownerId])

  // ── Folder info (rule 12) — recursive counts + size, on-demand ────────────

  useEffect(() => {
    if (section !== "all" || !currentFolderId) {
      setFolderInfo(null)
      return
    }
    let cancelled = false
    getFolderInfo(currentFolderId)
      .then((info) => {
        if (!cancelled) setFolderInfo(info)
      })
      .catch(() => {
        if (!cancelled) setFolderInfo(null)
      })
    return () => {
      cancelled = true
    }
  }, [currentFolderId, section, folders])

  // ── Background copy-job polling (rule 9) ───────────────────────────────────

  const hasActiveJob = jobs.some((job) => job.status === "PENDING" || job.status === "RUNNING")

  useEffect(() => {
    if (!hasActiveJob) return
    const timer = setInterval(async () => {
      const fresh = await listCopyJobs().catch(() => null)
      if (!fresh) return
      const completed = fresh.filter((job) => job.status === "COMPLETED" && job.resultFolderId)
      for (const job of completed) {
        if (job.resultFolderId) {
          toast.success(`Folder copy finished: ${job.sourceFolderName ?? "folder"}`)
        }
      }
      setJobs(fresh)
      if (!fresh.some((job) => job.status === "PENDING" || job.status === "RUNNING")) {
        await load()
      }
    }, 2500)
    return () => clearInterval(timer)
  }, [hasActiveJob, load])

  // ── Leave warning while uploading ──────────────────────────────────────────

  const activeUploads = queue.some((item) => ["Waiting", "Preparing", "Uploading", "Verifying"].includes(item.status))

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (activeUploads) {
        e.preventDefault()
        e.returnValue = "Uploads are still in progress. Leave anyway?"
      }
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [activeUploads])

  // ── Highlight support (notification deep-link) ──────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const highlightId = params.get("highlight")
    if (!highlightId) return
    // Attempt to scroll to the highlighted item after data loads
    const timer = setTimeout(() => {
      const el = document.getElementById(`row-${highlightId}`)
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" })
        el.classList.add("ring-2", "ring-amber-400", "bg-amber-50")
        setTimeout(() => {
          el.classList.remove("ring-2", "ring-amber-400", "bg-amber-50")
        }, 3000)
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [])

  // ── Drag & drop (rule 15) ──────────────────────────────────────────────────

  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [dragOverPane, setDragOverPane] = useState(false)

  const onItemDragStart = (e: React.DragEvent, type: "folder" | "file", id: string) => {
    e.dataTransfer.setData("application/x-urs-item", JSON.stringify({ type, id }))
    e.dataTransfer.effectAllowed = "move"
  }

  const onPaneDragOver = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
      setDragOverPane(true)
    }
  }

  const onFolderDrop = async (e: React.DragEvent, targetFolderId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverFolderId(null)
    setDragOverPane(false)
    const raw = e.dataTransfer.getData("application/x-urs-item")
    if (raw) {
      let payload: { type: string; id: string }
      try {
        payload = JSON.parse(raw)
      } catch {
        return
      }
      if (payload.type === "file") {
        const source = docs.find((d) => d.id === payload.id)
        if (!source || source.folderId === targetFolderId) return
        try {
          await moveOnlineDocument(payload.id, targetFolderId)
          toast.success("File moved")
          await load()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Move failed")
        }
      } else {
        const folder = folders.find((f) => f.id === payload.id)
        if (!folder || folder.parentId === targetFolderId) return
        try {
          await moveRepositoryFolder(payload.id, targetFolderId)
          toast.success("Folder moved")
          await load()
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Move failed")
        }
      }
      return
    }
    // External files dropped onto a folder → upload into that folder.
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      handleFiles(files, targetFolderId)
    }
  }

  const onPaneDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverPane(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }

  // ── Formatting helpers ─────────────────────────────────────────────────────

  const formatSpeed = (bytesPerSec?: number): string => {
    if (!bytesPerSec || bytesPerSec <= 0) return ""
    return `${formatSize(bytesPerSec)}/s`
  }

  const formatEta = (seconds?: number): string => {
    if (seconds === undefined || !Number.isFinite(seconds)) return ""
    if (seconds < 60) return `~${seconds}s left`
    return `~${Math.ceil(seconds / 60)}m left`
  }

  // ── Tree ──────────────────────────────────────────────────────────────────

  const tree = useMemo<TreeNode[]>(() => {
    const byParent = new Map<string | null, TreeNode[]>()
    for (const folder of folders) {
      const node: TreeNode = { folder, children: [] }
      const bucket = byParent.get(folder.parentId) ?? []
      bucket.push(node)
      byParent.set(folder.parentId, bucket)
    }
    const attach = (parentId: string | null): TreeNode[] =>
      (byParent.get(parentId) ?? []).map((node) => ({ ...node, children: attach(node.folder.id) }))
    return attach(null)
  }, [folders])

  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders])

  const crumbs = useMemo(() => {
    const path: RepositoryFolderRow[] = []
    let cursor = currentFolderId
    let guard = 0
    while (cursor && guard++ < 50) {
      const folder = folderById.get(cursor)
      if (!folder) break
      path.unshift(folder)
      cursor = folder.parentId
    }
    return path
  }, [currentFolderId, folderById])

  const navigate = (folderId: string | null) => {
    setCurrentFolderId(folderId)
    setFolderFilter(folderId ?? "current")
    setSection("all")
    setSelectedId(null)
    setSelectedIds(new Set())
    setSearch("")
  }

  const navigateShared = (folderId: string | null) => {
    setCurrentFolderId(folderId)
    setFolderFilter(folderId ?? "shared")
    setSection("shared")
    setSelectedIds(new Set())
  }

  const toggleExpand = (folderId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  // ── Folder actions ────────────────────────────────────────────────────────

  const openCreateFolder = useCallback(() => {
    setFolderName("")
    setFolderDialog({ open: true, mode: "create" })
  }, [])

  useImperativeHandle(ref, () => ({
    openCreateFolder,
    openUpload: () => fileInputRef.current?.click(),
  }), [openCreateFolder])

  const submitFolderDialog = async () => {
    const name = folderName.trim()
    if (!name || !folderDialog.open) return
    try {
      if (folderDialog.mode === "create") {
        await createRepositoryFolder({ name, parentId: currentFolderId })
        toast.success("Folder created")
      } else if (folderDialog.folder) {
        await renameRepositoryFolder(folderDialog.folder.id, name)
        toast.success("Folder renamed")
      }
      setFolderDialog({ open: false, mode: "create" })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Folder action failed")
    }
  }

  const handleCopyFolder = async (folder: RepositoryFolderRow) => {
    setCopyDialog({ folder, targetParentId: "root", conflictMode: "keep_both" })
  }

  const openFolderDetails = async (folder: RepositoryFolderRow) => {
    setFolderDetailsTarget({ folder, info: null })
    const info = await getFolderInfo(folder.id).catch(() => null)
    setFolderDetailsTarget((current) => current?.folder.id === folder.id ? { folder, info } : current)
  }

  const submitCopyDialog = async () => {
    if (!copyDialog) return
    const { folder } = copyDialog
    try {
      const targetParentId = copyDialog.targetParentId === "root" ? null : copyDialog.targetParentId
      // Rule 9: confirm large copies (approx. 1000+ items) before starting.
      let info: FolderInfo | null = null
      try {
        info = await getFolderInfo(folder.id)
      } catch {
        info = null
      }
      const totalItems = info ? info.recursiveDocumentCount + info.childCount : 0
      if (totalItems >= 1000 && !window.confirm(
        `This folder contains approximately ${totalItems} items. The copy will run in the background and you can continue browsing. Start the copy?`,
      )) {
        return
      }
      const result: FolderCopyResult = await copyRepositoryFolder(folder.id, {
        targetParentId,
        conflictMode: copyDialog.conflictMode,
      })
      if (result.job) {
        toast.success("Large folder copy started in the background")
        setJobs((prev) => [result.job as FolderCopyJob, ...prev])
      } else if (result.folder) {
        toast.success(`Folder copied as "${result.folder.name}"`)
      }
      setCopyDialog(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Copy failed")
    }
  }

  const handleTogglePin = async (folder: RepositoryFolderRow) => {
    try {
      if (pins.some((p) => p.id === folder.id)) {
        await unpinRepositoryFolder(folder.id)
        toast.success("Removed from Quick Access")
      } else {
        await pinRepositoryFolder(folder.id)
        toast.success("Pinned to Quick Access")
      }
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Pin failed")
    }
  }

  // ── File actions ──────────────────────────────────────────────────────────

  const performUpload = (item: UploadItem, mode: "replace" | "keep_both" | "cancel" = "keep_both") => {
    setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, status: "Preparing", error: undefined } : it)))
    const { file } = item

    const run = async () => {
      const release = registerUpload()
      try {
        // Check name conflict in the destination folder first.
        const existing = docs.find((d) => d.name.toLowerCase() === file.name.toLowerCase())
        const checksum = await sha256File(file)
        const exactDuplicate = checkDuplicate(file, checksum)

        // Rule 7: warn on exact duplicates (checksum + size), never silently
        // skip, merge or duplicate.
        if (exactDuplicate && mode !== "replace") {
          setDuplicateDialog({
            name: file.name,
            resolve: (resolved) => {
              setDuplicateDialog(null)
              if (resolved === "cancel") {
                setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, status: "Cancelled" } : it)))
                return
              }
              performUpload(item, "keep_both")
            },
          })
          setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, status: "Waiting" } : it)))
          return
        }
        if (existing && !exactDuplicate && mode === "keep_both") {
          setConflictDialog({
            name: file.name,
            resolve: (resolved) => {
              setConflictDialog(null)
              if (resolved === "cancel") {
                setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, status: "Cancelled" } : it)))
                return
              }
              performUpload(item, resolved)
            },
          })
          setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, status: "Waiting" } : it)))
          return
        }
        if (mode === "cancel") {
          setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, status: "Cancelled" } : it)))
          return
        }

        const startedAt = Date.now()
        const setStatus = (status: UploadStatus, progress?: number) =>
          setQueue((q) =>
            q.map((it) => {
              if (it.id !== item.id) return it
              let speedBytesPerSec: number | undefined
              let etaSeconds: number | undefined
              if (status === "Uploading" && progress !== undefined && progress > 0) {
                const elapsedSec = Math.max(0.5, (Date.now() - startedAt) / 1000)
                const bytes = Math.round(file.size * progress)
                speedBytesPerSec = bytes / elapsedSec
                const remainingBytes = file.size - bytes
                etaSeconds = speedBytesPerSec > 0 ? Math.ceil(remainingBytes / speedBytesPerSec) : undefined
              }
              return {
                ...it,
                status,
                progress: progress ?? it.progress,
                bytesUploaded: progress !== undefined ? Math.round(file.size * progress) : it.bytesUploaded,
                startedAt,
                speedBytesPerSec: speedBytesPerSec ?? it.speedBytesPerSec,
                etaSeconds: etaSeconds ?? it.etaSeconds,
              }
            }),
          )
        const onProgress = (fraction: number) => setStatus("Uploading", fraction)

        if (existing && mode === "replace") {
          // Replace = add a NEW version to the existing document; the previous
          // file stays in version history (rule 8: identity, folder, favorites
          // and activity history are preserved).
          await addOnlineDocumentVersion(existing.id, { file, changeNote: "Replacement upload" })
        } else {
          const title = existing && mode === "keep_both" ? keepBothName(file.name) : file.name
          await uploadOnlineDocumentWithProgress(
            {
              title,
              departmentId: null,
              folderId: item.targetFolderId !== undefined ? item.targetFolderId : currentFolderId,
              file,
              changeNote: "Repository upload",
            },
            onProgress,
            {
              onXhr: (xhr) => setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, xhr } : it))),
            },
          )
        }
        setStatus("Complete", 1)
        await load()
      } catch (err) {
        if (err instanceof Error && err.message === "Upload canceled") {
          setQueue((q) => q.map((it) => (it.id === item.id ? { ...it, status: "Cancelled" } : it)))
          return
        }
        const message = err instanceof Error ? err.message : "Upload failed"
        setQueue((q) =>
          q.map((it) =>
            it.id === item.id ? { ...it, status: "Failed", error: message } : it,
          ),
        )
        toast.error(`${file.name}: ${message}`)
      } finally {
        release()
      }
    }
    void run()
  }

  const keepBothName = (name: string): string => {
    const dot = name.lastIndexOf(".")
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ""
    let n = 1
    while (docs.some((d) => d.name.toLowerCase() === `${stem} (${n})${ext}`.toLowerCase())) n += 1
    return `${stem} (${n})${ext}`
  }

  const sha256File = async (file: File): Promise<string> => {
    return sha256Buffer(await file.arrayBuffer())
  }

  // Rule 7: exact same file (checksum + size) already in the destination.
  const checkDuplicate = (file: File, checksum: string): Document | undefined =>
    docs.find((d) => d.size === file.size && (d.checksum ?? "").toLowerCase() === checksum.toLowerCase())

  const handleFiles = (files: FileList | null, targetFolderId?: string | null) => {
    if (!files || files.length === 0) return
    const destination = targetFolderId
      ? (folderById.get(targetFolderId)?.name ?? "Current folder")
      : currentFolderId
        ? (folderById.get(currentFolderId)?.name ?? "Current folder")
        : "My Documents"
    const items: UploadItem[] = Array.from(files).map((file) => ({
      id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      file,
      progress: 0,
      bytesUploaded: 0,
      status: "Waiting",
      destination,
      targetFolderId,
    }))
    setQueue((q) => [...q, ...items])
    setQueueOpen(true)
    items.forEach((item, index) => setTimeout(() => performUpload(item), index * 150))
  }
  handleFilesRef.current = handleFiles

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files")
    const onWindowDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
      setDragOverPane(true)
    }
    const onWindowDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDragOverPane(false)
      if (event.dataTransfer?.files.length) handleFilesRef.current?.(event.dataTransfer.files)
    }
    const clearDragState = (event?: DragEvent) => {
      if (!event || !event.relatedTarget) setDragOverPane(false)
    }

    window.addEventListener("dragover", onWindowDragOver)
    window.addEventListener("drop", onWindowDrop)
    window.addEventListener("dragend", clearDragState)
    window.addEventListener("dragleave", clearDragState)
    return () => {
      window.removeEventListener("dragover", onWindowDragOver)
      window.removeEventListener("drop", onWindowDrop)
      window.removeEventListener("dragend", clearDragState)
      window.removeEventListener("dragleave", clearDragState)
    }
  }, [])

  const cancelUpload = (id: string) => {
    const item = queue.find((it) => it.id === id)
    item?.xhr?.abort()
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, status: "Cancelled" } : it)))
  }

  const clearCompleted = () => {
    setQueue((q) => q.filter((it) => ["Complete", "Failed", "Cancelled"].includes(it.status)))
  }

  const queueTotals = {
    total: queue.length,
    done: queue.filter((it) => ["Complete", "Failed", "Cancelled"].includes(it.status)).length,
    percent: queue.length === 0
      ? 0
      : Math.round(
          queue.reduce((sum, it) => sum + it.progress * it.file.size, 0) /
            queue.reduce((sum, it) => sum + it.file.size, 0) *
            100,
        ),
  }

  const submitRename = async () => {
    if (!renameTarget || !renameValue.trim()) return
    try {
      await renameOnlineDocument(renameTarget.id, renameValue.trim())
      toast.success("File renamed")
      setRenameTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed")
    }
  }

  const openMove = (type: "folder" | "file", id: string) => {
    setMoveTarget({ type, id })
    setMoveFolderId("root")
  }

  const submitMove = async () => {
    if (!moveTarget) return
    try {
      const folderId = moveFolderId === "root" ? null : moveFolderId
      if (moveTarget.type === "folder") {
        await moveRepositoryFolder(moveTarget.id, folderId)
        toast.success("Folder moved")
      } else {
        await moveOnlineDocument(moveTarget.id, folderId)
        toast.success("File moved")
      }
      setMoveTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Move failed")
    }
  }

  const handleCopyFile = async (doc: Document) => {
    setFileCopyDialog({ docs: [doc], targetFolderId: currentFolderId ?? "root", conflictMode: "keep_both" })
  }

  const submitFileCopyDialog = async () => {
    if (!fileCopyDialog) return
    try {
      const targetFolderId = fileCopyDialog.targetFolderId === "root" ? null : fileCopyDialog.targetFolderId
      for (const doc of fileCopyDialog.docs) {
        await copyOnlineDocument(doc.id, { targetFolderId, conflictMode: fileCopyDialog.conflictMode })
      }
      toast.success(`${fileCopyDialog.docs.length} file(s) copied`)
      setFileCopyDialog(null)
      setSelectedIds(new Set())
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Copy failed")
    }
  }

  const handleToggleFavorite = async (doc: Document) => {
    try {
      if (favorites.some((f) => f.id === doc.id)) {
        await unfavoriteOnlineDocument(doc.id)
      } else {
        await favoriteOnlineDocument(doc.id)
      }
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Favorite failed")
    }
  }

  const submitDelete = async () => {
    if (!deleteTarget) return
    try {
      if (deleteTarget.type === "folder") await deleteRepositoryFolder(deleteTarget.id)
      else await deleteOnlineDocument(deleteTarget.id)
      toast.success(`${deleteTarget.type === "folder" ? "Folder" : "File"} moved to Recycle Bin`)
      setDeleteTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed")
    }
  }

  const submitPermanentDelete = async () => {
    if (!permanentTarget) return
    try {
      if (permanentTarget.type === "folder") await permanentDeleteRepositoryFolder(permanentTarget.id)
      else await permanentDeleteOnlineDocument(permanentTarget.id)
      toast.success("Permanently deleted")
      setPermanentTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Permanent delete failed")
    }
  }

  const submitRestore = async (type: "folder" | "file", id: string) => {
    setRestoreDialog({ type, id, name: type === "folder"
      ? (deletedFolders.find((f) => f.id === id)?.name ?? "")
      : (deletedDocs.find((d) => d.id === id)?.name ?? "") })
    setRestoreTargetFolderId("original")
    setRestoreConflictMode("keep_both")
  }

  const submitRestoreDialog = async () => {
    if (!restoreDialog) return
    const { type, id } = restoreDialog
    try {
      const targetFolderId = restoreTargetFolderId === "original" ? undefined
        : restoreTargetFolderId === "root" ? null
        : restoreTargetFolderId
      const conflictMode = restoreConflictMode
      if (type === "folder") {
        await restoreRepositoryFolder(id, { targetParentId: targetFolderId, conflictMode })
      } else {
        await restoreOnlineDocument(id, { targetFolderId, conflictMode })
      }
      toast.success("Restored")
      setRestoreDialog(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restore failed")
    }
  }

  const emptyRecycleBin = async () => {
    setEmptyBinConfirm(false)
    try {
      for (const folder of deletedFolders) await permanentDeleteRepositoryFolder(folder.id)
      for (const doc of deletedDocs) {
        try {
          await permanentDeleteOnlineDocument(doc.id)
        } catch {
          // snapshot-guarded files stay
        }
      }
      toast.success("Recycle Bin emptied")
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Empty failed")
    }
  }

  const submitBulkDelete = async () => {
    if (selectedIds.size === 0) return
    try {
      for (const id of selectedIds) await deleteOnlineDocument(id)
      toast.success(`${selectedIds.size} file(s) moved to Recycle Bin`)
      setSelectedIds(new Set())
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk delete failed")
    }
  }

  const submitBulkDownload = () => {
    const selected = sortedDocs.filter((d) => selectedIds.has(d.id))
    for (const doc of selected) void openOnlineDocument(doc)
    setSelectedIds(new Set())
  }

  const submitBulkMove = () => { const first = sortedDocs.find((d) => selectedIds.has(d.id)); if (first) openMove("file", first.id) }
  const submitBulkCopy = () => {
    const selectedDocs = sortedDocs.filter((doc) => selectedIds.has(doc.id))
    const selectedFolders = sortedFolders.filter((folder) => selectedIds.has(folder.id))
    if (selectedFolders.length > 0) {
      setBulkCopyDialog({ items: [...selectedFolders.map((folder) => ({ type: "folder" as const, id: folder.id, name: folder.name })), ...selectedDocs.map((doc) => ({ type: "file" as const, id: doc.id, name: doc.name }))], targetFolderId: currentFolderId ?? "root", conflictMode: "keep_both" })
    } else if (selectedDocs.length > 0) {
      setFileCopyDialog({ docs: selectedDocs, targetFolderId: currentFolderId ?? "root", conflictMode: "keep_both" })
    }
  }

  const submitBulkCopyDialog = async () => {
    if (!bulkCopyDialog) return
    try {
      const targetFolderId = bulkCopyDialog.targetFolderId === "root" ? null : bulkCopyDialog.targetFolderId
      for (const item of bulkCopyDialog.items) {
        if (item.type === "folder") {
          await copyRepositoryFolder(item.id, { targetParentId: targetFolderId, conflictMode: bulkCopyDialog.conflictMode === "replace" ? "merge" : bulkCopyDialog.conflictMode })
        } else {
          await copyOnlineDocument(item.id, { targetFolderId, conflictMode: bulkCopyDialog.conflictMode })
        }
      }
      toast.success(`${bulkCopyDialog.items.length} item(s) copied`)
      setBulkCopyDialog(null)
      setSelectedIds(new Set())
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Copy failed")
    }
  }

  const handleReplaceVersion = async (files: FileList | null) => {
    if (!files?.[0] || !versionTarget) return
    try {
      await addOnlineDocumentVersion(versionTarget.id, { file: files[0], changeNote: "Replacement version" })
      toast.success("New version uploaded — previous version kept in history")
      setVersionTarget(null)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Version upload failed")
    }
  }

  // ── Selection / interactions ───────────────────────────────────────────────

  const [typeFilter, setTypeFilter] = useState("all")
  const [modifiedFilter, setModifiedFilter] = useState("all")
  const [folderFilter, setFolderFilter] = useState("current")

  const toggleSelect = (id: string) => {
    setSelectedId(id)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const visibleDocs = useMemo(() => {
    const q = search.trim().toLowerCase()
    const searching = section === "all" && q.length > 0
    const matchesType = (doc: Document) => {
      if (typeFilter === "all") return true
      return typeFilter.split(",").includes(doc.type.toLowerCase())
    }
    const matchesModified = (doc: Document) => {
      if (modifiedFilter === "all") return true
      const age = Date.now() - new Date(doc.dateModified).getTime()
      const day = 24 * 60 * 60 * 1000
      if (modifiedFilter === "today") return age <= day
      if (modifiedFilter === "week") return age <= day * 7
      return age <= day * 30
    }
    const visibleFolders = searching
      ? folders.filter((f) => f.parentId === currentFolderId && f.name.toLowerCase().includes(q))
      : section === "all"
        ? folders.filter((f) => f.parentId === currentFolderId)
        : []
    const visibleFiles =
      section === "favorites"
        ? favorites.filter((d) => !q || d.name.toLowerCase().includes(q))
        : section === "requested"
          ? requestedDocs.filter((d) => !q || d.name.toLowerCase().includes(q))
          : section === "recycle"
            ? deletedDocs.filter((d) => !q || d.name.toLowerCase().includes(q))
            : searching
              ? searchResults ?? []
              : docs.filter((d) => !q || d.name.toLowerCase().includes(q))
    return { folders: visibleFolders, docs: visibleFiles.filter((doc) => matchesType(doc) && matchesModified(doc)) }
  }, [folders, docs, favorites, requestedDocs, deletedDocs, section, search, searchResults, currentFolderId, typeFilter, modifiedFilter])

  const sortedDocs = useMemo(() => {
    const items = [...visibleDocs.docs]
    switch (sort) {
      case "name": items.sort((a, b) => a.name.localeCompare(b.name)); break
      case "name-desc": items.sort((a, b) => b.name.localeCompare(a.name)); break
      case "size": items.sort((a, b) => b.size - a.size); break
      case "size-asc": items.sort((a, b) => a.size - b.size); break
      case "oldest": items.sort((a, b) => a.dateModified.localeCompare(b.dateModified)); break
      default: items.sort((a, b) => b.dateModified.localeCompare(a.dateModified))
    }
    return items
  }, [visibleDocs.docs, sort])

  const sortedFolders = useMemo(() => {
    const items = [...visibleDocs.folders]
    items.sort((a, b) => {
      const pinOrder = Number(pins.some((pin) => pin.id === b.id)) - Number(pins.some((pin) => pin.id === a.id))
      if (pinOrder !== 0) return pinOrder
      if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt)
      if (sort === "newest") return b.updatedAt.localeCompare(a.updatedAt)
      return a.name.localeCompare(b.name)
    })
    return items
  }, [visibleDocs.folders, sort, pins])

  const moveOptions = useMemo(
    () => {
      const parentId = moveTarget
        ? (moveTarget.type === "folder" ? folders.find((f) => f.id === moveTarget.id)?.parentId : null)
        : null;
      return [
        { id: "root", name: "All Files (root)" },
        ...folders
          .filter((f) => (!moveTarget || f.id !== moveTarget.id) && f.id !== parentId)
          .sort((a, b) => a.name.localeCompare(b.name)),
      ];
    },
    [folders, moveTarget],
  )

  const isFavorite = (id: string) => favorites.some((f) => f.id === id)
  const isPinned = (id: string) => pins.some((p) => p.id === id)

  const submissionBadge = (doc: Document) => {
    if (!doc.submissionStatus) return null
    const config = {
      PENDING: { label: "Pending", cls: "bg-amber-50 text-amber-700 border-amber-200" },
      APPROVED: { label: "Approved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
      REJECTED: { label: "Rejected", cls: "bg-red-50 text-red-700 border-red-200" },
      NEEDS_REVISION: { label: "Returned", cls: "bg-orange-50 text-orange-700 border-orange-200" },
      WITHDRAWN: { label: "Withdrawn", cls: "bg-slate-50 text-slate-700 border-slate-200" },
    } as const
    const cfg = config[doc.submissionStatus]
    return (
      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded-full border whitespace-nowrap", cfg.cls)}
        title={`AACCUP submission: ${cfg.label}`}>
        {cfg.label}
      </span>
    )
  }

  const expiresAt = (deletedAt?: string | null): string => {
    if (!deletedAt) return ""
    const date = new Date(deletedAt)
    date.setDate(date.getDate() + 30)
    return date.toLocaleDateString()
  }
  const daysRemaining = (deletedAt?: string | null): number | null => {
    if (!deletedAt) return null
    const d = new Date(deletedAt)
    const expire = new Date(d.getTime() + 30 * 24 * 60 * 60 * 1000)
    const days = Math.ceil((expire.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    return Math.max(0, days)
  }

  if (!ownerId) {
    return (
      <Card className="border-border/70 shadow-soft">
        <CardContent className="p-8 text-center text-[13px] text-gray-500">Sign in to view your repository.</CardContent>
      </Card>
    )
  }

  const renderTree = (nodes: TreeNode[], depth: number) =>
    nodes.map((node) => {
      const isExpanded = expanded.has(node.folder.id)
      const isCurrent = currentFolderId === node.folder.id && section === "all"
      const hasChildren = node.children.length > 0
      const isDragOver = dragOverFolderId === node.folder.id
      return (
        <div key={node.folder.id}>
          <div
            className={cn(
              "flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[13px] cursor-pointer select-none transition-colors group",
              isCurrent ? "bg-primary text-white" : isDragOver ? "bg-primary-50 ring-1 ring-blue-300" : "text-gray-600 hover:bg-gray-100",
            )}
            style={{ paddingLeft: `${8 + depth * 16}px` }}
            onClick={() => navigate(node.folder.id)}
            onDoubleClick={() => toggleExpand(node.folder.id)}
            draggable
            onDragStart={(e) => onItemDragStart(e, "folder", node.folder.id)}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(node.folder.id) }}
            onDragLeave={() => setDragOverFolderId((prev) => (prev === node.folder.id ? null : prev))}
            onDrop={(e) => void onFolderDrop(e, node.folder.id)}
          >
            <button
              type="button"
              className="p-0.5 rounded hover:bg-black/10"
              onClick={(e) => {
                e.stopPropagation()
                if (hasChildren) toggleExpand(node.folder.id)
              }}
            >
              {hasChildren ? (
                isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
              ) : (
                <span className="w-3.5 h-3.5 inline-block" />
              )}
            </button>
            {isCurrent ? <FolderOpen className="w-4 h-4 text-white" /> : <Folder className="w-4 h-4" style={{ color: node.folder.color ?? undefined }} />}
            <span className="truncate flex-1">{node.folder.name}</span>
            {isPinned(node.folder.id) && <Pin className="w-3 h-3 text-amber-500" />}
          </div>
          {isExpanded && renderTree(node.children, depth + 1)}
        </div>
      )
    })

  const SectionButton = ({ active, onClick, icon, label, count }: {
    active: boolean
    onClick: () => void
    icon: React.ReactNode
    label: string
    count?: number
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] cursor-pointer select-none transition-colors",
        active ? "bg-primary text-white" : "text-gray-600 hover:bg-gray-100",
      )}
    >
      {icon}
      <span className="flex-1 text-left truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={cn("text-[11px]", active ? "text-gray-300" : "text-gray-400")}>{count}</span>
      )}
    </button>
  )

  const ActionMenu = ({ children, label = "More actions" }: { children: React.ReactNode; label?: string }) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-500" aria-label={label} title={label}>
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const renderRow = (icon: React.ReactNode, name: string, meta: string, id: string, actions: React.ReactNode, open: () => void, opts?: {
    drag?: { type: "folder" | "file"; id: string }
    dropTarget?: { folderId: string | null }
    badge?: React.ReactNode
  }) => {
    const isSelected = selectedIds.has(id)
    return (
    <div
      key={id}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 dark:border-gray-700/50 cursor-pointer select-none transition-colors",
        isSelected
          ? "bg-gray-100 dark:bg-gray-800/70"
          : selectedId === id ? "bg-gray-50/70 dark:bg-gray-800/50"
          : dragOverFolderId === (opts?.dropTarget?.folderId ?? null) ? "bg-primary-50/70 dark:bg-blue-900/20"
          : "hover:bg-gray-50/70 dark:hover:bg-gray-800/50",
      )}
      onClick={() => setSelectedId(id)}
      onDoubleClick={open}
      draggable={Boolean(opts?.drag)}
      onDragStart={opts?.drag ? (e) => onItemDragStart(e, opts.drag!.type, opts.drag!.id) : undefined}
      onDragOver={opts?.dropTarget ? (e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(opts.dropTarget!.folderId) } : undefined}
      onDragLeave={() => setDragOverFolderId(null)}
      onDrop={opts?.dropTarget ? (e) => void onFolderDrop(e, opts.dropTarget!.folderId) : undefined}
    >
      <input
        type="checkbox"
        className="w-4 h-4 rounded accent-primary flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
        checked={isSelected}
        onChange={() => toggleSelect(id)}
      />
      {icon}
      <span className="flex-1 min-w-0 text-[14px] font-medium text-gray-900 dark:text-gray-100 break-words">{name}</span>
      {opts?.badge}
      <span className="text-[12px] text-gray-500 dark:text-gray-400 hidden sm:inline">{meta}</span>
      <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
        <ActionMenu>{actions}</ActionMenu>
      </div>
    </div>
  )}

  const renderCard = (doc: Document | null, folder: RepositoryFolderRow | null, name: string, meta: string, id: string, open: () => void, opts?: {
    drag?: { type: "folder" | "file"; id: string }
    dropTarget?: { folderId: string | null }
    badge?: React.ReactNode
    actions?: React.ReactNode
  }) => {
    const isSelected = selectedIds.has(id)
    const isFolder = Boolean(folder)
    return (
    <div
      key={id}
      className={cn(
        "relative border rounded-xl cursor-pointer select-none transition-all duration-150 group bg-white",
        isSelected
           ? "border-gray-400 bg-gray-50/70 shadow-soft"
           : dragOverFolderId === (opts?.dropTarget?.folderId ?? null) ? "border-primary/50 bg-primary/5"
           : "border-border/80 hover:border-gray-300 hover:shadow-lift",
      )}
      onClick={() => setSelectedId(id)}
      onDoubleClick={open}
      draggable={Boolean(opts?.drag)}
      onDragStart={opts?.drag ? (e) => onItemDragStart(e, opts.drag!.type, opts.drag!.id) : undefined}
      onDragOver={opts?.dropTarget ? (e) => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(opts.dropTarget!.folderId) } : undefined}
      onDragLeave={() => setDragOverFolderId(null)}
      onDrop={opts?.dropTarget ? (e) => void onFolderDrop(e, opts.dropTarget!.folderId) : undefined}
    >
      {isFolder && folder ? (
        <div className="flex items-center gap-3 p-3 min-h-[76px]">
          <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
            <Folder className="w-5 h-5" style={{ color: folder.color ?? "#F59E0B" }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <p className="text-[13px] font-semibold text-gray-900 truncate" title={name}>{name}</p>
              {isPinned(folder.id) && <Pin className="w-3 h-3 text-amber-500 flex-shrink-0" />}
            </div>
            <p className="text-[11px] text-gray-500 truncate mt-0.5">{meta}</p>
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            {opts?.actions && <ActionMenu>{opts.actions}</ActionMenu>}
          </div>
          <input
            type="checkbox"
            className="w-4 h-4 rounded accent-primary flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
            checked={isSelected}
            onChange={() => toggleSelect(id)}
            aria-label={`Select folder ${name}`}
          />
        </div>
      ) : (
        <>
          <div className="aspect-[4/3] overflow-hidden rounded-t-xl bg-gray-50">
            {doc ? <LazyThumbnail doc={doc} /> : <FileText className="w-8 h-8 text-gray-400 mx-auto mt-10" />}
          </div>
          <div className="p-3">
            <p className="text-[13px] font-semibold text-gray-900 truncate" title={name}>{name}</p>
            <div className="flex items-center justify-between gap-2 mt-1.5">
              <div className="flex items-center gap-1.5 min-w-0">
                {opts?.badge}
                {doc && <span className="text-[11px] text-gray-500 truncate">{fileTypeLabel(doc)} · {formatSize(doc.size)}</span>}
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                {opts?.actions && <ActionMenu>{opts.actions}</ActionMenu>}
              </div>
            </div>
            {doc && <p className="text-[11px] text-gray-400 mt-1.5">Modified {new Date(doc.dateModified).toLocaleDateString()}</p>}
          </div>
          <input
            type="checkbox"
            className="absolute top-2 right-2 w-4 h-4 rounded accent-primary"
            onClick={(e) => e.stopPropagation()}
            checked={isSelected}
            onChange={() => toggleSelect(id)}
            aria-label={`Select file ${name}`}
          />
        </>
      )}
    </div>
  )}

  const commonActions = {
    file: (doc: Document) => (
      <>
        <DropdownMenuItem onClick={() => setPreview(doc)}><Eye className="mr-2.5 w-4 h-4" />Preview</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setPreview(doc)}><FileText className="mr-2.5 w-4 h-4" />Details</DropdownMenuItem>
        <DropdownMenuItem onClick={() => { setRenameTarget(doc); setRenameValue(doc.name) }}><Pencil className="mr-2.5 w-4 h-4" />Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openMove("file", doc.id)}><Move className="mr-2.5 w-4 h-4" />Move</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleCopyFile(doc)}><Copy className="mr-2.5 w-4 h-4" />Copy</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void openOnlineDocument(doc)}><Download className="mr-2.5 w-4 h-4" />Download</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleToggleFavorite(doc)}><Star className={cn("mr-2.5 w-4 h-4", isFavorite(doc.id) && "fill-amber-500 text-amber-500")} />{isFavorite(doc.id) ? "Remove Favorite" : "Favorite"}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setVersionTarget(doc)}><RefreshCw className="mr-2.5 w-4 h-4" />Replace Version</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-600 focus:text-red-700" onClick={() => setDeleteTarget({ type: "file", id: doc.id, name: doc.name })}><Trash2 className="mr-2.5 w-4 h-4" />Delete</DropdownMenuItem>
      </>
    ),
    folder: (folder: RepositoryFolderRow) => section === "shared" ? sharedFolderActions(folder) : (
      <>
        <DropdownMenuItem onClick={() => navigate(folder.id)}><FolderOpen className="mr-2.5 w-4 h-4" />Open</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void openFolderDetails(folder)}><FileText className="mr-2.5 w-4 h-4" />Details</DropdownMenuItem>
        {folder.ownerId === ownerId && <DropdownMenuItem onClick={() => setShareTarget(folder)}><Users className="mr-2.5 w-4 h-4" />Share</DropdownMenuItem>}
        <DropdownMenuItem onClick={() => { setFolderName(folder.name); setFolderDialog({ open: true, mode: "rename", folder }) }}><Pencil className="mr-2.5 w-4 h-4" />Rename</DropdownMenuItem>
        <DropdownMenuItem onClick={() => openMove("folder", folder.id)}><Move className="mr-2.5 w-4 h-4" />Move</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleCopyFolder(folder)}><Copy className="mr-2.5 w-4 h-4" />Copy</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handleTogglePin(folder)}><Pin className={cn("mr-2.5 w-4 h-4", isPinned(folder.id) && "fill-amber-500 text-amber-500")} />{isPinned(folder.id) ? "Unpin" : "Pin to Top"}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => { setCustomizeTarget(folder); setCustomizeColor(folder.color ?? "#3b82f6") }}><Palette className="mr-2.5 w-4 h-4" />Change Color</DropdownMenuItem>
        <DropdownMenuItem onClick={() => void downloadFolderZip(folder.id, folder.name).catch((err) => toast.error(err instanceof Error ? err.message : "ZIP download failed"))}><FileArchive className="mr-2.5 w-4 h-4" />Download ZIP</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-red-600 focus:text-red-700" onClick={() => setDeleteTarget({ type: "folder", id: folder.id, name: folder.name })}><Trash2 className="mr-2.5 w-4 h-4" />Delete</DropdownMenuItem>
      </>
    ),
  }

  const sharedFolderActions = (folder: RepositoryFolderRow) => (
    <>
      <DropdownMenuItem onClick={() => navigateShared(folder.id)}><FolderOpen className="mr-2.5 w-4 h-4" />Open</DropdownMenuItem>
      <DropdownMenuItem onClick={() => void openFolderDetails(folder)}><FileText className="mr-2.5 w-4 h-4" />Details</DropdownMenuItem>
      <DropdownMenuItem onClick={() => void downloadFolderZip(folder.id, folder.name).catch((err) => toast.error(err instanceof Error ? err.message : "ZIP download failed"))}><FileArchive className="mr-2.5 w-4 h-4" />Download ZIP</DropdownMenuItem>
    </>
  )

  const recycleActions = (type: "folder" | "file", id: string, name: string) => (
    <>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-emerald-600" title="Restore"
        onClick={() => void submitRestore(type, id)}>
        <ArchiveRestore className="w-3.5 h-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-red-600" title="Permanently delete"
        onClick={() => setPermanentTarget({ type, id, name })}>
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </>
  )

  return (
    <div className="relative"
      onDragOver={(e) => { e.preventDefault(); onPaneDragOver(e) }}
      onDragLeave={() => setDragOverPane(false)}
      onDrop={(e) => onPaneDrop(e)}>
      {dragOverPane && (
        <div className="fixed inset-0 z-[60] border-2 border-dashed border-primary bg-primary/10 flex items-center justify-center backdrop-blur-[2px] pointer-events-none">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-lg">
              <Upload className="w-8 h-8 text-primary" />
            </div>
            <p className="text-lg font-semibold text-gray-900">Drop files to upload</p>
            <p className="text-sm text-gray-600 mt-1">into {currentFolderId ? folderById.get(currentFolderId)?.name ?? "this folder" : "My Documents"}</p>
          </div>
        </div>
      )}
      {/* ── Sidebar ── */}
      <Card className="hidden">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide">Repository</span>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-gray-700" title="New folder"
              onClick={openCreateFolder}>
              <Plus className="w-4 h-4" />
            </Button>
          </div>
          <div className="space-y-0.5 mb-3">
            <SectionButton active={section === "all" && currentFolderId === null} onClick={() => navigate(null)} icon={<FolderOpen className="w-4 h-4 text-amber-500" />} label="My Documents" />
            {pins.length > 0 && (
              <div className="pt-2">
                <p className="px-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Quick Access</p>
                {pins.map((pin) => (
                  <SectionButton key={pin.id} active={section === "all" && currentFolderId === pin.id} onClick={() => navigate(pin.id)} icon={<Pin className="w-4 h-4 text-amber-500" />} label={pin.name} />
                ))}
              </div>
            )}
            <div className="pt-2">
              <p className="px-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Views</p>
              <SectionButton active={section === "favorites"} onClick={() => { setSection("favorites"); setSelectedIds(new Set()) }} icon={<Star className="w-4 h-4 text-amber-500" />} label="Favorites" count={favorites.length} />
              <SectionButton active={section === "requested"} onClick={() => { setSection("requested"); setSelectedIds(new Set()) }} icon={<Inbox className="w-4 h-4 text-blue-500" />} label="Requested Documents" count={requestedDocs.length} />
              <SectionButton active={section === "recent"} onClick={() => { setSection("recent"); setSelectedIds(new Set()) }} icon={<Clock className="w-4 h-4 text-blue-500" />} label="Recent" count={recents.length} />
              <SectionButton active={section === "recycle"} onClick={() => { setSection("recycle"); setSelectedIds(new Set()) }} icon={<Trash className="w-4 h-4 text-red-500" />} label="Recycle Bin" count={deletedDocs.length + deletedFolders.length} />
            </div>
          </div>
          <p className="px-2 pb-1 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Folders</p>
          <div className="space-y-0.5">{renderTree(tree, 0)}</div>

          {/* Storage card (rule 13) — honest server usage */}
          {storage && (
            <div className="mt-3 px-2">
              <div className={cn("rounded-lg border p-2.5",
                storage.minioStatus === "online" ? "border-gray-100 bg-gray-50/60" : "border-red-200 bg-red-50/60")}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                    <HardDrive className="w-3 h-3" /> Storage
                  </p>
                  <span className={cn("flex items-center gap-1 text-[10px] font-medium",
                    storage.minioStatus === "online" ? "text-emerald-600" : "text-red-600")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full",
                      storage.minioStatus === "online" ? "bg-emerald-500" : "bg-red-500")} />
                    MinIO {storage.minioStatus}
                  </span>
                </div>
                {storage.minioStatus === "online" ? (
                  <>
                    <p className="text-[12px] text-gray-700 font-medium">{formatSize(Number(storage.usedBytes))} used</p>
                    <p className="text-[10px] text-gray-400">
                      {storage.availableBytes === null ? "Available: — (no capacity quota configured)" : `Available: ${formatSize(Number(storage.availableBytes))}`}
                    </p>
                  </>
                ) : (
                  <div>
                    <p className="text-[11px] text-red-700 leading-tight mb-1.5">Upload, download, and preview are unavailable until MinIO reconnects</p>
                    <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => load()}>
                      <RefreshCw className="w-3 h-3 mr-1" /> Retry
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Main pane ── */}
      <Card className="border-0 bg-transparent shadow-none">
        <CardContent className="p-0">
          <div className="mb-5 flex items-center gap-1 overflow-x-auto border-b border-border pb-1">
            {[
              { id: "all" as const, label: "My Documents", icon: <FolderOpen className="w-4 h-4" /> },
              { id: "shared" as const, label: "Shared with Me", icon: <Users className="w-4 h-4" />, count: sharedFolders.length },
              { id: "favorites" as const, label: "Favorites", icon: <Star className="w-4 h-4" />, count: favorites.length },
              { id: "requested" as const, label: "Requested Documents", icon: <Inbox className="w-4 h-4" />, count: requestedDocs.length },
              { id: "recent" as const, label: "Recent", icon: <Clock className="w-4 h-4" />, count: recents.length },
              { id: "recycle" as const, label: "Recycle Bin", icon: <Trash className="w-4 h-4" />, count: deletedDocs.length + deletedFolders.length },
            ].map((item) => {
              const active = item.id === "all" ? section === "all" : section === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => item.id === "all" ? navigate(null) : item.id === "shared" ? navigateShared(null) : (setSection(item.id), setSelectedIds(new Set()))}
                  className={cn(
                    "flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors",
                    active ? "bg-primary text-white" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900",
                  )}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {item.count !== undefined && item.count > 0 && <span className={cn("rounded-full px-1.5 text-[10px]", active ? "bg-white/15 text-white" : "bg-gray-100 text-gray-500")}>{item.count}</span>}
                </button>
              )
            })}
          </div>
          {/* Background copy jobs (rule 9) */}
          {jobs.filter((job) => job.status === "PENDING" || job.status === "RUNNING").length > 0 && (
            <div className="mb-4 rounded-xl border border-blue-200 bg-primary-50/40 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Loader2 className="w-3.5 h-3.5 text-primary-600 animate-spin" />
                <p className="text-[12px] font-semibold text-blue-800">Background folder copy in progress</p>
              </div>
              <div className="space-y-2">
                {jobs.filter((job) => job.status === "PENDING" || job.status === "RUNNING").map((job) => {
                  const percent = job.totalItems > 0 ? Math.round((job.processedItems / job.totalItems) * 100) : 0
                  return (
                    <div key={job.id}>
                      <div className="flex justify-between text-[11px] text-blue-700 mb-0.5">
                        <span className="truncate">{job.sourceFolderName ?? "Folder"} · {job.processedItems}/{job.totalItems} items</span>
                        <span>{percent}%</span>
                      </div>
                      <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-500 transition-all" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-primary-600 mt-1.5">You can keep browsing — the copy continues in the background.</p>
            </div>
          )}
          <input ref={fileInputRef} type="file" multiple accept={UPLOAD_MIME_TYPES} className="hidden"
            onChange={(e) => { handleFiles(e.target.files); e.target.value = "" }} />
          {/* Toolbar */}
          <div className="flex flex-col gap-3 mb-5">
            <div className="toolbar-padding flex flex-col gap-3 lg:flex-row lg:items-center">
            {section === "all" && (
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="sm" className="h-10" onClick={openCreateFolder}>
                  <Folder className="w-4 h-4 mr-2" /> New Folder
                </Button>
                <Button size="sm" className="h-10 shadow-soft" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="w-4 h-4 mr-2" /> Upload
                </Button>
              </div>
            )}
            <div className="relative flex-1 lg:max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search files and folders..."
                className="pl-10 h-9 bg-gray-50/50 border-0 hover:bg-gray-100 focus:bg-white dark:bg-gray-800 dark:hover:bg-gray-700"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {section === "all" && (
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-[120px] h-9"><Filter className="w-3.5 h-3.5 mr-1.5" /><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="doc,docx,txt">Documents</SelectItem>
                    <SelectItem value="xls,xlsx,csv">Spreadsheets</SelectItem>
                    <SelectItem value="jpg,jpeg,png,gif,webp">Images</SelectItem>
                    <SelectItem value="mp4,webm,mov,avi,mkv">Videos</SelectItem>
                    <SelectItem value="mp3,wav,ogg,m4a,aac">Audio</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {section === "all" && (
                <Select value={modifiedFilter} onValueChange={setModifiedFilter}>
                  <SelectTrigger className="w-[132px] h-9"><Clock className="w-3.5 h-3.5 mr-1.5" /><SelectValue placeholder="Modified" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any time</SelectItem>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="week">Past week</SelectItem>
                    <SelectItem value="month">Past month</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {section === "all" && currentFolderId === null && (
                <Select value={folderFilter} onValueChange={(value) => { setFolderFilter(value); navigate(value === "current" ? null : value) }}>
                  <SelectTrigger className="w-[130px] h-9"><Folder className="w-3.5 h-3.5 mr-1.5" /><SelectValue placeholder="Folder" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current">All folders</SelectItem>
                    {folders.map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
                <SelectTrigger className="w-[145px] h-9"><SelectValue placeholder="Sort" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Recently modified</SelectItem>
                  <SelectItem value="oldest">Oldest modified</SelectItem>
                  <SelectItem value="name">Name A–Z</SelectItem>
                  <SelectItem value="name-desc">Name Z–A</SelectItem>
                  <SelectItem value="size">Largest first</SelectItem>
                  <SelectItem value="size-asc">Smallest first</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex rounded-lg border border-border p-1 bg-gray-50/50" aria-label="View mode">
                <button type="button" onClick={() => changeView("list")} aria-label="List view"
                  className={cn("flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
                    view === "list" ? "bg-white text-gray-900 shadow-soft" : "text-gray-500 hover:text-gray-700")}>
                  <List className="w-3.5 h-3.5" /> <span className="hidden sm:inline">List</span>
                </button>
                <button type="button" onClick={() => changeView("grid")} aria-label="Grid view"
                  className={cn("flex items-center gap-1 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors",
                    view === "grid" ? "bg-white text-gray-900 shadow-soft" : "text-gray-500 hover:text-gray-700")}>
                  <LayoutGrid className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Grid</span>
                </button>
              </div>
              </div>
            </div>
            {(section === "recycle" && (deletedDocs.length + deletedFolders.length) > 0 || selectedIds.size > 0 && section === "all") && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              {section === "recycle" && (deletedDocs.length + deletedFolders.length) > 0 && (
                <Button variant="destructive" size="sm" className="h-9" onClick={() => setEmptyBinConfirm(true)}>
                  <Trash2 className="w-4 h-4 mr-2" /> Empty Recycle Bin
                </Button>
              )}
              {selectedIds.size > 0 && section === "all" && (
                <div className="flex items-center gap-2 pl-2 border-l border-border dark:border-gray-600">
                  <span className="text-[12px] font-medium text-gray-600 dark:text-gray-300">{selectedIds.size} selected</span>
                  <Button variant="outline" size="sm" className="h-8" onClick={submitBulkDownload}><Download className="w-3.5 h-3.5 mr-1" /> DL</Button>
                  <Button variant="outline" size="sm" className="h-8" onClick={submitBulkMove}><Move className="w-3.5 h-3.5 mr-1" /> Move</Button>
                  <Button variant="outline" size="sm" className="h-8" onClick={submitBulkCopy}><Copy className="w-3.5 h-3.5 mr-1" /> Copy</Button>
                  <Button variant="destructive" size="sm" className="h-8" onClick={() => setBulkDeleteConfirm(true)}><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete</Button>
                  <Button variant="ghost" size="sm" className="h-8 text-gray-400" onClick={() => setSelectedIds(new Set())}><X className="w-3.5 h-3.5" /></Button>
                </div>
              )}
            </div>
            )}
          </div>

          {/* Upload queue */}
          {queueOpen && queue.length > 0 && (
            <div className="mb-4 rounded-xl border border-border bg-gray-50/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[12px] font-semibold text-gray-700">
                  Upload Queue ({queueTotals.done}/{queueTotals.total})
                </p>
                <div className="flex items-center gap-1">
                  {queueTotals.done === queueTotals.total && (
                    <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={clearCompleted}>Clear completed</Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400" onClick={() => setQueueOpen(false)}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              {queueTotals.total > 0 && (
                <div className="h-1.5 mb-3 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-primary-500 transition-all" style={{ width: `${queueTotals.percent}%` }} />
                </div>
              )}
              <div className="space-y-1.5 max-h-48 overflow-auto">
                {queue.map((item) => (
                  <div key={item.id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[12px] text-gray-700 truncate">{item.file.name}</p>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <span className="text-[11px] text-gray-400 truncate hidden sm:inline">→ {item.destination}</span>
                          <span className="text-[11px] text-gray-400">
                            {item.status === "Uploading" ? `${formatSize(item.bytesUploaded)} / ${formatSize(item.file.size)}` : formatSize(item.file.size)}
                          </span>
                          <span className={cn("text-[11px] font-medium",
                            item.status === "Complete" ? "text-emerald-600"
                              : item.status === "Failed" ? "text-red-600"
                                : item.status === "Cancelled" ? "text-gray-400" : "text-primary-600")}>
                            {item.status}
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 mt-1 bg-gray-200 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all",
                          item.status === "Failed" ? "bg-red-500" : item.status === "Complete" ? "bg-emerald-500" : "bg-primary-500")}
                          style={{ width: `${item.status === "Waiting" ? 0 : item.status === "Complete" ? 100 : Math.max(5, Math.min(90, item.progress))}%` }} />
                      </div>
                      {(item.status === "Uploading" || item.status === "Verifying") && (
                        <p className="text-[11px] text-gray-400">
                          {item.status === "Uploading" ? `${formatSpeed(item.speedBytesPerSec)}${item.etaSeconds !== undefined ? ` · ${formatEta(item.etaSeconds)}` : ""}` : "Verifying upload…"}
                        </p>
                      )}
                      {item.error && <p className="text-[11px] text-red-600">{item.error}</p>}
                    </div>
                    {["Waiting", "Preparing", "Uploading"].includes(item.status) && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-red-600" title="Cancel"
                        onClick={() => cancelUpload(item.id)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {item.status === "Failed" && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:text-primary-600" title="Retry"
                        onClick={() => performUpload(item)}>
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Breadcrumb (repository views) */}
          {(section === "all" || section === "shared") && currentFolderId !== null && (
            <div className="flex items-center gap-1.5 flex-wrap text-[13px] mb-3">
              <button type="button" onClick={() => navigate(null)}
                className={cn("px-2 py-1 rounded-md flex items-center gap-1.5 transition-colors",
                  currentFolderId === null ? "bg-primary text-white font-medium" : "text-gray-600 hover:bg-gray-100")}>
                <FolderOpen className="w-3.5 h-3.5" /> {section === "shared" ? "Shared with Me" : "My Documents"}
              </button>
              {crumbs.map((folder) => (
                <div key={folder.id} className="flex items-center gap-1.5">
                  <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                  <button type="button" onClick={() => navigate(folder.id)}
                    className={cn("px-2 py-1 rounded-md transition-colors",
                      currentFolderId === folder.id ? "bg-primary text-white font-medium" : "text-gray-600 hover:bg-gray-100")}>
                    {folder.name}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Section header */}
          {section !== "all" && (
            <div className="flex items-center gap-2 mb-3">
              {section === "favorites" && <Star className="w-4 h-4 text-amber-500" />}
              {section === "requested" && <Inbox className="w-4 h-4 text-blue-500" />}
              {section === "recent" && <Clock className="w-4 h-4 text-blue-500" />}
              {section === "recycle" && <Trash className="w-4 h-4 text-red-500" />}
              <h3 className="text-[14px] font-semibold text-gray-900 capitalize">
                {section === "requested" ? "Requested Documents" : section === "recycle" ? "Recycle Bin" : section}
              </h3>
              {section === "requested" && (
                <p className="text-[12px] text-gray-400">Documents delivered through approved requests — access, not ownership</p>
              )}
            </div>
          )}

          {/* Folder info bar (rule 12) — recursive counts + size, on demand */}
          {section === "all" && folderInfo && (
            <div className="flex items-center gap-3 mb-3 rounded-lg bg-gray-50/60 border border-gray-100 px-3 py-1.5 text-[12px] text-gray-500">
              <span>{folderInfo.recursiveDocumentCount} files</span>
              <span className="text-gray-300">·</span>
              <span>{folderInfo.childCount} subfolders</span>
              <span className="text-gray-300">·</span>
              <span>{formatSize(Number(folderInfo.recursiveSizeBytes))} total</span>
              <span className="text-gray-300">·</span>
              <span>depth {folderInfo.depth}</span>
            </div>
          )}

          {/* Listing */}
           {loading ? (
            <div className="min-h-[280px] flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin" />
            </div>
           ) : section === "shared" && currentFolderId === null ? (
             <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
               {sharedFolders.length === 0 && <p className="col-span-full px-4 py-8 text-center text-[13px] text-gray-400">No folders have been shared with you.</p>}
               {sharedFolders.map((folder) => renderCard(null, folder, folder.name, `Shared folder · ${folder.ownerId === ownerId ? "Owner" : "Shared"}`, folder.id, () => navigateShared(folder.id), { actions: sharedFolderActions(folder), badge: <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-700"><Users className="h-3 w-3" />Shared</span> }))}
             </div>
           ) : section === "recent" ? (
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              {recents.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-gray-400">No recent activity yet</p>}
              {recents.map((item) => (
                <div key={`${item.itemType}-${item.itemId}`} className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 cursor-pointer select-none hover:bg-gray-50/70"
                  onClick={() => item.itemType === "FOLDER" ? navigate(item.itemId) : setPreview(docs.find((d) => d.id === item.itemId) ?? null)}
                  onDoubleClick={() => item.itemType === "FOLDER" ? navigate(item.itemId) : setPreview(docs.find((d) => d.id === item.itemId) ?? null)}>
                  {item.itemType === "FOLDER"
                     ? <Folder className="w-[18px] h-[18px]" style={{ color: item.itemType === "FOLDER" ? folderById.get(item.itemId)?.color ?? undefined : undefined }} />
                    : <FileText className="w-[18px] h-[18px] text-gray-400" />}
                  <span className="flex-1 text-[14px] font-medium text-gray-900 truncate">{item.name}</span>
                  <span className="text-[12px] text-gray-400">{new Date(item.lastOpenedAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          ) : section === "recycle" ? (
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              {(deletedFolders.length === 0 && deletedDocs.length === 0) && (
                <p className="px-4 py-8 text-center text-[13px] text-gray-400">Recycle Bin is empty</p>
              )}
              {view === "list" ? (
                <>
                  {deletedFolders.map((folder) => renderRow(
                     <Folder className="w-[18px] h-[18px]" style={{ color: folder.color ?? undefined }} />, folder.name,
                    folder.deletedAt ? `Deleted ${new Date(folder.deletedAt).toLocaleDateString()} · expires ${expiresAt(folder.deletedAt)} · ${daysRemaining(folder.deletedAt)}d left` : "Folder",
                    folder.id,
                    recycleActions("folder", folder.id, folder.name), () => undefined,
                  ))}
                  {deletedDocs.map((doc) => renderRow(
                    <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", fileIconClasses(doc))}><FileText className="w-4 h-4" /></div>,
                    doc.name,
                    `${doc.type} · ${formatSize(doc.size)} · Deleted ${doc.deletedAt ? new Date(doc.deletedAt).toLocaleDateString() : ""} · expires ${expiresAt(doc.deletedAt)} · ${daysRemaining(doc.deletedAt)}d left`,
                    doc.id,
                    recycleActions("file", doc.id, doc.name), () => setPreview(doc),
                    { badge: submissionBadge(doc) },
                  ))}
                </>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {deletedFolders.map((folder) => renderCard(
                    null, folder, folder.name,
                    folder.deletedAt ? `Deleted ${new Date(folder.deletedAt).toLocaleDateString()} · expires ${expiresAt(folder.deletedAt)} · ${daysRemaining(folder.deletedAt)}d left` : "Folder",
                    folder.id,
                    () => undefined,
                    { actions: recycleActions("folder", folder.id, folder.name) },
                  ))}
                  {deletedDocs.map((doc) => renderCard(
                    doc, null, doc.name, `${doc.type} · ${formatSize(doc.size)}`, doc.id,
                    () => setPreview(doc),
                    { badge: submissionBadge(doc), actions: recycleActions("file", doc.id, doc.name) },
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-gray-100 overflow-hidden">
              {search.trim() && section === "all" && (
                <p className="px-3 py-1.5 text-[11px] text-gray-400 border-b border-gray-100 bg-gray-50/50">
                  Searching your whole repository…
                </p>
              )}
              {(visibleDocs.folders.length === 0 && sortedDocs.length === 0) && (
                <p className="px-4 py-8 text-center text-[13px] text-gray-400">
                  {search.trim() ? "No matches in your repository" : section === "favorites" ? "No favorites yet — star a file" : section === "requested" ? "No requested documents yet — approved request deliveries appear here" : "This folder is empty — create a folder or upload files"}
                </p>
              )}
              {view === "list" ? (
                <>
                   {section === "all" && (sortedFolders.length > 0 || sortedDocs.length > 0) && (
                     <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_260px_36px] items-center gap-3 px-3 py-2 border-b border-gray-100 bg-gray-50/60 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                       <span>Name</span><span>Details</span><span className="text-right"> </span>
                     </div>
                   )}
                   {section === "all" && sortedFolders.length > 0 && (
                     <p className="px-3 py-2 border-b border-gray-100 bg-white text-[11px] font-semibold uppercase tracking-wide text-gray-400">Folders</p>
                   )}
                   {sortedFolders.map((folder) => renderRow(
                    <Folder className="w-[18px] h-[18px]" style={{ color: folder.color ?? undefined }} />,
                    folder.name,
                    `${folder.documentCount} files · ${folder.childCount} folders`,
                    folder.id,
                    commonActions.folder(folder),
                     () => navigate(folder.id),
                     { drag: { type: "folder", id: folder.id }, dropTarget: { folderId: folder.id } },
                   ))}
                   {section === "all" && sortedDocs.length > 0 && (
                     <p className="px-3 py-2 border-y border-gray-100 bg-white text-[11px] font-semibold uppercase tracking-wide text-gray-400">Files</p>
                   )}
                   {sortedDocs.map((doc) => renderRow(
                    <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center", fileIconClasses(doc))}><FileText className="w-4 h-4" /></div>,
                    doc.name,
                    `${doc.type} · ${formatSize(doc.size)} · ${new Date(doc.dateModified).toLocaleDateString()}`,
                    doc.id,
                     commonActions.file(doc),
                    () => setPreview(doc),
                    { drag: { type: "file", id: doc.id }, badge: submissionBadge(doc) },
                  ))}
                </>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                   {sortedFolders.map((folder) => renderCard(
                    null, folder, folder.name, `${folder.documentCount} files`, folder.id,
                     () => navigate(folder.id),
                     { drag: { type: "folder", id: folder.id }, dropTarget: { folderId: folder.id }, actions: commonActions.folder(folder) },
                  ))}
                  {sortedDocs.map((doc) => renderCard(
                    doc, null, doc.name, `${doc.type} · ${formatSize(doc.size)}`, doc.id,
                     () => setPreview(doc),
                     { drag: { type: "file", id: doc.id }, badge: submissionBadge(doc), actions: commonActions.file(doc) },
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="mt-3 text-[11px] text-gray-400">
            Single click selects · double click opens · your repository only
          </p>
        </CardContent>
      </Card>

      {/* ── Preview modal ── */}
      <FilePreviewModal
        document={preview}
        onClose={() => setPreview(null)}
        onRename={async (doc, title) => { await renameOnlineDocument(doc.id, title); setPreview(null); await load() }}
        onMove={(doc) => { setPreview(null); openMove("file", doc.id) }}
        onDelete={(doc) => { setPreview(null); setDeleteTarget({ type: "file", id: doc.id, name: doc.name }) }}
      />

      <ShareFolderModal
        open={shareTarget !== null}
        folderId={shareTarget?.id ?? null}
        folderName={shareTarget?.name ?? "Folder"}
        onOpenChange={(open) => { if (!open) setShareTarget(null) }}
        onSuccess={() => void load()}
      />

      {/* ── Folder create/rename dialog ── */}
      <Dialog open={folderDialog.open} onOpenChange={(open) => !open && setFolderDialog({ open: false, mode: "create" })}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg">{folderDialog.mode === "create" ? "New Folder" : "Rename Folder"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Label className="text-[13px] font-medium text-gray-700">Folder Name</Label>
            <Input autoFocus className="h-10" value={folderName} onChange={(e) => setFolderName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submitFolderDialog() }} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFolderDialog({ open: false, mode: "create" })} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => void submitFolderDialog()} disabled={!folderName.trim()} className="h-10 px-5 shadow-soft">
              {folderDialog.mode === "create" ? "Create Folder" : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={folderDetailsTarget !== null} onOpenChange={(open) => !open && setFolderDetailsTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2">
              <Folder className="w-5 h-5" style={{ color: folderDetailsTarget?.folder.color ?? "#F59E0B" }} />
              {folderDetailsTarget?.folder.name}
            </DialogTitle>
            <DialogDescription>Folder details within your private repository.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-3">
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-[11px] text-gray-500">Files</p><p className="mt-1 text-[17px] font-semibold text-gray-900">{folderDetailsTarget?.info?.recursiveDocumentCount ?? folderDetailsTarget?.folder.documentCount ?? "—"}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-[11px] text-gray-500">Subfolders</p><p className="mt-1 text-[17px] font-semibold text-gray-900">{folderDetailsTarget?.info?.childCount ?? folderDetailsTarget?.folder.childCount ?? "—"}</p></div>
            <div className="col-span-2 rounded-lg bg-gray-50 p-3"><p className="text-[11px] text-gray-500">Total size</p><p className="mt-1 text-[14px] font-medium text-gray-900">{folderDetailsTarget?.info ? formatSize(Number(folderDetailsTarget.info.recursiveSizeBytes)) : "Loading…"}</p></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDetailsTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rename file dialog ── */}
      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg">Rename File</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <Label className="text-[13px] font-medium text-gray-700">File Name</Label>
            <Input autoFocus className="h-10" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void submitRename() }} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRenameTarget(null)} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => void submitRename()} disabled={!renameValue.trim()} className="h-10 px-5 shadow-soft">Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Move dialog ── */}
      <Dialog open={moveTarget !== null} onOpenChange={(open) => !open && setMoveTarget(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg">Move to Folder</DialogTitle>
          </DialogHeader>
          <div className="max-h-[300px] overflow-auto rounded-lg border border-border divide-y divide-gray-100">
            {moveOptions.map((option) => (
              <button key={option.id} type="button" onClick={() => setMoveFolderId(option.id)}
                className={cn("w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition-colors",
                  moveFolderId === option.id ? "bg-primary/5 text-primary font-medium" : "text-gray-700 hover:bg-gray-50")}>
                {option.id === "root" ? <FolderOpen className="w-4 h-4 text-gray-400" /> : <Folder className="w-4 h-4 text-amber-500" />}
                {option.name}
              </button>
            ))}
            {moveOptions.length === 1 && <p className="px-3 py-4 text-center text-[12px] text-gray-400">No other folders yet</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setMoveTarget(null)} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => void submitMove()} className="h-10 px-5 shadow-soft">Move Here</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Replace version dialog ── */}
      <Dialog open={versionTarget !== null} onOpenChange={(open) => !open && setVersionTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg">Replace Version</DialogTitle>
            <DialogDescription className="text-[14px]">
              Upload a replacement file for "{versionTarget?.name}". The previous file stays in version history.
            </DialogDescription>
          </DialogHeader>
          <input ref={versionInputRef} type="file" className="hidden" accept={UPLOAD_MIME_TYPES}
            onChange={(e) => { void handleReplaceVersion(e.target.files); e.target.value = "" }} />
          <Button className="h-10 shadow-soft w-full" onClick={() => versionInputRef.current?.click()}>
            <Upload className="w-4 h-4 mr-2" /> Choose Replacement File
          </Button>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> Delete {deleteTarget?.type === "folder" ? "Folder" : "File"}</DialogTitle>
            <DialogDescription className="text-[14px]">
              Move "{deleteTarget?.name}" to the Recycle Bin? It can be restored within 30 days.
              {deleteTarget?.type === "folder" ? " Files inside stay in your repository (unfiled)." : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} className="h-10 px-5">Cancel</Button>
            <Button variant="destructive" onClick={() => void submitDelete()} className="h-10 px-5">Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Folder customize (Rule 31) ── */}
      <Dialog open={customizeTarget !== null} onOpenChange={(open) => !open && setCustomizeTarget(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2"><Palette className="w-5 h-5 text-purple-500" /> Customize Folder</DialogTitle>
            <DialogDescription className="text-[14px]">
              Change the appearance of "{customizeTarget?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-[13px] font-medium mb-1.5 block">Color</Label>
              <div className="flex items-center gap-2 flex-wrap">
                {["#3b82f6","#ef4444","#10b981","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#6b7280"].map((c) => (
                  <button key={c} onClick={() => setCustomizeColor(c)} className={cn("w-8 h-8 rounded-full border-2 transition-all", customizeColor === c ? "border-gray-800 scale-110" : "border-transparent hover:scale-105")} style={{ backgroundColor: c }} title={c} />
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <Input value={customizeColor} onChange={(e) => setCustomizeColor(e.target.value)} placeholder="#3b82f6" className="h-8 text-[12px] w-28 font-mono" />
                <Button variant="ghost" size="sm" className="h-8 text-[12px]" onClick={() => setCustomizeColor("#3b82f6")}><Undo2 className="w-3.5 h-3.5 mr-1" />Reset</Button>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCustomizeTarget(null)} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => { if (customizeTarget) { void customizeFolder(customizeTarget.id, { color: customizeColor }).then(() => { setCustomizeTarget(null); void load() }).catch((e: Error) => toast.error(e.message)) } }} className="h-10 px-5">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Bulk delete confirm (Rule 38) ── */}
      <Dialog open={bulkDeleteConfirm} onOpenChange={(open) => !open && setBulkDeleteConfirm(false)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> Bulk Delete</DialogTitle>
            <DialogDescription className="text-[14px]">
              Move {selectedIds.size} selected items to the Recycle Bin? They can be restored within 30 days.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBulkDeleteConfirm(false)} className="h-10 px-5">Cancel</Button>
            <Button variant="destructive" onClick={() => void submitBulkDelete()} className="h-10 px-5">Delete {selectedIds.size} Items</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Empty Recycle Bin confirm (Rule 38) ── */}
      <Dialog open={emptyBinConfirm} onOpenChange={(open) => !open && setEmptyBinConfirm(false)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" /> Empty Recycle Bin</DialogTitle>
            <DialogDescription className="text-[14px]">
              Permanently delete all items in the Recycle Bin? This action cannot be undone.
              {deletedDocs.length + deletedFolders.length > 0 && (
                <span className="block mt-1 text-red-600 font-medium">
                  {deletedDocs.length + deletedFolders.length} item(s) will be permanently removed.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEmptyBinConfirm(false)} className="h-10 px-5">Cancel</Button>
            <Button variant="destructive" onClick={() => void emptyRecycleBin()} className="h-10 px-5">Permanently Delete All</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Permanent delete confirm ── */}
      <Dialog open={permanentTarget !== null} onOpenChange={(open) => !open && setPermanentTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-red-500" /> Permanently Delete</DialogTitle>
            <DialogDescription className="text-[14px]">
              Permanently delete "{permanentTarget?.name}"? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPermanentTarget(null)} className="h-10 px-5">Cancel</Button>
            <Button variant="destructive" onClick={() => void submitPermanentDelete()} className="h-10 px-5">Permanently Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Name conflict dialog ── */}
      <Dialog open={conflictDialog !== null} onOpenChange={(open) => !open && setConflictDialog(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> File Name Conflict</DialogTitle>
            <DialogDescription className="text-[14px]">
              A file named "{conflictDialog?.name}" already exists in this folder. What would you like to do?
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Button variant="outline" className="h-10 justify-start" onClick={() => { conflictDialog?.resolve("keep_both"); setConflictDialog(null) }}>
              Keep both files
            </Button>
            <Button variant="outline" className="h-10 justify-start text-red-600" onClick={() => { conflictDialog?.resolve("replace"); setConflictDialog(null) }}>
              Replace the existing file
            </Button>
            <Button variant="ghost" className="h-10 justify-start" onClick={() => { conflictDialog?.resolve("cancel"); setConflictDialog(null) }}>
              Cancel upload
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Duplicate-file warning (rule 7) — exact checksum + size match ── */}
      <Dialog open={duplicateDialog !== null} onOpenChange={(open) => !open && setDuplicateDialog(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-amber-500" /> File Already Exists</DialogTitle>
            <DialogDescription className="text-[14px]">
              "{duplicateDialog?.name}" already exists in this folder with the exact same content (checksum and size). Upload anyway?
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Button variant="outline" className="h-10 justify-start" onClick={() => { duplicateDialog?.resolve("keep_both"); setDuplicateDialog(null) }}>
              Upload anyway (keep both)
            </Button>
            <Button variant="ghost" className="h-10 justify-start" onClick={() => { duplicateDialog?.resolve("cancel"); setDuplicateDialog(null) }}>
              Cancel upload
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Restore dialog (rule 10/8) — destination + conflict mode ── */}
      <Dialog open={restoreDialog !== null} onOpenChange={(open) => !open && setRestoreDialog(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg">Restore "{restoreDialog?.name}"</DialogTitle>
            <DialogDescription className="text-[14px]">Choose the destination and how to handle a same-name item.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label className="text-[13px] font-medium text-gray-700">Destination</Label>
              <Select value={restoreTargetFolderId} onValueChange={setRestoreTargetFolderId}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="original">Original location</SelectItem>
                  <SelectItem value="root">My Documents (root)</SelectItem>
                  {folders.filter((f) => {
                    if (restoreDialog?.type === "folder") {
                      const restoringFolder = deletedFolders.find((df) => df.id === restoreDialog.id);
                      return f.id !== restoreDialog.id && f.id !== restoringFolder?.parentId;
                    }
                    return true;
                  }).map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[13px] font-medium text-gray-700">If a same-name item exists</Label>
              <Select value={restoreConflictMode} onValueChange={(v) => setRestoreConflictMode(v as typeof restoreConflictMode)}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Conflict mode" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep_both">Keep both (suffix the name)</SelectItem>
                  <SelectItem value="replace">Replace the existing item</SelectItem>
                  <SelectItem value="cancel">Cancel restore</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRestoreDialog(null)} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => void submitRestoreDialog()} className="h-10 px-5 shadow-soft">Restore</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Copy folder dialog (rule 8/9) — destination + conflict mode ── */}
      <Dialog open={fileCopyDialog !== null} onOpenChange={(open) => !open && setFileCopyDialog(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg">Copy {fileCopyDialog?.docs.length === 1 ? "File" : "Files"}</DialogTitle>
            <DialogDescription className="text-[14px]">Choose a destination and how to handle same-name files. Nothing is copied until you confirm.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label className="text-[13px] font-medium text-gray-700">Destination</Label>
              <Select value={fileCopyDialog?.targetFolderId ?? "root"} onValueChange={(v) => setFileCopyDialog((prev) => prev ? { ...prev, targetFolderId: v } : prev)}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">My Documents (root)</SelectItem>
                  {folders.map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[13px] font-medium text-gray-700">If a same-name file exists</Label>
              <Select value={fileCopyDialog?.conflictMode ?? "keep_both"} onValueChange={(v) => setFileCopyDialog((prev) => prev ? { ...prev, conflictMode: v as "keep_both" | "replace" | "cancel" } : prev)}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Conflict mode" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep_both">Keep both (suffix the name)</SelectItem>
                  <SelectItem value="replace">Replace the existing file</SelectItem>
                  <SelectItem value="cancel">Cancel copy</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFileCopyDialog(null)} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => void submitFileCopyDialog()} className="h-10 px-5 shadow-soft">Copy Here</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkCopyDialog !== null} onOpenChange={(open) => !open && setBulkCopyDialog(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg">Copy {bulkCopyDialog?.items.length ?? 0} Selected Items</DialogTitle>
            <DialogDescription className="text-[14px]">Choose one destination and conflict behavior. Every selected file and folder will be processed after confirmation.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label className="text-[13px] font-medium text-gray-700">Destination</Label>
              <Select value={bulkCopyDialog?.targetFolderId ?? "root"} onValueChange={(v) => setBulkCopyDialog((prev) => prev ? { ...prev, targetFolderId: v } : prev)}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">My Documents (root)</SelectItem>
                  {folders.map((folder) => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[13px] font-medium text-gray-700">If a same-name item exists</Label>
              <Select value={bulkCopyDialog?.conflictMode ?? "keep_both"} onValueChange={(v) => setBulkCopyDialog((prev) => prev ? { ...prev, conflictMode: v as "keep_both" | "replace" | "cancel" } : prev)}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Conflict mode" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep_both">Keep both (suffix names)</SelectItem>
                  <SelectItem value="replace">Replace/merge same-name items</SelectItem>
                  <SelectItem value="cancel">Cancel copy</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setBulkCopyDialog(null)} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => void submitBulkCopyDialog()} className="h-10 px-5 shadow-soft">Copy Here</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Copy folder dialog (rule 8/9) — destination + conflict mode ── */}
      <Dialog open={copyDialog !== null} onOpenChange={(open) => !open && setCopyDialog(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-lg">Copy Folder "{copyDialog?.folder.name}"</DialogTitle>
            <DialogDescription className="text-[14px]">Large folders (1000+ items) copy in the background.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5">
              <Label className="text-[13px] font-medium text-gray-700">Destination</Label>
              <Select value={copyDialog?.targetParentId ?? "root"} onValueChange={(v) => setCopyDialog((prev) => prev ? { ...prev, targetParentId: v } : prev)}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Destination" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="root">My Documents (root)</SelectItem>
                  {folders.filter((f) => f.id !== copyDialog?.folder.id && f.id !== copyDialog?.folder.parentId).map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-[13px] font-medium text-gray-700">If a same-name folder exists</Label>
              <Select value={copyDialog?.conflictMode ?? "keep_both"} onValueChange={(v) => setCopyDialog((prev) => prev ? { ...prev, conflictMode: v as "keep_both" | "merge" | "cancel" } : prev)}>
                <SelectTrigger className="h-10"><SelectValue placeholder="Conflict mode" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep_both">Keep both (suffix the name)</SelectItem>
                  <SelectItem value="merge">Merge into the existing folder</SelectItem>
                  <SelectItem value="cancel">Cancel copy</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCopyDialog(null)} className="h-10 px-5">Cancel</Button>
            <Button onClick={() => void submitCopyDialog()} className="h-10 px-5 shadow-soft">Copy Here</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
})
