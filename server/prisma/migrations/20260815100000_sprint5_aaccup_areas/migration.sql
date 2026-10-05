-- Sprint 5 — AACCUP Management backend
-- Creates AreaStatus enum, AaccupArea model, reverse relations on Department/User,
-- and a partial unique index on code (only active rows must be unique).

-- CreateEnum
CREATE TYPE "AreaStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable AaccupArea
CREATE TABLE "aaccup_areas" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "departmentId" TEXT NOT NULL,
    "status" "AreaStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "aaccup_areas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "aaccup_areas_department_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "aaccup_areas_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "aaccup_areas_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Create partial unique index: active codes must be unique; archived codes can repeat.
CREATE UNIQUE INDEX "aaccup_areas_code_active" ON "aaccup_areas"("code") WHERE "deletedAt" IS NULL;

-- Standard indexes
CREATE INDEX "aaccup_areas_department" ON "aaccup_areas"("departmentId");
CREATE INDEX "aaccup_areas_status" ON "aaccup_areas"("status");
CREATE INDEX "aaccup_areas_deletedAt" ON "aaccup_areas"("deletedAt");
CREATE INDEX "aaccup_areas_code_all" ON "aaccup_areas"("code");

-- Reverse relations added to existing tables (Prisma handles these via schema, not SQL)
-- No additional SQL needed for User/Department reverse relations; the schema defines them.
