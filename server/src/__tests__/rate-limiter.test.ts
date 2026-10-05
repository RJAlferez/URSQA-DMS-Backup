import { describe, expect, it } from "vitest";
import { isAuthRoute } from "@/middlewares/rateLimiter";

describe("global rate-limit authentication boundary", () => {
  it("keeps login and refresh outside the shared API bucket", () => {
    expect(isAuthRoute("/v1/auth/login")).toBe(true);
    expect(isAuthRoute("/v1/auth/refresh")).toBe(true);
    expect(isAuthRoute("/v1/auth/logout")).toBe(true);
  });

  it("does not exempt ordinary API traffic", () => {
    expect(isAuthRoute("/v1/notifications")).toBe(false);
    expect(isAuthRoute("/v1/dashboard/overview")).toBe(false);
  });
});
