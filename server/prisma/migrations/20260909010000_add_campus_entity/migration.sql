-- =============================================================================
-- URS-DMS — Add Campus entity (Campus → College → Department / Program / Office)
-- -----------------------------------------------------------------------------
-- Introduces the top-level `campuses` table and attaches an optional `campusId`
-- FK to colleges, departments, offices and programs. Also adds the CAMPUS value
-- to the Organization entity enum so the versioned Organization Engine can track
-- campus lifecycle (create/update/archive/restore/rollback) like any other
-- master-data record.
-- =============================================================================

-- 1. OrganizationEntity enum: add CAMPUS -------------------------------------
ALTER TYPE "OrganizationEntity" ADD VALUE IF NOT EXISTS 'CAMPUS';

-- 2. campuses table -----------------------------------------------------------
CREATE TABLE "campuses" (
  "id"           TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "description"  TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"    TIMESTAMP(3),
  CONSTRAINT "campuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campuses_code_key" ON "campuses"("code");
CREATE INDEX "campuses_deletedAt_idx" ON "campuses"("deletedAt");
CREATE INDEX "campuses_displayOrder_idx" ON "campuses"("displayOrder");

-- 3. Attach campusId to existing master-data tables ---------------------------
ALTER TABLE "colleges" ADD COLUMN "campusId" TEXT;
ALTER TABLE "departments" ADD COLUMN "campusId" TEXT;
ALTER TABLE "offices" ADD COLUMN "campusId" TEXT;
ALTER TABLE "programs" ADD COLUMN "campusId" TEXT;

ALTER TABLE "colleges" ADD CONSTRAINT "colleges_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "departments" ADD CONSTRAINT "departments_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "offices" ADD CONSTRAINT "offices_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "programs" ADD CONSTRAINT "programs_campusId_fkey" FOREIGN KEY ("campusId") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "colleges_campusId_idx" ON "colleges"("campusId");
CREATE INDEX "departments_campusId_idx" ON "departments"("campusId");
CREATE INDEX "offices_campusId_idx" ON "offices"("campusId");
CREATE INDEX "programs_campusId_idx" ON "programs"("campusId");
