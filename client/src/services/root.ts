// =============================================================================
// URS-DMS Ã¢â‚¬â€ Root Console service (Sprint 7.4.1)
// -----------------------------------------------------------------------------
// Follows the Sprint 4 precedent (requests module): the Root Console talks to
// the REAL /api/v1/root endpoints through the shared http.ts client. The
// client-side prototype auth (IndexedDB) is untouched Ã¢â‚¬â€ a ROOT user gets a
// real JWT via the server login bridge (see `login` below) so the /root/*
// endpoints can be called with a valid Bearer token.
// =============================================================================

import { apiGet, apiGetPage, apiPatch, apiPost, apiDelete, ApiRequestError, clearServerToken } from "@/lib/http"

// Ã¢â€â‚¬Ã¢â€â‚¬ Wire shapes (mirror of server root.config.types.ts) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export type ConfigValueType = "STRING" | "NUMBER" | "BOOLEAN" | "JSON" | "LIST"

export type ConfigStatus = "ACTIVE" | "INACTIVE"

export type ConfigHistoryAction =
  | "CREATED"
  | "UPDATED"
  | "DELETED"
  | "RESTORED"
  | "ROLLED_BACK"

export interface RootConfigCategory {
  id: string
  code: string
  name: string
  description: string | null
  displayOrder: number
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

export interface RootConfig {
  id: string
  category: { code: string; name: string }
  key: string
  name: string
  description: string | null
  value: unknown
  valueType: ConfigValueType
  status: ConfigStatus
  version: number
  isSystem: boolean
  createdBy: string | null
  createdByName: string | null
  updatedBy: string | null
  updatedByName: string | null
  createdAt: string
  updatedAt: string
}

export interface RootConfigVersion {
  id: string
  configurationKey: string
  configurationName: string
  version: number
  value: unknown
  changeNote: string | null
  changedBy: string | null
  changedByName: string | null
  createdAt: string
}

export interface RootConfigHistoryEntry {
  id: string
  configurationId: string
  configurationKey: string
  configurationName: string
  categoryCode: string
  action: ConfigHistoryAction
  oldValue: unknown
  newValue: unknown
  versionFrom: number | null
  versionTo: number | null
  actorId: string | null
  actorName: string | null
  createdAt: string
}

export interface RootListMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface RootListResult<T> {
  items: T[]
  meta: RootListMeta
}

export interface RootPlatformOverview {
  platform: {
    status: string
    uptimeSeconds: number
    environment: string
    version: string
    timestamp: string
  }
  configuration: {
    totalConfigs: number
    totalVersions: number
    currentVersion: number
    lastUpdated: string | null
    cache: { size: number; ttlMs: number }
  }
  activeModules: { module: string; permissionCount: number }[]
  storage: { totalDocuments: number; totalBytes: string; archivedDocuments: number }
  database: { status: string; latencyMs: number }
  minio: { status: string; bucket: string; exists: boolean }
  api: { status: string; version: string; routesMounted: string }
  queue: { emailPending: number; emailFailed: number; emailTotal: number }
  recentChanges: RootConfigHistoryEntry[]
}

export interface RootSystemUser {
  id: string
  employeeId: string | null
  email: string
  firstName: string
  middleName: string | null
  lastName: string
  suffix: string | null
  status: string
  roleId: string
  roleName: string
  departmentId: string | null
  departmentName: string | null
  collegeId: string | null
  collegeName: string | null
  mustChangePassword: boolean
  lastLogin: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface RootAuditEntry {
  id: string
  timestamp: string
  action: string
  module: string
  status: string
  user: { id: string; name: string; email: string; role: string } | null
  entity: { type: string; id: string } | null
  ipAddress: string | null
  userAgent: string | null
  category?: string
  severity?: string
  result?: string
  targetName?: string | null
  actorName?: string | null
  actorRole?: string | null
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Server session bridge (Sprint 7.4.1) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// The prototype client authenticates locally (IndexedDB); the /root/*
// endpoints require a real server JWT. When a ROOT user logs in through the
// UI we exchange credentials with the backend once and store the JWT in
// localStorage, where http.ts picks it up for every subsequent call.

const SERVER_TOKEN_KEY = "urs_dms_server_token"

export function hasServerSession(): boolean {
  try {
    return Boolean(localStorage.getItem(SERVER_TOKEN_KEY))
  } catch {
    return false
  }
}

export async function openServerSession(identifier: string, password: string): Promise<boolean> {
  clearServerToken()
  try {
    const data = await apiPost<{ accessToken: string }>("/auth/login", { identifier, password })
    localStorage.setItem(SERVER_TOKEN_KEY, data.accessToken)
    return true
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) return false
    return false
  }
}

export async function closeServerSession(): Promise<void> {
  try {
    if (hasServerSession()) await apiPost<{ success: true }>("/auth/logout", {})
  } catch {
    // Logout is idempotent; local token removal must still happen offline.
  } finally {
    clearServerToken()
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Value helpers Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export function formatConfigValue(value: unknown): string {
  if (value === null || value === undefined) return "Ã¢â‚¬â€"
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export function parseConfigValue(raw: string, valueType: ConfigValueType): unknown {
  switch (valueType) {
    case "NUMBER": {
      const n = Number(raw)
      return Number.isFinite(n) ? n : raw
    }
    case "BOOLEAN":
      return raw === "true"
    case "LIST":
      return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    case "JSON": {
      try {
        return JSON.parse(raw)
      } catch {
        return raw
      }
    }
    default:
      return raw
  }
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Platform Overview Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export async function getOverview(): Promise<RootPlatformOverview> {
  return apiGet<RootPlatformOverview>("/root/overview")
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Configuration Engine Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export async function listConfigurations(query?: {
  page?: number
  pageSize?: number
  category?: string
  status?: string
  q?: string
}): Promise<RootListResult<RootConfig>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.category) params.set("category", query.category)
  if (query?.status) params.set("status", query.status)
  if (query?.q) params.set("q", query.q)
  const qs = params.toString() ? `?${params.toString()}` : ""
  return apiGetPage<RootConfig>(`/root/config${qs}`)
}

export async function listCategories(): Promise<RootConfigCategory[]> {
  return apiGet<RootConfigCategory[]>("/root/config/categories")
}

export async function categoryConfigurations(code: string): Promise<RootConfig[]> {
  return apiGet<RootConfig[]>(`/root/config/${encodeURIComponent(code)}`)
}

export async function updateConfigurations(
  items: { key: string; value: unknown; changeNote?: string }[],
): Promise<RootConfig[]> {
  return apiPatch<RootConfig[]>("/root/config", { items })
}

export async function deleteConfiguration(key: string): Promise<RootConfig> {
  return apiDelete<RootConfig>(`/root/config/${encodeURIComponent(key)}`)
}

export async function restoreConfiguration(key: string): Promise<RootConfig> {
  return apiPost<RootConfig>(`/root/config/${encodeURIComponent(key)}/restore`)
}

export async function listVersions(key: string): Promise<RootConfigVersion[]> {
  return apiGet<RootConfigVersion[]>(`/root/config/${encodeURIComponent(key)}/versions`)
}

export async function rollbackConfiguration(
  key: string,
  toVersion: number,
  changeNote?: string,
): Promise<RootConfig> {
  return apiPost<RootConfig>("/root/config/rollback", { key, toVersion, changeNote })
}

export async function listHistory(query?: {
  page?: number
  pageSize?: number
  key?: string
  action?: string
  from?: string
  to?: string
}): Promise<RootListResult<RootConfigHistoryEntry>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.key) params.set("key", query.key)
  if (query?.action) params.set("action", query.action)
  if (query?.from) params.set("from", query.from)
  if (query?.to) params.set("to", query.to)
  const qs = params.toString() ? `?${params.toString()}` : ""
  return apiGetPage<RootConfigHistoryEntry>(`/root/config/history${qs}`)
}

// Ã¢â€â‚¬Ã¢â€â‚¬ System Users (ROOT has full access; reuses the admin users surface) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export async function listSystemUsers(query?: {
  page?: number
  pageSize?: number
  search?: string
  status?: string
  role?: string
}): Promise<RootListResult<RootSystemUser>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.search) params.set("search", query.search)
  if (query?.status) params.set("status", query.status)
  if (query?.role) params.set("role", query.role)
  const qs = params.toString() ? `?${params.toString()}` : ""
  return apiGetPage<RootSystemUser>(`/admin/users${qs}`)
}

// Ã¢â€â‚¬Ã¢â€â‚¬ System Audit (ROOT has audit.read; reuses the shared audit surface) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export async function listSystemAudit(query?: {
  page?: number
  pageSize?: number
  q?: string
  module?: string
  action?: string
  status?: string
}): Promise<RootListResult<RootAuditEntry>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.q) params.set("q", query.q)
  if (query?.module) params.set("module", query.module)
  if (query?.action) params.set("action", query.action)
  if (query?.status) params.set("status", query.status)
  const qs = params.toString() ? `?${params.toString()}` : ""
  return apiGetPage<RootAuditEntry>(`/audit${qs}`)
}

export async function getAuditSummary(days = 1): Promise<{
  failedLoginsToday: number
  criticalEventsToday: number
  unreviewedCritical: number
  recentRoleChanges: number
  recentPermissionChanges: number
  lastArchive: string | null
  retentionYears: number
  totalRecords: number
}> {
  return apiGet(`/audit/summary?days=${days}`)
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Organization Management Engine (Sprint 7.4.2) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// ROOT-only master data: colleges / departments (Sprint 7.1 rows) + offices /
// programs (7.4.2 tables). Every mutation versions the record; ROOT can roll
// back to any earlier snapshot. Routes live at /root/organization/<collection>
// with /root/<collection> aliases.

export type OrgEntity = "campus" | "college" | "department" | "office" | "program"

export type ProgramLevel =
  | "UNDERGRADUATE"
  | "GRADUATE"
  | "DOCTORAL"
  | "CERTIFICATE"
  | "DIPLOMA"

export type OrgChangeType =
  | "CREATED"
  | "UPDATED"
  | "ARCHIVED"
  | "RESTORED"
  | "ROLLED_BACK"

const ORG_COLLECTIONS: Record<OrgEntity, string> = {
  campus: "campuses",
  college: "colleges",
  department: "departments",
  office: "offices",
  program: "programs",
}

export interface OrgRecord {
  id: string
  name: string
  code: string
  description: string | null
  displayOrder: number
  campusId: string | null
  campusName: string | null
  collegeId: string | null
  collegeName: string | null
  departmentId: string | null
  departmentName: string | null
  headId: string | null
  headName: string | null
  level: ProgramLevel | null
  version: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface OrgVersion {
  id: string
  entity: string
  entityId: string
  version: number
  changeType: OrgChangeType
  data: Record<string, unknown>
  changedById: string | null
  changedByName: string | null
  createdAt: string
}

export interface OrgTreeNode {
  id: string
  name: string
  code: string
  description: string | null
  level: ProgramLevel | null
  colleges: OrgTreeNode[]
  departments: OrgTreeNode[]
  offices: OrgTreeNode[]
  programs: OrgTreeNode[]
}

export interface OrganizationTree {
  campuses: OrgTreeNode[]
  unassigned: OrgTreeNode
}

export interface OrgWriteInput {
  name?: string
  code?: string
  description?: string | null
  displayOrder?: number
  campusId?: string | null
  collegeId?: string | null
  departmentId?: string | null
  headId?: string | null
  level?: ProgramLevel | null
}

export async function listOrgRecords(
  entity: OrgEntity,
  query?: {
    page?: number
    pageSize?: number
    q?: string
    includeArchived?: boolean
    campusId?: string
    collegeId?: string
    departmentId?: string
  },
): Promise<RootListResult<OrgRecord>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.q) params.set("q", query.q)
  if (query?.includeArchived) params.set("includeArchived", "true")
  if (query?.campusId) params.set("campusId", query.campusId)
  if (query?.collegeId) params.set("collegeId", query.collegeId)
  if (query?.departmentId) params.set("departmentId", query.departmentId)
  const qs = params.toString() ? `?${params.toString()}` : ""
  return apiGetPage<OrgRecord>(
    `/root/organization/${ORG_COLLECTIONS[entity]}${qs}`
  )
}

export async function getOrgRecord(entity: OrgEntity, id: string): Promise<OrgRecord> {
  return apiGet<OrgRecord>(`/root/organization/${ORG_COLLECTIONS[entity]}/${id}`)
}

export async function createOrgRecord(
  entity: OrgEntity,
  input: OrgWriteInput,
): Promise<OrgRecord> {
  return apiPost<OrgRecord>(`/root/organization/${ORG_COLLECTIONS[entity]}`, input)
}

export async function updateOrgRecord(
  entity: OrgEntity,
  id: string,
  input: OrgWriteInput,
): Promise<OrgRecord> {
  return apiPatch<OrgRecord>(`/root/organization/${ORG_COLLECTIONS[entity]}/${id}`, input)
}

export async function archiveOrgRecord(entity: OrgEntity, id: string): Promise<OrgRecord> {
  return apiDelete<OrgRecord>(`/root/organization/${ORG_COLLECTIONS[entity]}/${id}`)
}

export async function restoreOrgRecord(entity: OrgEntity, id: string): Promise<OrgRecord> {
  return apiPost<OrgRecord>(`/root/organization/${ORG_COLLECTIONS[entity]}/${id}/restore`)
}

export async function listOrgVersions(
  entity: OrgEntity,
  id: string,
): Promise<OrgVersion[]> {
  return apiGet<OrgVersion[]>(
    `/root/organization/${ORG_COLLECTIONS[entity]}/${id}/versions`
  )
}

export async function rollbackOrgRecord(
  entity: OrgEntity,
  id: string,
  toVersion: number,
): Promise<OrgRecord> {
  return apiPost<OrgRecord>(`/root/organization/${ORG_COLLECTIONS[entity]}/${id}/rollback`, {
    version: toVersion,
  })
}

export async function getOrganizationTree(): Promise<OrganizationTree> {
  return apiGet<OrganizationTree>("/root/organization/tree")
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Dynamic Folder Builder (Sprint 7.4.3) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export type FolderTemplateStatus = "ACTIVE" | "INACTIVE"
export type FolderNodeVisibility = "VISIBLE" | "HIDDEN"
export type FolderNodeStatus = "ACTIVE" | "INACTIVE"
export type FolderAssignmentTargetType =
  | "UNIVERSITY"
  | "COLLEGE"
  | "DEPARTMENT"
  | "PROGRAM"
  | "OFFICE"
  | "AACCUP_AREA"
export type FolderTemplateChangeType =
  | "CREATED"
  | "UPDATED"
  | "ASSIGNED"
  | "ARCHIVED"
  | "RESTORED"
  | "ROLLED_BACK"

export type FolderJsonValue =
  | null
  | boolean
  | number
  | string
  | FolderJsonValue[]
  | { [key: string]: FolderJsonValue }

export interface FolderTemplate {
  id: string
  name: string
  code: string
  description: string | null
  category: string | null
  status: FolderTemplateStatus
  version: number
  icon: string | null
  color: string | null
  createdBy: string | null
  createdByName: string | null
  updatedBy: string | null
  updatedByName: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  nodeCount: number
  assignmentCount: number
}

export interface FolderTreeNode {
  id: string
  parentId: string | null
  name: string
  description: string | null
  category: string | null
  metadata: FolderJsonValue
  sortOrder: number
  icon: string | null
  color: string | null
  visibility: FolderNodeVisibility
  status: FolderNodeStatus
  level: number
  deletedAt: string | null
  children: FolderTreeNode[]
}

export interface FolderAssignment {
  id: string
  templateId: string
  templateName: string
  targetType: FolderAssignmentTargetType
  targetId: string | null
  targetName: string | null
  createdAt: string
}

export interface FolderTemplateDetail {
  template: FolderTemplate
  tree: FolderTreeNode[]
  assignments: FolderAssignment[]
}

export interface FolderSnapshotNode {
  name: string
  description: string | null
  category: string | null
  metadata: FolderJsonValue
  sortOrder: number
  icon: string | null
  color: string | null
  visibility: FolderNodeVisibility
  status: FolderNodeStatus
  children: FolderSnapshotNode[]
}

export interface FolderSnapshot {
  name: string
  code: string
  description: string | null
  category: string | null
  status: FolderTemplateStatus
  icon: string | null
  color: string | null
  nodes: FolderSnapshotNode[]
  assignments: Array<{ targetType: FolderAssignmentTargetType; targetId: string | null }>
}

export interface FolderVersion {
  id: string
  templateId: string
  version: number
  changeType: FolderTemplateChangeType
  data: FolderSnapshot
  changeNote: string | null
  changedById: string | null
  changedByName: string | null
  createdAt: string
}

export interface FolderHistoryEntry {
  id: string
  templateId: string
  action: FolderTemplateChangeType
  oldValue: FolderJsonValue
  newValue: FolderJsonValue
  versionFrom: number | null
  versionTo: number | null
  actorId: string | null
  actorName: string | null
  createdAt: string
}

export interface FolderTemplateInput {
  name: string
  code: string
  description?: string | null
  category?: string | null
  status?: FolderTemplateStatus
  icon?: string | null
  color?: string | null
  nodes?: Array<{
    name: string
    description?: string | null
    category?: string | null
    icon?: string | null
    color?: string | null
  }>
}

export interface FolderNodeInput {
  name?: string
  description?: string | null
  category?: string | null
  metadata?: Record<string, unknown> | null
  sortOrder?: number
  icon?: string | null
  color?: string | null
  visibility?: FolderNodeVisibility
  status?: FolderNodeStatus
  parentId?: string | null
}

export interface FolderAssignmentTargetOption {
  id: string
  name: string
  code: string | null
}

const FOLDER_BUILDER_PATH = "/root/folder-builder"

export async function listFolderTemplates(query?: {
  page?: number
  pageSize?: number
  q?: string
  status?: FolderTemplateStatus
  includeArchived?: boolean
}): Promise<RootListResult<FolderTemplate>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.q) params.set("q", query.q)
  if (query?.status) params.set("status", query.status)
  if (query?.includeArchived) params.set("includeArchived", "true")
  const qs = params.size > 0 ? `?${params.toString()}` : ""
  return apiGetPage<FolderTemplate>(`${FOLDER_BUILDER_PATH}/templates${qs}`)
}

export async function getFolderTemplate(id: string): Promise<FolderTemplateDetail> {
  return apiGet<FolderTemplateDetail>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(id)}`)
}

export async function createFolderTemplate(input: FolderTemplateInput): Promise<FolderTemplateDetail> {
  return apiPost<FolderTemplateDetail>(`${FOLDER_BUILDER_PATH}/templates`, input)
}

export async function updateFolderTemplate(
  id: string,
  input: Partial<Omit<FolderTemplateInput, "nodes">>,
): Promise<FolderTemplateDetail> {
  return apiPatch<FolderTemplateDetail>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(id)}`, input)
}

export async function archiveFolderTemplate(id: string): Promise<FolderTemplateDetail> {
  return apiDelete<FolderTemplateDetail>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(id)}`)
}

export async function restoreFolderTemplate(id: string): Promise<FolderTemplateDetail> {
  return apiPost<FolderTemplateDetail>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(id)}/restore`)
}

export async function duplicateFolderTemplate(id: string): Promise<FolderTemplateDetail> {
  return apiPost<FolderTemplateDetail>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(id)}/duplicate`)
}

export async function listFolderNodes(
  templateId: string,
  query?: { parentId?: string; q?: string; includeArchived?: boolean },
): Promise<FolderTreeNode[]> {
  const params = new URLSearchParams()
  if (query?.parentId) params.set("parentId", query.parentId)
  if (query?.q) params.set("q", query.q)
  if (query?.includeArchived) params.set("includeArchived", "true")
  const qs = params.size > 0 ? `?${params.toString()}` : ""
  return apiGet<FolderTreeNode[]>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(templateId)}/nodes${qs}`)
}

export async function createFolderNode(
  templateId: string,
  input: FolderNodeInput & { name: string },
): Promise<FolderTreeNode> {
  return apiPost<FolderTreeNode>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(templateId)}/nodes`, input)
}

export async function updateFolderNode(
  templateId: string,
  nodeId: string,
  input: FolderNodeInput,
): Promise<FolderTreeNode> {
  return apiPatch<FolderTreeNode>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}`, input)
}

export async function moveFolderNode(
  templateId: string,
  nodeId: string,
  input: { parentId: string | null; sortOrder?: number },
): Promise<FolderTreeNode> {
  return apiPost<FolderTreeNode>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}/move`, input)
}

export async function duplicateFolderNode(templateId: string, nodeId: string): Promise<FolderTreeNode> {
  return apiPost<FolderTreeNode>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}/duplicate`)
}

export async function archiveFolderNode(templateId: string, nodeId: string): Promise<FolderTreeNode> {
  return apiDelete<FolderTreeNode>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}`)
}

export async function restoreFolderNode(templateId: string, nodeId: string): Promise<FolderTreeNode> {
  return apiPost<FolderTreeNode>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}/restore`)
}

export async function listFolderVersions(templateId: string): Promise<FolderVersion[]> {
  return apiGet<FolderVersion[]>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(templateId)}/versions`)
}

export async function listFolderHistory(query?: {
  page?: number
  pageSize?: number
  templateId?: string
  action?: FolderTemplateChangeType
  from?: string
  to?: string
}): Promise<RootListResult<FolderHistoryEntry>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.templateId) params.set("templateId", query.templateId)
  if (query?.action) params.set("action", query.action)
  if (query?.from) params.set("from", query.from)
  if (query?.to) params.set("to", query.to)
  const qs = params.size > 0 ? `?${params.toString()}` : ""
  return apiGetPage<FolderHistoryEntry>(`${FOLDER_BUILDER_PATH}/history${qs}`)
}

export async function rollbackFolderTemplate(
  templateId: string,
  version: number,
  changeNote?: string,
): Promise<FolderTemplateDetail> {
  return apiPost<FolderTemplateDetail>(`${FOLDER_BUILDER_PATH}/rollback`, {
    templateId,
    version,
    changeNote,
  })
}

export async function listFolderAssignments(query?: {
  templateId?: string
  targetType?: FolderAssignmentTargetType
}): Promise<FolderAssignment[]> {
  const params = new URLSearchParams()
  if (query?.templateId) params.set("templateId", query.templateId)
  if (query?.targetType) params.set("targetType", query.targetType)
  const qs = params.size > 0 ? `?${params.toString()}` : ""
  return apiGet<FolderAssignment[]>(`${FOLDER_BUILDER_PATH}/assignments${qs}`)
}

export async function assignFolderTemplate(
  templateId: string,
  targetType: FolderAssignmentTargetType,
  targetId?: string | null,
): Promise<FolderTemplateDetail> {
  return apiPost<FolderTemplateDetail>(`${FOLDER_BUILDER_PATH}/templates/${encodeURIComponent(templateId)}/assignments`, {
    targetType,
    ...(targetType === "UNIVERSITY" ? {} : { targetId }),
  })
}

export async function unassignFolderTemplate(assignmentId: string): Promise<FolderTemplateDetail> {
  return apiDelete<FolderTemplateDetail>(`${FOLDER_BUILDER_PATH}/assignments/${encodeURIComponent(assignmentId)}`)
}

interface AaccupAreaOption {
  id: string
  code: string
  name: string
}

export async function listFolderAssignmentTargets(
  targetType: FolderAssignmentTargetType,
): Promise<FolderAssignmentTargetOption[]> {
  if (targetType === "UNIVERSITY") return []
  if (targetType === "AACCUP_AREA") {
    const result = await apiGetPage<AaccupAreaOption>("/aaccup/areas?pageSize=100")
    return result.items.map((area) => ({ id: area.id, name: area.name, code: area.code }))
  }
  const entity: OrgEntity = targetType === "COLLEGE"
    ? "college"
    : targetType === "DEPARTMENT"
      ? "department"
      : targetType === "PROGRAM"
        ? "program"
        : "office"
  const result = await listOrgRecords(entity, { pageSize: 200 })
  return result.items.map((record) => ({ id: record.id, name: record.name, code: record.code }))
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Dynamic Requirement Builder (Sprint 7.4.4) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export type RequirementTemplateStatus = "ACTIVE" | "INACTIVE"
export type RequirementNodeType =
  | "SECTION"
  | "REQUIREMENT"
  | "SUB_REQUIREMENT"
  | "SUPPORTING_DOCUMENT"
export type RequirementNodeStatus = "ACTIVE" | "INACTIVE"
export type RequirementAssignmentTargetType =
  | "UNIVERSITY"
  | "COLLEGE"
  | "DEPARTMENT"
  | "PROGRAM"
  | "OFFICE"
  | "AACCUP_AREA"
  | "ACCREDITATION_CYCLE"
export type RequirementChangeType =
  | "CREATED"
  | "UPDATED"
  | "ASSIGNED"
  | "ARCHIVED"
  | "RESTORED"
  | "ROLLED_BACK"
export type RequirementValidationType =
  | "FILE_TYPE"
  | "FILE_SIZE"
  | "PAGE_COUNT"
  | "EXPIRATION_DATE"
  | "NAMING_CONVENTION"
  | "METADATA"
export type RequirementValidationSeverity = "ERROR" | "WARNING"

export interface RequirementTemplate {
  id: string
  name: string
  code: string
  description: string | null
  category: string | null
  metadata: FolderJsonValue
  status: RequirementTemplateStatus
  version: number
  createdBy: string | null
  createdByName: string | null
  updatedBy: string | null
  updatedByName: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  nodeCount: number
  validationCount: number
  assignmentCount: number
}

export interface RequirementValidation {
  id: string
  nodeId: string
  type: RequirementValidationType
  config: Record<string, unknown>
  message: string | null
  severity: RequirementValidationSeverity
  enabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface RequirementTreeNode {
  id: string
  templateId: string
  parentId: string | null
  code: string
  name: string
  description: string | null
  helpText: string | null
  type: RequirementNodeType
  metadata: FolderJsonValue
  isRequired: boolean
  allowMultiple: boolean
  sortOrder: number
  level: number
  status: RequirementNodeStatus
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  validations: RequirementValidation[]
  children: RequirementTreeNode[]
}

export interface RequirementAssignment {
  id: string
  templateId: string
  templateName: string
  targetType: RequirementAssignmentTargetType
  targetId: string | null
  targetName: string | null
  createdAt: string
}

export interface RequirementTemplateDetail {
  template: RequirementTemplate
  tree: RequirementTreeNode[]
  assignments: RequirementAssignment[]
}

export interface RequirementSnapshot {
  name: string
  code: string
  description: string | null
  category: string | null
  metadata: FolderJsonValue
  status: RequirementTemplateStatus
  nodes: Array<{
    id: string
    parentId: string | null
    code: string
    name: string
    type: RequirementNodeType
    validations: Array<{ id: string; type: RequirementValidationType }>
  }>
  assignments: Array<{
    id: string
    targetType: RequirementAssignmentTargetType
    targetId: string | null
  }>
}

export interface RequirementVersion {
  id: string
  templateId: string
  version: number
  changeType: RequirementChangeType
  data: RequirementSnapshot
  changeNote: string | null
  changedById: string | null
  changedByName: string | null
  createdAt: string
}

export interface RequirementHistoryEntry {
  id: string
  templateId: string
  action: RequirementChangeType
  oldValue: FolderJsonValue
  newValue: FolderJsonValue
  versionFrom: number | null
  versionTo: number | null
  actorId: string | null
  actorName: string | null
  createdAt: string
}

export interface AccreditationCycle {
  id: string
  code: string
  name: string
  description: string | null
  startDate: string
  endDate: string
  status: "ACTIVE" | "INACTIVE"
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface RequirementTemplateInput {
  name: string
  code: string
  description?: string | null
  category?: string | null
  metadata?: Record<string, unknown> | null
  status?: RequirementTemplateStatus
}

export interface RequirementNodeInput {
  code?: string
  name?: string
  description?: string | null
  helpText?: string | null
  type?: RequirementNodeType
  metadata?: Record<string, unknown> | null
  isRequired?: boolean
  allowMultiple?: boolean
  sortOrder?: number
  status?: RequirementNodeStatus
  parentId?: string | null
}

export interface RequirementValidationInput {
  type: RequirementValidationType
  config: Record<string, unknown>
  message?: string | null
  severity: RequirementValidationSeverity
  enabled: boolean
  sortOrder: number
}

export interface RequirementTargetOption {
  id: string
  name: string
  code: string | null
}

const REQUIREMENT_PATH = "/root/requirements"

export async function listRequirementTemplates(query?: {
  page?: number
  pageSize?: number
  q?: string
  status?: RequirementTemplateStatus
  category?: string
  includeArchived?: boolean
}): Promise<RootListResult<RequirementTemplate>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.q) params.set("q", query.q)
  if (query?.status) params.set("status", query.status)
  if (query?.category) params.set("category", query.category)
  if (query?.includeArchived) params.set("includeArchived", "true")
  const queryString = params.size ? `?${params.toString()}` : ""
  return apiGetPage<RequirementTemplate>(`${REQUIREMENT_PATH}${queryString}`)
}

export async function getRequirementTemplate(id: string): Promise<RequirementTemplateDetail> {
  return apiGet<RequirementTemplateDetail>(`${REQUIREMENT_PATH}/${encodeURIComponent(id)}`)
}

export async function createRequirementTemplate(
  input: RequirementTemplateInput,
): Promise<RequirementTemplateDetail> {
  return apiPost<RequirementTemplateDetail>(REQUIREMENT_PATH, input)
}

export async function updateRequirementTemplate(
  id: string,
  input: Partial<RequirementTemplateInput>,
): Promise<RequirementTemplateDetail> {
  return apiPatch<RequirementTemplateDetail>(`${REQUIREMENT_PATH}/${encodeURIComponent(id)}`, input)
}

export async function archiveRequirementTemplate(id: string): Promise<RequirementTemplateDetail> {
  return apiDelete<RequirementTemplateDetail>(`${REQUIREMENT_PATH}/${encodeURIComponent(id)}`)
}

export async function restoreRequirementTemplate(id: string): Promise<RequirementTemplateDetail> {
  return apiPost<RequirementTemplateDetail>(`${REQUIREMENT_PATH}/${encodeURIComponent(id)}/restore`)
}

export async function listRequirementNodes(
  templateId: string,
  query?: { q?: string; includeArchived?: boolean },
): Promise<RequirementTreeNode[]> {
  const params = new URLSearchParams()
  if (query?.q) params.set("q", query.q)
  if (query?.includeArchived) params.set("includeArchived", "true")
  const queryString = params.size ? `?${params.toString()}` : ""
  return apiGet<RequirementTreeNode[]>(
    `${REQUIREMENT_PATH}/${encodeURIComponent(templateId)}/nodes${queryString}`,
  )
}

export async function createRequirementNode(
  templateId: string,
  input: RequirementNodeInput & { code: string; name: string; type: RequirementNodeType },
): Promise<RequirementTreeNode> {
  return apiPost<RequirementTreeNode>(
    `${REQUIREMENT_PATH}/${encodeURIComponent(templateId)}/nodes`,
    input,
  )
}

export async function updateRequirementNode(
  templateId: string,
  nodeId: string,
  input: RequirementNodeInput,
): Promise<RequirementTreeNode> {
  return apiPatch<RequirementTreeNode>(
    `${REQUIREMENT_PATH}/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}`,
    input,
  )
}

export async function moveRequirementNode(
  templateId: string,
  nodeId: string,
  parentId: string | null,
  sortOrder?: number,
): Promise<RequirementTreeNode> {
  return apiPost<RequirementTreeNode>(
    `${REQUIREMENT_PATH}/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}/move`,
    { parentId, ...(sortOrder === undefined ? {} : { sortOrder }) },
  )
}

export async function archiveRequirementNode(
  templateId: string,
  nodeId: string,
): Promise<RequirementTreeNode> {
  return apiDelete<RequirementTreeNode>(
    `${REQUIREMENT_PATH}/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}`,
  )
}

export async function restoreRequirementNode(
  templateId: string,
  nodeId: string,
): Promise<RequirementTreeNode> {
  return apiPost<RequirementTreeNode>(
    `${REQUIREMENT_PATH}/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}/restore`,
  )
}

export async function createRequirementValidation(
  templateId: string,
  nodeId: string,
  input: RequirementValidationInput,
): Promise<RequirementValidation> {
  return apiPost<RequirementValidation>(
    `${REQUIREMENT_PATH}/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}/validations`,
    input,
  )
}

export async function updateRequirementValidation(
  templateId: string,
  nodeId: string,
  validationId: string,
  input: RequirementValidationInput,
): Promise<RequirementValidation> {
  return apiPatch<RequirementValidation>(
    `${REQUIREMENT_PATH}/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}/validations/${encodeURIComponent(validationId)}`,
    input,
  )
}

export async function archiveRequirementValidation(
  templateId: string,
  nodeId: string,
  validationId: string,
): Promise<RequirementValidation> {
  return apiDelete<RequirementValidation>(
    `${REQUIREMENT_PATH}/${encodeURIComponent(templateId)}/nodes/${encodeURIComponent(nodeId)}/validations/${encodeURIComponent(validationId)}`,
  )
}

export async function listRequirementAssignments(query?: {
  templateId?: string
  targetType?: RequirementAssignmentTargetType
}): Promise<RequirementAssignment[]> {
  const params = new URLSearchParams()
  if (query?.templateId) params.set("templateId", query.templateId)
  if (query?.targetType) params.set("targetType", query.targetType)
  const queryString = params.size ? `?${params.toString()}` : ""
  return apiGet<RequirementAssignment[]>(`${REQUIREMENT_PATH}/assignments${queryString}`)
}

export async function assignRequirementTemplate(
  templateId: string,
  targetType: RequirementAssignmentTargetType,
  targetId?: string | null,
): Promise<RequirementTemplateDetail> {
  return apiPost<RequirementTemplateDetail>(
    `${REQUIREMENT_PATH}/${encodeURIComponent(templateId)}/assignments`,
    { targetType, ...(targetType === "UNIVERSITY" ? {} : { targetId }) },
  )
}

export async function unassignRequirementTemplate(
  assignmentId: string,
): Promise<RequirementTemplateDetail> {
  return apiDelete<RequirementTemplateDetail>(
    `${REQUIREMENT_PATH}/assignments/${encodeURIComponent(assignmentId)}`,
  )
}

export async function listRequirementVersions(templateId: string): Promise<RequirementVersion[]> {
  return apiGet<RequirementVersion[]>(
    `${REQUIREMENT_PATH}/${encodeURIComponent(templateId)}/versions`,
  )
}

export async function listRequirementHistory(query?: {
  page?: number
  pageSize?: number
  templateId?: string
  action?: RequirementChangeType
}): Promise<RootListResult<RequirementHistoryEntry>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.templateId) params.set("templateId", query.templateId)
  if (query?.action) params.set("action", query.action)
  const queryString = params.size ? `?${params.toString()}` : ""
  return apiGetPage<RequirementHistoryEntry>(`${REQUIREMENT_PATH}/history${queryString}`)
}

export async function rollbackRequirementTemplate(
  templateId: string,
  version: number,
  changeNote?: string,
): Promise<RequirementTemplateDetail> {
  return apiPost<RequirementTemplateDetail>(`${REQUIREMENT_PATH}/rollback`, {
    templateId,
    version,
    changeNote,
  })
}

export async function listAccreditationCycles(query?: {
  page?: number
  pageSize?: number
  q?: string
  includeArchived?: boolean
}): Promise<RootListResult<AccreditationCycle>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.q) params.set("q", query.q)
  if (query?.includeArchived) params.set("includeArchived", "true")
  const queryString = params.size ? `?${params.toString()}` : ""
  return apiGetPage<AccreditationCycle>(`${REQUIREMENT_PATH}/cycles${queryString}`)
}

export async function createAccreditationCycle(input: {
  code: string
  name: string
  description?: string | null
  startDate: string
  endDate: string
  status?: "ACTIVE" | "INACTIVE"
}): Promise<AccreditationCycle> {
  return apiPost<AccreditationCycle>(`${REQUIREMENT_PATH}/cycles`, input)
}

export async function listRequirementTargetOptions(
  targetType: RequirementAssignmentTargetType,
): Promise<RequirementTargetOption[]> {
  if (targetType === "UNIVERSITY") return []
  if (targetType === "ACCREDITATION_CYCLE") {
    const result = await listAccreditationCycles({ pageSize: 200 })
    return result.items.map((cycle) => ({ id: cycle.id, name: cycle.name, code: cycle.code }))
  }
  if (targetType === "AACCUP_AREA") {
    const result = await apiGetPage<AaccupAreaOption>("/aaccup/areas?pageSize=100")
    return result.items.map((area) => ({ id: area.id, name: area.name, code: area.code }))
  }
  const entity: OrgEntity = targetType === "COLLEGE"
    ? "college"
    : targetType === "DEPARTMENT"
      ? "department"
      : targetType === "PROGRAM"
        ? "program"
        : "office"
  const result = await listOrgRecords(entity, { pageSize: 200 })
  return result.items.map((record) => ({ id: record.id, name: record.name, code: record.code }))
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Dynamic Workflow Builder (Sprint 7.4.5) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export type WorkflowDefinitionStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED"
export type WorkflowEntityType = "DOCUMENT_REQUEST" | "AACCUP_SUBMISSION" | "DOCUMENT"
export type WorkflowStepType = "START" | "TASK" | "REVIEW" | "APPROVAL" | "END"
export type WorkflowStepStatus = "ACTIVE" | "INACTIVE"
export type WorkflowChangeType =
  | "CREATED"
  | "UPDATED"
  | "VALIDATED"
  | "PUBLISHED"
  | "ASSIGNED"
  | "UNASSIGNED"
  | "ARCHIVED"
  | "RESTORED"
  | "ROLLED_BACK"
export type WorkflowInstanceStatus = "RUNNING" | "COMPLETED" | "TERMINATED"
export type WorkflowStepInstanceStatus = "PENDING" | "ACTIVE" | "COMPLETED" | "SKIPPED"
export type WorkflowAssignmentTargetType =
  | "UNIVERSITY"
  | "COLLEGE"
  | "DEPARTMENT"
  | "PROGRAM"
  | "OFFICE"
  | "AACCUP_AREA"
  | "ACCREDITATION_CYCLE"

export interface WorkflowDefinition {
  id: string
  code: string
  name: string
  description: string | null
  entityType: WorkflowEntityType
  status: WorkflowDefinitionStatus
  version: number
  metadata: unknown
  createdBy: string | null
  createdByName: string | null
  updatedBy: string | null
  updatedByName: string | null
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  stepCount: number
  transitionCount: number
  assignmentCount: number
  instanceCount: number
}

export interface WorkflowStep {
  id: string
  definitionId: string
  code: string
  name: string
  description: string | null
  type: WorkflowStepType
  roleName: string | null
  permissionCode: string | null
  sortOrder: number
  metadata: unknown
  status: WorkflowStepStatus
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface WorkflowTransition {
  id: string
  definitionId: string
  fromStepId: string
  toStepId: string
  actionCode: string
  requiredPermission: string | null
  metadata: unknown
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface WorkflowAssignment {
  id: string
  definitionId: string
  definitionName: string
  targetType: WorkflowAssignmentTargetType
  targetId: string | null
  targetName: string
  priority: number
  createdAt: string
}

export interface WorkflowDefinitionDetail extends WorkflowDefinition {
  steps: WorkflowStep[]
  transitions: WorkflowTransition[]
  assignments: WorkflowAssignment[]
}

export interface WorkflowVersion {
  id: string
  definitionId: string
  definitionName: string
  version: number
  changeType: WorkflowChangeType
  data: unknown
  changeNote: string | null
  changedById: string | null
  changedByName: string | null
  createdAt: string
}

export interface WorkflowHistoryEntry {
  id: string
  definitionId: string
  action: WorkflowChangeType
  oldValue: unknown
  newValue: unknown
  versionFrom: number | null
  versionTo: number | null
  actorId: string | null
  actorName: string | null
  createdAt: string
}

export interface WorkflowValidationIssue {
  code: string
  message: string
  severity: "ERROR" | "WARNING"
}

export interface WorkflowValidationResult {
  valid: boolean
  issues: WorkflowValidationIssue[]
  checksRun: number
}

export interface WorkflowStepInstanceView {
  id: string
  instanceId: string
  stepId: string
  stepCode: string
  stepName: string
  stepType: WorkflowStepType
  status: WorkflowStepInstanceStatus
  activatedAt: string | null
  completedAt: string | null
  actorId: string | null
  actorName: string | null
  note: string | null
}

export interface WorkflowActionView {
  id: string
  instanceId: string
  stepId: string
  stepCode: string
  actionCode: string
  fromStepId: string | null
  toStepId: string | null
  actorId: string | null
  actorName: string | null
  note: string | null
  createdAt: string
}

export interface WorkflowInstanceView {
  id: string
  definitionId: string
  definitionName: string
  definitionCode: string
  version: number
  entityType: WorkflowEntityType
  entityId: string
  status: WorkflowInstanceStatus
  currentStepId: string | null
  currentStepCode: string | null
  currentStepName: string | null
  currentStepType: WorkflowStepType | null
  startedById: string | null
  startedByName: string | null
  startedAt: string
  completedAt: string | null
  stepInstances: WorkflowStepInstanceView[]
  actions: WorkflowActionView[]
  allowedActions: string[]
}

export interface WorkflowTargetOption {
  id: string
  name: string
  code: string | null
}

const WORKFLOW_PATH = "/root/workflows"

export async function listWorkflowDefinitions(query?: {
  page?: number
  pageSize?: number
  q?: string
  entityType?: WorkflowEntityType
  status?: WorkflowDefinitionStatus
  includeArchived?: boolean
}): Promise<RootListResult<WorkflowDefinition>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.q) params.set("q", query.q)
  if (query?.entityType) params.set("entityType", query.entityType)
  if (query?.status) params.set("status", query.status)
  if (query?.includeArchived) params.set("includeArchived", "true")
  const queryString = params.size ? `?${params.toString()}` : ""
  return apiGetPage<WorkflowDefinition>(`${WORKFLOW_PATH}${queryString}`)
}

export async function getWorkflowDefinition(id: string): Promise<WorkflowDefinitionDetail> {
  return apiGet<WorkflowDefinitionDetail>(`${WORKFLOW_PATH}/${encodeURIComponent(id)}`)
}

export async function createWorkflowDefinition(input: {
  name: string
  code: string
  description?: string | null
  entityType: WorkflowEntityType
}): Promise<WorkflowDefinitionDetail> {
  return apiPost<WorkflowDefinitionDetail>(WORKFLOW_PATH, input)
}

export async function updateWorkflowDefinition(
  id: string,
  input: Partial<{
    name: string
    code: string
    description: string | null
    entityType: WorkflowEntityType
  }>,
): Promise<WorkflowDefinitionDetail> {
  return apiPatch<WorkflowDefinitionDetail>(`${WORKFLOW_PATH}/${encodeURIComponent(id)}`, input)
}

export async function archiveWorkflowDefinition(id: string): Promise<WorkflowDefinitionDetail> {
  return apiDelete<WorkflowDefinitionDetail>(`${WORKFLOW_PATH}/${encodeURIComponent(id)}`)
}

export async function restoreWorkflowDefinition(id: string): Promise<WorkflowDefinitionDetail> {
  return apiPost<WorkflowDefinitionDetail>(`${WORKFLOW_PATH}/${encodeURIComponent(id)}/restore`)
}

export async function listWorkflowVersions(id: string): Promise<WorkflowVersion[]> {
  return apiGet<WorkflowVersion[]>(`${WORKFLOW_PATH}/${encodeURIComponent(id)}/versions`)
}

export async function listWorkflowHistory(query?: {
  page?: number
  pageSize?: number
  definitionId?: string
  action?: WorkflowChangeType
  from?: string
  to?: string
}): Promise<RootListResult<WorkflowHistoryEntry>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.definitionId) params.set("definitionId", query.definitionId)
  if (query?.action) params.set("action", query.action)
  if (query?.from) params.set("from", query.from)
  if (query?.to) params.set("to", query.to)
  const queryString = params.size ? `?${params.toString()}` : ""
  return apiGetPage<WorkflowHistoryEntry>(`${WORKFLOW_PATH}/history${queryString}`)
}

export async function listWorkflowAssignments(query?: {
  definitionId?: string
  targetType?: WorkflowAssignmentTargetType
}): Promise<WorkflowAssignment[]> {
  const params = new URLSearchParams()
  if (query?.definitionId) params.set("definitionId", query.definitionId)
  if (query?.targetType) params.set("targetType", query.targetType)
  const queryString = params.size ? `?${params.toString()}` : ""
  return apiGet<WorkflowAssignment[]>(`${WORKFLOW_PATH}/assignments${queryString}`)
}

export async function assignWorkflowDefinition(
  id: string,
  targetType: WorkflowAssignmentTargetType,
  targetId?: string | null,
  priority?: number,
): Promise<WorkflowDefinitionDetail> {
  return apiPost<WorkflowDefinitionDetail>(
    `${WORKFLOW_PATH}/${encodeURIComponent(id)}/assignments`,
    {
      targetType,
      ...(targetType === "UNIVERSITY" ? {} : { targetId }),
      ...(priority === undefined ? {} : { priority }),
    },
  )
}

export async function unassignWorkflow(assignmentId: string): Promise<WorkflowDefinitionDetail> {
  return apiDelete<WorkflowDefinitionDetail>(`${WORKFLOW_PATH}/assignments/${encodeURIComponent(assignmentId)}`)
}

export async function createWorkflowStep(
  id: string,
  input: {
    code: string
    name: string
    description?: string | null
    type: WorkflowStepType
    roleName?: string | null
    permissionCode?: string | null
    sortOrder?: number
  },
): Promise<WorkflowStep> {
  return apiPost<WorkflowStep>(`${WORKFLOW_PATH}/${encodeURIComponent(id)}/steps`, input)
}

export async function updateWorkflowStep(
  id: string,
  stepId: string,
  input: Partial<{
    code: string
    name: string
    description: string | null
    type: WorkflowStepType
    roleName: string | null
    permissionCode: string | null
    sortOrder: number
    status: WorkflowStepStatus
  }>,
): Promise<WorkflowStep> {
  return apiPatch<WorkflowStep>(
    `${WORKFLOW_PATH}/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}`,
    input,
  )
}

export async function archiveWorkflowStep(id: string, stepId: string): Promise<WorkflowStep> {
  return apiDelete<WorkflowStep>(
    `${WORKFLOW_PATH}/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}`,
  )
}

export async function restoreWorkflowStep(id: string, stepId: string): Promise<WorkflowStep> {
  return apiPost<WorkflowStep>(
    `${WORKFLOW_PATH}/${encodeURIComponent(id)}/steps/${encodeURIComponent(stepId)}/restore`,
  )
}

export async function createWorkflowTransition(
  id: string,
  input: {
    fromStepId: string
    toStepId: string
    actionCode: string
    requiredPermission?: string | null
    sortOrder?: number
  },
): Promise<WorkflowTransition> {
  return apiPost<WorkflowTransition>(`${WORKFLOW_PATH}/${encodeURIComponent(id)}/transitions`, input)
}

export async function updateWorkflowTransition(
  id: string,
  transitionId: string,
  input: Partial<{
    toStepId: string
    actionCode: string
    requiredPermission: string | null
    sortOrder: number
  }>,
): Promise<WorkflowTransition> {
  return apiPatch<WorkflowTransition>(
    `${WORKFLOW_PATH}/${encodeURIComponent(id)}/transitions/${encodeURIComponent(transitionId)}`,
    input,
  )
}

export async function archiveWorkflowTransition(
  id: string,
  transitionId: string,
): Promise<WorkflowTransition> {
  return apiDelete<WorkflowTransition>(
    `${WORKFLOW_PATH}/${encodeURIComponent(id)}/transitions/${encodeURIComponent(transitionId)}`,
  )
}

export async function restoreWorkflowTransition(
  id: string,
  transitionId: string,
): Promise<WorkflowTransition> {
  return apiPost<WorkflowTransition>(
    `${WORKFLOW_PATH}/${encodeURIComponent(id)}/transitions/${encodeURIComponent(transitionId)}/restore`,
  )
}

export async function validateWorkflowDefinition(id: string): Promise<WorkflowValidationResult> {
  return apiPost<WorkflowValidationResult>(
    `${WORKFLOW_PATH}/${encodeURIComponent(id)}/validate`,
    {},
  )
}

export async function publishWorkflowDefinition(
  id: string,
  changeNote?: string,
): Promise<WorkflowDefinitionDetail> {
  return apiPost<WorkflowDefinitionDetail>(
    `${WORKFLOW_PATH}/${encodeURIComponent(id)}/publish`,
    { changeNote },
  )
}

export async function rollbackWorkflowDefinition(
  id: string,
  version: number,
  changeNote?: string,
): Promise<WorkflowDefinitionDetail> {
  return apiPost<WorkflowDefinitionDetail>(`${WORKFLOW_PATH}/${encodeURIComponent(id)}/rollback`, {
    version,
    changeNote,
  })
}

export async function listWorkflowInstances(query?: {
  page?: number
  pageSize?: number
  entityType?: WorkflowEntityType
  entityId?: string
  status?: WorkflowInstanceStatus
  definitionId?: string
}): Promise<RootListResult<WorkflowInstanceView>> {
  const params = new URLSearchParams()
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.entityType) params.set("entityType", query.entityType)
  if (query?.entityId) params.set("entityId", query.entityId)
  if (query?.status) params.set("status", query.status)
  if (query?.definitionId) params.set("definitionId", query.definitionId)
  const queryString = params.size ? `?${params.toString()}` : ""
  return apiGetPage<WorkflowInstanceView>(`${WORKFLOW_PATH}/instances${queryString}`)
}

export async function getWorkflowInstance(id: string): Promise<WorkflowInstanceView> {
  return apiGet<WorkflowInstanceView>(`${WORKFLOW_PATH}/instances/${encodeURIComponent(id)}`)
}

export async function listWorkflowTargetOptions(
  targetType: WorkflowAssignmentTargetType,
): Promise<WorkflowTargetOption[]> {
  if (targetType === "UNIVERSITY") return []
  if (targetType === "ACCREDITATION_CYCLE") {
    const result = await listAccreditationCycles({ pageSize: 200 })
    return result.items.map((cycle) => ({ id: cycle.id, name: cycle.name, code: cycle.code }))
  }
  if (targetType === "AACCUP_AREA") {
    const result = await apiGetPage<AaccupAreaOption>("/aaccup/areas?pageSize=100")
    return result.items.map((area) => ({ id: area.id, name: area.name, code: area.code }))
  }
  const entity: OrgEntity = targetType === "COLLEGE"
    ? "college"
    : targetType === "DEPARTMENT"
      ? "department"
      : targetType === "PROGRAM"
        ? "program"
        : "office"
  const result = await listOrgRecords(entity, { pageSize: 200 })
  return result.items.map((record) => ({ id: record.id, name: record.name, code: record.code }))
}

// =============================================================================
// Sprint 7.4.6 â€” Dynamic Form Builder (ROOT authoring)
// Mirrors server modules/root/root.form.*
// =============================================================================

const FORM_PATH = "/root/forms"

export type FormStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED"

export type FormFieldType =
  | "TEXT"
  | "TEXTAREA"
  | "NUMBER"
  | "EMAIL"
  | "DATE"
  | "TIME"
  | "DROPDOWN"
  | "RADIO"
  | "CHECKBOX"
  | "MULTI_SELECT"
  | "FILE"
  | "SECTION"

export type FormAssignmentTargetType =
  | "REQUIREMENT_TEMPLATE"
  | "WORKFLOW_STEP"
  | "AACCUP_AREA"
  | "FOLDER_TEMPLATE"
  | "UNIVERSITY"

export interface FormOption {
  label: string
  value: string
}

export interface FormFieldValidation {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  minDate?: string
  maxDate?: string
  minItems?: number
  maxItems?: number
  maxSizeBytes?: number
  allowedTypes?: string[]
}

export interface FormFieldView {
  id: string
  key: string
  label: string
  type: FormFieldType
  description: string | null
  placeholder: string | null
  required: boolean
  defaultValue: unknown
  options: FormOption[]
  validation: FormFieldValidation | null
  helpText: string | null
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface FormAssignmentView {
  id: string
  targetType: FormAssignmentTargetType
  targetId: string | null
  targetLabel: string | null
  priority: number
  createdAt: string
}

export interface FormTemplateListItem {
  id: string
  code: string
  name: string
  description: string | null
  status: FormStatus
  version: number
  fieldCount: number
  assignmentCount: number
  createdByName: string
  updatedByName: string | null
  createdAt: string
  updatedAt: string
}

export interface FormTemplateDetail extends FormTemplateListItem {
  fields: FormFieldView[]
  assignments: FormAssignmentView[]
  deletedAt: string | null
}

export interface FormVersionView {
  id: string
  version: number
  changeType: string
  changeNote: string | null
  changedByName: string | null
  createdAt: string
}

export interface FormHistoryView {
  id: string
  action: string
  oldValue: unknown
  newValue: unknown
  versionFrom: number | null
  versionTo: number | null
  actorName: string | null
  createdAt: string
}

export interface FormPreviewView {
  template: { id: string; code: string; name: string; description: string | null; version: number }
  fields: FormFieldView[]
  assignments: FormAssignmentView[]
}

export interface FormFieldInput {
  key?: string
  label: string
  type: FormFieldType
  description?: string
  placeholder?: string
  required?: boolean
  defaultValue?: unknown
  options?: FormOption[]
  validation?: FormFieldValidation
  helpText?: string
  sortOrder?: number
}

export async function listForms(query?: {
  q?: string
  status?: FormStatus
  includeArchived?: boolean
  page?: number
  pageSize?: number
  sort?: string
  order?: "asc" | "desc"
}): Promise<RootListResult<FormTemplateListItem>> {
  const params = new URLSearchParams()
  if (query?.q) params.set("q", query.q)
  if (query?.status) params.set("status", query.status)
  if (query?.includeArchived) params.set("includeArchived", "true")
  if (query?.page) params.set("page", String(query.page))
  if (query?.pageSize) params.set("pageSize", String(query.pageSize))
  if (query?.sort) params.set("sort", query.sort)
  if (query?.order) params.set("order", query.order)
  const qs = params.size > 0 ? `?${params.toString()}` : ""
  return apiGetPage<FormTemplateListItem>(`${FORM_PATH}${qs}`)
}

export async function getForm(id: string): Promise<FormTemplateDetail> {
  return apiGet<FormTemplateDetail>(`${FORM_PATH}/${encodeURIComponent(id)}`)
}

export async function createForm(input: { code: string; name: string; description?: string }): Promise<FormTemplateDetail> {
  return apiPost<FormTemplateDetail>(FORM_PATH, input)
}

export async function updateForm(
  id: string,
  input: { name?: string; description?: string | null },
): Promise<FormTemplateDetail> {
  return apiPatch<FormTemplateDetail>(`${FORM_PATH}/${encodeURIComponent(id)}`, input)
}

export async function archiveForm(id: string): Promise<void> {
  await apiDelete<{ archived: true }>(`${FORM_PATH}/${encodeURIComponent(id)}`)
}

export async function restoreForm(id: string): Promise<FormTemplateDetail> {
  return apiPost<FormTemplateDetail>(`${FORM_PATH}/${encodeURIComponent(id)}/restore`)
}

export async function duplicateForm(id: string): Promise<FormTemplateDetail> {
  return apiPost<FormTemplateDetail>(`${FORM_PATH}/${encodeURIComponent(id)}/duplicate`)
}

export async function saveFormDraft(id: string, changeNote?: string): Promise<{ templateId: string; version: number }> {
  return apiPost<{ templateId: string; version: number }>(
    `${FORM_PATH}/${encodeURIComponent(id)}/save-draft`,
    { changeNote },
  )
}

export async function publishForm(id: string, changeNote?: string): Promise<FormTemplateDetail> {
  return apiPost<FormTemplateDetail>(`${FORM_PATH}/${encodeURIComponent(id)}/publish`, { changeNote })
}

export async function getFormPreview(id: string): Promise<FormPreviewView> {
  return apiGet<FormPreviewView>(`${FORM_PATH}/${encodeURIComponent(id)}/preview`)
}

export async function createFormField(id: string, input: FormFieldInput): Promise<FormTemplateDetail> {
  return apiPost<FormTemplateDetail>(`${FORM_PATH}/${encodeURIComponent(id)}/fields`, input)
}

export async function updateFormField(
  id: string,
  fieldId: string,
  input: Partial<FormFieldInput>,
): Promise<FormTemplateDetail> {
  return apiPatch<FormTemplateDetail>(
    `${FORM_PATH}/${encodeURIComponent(id)}/fields/${encodeURIComponent(fieldId)}`,
    input,
  )
}

export async function removeFormField(id: string, fieldId: string): Promise<FormTemplateDetail> {
  return apiDelete<FormTemplateDetail>(
    `${FORM_PATH}/${encodeURIComponent(id)}/fields/${encodeURIComponent(fieldId)}`,
  )
}

export async function reorderFormFields(id: string, fieldIds: string[]): Promise<FormTemplateDetail> {
  return apiPost<FormTemplateDetail>(`${FORM_PATH}/${encodeURIComponent(id)}/fields/reorder`, { fieldIds })
}

export async function listFormVersions(id: string): Promise<FormVersionView[]> {
  return apiGet<FormVersionView[]>(`${FORM_PATH}/${encodeURIComponent(id)}/versions`)
}

export async function rollbackForm(id: string, version: number): Promise<FormTemplateDetail> {
  return apiPost<FormTemplateDetail>(`${FORM_PATH}/${encodeURIComponent(id)}/rollback`, { version })
}

export async function listFormHistory(id: string): Promise<FormHistoryView[]> {
  return apiGet<FormHistoryView[]>(`${FORM_PATH}/${encodeURIComponent(id)}/history`)
}

export async function assignForm(
  id: string,
  input: { targetType: FormAssignmentTargetType; targetId?: string | null; priority?: number },
): Promise<FormTemplateDetail> {
  return apiPost<FormTemplateDetail>(`${FORM_PATH}/${encodeURIComponent(id)}/assignments`, input)
}

export async function unassignForm(id: string, assignmentId: string): Promise<FormTemplateDetail> {
  return apiDelete<FormTemplateDetail>(
    `${FORM_PATH}/${encodeURIComponent(id)}/assignments/${encodeURIComponent(assignmentId)}`,
  )
}

export async function listFormAssignmentTargetOptions(
  targetType: Exclude<FormAssignmentTargetType, "UNIVERSITY">,
): Promise<Array<{ id: string; label: string }>> {
  return apiGet<Array<{ id: string; label: string }>>(
    `${FORM_PATH}/assignment-targets/${encodeURIComponent(targetType)}`,
  )
}

// =============================================================================
// Sprint 7.4.8 — Platform Setup Wizard (ROOT)
// Mirrors server modules/root/root.setup.*
// =============================================================================

const SETUP_PATH = "/root/setup"

export type SetupStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED"

export interface SetupSummary {
  organizations: { campuses: number; colleges: number; departments: number; offices: number; programs: number }
  folderTemplates: number
  requirementTemplates: number
  workflows: number
  forms: number
  administrators: number
  configKeysConfigured: number
}

export interface SetupStateView {
  id: string
  status: SetupStatus
  currentStep: number
  completedSteps: number[]
  logoObjectKey: string | null
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
  summary: SetupSummary
}

export async function getSetupState(): Promise<SetupStateView> {
  return apiGet<SetupStateView>(SETUP_PATH)
}

export async function startSetup(): Promise<SetupStateView> {
  return apiPost<SetupStateView>(`${SETUP_PATH}/start`)
}

export async function saveSetupProgress(
  currentStep: number,
  completedSteps: number[],
): Promise<SetupStateView> {
  return apiPatch<SetupStateView>(`${SETUP_PATH}/state`, { currentStep, completedSteps })
}

export async function uploadSetupLogo(input: {
  filename: string
  mimeType: string
  sizeBytes: number
}): Promise<{ uploadUrl: string; objectKey: string; headers: Record<string, string>; expiresInSeconds: number }> {
  return apiPost<{ uploadUrl: string; objectKey: string; headers: Record<string, string>; expiresInSeconds: number }>(
    `${SETUP_PATH}/logo`,
    input,
  )
}

export async function getSetupLogoUrl(): Promise<{ url: string; objectKey: string } | null> {
  return apiGet<{ url: string; objectKey: string } | null>(`${SETUP_PATH}/logo`)
}

export async function completeSetup(): Promise<SetupStateView> {
  return apiPost<SetupStateView>(`${SETUP_PATH}/complete`)
}

export async function reopenSetup(): Promise<SetupStateView> {
  return apiPost<SetupStateView>(`${SETUP_PATH}/reopen`)
}

export async function getSetupSummary(): Promise<SetupSummary> {
  return apiGet<SetupSummary>(`${SETUP_PATH}/summary`)
}

export async function sendSetupCredentials(input: {
  email: string
  name: string
  password: string
  roleName: string
}): Promise<{ sent: boolean }> {
  return apiPost<{ sent: boolean }>(`${SETUP_PATH}/send-credentials`, input)
}
