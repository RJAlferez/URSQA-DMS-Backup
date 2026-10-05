// =============================================================================
// URS-DMS — Reporting Engine domain shapes (Sprint 6.4)
// -----------------------------------------------------------------------------
// Centralized report responses. Every report shares the same envelope shape:
//
//   {
//     metadata:  ReportMetadata        (generatedAt, reportType, applied filters)
//     summary:   <per-report summary>   (aggregate statistics)
//     records:   <per-report rows>      (detailed records)
//     pagination?: PaginationMeta        (present only for paginated reports)
//   }
//
// All figures are computed LIVE from the database — no mock data, no cached
// snapshots. Compliance figures go through `modules/aaccup/services/compliance
// .service.ts` (single source of truth — never reimplemented here).
//
// PDF export is intentionally NOT implemented (per Sprint 6.4 spec), but the
// `ReportFormat` union includes it so the API surface stays stable when a PDF
// exporter is added in a later sprint. The validator rejects `format=pdf`
// until an exporter exists (see reports.validator.ts).
// =============================================================================

/** Export formats. `pdf` is reserved for a later sprint. */
export type ReportFormat = "json" | "csv" | "pdf";

/** Generic pagination meta shared by all paginated reports. */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Common metadata header carried by every report response. */
export interface ReportMetadata<TFilters = Record<string, unknown>> {
  /** Stable report slug (e.g. "documents", "aaccup"). */
  reportType: string;
  /** ISO-8601 timestamp the report was generated. */
  generatedAt: string;
  /** The validated filter object, echoed back to the client. */
  appliedFilters: TFilters;
}

/** A complete report response (the `data` field of sendSuccess). */
export interface ReportResult<
  TSummary = Record<string, unknown>,
  TRecord = unknown,
  TFilters = Record<string, unknown>,
> {
  metadata: ReportMetadata<TFilters>;
  summary: TSummary;
  records: TRecord[];
  pagination?: PaginationMeta;
}

// -----------------------------------------------------------------------------
// Shared filter shape
// -----------------------------------------------------------------------------

/**
 * The full filter vocabulary supported by the Reporting Engine. Individual
 * reports apply only the subset they care about (validated per endpoint).
 */
export interface ReportFilters {
  from?: Date;
  to?: Date;
  departmentId?: string;
  areaId?: string;
  status?: string;
  userId?: string;
  roleId?: string;
  documentType?: string;
  requestType?: string;
  /** Audit-only: exact (case-insensitive) match on AuditLog.entity. */
  entity?: string;
}

// -----------------------------------------------------------------------------
// 1. DOCUMENT REPORT
// -----------------------------------------------------------------------------

export interface DocumentReportRow {
  id: string;
  title: string;
  status: string;
  classification: string;
  ownerId: string;
  ownerName: string;
  departmentId: string | null;
  departmentName: string | null;
  versionCount: number;
  totalSizeBytes: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentReportSummary {
  totalDocuments: number;
  byStatus: { label: string; value: number }[];
  byClassification: { label: string; value: number }[];
  byDepartment: { label: string; value: number }[];
  totalSizeBytes: string;
  totalVersions: number;
}

// -----------------------------------------------------------------------------
// 2. REQUEST REPORT
// -----------------------------------------------------------------------------

export interface RequestReportRow {
  id: string;
  title: string;
  status: string;
  requesterId: string;
  requesterName: string;
  documentId: string | null;
  documentTitle: string | null;
  decidedById: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RequestReportSummary {
  totalRequests: number;
  byStatus: { label: string; value: number }[];
  approvalRate: number;
  averageProcessingTimeMinutes: number;
  totalDecided: number;
}

// -----------------------------------------------------------------------------
// 3. AACCUP COMPLIANCE REPORT
// -----------------------------------------------------------------------------

export interface AaccupReportAreaRow {
  areaId: string;
  areaCode: string;
  areaName: string;
  departmentId: string;
  departmentName: string;
  totalRequirements: number;
  completedRequirements: number;
  compliancePercentage: number;
  requirementCounts: {
    COMPLETED: number;
    PENDING: number;
    NEEDS_REVISION: number;
    REJECTED: number;
    MISSING: number;
  };
}

export interface AaccupReportSummary {
  totalDepartments: number;
  totalAreas: number;
  totalRequirements: number;
  requirementStatusCounts: {
    COMPLETED: number;
    PENDING: number;
    NEEDS_REVISION: number;
    REJECTED: number;
    MISSING: number;
  };
  totalApproved: number;
  totalPending: number;
  totalMissing: number;
  compliancePercentage: number;
}

// -----------------------------------------------------------------------------
// 4. DEPARTMENT REPORT
// -----------------------------------------------------------------------------

export interface DepartmentReportRow {
  id: string;
  name: string;
  code: string;
  headName: string | null;
  userCount: number;
  documentCount: number;
  areaCount: number;
  requirementCount: number;
  compliancePercentage: number;
  createdAt: Date;
}

export interface DepartmentReportSummary {
  totalDepartments: number;
  totalUsers: number;
  totalDocuments: number;
  totalAreas: number;
  averageCompliancePercentage: number;
}

// -----------------------------------------------------------------------------
// 5. USER ACTIVITY REPORT
// -----------------------------------------------------------------------------

export interface UserActivityReportRow {
  userId: string;
  employeeId: string;
  email: string;
  fullName: string;
  roleName: string;
  departmentId: string | null;
  status: string;
  documentCount: number;
  requestCount: number;
  submissionCount: number;
  auditEventCount: number;
  lastLogin: Date | null;
  createdAt: Date;
}

export interface UserActivityReportSummary {
  totalUsers: number;
  activeUsers: number;
  totalDocuments: number;
  totalRequests: number;
  totalSubmissions: number;
  totalAuditEvents: number;
  byRole: { label: string; value: number }[];
}

// -----------------------------------------------------------------------------
// 6. STORAGE REPORT
// -----------------------------------------------------------------------------

export interface StorageReportRow {
  departmentId: string | null;
  departmentName: string | null;
  fileCount: number;
  versionCount: number;
  totalSizeBytes: string;
}

export interface StorageReportSummary {
  totalFiles: number;
  totalVersions: number;
  totalSizeBytes: string;
  availableStorageBytes: string | null;
  byMimeType: { label: string; value: number }[];
}

// -----------------------------------------------------------------------------
// 7. AUDIT REPORT
// -----------------------------------------------------------------------------

export interface AuditReportRow {
  id: string;
  timestamp: Date;
  action: string;
  module: string;
  status: "SUCCESS" | "FAILED" | "DENIED";
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  userRole: string | null;
  entity: string | null;
  entityId: string | null;
  ipAddress: string | null;
}

export interface AuditReportSummary {
  totalEvents: number;
  successCount: number;
  failedCount: number;
  deniedCount: number;
  byModule: { label: string; value: number }[];
  byAction: { label: string; value: number }[];
}
