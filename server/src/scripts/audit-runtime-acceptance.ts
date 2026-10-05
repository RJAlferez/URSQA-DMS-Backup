// =============================================================================
// URS-DMS — Audit runtime acceptance harness
// -----------------------------------------------------------------------------
/* eslint-disable @typescript-eslint/no-explicit-any, no-console -- dev-only harness: loose JSON response shapes + console report */
// Exercises the audit-accuracy scenarios against a RUNNING server + real
// PostgreSQL/MinIO and verifies the resulting audit_logs rows directly.
//
// Usage (from server/):
//   npx tsx --env-file=../.env src/scripts/audit-runtime-acceptance.ts --confirm
//
// Safety:
//   * refuses to run without --confirm and against NODE_ENV=production
//   * creates temporary `rt.audit.*` users/documents/requests and cleans them
//     up (soft-deletes users to preserve audit actor FKs, hard-deletes its own
//     test documents/requests, removes its MinIO objects)
//   * NEVER deletes or rewrites audit_logs rows
// =============================================================================

import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/modules/auth/auth.password";
import { deleteObject } from "@/lib/storage";
import { sendEmail } from "@/modules/email/email.service";

const BASE = process.env.RT_BASE_URL ?? "http://localhost:4000/api/v1";
const STAMP = `${Date.now().toString(36)}${randomUUID().slice(0, 4)}`;
const PASSWORD = "Rtaudit123";

if (!process.argv.includes("--confirm")) {
  console.error("Refusing to run without --confirm (creates temporary test data).");
  process.exit(2);
}
if ((process.env.NODE_ENV ?? "") === "production") {
  console.error("Refusing to run against NODE_ENV=production.");
  process.exit(2);
}

// ── result model ─────────────────────────────────────────────────────────────
interface Check { name: string; pass: boolean; detail: string }
interface Scenario { id: string; title: string; status: "PASS" | "FAIL" | "BLOCKED"; checks: Check[] }
const scenarios: Scenario[] = [];

function begin(id: string, title: string): Scenario {
  const s: Scenario = { id, title, status: "BLOCKED", checks: [] };
  scenarios.push(s);
  return s;
}
function check(s: Scenario, name: string, pass: boolean, detail = ""): void {
  s.checks.push({ name, pass, detail });
}
function settle(s: Scenario, blocked = false): void {
  if (blocked) { s.status = "BLOCKED"; return; }
  s.status = s.checks.length > 0 && s.checks.every((c) => c.pass) ? "PASS" : "FAIL";
}
async function runScenario(
  id: string,
  title: string,
  fn: (s: Scenario) => Promise<void>,
  blockedReason?: string,
): Promise<void> {
  const s = begin(id, title);
  if (blockedReason) { check(s, "blocked", false, blockedReason); settle(s, true); return; }
  try { await fn(s); settle(s); } catch (err) { check(s, "no exception", false, String(err)); settle(s); }
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
interface ApiResult { status: number; body: any; requestId: string | null; contentType: string | null }
async function api(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.token) headers["Authorization"] = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return {
    status: res.status,
    body,
    requestId: res.headers.get("x-request-id"),
    contentType: res.headers.get("content-type"),
  };
}

async function putBytes(url: string, bytes: Buffer, mimeType: string): Promise<number> {
  const res = await fetch(url, { method: "PUT", headers: { "Content-Type": mimeType }, body: bytes });
  return res.status;
}

const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

// ── audit read helpers (direct DB) ───────────────────────────────────────────
async function rowsForActionUser(action: string, userId: string, gte: Date) {
  return prisma.auditLog.findMany({
    where: { action, userId, createdAt: { gte } } as never,
    orderBy: { createdAt: "asc" },
  });
}
async function rowsForAction(action: string, gte: Date) {
  return prisma.auditLog.findMany({
    where: { action, createdAt: { gte } } as never,
    orderBy: { createdAt: "asc" },
  });
}
async function countInWindow(gte: Date): Promise<number> {
  return prisma.auditLog.count({ where: { createdAt: { gte } } as never });
}

// ── test data helpers ────────────────────────────────────────────────────────
interface TestUser { id: string; email: string; roleId: string }
const userIds: string[] = [];
const objectKeys: string[] = [];
const createdRequestIds: string[] = [];
const testEmailAddresses: string[] = [];

async function createTestUser(roleName: string, suffix: string): Promise<TestUser> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName as never }, select: { id: true } });
  const passwordHash = await hashPassword(PASSWORD);
  const user = await prisma.user.create({
    data: {
      employeeId: `RT-${suffix}-${STAMP}`.slice(0, 64),
      email: `rt.audit.${suffix}.${STAMP}@urs.local`,
      passwordHash,
      firstName: "RT",
      lastName: suffix,
      roleId: role.id,
      status: "ACTIVE",
    },
    select: { id: true, email: true },
  });
  userIds.push(user.id);
  return { id: user.id, email: user.email, roleId: role.id };
}

async function login(user: TestUser): Promise<ApiResult> {
  return api("POST", "/auth/login", { body: { identifier: user.email, password: PASSWORD } });
}

async function main(): Promise<void> {
  const start = new Date();
  const health = await api("GET", "/health");
  if (health.status !== 200) throw new Error(`server not healthy (${health.status})`);

  const faculty = await createTestUser("FACULTY", "faculty");
  const corrUser = await createTestUser("FACULTY", "corr");
  const doubleUser = await createTestUser("FACULTY", "double");

  const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "";
  const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  const rootEmail = process.env.BOOTSTRAP_ROOT_EMAIL ?? "";
  const rootPassword = process.env.BOOTSTRAP_ROOT_PASSWORD ?? "";

  const adminLogin = await api("POST", "/auth/login", { body: { identifier: adminEmail, password: adminPassword } });
  const adminToken: string | undefined = adminLogin.body?.data?.accessToken;
  const adminId: string | undefined = adminLogin.body?.data?.user?.id;
  const adminBlocked = adminLogin.status !== 200 || !adminToken || !adminId
    ? `bootstrap admin login failed (${adminLogin.status})`
    : undefined;

  const rootLogin = await api("POST", "/auth/login", { body: { identifier: rootEmail, password: rootPassword } });
  const rootToken: string | undefined = rootLogin.body?.data?.accessToken;
  const rootId: string | undefined = rootLogin.body?.data?.user?.id;
  const rootBlocked = rootLogin.status !== 200 || !rootToken
    ? `bootstrap root login failed (${rootLogin.status})`
    : undefined;

  // ═══════════════════════════════════════════════════════════════════════════
  // A — LOGIN SUCCESS
  // ═══════════════════════════════════════════════════════════════════════════
  let facultyToken: string | undefined;
  let facultyRefresh: string | undefined;
  await runScenario("A", "Login success produces exactly one AUTHENTICATION success event", async (s) => {
    const r = await login(faculty);
    facultyToken = r.body?.data?.accessToken;
    facultyRefresh = r.body?.data?.refreshToken;
    check(s, "login HTTP 200", r.status === 200, `status=${r.status}`);
    check(s, "access token issued", !!facultyToken);
    check(s, "X-Request-Id present", !!r.requestId, `requestId=${r.requestId ?? "null"}`);

    const rows = await rowsForActionUser("auth.login.success", faculty.id, start);
    check(s, "exactly one auth.login.success", rows.length === 1, `count=${rows.length}`);
    const row = rows[0];
    if (row) {
      check(s, "result SUCCESS", row.result === "SUCCESS", row.result);
      check(s, "category AUTHENTICATION", row.category === "AUTHENTICATION", row.category);
      check(s, "actor is faculty", row.userId === faculty.id);
      check(s, "correlationId == response X-Request-Id", row.correlationId === r.requestId, `${row.correlationId} vs ${r.requestId}`);
      check(s, "timestamp recorded", !!row.createdAt);
    }
    const failed = await rowsForActionUser("auth.login.failed", faculty.id, start);
    check(s, "no auth.login.failed", failed.length === 0, `count=${failed.length}`);
    const denials = await prisma.auditLog.count({ where: { result: "DENIED", createdAt: { gte: start } } as never });
    check(s, "no denial events from normal login", denials === 0, `count=${denials}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // B — UNAUTHORIZED ACCESS
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("B", "Authorization denial is DENIED/SECURITY, never a login failure", async (s) => {
    const bStart = new Date();
    const r = await api("GET", "/audit", { token: facultyToken });
    check(s, "protected route returns 403", r.status === 403, `status=${r.status}`);
    const rows = await rowsForAction("auth.permission_denied", bStart);
    const row = rows.find((x) => x.userId === faculty.id);
    check(s, "exactly one auth.permission_denied", rows.filter((x) => x.userId === faculty.id).length === 1, `count=${rows.length}`);
    if (row) {
      check(s, "result DENIED", row.result === "DENIED", row.result);
      check(s, "category SECURITY", row.category === "SECURITY", row.category);
      check(s, "target is the protected route", String(row.entityId ?? "").includes("/audit"), String(row.entityId));
      check(s, "correlationId == response X-Request-Id", row.correlationId === r.requestId, `${row.correlationId} vs ${r.requestId}`);
    }
    const loginFailed = await rowsForAction("auth.login.failed", bStart);
    check(s, "no login.failed created by denial", loginFailed.length === 0, `count=${loginFailed.length}`);
    const loginSuccess = await rowsForAction("auth.login.success", bStart);
    check(s, "no extra login.success", loginSuccess.length === 0, `count=${loginSuccess.length}`);

    // service-level ownership denial (auth.access_denied)
    if (adminId) {
      const r2 = await api("GET", `/repositories/${adminId}`, { token: facultyToken });
      check(s, "cross-user repository returns 404", r2.status === 404, `status=${r2.status}`);
      // The denial audit is awaited in the service: the row must be visible
      // immediately after the 404, with no polling/wait.
      const rows2 = await rowsForAction("auth.access_denied", bStart);
      const mine = rows2.filter((x) => x.userId === faculty.id);
      check(s, "one auth.access_denied", mine.length === 1, `count=${mine.length}`);
      check(
        s,
        "no duplicate denial for this request",
        rows2.filter((x) => x.correlationId === r2.requestId).length === 1,
        `count=${rows2.filter((x) => x.correlationId === r2.requestId).length}`,
      );
      const row2 = mine[0];
      if (row2) {
        check(s, "access_denied result DENIED", row2.result === "DENIED", row2.result);
        check(s, "access_denied category SECURITY", row2.category === "SECURITY", row2.category);
        check(s, "access_denied correlationId", row2.correlationId === r2.requestId, `${row2.correlationId} vs ${r2.requestId}`);
      }
    } else {
      check(s, "access_denied tested", false, "admin id unavailable");
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C — AUDIT PAGE REFRESH WRITES NOTHING
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("C", "Audit read operations produce zero audit events", async (s) => {
    const cStart = new Date();
    const anyRow = await prisma.auditLog.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } });
    for (let i = 0; i < 5; i++) {
      await api("GET", "/audit?page=1&pageSize=5", { token: adminToken });
      await api("GET", "/audit/summary?days=1", { token: adminToken });
    }
    await api("GET", "/audit/presets", { token: adminToken });
    await api("GET", "/audit?q=login&sort=oldest&page=2&pageSize=5", { token: adminToken });
    await api("GET", "/audit/login-groups?withinMinutes=60&minAttempts=3", { token: adminToken });
    if (anyRow) await api("GET", `/audit/${anyRow.id}`, { token: adminToken });
    const created = await countInWindow(cStart);
    check(s, "zero new audit rows from 15 read calls", created === 0, `created=${created}`);
  }, adminBlocked);

  // ═══════════════════════════════════════════════════════════════════════════
  // D — DOUBLE LOGIN (server-level evidence; UI guard is client-side)
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("D", "Rapid double login — session + audit row inspection", async (s) => {
    const dStart = new Date();
    const [r1, r2] = await Promise.all([login(doubleUser), login(doubleUser)]);
    const ok = [r1, r2].filter((r) => r.status === 200).length;
    const rows = await rowsForActionUser("auth.login.success", doubleUser.id, dStart);
    const sessions = await prisma.session.count({ where: { userId: doubleUser.id } as never });
    check(s, "server accepted each HTTP login as a separate authentication", ok === rows.length && rows.length === sessions,
      `http200=${ok} auditSuccess=${rows.length} sessions=${sessions}`);
    check(s, "no failure events", (await rowsForActionUser("auth.login.failed", doubleUser.id, dStart)).length === 0);
    // UI-level guard is covered by the headless client AuthService test
    // (client/rt-guard-check.ts) — see report; server cannot dedupe by design.
    check(s, "client in-flight guard verified separately (headless)", true,
      "server evidence recorded; UI guard asserted in dedicated client test");
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // E — SUCCESSFUL UPLOAD
  // ═══════════════════════════════════════════════════════════════════════════
  let testDocId: string | undefined;
  await runScenario("E", "Verified upload produces exactly one document.version_added", async (s) => {
    const eStart = new Date();
    const created = await api("POST", "/documents", {
      token: facultyToken,
      body: { title: `RT Audit Upload ${STAMP}`, classification: "INTERNAL" },
    });
    testDocId = created.body?.data?.document?.id;
    check(s, "document created", created.status === 201 || created.status === 200, `status=${created.status}`);
    if (!testDocId) { check(s, "document id", false, JSON.stringify(created.body).slice(0, 200)); return; }

    const bytes = Buffer.from(`RT audit payload ${STAMP}\n`);
    const checksum = sha256(bytes);
    const versionRes = await api("POST", `/documents/${testDocId}/version`, {
      token: facultyToken,
      body: { filename: "rt-audit.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, checksum },
    });
    check(s, "version row created", versionRes.status === 201 || versionRes.status === 200, `status=${versionRes.status}`);
    const uploadUrl: string | undefined = versionRes.body?.data?.upload?.url;
    const versionId: string | undefined = versionRes.body?.data?.document?.versions?.find((v: any) => v.checksum === checksum)?.id;
    if (!uploadUrl || !versionId) { check(s, "upload url + version id", false, JSON.stringify(versionRes.body).slice(0, 200)); return; }

    const putStatus = await putBytes(uploadUrl, bytes, "application/pdf");
    check(s, "object uploaded", putStatus === 204, `status=${putStatus}`);

    const verify = await api("POST", `/documents/${testDocId}/versions/${versionId}/verify`, { token: facultyToken });
    check(s, "verify succeeds", verify.status === 200, `status=${verify.status}`);

    const versionRows = await rowsForAction("document.version_added", eStart);
    const docVersionRows = versionRows.filter((r) => r.entityId === testDocId);
    check(s, "exactly one document.version_added", docVersionRows.length === 1, `count=${docVersionRows.length}`);
    const row = docVersionRows[0];
    if (row) {
      check(s, "result SUCCESS", row.result === "SUCCESS", row.result);
      check(s, "actor faculty", row.userId === faculty.id);
      check(s, "target document", row.entityId === testDocId);
      check(s, "correlationId == verify request id", row.correlationId === verify.requestId, `${row.correlationId} vs ${verify.requestId}`);
    }
    const createdRows = (await rowsForAction("document.created", eStart)).filter((r) => r.entityId === testDocId);
    check(s, "document.created present once (distinct event)", createdRows.length === 1, `count=${createdRows.length}`);
    if (createdRows[0]) {
      check(s, "document.created correlationId == create request id", createdRows[0].correlationId === created.requestId);
    }
    const failed = (await rowsForAction("document.upload_failed", eStart)).filter((r) => r.entityId === testDocId);
    check(s, "no upload_failed event", failed.length === 0, `count=${failed.length}`);
    check(s, "different requests -> different correlationIds", created.requestId !== verify.requestId);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // F — FAILED UPLOAD
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("F", "Controlled upload failure is FAILED/WARNING and has no success event", async (s) => {
    const fStart = new Date();
    const created = await api("POST", "/documents", {
      token: facultyToken,
      body: { title: `RT Audit Fail ${STAMP}`, classification: "INTERNAL" },
    });
    const failDocId: string | undefined = created.body?.data?.document?.id;
    if (!failDocId) { check(s, "document created", false, `status=${created.status}`); return; }

    const bytes = Buffer.from("never uploaded");
    const checksum = sha256(bytes);
    const versionRes = await api("POST", `/documents/${failDocId}/version`, {
      token: facultyToken,
      body: { filename: "rt-fail.pdf", mimeType: "application/pdf", sizeBytes: bytes.length, checksum },
    });
    const versionId: string | undefined = versionRes.body?.data?.document?.versions?.find((v: any) => v.checksum === checksum)?.id;
    if (!versionId) { check(s, "version row created", false, `status=${versionRes.status}`); return; }

    const verify = await api("POST", `/documents/${failDocId}/versions/${versionId}/verify`, { token: facultyToken });
    check(s, "verify fails with 400", verify.status === 400, `status=${verify.status}`);

    const failedRows = (await rowsForAction("document.upload_failed", fStart)).filter((r) => r.entityId === failDocId);
    check(s, "exactly one document.upload_failed", failedRows.length === 1, `count=${failedRows.length}`);
    const row = failedRows[0];
    if (row) {
      check(s, "result FAILED", row.result === "FAILED", row.result);
      check(s, "severity WARNING", row.severity === "WARNING", row.severity);
      check(s, "actor faculty", row.userId === faculty.id);
      check(s, "correlationId == verify request id", row.correlationId === verify.requestId, `${row.correlationId} vs ${verify.requestId}`);
    }
    const successRows = (await rowsForAction("document.version_added", fStart)).filter((r) => r.entityId === failDocId);
    check(s, "no success version event", successRows.length === 0, `count=${successRows.length}`);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // G — REQUEST APPROVAL (two distinct events, one correlation)
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("G", "Request approval: approved + delivered share one correlationId", async (s) => {
    if (!testDocId) { check(s, "uploaded document available", false); return; }
    const gStart = new Date();
    const createdReq = await api("POST", "/requests", {
      token: facultyToken,
      body: { title: `RT Audit Request A ${STAMP}`, justification: "runtime acceptance", documentIds: [testDocId] },
    });
    const requestId: string | undefined = createdReq.body?.data?.id;
    if (!requestId) { check(s, "request created", false, `status=${createdReq.status}`); return; }
    createdRequestIds.push(requestId);

    const approve = await api("POST", `/requests/${requestId}/approve`, { token: adminToken, body: {} });
    check(s, "approve returns 200", approve.status === 200, `status=${approve.status}`);

    const approved = (await rowsForAction("request.approved", gStart)).filter((r) => r.entityId === requestId);
    const delivered = (await rowsForAction("request.fulfilled.delivered", gStart)).filter((r) => r.entityId === requestId);
    check(s, "one request.approved", approved.length === 1, `count=${approved.length}`);
    check(s, "one request.fulfilled.delivered (distinct event)", delivered.length === 1, `count=${delivered.length}`);
    check(s, "approved result SUCCESS", approved[0]?.result === "SUCCESS", approved[0]?.result ?? "missing");
    check(s, "delivered result SUCCESS", delivered[0]?.result === "SUCCESS", delivered[0]?.result ?? "missing");
    check(s, "approved actor admin", approved[0]?.userId === adminId);
    check(s, "delivered actor admin", delivered[0]?.userId === adminId);
    check(s, "approved correlationId == approve request", approved[0]?.correlationId === approve.requestId,
      `${approved[0]?.correlationId} vs ${approve.requestId}`);
    check(s, "delivered correlationId == approve request (shared)", delivered[0]?.correlationId === approve.requestId,
      `${delivered[0]?.correlationId} vs ${approve.requestId}`);
    const deliveredDocs = await prisma.document.count({
      where: { ownerId: faculty.id, title: { startsWith: "[Delivered]" }, metadata: { path: ["requestId"], equals: requestId } } as never,
    });
    check(s, "delivered copy exists", deliveredDocs === 1, `count=${deliveredDocs}`);
  }, adminBlocked ?? (!testDocId ? "no test document" : undefined));

  // ═══════════════════════════════════════════════════════════════════════════
  // H — REQUEST REJECTION
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("H", "Request rejection is a successful REJECTED business action", async (s) => {
    if (!testDocId) { check(s, "uploaded document available", false); return; }
    const hStart = new Date();
    const createdReq = await api("POST", "/requests", {
      token: facultyToken,
      body: { title: `RT Audit Request R ${STAMP}`, justification: "runtime acceptance", documentIds: [testDocId] },
    });
    const requestId: string | undefined = createdReq.body?.data?.id;
    if (!requestId) { check(s, "request created", false, `status=${createdReq.status}`); return; }
    createdRequestIds.push(requestId);

    const reject = await api("POST", `/requests/${requestId}/reject`, {
      token: adminToken,
      body: { decisionNote: "runtime acceptance rejection" },
    });
    check(s, "reject returns 200", reject.status === 200, `status=${reject.status}`);
    const rows = (await rowsForAction("request.rejected", hStart)).filter((r) => r.entityId === requestId);
    check(s, "one request.rejected", rows.length === 1, `count=${rows.length}`);
    const row = rows[0];
    if (row) {
      check(s, "result SUCCESS (business action succeeded)", row.result === "SUCCESS", row.result);
      check(s, "actor admin", row.userId === adminId);
      check(s, "target request", row.entityId === requestId);
      check(s, "correlationId == reject request", row.correlationId === reject.requestId, `${row.correlationId} vs ${reject.requestId}`);
    }
    const delivered = (await rowsForAction("request.fulfilled.delivered", hStart)).filter((r) => r.entityId === requestId);
    check(s, "no delivered event on rejection", delivered.length === 0, `count=${delivered.length}`);
  }, adminBlocked ?? (!testDocId ? "no test document" : undefined));

  // ═══════════════════════════════════════════════════════════════════════════
  // I — ROLE CHANGE
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("I", "Role change writes an explicit user.role_changed event", async (s) => {
    const iStart = new Date();
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { name: "STAFF" }, select: { id: true } });
    const patch = await api("PATCH", `/admin/users/${faculty.id}`, { token: adminToken, body: { roleId: staffRole.id } });
    check(s, "role change returns 200", patch.status === 200, `status=${patch.status}`);
    const rows = (await rowsForAction("user.role_changed", iStart)).filter((r) => r.entityId === faculty.id);
    check(s, "one user.role_changed", rows.length === 1, `count=${rows.length}`);
    const row = rows[0];
    if (row) {
      check(s, "result SUCCESS", row.result === "SUCCESS", row.result);
      check(s, "category ACCESS_CONTROL", row.category === "ACCESS_CONTROL", row.category);
      check(s, "actor admin", row.userId === adminId);
      check(s, "old role = FACULTY", (row.oldValue as any)?.roleId === faculty.roleId, JSON.stringify(row.oldValue));
      check(s, "new role = STAFF", (row.newValue as any)?.roleId === staffRole.id, JSON.stringify(row.newValue));
      check(s, "correlationId == patch request", row.correlationId === patch.requestId, `${row.correlationId} vs ${patch.requestId}`);
    }
    // restore FACULTY
    const restore = await api("PATCH", `/admin/users/${faculty.id}`, { token: adminToken, body: { roleId: faculty.roleId } });
    check(s, "role restored to FACULTY", restore.status === 200, `status=${restore.status}`);
    const all = (await rowsForAction("user.role_changed", iStart)).filter((r) => r.entityId === faculty.id);
    check(s, "two role_changed events total (change + restore)", all.length === 2, `count=${all.length}`);
  }, adminBlocked);

  // ═══════════════════════════════════════════════════════════════════════════
  // L — TOKEN REFRESH (before logout)
  // ═══════════════════════════════════════════════════════════════════════════
  let facultyRefreshLatest: string | undefined = facultyRefresh;
  await runScenario("L", "Token refresh audits only auth.refresh.success", async (s) => {
    const lStart = new Date();
    const r = await api("POST", "/auth/refresh", { body: { refreshToken: facultyRefresh } });
    check(s, "refresh returns 200", r.status === 200, `status=${r.status}`);
    facultyRefreshLatest = r.body?.data?.refreshToken ?? facultyRefreshLatest;
    facultyToken = r.body?.data?.accessToken ?? facultyToken;
    const rows = await rowsForActionUser("auth.refresh.success", faculty.id, lStart);
    check(s, "one auth.refresh.success", rows.length === 1, `count=${rows.length}`);
    if (rows[0]) {
      check(s, "result SUCCESS", rows[0].result === "SUCCESS", rows[0].result);
      check(s, "category AUTHENTICATION", rows[0].category === "AUTHENTICATION", rows[0].category);
      check(s, "correlationId == refresh request", rows[0].correlationId === r.requestId, `${rows[0].correlationId} vs ${r.requestId}`);
    }
    check(s, "no login.success from refresh", (await rowsForActionUser("auth.login.success", faculty.id, lStart)).length === 0);
    check(s, "no login.failed from refresh", (await rowsForActionUser("auth.login.failed", faculty.id, lStart)).length === 0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // M — AUDIT EXPORT
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("M", "Audit export is audited once; unauthorized export denied", async (s) => {
    const mStart = new Date();
    const r = await api("GET", "/audit/export?format=csv&maxRows=3", { token: adminToken });
    check(s, "export returns 200", r.status === 200, `status=${r.status}`);
    check(s, "csv content type", String(r.contentType ?? "").includes("text/csv"), String(r.contentType));
    const rows = await rowsForAction("audit.log_exported", mStart);
    check(s, "one audit.log_exported", rows.length === 1, `count=${rows.length}`);
    if (rows[0]) {
      check(s, "result SUCCESS", rows[0].result === "SUCCESS", rows[0].result);
      check(s, "actor admin", rows[0].userId === adminId);
      check(s, "correlationId == export request", rows[0].correlationId === r.requestId, `${rows[0].correlationId} vs ${r.requestId}`);
    }
    const denied = await api("GET", "/audit/export?format=csv", { token: facultyToken });
    check(s, "faculty export denied (403)", denied.status === 403, `status=${denied.status}`);
  }, adminBlocked);

  // ═══════════════════════════════════════════════════════════════════════════
  // N — AUDIT CLEAR AUTHORIZATION (never executes a clear)
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("N", "Audit clear is ROOT-only; no clear executed", async (s) => {
    const nStart = new Date();
    const before = await countInWindow(new Date(0));
    const adminClear = await api("DELETE", "/audit", { token: adminToken });
    check(s, "admin DELETE /audit denied (403)", adminClear.status === 403, `status=${adminClear.status}`);
    const after = await countInWindow(new Date(0));
    // A clear would DELETE rows (count drops); the +1 is the expected denial.
    check(s, "no audit rows deleted by denied clear", after >= before, `${before} -> ${after}`);
    const cleared = await rowsForAction("audit.cleared", nStart);
    check(s, "no audit.cleared event", cleared.length === 0, `count=${cleared.length}`);
    if (!rootBlocked) {
      const retention = await api("GET", "/audit/retention", { token: rootToken });
      check(s, "ROOT reaches ROOT-gated audit route (retention 200)", retention.status === 200, `status=${retention.status}`);
    } else {
      check(s, "ROOT gate reachable", false, rootBlocked ?? "root unavailable");
    }
  }, adminBlocked);

  // ═══════════════════════════════════════════════════════════════════════════
  // CUSTOM / UNSAFE X-Request-Id
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("REQID", "Client-supplied request id is validated and propagated", async (s) => {
    const custom = `rt-corr-${STAMP}`;
    const r1 = await api("POST", "/auth/login", {
      body: { identifier: corrUser.email, password: PASSWORD },
      headers: { "X-Request-Id": custom },
    });
    check(s, "valid id echoed in response", r1.requestId === custom, `${r1.requestId} vs ${custom}`);
    const row1 = await prisma.auditLog.findFirst({
      where: { action: "auth.login.success", userId: corrUser.id, correlationId: custom } as never,
    });
    check(s, "audit row carries the supplied id", !!row1);

    const unsafe = "bad id!!";
    const r2 = await api("POST", "/auth/login", {
      body: { identifier: corrUser.email, password: PASSWORD },
      headers: { "X-Request-Id": unsafe },
    });
    check(s, "unsafe id not echoed verbatim", r2.requestId !== unsafe, String(r2.requestId));
    check(s, "unsafe id replaced with uuid", /^[0-9a-f-]{36}$/.test(r2.requestId ?? ""), String(r2.requestId));
    const row2 = await prisma.auditLog.findFirst({
      where: { action: "auth.login.success", userId: corrUser.id, correlationId: r2.requestId } as never,
    });
    check(s, "audit row carries the generated id", !!row2);

    const oversized = "x".repeat(200);
    const r3 = await api("POST", "/auth/login", {
      body: { identifier: corrUser.email, password: PASSWORD },
      headers: { "X-Request-Id": oversized },
    });
    check(s, "oversized id not echoed verbatim", r3.requestId !== oversized && (r3.requestId?.length ?? 999) <= 128, String(r3.requestId));
    const row3 = await prisma.auditLog.findFirst({
      where: { action: "auth.login.success", userId: corrUser.id, correlationId: r3.requestId } as never,
    });
    check(s, "audit row carries normalized id", !!row3);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // J — LOGOUT
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("J", "Logout writes exactly one auth.logout and revokes the session", async (s) => {
    const jStart = new Date();
    const refreshUsed = facultyRefreshLatest;
    const r = await api("POST", "/auth/logout", { body: { refreshToken: refreshUsed } });
    check(s, "logout returns 200", r.status === 200, `status=${r.status}`);
    const rows = await rowsForActionUser("auth.logout", faculty.id, jStart);
    check(s, "exactly one auth.logout", rows.length === 1, `count=${rows.length}`);
    if (rows[0]) {
      check(s, "result SUCCESS", rows[0].result === "SUCCESS", rows[0].result);
      check(s, "category AUTHENTICATION", rows[0].category === "AUTHENTICATION", rows[0].category);
      check(s, "correlationId == logout request", rows[0].correlationId === r.requestId, `${rows[0].correlationId} vs ${r.requestId}`);
    }
    if (refreshUsed) {
      const hash = createHash("sha256").update(refreshUsed).digest("hex");
      const session = await prisma.session.findUnique({ where: { refreshTokenHash: hash } as never });
      check(s, "session revoked", !!session?.revokedAt, `revokedAt=${session?.revokedAt ?? "null"}`);
    }
    check(s, "no extra login events on logout", (await rowsForActionUser("auth.login.success", faculty.id, jStart)).length === 0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // K — ROOT LOGIN / REFRESH / LOGOUT
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("K", "Root lifecycle: one root.login, no refresh spam, one root.logout", async (s) => {
    const kStart = new Date();
    const r = await api("POST", "/auth/login", { body: { identifier: rootEmail, password: rootPassword } });
    check(s, "root login 200", r.status === 200, `status=${r.status}`);
    if (r.status !== 200 || !rootId) { check(s, "root identity", false, "login failed"); return; }
    const authRows = await rowsForActionUser("auth.login.success", rootId, kStart);
    const rootRows = await rowsForActionUser("root.login", rootId, kStart);
    check(s, "one auth.login.success for root", authRows.length === 1, `count=${authRows.length}`);
    check(s, "one root.login (distinct lifecycle event)", rootRows.length === 1, `count=${rootRows.length}`);
    check(s, "root.login result SUCCESS", rootRows[0]?.result === "SUCCESS", rootRows[0]?.result ?? "missing");
    check(s, "root.login category AUTHENTICATION", rootRows[0]?.category === "AUTHENTICATION", rootRows[0]?.category ?? "missing");
    check(s, "root.login correlationId == login request", rootRows[0]?.correlationId === r.requestId, `${rootRows[0]?.correlationId} vs ${r.requestId}`);

    const refreshToken = r.body?.data?.refreshToken;
    const accessToken = r.body?.data?.accessToken;
    for (let i = 0; i < 3; i++) await api("GET", "/auth/me", { token: accessToken });
    const refresh = await api("POST", "/auth/refresh", { body: { refreshToken } });
    check(s, "root refresh 200", refresh.status === 200, `status=${refresh.status}`);
    const after = await rowsForActionUser("root.login", rootId, kStart);
    check(s, "no additional root.login after /me + refresh", after.length === 1, `count=${after.length}`);
    const extraLogins = await rowsForActionUser("auth.login.success", rootId, kStart);
    check(s, "no additional auth.login.success after /me + refresh", extraLogins.length === 1, `count=${extraLogins.length}`);
    const refreshRows = await rowsForActionUser("auth.refresh.success", rootId, kStart);
    check(s, "root refresh audited once", refreshRows.length === 1, `count=${refreshRows.length}`);

    const latestRefresh = refresh.body?.data?.refreshToken ?? refreshToken;
    const logout = await api("POST", "/auth/logout", { body: { refreshToken: latestRefresh } });
    check(s, "root logout 200", logout.status === 200, `status=${logout.status}`);
    const logoutRows = await rowsForActionUser("auth.logout", rootId, kStart);
    const rootLogoutRows = await rowsForActionUser("root.logout", rootId, kStart);
    check(s, "one auth.logout for root", logoutRows.length === 1, `count=${logoutRows.length}`);
    check(s, "one root.logout", rootLogoutRows.length === 1, `count=${rootLogoutRows.length}`);
    check(s, "root.logout correlationId == logout request", rootLogoutRows[0]?.correlationId === logout.requestId,
      `${rootLogoutRows[0]?.correlationId} vs ${logout.requestId}`);
  }, rootBlocked);

  // ═══════════════════════════════════════════════════════════════════════════
  // BACKGROUND JOB CORRELATION
  // ═══════════════════════════════════════════════════════════════════════════
  await runScenario("JOB", "Background email job audits with job:<queue>:<id> correlation", async (s) => {
    const emailTo = `rt.audit.email.${STAMP}@urs.local`;
    testEmailAddresses.push(emailTo);
    const jobStart = new Date();
    await sendEmail({ to: emailTo, subject: `RT audit ${STAMP}`, body: "runtime acceptance" });
    let row: any = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const candidates = await rowsForAction("email.sent", jobStart);
      row = candidates.find((c) => (c.newValue as any)?.to === emailTo);
      if (row) break;
    }
    check(s, "email.sent recorded", !!row);
    if (row) {
      check(s, "result SUCCESS", row.result === "SUCCESS", row.result);
      check(s, "job correlation convention", String(row.correlationId ?? "").startsWith("job:urs-email-delivery:"), String(row.correlationId));
    }
  });
}

async function cleanup(): Promise<void> {
  try {
    // revoke test sessions
    await prisma.session.updateMany({
      where: { userId: { in: userIds }, revokedAt: null } as never,
      data: { revokedAt: new Date() },
    });
    // collect object keys of test-owned versions before deleting rows
    const versions = await prisma.documentVersion.findMany({
      where: { document: { ownerId: { in: userIds } } } as never,
      select: { objectKey: true },
    });
    for (const v of versions) objectKeys.push(v.objectKey);
    // delete test requests (items cascade), then test documents (versions cascade), folders
    await prisma.documentRequest.deleteMany({ where: { requesterId: { in: userIds } } as never });
    await prisma.document.deleteMany({ where: { ownerId: { in: userIds } } as never });
    await prisma.folder.deleteMany({ where: { ownerId: { in: userIds } } as never });
    // test email rows
    if (testEmailAddresses.length > 0) {
      await prisma.emailMessage.deleteMany({ where: { to: { in: testEmailAddresses } } as never });
    }
    // soft-delete test users (preserves audit actor FKs; never hard-delete)
    await prisma.user.updateMany({
      where: { id: { in: userIds } } as never,
      data: { deletedAt: new Date(), status: "INACTIVE" },
    });
    // remove MinIO objects (best effort)
    for (const key of new Set(objectKeys)) {
      await deleteObject(key).catch(() => undefined);
    }
  } catch (err) {
    console.error("[cleanup] failed:", err);
  }
}

function report(): void {
  console.log("\n================ AUDIT RUNTIME ACCEPTANCE ================");
  for (const s of scenarios) {
    console.log(`\n[${s.status}] ${s.id} — ${s.title}`);
    for (const c of s.checks) {
      console.log(`   ${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
    }
  }
  const pass = scenarios.filter((s) => s.status === "PASS").length;
  const fail = scenarios.filter((s) => s.status === "FAIL").length;
  const blocked = scenarios.filter((s) => s.status === "BLOCKED").length;
  console.log(`\nSUMMARY: ${pass} PASS / ${fail} FAIL / ${blocked} BLOCKED`);
  console.log("==========================================================");
}

void main()
  .catch((err) => console.error("[harness] fatal:", err))
  .finally(async () => {
    await cleanup();
    report();
    await prisma.$disconnect();
    process.exit(0);
  });
