// =============================================================================
// URS-DMS — BullMQ worker processes (Sprint 8.5)
// Each worker handles one queue. Register all workers at server startup.
// Generated ZIPs expire after ZIP_EXPIRATION_SECONDS.
//
// Every processor runs inside a correlation context (`job:<queue>:<id>`) so
// audit events emitted by background jobs carry a stable correlationId that
// ties all events of one job together (request-scoped events inherit the HTTP
// request id instead — see middlewares/requestContext.ts).
// =============================================================================

import { type Processor } from "bullmq";
import { createWorker, registerWorker, QUEUE_NAMES, type QueueName } from "@/lib/queue";
import { runWithRequestId } from "@/middlewares/requestContext";
import { processFolderCopyJob } from "@/workers/folderCopy.worker";
import { processFolderZipJob } from "@/workers/folderZip.worker";
import { processEmailJob } from "@/workers/email.worker";
import { processMaintenanceJob } from "@/workers/maintenance.worker";
import { processDocumentThumbnailJob } from "@/workers/documentThumbnail.worker";
import { env } from "@/config/env";

function traced<T>(queue: QueueName, processor: Processor<T>): Processor<T> {
  return (job, token) =>
    runWithRequestId(`job:${queue}:${job.id ?? "unknown"}`, () => processor(job, token));
}

export function startAllWorkers(): void {
  registerWorker(
    QUEUE_NAMES.FOLDER_COPY,
    createWorker(
      QUEUE_NAMES.FOLDER_COPY,
      traced(QUEUE_NAMES.FOLDER_COPY, processFolderCopyJob),
      env.WORKER_CONCURRENCY,
    ),
  );

  registerWorker(
    QUEUE_NAMES.FOLDER_ZIP,
    createWorker(QUEUE_NAMES.FOLDER_ZIP, traced(QUEUE_NAMES.FOLDER_ZIP, processFolderZipJob), 1),
  );

  registerWorker(
    QUEUE_NAMES.EMAIL_DELIVERY,
    createWorker(
      QUEUE_NAMES.EMAIL_DELIVERY,
      traced(QUEUE_NAMES.EMAIL_DELIVERY, processEmailJob),
      2,
    ),
  );

  registerWorker(
    QUEUE_NAMES.MAINTENANCE,
    createWorker(QUEUE_NAMES.MAINTENANCE, traced(QUEUE_NAMES.MAINTENANCE, processMaintenanceJob), 1),
  );

  registerWorker(
    QUEUE_NAMES.DOCUMENT_THUMBNAIL,
    createWorker(
      QUEUE_NAMES.DOCUMENT_THUMBNAIL,
      traced(QUEUE_NAMES.DOCUMENT_THUMBNAIL, processDocumentThumbnailJob),
      2,
    ),
  );
}
