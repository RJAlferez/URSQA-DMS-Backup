import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/modules/auth/auth.password";
import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import {
  assertCanAssignRole,
} from "@/modules/admin/_shared/admin.guard";
import {
  BadRequestError,
  EmailTakenError,
  EmployeeIdTakenError,
  ForbiddenError,
  NotFoundError,
} from "@/utils/errors";
import * as repo from "@/modules/admin/users/users.repository";
import type { AdminUserDetail, AdminUserListItem } from "@/modules/admin/users/users.types";
import { presignDownload } from "@/lib/storage";
import type {
  AdminListUsersQuery,
  CreateAdminUserBody,
  ForcePasswordChangeBody,
  ResetPasswordAdminBody,
  UpdateAdminUserBody,
  UpdateStatusBody,
} from "@/modules/admin/users/users.validator";

// =============================================================================
// URS-DMS — Admin · Users service (Sprint 7.2)
// -----------------------------------------------------------------------------
// Business logic + RBAC re-checks (defence in depth — the route layer's
// `requirePermission(...)` is the first gate; the service re-asserts the same
// permission so a wiring mistake at the route layer can never bypass RBAC).
// No `if (role === "admin")` anywhere.
//
// RBAC model (matches the catalog in permissions.constants.ts):
//   - user.read             → list + detail
//   - user.create           → create
//   - user.update           → update
//   - user.archive          → archive
//   - user.restore          → restore (distinct from archive per spec)
//   - user.status.update    → activate / deactivate (PATCH /:id/status)
//   - user.password.reset    → reset a user's password (also clears
//                             mustChangePassword unless explicitly asked)
//
// Security rules enforced here:
//   * The actor cannot archive themselves (would lock the only admin out).
//   * The actor cannot assign a role whose permissions they do not already
//     hold (privilege-escalation guard — `_shared/admin.guard.ts`).
//   * The actor cannot change their own status via this admin path (use the
//     self-service auth endpoint instead).
//   * Force-password-change and reset-password both revoke all sessions so
//     a stolen refresh token cannot immediately resume.
// =============================================================================

export interface Actor {
  id: string;
  permissions: string[];
  ipAddress?: string;
  userAgent?: string;
}

export interface ListResult {
  items: AdminUserDetail[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

// ---------------------------------------------------------------------------
// RBAC re-asserts (defence in depth)
// ---------------------------------------------------------------------------
function assertCanRead(actor: Actor): void {
  if (!actor.permissions.includes("user.read")) {
    throw new ForbiddenError("You do not have access to the admin users surface");
  }
}
function assertCanCreate(actor: Actor): void {
  if (!actor.permissions.includes("user.create")) {
    throw new ForbiddenError("You do not have permission to create users");
  }
}
function assertCanUpdate(actor: Actor): void {
  if (!actor.permissions.includes("user.update")) {
    throw new ForbiddenError("You do not have permission to update users");
  }
}
function assertCanArchive(actor: Actor): void {
  if (!actor.permissions.includes("user.archive")) {
    throw new ForbiddenError("You do not have permission to archive users");
  }
}
function assertCanRestore(actor: Actor): void {
  if (!actor.permissions.includes("user.restore")) {
    throw new ForbiddenError("You do not have permission to restore users");
  }
}
function assertCanChangeStatus(actor: Actor): void {
  if (!actor.permissions.includes("user.status.update")) {
    throw new ForbiddenError("You do not have permission to change user status");
  }
}
function assertCanResetPassword(actor: Actor): void {
  if (!actor.permissions.includes("user.password.reset")) {
    throw new ForbiddenError("You do not have permission to reset user passwords");
  }
}
// Force-password-change reuses the password-reset gate: only an admin who may
// reset a password may force the next-login flag. (Distinct code in the
// audit log; same RBAC gate.)
function assertCanForcePasswordChange(actor: Actor): void {
  if (!actor.permissions.includes("user.password.reset")) {
    throw new ForbiddenError("You do not have permission to force a password change");
  }
}

// ---------------------------------------------------------------------------
// FK existence pre-checks (turn P2003 FK violations into clean 400s)
// ---------------------------------------------------------------------------
async function assertRoleExists(roleId: string): Promise<void> {
  const role = await prisma.role.findFirst({
    where: { id: roleId, deletedAt: null },
    select: { id: true },
  });
  if (!role) throw new NotFoundError("Role not found");
}

async function assertDepartmentExists(departmentId: string | null | undefined): Promise<void> {
  if (departmentId === undefined || departmentId === null) return;
  const dept = await prisma.department.findFirst({
    where: { id: departmentId, deletedAt: null },
    select: { id: true },
  });
  if (!dept) throw new BadRequestError("Referenced department not found");
}

// ---------------------------------------------------------------------------
// ROOT protection (Sprint 7.4.1 — System Administrator foundation)
// ---------------------------------------------------------------------------
// The ROOT account is the system administrator bootstrap: it can never be
// archived, deactivated, re-rolled, or password-reset through the admin
// surface (that would be a root-lockout / root-deletion vector). ROOT
// accounts are managed from the Root Console only, and the only way to
// create one is to hold `root.access` (the privilege-escalation guard
// rejects every other actor when the target role is ROOT, because ROOT
// binds root.access and no other role does).
function assertNotRootTarget(existing: { roleName: string }): void {
  if (existing.roleName === "ROOT") {
    throw new ForbiddenError("Root accounts are protected; manage them from the Root Console");
  }
}

// ---------------------------------------------------------------------------
// listUsers
// ---------------------------------------------------------------------------
async function withPhotoUrl(item: AdminUserListItem): Promise<AdminUserListItem> {
  if (!item.profilePhotoKey) return item;
  try {
    const { url } = await presignDownload(item.profilePhotoKey);
    return { ...item, photoUrl: url };
  } catch {
    return { ...item, photoUrl: null };
  }
}

export async function listUsers(query: AdminListUsersQuery, actor: Actor): Promise<ListResult> {
  assertCanRead(actor);

  // Parse ISO date strings → Date. Zod already validated the string shape; the
  // Date conversion happens here so the repository stays pure-data-access.
  const r = await repo.list({
    q: query.q,
    page: query.page,
    pageSize: query.pageSize,
    includeArchived: query.includeArchived,
    roleId: query.roleId,
    departmentId: query.departmentId,
    collegeId: query.collegeId,
    status: query.status,
    createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
    createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
    updatedFrom: query.updatedFrom ? new Date(query.updatedFrom) : undefined,
    updatedTo: query.updatedTo ? new Date(query.updatedTo) : undefined,
    sort: query.sort,
    order: query.order,
  });

  return {
    items: await Promise.all(r.items.map(withPhotoUrl)),
    meta: {
      page: query.page,
      pageSize: query.pageSize,
      total: r.total,
      totalPages: Math.max(1, Math.ceil(r.total / query.pageSize)),
    },
  };
}

// ---------------------------------------------------------------------------
// getUser
// ---------------------------------------------------------------------------
export async function getUser(id: string, actor: Actor): Promise<AdminUserDetail> {
  assertCanRead(actor);
  const user = await repo.findById(id);
  if (!user) throw new NotFoundError("User not found");
  return withPhotoUrl(user);
}

// ---------------------------------------------------------------------------
// createUser
// ---------------------------------------------------------------------------
export async function createUser(
  input: CreateAdminUserBody,
  actor: Actor,
): Promise<AdminUserDetail> {
  assertCanCreate(actor);

  // Role existence + privilege-escalation check. The actor must already hold
  // every permission the target role grants, so they cannot bootstrap a more
  // privileged account than their own.
  await assertRoleExists(input.roleId);
  const roleCodes = await repo.loadRolePermissionCodes(input.roleId);
  assertCanAssignRole(actor, roleCodes);

  await assertDepartmentExists(input.departmentId);

  // Email / employeeId uniqueness — pre-check for a clean 409 message. The
  // DB UNIQUE constraints remain the ultimate guard (handles any race).
  if (await repo.findByEmail(input.email)) throw new EmailTakenError();
  if (await repo.findByEmployeeId(input.employeeId)) throw new EmployeeIdTakenError();

  const passwordHash = await hashPassword(input.password);
  const created = await repo.create({
    employeeId: input.employeeId,
    email: input.email,
    passwordHash,
    firstName: input.firstName,
    middleName: input.middleName ?? null,
    lastName: input.lastName,
    suffix: input.suffix ?? null,
    roleId: input.roleId,
    departmentId: input.departmentId ?? null,
    mustChangePassword: input.mustChangePassword ?? false,
  });

  await writeAudit({
    action: AUDIT_ACTIONS.USER_CREATED,
    userId: actor.id,
    entity: "user",
    entityId: created.id,
    newValue: {
      email: created.email,
      employeeId: created.employeeId,
      roleId: created.roleId,
      departmentId: created.departmentId,
      mustChangePassword: created.mustChangePassword,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return created;
}

// ---------------------------------------------------------------------------
// updateUser
// ---------------------------------------------------------------------------
export async function updateUser(
  id: string,
  input: UpdateAdminUserBody,
  actor: Actor,
): Promise<AdminUserDetail> {
  assertCanUpdate(actor);

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("User not found");
  if (existing.deletedAt) {
    throw new BadRequestError("User is archived; restore it before updating");
  }
  assertNotRootTarget(existing);

  if (input.email && input.email !== existing.email) {
    const conflict = await repo.findByEmail(input.email, id);
    if (conflict) throw new EmailTakenError();
  }

  if (input.roleId && input.roleId !== existing.roleId) {
    await assertRoleExists(input.roleId);
    const roleCodes = await repo.loadRolePermissionCodes(input.roleId);
    assertCanAssignRole(actor, roleCodes);
  }
  if (input.departmentId !== undefined) {
    await assertDepartmentExists(input.departmentId);
  }

  const updated = await repo.update({
    id,
    data: {
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
      ...(input.middleName !== undefined ? { middleName: input.middleName } : {}),
      ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
      ...(input.suffix !== undefined ? { suffix: input.suffix } : {}),
      ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
    },
  });

  const roleChanged = !!input.roleId && input.roleId !== existing.roleId;

  await writeAudit({
    action: roleChanged ? AUDIT_ACTIONS.USER_ROLE_CHANGED : AUDIT_ACTIONS.USER_UPDATED,
    userId: actor.id,
    entity: "user",
    entityId: id,
    oldValue: {
      email: existing.email,
      firstName: existing.firstName,
      lastName: existing.lastName,
      roleId: existing.roleId,
      departmentId: existing.departmentId,
    },
    newValue: {
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      roleId: updated.roleId,
      departmentId: updated.departmentId,
    },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// archiveUser (soft delete)
// ---------------------------------------------------------------------------
export async function archiveUser(id: string, actor: Actor): Promise<AdminUserDetail> {
  assertCanArchive(actor);

  const existing = await repo.findById(id, false);
  if (!existing) throw new NotFoundError("User not found");

  // Self-archive guard: an admin archiving themselves would lock the only
  // administrator out of the system. The self-service path is the only
  // legitimate way for an actor to remove their own access.
  if (existing.id === actor.id) {
    throw new ForbiddenError("You cannot archive your own account");
  }

  // ROOT accounts cannot be archived at all — the system administrator must
  // never be deleted through the admin surface (root-deletion prevention).
  assertNotRootTarget(existing);

  // Refuse to archive the last live administrator. A system with no live
  // admin becomes unmanageable (no other role holds `user.restore`). Count
  // live admins by joining users with the ADMINISTRATOR role name.
  if (existing.roleName === "ADMINISTRATOR") {
    const liveAdmins = await prisma.user.count({
      where: {
        deletedAt: null,
        role: { name: "ADMINISTRATOR" },
      },
    });
    if (liveAdmins <= 1) {
      throw new ForbiddenError("Refusing to archive the last live administrator");
    }
  }

  const archived = await repo.archive(id);
  await repo.revokeAllSessions(id);

  await writeAudit({
    action: AUDIT_ACTIONS.USER_ARCHIVED,
    userId: actor.id,
    entity: "user",
    entityId: id,
    oldValue: { status: existing.status, deletedAt: null },
    newValue: { status: archived.status, deletedAt: archived.deletedAt },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return archived;
}

// ---------------------------------------------------------------------------
// restoreUser
// ---------------------------------------------------------------------------
export async function restoreUser(id: string, actor: Actor): Promise<AdminUserDetail> {
  assertCanRestore(actor);

  const existing = await repo.findById(id, true);
  if (!existing) throw new NotFoundError("User not found");
  if (!existing.deletedAt) {
    throw new BadRequestError("User is not archived");
  }

  const restored = await repo.restore(id);

  await writeAudit({
    action: AUDIT_ACTIONS.USER_RESTORED,
    userId: actor.id,
    entity: "user",
    entityId: id,
    oldValue: { status: existing.status, deletedAt: existing.deletedAt },
    newValue: { status: restored.status, deletedAt: null },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return restored;
}

// ---------------------------------------------------------------------------
// changeUserStatus (activate / deactivate / suspend)
// ---------------------------------------------------------------------------
export async function changeUserStatus(
  id: string,
  input: UpdateStatusBody,
  actor: Actor,
): Promise<AdminUserDetail> {
  assertCanChangeStatus(actor);

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("User not found");
  if (existing.deletedAt) {
    throw new BadRequestError("User is archived; restore it before changing status");
  }
  assertNotRootTarget(existing);
  if (existing.status === input.status) {
    // Idempotent — return the existing row without an audit entry, matching
    // the project convention that no-op mutations don't audit.
    return existing;
  }

  // LOCKED is reserved for automatic lockout (failed-login throttling). The
  // admin surface can move a user between ACTIVE / INACTIVE / SUSPENDED only,
  // and the validator (updateStatusSchema) rejects LOCKED upstream — this re-
  // assertion is pure belt-and-braces in case a future caller bypasses the
  // validator.
  if ((input.status as string) === "LOCKED") {
    throw new ForbiddenError("Status LOCKED is managed automatically by the system");
  }

  // The spec lists "Activate Account" and "Deactivate Account" as distinct
  // features. We surface them as one status endpoint with an enum body so the
  // audit log emits the precise USER_ACTIVATED / USER_DEACTIVATED action.
  const updated = await repo.changeStatus(id, input.status);

  // Suspending or deactivating a user invalidates their refresh tokens so
  // they cannot keep using a previously-issued session. Matches the legacy
  // users.service.changeUserStatus behaviour.
  if (input.status === "INACTIVE" || input.status === "SUSPENDED") {
    await repo.revokeAllSessions(id);
  }

  const auditAction =
    input.status === "ACTIVE"
      ? AUDIT_ACTIONS.USER_ACTIVATED
      : input.status === "SUSPENDED"
        ? AUDIT_ACTIONS.USER_DEACTIVATED
        : AUDIT_ACTIONS.USER_DEACTIVATED; // INACTIVE → deactivated

  await writeAudit({
    action: auditAction,
    userId: actor.id,
    entity: "user",
    entityId: id,
    oldValue: { status: existing.status },
    newValue: { status: updated.status },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// resetUserPassword (admin-set new password + revoke sessions)
// ---------------------------------------------------------------------------
export async function resetUserPassword(
  id: string,
  input: ResetPasswordAdminBody,
  actor: Actor,
): Promise<AdminUserDetail> {
  assertCanResetPassword(actor);

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("User not found");
  if (existing.deletedAt) {
    throw new BadRequestError("User is archived; restore it before resetting its password");
  }
  assertNotRootTarget(existing);

  const passwordHash = await hashPassword(input.newPassword);
  // If the caller did not pass `mustChangePassword`, default to false on a
  // plain reset (the admin has just set the password and is handing it to the
  // user out-of-band). Force-password-change is the dedicated endpoint for
  // setting the flag on next login.
  const mustChange = input.mustChangePassword ?? false;
  const updated = await repo.updatePasswordHash(id, passwordHash, mustChange);
  await repo.revokeAllSessions(id);

  await writeAudit({
    action: AUDIT_ACTIONS.PASSWORD_RESET,
    userId: actor.id,
    entity: "user",
    entityId: id,
    newValue: { mustChangePassword: mustChange },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// forcePasswordChange (toggle the mustChangePassword flag)
// ---------------------------------------------------------------------------
export async function forcePasswordChange(
  id: string,
  input: ForcePasswordChangeBody,
  actor: Actor,
): Promise<AdminUserDetail> {
  assertCanForcePasswordChange(actor);

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError("User not found");
  if (existing.deletedAt) {
    throw new BadRequestError("User is archived; restore it before forcing a password change");
  }
  assertNotRootTarget(existing);
  if (existing.mustChangePassword === input.mustChange) {
    // Idempotent no-op — do not audit.
    return existing;
  }

  const updated = await repo.setMustChangePassword(id, input.mustChange);

  await writeAudit({
    action: AUDIT_ACTIONS.FORCE_PASSWORD_CHANGE,
    userId: actor.id,
    entity: "user",
    entityId: id,
    oldValue: { mustChangePassword: existing.mustChangePassword },
    newValue: { mustChangePassword: updated.mustChangePassword },
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
  });

  return updated;
}
