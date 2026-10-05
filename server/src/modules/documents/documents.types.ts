import type {
  DocumentClassification,
  DocumentStatus,
  Prisma,
  SharePermission,
} from "@prisma/client";

// =============================================================================
// URS-DMS — documents domain shapes
// =============================================================================

export interface DocumentListItem {
  id: string;
  title: string;
  description: string | null;
  status: DocumentStatus;
  classification: DocumentClassification;
  ownerId: string;
  ownerName: string;
  departmentId: string | null;
  departmentName: string | null;
  folderId: string | null;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  currentFilename: string | null;
  currentMimeType: string | null;
  currentSizeBytes: string | null;
  currentChecksum: string | null;
  /** Latest non-deleted AACCUP submission status for this document, if any. */
  submissionStatus: "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_REVISION" | "WITHDRAWN" | null;
  retentionUntil: Date | null;
  metadata: Prisma.JsonValue;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface DocumentDetail extends DocumentListItem {
  tags: string[];
  shares: DocumentShareView[];
  versions: DocumentVersionView[];
  deletedAt: Date | null;
}

export interface DocumentVersionView {
  id: string;
  documentId: string;
  versionNumber: number;
  objectKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: string;
  checksum: string;
  changeNote: string | null;
  uploadedById: string;
  uploadedByName: string;
  uploadedAt: Date;
}

export interface DocumentShareView {
  id: string;
  documentId: string;
  userId: string;
  userEmail: string;
  permission: SharePermission;
  expiresAt: Date | null;
  createdAt: Date;
}

export type DocumentWithRelations = Prisma.DocumentGetPayload<{
  select: typeof documentSelect;
}>;

export const documentSelect = {
  id: true,
  title: true,
  description: true,
  status: true,
  classification: true,
  retentionUntil: true,
  metadata: true,
  ownerId: true,
  departmentId: true,
  department: { select: { name: true } },
  folderId: true,
  currentVersionId: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  owner: { select: { firstName: true, lastName: true, email: true } },
  currentVersion: {
    select: {
      id: true,
      versionNumber: true,
      objectKey: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      checksum: true,
    },
  },
  tags: { select: { tag: true } },
  shares: {
    where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: {
      id: true,
      userId: true,
      permission: true,
      expiresAt: true,
      createdAt: true,
      user: { select: { email: true } },
    },
  },
  versions: {
    orderBy: { versionNumber: "desc" },
    select: {
      id: true,
      versionNumber: true,
      objectKey: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      checksum: true,
      changeNote: true,
      uploadedById: true,
      uploadedAt: true,
      uploadedBy: { select: { firstName: true, lastName: true } },
    },
  },
} satisfies Prisma.DocumentSelect;
