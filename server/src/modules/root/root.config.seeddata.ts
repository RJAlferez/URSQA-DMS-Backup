// =============================================================================
// URS-DMS â€” Root Â· Configuration Engine seed data (Sprint 7.4.1)
// -----------------------------------------------------------------------------
// The canonical default set the engine is seeded with. The Sprint 7.4.1 spec
// mandates that the platform-level settings below come from the Configuration
// Service (never hardcoded in consumers) â€” these defaults mirror the
// SystemSetting singleton (Sprint 7.1) so the legacy admin surface and the
// engine agree out of the box.
//
// All seed entries are `isSystem: true` â†’ the engine refuses to delete them
// (config tampering prevention); the Root Console can still change their
// VALUE, which goes through the versioning + history + cache invalidation
// pipeline.
// =============================================================================

import type { ConfigurationValueType } from "@prisma/client";

export interface SeedConfigurationCategory {
  code: string;
  name: string;
  description: string;
  displayOrder: number;
}

export interface SeedConfiguration {
  categoryCode: string;
  key: string;
  name: string;
  description: string;
  value: unknown;
  valueType: ConfigurationValueType;
}

export const SEED_CONFIGURATION_CATEGORIES: SeedConfigurationCategory[] = [
  {
    code: "system",
    name: "System",
    description: "Core platform settings",
    displayOrder: 1,
  },
  {
    code: "university",
    name: "University",
    description: "University identity settings",
    displayOrder: 2,
  },
  {
    code: "academic",
    name: "Academic",
    description: "Academic calendar settings",
    displayOrder: 3,
  },
  {
    code: "security",
    name: "Security",
    description: "Authentication and session security",
    displayOrder: 4,
  },
  {
    code: "upload",
    name: "Uploads",
    description: "Document upload constraints",
    displayOrder: 5,
  },
  {
    code: "storage",
    name: "Storage",
    description: "Storage quotas and thresholds",
    displayOrder: 6,
  },
  {
    code: "pagination",
    name: "Pagination",
    description: "Default list page sizes",
    displayOrder: 7,
  },
];

export const SEED_CONFIGURATIONS: SeedConfiguration[] = [
  {
    categoryCode: "system",
    key: "application.name",
    name: "Application Name",
    description: "Display name of the document management system",
    value: "URS-QA DMS",
    valueType: "STRING",
  },
  {
    categoryCode: "system",
    key: "maintenance.mode",
    name: "Maintenance Mode",
    description: "When enabled, the platform is in read-only maintenance",
    value: false,
    valueType: "BOOLEAN",
  },
  {
    categoryCode: "university",
    key: "university.name",
    name: "University Name",
    description: "Official name of the university",
    value: "University of Rizal System",
    valueType: "STRING",
  },
  {
    categoryCode: "academic",
    key: "academic.year",
    name: "Academic Year",
    description: "Current academic year",
    value: "2025-2026",
    valueType: "STRING",
  },
  {
    categoryCode: "academic",
    key: "academic.semester",
    name: "Semester",
    description: "Current academic term",
    value: "1st Semester",
    valueType: "STRING",
  },
  {
    categoryCode: "university",
    key: "university.primary_color",
    name: "Primary Color",
    description: "Primary brand color (hex) used across the platform",
    value: "#2563EB",
    valueType: "STRING",
  },
  {
    categoryCode: "university",
    key: "university.secondary_color",
    name: "Secondary Color",
    description: "Secondary brand color (hex) used across the platform",
    value: "#10B981",
    valueType: "STRING",
  },
  {
    categoryCode: "university",
    key: "university.timezone",
    name: "Timezone",
    description: "Platform timezone (IANA name)",
    value: "Asia/Manila",
    valueType: "STRING",
  },
  {
    categoryCode: "university",
    key: "university.language",
    name: "Language",
    description: "Default platform language code",
    value: "en",
    valueType: "STRING",
  },
  {
    categoryCode: "upload",
    key: "upload.allowed_file_types",
    name: "Allowed File Types",
    description: "Accepted file extensions (no leading dot)",
    value: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "jpg", "jpeg", "png", "zip", "mp4", "webm", "mov", "avi", "mkv"],
    valueType: "LIST",
  },
  {
    categoryCode: "security",
    key: "security.session_timeout_minutes",
    name: "Session Timeout (minutes)",
    description: "Idle session timeout in minutes",
    value: 60,
    valueType: "NUMBER",
  },
  {
    categoryCode: "storage",
    key: "storage.warning_threshold_percent",
    name: "Storage Warning Threshold (%)",
    description: "Used-quota percentage that triggers a storage warning",
    value: 80,
    valueType: "NUMBER",
  },
  {
    categoryCode: "pagination",
    key: "pagination.default_size",
    name: "Default Pagination Size",
    description: "Default rows per page for list endpoints",
    value: 25,
    valueType: "NUMBER",
  },
];
