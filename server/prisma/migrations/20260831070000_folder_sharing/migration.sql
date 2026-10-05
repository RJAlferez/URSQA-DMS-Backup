-- Additive folder-sharing model. Existing repository rows are untouched.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'FOLDER_SHARED_ACCESS';

CREATE TYPE "FolderShareRecipientType" AS ENUM ('USER', 'DEPARTMENT');

CREATE TABLE "folder_shares" (
    "id" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "recipientType" "FolderShareRecipientType" NOT NULL,
    "userId" TEXT,
    "departmentId" TEXT,
    "permission" "SharePermission" NOT NULL DEFAULT 'READ',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "folder_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "folder_shares_folderId_userId_key" ON "folder_shares"("folderId", "userId");
CREATE UNIQUE INDEX "folder_shares_folderId_departmentId_key" ON "folder_shares"("folderId", "departmentId");
CREATE INDEX "folder_shares_folderId_idx" ON "folder_shares"("folderId");
CREATE INDEX "folder_shares_userId_idx" ON "folder_shares"("userId");
CREATE INDEX "folder_shares_departmentId_idx" ON "folder_shares"("departmentId");

ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "folder_shares" ADD CONSTRAINT "folder_shares_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
