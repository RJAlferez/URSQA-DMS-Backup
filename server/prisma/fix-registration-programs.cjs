#!/usr/bin/env node
/**
 * URS-DMS — Fix registration Programs (idempotent maintenance script)
 * --------------------------------------------------------------------
 * Runs inside the production container (Dokploy → urs-server → Terminal):
 *
 *     node /app/prisma/fix-registration-programs.cjs
 *
 * What it does:
 *   1. Archives ("soft-deletes") program records whose name equals the name of
 *      their own college — e.g. a Program accidentally named "College of Science".
 *   2. Ensures a "Bachelor of Science in Computer Science" (code BSCS) program
 *      exists under every live "College of Science" college, so the record
 *      shows up in the registration form's Program dropdown.
 *
 * Safe to run multiple times (upserts by code + name checks).
 * Uses DATABASE_URL from the container environment.
 */
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const PROGRAM_NAME = "Bachelor of Science in Computer Science";
const PROGRAM_CODE = "BSCS";
const COLLEGE_NAME = "College of Science";

async function main() {
  const report = { archivedJunk: [], bscs: [] };

  // 1) Archive programs whose name is exactly the name of their college.
  const colleges = await prisma.college.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, campusId: true },
  });
  const collegeById = new Map(colleges.map((c) => [c.id, c]));

  const junkPrograms = await prisma.program.findMany({
    where: { deletedAt: null, collegeId: { not: null } },
    select: { id: true, name: true, code: true, collegeId: true },
  });

  for (const program of junkPrograms) {
    const college = collegeById.get(program.collegeId);
    if (college && program.name.trim().toLowerCase() === college.name.trim().toLowerCase()) {
      await prisma.program.update({
        where: { id: program.id },
        data: { deletedAt: new Date() },
      });
      report.archivedJunk.push({ id: program.id, name: program.name, code: program.code });
    }
  }

  // 2) Ensure BSCS exists under every live College of Science.
  const scienceColleges = colleges.filter(
    (c) => c.name.trim().toLowerCase() === COLLEGE_NAME.toLowerCase(),
  );

  if (scienceColleges.length === 0) {
    report.bscs.push({
      status: "skipped",
      reason: `No college named "${COLLEGE_NAME}" found — create it first in Root Console → Organization → Colleges`,
    });
  }

  for (const college of scienceColleges) {
    const existing = await prisma.program.findFirst({
      where: { code: PROGRAM_CODE, deletedAt: null, collegeId: college.id },
      select: { id: true },
    });
    if (existing) {
      const updated = await prisma.program.update({
        where: { id: existing.id },
        data: {
          name: PROGRAM_NAME,
          collegeId: college.id,
          campusId: college.campusId ?? undefined,
        },
      });
      report.bscs.push({ status: "updated", id: updated.id, name: updated.name });
    } else {
      const created = await prisma.program.create({
        data: {
          name: PROGRAM_NAME,
          code: PROGRAM_CODE,
          description: `${PROGRAM_NAME} (auto-created by maintenance script)`,
          level: "UNDERGRADUATE",
          collegeId: college.id,
          campusId: college.campusId ?? undefined,
        },
      });
      report.bscs.push({ status: "created", id: created.id, name: created.name });
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error("Failed:", err?.message ?? err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
