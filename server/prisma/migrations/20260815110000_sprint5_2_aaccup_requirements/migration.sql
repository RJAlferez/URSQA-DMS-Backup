-- Sprint 5.2 — AACCUP Requirements
-- Creates RequirementStatus enum, AaccupRequirement model, reverse relations on
-- AaccupArea (requirements[]) and User (aaccupRequirementsCreated/Updated).
-- documentCode is unique per Area via a composite unique constraint
-- (areaId, documentCode) so the same code may be reused across areas.

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable AaccupRequirement
CREATE TABLE "aaccup_requirements" (
    "id" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "documentCode" TEXT NOT NULL,
    "category" TEXT,
    "priority" TEXT,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "status" "RequirementStatus" NOT NULL DEFAULT 'ACTIVE',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "aaccup_requirements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aaccup_requirements_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "aaccup_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "aaccup_requirements_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "aaccup_requirements_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Composite unique: documentCode is unique within a single Area.
CREATE UNIQUE INDEX "aaccup_requirements_areaId_documentCode_key" ON "aaccup_requirements"("areaId", "documentCode");

-- Standard indexes for filtering / sorting.
CREATE INDEX "aaccup_requirements_areaId_idx" ON "aaccup_requirements"("areaId");
CREATE INDEX "aaccup_requirements_status_idx" ON "aaccup_requirements"("status");
CREATE INDEX "aaccup_requirements_priority_idx" ON "aaccup_requirements"("priority");
CREATE INDEX "aaccup_requirements_category_idx" ON "aaccup_requirements"("category");
CREATE INDEX "aaccup_requirements_displayOrder_idx" ON "aaccup_requirements"("displayOrder");
CREATE INDEX "aaccup_requirements_deletedAt_idx" ON "aaccup_requirements"("deletedAt");

-- Reverse relations added to existing tables are implicit in the schema;
-- no extra SQL is required on aaccup_areas / users.
