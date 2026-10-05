import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import { env } from "@/config/env";

// =============================================================================
// URS-DMS — rate limiters
// globalLimiter: 100 req / 15 min per IP
// authLimiter:   5 req / 15 min per IP, doesn't count successful requests
// =============================================================================

export const globalLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Authentication endpoints have their own limiter. Keeping them in the
    // broad API bucket means ordinary authenticated polling can exhaust the
    // shared IP budget and prevent a valid session from refreshing or a user
    // from logging back in.
    if (isAuthRoute(req.path)) return true;
    // Health checks are probed frequently by ops and monitoring and must
    // never be throttled.
    if (req.path.startsWith("/v1/health")) return true;
    // The university logo is read on the public login screen (GET only). It is
    // still gated by the setup.read permission at the handler, so exempting it
    // from the global limiter leaks nothing while preventing a login-page
    // lockout.
    if (req.method === "GET" && req.path === "/v1/root/setup/logo") return true;
    // Pre-login registration helpers needed to render the register page.
    // They are still guarded by authLimiter (5 req / 15 min per IP) so
    // brute-force attempts stay throttled; only the shared global bucket
    // (which can lock out the whole campus behind one edge IP) skips them.
    if (req.method === "GET" && req.path === "/v1/auth/registration-options") return true;
    if (req.method === "POST" && req.path === "/v1/auth/registration/validate") return true;
    if (req.method === "POST" && req.path === "/v1/auth/registration/request") return true;
    return false;
  },
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many requests, please try again later." },
  },
});

export function isAuthRoute(path: string): boolean {
  return path.startsWith("/v1/auth/");
}

export const authLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  // Successful login/refresh requests do not consume the auth-attempt budget;
  // failed attempts are counted after the response status is known.
  skipSuccessfulRequests: true,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many auth attempts, please try again later." },
  },
});
