// =============================================================================
// URS-DMS — AACCUP submission domain shapes
// =============================================================================

export interface AaccupSubmissionListItem {
  id: string;
  requirementId: string;
  requirementTitle: string;
  requirementDocumentCode: string;
  areaId: string;
  areaCode: string;
  areaName: string;
  areaSet: string;
  departmentId: string | null;
  departmentName: string | null;
  taskId: string | null;
  taskTitle: string | null;
  taskStatus: string | null;
  documentId: string;
  documentTitle: string;
  submittedById: string;
  submittedByName: string;
  reviewedById: string | null;
  reviewedByName: string | null;
  status: string;
  remarks: string | null;
  isCurrent: boolean;
  submittedAt: Date;
  reviewedAt: Date | null;
  withdrawnAt: Date | null;
  withdrawalReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AaccupSubmissionDetail extends AaccupSubmissionListItem {
  deletedAt: Date | null;
}
