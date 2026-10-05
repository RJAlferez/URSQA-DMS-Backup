export type AuditCategory =
  | "AUTHENTICATION"
  | "SUBMISSION"
  | "REQUEST"
  | "SECURITY"
  | "ACCESS_CONTROL"
  | "SYSTEM"
  | "REPOSITORY";

export type AuditSeverity = "INFO" | "WARNING" | "CRITICAL";
export type AuditResult = "SUCCESS" | "FAILED" | "DENIED";
export type AuditStatus = "SUCCESS" | "FAILED" | "DENIED";
export type AuditModule = string;

export interface AuditActor {
  id: string | null;
  name: string | null;
  email: string | null;
  role: string | null;
  departmentId: string | null;
}

export interface AuditEntityRef {
  type: string | null;
  id: string | null;
}

export interface AuditLogListItem {
  id: string;
  timestamp: Date;
  action: string;
  category: string;
  severity: string;
  result: string;
  module: AuditModule;
  status: AuditStatus;
  user: AuditActor;
  entity: AuditEntityRef;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  actorName: string | null;
  actorRole: string | null;
  actorOrganization: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string | null;
  description: string | null;
}

export interface AuditLogDetail extends AuditLogListItem {
  changes: {
    oldValue: unknown;
    newValue: unknown;
  };
  metadata: unknown;
}

export interface AuditListResult {
  items: AuditLogListItem[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface AuditArchiveRecord {
  id: string;
  dateRangeFrom: Date;
  dateRangeTo: Date;
  recordCount: number;
  checksum: string;
  format: string;
  objectKey: string | null;
  createdBy: string | null;
  createdAt: Date;
  notes: string | null;
}

export interface AuditReviewView {
  id: string;
  auditLogId: string;
  status: "UNREVIEWED" | "REVIEWED" | "NEEDS_FOLLOW_UP";
  note: string | null;
  reviewedBy: string | null;
  reviewerName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditSummary {
  failedLoginsToday: number;
  criticalEventsToday: number;
  unreviewedCritical: number;
  recentRoleChanges: number;
  recentPermissionChanges: number;
  lastArchive: string | null;
  retentionYears: number;
  totalRecords: number;
}

export interface LoginGroup {
  ipAddress: string;
  count: number;
  firstAttempt: string;
  lastAttempt: string;
  items: AuditLogListItem[];
}

export interface AuditPreset {
  key: string;
  label: string;
  query: Partial<Record<string, string>>;
}
