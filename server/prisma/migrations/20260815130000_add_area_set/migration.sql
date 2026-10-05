-- =============================================================================
-- Add areaSet discriminator for AACCUP / ISO / Certification entities
-- -----------------------------------------------------------------------------
-- The Accreditation, ISO, and Certification tabs are distinct entities that
-- share the same area/requirement/submission structure. This migration adds
-- the areaSet discriminator so each tab operates on its own record set.
-- Existing areas default to AACCUP.
-- =============================================================================

-- Create the enum type
CREATE TYPE "AreaSet" AS ENUM ('AACCUP', 'ISO', 'CERT');

-- Add the discriminator column (existing rows become AACCUP)
ALTER TABLE "aaccup_areas" ADD COLUMN "areaSet" "AreaSet" NOT NULL DEFAULT 'AACCUP';

-- Index for filtered listing
CREATE INDEX "aaccup_areas_areaSet_idx" ON "aaccup_areas"("areaSet");
