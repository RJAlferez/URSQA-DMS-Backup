export interface DocumentFile {
  id: string
  name: string
  type: string
  area: string
  department: string
  dateModified: string
  size: string
  status: string
  uploadedBy?: string
  uploadDate?: string
  lastModifiedDate?: string
  tags?: string[]
  folderPath?: string[]
  fileUrl?: string
  thumbnailUrl?: string
  blobId?: string
  mimeType?: string
}

export interface PreviewFileActivity {
  id: string
  action: string
  user: string
  date: string
  avatar?: string
}

export interface PreviewFileVersion {
  id: string
  version: string
  date: string
  user: string
  changes: string
}

export interface PreviewDownloadResult {
  url: string
  filename: string
  mimeType?: string
}

export interface ServerDocumentVersion {
  id: string
  documentId: string
  versionNumber: number
  objectKey: string
  filename: string
  mimeType: string
  sizeBytes: string
  checksum: string
  changeNote: string | null
  uploadedById: string
  uploadedByName: string
  uploadedAt: string
}
