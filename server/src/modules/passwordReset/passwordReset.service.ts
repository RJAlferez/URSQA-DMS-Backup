import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { AUDIT_ACTIONS } from "@/config/constants";
import { writeAudit } from "@/modules/audit/audit.service";
import { sendEmail } from "@/modules/email/email.service";
import { hashPassword, verifyPassword } from "@/modules/auth/auth.password";
import { sha256, randomToken } from "@/utils/hash";
import { BadRequestError, NotFoundError, TokenInvalidError } from "@/utils/errors";
import * as repo from "@/modules/passwordReset/passwordReset.repository";

// =============================================================================
// URS-DMS — password recovery service (Sprint 8.2)
// -----------------------------------------------------------------------------
// Flow: request (generic response, token hashed + emailed) -> reset (single-use
// token, 20-minute expiry, hash updated, ALL refresh sessions revoked).
//
// Security posture:
//  - The endpoint NEVER reveals whether an account exists.
//  - Reset tokens are 384-bit random values; only their SHA-256 hash is stored.
//  - Tokens are single-use; requesting a new reset invalidates older ones.
//  - After a successful reset every refresh session is revoked (old tokens can
//    no longer obtain new access tokens — see the frozen-auth rotation-grace
//    note in docs).
//  - Never logs or audits plaintext tokens, passwords, or hashes.
// =============================================================================

const TOKEN_TTL_MS = 20 * 60 * 1000; // 20 minutes

const GENERIC_RESPONSE =
  "If an account exists for this email, password reset instructions have been sent.";

const GENERIC_TOKEN_ERROR =
  "The password reset link is invalid or has expired. Please request a new one.";

function resetBaseUrl(clientOrigin?: string): string {
  if (clientOrigin) {
    try { new URL(clientOrigin); return clientOrigin; } catch { /* invalid URL — fall through to env */ }
  }
  const envUrl = env.PUBLIC_APP_URL ?? env.CLIENT_URL?.[0];
  if (envUrl) return envUrl;
  return "http://localhost:5173";
}

// -----------------------------------------------------------------------------
// requestPasswordReset
// -----------------------------------------------------------------------------
export async function requestPasswordReset(
  input: { email: string },
  clientOrigin?: string,
  ipAddress?: string,
  userAgent?: string,
): Promise<{ message: string }> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, email: true, status: true },
  });

  if (!user || user.status !== "ACTIVE") {
    return { message: GENERIC_RESPONSE };
  }

  const token = randomToken(48);
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  const created = await repo.createResetToken({ userId: user.id, tokenHash, expiresAt });
  await repo.invalidateOutstanding(user.id, created.id);

  const baseUrl = resetBaseUrl(clientOrigin);
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your URS-QA DMS password",
    body:
      `<p>We received a request to reset the password for your URS-QA DMS account.</p>` +
      `<p>This link is valid for <strong>20 minutes</strong> and can be used only once:</p>` +
      `<p><a href="${resetUrl}">Reset my password</a></p>` +
      `<p>If you did not request a password reset, you can safely ignore this email.` +
      ` Your password will not change unless you use the link above.</p>`,
  });

  await writeAudit({
    action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
    userId: user.id,
    entity: "user",
    entityId: user.id,
    ipAddress,
    userAgent,
  });

  return { message: GENERIC_RESPONSE };
}

// -----------------------------------------------------------------------------
// resetPassword
// -----------------------------------------------------------------------------
export async function resetPassword(
  input: { token: string; newPassword: string },
  ipAddress?: string,
  userAgent?: string,
): Promise<{ success: true }> {
  const tokenHash = sha256(input.token);
  const valid = await repo.findValidByHash(tokenHash);
  if (!valid) {
    // Generic: invalid, expired, or already used tokens are indistinguishable.
    throw new TokenInvalidError(GENERIC_TOKEN_ERROR);
  }

  const user = await prisma.user.findUnique({
    where: { id: valid.userId },
    select: { id: true, passwordHash: true, status: true },
  });
  if (!user) {
    throw new TokenInvalidError(GENERIC_TOKEN_ERROR);
  }

  // Do not allow resetting to the current password.
  const same = await verifyPassword(user.passwordHash, input.newPassword);
  if (same) {
    throw new BadRequestError("New password must be different from the current one");
  }

  const newHash = await hashPassword(input.newPassword);

  try {
    // Transactional: hash + token consumption + outstanding-token invalidation
    // + full session revocation either all happen or none do.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: valid.userId },
        data: {
          passwordHash: newHash,
          failedAttempts: 0,
          lockedUntil: null,
          status: "ACTIVE",
        },
      }),
      prisma.passwordResetToken.update({
        where: { id: valid.id },
        data: { usedAt: new Date() },
      }),
      prisma.passwordResetToken.updateMany({
        where: { userId: valid.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
      prisma.session.updateMany({
        where: { userId: valid.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  } catch (err) {
    await writeAudit({
      action: AUDIT_ACTIONS.PASSWORD_RESET_FAILED,
      userId: valid.userId,
      entity: "user",
      entityId: valid.userId,
      ipAddress,
      userAgent,
    });
    throw err;
  }

  await writeAudit({
    action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
    userId: valid.userId,
    entity: "user",
    entityId: valid.userId,
    ipAddress,
    userAgent,
  });

  return { success: true };
}

// -----------------------------------------------------------------------------
// getDevResetLink — DEVELOPMENT-ONLY helper
// -----------------------------------------------------------------------------
// Returns the latest single-use reset token for an email so local testing can
// exercise the full flow without an SMTP server. Hard-disabled outside
// NODE_ENV=development (404). Never available in production.
export async function getDevResetLink(
  email: string,
): Promise<{ token: string } | null> {
  if (env.NODE_ENV !== "development") {
    throw new NotFoundError("Not found");
  }
  const message = await prisma.emailMessage.findFirst({
    where: {
      to: email,
      OR: [
        { subject: { contains: "Reset your URS-QA DMS password" } },
        { subject: { contains: "Reset your URS-DMS password" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    select: { body: true },
  });
  if (!message) return null;
  const match = /token=([A-Za-z0-9_-]{20,})/.exec(message.body);
  const token = match?.[1];
  if (!token) return null;
  return { token };
}
