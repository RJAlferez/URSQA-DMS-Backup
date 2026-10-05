import { Client as MinioClient } from "minio";
import { Readable } from "node:stream";
import { env } from "@/config/env";
import { getRequestOrigin } from "@/middlewares/requestContext";
import { signFileToken } from "@/lib/fileToken";
import { ServiceUnavailableError } from "@/utils/errors";

// =============================================================================
// URS-DMS — MinIO object storage adapter
// Single-process singleton. Bucket is created on first boot.
// Browser uploads/downloads are streamed THROUGH the Express backend via
// short-lived signed file tokens (see fileToken.ts); MinIO itself stays on a
// private network and is never exposed publicly.
// =============================================================================

export interface PresignedUpload {
  url: string;
  objectKey: string;
  headers: Record<string, string>;
  expiresInSeconds: number;
}

export interface PresignedDownload {
  url: string;
  objectKey: string;
  expiresInSeconds: number;
}

let client: MinioClient | null = null;
let bucketEnsured = false;

function getClient(): MinioClient {
  if (client) return client;
  client = new MinioClient({
    endPoint: env.MINIO_ENDPOINT,
    port: env.MINIO_PORT,
    useSSL: env.MINIO_USE_SSL,
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
  });
  return client;
}

// Origin of the request that triggered the URL mint (localhost in dev, the
// through a remote tunnel). Falls back to the local server origin when called
// outside a request context (e.g. background workers).
function backendOrigin(): string {
  const origin = getRequestOrigin();
  if (origin) return origin;
  const proto = env.MINIO_USE_SSL ? "https" : "http";
  return `${proto}://${env.MINIO_ENDPOINT === "localhost" || env.MINIO_ENDPOINT === "minio" ? "localhost" : env.MINIO_ENDPOINT}:${env.PORT}`;
}

export async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const c = getClient();
  const exists = await c.bucketExists(env.MINIO_BUCKET).catch(() => false);
  if (!exists) {
    await c.makeBucket(env.MINIO_BUCKET, "us-east-1");
  }
  bucketEnsured = true;
}

function buildObjectKey(documentId: string, versionId: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `documents/${documentId}/${versionId}/${safe}`;
}

export async function presignUpload(
  documentId: string,
  versionId: string,
  filename: string,
  mimeType: string,
  sizeBytes: number,
): Promise<PresignedUpload> {
  const objectKey = buildObjectKey(documentId, versionId, filename);
  const expiresInSeconds = 15 * 60;
  const url = `${backendOrigin()}/api/v1/files/upload?token=${encodeURIComponent(signFileToken("upload", objectKey))}`;
  return {
    url,
    objectKey,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(sizeBytes),
    },
    expiresInSeconds,
  };
}

export async function presignDownload(
  objectKey: string,
  opts: { inline?: boolean } = {},
): Promise<PresignedDownload> {
  const expiresInSeconds = 10 * 60;
  const url = `${backendOrigin()}/api/v1/files/download?token=${encodeURIComponent(signFileToken("download", objectKey, opts))}`;
  return { url, objectKey, expiresInSeconds };
}

export async function statObject(objectKey: string): Promise<{ size: number; etag: string; contentType: string }> {
  const c = getClient();
  try {
    const stat = await c.statObject(env.MINIO_BUCKET, objectKey);
    const contentType =
      (stat.metaData?.["content-type"] as string | undefined) ?? "application/octet-stream";
    return { size: stat.size, etag: stat.etag, contentType };
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "NoSuchKey" || code === "NotFound") {
      throw Object.assign(new Error("Object not found"), { code });
    }
    throw new ServiceUnavailableError("Storage stat failed", {
      reason: err instanceof Error ? err.message : String(err),
      minioCode: code,
    });
  }
}

/**
 * Sprint 8.3 — maintenance helpers (additive; behavior of existing calls
 * is unchanged).
 */

/** True when the object exists (used by integrity/orphan checks). */
export async function objectExists(objectKey: string): Promise<boolean> {
  try {
    await getClient().statObject(env.MINIO_BUCKET, objectKey);
    return true;
  } catch {
    return false;
  }
}

/** Lists up to `limit` object keys in the bucket (maintenance scans). */
export async function listObjectKeys(limit: number): Promise<string[]> {
  const stream = getClient().listObjectsV2(env.MINIO_BUCKET, "", true);
  return new Promise((resolve, reject) => {
    const keys: string[] = [];
    const timer = setTimeout(() => {
      stream.destroy();
      resolve(keys);
    }, 60_000);
    stream.on("data", (obj) => {
      if (obj && obj.name && keys.length < limit) {
        keys.push(obj.name);
      }
      if (keys.length >= limit) {
        clearTimeout(timer);
        stream.destroy();
        resolve(keys);
      }
    });
    stream.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    stream.on("end", () => {
      clearTimeout(timer);
      resolve(keys);
    });
  });
}

/** Safe MinIO connectivity probe (bucket exists). */
export async function storageHealth(): Promise<{ status: string; bucketExists: boolean }> {
  try {
    const exists = await getClient().bucketExists(env.MINIO_BUCKET);
    return { status: exists ? "up" : "bucket_missing", bucketExists: exists };
  } catch {
    return { status: "down", bucketExists: false };
  }
}

export async function deleteObject(objectKey: string): Promise<void> {
  const c = getClient();
  try {
    await c.removeObject(env.MINIO_BUCKET, objectKey);
  } catch (err) {
    throw new ServiceUnavailableError("Storage delete failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function getObjectStream(objectKey: string): Promise<Readable> {
  const c = getClient();
  try {
    const stream = await c.getObject(env.MINIO_BUCKET, objectKey);
    return stream as Readable;
  } catch (err) {
    throw new ServiceUnavailableError("Storage fetch failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

function buildProfilePhotoKey(userId: string): string {
  return `profile-photos/${userId}/photo`;
}

export async function presignProfilePhotoUpload(userId: string, mimeType: string, sizeBytes: number): Promise<PresignedUpload> {
  const objectKey = buildProfilePhotoKey(userId);
  const expiresInSeconds = 15 * 60;
  const url = `${backendOrigin()}/api/v1/files/upload?token=${encodeURIComponent(signFileToken("upload", objectKey))}`;
  return { url, objectKey, headers: { "Content-Type": mimeType, "Content-Length": String(sizeBytes) }, expiresInSeconds };
}

export async function putObject(
  objectKey: string,
  body: Readable | Buffer,
  size: number,
  mimeType: string,
): Promise<void> {
  try {
    await getClient().putObject(env.MINIO_BUCKET, objectKey, body, size, {
      "Content-Type": mimeType,
    });
  } catch (err) {
    throw new ServiceUnavailableError("Storage upload failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

export function thumbnailObjectKey(objectKey: string): string {
  return `${objectKey}.thumbnail.webp`;
}

export function previewObjectKey(objectKey: string): string {
  return `${objectKey}.preview.pdf`;
}

export function objectKeyFor(documentId: string, versionId: string, filename: string): string {
  return buildObjectKey(documentId, versionId, filename);
}
