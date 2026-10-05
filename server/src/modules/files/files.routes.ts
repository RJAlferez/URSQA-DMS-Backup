import { Router } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import { verifyFileToken } from "@/lib/fileToken";
import { getObjectStream, putObject, statObject } from "@/lib/storage";
import { env } from "@/config/env";
import { BadRequestError, UnauthorizedError } from "@/utils/errors";

// =============================================================================
// URS-DMS — signed file streaming routes
// -----------------------------------------------------------------------------
// These are the ONLY public file endpoints. Access is granted exclusively by a
// short-lived signed token (fileToken.ts) embedded in the URL the backend
// minted for an already-authorized user (document read/create permission etc.).
// MinIO stays on a private network; every byte flows through Express.
//
//   PUT /api/v1/files/upload?token=…   raw body -> MinIO (authorization was
//                                      already checked when the token was minted)
//   GET /api/v1/files/download?token=… MinIO -> stream (inline or attachment)
// =============================================================================

export const filesRouter: Router = Router();

// Only these MIME types may be rendered inline (preview) in a browser.
// Everything else is forced to an octet-stream attachment so a crafted upload
// (text/html, image/svg+xml, application/xhtml+xml, …) can never execute
// script on the API origin via the preview iframe.
const SAFE_INLINE_TYPES = new Set<string>([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "text/plain",
  "text/csv",
]);

// Active-content types are stored as opaque bytes regardless of what the
// client declared, keeping MinIO metadata from misrepresenting the payload.
const ACTIVE_CONTENT_TYPES = new Set<string>([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/xml",
  "text/xml",
  "application/javascript",
  "text/javascript",
  "application/ecmascript",
  "text/ecmascript",
]);

function normalizeContentType(raw: string | undefined): string {
  const value = (raw ?? "").split(";")[0]!.trim().toLowerCase();
  return value || "application/octet-stream";
}

function extractToken(query: unknown): string {
  const token = (query as { token?: string }).token;
  if (!token) throw new UnauthorizedError("Missing file token");
  return token;
}

filesRouter.put(
  "/upload",
  asyncHandler(async (req, res) => {
    const payload = (() => {
      try {
        return verifyFileToken(extractToken(req.query), "upload");
      } catch {
        throw new UnauthorizedError("Invalid or expired file token");
      }
    })();

    const sizeBytes = Number(req.headers["content-length"] ?? 0);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new BadRequestError("Content-Length is required");
    }
    const declared = normalizeContentType(req.headers["content-type"] as string | undefined);
    const mimeType = ACTIVE_CONTENT_TYPES.has(declared) ? "application/octet-stream" : declared;

    await putObject(payload.k, req, sizeBytes, mimeType);
    res.status(204).end();
  }),
);

filesRouter.get(
  "/download",
  asyncHandler(async (req, res) => {
    const payload = (() => {
      try {
        return verifyFileToken(extractToken(req.query), "download");
      } catch {
        throw new UnauthorizedError("Invalid or expired file token");
      }
    })();

    const stat = await statObject(payload.k);
    const stream = await getObjectStream(payload.k);

    const filename = payload.k.split("/").pop() ?? "file";
    const declared = normalizeContentType(stat.contentType);
    const inlineRequested = payload.i === 1;
    const inlineSafe = inlineRequested && SAFE_INLINE_TYPES.has(declared);
    const disposition = inlineSafe ? "inline" : "attachment";
    const servedType = inlineRequested && !inlineSafe ? "application/octet-stream" : declared;
    res.setHeader("Content-Type", servedType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
    );
    // Previews render in iframes on the frontend origins (Cloudflare Pages
    // remotely, localhost in dev). Helmet's default CSP would block framing
    // from any other origin, so allowlist the configured client origins here.
    const frameAncestors = ["'self'", ...env.CLIENT_URL.map((o) => o.replace(/^https?:\/\//, ""))];
    res.setHeader("Content-Security-Policy", `frame-ancestors ${frameAncestors.join(" ")}`);
    res.setHeader("Cache-Control", "private, max-age=300");
    stream.on("error", () => {
      if (!res.headersSent) res.status(500);
      res.end();
    });
    stream.pipe(res);
  }),
);
