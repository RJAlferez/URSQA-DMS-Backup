// =============================================================================
// URS-DMS — Platform Setup Wizard domain shapes
// =============================================================================

export interface SetupSummary {
  organizations: {
    campuses: number;
    colleges: number;
    departments: number;
    offices: number;
    programs: number;
  };
  folderTemplates: number;
  requirementTemplates: number;
  workflows: number;
  forms: number;
  administrators: number;
  configKeysConfigured: number;
}

export interface SetupStateView {
  id: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  currentStep: number;
  completedSteps: number[];
  logoObjectKey: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  summary: SetupSummary;
}
