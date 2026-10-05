// =============================================================================
// URS-DMS — Service-level denial audit timing tests (AUD-RT-02)
// -----------------------------------------------------------------------------
// Proves that ownership denials write their audit row BEFORE the error
// propagates (awaited `writeAudit`), with exactly one DENIED/SECURITY row per
// request correlation and the correct actor/target.
// =============================================================================

import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { runWithRequestId } from "@/middlewares/requestContext";
import {
  createTestUser,
  cleanupTestUser,
  cleanupTestData,
  createTestDocument,
  createTestFolder,
  type TestUser,
} from "@/__tests__/helpers";
import * as documentsService from "@/modules/documents/documents.service";
import * as foldersService from "@/modules/folders/folders.service";
import * as repositoryService from "@/modules/repositories/repository.service";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await cleanupTestData(id);
    await cleanupTestUser(id);
  }
  await prisma.repository.deleteMany({ where: { ownerId: { in: createdUserIds } } });
});

async function pair(suffix: string): Promise<{ owner: TestUser; intruder: TestUser }> {
  const owner = await createTestUser("FACULTY", `${suffix}-owner`);
  const intruder = await createTestUser("FACULTY", `${suffix}-intruder`);
  createdUserIds.push(owner.id, intruder.id);
  return { owner, intruder };
}

function actorOf(user: TestUser) {
  return { id: user.id, permissions: [] as string[], ipAddress: "127.0.0.1", userAgent: "vitest" };
}

async function denialRows(correlationId: string) {
  return prisma.auditLog.findMany({ where: { correlationId } });
}

describe("AUD-RT-02 — denial audit is persisted before the error propagates", () => {
  it("document read denial: row exists immediately, correct classification/target, no duplicate", async () => {
    const { owner, intruder } = await pair("deny-doc");
    const doc = await createTestDocument(owner.id, "Denial Timing Doc");
    const corr = `test-denial-doc-${randomUUID()}`;

    await runWithRequestId(corr, async () => {
      await expect(documentsService.getDocument(doc.id, actorOf(intruder))).rejects.toThrow();
    });

    // No wait/polling: if the write were still fire-and-forget the row would
    // not be visible here.
    const rows = await denialRows(corr);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe("auth.access_denied");
    expect(row.result).toBe("DENIED");
    expect(row.category).toBe("SECURITY");
    expect(row.severity).toBe("WARNING");
    expect(row.userId).toBe(intruder.id);
    expect(row.entity).toBe("document");
    expect(row.entityId).toBe(doc.id);
    expect(row.newValue).toMatchObject({ reason: "cross_user_read_attempt", ownerId: owner.id });
  });

  it("folder read denial: row exists immediately with correct target", async () => {
    const { owner, intruder } = await pair("deny-folder");
    const folder = await createTestFolder(owner.id, null, "Denial Timing Folder");
    const corr = `test-denial-folder-${randomUUID()}`;

    await runWithRequestId(corr, async () => {
      await expect(foldersService.getFolder(folder.id, actorOf(intruder))).rejects.toThrow();
    });

    const rows = await denialRows(corr);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe("auth.access_denied");
    expect(row.result).toBe("DENIED");
    expect(row.category).toBe("SECURITY");
    expect(row.userId).toBe(intruder.id);
    expect(row.entity).toBe("folder");
    expect(row.entityId).toBe(folder.id);
    expect(row.newValue).toMatchObject({ reason: "cross_user_folder_read_attempt" });
  });

  it("cross-user repository denial: row exists immediately, no duplicate", async () => {
    const { owner, intruder } = await pair("deny-repo");
    const corr = `test-denial-repo-${randomUUID()}`;

    await runWithRequestId(corr, async () => {
      await expect(repositoryService.listRepositories(actorOf(intruder), owner.id)).rejects.toThrow();
    });

    const rows = await denialRows(corr);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe("auth.access_denied");
    expect(row.result).toBe("DENIED");
    expect(row.category).toBe("SECURITY");
    expect(row.userId).toBe(intruder.id);
    expect(row.entity).toBe("repository");
    expect(row.newValue).toMatchObject({ reason: "cross_user_repository_access", targetOwnerId: owner.id });
  });

  it("folder delete denial is awaited and emits exactly one row", async () => {
    const { owner, intruder } = await pair("deny-folder-del");
    const folder = await createTestFolder(owner.id, null, "Denial Delete Folder");
    const corr = `test-denial-folder-del-${randomUUID()}`;

    await runWithRequestId(corr, async () => {
      await expect(foldersService.softDeleteFolder(folder.id, actorOf(intruder))).rejects.toThrow();
    });

    const rows = await denialRows(corr);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.result).toBe("DENIED");
    expect(row.entityId).toBe(folder.id);
    expect(row.newValue).toMatchObject({ reason: "cross_user_folder_delete_attempt" });
  });
});
