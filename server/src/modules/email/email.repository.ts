import { prisma } from "@/lib/prisma";
import type {
  ClaimedEmailMessage,
  EmailMessageInput,
} from "@/modules/email/email.types";

// =============================================================================
// URS-DMS — Email queue repository (Sprint 7.3)
// -----------------------------------------------------------------------------
// Durable outbound queue backed by `email_messages`. Every message is
// persisted BEFORE any delivery attempt (at-least-once): a crash between
// enqueue and delivery leaves a PENDING row the worker will pick up again.
//
// Claim flow (atomic enough for the single in-process worker):
//   1. select due PENDING ids (status = PENDING, nextAttemptAt <= now)
//   2. `updateMany` with a status guard flips exactly those rows to SENDING —
//      the guard means two workers can never claim the same row (a competing
//      claim updates 0 rows)
//   3. read the claimed rows back by id
// =============================================================================

export async function enqueueMessages(
  inputs: EmailMessageInput[],
  provider: string,
): Promise<ClaimedEmailMessage[]> {
  if (inputs.length === 0) return [];
  const rows = await prisma.emailMessage.createManyAndReturn({
    data: inputs.map((input) => ({
      to: input.to,
      subject: input.subject,
      body: input.body,
      provider,
    })),
    select: { id: true, to: true, subject: true, body: true, attempts: true, maxAttempts: true },
  });
  return rows.map((row) => ({ ...row, provider }));
}

export async function claimDueMessages(
  batchSize: number,
): Promise<ClaimedEmailMessage[]> {
  // Atomic claim: select due rows FOR UPDATE SKIP LOCKED inside a transaction,
  // flip them to SENDING, and read back ONLY the ids this caller locked.
  // Without the row locks two concurrent claimers (BullMQ concurrency 2 plus
  // the in-process poller) could select overlapping batches and both deliver
  // the same message — duplicate emails and duplicate EMAIL_SENT audit rows.
  return prisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM email_messages
      WHERE status = 'PENDING' AND "nextAttemptAt" <= NOW()
      ORDER BY "createdAt" ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED`;
    if (due.length === 0) return [];

    const ids = due.map((d) => d.id);
    await tx.emailMessage.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { status: "SENDING" },
    });

    const rows = await tx.emailMessage.findMany({
      where: { id: { in: ids } },
      select: { id: true, to: true, subject: true, body: true, attempts: true, maxAttempts: true, provider: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({ ...row, provider: row.provider }));
  });
}

export async function markSent(id: string): Promise<void> {
  await prisma.emailMessage.update({
    where: { id },
    data: { status: "SENT", sentAt: new Date(), lastError: null },
  });
}

export async function markFailed(
  id: string,
  error: string,
  nextAttemptAt: Date | null,
): Promise<void> {
  await prisma.emailMessage.update({
    where: { id },
    data: {
      status: nextAttemptAt ? "PENDING" : "FAILED",
      attempts: { increment: 1 },
      lastError: error,
      nextAttemptAt: nextAttemptAt ?? undefined,
    },
  });
}
