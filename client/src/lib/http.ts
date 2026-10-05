// =============================================================================
// URS-DMS — minimal HTTP client for the backend API.
// Every service layer (auth, documents, aaccup, root, notifications) talks to
// the real backend through these helpers. No local data stores are used.
// =============================================================================

// Production builds use same-origin API requests. The explicit dev fallback is
// also relative so a missing Vite env cannot leak requests to a user's localhost.
const API_BASE = (import.meta as unknown as { env: { VITE_API_BASE?: string } }).env.VITE_API_BASE ?? "/api/v1";

export { API_BASE };

const SERVER_TOKEN_KEY = "urs_dms_server_token";

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(SERVER_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setServerToken(token: string): void {
  try {
    localStorage.setItem(SERVER_TOKEN_KEY, token);
    sessionExpiredNotified = false;
  } catch {
    // Storage may be unavailable (private mode); auth state still lives in memory.
  }
}

export function clearServerToken(): void {
  try {
    localStorage.removeItem(SERVER_TOKEN_KEY);
  } catch {
    // Storage may be unavailable (private mode); nothing to clear.
  }
}

export interface ApiEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiPageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ApiPage<T> {
  items: T[];
  meta: ApiPageMeta;
}

export interface ApiErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Single-flight refresh. On a page refresh with an expired access token,
 * several API calls 401 in parallel. Each one was previously firing its own
 * /auth/refresh with the same (old) refresh cookie, which rotated the session
 * on the server; the loser of the race then tripped the reuse-detection and
 * revoked ALL of the user's sessions — forcing a logout back to the login page.
 * Serialising refresh behind a single shared promise ensures only one refresh
 * runs; the rest await the same result and retry with the new token.
 */
type RefreshResult = "success" | "invalid" | "unavailable";

let refreshInFlight: Promise<RefreshResult> | null = null;
// A burst of parallel 401s must produce exactly ONE session-expired signal —
// otherwise every waiter calls authService.logout() and hammers /auth/logout.
let sessionExpiredNotified = false;

async function refreshAccessToken(): Promise<RefreshResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: "{}",
      signal: controller.signal,
    });
    const refreshPayload = await refreshResponse.json() as
      | ApiEnvelope<{ accessToken: string }>
      | ApiErrorEnvelope;
    if (refreshResponse.ok && refreshPayload.success) {
      setServerToken(refreshPayload.data.accessToken);
      return "success";
    }
    // Only an explicit auth rejection proves that the refresh session is no
    // longer valid. Rate limits, 5xx responses, and other temporary failures
    // must not be turned into an automatic logout.
    return refreshResponse.status === 401 || refreshResponse.status === 403
      ? "invalid"
      : "unavailable";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}

async function requestEnvelope<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  retried = false,
): Promise<ApiEnvelope<T>> {
  const url = `${API_BASE}${path}`;
  const token = getAccessToken();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: "include",
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiRequestError(0, "NETWORK", err instanceof Error ? err.message : String(err));
  }

  if (res.status === 401 && !retried && token && path !== "/auth/login" && path !== "/auth/logout" && path !== "/auth/refresh") {
    if (!refreshInFlight) {
      refreshInFlight = refreshAccessToken().finally(() => {
        refreshInFlight = null;
      });
    }
    const refreshed = await refreshInFlight;
    if (refreshed === "success") {
      return requestEnvelope<T>(method, path, body, true);
    }
    if (refreshed === "invalid") {
      clearServerToken();
      // Expired session: notify the auth layer so the UI returns to the login
      // screen instead of showing broken pages. Only the first 401 of a burst
      // dispatches — N parallel requests must not trigger N logouts.
      if (!sessionExpiredNotified) {
        sessionExpiredNotified = true;
        window.dispatchEvent(new CustomEvent("urs:session-expired"));
      }
    }
  }

  if (res.status === 204) {
    return { success: true, data: undefined as T };
  }

  let payload: ApiEnvelope<T> | ApiErrorEnvelope;
  try {
    payload = await res.json();
  } catch {
    throw new ApiRequestError(res.status, "PARSE_ERROR", `Invalid response from ${path}`);
  }

  if (!res.ok || !("success" in payload) || !payload.success) {
    const err = payload as ApiErrorEnvelope;
    // Validation failures carry per-field messages in `details.fieldErrors`;
    // surface the first one instead of the generic "Request validation failed".
    let message = err.error.message;
    const details = err.error.details as Record<string, string[]> | undefined;
    if (details && typeof details === "object") {
      const firstField = Object.entries(details).find(
        ([, messages]) => Array.isArray(messages) && messages.length > 0,
      );
      if (firstField) {
        message = firstField[1][0];
      }
    }
    throw new ApiRequestError(res.status, err.error.code, message);
  }

  return payload as ApiEnvelope<T>;
}

async function request<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  return (await requestEnvelope<T>(method, path, body)).data;
}

export const apiGet = <T>(path: string): Promise<T> => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown): Promise<T> => request<T>("POST", path, body);
export const apiPatch = <T>(path: string, body?: unknown): Promise<T> => request<T>("PATCH", path, body);
export const apiDelete = <T>(path: string): Promise<T> => request<T>("DELETE", path);

export async function apiGetPage<T>(path: string): Promise<ApiPage<T>> {
  const payload = await requestEnvelope<T[]>("GET", path);
  const meta = payload.meta ?? {};
  return {
    items: payload.data,
    meta: {
      page: Number(meta.page ?? 1),
      pageSize: Number(meta.pageSize ?? payload.data.length),
      total: Number(meta.total ?? payload.data.length),
      totalPages: Number(meta.totalPages ?? 1),
    },
  };
}
