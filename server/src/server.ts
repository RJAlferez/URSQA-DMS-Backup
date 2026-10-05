import { createApp } from "@/app";
import { env } from "@/config/env";
import { logger } from "@/utils/logger";
import { ensureBucket } from "@/lib/storage";
import { startEmailWorker } from "@/modules/email/email.service";
import { disconnectRedis } from "@/lib/redis";
import { shutdownQueues } from "@/lib/queue";
import { prisma } from "@/lib/prisma";

// =============================================================================
// URS-DMS — server bootstrap with graceful shutdown (Sprint 8.5).
// =============================================================================

async function boot(): Promise<void> {
  try {
    await ensureBucket();
    logger.info(`MinIO bucket "${env.MINIO_BUCKET}" ready`);
  } catch (err) {
    logger.error("MinIO bucket bootstrap failed — aborting boot", {
      err: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

void boot()
  .then(() => {
    const app = createApp();
    const server = app.listen(env.PORT, () => {
      logger.info(`URS-DMS server listening on port ${env.PORT} (${env.NODE_ENV})`);
    });

    // Legacy in-process email worker — continues to serve as a fallback.
    // The BullMQ worker (email.worker.ts) handles the primary delivery path.
    startEmailWorker();
    import("@/modules/notifications/notifications.scheduler")
      .then(({ startNotificationScheduler }) => startNotificationScheduler())
      .catch((err) => logger.error("[server] notification scheduler startup failed", { err: String(err) }));

    // Sprint 8.5 — start BullMQ workers for background jobs
    import("@/workers/startup")
      .then(({ startAllWorkers }) => {
        startAllWorkers();
        logger.info("[server] BullMQ workers started");
      })
      .catch((err) => {
        logger.error("[server] BullMQ worker startup failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      });

    const shutdown = async (signal: string): Promise<void> => {
      logger.info(`Received ${signal}, shutting down gracefully...`);

      // 1. Stop accepting new HTTP requests
      server.close((err) => {
        if (err) logger.error("Error during server close", { err: err.message });
      });

      // 2. Stop BullMQ workers (graceful — finish active jobs)
      try {
        logger.info("[shutdown] closing BullMQ workers...");
        await shutdownQueues();
      } catch (err) {
        logger.error("[shutdown] queue shutdown error", {
          err: err instanceof Error ? err.message : String(err),
        });
      }

      // 3. Disconnect Redis
      try {
        logger.info("[shutdown] disconnecting Redis...");
        await disconnectRedis();
      } catch (err) {
        logger.error("[shutdown] redis disconnect error", {
          err: err instanceof Error ? err.message : String(err),
        });
      }

      // 4. Disconnect Prisma
      try {
        logger.info("[shutdown] disconnecting Prisma...");
        await prisma.$disconnect();
      } catch (err) {
        logger.error("[shutdown] prisma disconnect error", {
          err: err instanceof Error ? err.message : String(err),
        });
      }

      logger.info("[shutdown] complete");
      process.exit(0);
    };

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  })
  .catch((err) => {
    logger.error("Boot failed", { err: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason: String(reason) });
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { err: err.message, stack: err.stack });
  process.exit(1);
});
