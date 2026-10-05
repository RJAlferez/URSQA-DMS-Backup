import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { hashPassword, verifyPassword } from "@/modules/auth/auth.password";
import { signAccessToken } from "@/modules/auth/auth.tokens";
import { randomToken, sha256 } from "@/utils/hash";
import { parseUserAgent } from "@/utils/device";
import {
  AccountInactiveError,
  AccountLockedError,
  BadRequestError,
  InvalidCredentialsError,
  NotFoundError,
  PasswordTooWeakError,
  RefreshReuseDetectedError,
  TokenInvalidError,
} from "@/utils/errors";
import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import { loadCodesByRoleId } from "@/modules/permissions/permissions.repository";

// =============================================================================
// URS-DMS — auth service
// All business logic for login, refresh, logout, password change, /me lives here.
// Controllers are thin and delegate to these functions.
// =============================================================================

/**
 * How long a just-rotated session is still treated as "in-flight rotation"
 * rather than token theft. When the access token expires, a page refresh can
 * fire several API calls at once; if each 401 triggered its own /auth/refresh,
 * the second caller would present a refresh token the first had just rotated,
 * trip reuse-detection, and revoke EVERY session for the user — bouncing them
 * to the login page. A token presented within this window is assumed to be a
 * concurrent rotation race, not a replay attack, so we mint a fresh session
 * instead of escalating to the all-sessions revocation.
 */
const REFRESH_ROTATION_GRACE_MS = 60_000;

export interface AuthenticatedUser {
  id: string;
  employeeId: string;
  email: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  status: string;
  role: string;
  departmentId: string | null;
  departmentName: string | null;
  createdAt: string;
  lastLogin: string | null;
  permissions: string[];
  profilePhotoKey: string | null;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
}

async function buildUserView(userId: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      employeeId: true,
      email: true,
      firstName: true,
      middleName: true,
      lastName: true,
      suffix: true,
      status: true,
      departmentId: true,
      createdAt: true,
      lastLogin: true,
      profilePhotoKey: true,
      roleId: true,
      role: { select: { name: true } },
    },
  });
  if (!user) throw new NotFoundError("User not found");
  const permissions = await loadCodesByRoleId(user.roleId);
  const departmentName = user.departmentId
    ? (await prisma.department.findUnique({
        where: { id: user.departmentId },
        select: { name: true },
      }))?.name ?? null
    : null;
  return {
    id: user.id,
    employeeId: user.employeeId,
    email: user.email,
    firstName: user.firstName,
    middleName: user.middleName,
    lastName: user.lastName,
    suffix: user.suffix,
    status: user.status,
    role: user.role.name,
    departmentId: user.departmentId,
    departmentName,
    createdAt: user.createdAt.toISOString(),
    lastLogin: user.lastLogin?.toISOString() ?? null,
    permissions,
    profilePhotoKey: user.profilePhotoKey,
  };
}

async function issueSession(
  userId: string,
  ipAddress: string,
  userAgent: string,
): Promise<{ sessionId: string; accessToken: string; refreshToken: string }> {
  const sessionId = randomToken(24);
  const refreshToken = randomToken(48);
  const refreshHash = sha256(refreshToken);
  const { device, browser } = parseUserAgent(userAgent);

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      id: sessionId,
      userId,
      refreshTokenHash: refreshHash,
      ipAddress,
      device,
      browser,
      expiresAt,
    },
  });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { roleId: true, role: { select: { name: true } } },
  });
  if (!user) throw new NotFoundError("User not found");

  const accessToken = signAccessToken({
    sub: userId,
    roleId: user.roleId,
    roleName: user.role.name,
    sessionId,
  });

  return { sessionId, accessToken, refreshToken };
}

export async function login(
  identifier: string,
  password: string,
  ipAddress: string,
  userAgent: string,
): Promise<LoginResult> {
  const normalized = identifier.trim().toLowerCase();

  // Try email first, then employeeId
  const user =
    (await prisma.user.findFirst({
      where: { email: normalized, deletedAt: null },
      include: { role: { select: { name: true } } },
    })) ??
    (await prisma.user.findFirst({
      where: { employeeId: identifier.trim(), deletedAt: null },
      include: { role: { select: { name: true } } },
    }));

  if (!user) {
    await writeAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      newValue: { reason: "unknown_user", identifier },
      ipAddress,
      userAgent,
      category: "AUTHENTICATION",
      severity: "WARNING",
    });
    throw new InvalidCredentialsError();
  }

  // Lockout check
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await writeAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      userId: user.id,
      newValue: { reason: "account_locked", lockedUntil: user.lockedUntil },
      ipAddress,
      userAgent,
      category: "AUTHENTICATION",
      severity: "WARNING",
    });
    throw new AccountLockedError(user.lockedUntil);
  }

  // Status check (only ACTIVE allowed)
  if (user.status !== "ACTIVE") {
    await writeAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      userId: user.id,
      newValue: { reason: "account_inactive", status: user.status },
      ipAddress,
      userAgent,
      category: "AUTHENTICATION",
      severity: "WARNING",
    });
    throw new AccountInactiveError(user.status);
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failedAttempts = user.failedAttempts + 1;
    const shouldLock = failedAttempts >= env.MAX_FAILED_LOGIN_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedAttempts,
        ...(shouldLock
          ? {
              status: "LOCKED",
              lockedUntil: new Date(Date.now() + env.LOCK_DURATION_MIN * 60 * 1000),
            }
          : {}),
      },
    });
    await writeAudit({
      action: AUDIT_ACTIONS.LOGIN_FAILED,
      userId: user.id,
      newValue: { reason: "bad_password", failedAttempts, locked: shouldLock },
      ipAddress,
      userAgent,
      category: "AUTHENTICATION",
      severity: "WARNING",
    });
    if (shouldLock) {
      throw new AccountLockedError(new Date(Date.now() + env.LOCK_DURATION_MIN * 60 * 1000));
    }
    throw new InvalidCredentialsError();
  }

  // Success: reset counters, update lastLogin
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedAttempts: 0,
      lockedUntil: null,
      status: "ACTIVE",
      lastLogin: new Date(),
    },
  });

  const { sessionId, accessToken, refreshToken } = await issueSession(
    user.id,
    ipAddress,
    userAgent,
  );

  await writeAudit({
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    userId: user.id,
    entity: "session",
    entityId: sessionId,
    ipAddress,
    userAgent,
    category: "AUTHENTICATION",
    severity: "INFO",
    actorName: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
    actorRole: user.role?.name ?? undefined,
  });

  // ROOT sessions get the dedicated root.login action. This is emitted here,
  // where the role and session id are known, so it is written exactly once —
  // the old polling watcher re-emitted root.login on every token refresh.
  if (user.role?.name === "ROOT") {
    await writeAudit({
      action: AUDIT_ACTIONS.ROOT_LOGIN,
      userId: user.id,
      entity: "session",
      entityId: sessionId,
      ipAddress,
      userAgent,
      category: "AUTHENTICATION",
      severity: "INFO",
      actorName: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
      actorRole: user.role.name,
    });
  }

  const userView = await buildUserView(user.id);
  return { accessToken, refreshToken, user: userView };
}

export async function refresh(
  refreshToken: string | undefined,
  cookieToken: string | undefined,
  ipAddress: string,
  userAgent: string,
): Promise<LoginResult> {
  const token = refreshToken ?? cookieToken;
  if (!token) {
    throw new TokenInvalidError("Missing refresh token");
  }

  // Refresh tokens are opaque random strings (not JWTs) — their hash is the
  // lookup key. We do NOT verify them as JWTs.
  const tokenHash = sha256(token);
  const existing = await prisma.session.findUnique({ where: { refreshTokenHash: tokenHash } });

  if (!existing) {
    await writeAudit({
      action: AUDIT_ACTIONS.REFRESH_FAILED,
      newValue: { reason: "session_not_found" },
      ipAddress,
      userAgent,
      category: "AUTHENTICATION",
      severity: "WARNING",
    });
    throw new TokenInvalidError();
  }

  // Reuse detection: token presented after it was already revoked
  if (existing.revokedAt) {
    // If the session was revoked within the rotation grace window, this is a
    // concurrent-rotation race (parallel 401s on page refresh), not a replay.
    // Fall through and mint a fresh session — otherwise the race would nuke
    // every session and boot the user back to the login page.
    const rotatedRecently = Date.now() - existing.revokedAt.getTime() <= REFRESH_ROTATION_GRACE_MS;
    if (!rotatedRecently) {
      // Genuine replay of a stale token → revoke ALL sessions (theft mitigation)
      await prisma.session.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await writeAudit({
        action: AUDIT_ACTIONS.REFRESH_REUSE,
        userId: existing.userId,
        entity: "session",
        entityId: existing.id,
        ipAddress,
        userAgent,
        category: "SECURITY",
        severity: "WARNING",
      });
      throw new RefreshReuseDetectedError();
    }
  }

  if (existing.expiresAt < new Date()) {
    throw new TokenInvalidError("Refresh token expired");
  }

  // Rotate: revoke old, create new
  await prisma.session.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  const issued = await issueSession(existing.userId, ipAddress, userAgent);

  await writeAudit({
    action: AUDIT_ACTIONS.REFRESH_SUCCESS,
    userId: existing.userId,
    entity: "session",
    entityId: issued.sessionId,
    ipAddress,
    userAgent,
    category: "AUTHENTICATION",
    severity: "INFO",
  });

  const userView = await buildUserView(existing.userId);
  return {
    accessToken: issued.accessToken,
    refreshToken: issued.refreshToken,
    user: userView,
  };
}

export async function logout(
  refreshToken: string | undefined,
  cookieToken: string | undefined,
  userId: string | undefined,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const token = refreshToken ?? cookieToken;
  let resolvedUserId = userId ?? null;

  if (token) {
    const tokenHash = sha256(token);
    if (!resolvedUserId) {
      const session = await prisma.session.findFirst({
        where: { refreshTokenHash: tokenHash, revokedAt: null },
        select: { userId: true },
      });
      resolvedUserId = session?.userId ?? null;
    }
    await prisma.session.updateMany({
      where: { refreshTokenHash: tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  if (resolvedUserId) {
    await writeAudit({
      action: AUDIT_ACTIONS.LOGOUT,
      userId: resolvedUserId,
      ipAddress,
      userAgent,
      category: "AUTHENTICATION",
      severity: "INFO",
    });

    // ROOT sessions also get the dedicated root.logout action, written here
    // exactly once (previously the polling watcher could never observe the
    // logout because revoked session rows were never removed).
    const role = await prisma.user.findUnique({
      where: { id: resolvedUserId },
      select: { role: { select: { name: true } } },
    });
    if (role?.role.name === "ROOT") {
      await writeAudit({
        action: AUDIT_ACTIONS.ROOT_LOGOUT,
        userId: resolvedUserId,
        ipAddress,
        userAgent,
        category: "AUTHENTICATION",
        severity: "INFO",
      });
    }
  }
}

export async function getCurrentUser(userId: string): Promise<AuthenticatedUser> {
  return buildUserView(userId);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true },
  });
  if (!user) throw new NotFoundError("User not found");

  const ok = await verifyPassword(user.passwordHash, currentPassword);
  if (!ok) throw new InvalidCredentialsError();

  if (currentPassword === newPassword) {
    throw new PasswordTooWeakError("New password must be different from the current one");
  }

  const newHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash, failedAttempts: 0, lockedUntil: null, status: "ACTIVE" },
    }),
    // Revoke all other sessions, keep the current one (handled by caller via sessionId if needed)
    prisma.session.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    }),
  ]);

  await writeAudit({
    action: AUDIT_ACTIONS.PASSWORD_CHANGED,
    userId,
    ipAddress,
    userAgent,
    category: "SECURITY",
    severity: "INFO",
  });
}

// ── Session management ───────────────────────────────────────────────────────

export interface SessionView {
  id: string;
  device: string | null;
  browser: string | null;
  ipAddress: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export async function listSessions(userId: string, currentSessionId: string): Promise<SessionView[]> {
  const sessions = await prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      device: true,
      browser: true,
      ipAddress: true,
      createdAt: true,
      expiresAt: true,
    },
  });
  return sessions.map((s) => ({
    id: s.id,
    device: s.device,
    browser: s.browser,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    current: s.id === currentSessionId,
  }));
}

export async function revokeSession(
  userId: string,
  sessionId: string,
  currentSessionId: string,
  ipAddress: string,
  userAgent: string,
): Promise<void> {
  if (sessionId === currentSessionId) {
    throw new BadRequestError("Cannot revoke the current session");
  }
  const result = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0) {
    throw new NotFoundError("Active session not found");
  }
  // Sprint 8.1 — audit exactly one event per revocation (actor = owner).
  await writeAudit({
    action: AUDIT_ACTIONS.SESSION_REVOKED,
    userId,
    entity: "session",
    entityId: sessionId,
    ipAddress,
    userAgent,
    category: "SECURITY",
    severity: "INFO",
  });
}

export async function revokeOtherSessions(
  userId: string,
  currentSessionId: string,
  ipAddress: string,
  userAgent: string,
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, id: { not: currentSessionId }, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  // Sprint 8.1 — audit exactly one event per revoke-others action.
  await writeAudit({
    action: AUDIT_ACTIONS.OTHER_SESSIONS_REVOKED,
    userId,
    entity: "session",
    newValue: { revoked: result.count },
    ipAddress,
    userAgent,
    category: "SECURITY",
    severity: "INFO",
  });
  return result.count;
}
