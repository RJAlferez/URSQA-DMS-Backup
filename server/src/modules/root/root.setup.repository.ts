import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { SetupSummary } from "@/modules/root/root.setup.types";

// =============================================================================
// URS-DMS — Platform Setup Wizard repository
// =============================================================================

export async function getState(): Promise<{
  id: string;
  status: string;
  currentStep: number;
  completedSteps: number[];
  logoObjectKey: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
} | null> {
  const row = await prisma.setupState.findUnique({ where: { id: "setup" } });
  if (!row) return null;
  const completed = Array.isArray(row.completedSteps) ? row.completedSteps : [];
  return {
    id: row.id,
    status: row.status,
    currentStep: row.currentStep,
    completedSteps: completed.filter((v): v is number => typeof v === "number"),
    logoObjectKey: row.logoObjectKey,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

export async function ensureState(): Promise<{
  id: string;
  status: string;
  currentStep: number;
  completedSteps: number[];
  logoObjectKey: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
}> {
  const existing = await getState();
  if (existing) return existing;
  await prisma.setupState.create({ data: { id: "setup", completedSteps: [] } });
  return (await getState()) as NonNullable<Awaited<ReturnType<typeof getState>>>;
}

export async function updateState(args: {
  status?: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  currentStep?: number;
  completedSteps?: number[];
  logoObjectKey?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  updatedBy: string | null;
}): Promise<void> {
  const data: Prisma.SetupStateUncheckedUpdateInput = {
    ...(args.status !== undefined ? { status: args.status } : {}),
    ...(args.currentStep !== undefined ? { currentStep: args.currentStep } : {}),
    ...(args.completedSteps !== undefined ? { completedSteps: args.completedSteps } : {}),
    ...(args.logoObjectKey !== undefined ? { logoObjectKey: args.logoObjectKey } : {}),
    ...(args.startedAt !== undefined ? { startedAt: args.startedAt } : {}),
    ...(args.completedAt !== undefined ? { completedAt: args.completedAt } : {}),
    updatedBy: args.updatedBy ?? undefined,
    updatedAt: new Date(),
  };
  await prisma.setupState.upsert({
    where: { id: "setup" },
    create: { id: "setup", completedSteps: [], ...(data as Prisma.SetupStateUncheckedCreateInput) },
    update: data,
  });
}

export async function getSummary(): Promise<SetupSummary> {
  const [
    campuses,
    colleges,
    departments,
    offices,
    programs,
    folderTemplates,
    requirementTemplates,
    workflows,
    forms,
    administrators,
    configKeysConfigured,
  ] = await Promise.all([
    prisma.campus.count({ where: { deletedAt: null } }),
    prisma.college.count({ where: { deletedAt: null } }),
    prisma.department.count({ where: { deletedAt: null } }),
    prisma.office.count({ where: { deletedAt: null } }),
    prisma.program.count({ where: { deletedAt: null } }),
    prisma.folderTemplate.count({ where: { deletedAt: null } }),
    prisma.requirementTemplate.count({ where: { deletedAt: null } }),
    prisma.workflowDefinition.count({ where: { deletedAt: null } }),
    prisma.formTemplate.count({ where: { deletedAt: null } }),
    prisma.user.count({
      where: {
        deletedAt: null,
        role: { name: "ADMINISTRATOR" },
      },
    }),
    prisma.configuration.count({ where: { status: "ACTIVE", deletedAt: null } }),
  ]);
  return {
    organizations: { campuses, colleges, departments, offices, programs },
    folderTemplates,
    requirementTemplates,
    workflows,
    forms,
    administrators,
    configKeysConfigured,
  };
}
