import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import { BadRequestError, ForbiddenError, NotFoundError } from "@/utils/errors";
import { presignDownload, presignUpload } from "@/lib/storage";
import { sendEmail } from "@/modules/email/email.service";
import * as repo from "@/modules/root/root.setup.repository";
import type {
  SendCredentialsInput,
  UpdateSetupStateInput,
  UploadLogoInput,
} from "@/modules/root/root.setup.validator";
import type {
  SetupStateView,
  SetupSummary,
} from "@/modules/root/root.setup.types";

// =============================================================================
// URS-DMS — Platform Setup Wizard service (Sprint 7.4.8)
// -----------------------------------------------------------------------------
// Orchestrates ONLY wizard lifecycle: state (singleton row in PostgreSQL),
// progress persistence, the MinIO logo object, and a live summary. Every piece
// of business data the wizard creates (organization records, folder /
// requirement / workflow / form templates + assignments, administrator users)
// is written by the existing engines — nothing is duplicated here. Read-only
// surfaces (state read, summary) do not audit; lifecycle mutations do.
// =============================================================================

export interface Actor {
  id: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

function assertPermission(actor: Actor, code: string, message: string): void {
  if (!actor.permissions.includes(code)) {
    throw new ForbiddenError(message);
  }
}

function toView(
  state: NonNullable<Awaited<ReturnType<typeof repo.getState>>>,
  summary: SetupSummary,
): SetupStateView {
  return {
    id: state.id,
    status: state.status as SetupStateView["status"],
    currentStep: state.currentStep,
    completedSteps: state.completedSteps,
    logoObjectKey: state.logoObjectKey,
    startedAt: state.startedAt ? state.startedAt.toISOString() : null,
    completedAt: state.completedAt ? state.completedAt.toISOString() : null,
    updatedAt: state.updatedAt.toISOString(),
    summary,
  };
}

export async function getSetup(actor: Actor): Promise<SetupStateView> {
  assertPermission(actor, "setup.read", "Missing permission: setup.read");
  const state = await repo.ensureState();
  const summary = await repo.getSummary();
  return toView(state, summary);
}

export async function startSetup(actor: Actor): Promise<SetupStateView> {
  assertPermission(actor, "setup.manage", "Missing permission: setup.manage");
  const state = await repo.ensureState();
  await repo.updateState({
    status: "IN_PROGRESS",
    startedAt: state.startedAt ?? new Date(),
    updatedBy: actor.id,
  });

  await writeAudit({
    action: AUDIT_ACTIONS.SETUP_STARTED,
    userId: actor.id,
    entity: "setup",
    entityId: "setup",
    newValue: { status: "IN_PROGRESS" },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return getSetup(actor);
}

export async function saveSetupState(
  input: UpdateSetupStateInput,
  actor: Actor,
): Promise<SetupStateView> {
  assertPermission(actor, "setup.manage", "Missing permission: setup.manage");
  await repo.ensureState();
  await repo.updateState({
    status: "IN_PROGRESS",
    currentStep: input.currentStep,
    completedSteps: input.completedSteps,
    updatedBy: actor.id,
  });

  await writeAudit({
    action: AUDIT_ACTIONS.SETUP_UPDATED,
    userId: actor.id,
    entity: "setup",
    entityId: "setup",
    newValue: { currentStep: input.currentStep, completedSteps: input.completedSteps },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return getSetup(actor);
}

export async function uploadLogo(
  input: UploadLogoInput,
  actor: Actor,
): Promise<{ uploadUrl: string; objectKey: string; headers: Record<string, string>; expiresInSeconds: number }> {
  assertPermission(actor, "setup.manage", "Missing permission: setup.manage");
  await repo.ensureState();

  // Reuses the shared MinIO presign helper (AI_CONTEXT §10 — lib/storage is
  // never modified, only called). documentId/versionId are fixed segments so
  // the logo key is stable and replaceable: documents/setup/logo/<file>.
  const upload = await presignUpload("setup", "logo", input.filename, input.mimeType, input.sizeBytes);
  await repo.updateState({ logoObjectKey: upload.objectKey, updatedBy: actor.id });

  await writeAudit({
    action: AUDIT_ACTIONS.SETUP_LOGO_UPLOADED,
    userId: actor.id,
    entity: "setup",
    entityId: "setup",
    newValue: { objectKey: upload.objectKey, filename: input.filename },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return {
    uploadUrl: upload.url,
    objectKey: upload.objectKey,
    headers: upload.headers,
    expiresInSeconds: upload.expiresInSeconds,
  };
}

export async function getLogoUrl(actor: Actor): Promise<{ url: string; objectKey: string } | null> {
  assertPermission(actor, "setup.read", "Missing permission: setup.read");
  const state = await repo.getState();
  if (!state?.logoObjectKey) return null;
  const { url } = await presignDownload(state.logoObjectKey);
  return { url, objectKey: state.logoObjectKey };
}

export async function completeSetup(actor: Actor): Promise<SetupStateView> {
  assertPermission(actor, "setup.manage", "Missing permission: setup.manage");
  const state = await repo.ensureState();
  if (state.status === "NOT_STARTED") {
    throw new BadRequestError("Setup has not been started");
  }
  await repo.updateState({
    status: "COMPLETED",
    currentStep: 8,
    completedSteps: [1, 2, 3, 4, 5, 6, 7, 8],
    completedAt: new Date(),
    updatedBy: actor.id,
  });

  await writeAudit({
    action: AUDIT_ACTIONS.SETUP_COMPLETED,
    userId: actor.id,
    entity: "setup",
    entityId: "setup",
    newValue: { summary: await repo.getSummary() },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return getSetup(actor);
}

export async function reopenSetup(actor: Actor): Promise<SetupStateView> {
  assertPermission(actor, "setup.manage", "Missing permission: setup.manage");
  const state = await repo.ensureState();
  if (state.status !== "COMPLETED") {
    throw new BadRequestError("Setup is not completed");
  }
  await repo.updateState({
    status: "IN_PROGRESS",
    completedAt: null,
    updatedBy: actor.id,
  });

  await writeAudit({
    action: AUDIT_ACTIONS.SETUP_UPDATED,
    userId: actor.id,
    entity: "setup",
    entityId: "setup",
    newValue: { status: "IN_PROGRESS", reopened: true },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return getSetup(actor);
}

export async function getSummary(actor: Actor): Promise<SetupSummary> {
  assertPermission(actor, "setup.read", "Missing permission: setup.read");
  return repo.getSummary();
}

// Sends the initial password for an account the wizard just created. The
// email travels through the existing Sprint 7.3 durable email queue (MinIO /
// PostgreSQL-backed); the credentials were chosen by ROOT in Step 7 and are
// delivered verbatim so the demo flow works with the console provider.
export async function sendCredentials(
  input: SendCredentialsInput,
  actor: Actor,
): Promise<{ sent: boolean }> {
  assertPermission(actor, "setup.manage", "Missing permission: setup.manage");
  await sendEmail({
    to: input.email,
    subject: "URS-QA DMS — Your administrator account",
    body: [
      `Hello ${input.name},`,
      "",
      `Your URS-QA DMS administrator account is ready.`,
      `  Role: ${input.roleName}`,
      `  Email: ${input.email}`,
      `  Initial password: ${input.password}`,
      "",
      "Sign in and change your password on first login.",
    ].join("\n"),
  });
  return { sent: true };
}

export function assertSetupNotCompleted(state: { status: string }): void {
  if (state.status === "COMPLETED") {
    throw new NotFoundError("Setup is already completed");
  }
}
