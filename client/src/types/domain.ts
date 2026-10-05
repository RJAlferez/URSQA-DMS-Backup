export type UserRole =
  | "super_admin"
  | "qa_office"
  | "department_head"
  | "faculty"
  | "staff"
  | "student"
  | "root"

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  department: string
  departmentId?: string
  avatarSeed?: string
  photoUrl?: string | null
  status: "Active" | "Inactive" | "Suspended"
  phone?: string
  memberSince: string
  lastLogin?: string
  createdAt: string
  updatedAt: string
  permissions?: string[]
}

export interface ServerUser {
  id: string
  employeeId: string
  email: string
  firstName: string
  middleName: string | null
  lastName: string
  suffix: string | null
  status: string
  role: string
  departmentId: string | null
  departmentName: string | null
  createdAt: string
  lastLogin: string | null
  permissions: string[]
  profilePhotoKey?: string | null
}

export interface Department {
  id: string
  name: string
  code: string
  headUserId?: string
  createdAt: string
  updatedAt: string
}

export interface Role {
  id: string
  key: UserRole
  label: string
  description: string
  permissions: RolePermissions
  createdAt: string
  updatedAt: string
}

export interface RolePermissions {
  canUpload: boolean
  canApprove: boolean
  canReject: boolean
  canDelete: boolean
  canManageUsers: boolean
  canViewAuditLogs: boolean
  canManageAACCUP: boolean
  canExport: boolean
  canArchive: boolean
  canAssignTasks: boolean
  canRestore: boolean
  canManageSettings: boolean
  canViewReports: boolean
}

export type DocumentStatus =
  | "Draft"
  | "Pending"
  | "Department Review"
  | "QA Review"
  | "In Review"
  | "Approved"
  | "Archived"
  | "Returned"
  | "Rejected"
  | "Withdrawn"

export interface Category {
  id: string
  name: string
  parentId?: string
  area?: string
  createdAt: string
  updatedAt: string
}

export interface DocumentVersion {
  id: string
  documentId: string
  versionNumber: number
  blobId: string
  fileName: string
  fileSize: number
  mimeType: string
  uploadedBy: string
  uploadedAt: string
  changeNote?: string
}

export interface Document {
  id: string
  name: string
  type: string
  categoryId: string
  categoryName: string
  area: string
  department: string
  ownerId: string
  ownerName: string
  size: number
  status: DocumentStatus
  blobId: string
  currentVersionId: string
  versionCount: number
  archived: boolean
  dateModified: string
  dateCreated: string
  mimeType: string
  tags: string[]
  folderId?: string | null
  createdAt: string
  updatedAt: string
  /** SHA-256 of the current version's bytes (rule 7 duplicate detection). */
  checksum?: string | null
  /** Latest AACCUP submission status of this file (rule 17 badges). */
  submissionStatus?: "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_REVISION" | "WITHDRAWN" | null
  /** Soft-delete timestamp (recycle bin rows). */
  deletedAt?: string | null
}

export type RequestStatus =
  | "Draft"
  | "Pending"
  | "Approved"
  | "Fulfilled"
  | "Rejected"
  | "In Review"

export interface RequestDocumentRef {
  documentId: string
  documentName: string
}

export interface DocumentRequest {
  id: string
  title: string
  purpose: string
  remarks?: string
  priority: "Normal" | "Urgent"
  submittedBy: string
  submittedByName: string
  department: string
  documents: RequestDocumentRef[]
  status: RequestStatus
  dateSubmitted: string
  handledBy?: string
  handledByName?: string
  handledAt?: string
  createdAt: string
  updatedAt: string
}

export interface ApprovalRecord {
  id: string
  submissionId: string
  approverId: string
  approverName: string
  decision: "Approved" | "Rejected" | "Returned"
  comment?: string
  timestamp: string
}

export interface Comment {
  id: string
  targetId: string
  targetType: "document" | "request" | "submission" | "task"
  authorId: string
  authorName: string
  content: string
  createdAt: string
}

export interface Template {
  id: string
  name: string
  category: string
  description: string
  fields: string[]
  createdAt: string
  updatedAt: string
}

export interface StorageStats {
  totalUsed: number
  quota: number
  fileCount: number
}

export interface UserSession {
  id: string
  userId: string
  token: string
  device: string
  browser: string
  os: string
  ipAddress: string
  location: string
  lastActive: string
  createdAt: string
  expiresAt?: string
  current?: boolean
}

export type NotificationType =
  | "upload"
  | "approval"
  | "rejection"
  | "request"
  | "mention"
  | "system"
  | "document"
  | "submission"
  | "task"

export interface Notification {
  id: string
  userId: string
  type: NotificationType
  title: string
  message: string
  read: boolean
  link?: string
  entity?: string
  entityId?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export type AACCUPAreaStatus =
  | "Completed"
  | "In Progress"
  | "Pending"
  | "Overdue"

export interface Requirement {
  id: string
  title: string
  completed: boolean
  uploadedDocId?: string
}

export interface AACCUPArea {
  id: string
  number: number
  areaSet: "aaccup" | "iso" | "cert"
  title: string
  description: string
  status: AACCUPAreaStatus
  completion: number
  dueDate: string
  requirements: Requirement[]
  assignees: string[]
  recentActivity: { id: string; type: "upload" | "comment" | "status"; message: string; at: string }[]
  createdAt: string
  updatedAt: string
}

export interface UploadProgress {
  id: string
  fileName: string
  progress: number
  status: "uploading" | "completed" | "failed"
  startedAt: string
}

export interface AppSettings {
  id: string
  theme: "light" | "dark" | "system"
  uploadSizeLimit: number
  retentionDays: number
  language: "en" | "fil"
  timezone: string
  dateFormat: "mdy" | "dmy" | "ymd"
  defaultDashboardView: "overview" | "submissions" | "documents"
  notifications: {
    submissions: boolean
    approvals: boolean
    announcements: boolean
    security: boolean
  }
  compactMode: boolean
  collapsedSidebar: boolean
  storageQuotaGB: number
}
