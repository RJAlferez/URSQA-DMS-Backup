import express, { type Express } from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { env, trustProxyValue } from "@/config/env";
import { globalLimiter } from "@/middlewares/rateLimiter";
import { requestContext } from "@/middlewares/requestContext";
import { errorHandler } from "@/middlewares/errorHandler";
import { apiRouter } from "@/routes";
import { logger } from "@/utils/logger";

// =============================================================================
// URS-DMS — Express app factory
// Order matters. Returns a fully configured Express instance.
// =============================================================================

export function createApp(): Express {
  const app = express();

  app.set("trust proxy", trustProxyValue);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(
    cors({
      origin: (requestOrigin, callback) => {
        if (!requestOrigin) {
          callback(null, true);
          return;
        }

        const allowed = env.CLIENT_URL.some((configuredOrigin) => {
          const wildcardIndex = configuredOrigin.indexOf("*.");
          if (wildcardIndex >= 0) {
            return requestOrigin.startsWith(configuredOrigin.slice(0, wildcardIndex))
              && requestOrigin.endsWith(configuredOrigin.slice(wildcardIndex + 1));
          }
          return configuredOrigin === requestOrigin;
        });
        callback(null, allowed);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Request-Id", "X-Correlation-Id"],
      exposedHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
    }),
  );

  app.use(cookieParser());
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "1mb" }));

  app.use(
    morgan(env.NODE_ENV === "production" ? "combined" : "dev", {
      stream: { write: (msg) => logger.http(msg.trim()) },
    }),
  );

  app.use(requestContext);

  // Rate limiting applies to all /api routes EXCEPT /health (mounted separately)
  app.use("/api", globalLimiter);

  app.use("/api/v1", apiRouter);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: `Route not found: ${req.method} ${req.originalUrl}`,
      },
    });
  });

  app.use(errorHandler);

  return app;
}
