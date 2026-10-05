-- Add an optional programId FK to users (accounts register under a Program
-- within a College within a Campus; departmentId is retained but no longer
-- used during self-service registration).
ALTER TABLE "users" ADD COLUMN "programId" TEXT;

ALTER TABLE "users" ADD CONSTRAINT "users_programId_fkey" FOREIGN KEY ("programId") REFERENCES "programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "users_programId_idx" ON "users"("programId");
