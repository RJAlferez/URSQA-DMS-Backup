// =============================================================================
// URS-DMS — seed script (idempotent)
// 1. Upserts all permissions from permissions.constants.ts.
// 2. Upserts all roles from roles.constants.ts (incl. the ROOT system role).
// 3. Upserts all (role, permission) bindings.
// 4. Creates the bootstrap admin from env vars if no admin exists.
// 5. Creates the bootstrap ROOT user from env vars if no root exists.
// 6. Seeds the Configuration Engine (categories + default configurations).
// Re-runnable safely. Exits non-zero on real errors.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";
import { PERMISSIONS } from "../src/modules/permissions/permissions.constants";
import { DEFAULT_ROLE_MATRIX } from "../src/modules/roles/roles.constants";
import {
  SEED_CONFIGURATION_CATEGORIES,
  SEED_CONFIGURATIONS,
} from "../src/modules/root/root.config.seeddata";

const prisma = new PrismaClient();

const ARGON2_OPTIONS = {
  type: 2, // argon2id
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

async function seedPermissions(): Promise<Map<string, string>> {
  const codeToId = new Map<string, string>();
  for (const p of PERMISSIONS) {
    const row = await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, description: p.description },
      create: { code: p.code, module: p.module, description: p.description },
    });
    codeToId.set(p.code, row.id);
  }
  return codeToId;
}

async function seedRoles(): Promise<Map<string, string>> {
  const nameToId = new Map<string, string>();
  for (const r of DEFAULT_ROLE_MATRIX) {
    const row = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description },
      create: { name: r.name, description: r.description, isSystem: true },
    });
    nameToId.set(r.name, row.id);
  }
  return nameToId;
}

async function seedRolePermissions(
  roles: Map<string, string>,
  permissions: Map<string, string>,
): Promise<void> {
  for (const r of DEFAULT_ROLE_MATRIX) {
    const roleId = roles.get(r.name);
    if (!roleId) continue;
    for (const code of r.permissions) {
      const permissionId = permissions.get(code);
      if (!permissionId) {
        console.warn(`[seed] unknown permission code ${code} for role ${r.name}`);
        continue;
      }
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
    }
  }
}

async function seedBootstrapAdmin(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const employeeId = process.env.BOOTSTRAP_ADMIN_EMPLOYEE_ID;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !employeeId || !password) {
    console.warn(
      "[seed] BOOTSTRAP_ADMIN_* env vars not fully set — skipping admin creation. " +
        "Set BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_EMPLOYEE_ID, and BOOTSTRAP_ADMIN_PASSWORD.",
    );
    return;
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { employeeId }] },
  });
  if (existing) {
    console.log(`[seed] admin already exists (${existing.email}) — skipping creation.`);
    return;
  }

  const adminRole = await prisma.role.findUnique({ where: { name: "ADMINISTRATOR" } });
  if (!adminRole) {
    console.error("[seed] ADMINISTRATOR role not found — run seed again.");
    return;
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  await prisma.user.create({
    data: {
      employeeId,
      email: email.toLowerCase(),
      passwordHash,
      firstName: process.env.BOOTSTRAP_ADMIN_FIRST_NAME ?? "System",
      lastName: process.env.BOOTSTRAP_ADMIN_LAST_NAME ?? "Administrator",
      status: "ACTIVE",
      roleId: adminRole.id,
    },
  });

  console.log(`[seed] Created admin ${email} (employeeId ${employeeId}).`);
  console.warn(
    "[seed] ⚠️  The bootstrap admin uses BOOTSTRAP_ADMIN_PASSWORD from .env — change it after first login.",
  );
}

// ---------------------------------------------------------------------------
// Sprint 7.4.1 — bootstrap ROOT user (System Administrator).
// Like the admin bootstrap: only runs when BOOTSTRAP_ROOT_* env vars are set,
// and skips when a root user already exists. The ROOT role comes from
// DEFAULT_ROLE_MATRIX (seeded above); "only Root creates Root" is enforced by
// the privilege-escalation guard at runtime — this seed path is the sole
// first-boot exception.
// ---------------------------------------------------------------------------
async function seedBootstrapRoot(): Promise<void> {
  const email = process.env.BOOTSTRAP_ROOT_EMAIL;
  const employeeId = process.env.BOOTSTRAP_ROOT_EMPLOYEE_ID;
  const password = process.env.BOOTSTRAP_ROOT_PASSWORD;

  if (!email || !employeeId || !password) {
    console.warn(
      "[seed] BOOTSTRAP_ROOT_* env vars not fully set — skipping ROOT creation. " +
        "Set BOOTSTRAP_ROOT_EMAIL, BOOTSTRAP_ROOT_EMPLOYEE_ID, and BOOTSTRAP_ROOT_PASSWORD.",
    );
    return;
  }

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email: email.toLowerCase() }, { employeeId }] },
  });
  if (existing) {
    console.log(`[seed] root user already exists (${existing.email}) — skipping creation.`);
    return;
  }

  const rootRole = await prisma.role.findUnique({ where: { name: "ROOT" } });
  if (!rootRole) {
    console.error("[seed] ROOT role not found — run seed again.");
    return;
  }

  const passwordHash = await hash(password, ARGON2_OPTIONS);

  await prisma.user.create({
    data: {
      employeeId,
      email: email.toLowerCase(),
      passwordHash,
      firstName: process.env.BOOTSTRAP_ROOT_FIRST_NAME ?? "System",
      lastName: process.env.BOOTSTRAP_ROOT_LAST_NAME ?? "Root",
      status: "ACTIVE",
      roleId: rootRole.id,
    },
  });

  console.log(`[seed] Created ROOT ${email} (employeeId ${employeeId}).`);
  console.warn(
    "[seed] ⚠️  The ROOT account uses BOOTSTRAP_ROOT_PASSWORD from .env — change it after first login.",
  );
}

// ---------------------------------------------------------------------------
// Sprint 7.4.1 — seed the Configuration Engine (categories + defaults).
// Idempotent AND non-destructive: categories are upserted (metadata refresh
// only), but configurations are only created when MISSING — an existing
// configuration (possibly ROOT-edited) is never overwritten by the seed, so
// re-running the seed cannot clobber live values. Created entries get a
// version-1 snapshot + a CREATED history row, so the engine's tables are
// complete from day one.
// ---------------------------------------------------------------------------
async function seedConfigEngine(): Promise<void> {
  console.log("[seed] seeding configuration engine...");

  for (const c of SEED_CONFIGURATION_CATEGORIES) {
    await prisma.configurationCategory.upsert({
      where: { code: c.code },
      update: {
        name: c.name,
        description: c.description,
        displayOrder: c.displayOrder,
        isSystem: true,
      },
      create: {
        code: c.code,
        name: c.name,
        description: c.description,
        displayOrder: c.displayOrder,
        isSystem: true,
      },
    });
  }

  for (const config of SEED_CONFIGURATIONS) {
    const existing = await prisma.configuration.findFirst({
      where: { key: config.key },
      select: { id: true, key: true },
    });
    if (existing) {
      continue;
    }
    const category = await prisma.configurationCategory.findUnique({
      where: { code: config.categoryCode },
      select: { id: true },
    });
    if (!category) {
      console.warn(`[seed] unknown category ${config.categoryCode} for ${config.key}`);
      continue;
    }
    await prisma.configuration.create({
      data: {
        categoryId: category.id,
        key: config.key,
        name: config.name,
        description: config.description,
        value: config.value,
        valueType: config.valueType,
        status: "ACTIVE",
        version: 1,
        isSystem: true,
        versions: {
          create: { version: 1, value: config.value, changeNote: "Initial value" },
        },
        history: {
          create: { action: "CREATED", newValue: config.value, versionTo: 1 },
        },
      },
    });
    console.log(`[seed]   configuration ${config.key} (v1)`);
  }

  console.log("[seed] configuration engine ready.");
}

// -----------------------------------------------------------------------------
// 7. Organization master-data: seed campuses and attach the known URS colleges
// to the Morong campus. Non-destructive: only sets college.campusId when the
// college has no campus yet, so it never overrides an admin's assignment.
// -----------------------------------------------------------------------------
async function seedCampuses(): Promise<void> {
  const CAMPUSES = [
    { code: "URS-MORONG", name: "URS Morong Campus" },
    { code: "URS-TANAY", name: "URS Tanay Campus" },
    { code: "URS-BINANGONAN", name: "URS Binangonan Campus" },
    { code: "URS-PILILLA", name: "URS Pililla Campus" },
    { code: "URS-CARDONA", name: "URS Cardona Campus" },
  ] as const;

  const morong = await prisma.campus.upsert({
    where: { code: "URS-MORONG" },
    update: { name: "URS Morong Campus" },
    create: { code: "URS-MORONG", name: "URS Morong Campus" },
  });

  for (const c of CAMPUSES) {
    if (c.code === "URS-MORONG") continue;
    await prisma.campus.upsert({
      where: { code: c.code },
      update: { name: c.name },
      create: { code: c.code, name: c.name },
    });
  }

  const morongColleges = ["COE", "COENG", "CIT", "COS"];
  for (const code of morongColleges) {
    await prisma.college
      .updateMany({
        where: { code, campusId: null },
        data: { campusId: morong.id },
      })
      .catch(() => {
        /* ignore missing college */
      });
  }

  console.log(`[seed] campuses ready (${CAMPUSES.length}, colleges assigned to Morong)`);
}

async function main(): Promise<void> {
  console.log("[seed] upserting permissions...");
  const permissions = await seedPermissions();
  console.log(`[seed]   ${permissions.size} permissions`);

  console.log("[seed] upserting roles...");
  const roles = await seedRoles();
  console.log(`[seed]   ${roles.size} roles`);

  console.log("[seed] upserting role → permission bindings...");
  await seedRolePermissions(roles, permissions);

  console.log("[seed] bootstrapping admin (if env vars are set)...");
  await seedBootstrapAdmin();

  console.log("[seed] bootstrapping ROOT (if env vars are set)...");
  await seedBootstrapRoot();

  await seedConfigEngine();

  console.log("[seed] seeding campuses...");
  await seedCampuses();

  console.log("[seed] done ✅");
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
