import { API_BASE, apiGet, apiGetPage, apiPost, apiPatch, apiDelete, getAccessToken } from "@/lib/http"
import { sha256 as sha256Buffer } from "@/lib/sha256"
import type { Document, DocumentStatus } from "@/types/domain"

interface OnlineDocumentRow {
  id: string
  title: string
  status: "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "PUBLISHED" | "ARCHIVED"
  ownerId: string
  ownerName: string
  departmentId: string | null
  departmentName: string | null
  folderId: string | null
  currentVersionId: string | null
  currentVersionNumber: number | null
  currentFilename: string | null
  currentMimeType: string | null
  currentSizeBytes: string | null
  currentChecksum?: string | null
  submissionStatus?: "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_REVISION" | null
  metadata: Record<string, unknown> | null
  tags: string[]
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

interface DownloadResult {
  url: string
  filename: string
  mimeType?: string
}

function documentStatus(status: OnlineDocumentRow["status"]): DocumentStatus {
  switch (status) {
    case "APPROVED":
    case "PUBLISHED": return "Approved"
    case "ARCHIVED": return "Archived"
    case "UNDER_REVIEW": return "In Review"
    default: return "Pending"
  }
}

function extension(filename: string | null): string {
  return filename?.split(".").pop()?.toUpperCase() || "FILE"
}

function toLegacyDocument(row: OnlineDocumentRow): Document | null {
  if (!row.currentVersionId || !row.currentFilename) return null
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {}
  return {
    id: row.id,
    name: row.title,
    type: extension(row.currentFilename),
    categoryId: "online",
    categoryName: typeof metadata.requirementCode === "string" ? metadata.requirementCode : "Online Repository",
    area: typeof metadata.aaccupAreaName === "string" ? metadata.aaccupAreaName : "Repository",
    department: row.departmentName ?? "Unassigned",
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    folderId: row.folderId,
    size: Number(row.currentSizeBytes ?? 0),
    status: documentStatus(row.status),
    blobId: `online:${row.id}`,
    currentVersionId: row.currentVersionId,
    versionCount: row.currentVersionNumber ?? 1,
    archived: row.status === "ARCHIVED",
    dateModified: row.updatedAt,
    dateCreated: row.createdAt,
    mimeType: row.currentMimeType ?? "application/octet-stream",
    tags: row.tags,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    checksum: row.currentChecksum ?? null,
    submissionStatus: row.submissionStatus ?? null,
    deletedAt: row.deletedAt ?? null,
  }
}

export async function listOnlineDocuments(options?: {
  search?: string
  ownerId?: string
  archived?: boolean
  departmentId?: string
  folderId?: string | null
}): Promise<Document[]> {
  const params = new URLSearchParams({ page: "1", pageSize: "100" })
  if (options?.search) params.set("q", options.search)
  if (options?.ownerId) params.set("ownerId", options.ownerId)
  if (options?.archived === true) params.set("status", "ARCHIVED")
  if (options?.departmentId) params.set("departmentId", options.departmentId)
  if (options?.folderId !== undefined) params.set("folderId", options.folderId ?? "null")
  const first = await apiGetPage<OnlineDocumentRow>(`/documents?${params.toString()}`)
  const remaining = await Promise.all(
    Array.from({ length: Math.max(0, first.meta.totalPages - 1) }, (_, index) => {
      params.set("page", String(index + 2))
      return apiGetPage<OnlineDocumentRow>(`/documents?${params.toString()}`)
    }),
  )
  return [...first.items, ...remaining.flatMap((page) => page.items)]
    .map(toLegacyDocument)
    .filter((document): document is Document => {
      if (document === null) return false
      if (options?.archived === false) return !document.archived
      if (options?.archived === true) return document.archived
      return true
    })
}

export async function getOnlineDocument(id: string): Promise<Document | null> {
  try {
    const row = await apiGet<OnlineDocumentRow>(`/documents/${encodeURIComponent(id)}`)
    return toLegacyDocument(row)
  } catch {
    return null
  }
}

export async function deleteOnlineDocument(id: string): Promise<void> {
  await apiDelete<{ success: true }>(`/documents/${encodeURIComponent(id)}`)
}

export async function updateOnlineDocumentStatus(
  id: string,
  status: "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "PUBLISHED" | "ARCHIVED",
): Promise<void> {
  await apiPatch<{ success: true }>(`/documents/${encodeURIComponent(id)}`, { status })
}

/** Rename a document (title only). */
export async function renameOnlineDocument(id: string, title: string): Promise<void> {
  await apiPatch<{ success: true }>(`/documents/${encodeURIComponent(id)}`, { title })
}

/** Move a document into a folder (null = repository root). */
export async function moveOnlineDocument(id: string, folderId: string | null): Promise<void> {
  await apiPatch<{ success: true }>(`/documents/${encodeURIComponent(id)}`, { folderId })
}

/** Restore a soft-deleted document from the recycle bin (conflict-aware).
 * Omit `targetFolderId` to restore to the original location (rule 10). */
export async function restoreOnlineDocument(
  id: string,
  input?: { targetFolderId?: string | null; conflictMode?: "keep_both" | "replace" | "cancel" },
): Promise<void> {
  await apiPost<{ success: true }>(`/documents/${encodeURIComponent(id)}/restore`, {
    ...(input?.targetFolderId !== undefined ? { targetFolderId: input.targetFolderId } : {}),
    conflictMode: input?.conflictMode ?? "keep_both",
  })
}

export interface DocumentActivity {
  downloadCount: number
  events: Array<{
    id: string
    action: string
    status: string
    timestamp: string
    actorName: string | null
    actorEmail: string | null
    details: Record<string, unknown> | null
  }>
}

/** Per-file Details / Activity view (rule 18). */
export async function getDocumentActivity(id: string): Promise<DocumentActivity> {
  return apiGet<DocumentActivity>(`/documents/${encodeURIComponent(id)}/activity`)
}

/** Copy a document to a folder (or root). conflictMode: keep_both | replace | cancel. */
export async function copyOnlineDocument(
  id: string,
  input: { targetFolderId?: string | null; conflictMode?: "keep_both" | "replace" | "cancel" },
): Promise<Document> {
  const row = await apiPost<OnlineDocumentRow>(`/documents/${encodeURIComponent(id)}/copy`, {
    targetFolderId: input.targetFolderId ?? null,
    conflictMode: input.conflictMode ?? "keep_both",
  })
  return toLegacyDocument(row) as Document
}

/** Permanently delete a document (snapshot-guarded; irreversible). */
export async function permanentDeleteOnlineDocument(id: string): Promise<void> {
  await apiDelete<{ success: true }>(`/documents/${encodeURIComponent(id)}/permanent`)
}

/** List the owner's deleted documents (recycle bin). */
export async function listDeletedOnlineDocuments(): Promise<Document[]> {
  return apiGet<OnlineDocumentRow[]>("/documents/deleted").then((rows) =>
    rows.map(toLegacyDocument).filter((d): d is Document => d !== null),
  )
}

/** List the owner's Requested Documents (delivered via approved requests). */
export async function listRequestedOnlineDocuments(): Promise<Document[]> {
  return apiGet<OnlineDocumentRow[]>("/documents/requested").then((rows) =>
    rows.map(toLegacyDocument).filter((d): d is Document => d !== null),
  )
}

export async function favoriteOnlineDocument(id: string): Promise<void> {
  await apiPost<{ favorited: true }>(`/documents/${encodeURIComponent(id)}/favorite`)
}

export async function unfavoriteOnlineDocument(id: string): Promise<void> {
  await apiDelete<{ favorited: false }>(`/documents/${encodeURIComponent(id)}/favorite`)
}

export async function listFavoriteOnlineDocuments(): Promise<Document[]> {
  return apiGet<OnlineDocumentRow[]>("/documents/favorites").then((rows) =>
    rows.map(toLegacyDocument).filter((d): d is Document => d !== null),
  )
}

export interface RecentItem {
  itemType: "FILE" | "FOLDER"
  itemId: string
  name: string
  lastOpenedAt: string
}

export async function listOnlineRecents(): Promise<RecentItem[]> {
  return apiGet<RecentItem[]>("/documents/recents")
}

/** Add a NEW version of an existing document (version + upload + verify). */
export async function addOnlineDocumentVersion(
  documentId: string,
  input: { file: File; changeNote?: string },
): Promise<Document> {
  const checksum = await sha256(input.file)
  const version = await apiPost<OnlineDocumentVersionResult>(
    `/documents/${encodeURIComponent(documentId)}/version`,
    {
      filename: input.file.name,
      mimeType: inferredMimeType(input.file),
      sizeBytes: input.file.size,
      checksum,
      changeNote: input.changeNote ?? "New version",
    },
  )
  const uploadedVersion = version.document.versions.find((item) => item.checksum === checksum)
  if (!uploadedVersion) throw new Error("Document version was not created")
  await putObjectWithXhr(version, input.file).done
  await apiPost<{ verified: true }>(
    `/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(uploadedVersion.id)}/verify`,
  )
  const row = await apiGet<OnlineDocumentRow>(`/documents/${encodeURIComponent(documentId)}`)
  return toLegacyDocument(row) as Document
}

// ── Upload pipeline (create → version → presigned PUT → verify) ────────────

interface OnlineDocumentCreateResult {
  document: { id: string; versions: Array<{ id: string; checksum: string }> }
}

interface OnlineDocumentVersionResult {
  document: { id: string; versions: Array<{ id: string; checksum: string; versionNumber: number }> }
  upload: { url: string; headers: Record<string, string> }
}

function inferredMimeType(file: File): string {
  if (file.type) return file.type
  const extension = file.name.split(".").pop()?.toLowerCase()
  const types: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    csv: "text/csv",
    txt: "text/plain",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
  }
  return types[extension ?? ""] ?? "application/octet-stream"
}

async function sha256(file: File): Promise<string> {
  return sha256Buffer(await file.arrayBuffer())
}

export interface OnlineDocumentUploadInput {
  title: string
  description?: string
  departmentId?: string | null
  folderId?: string | null
  classification?: "PUBLIC" | "INTERNAL" | "RESTRICTED" | "CONFIDENTIAL"
  metadata?: Record<string, unknown>
  tags?: string[]
  file: File
  changeNote?: string
}

export async function uploadOnlineDocument(input: OnlineDocumentUploadInput): Promise<Document> {
  const created = await apiPost<OnlineDocumentCreateResult>("/documents", {
    title: input.title,
    description: input.description,
    classification: input.classification ?? "INTERNAL",
    departmentId: input.departmentId ?? null,
    folderId: input.folderId ?? null,
    metadata: input.metadata,
    tags: input.tags,
  })
  const checksum = await sha256(input.file)
  const version = await apiPost<OnlineDocumentVersionResult>(
    `/documents/${encodeURIComponent(created.document.id)}/version`,
    {
      filename: input.file.name,
      mimeType: inferredMimeType(input.file),
      sizeBytes: input.file.size,
      checksum,
      changeNote: input.changeNote ?? "Initial upload",
    },
  )
  const uploadedVersion = version.document.versions.find((item) => item.checksum === checksum)
  if (!uploadedVersion) throw new Error("Document version was not created")

  await putObjectWithXhr(version, input.file).done

  await apiPost<{ verified: true }>(
    `/documents/${encodeURIComponent(created.document.id)}/versions/${encodeURIComponent(uploadedVersion.id)}/verify`,
  )
  const row = await apiGet<OnlineDocumentRow>(`/documents/${encodeURIComponent(created.document.id)}`)
  return toLegacyDocument(row) as Document
}

/**
 * Upload that reports real progress and supports abort. The presigned PUT is
 * executed through XMLHttpRequest so `upload.onprogress` yields honest
 * bytes-transferred percentages; the returned XHR lets callers cancel the
 * in-flight object upload.
 */
export async function uploadOnlineDocumentWithProgress(
  input: OnlineDocumentUploadInput,
  onProgress?: (fraction: number) => void,
  signal?: { xhr?: XMLHttpRequest; onXhr?: (xhr: XMLHttpRequest) => void },
): Promise<Document> {
  const created = await apiPost<OnlineDocumentCreateResult>("/documents", {
    title: input.title,
    description: input.description,
    classification: input.classification ?? "INTERNAL",
    departmentId: input.departmentId ?? null,
    folderId: input.folderId ?? null,
    metadata: input.metadata,
    tags: input.tags,
  })
  onProgress?.(0.05)
  const checksum = await sha256(input.file)
  const version = await apiPost<OnlineDocumentVersionResult>(
    `/documents/${encodeURIComponent(created.document.id)}/version`,
    {
      filename: input.file.name,
      mimeType: inferredMimeType(input.file),
      sizeBytes: input.file.size,
      checksum,
      changeNote: input.changeNote ?? "Initial upload",
    },
  )
  const uploadedVersion = version.document.versions.find((item) => item.checksum === checksum)
  if (!uploadedVersion) throw new Error("Document version was not created")

  const { xhr, done } = putObjectWithXhr(version, input.file, (fraction) => onProgress?.(0.05 + fraction * 0.9))
  signal?.onXhr?.(xhr)
  if (signal) signal.xhr = xhr
  await done

  onProgress?.(0.95)
  await apiPost<{ verified: true }>(
    `/documents/${encodeURIComponent(created.document.id)}/versions/${encodeURIComponent(uploadedVersion.id)}/verify`,
  )
  onProgress?.(1)
  const row = await apiGet<OnlineDocumentRow>(`/documents/${encodeURIComponent(created.document.id)}`)
  return toLegacyDocument(row) as Document
}

function putObjectWithXhr(
  version: OnlineDocumentVersionResult,
  file: File,
  onProgress?: (fraction: number) => void,
): { xhr: XMLHttpRequest; done: Promise<void> } {
  const headers = Object.fromEntries(
    Object.entries(version.upload.headers).filter(([key]) => key.toLowerCase() !== "content-length"),
  )
  const xhr = new XMLHttpRequest()
  const done = new Promise<void>((resolve, reject) => {
    xhr.open("PUT", version.upload.url)
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`Object upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error("Object upload failed (network error)"))
    xhr.onabort = () => reject(new Error("Upload canceled"))
    xhr.send(file)
  })
  return { xhr, done }
}

export function isOnlineDocument(document: Document): boolean {
  return document.blobId.startsWith("online:")
}

export async function getOnlineDocumentUrl(document: Document, preview = false): Promise<string> {
  const endpoint = preview ? "preview" : "download"
  const result = await apiGet<DownloadResult>(`/documents/${encodeURIComponent(document.id)}/${endpoint}`)
  return result.url
}

export async function getOnlineDocumentThumbnail(document: Document): Promise<string> {
  const token = getAccessToken()
  const response = await fetch(`${API_BASE}/documents/${encodeURIComponent(document.id)}/thumbnail`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!response.ok) throw new Error(`Thumbnail request failed (${response.status})`)
  return URL.createObjectURL(await response.blob())
}

export async function openOnlineDocument(document: Document, preview = false): Promise<void> {
  const url = await getOnlineDocumentUrl(document, preview)
  window.open(url, "_blank", "noopener,noreferrer")
}

// ── Repository folders (server-backed; replaces the hardcoded UI tree) ──────

export interface RepositoryFolderNode {
  id: string
  parentId: string | null
  name: string
  description: string | null
  level: number
  sortOrder: number
  icon: string | null
  color: string | null
  visibility: "VISIBLE" | "HIDDEN"
  status: "ACTIVE" | "INACTIVE"
  children: RepositoryFolderNode[]
}

export interface RepositoryLegacyFolder {
  id: string
  name: string
  parentId: string | null
  departmentId: string | null
  ownerId: string | null
  documentCount: number
  childCount: number
  createdAt: string
  updatedAt: string
}

export interface ResolvedRepositoryStructure {
  source: "template" | "legacy" | "none"
  template: {
    id: string
    name: string
    code: string
    icon: string | null
    color: string | null
  } | null
  assignment: { id: string; targetType: string; targetId: string | null } | null
  tree: RepositoryFolderNode[]
  legacyFolders: RepositoryLegacyFolder[]
}

export async function resolveRepositoryStructure(): Promise<ResolvedRepositoryStructure> {
  return apiGet<ResolvedRepositoryStructure>("/folders/resolve")
}

export async function createRepositoryFolder(input: {
  name: string
  parentId?: string | null
  departmentId?: string | null
}): Promise<{ id: string; name: string; parentId: string | null }> {
  return apiPost<{ id: string; name: string; parentId: string | null }>("/folders", input)
}

export interface RepositoryFolderRow {
  id: string
  name: string
  parentId: string | null
  departmentId: string | null
  ownerId: string | null
  color: string | null
  icon: string | null
  documentCount: number
  childCount: number
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

/** List folders at one level of the tree (parentId = null → root). */
export async function listRepositoryFolders(options?: {
  parentId?: string | null
  ownerId?: string
  q?: string
}): Promise<RepositoryFolderRow[]> {
  const params = new URLSearchParams()
  if (options?.parentId !== undefined) params.set("parentId", options.parentId ?? "null")
  if (options?.ownerId) params.set("ownerId", options.ownerId)
  if (options?.q) params.set("q", options.q)
  const qs = params.size > 0 ? `?${params.toString()}` : ""
  return apiGet<RepositoryFolderRow[]>(`/folders${qs}`)
}

export type FolderSharePermission = "VIEWER" | "EDITOR"
export interface FolderShareRow {
  id: string
  recipientType: "USER" | "DEPARTMENT"
  userId: string | null
  departmentId: string | null
  permission: "READ" | "WRITE"
  user?: { firstName: string; lastName: string; email: string } | null
  department?: { name: string; code: string } | null
}
export interface ShareableUser { id: string; firstName: string; lastName: string; departmentId: string | null }
export interface SharedFolderRow extends RepositoryFolderRow { permission: "VIEWER" | "EDITOR"; shareId: string }

export async function listFolderShares(folderId: string): Promise<FolderShareRow[]> {
  return apiGet<FolderShareRow[]>(`/folders/${encodeURIComponent(folderId)}/shares`)
}
export async function shareRepositoryFolder(folderId: string, input: { recipientType: "USER" | "DEPARTMENT"; userIds?: string[]; departmentId?: string; permission: FolderSharePermission }): Promise<FolderShareRow[]> {
  return apiPost<FolderShareRow[]>(`/folders/${encodeURIComponent(folderId)}/shares`, input)
}
export async function updateFolderShare(folderId: string, shareId: string, permission: FolderSharePermission): Promise<FolderShareRow> {
  return apiPatch<FolderShareRow>(`/folders/${encodeURIComponent(folderId)}/shares/${encodeURIComponent(shareId)}`, { permission })
}
export async function removeFolderShare(folderId: string, shareId: string): Promise<void> {
  await apiDelete<{ success: true }>(`/folders/${encodeURIComponent(folderId)}/shares/${encodeURIComponent(shareId)}`)
}
export async function listShareableUsers(): Promise<ShareableUser[]> {
  return apiGet<ShareableUser[]>("/folders/shareable-users")
}
export async function listSharedWithMe(): Promise<SharedFolderRow[]> {
  return apiGet<SharedFolderRow[]>("/folders/shared-with-me")
}

export async function renameRepositoryFolder(id: string, name: string): Promise<RepositoryFolderRow> {
  return apiPatch<RepositoryFolderRow>(`/folders/${encodeURIComponent(id)}`, { name })
}

export async function customizeFolder(id: string, patch: { color?: string | null; icon?: string | null }): Promise<RepositoryFolderRow> {
  return apiPatch<RepositoryFolderRow>(`/folders/${encodeURIComponent(id)}`, patch)
}

/** Move a folder under a new parent (null = repository root). */
export async function moveRepositoryFolder(id: string, parentId: string | null): Promise<RepositoryFolderRow> {
  return apiPatch<RepositoryFolderRow>(`/folders/${encodeURIComponent(id)}`, { parentId })
}

export async function deleteRepositoryFolder(id: string): Promise<void> {
  await apiDelete<{ success: true }>(`/folders/${encodeURIComponent(id)}`)
}

/** Restore a soft-deleted folder (and its still-deleted subtree).
 * Omit `targetParentId` to restore to the original location (rule 10). */
export async function restoreRepositoryFolder(
  id: string,
  input?: { targetParentId?: string | null; conflictMode?: "keep_both" | "replace" | "cancel" },
): Promise<void> {
  await apiPost<{ success: true }>(`/folders/${encodeURIComponent(id)}/restore`, {
    ...(input?.targetParentId !== undefined ? { targetParentId: input.targetParentId } : {}),
    conflictMode: input?.conflictMode ?? "keep_both",
  })
}

export interface FolderInfo {
  folderId: string
  documentCount: number
  childCount: number
  recursiveDocumentCount: number
  recursiveSizeBytes: string
  depth: number
}

/** Recursive counts + size for a folder (rule 12). */
export async function getFolderInfo(id: string): Promise<FolderInfo> {
  return apiGet<FolderInfo>(`/folders/${encodeURIComponent(id)}/info`)
}

export interface FolderCopyJob {
  id: string
  sourceFolderId: string | null
  sourceFolderName: string | null
  targetParentId: string | null
  conflictMode: string
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED"
  totalItems: number
  processedItems: number
  error: string | null
  resultFolderId: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface FolderCopyResult {
  folder?: RepositoryFolderRow
  job?: FolderCopyJob
}

/** Copy a folder subtree; large copies return a persisted background job. */
export async function copyRepositoryFolder(
  id: string,
  input?: { targetParentId?: string | null; conflictMode?: "merge" | "keep_both" | "cancel" },
): Promise<FolderCopyResult> {
  return apiPost<FolderCopyResult>(`/folders/${encodeURIComponent(id)}/copy`, {
    targetParentId: input?.targetParentId ?? null,
    conflictMode: input?.conflictMode ?? "keep_both",
  })
}

/** List the owner's persisted background copy jobs. */
export async function listCopyJobs(): Promise<FolderCopyJob[]> {
  return apiGet<FolderCopyJob[]>("/folders/jobs")
}

/** Poll one background copy job. */
export async function getCopyJob(id: string): Promise<FolderCopyJob> {
  return apiGet<FolderCopyJob>(`/folders/jobs/${encodeURIComponent(id)}`)
}

/** Download a folder as a streaming ZIP (rule 14); saves via a blob. */
export async function downloadFolderZip(folderId: string, folderName: string): Promise<void> {
  const token = getAccessToken()
  const response = await fetch(`${API_BASE}/folders/${encodeURIComponent(folderId)}/zip`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) throw new Error(`ZIP download failed (${response.status})`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${folderName.replace(/[^\w -]/g, "").trim().replace(/\s+/g, "-") || "folder"}.zip`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** Permanently delete a folder subtree (irreversible). */
export async function permanentDeleteRepositoryFolder(id: string): Promise<void> {
  await apiDelete<{ success: true }>(`/folders/${encodeURIComponent(id)}/permanent`)
}

/** List the owner's deleted folders (recycle bin). */
export async function listDeletedRepositoryFolders(): Promise<RepositoryFolderRow[]> {
  return apiGet<RepositoryFolderRow[]>("/folders/deleted")
}

export async function pinRepositoryFolder(id: string): Promise<void> {
  await apiPost<{ pinned: true }>(`/folders/${encodeURIComponent(id)}/pin`)
}

export async function unpinRepositoryFolder(id: string): Promise<void> {
  await apiDelete<{ pinned: false }>(`/folders/${encodeURIComponent(id)}/pin`)
}

export async function listPinnedRepositoryFolders(): Promise<RepositoryFolderRow[]> {
  return apiGet<RepositoryFolderRow[]>("/folders/pins")
}
