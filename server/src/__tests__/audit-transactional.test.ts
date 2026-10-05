// =============================================================================
// URS-DMS — Transactional request-delivery audit tests (AUD-RT-03)
// -----------------------------------------------------------------------------
// Proves that `request.fulfilled.delivered` is written through the caller's
// Prisma transaction:
//   A. COMMIT  → delivery + request.approved + delivered event persist together
//   B. ROLLBACK→ delivery, request state and BOTH audit events roll back
// The workflow engine is mocked so the rollback test can fail AFTER delivery
// has already been written inside the transaction.
// =============================================================================

import { describe, it, expect, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { runWithRequestId } from "@/middlewares/requestContext";
import {
  createTestUser,
  cleanupTestUser,
  cleanupTestData,
  type TestUser,
} from "@/__tests__/helpers";

vi.mock("@/modules/workflow/workflow.engine", () => ({
  bindWorkflowInstance: vi.fn(async () => ({ bound: false })),
  evaluateWorkflowAction: vi.fn(async () => null),
  recordWorkflowAction: vi.fn(async () => undefined),
  scopesForDocumentRequest: vi.fn(async () => []),
}));

import * as requestsService from "@/modules/requests/requests.service";
import { evaluateWorkflowAction, recordWorkflowAction } from "@/modules/workflow/workflow.engine";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await prisma.documentRequest.deleteMany({ where: { requesterId: id } });
    await cleanupTestData(id);
    await cleanupTestUser(id);
  }
  await prisma.repository.deleteMany({ where: { ownerId: { in: createdUserIds } } });
});

async function createUserWithVersionedDocument(roleName: string, suffix: string): Promise<{
  user: TestUser;
  documentId: string;
}> {
  const user = await createTestUser(roleName, suffix);
  createdUserIds.push(user.id);

  const doc = await prisma.document.create({
    data: { ownerId: user.id, title: `TX Audit Doc ${suffix}`, classification: "INTERNAL" },
    select: { id: true },
  });
  const version = await prisma.documentVersion.create({
    data: {
      documentId: doc.id,
      versionNumber: 1,
      objectKey: `test/${doc.id}/v1/probe.pdf`,
      filename: "probe.pdf",
      mimeType: "application/pdf",
      sizeBytes: BigInt(8),
      checksum: "a".repeat(64),
      uploadedById: user.id,
    },
    select: { id: true },
  });
  await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: version.id } });
  return { user, documentId: doc.id };
}

describe("AUD-RT-03 — transactional delivery audit", () => {
  it("A. commit persists request.approved + request.fulfilled.delivered once, sharing the correlation id", async () => {
    const owner = await createUserWithVersionedDocument("FACULTY", "tx-commit");
    const admin = await createTestUser("ADMINISTRATOR", "tx-commit-admin");
    createdUserIds.push(admin.id);

    const corr = `test-tx-commit-${randomUUID()}`;
    const request = await requestsService.createRequest(
      { title: "TX commit request", justification: "audit tx test", documentIds: [owner.documentId] },
      { id: owner.user.id, permissions: ["request.create"] },
    );

    await runWithRequestId(corr, async () => {
      await requestsService.decideRequest(
        request.id,
        "APPROVED",
        {},
        { id: admin.id, permissions: ["request.manage"] },
      );
    });

    const delivered = await prisma.auditLog.findMany({
      where: { action: "request.fulfilled.delivered", entityId: request.id },
    });
    const approved = await prisma.auditLog.findMany({
      where: { action: "request.approved", entityId: request.id },
    });
    expect(delivered).toHaveLength(1);
    expect(approved).toHaveLength(1);
    const deliveredRow = delivered[0]!;
    const approvedRow = approved[0]!;
    expect(deliveredRow.result).toBe("SUCCESS");
    expect(deliveredRow.category).toBe("REQUEST");
    expect(deliveredRow.correlationId).toBe(corr);
    expect(approvedRow.correlationId).toBe(corr);

    const dbRequest = await prisma.documentRequest.findUnique({ where: { id: request.id } });
    expect(dbRequest?.status).toBe("APPROVED");
    const deliveredDocs = await prisma.document.count({
      where: {
        ownerId: owner.user.id,
        metadata: { path: ["requestId"], equals: request.id },
      },
    });
    expect(deliveredDocs).toBe(1);
  });

  it("B. rollback leaves no delivered document and no false SUCCESS audit event", async () => {
    const owner = await createUserWithVersionedDocument("FACULTY", "tx-rollback");
    const admin = await createTestUser("ADMINISTRATOR", "tx-rollback-admin");
    createdUserIds.push(admin.id);

    const corr = `test-tx-rollback-${randomUUID()}`;
    const request = await requestsService.createRequest(
      { title: "TX rollback request", justification: "audit tx rollback test", documentIds: [owner.documentId] },
      { id: owner.user.id, permissions: ["request.create"] },
    );

    // Force a failure AFTER delivery + its transactional audit have run:
    // a workflow evaluation makes the code call recordWorkflowAction, which
    // throws inside the same transaction.
    vi.mocked(evaluateWorkflowAction).mockResolvedValueOnce({ mocked: true } as never);
    vi.mocked(recordWorkflowAction).mockRejectedValueOnce(new Error("forced rollback"));

    await expect(
      runWithRequestId(corr, async () =>
        requestsService.decideRequest(
          request.id,
          "APPROVED",
          {},
          { id: admin.id, permissions: ["request.manage"] },
        ),
      ),
    ).rejects.toThrow("forced rollback");

    const dbRequest = await prisma.documentRequest.findUnique({ where: { id: request.id } });
    expect(dbRequest?.status).toBe("PENDING");

    expect(
      await prisma.auditLog.count({
        where: { action: "request.fulfilled.delivered", entityId: request.id },
      }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { action: "request.approved", entityId: request.id } }),
    ).toBe(0);
    expect(
      await prisma.document.count({
        where: {
          ownerId: owner.user.id,
          metadata: { path: ["requestId"], equals: request.id },
        },
      }),
    ).toBe(0);
  });
});
