// =============================================================================
// URS-DMS — Audit classification & correlation unit tests (pure, no DB)
// Guards the forensic rules:
//   * stored result is authoritative for new audit rows,
//   * legacy rows defaulted to SUCCESS are classified from the action name,
//   * authorization denials are NEVER reported as failures,
//   * every audit writer inside one request/job sees the same correlation id.
// =============================================================================

import { describe, it, expect } from "vitest";
import { reportAuditStatus } from "@/modules/reports/reports.repository";
import { runWithRequestId, getRequestId } from "@/middlewares/requestContext";

describe("audit report status classification", () => {
  it("keeps stored FAILED/DENIED authoritative for new rows", () => {
    expect(reportAuditStatus("SUCCESS", "auth.login.success")).toBe("SUCCESS");
    expect(reportAuditStatus("FAILED", "auth.login.failed")).toBe("FAILED");
    expect(reportAuditStatus("DENIED", "auth.access_denied")).toBe("DENIED");
    expect(reportAuditStatus("DENIED", "auth.permission_denied")).toBe("DENIED");
    expect(reportAuditStatus("FAILED", "document.upload_failed")).toBe("FAILED");
  });

  it("classifies legacy defaulted rows from the action name", () => {
    expect(reportAuditStatus("SUCCESS", "auth.login.failed")).toBe("FAILED");
    expect(reportAuditStatus("SUCCESS", "auth.refresh.failed")).toBe("FAILED");
    expect(reportAuditStatus("SUCCESS", "auth.refresh.reuse_detected")).toBe("FAILED");
    expect(reportAuditStatus("SUCCESS", "document.upload_failed")).toBe("FAILED");
    expect(reportAuditStatus("SUCCESS", "email.failed")).toBe("FAILED");
    expect(reportAuditStatus("SUCCESS", "maintenance.recycle_cleanup.failed")).toBe("FAILED");
    expect(reportAuditStatus("SUCCESS", "auth.password_reset.failed")).toBe("FAILED");
    expect(reportAuditStatus("SUCCESS", "document.downloaded")).toBe("SUCCESS");
  });

  it("never labels an authorization denial as an operation failure", () => {
    expect(reportAuditStatus("SUCCESS", "auth.access_denied")).toBe("DENIED");
    expect(reportAuditStatus("SUCCESS", "auth.permission_denied")).toBe("DENIED");
    expect(reportAuditStatus("SUCCESS", "auth.access_denied")).not.toBe("FAILED");
  });
});

describe("request correlation context", () => {
  it("has no correlation id outside a request or job context", () => {
    expect(getRequestId()).toBeUndefined();
  });

  it("exposes one stable id to every audit writer inside the context", async () => {
    const seen = await runWithRequestId("req_test_123", async () => {
      const first = getRequestId();
      await Promise.resolve();
      const second = getRequestId();
      return [first, second];
    });
    expect(seen).toEqual(["req_test_123", "req_test_123"]);
    expect(getRequestId()).toBeUndefined();
  });

  it("nests worker contexts without leaking the parent id", () => {
    runWithRequestId("job:urs-email-delivery:42", () => {
      expect(getRequestId()).toBe("job:urs-email-delivery:42");
      runWithRequestId("req_inner", () => {
        expect(getRequestId()).toBe("req_inner");
      });
      expect(getRequestId()).toBe("job:urs-email-delivery:42");
    });
  });
});
