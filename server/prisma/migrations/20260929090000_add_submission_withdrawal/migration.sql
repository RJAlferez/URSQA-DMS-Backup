-- Allow submitters to withdraw submissions, including previously approved rows.
-- The original row remains as immutable history; the service flips isCurrent off
-- and records the withdrawal metadata before a later resubmission is created.
ALTER TYPE "SubmissionStatus" ADD VALUE 'WITHDRAWN';

ALTER TABLE "aaccup_submissions"
  ADD COLUMN "withdrawnAt" TIMESTAMP(3),
  ADD COLUMN "withdrawalReason" TEXT;

CREATE INDEX "aaccup_submissions_withdrawnAt_idx" ON "aaccup_submissions"("withdrawnAt");

ALTER TYPE "NotificationType" ADD VALUE 'AACCUP_SUBMISSION_WITHDRAWN';
