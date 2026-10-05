import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/config/env";
import { hashPassword } from "@/modules/auth/auth.password";
import { sendEmail } from "@/modules/email/email.service";
import { writeAudit } from "@/modules/audit/audit.service";
import { AUDIT_ACTIONS } from "@/config/constants";
import { ConflictError, NotFoundError, TokenExpiredError, TokenInvalidError } from "@/utils/errors";
import type { RegistrationInput } from "@/modules/auth/auth.validator";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function registrationUrl(token: string): string {
  const baseUrl = env.PUBLIC_APP_URL ?? env.CLIENT_URL[0] ?? "http://localhost:5173";
  return `${baseUrl.replace(/\/$/, "")}/register?token=${encodeURIComponent(token)}`;
}

export async function createInvitation(email: string, invitedById?: string | null): Promise<{ email: string; expiresAt: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
  if (existing) throw new ConflictError("Email already has an account");

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.registrationInvite.updateMany({
    where: { email: normalizedEmail, usedAt: null },
    data: { usedAt: new Date() },
  });
  await prisma.registrationInvite.create({
    data: { email: normalizedEmail, tokenHash: hashToken(token), expiresAt, ...(invitedById ? { invitedById } : {}) },
  });

  await sendEmail({
    to: normalizedEmail,
    subject: "URS-DMS registration invitation",
    body: `<p>You have been invited to create an account in URS-DMS.</p><p><a href="${registrationUrl(token)}">Complete your registration</a></p><p>This link expires in 24 hours and can only be used once.</p>`,
  });
  return { email: normalizedEmail, expiresAt: expiresAt.toISOString() };
}

export async function requestInvitation(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail }, select: { id: true } });
  if (user) return;

  const inviter = await prisma.user.findFirst({
    where: { status: "ACTIVE", role: { name: { in: ["ROOT", "ADMINISTRATOR"] } } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!inviter) return;
  await createInvitation(normalizedEmail, inviter.id);
}

async function getInvite(token: string) {
  const invite = await prisma.registrationInvite.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!invite || invite.usedAt) throw new TokenInvalidError("This registration link is invalid or has already been used");
  if (invite.expiresAt.getTime() <= Date.now()) throw new TokenExpiredError("This registration link has expired");
  return invite;
}

export async function getRegistrationOptions() {
  const [campuses, colleges, programs, offices] = await Promise.all([
    prisma.campus.findMany({ where: { deletedAt: null }, select: { id: true, name: true, code: true }, orderBy: { displayOrder: "asc" } }),
    prisma.college.findMany({ where: { deletedAt: null }, select: { id: true, name: true, code: true, campusId: true }, orderBy: { displayOrder: "asc" } }),
    prisma.program.findMany({ where: { deletedAt: null }, select: { id: true, name: true, code: true, campusId: true, collegeId: true }, orderBy: { displayOrder: "asc" } }),
    prisma.office.findMany({ where: { deletedAt: null }, select: { id: true, name: true, code: true, campusId: true, collegeId: true, departmentId: true }, orderBy: { displayOrder: "asc" } }),
  ]);
  return { campuses, colleges, programs, offices };
}

export async function validateRegistrationToken(token: string): Promise<{ email: string; expiresAt: string }> {
  const invite = await getInvite(token);
  return { email: invite.email, expiresAt: invite.expiresAt.toISOString() };
}

export async function register(input: RegistrationInput, ipAddress: string | null, userAgent: string | null) {
  const invite = await getInvite(input.token);
  if (invite.email !== input.email.trim().toLowerCase()) throw new TokenInvalidError("This invitation belongs to a different email address");

  const [emailTaken, employeeTaken, college, program, office] = await Promise.all([
    prisma.user.findUnique({ where: { email: invite.email }, select: { id: true } }),
    prisma.user.findUnique({ where: { employeeId: input.employeeId }, select: { id: true } }),
    input.collegeId
      ? prisma.college.findFirst({ where: { id: input.collegeId, deletedAt: null }, select: { id: true, campusId: true } })
      : Promise.resolve(null),
    input.programId
      ? prisma.program.findFirst({
          where: { id: input.programId, deletedAt: null },
          select: { id: true, campusId: true, collegeId: true },
        })
      : Promise.resolve(null),
    input.officeId
      ? prisma.office.findFirst({
          where: { id: input.officeId, deletedAt: null },
          select: {
            id: true,
            campusId: true,
            collegeId: true,
            departmentId: true,
            college: { select: { campusId: true } },
            department: { select: { campusId: true } },
          },
        })
      : Promise.resolve(null),
  ]);
  if (emailTaken) throw new ConflictError("Email already has an account");
  if (employeeTaken) throw new ConflictError("Employee or student ID is already in use");
  if (input.collegeId && !college) throw new NotFoundError("Selected college was not found");
  if (college && college.campusId !== input.campusId) {
    throw new NotFoundError("Selected college does not belong to the selected campus");
  }
  if (input.programId && !program) throw new NotFoundError("Selected program was not found");
  if (input.programId && program) {
    if (input.collegeId && program.collegeId !== input.collegeId) {
      throw new NotFoundError("Selected program does not belong to the selected college");
    }
    if (program.campusId !== input.campusId) {
      throw new NotFoundError("Selected program does not belong to the selected campus");
    }
  }
  if (input.officeId && !office) throw new NotFoundError("Selected office was not found");
  if (office) {
    // An office belongs to a campus directly, or through its college/department.
    const officeCampusId = office.campusId ?? office.college?.campusId ?? office.department?.campusId ?? null;
    if (!officeCampusId) {
      throw new NotFoundError("Selected office is not assigned to a campus");
    }
    if (officeCampusId !== input.campusId) {
      throw new NotFoundError("Selected office does not belong to the selected campus");
    }
  }

  // Program selection maps to the FACULTY role; office selection (no program)
  // maps to STAFF. Campus-only registrations keep the FACULTY default and can
  // be refined later by an administrator.
  const roleName = input.programId ? "FACULTY" : input.officeId ? "STAFF" : "FACULTY";
  const role = await prisma.role.findUnique({ where: { name: roleName }, select: { id: true } });
  if (!role) throw new NotFoundError(`Default registration role (${roleName}) is not configured`);

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        employeeId: input.employeeId,
        email: invite.email,
        passwordHash,
        firstName: input.firstName,
        middleName: input.middleName ?? null,
        lastName: input.lastName,
        suffix: input.suffix || null,
        roleId: role.id,
        programId: input.programId ?? null,
        // When a registrant belongs to a department-level office, keep the
        // department link so the user shows up under the right department.
        departmentId: office?.departmentId ?? null,
        status: "ACTIVE",
      },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    await tx.registrationInvite.update({ where: { id: invite.id }, data: { usedAt: new Date() } });
    return created;
  });

  await writeAudit({
    action: AUDIT_ACTIONS.USER_CREATED,
    userId: user.id,
    entity: "user",
    entityId: user.id,
    newValue: {
      source: "registration_invite",
      email: user.email,
      campusId: input.campusId,
      collegeId: input.collegeId ?? null,
      programId: input.programId ?? null,
      officeId: input.officeId ?? null,
      roleName,
    },
    ipAddress: ipAddress ?? undefined,
    userAgent: userAgent ?? undefined,
  });
  return user;
}
