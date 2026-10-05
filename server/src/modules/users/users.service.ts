import * as repo from "@/modules/users/users.repository";
import { hashPassword } from "@/modules/auth/auth.password";
import { getCurrentUser, type AuthenticatedUser } from "@/modules/auth/auth.service";
import {
  EmailTakenError,
  EmployeeIdTakenError,
  NotFoundError,
  ForbiddenError,
} from "@/utils/errors";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import { loadCodesByRoleId } from "@/modules/permissions/permissions.repository";
import { assertCanAssignRole } from "@/modules/admin/_shared/admin.guard";
import type { Prisma, UserStatus } from "@prisma/client";
import type { CreateUserInput, UpdateUserInput, UpdateSelfInput } from "@/modules/users/users.validator";
import type { UserDetail, UserListItem } from "@/modules/users/users.types";
import { deleteObject, presignDownload, presignProfilePhotoUpload, statObject } from "@/lib/storage";
import type { ProfilePhotoFinalizeInput, ProfilePhotoPresignInput } from "@/modules/users/users.validator";

// =============================================================================
// URS-DMS — users service
// =============================================================================

export interface ListResult {
  items: UserListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

// -----------------------------------------------------------------------------
// Privilege-escalation / root-lockout guards (mirror of admin/users.service)
// The legacy /users CRUD surface is mounted alongside /admin/users; without
// these checks an ADMINISTRATOR could self-promote to ROOT (assign the ROOT
// role), reset the ROOT password, or archive/suspend ROOT.
// -----------------------------------------------------------------------------
async function assertActorCanAssignRole(actorId: string, roleId: string): Promise<void> {
  const [actor, targetRole] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { roleId: true } }),
    prisma.role.findFirst({ where: { id: roleId, deletedAt: null }, select: { id: true } }),
  ]);
  if (!targetRole) throw new NotFoundError("Role not found");
  if (!actor) throw new NotFoundError("Actor not found");
  const [actorCodes, roleCodes] = await Promise.all([
    loadCodesByRoleId(actor.roleId),
    loadCodesByRoleId(roleId),
  ]);
  assertCanAssignRole({ permissions: actorCodes }, roleCodes);
}

async function assertNotRootTarget(userId: string): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: { select: { name: true } } },
  });
  if (target?.role.name === "ROOT") {
    throw new ForbiddenError("Root accounts are protected; manage them from the Root Console");
  }
}

export async function presignOwnProfilePhoto(userId: string, input: ProfilePhotoPresignInput) {
  return presignProfilePhotoUpload(userId, input.mimeType, input.sizeBytes);
}

export async function finalizeOwnProfilePhoto(userId: string, input: ProfilePhotoFinalizeInput): Promise<{ photoUrl: string }> {
  if (!input.objectKey.startsWith(`profile-photos/${userId}/`)) throw new ForbiddenError("Invalid profile photo object");
  await statObject(input.objectKey);
  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { profilePhotoKey: true } });
  await prisma.user.update({ where: { id: userId }, data: { profilePhotoKey: input.objectKey } });
  if (existing?.profilePhotoKey && existing.profilePhotoKey !== input.objectKey) await deleteObject(existing.profilePhotoKey).catch(() => undefined);
  return { photoUrl: (await presignDownload(input.objectKey)).url };
}

export async function getOwnProfilePhoto(userId: string): Promise<{ photoUrl: string } | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { profilePhotoKey: true } });
  if (!user?.profilePhotoKey) return null;
  return { photoUrl: (await presignDownload(user.profilePhotoKey)).url };
}

export async function listUsers(query: {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: UserStatus;
  roleId?: string;
}): Promise<ListResult> {
  const r = await repo.list(query);
  return {
    items: r.items,
    meta: {
      page: r.page,
      pageSize: r.pageSize,
      total: r.total,
      totalPages: Math.max(1, Math.ceil(r.total / r.pageSize)),
    },
  };
}

export async function getUser(id: string): Promise<UserDetail> {
  const u = await repo.findById(id);
  if (!u) throw new NotFoundError("User not found");
  return u;
}

export async function createUser(
  data: CreateUserInput,
  actorId: string,
  ipAddress: string,
  userAgent: string,
): Promise<UserDetail> {
  const existingEmail = await repo.findByEmail(data.email);
  if (existingEmail) throw new EmailTakenError();

  const existingEmployeeId = await repo.findByEmployeeId(data.employeeId);
  if (existingEmployeeId) throw new EmployeeIdTakenError();

  const role = await prisma.role.findUnique({ where: { id: data.roleId } });
  if (!role) throw new NotFoundError("Role not found");
  await assertActorCanAssignRole(actorId, data.roleId);

  const passwordHash = await hashPassword(data.password);
  const created = await repo.create({ data, passwordHash });

  await writeAudit({
    action: AUDIT_ACTIONS.USER_CREATED,
    userId: actorId,
    entity: "user",
    entityId: created.id,
    newValue: { email: created.email, employeeId: created.employeeId, roleId: created.roleId },
    ipAddress,
    userAgent,
  });

  return created;
}

export async function updateUser(
  id: string,
  data: UpdateUserInput,
  actorId: string,
  ipAddress: string,
  userAgent: string,
): Promise<UserDetail> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("User not found");
  await assertNotRootTarget(id);

  if (data.email && data.email !== existing.email) {
    const conflict = await repo.findByEmail(data.email);
    if (conflict && conflict.id !== id) throw new EmailTakenError();
  }

  const roleChanged = !!data.roleId && data.roleId !== existing.roleId;
  if (roleChanged) {
    await assertActorCanAssignRole(actorId, data.roleId!);
  }

  const updated = await repo.update({ id, data });

  await writeAudit({
    action: roleChanged ? AUDIT_ACTIONS.USER_ROLE_CHANGED : AUDIT_ACTIONS.USER_UPDATED,
    userId: actorId,
    entity: "user",
    entityId: id,
    oldValue: {
      email: existing.email,
      firstName: existing.firstName,
      lastName: existing.lastName,
      roleId: existing.roleId,
    },
    newValue: data,
    ipAddress,
    userAgent,
  });

  return updated;
}

export async function changeUserStatus(
  id: string,
  status: UserStatus,
  actorId: string,
  ipAddress: string,
  userAgent: string,
): Promise<UserDetail> {
  if (status === "LOCKED") {
    throw new ForbiddenError("Status LOCKED is managed automatically by the system");
  }

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("User not found");
  await assertNotRootTarget(id);

  const updated = await repo.changeStatus(id, status);

  if (status === "INACTIVE" || status === "SUSPENDED") {
    await repo.revokeAllSessions(id);
  }

  await writeAudit({
    action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
    userId: actorId,
    entity: "user",
    entityId: id,
    oldValue: { status: existing.status },
    newValue: { status },
    ipAddress,
    userAgent,
  });

  return updated;
}

export async function resetUserPassword(
  id: string,
  newPassword: string,
  actorId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("User not found");
  await assertNotRootTarget(id);

  const passwordHash = await hashPassword(newPassword);
  await repo.updatePasswordHash(id, passwordHash);
  await repo.revokeAllSessions(id);

  await writeAudit({
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    userId: actorId,
    entity: "user",
    entityId: id,
    ipAddress,
    userAgent,
  });
}

export async function deleteUser(
  id: string,
  actorId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("User not found");

  if (existing.id === actorId) {
    throw new ForbiddenError("You cannot delete your own account");
  }
  await assertNotRootTarget(id);

  await repo.softDelete(id);
  await repo.revokeAllSessions(id);

  await writeAudit({
    action: AUDIT_ACTIONS.USER_DELETED,
    userId: actorId,
    entity: "user",
    entityId: id,
    ipAddress,
    userAgent,
  });
}

// -----------------------------------------------------------------------------
// Sprint 8.1 — self-service profile edit (PATCH /users/me)
// The authenticated identity is the target — never an arbitrary userId.
// Only the whitelisted name fields can change (validator is .strict()); the
// response is the safe authenticated view (no hashes/tokens/secrets).
// -----------------------------------------------------------------------------
export async function updateSelf(
  userId: string,
  input: UpdateSelfInput,
  ipAddress: string,
  userAgent: string,
): Promise<AuthenticatedUser> {
  const existing = await repo.findById(userId);
  if (!existing) throw new NotFoundError("User not found");

  const data: Prisma.UserUpdateInput = {};
  if (input.firstName !== undefined) data.firstName = input.firstName;
  if (input.lastName !== undefined) data.lastName = input.lastName;
  if (input.middleName !== undefined) data.middleName = input.middleName;
  if (input.suffix !== undefined) data.suffix = input.suffix;

  if (Object.keys(data).length > 0) {
    await prisma.user.update({ where: { id: userId }, data });
  }

  await writeAudit({
    action: AUDIT_ACTIONS.PROFILE_UPDATED,
    userId,
    entity: "user",
    entityId: userId,
    oldValue: {
      firstName: existing.firstName,
      middleName: existing.middleName,
      lastName: existing.lastName,
      suffix: existing.suffix,
    },
    newValue: data,
    ipAddress,
    userAgent,
  });

  return getCurrentUser(userId);
}

// =============================================================================
// Sprint 8.9 — Self-service data export
// =============================================================================

export interface UserDataExport {
  profile: Record<string, unknown>;
  documents: Array<{ id: string; title: string; type: string; size: number; createdAt: string }>;
  folders: Array<{ id: string; name: string; parentId: string | null }>;
  submissions: Array<{ id: string; status: string; requirementName: string; submittedAt: string }>;
  tasks: Array<{ id: string; title: string; status: string; dueDate: string | null }>;
  requests: Array<{ id: string; status: string; createdAt: string }>;
  exportedAt: string;
}

export async function exportUserData(userId: string): Promise<UserDataExport> {
  const [profile, documents, folders, submissions, tasks, requests] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, firstName: true, middleName: true, lastName: true, suffix: true, employeeId: true, status: true, role: { select: { name: true } }, createdAt: true, lastLogin: true },
    }),
    prisma.document.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true, title: true, classification: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.folder.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true, name: true, parentId: true },
      orderBy: { name: "asc" },
    }),
    prisma.aaccupSubmission.findMany({
      where: { submittedBy: userId },
      select: { id: true, status: true, submittedAt: true },
      orderBy: { submittedAt: "desc" },
    }),
    prisma.aaccupTask.findMany({
      where: { assigneeId: userId },
      select: { id: true, title: true, status: true, dueDate: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.documentRequest.findMany({
      where: { requesterId: userId },
      select: { id: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const name = [profile?.firstName, profile?.middleName, profile?.lastName, profile?.suffix].filter(Boolean).join(" ");

  return {
    profile: {
      id: profile?.id,
      email: profile?.email,
      name: name || "Unknown",
      employeeId: profile?.employeeId,
      status: profile?.status,
      role: profile?.role?.name,
      memberSince: profile?.createdAt?.toISOString(),
      lastLogin: profile?.lastLogin?.toISOString(),
    },
    documents: documents.map((d) => ({ id: d.id, title: d.title, type: d.classification, size: 0, createdAt: d.createdAt.toISOString() })),
    folders: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })),
    submissions: submissions.map((s) => ({ id: s.id, status: s.status, requirementName: "N/A", submittedAt: s.submittedAt?.toISOString() ?? "" })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, dueDate: t.dueDate?.toISOString() ?? null })),
    requests: requests.map((r) => ({ id: r.id, status: r.status, createdAt: r.createdAt.toISOString() })),
    exportedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Sprint 8.9 — Self-service account deactivation
// =============================================================================

export async function deactivateOwnAccount(
  userId: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError("User not found");

  // Soft-deactivate: archive user, their documents, and folders
  const now = new Date();
  await prisma.$transaction([
    prisma.document.updateMany({ where: { ownerId: userId, deletedAt: null }, data: { deletedAt: now } }),
    prisma.folder.updateMany({ where: { ownerId: userId, deletedAt: null }, data: { deletedAt: now } }),
    prisma.user.update({ where: { id: userId }, data: { status: "INACTIVE", deletedAt: now } }),
  ]);

  await writeAudit({
    action: "user.deactivated",
    userId,
    entity: "user",
    entityId: userId,
    newValue: { status: "INACTIVE", deactivatedAt: now.toISOString() },
    ipAddress,
    userAgent,
  });
}
