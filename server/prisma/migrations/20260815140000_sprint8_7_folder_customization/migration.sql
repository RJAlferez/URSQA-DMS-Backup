-- Sprint 8.7 — Folder customization (Rule 31)
-- Adds color and icon columns for per-user folder customization.
ALTER TABLE "folders" ADD COLUMN "color" TEXT;
ALTER TABLE "folders" ADD COLUMN "icon" TEXT;
