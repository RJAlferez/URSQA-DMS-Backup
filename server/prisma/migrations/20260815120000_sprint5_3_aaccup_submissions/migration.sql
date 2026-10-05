-- Sprint 5.3 — AACCUP document submissions & assignment
-- Creates SubmissionStatus enum, AaccupSubmission model, reverse relations on
-- AaccupRequirement (submissions[]), Document (aaccupSubmissions[]), and
-- User (aaccupSubmissionsSubmitted / aaccupSubmissionsReviewed).
-- A requirement may have many submissions; only one row may be "current" at a
-- time — that invariant is enforced in the service (transactional flag flip),
-- not via a partial unique index, because requirements can hold full history.

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVISION');

-- CreateTable AaccupSubmission
CREATE TABLE "aaccup_submissions" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "submittedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "remarks" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "aaccup_submissions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aaccup_submissions_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "aaccup_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "aaccup_submissions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "aaccup_submissions_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "aaccup_submissions_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Standard indexes for filtering / scoping / sorting.
CREATE INDEX "aaccup_submissions_requirementId_idx" ON "aaccup_submissions"("requirementId");
CREATE INDEX "aaccup_submissions_documentId_idx" ON "aaccup_submissions"("documentId");
CREATE INDEX "aaccup_submissions_submittedBy_idx" ON "aaccup_submissions"("submittedBy");
CREATE INDEX "aaccup_submissions_reviewedBy_idx" ON "aaccup_submissions"("reviewedBy");
CREATE INDEX "aaccup_submissions_status_idx" ON "aaccup_submissions"("status");
CREATE INDEX "aaccup_submissions_isCurrent_idx" ON "aaccup_submissions"("isCurrent");
CREATE INDEX "aaccup_submissions_deletedAt_idx" ON "aaccup_submissions"("deletedAt");

-- Reverse relations added to existing tables are implicit in the schema;
-- no extra SQL is required on aaccup_requirements / documents / users.
