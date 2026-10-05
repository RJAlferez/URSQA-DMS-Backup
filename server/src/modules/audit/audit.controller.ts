import type { Request, Response } from "express";
import { sendSuccess } from "@/utils/apiResponse";
import { NotFoundError } from "@/utils/errors";
import * as service from "@/modules/audit/audit.service";
import type {
  ExportAuditQuery,
  ListAuditQuery,
  ArchiveAuditQuery,
  PurgeAuditQuery,
  MyActivityQuery,
  RetentionConfigQuery,
} from "@/modules/audit/audit.validator";
import type { AuditLogListItem } from "@/modules/audit/audit.types";

export async function listAuditHandler(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ListAuditQuery;
  const result = await service.listAudit(q);
  const scoped = service.scopeIpVisibility(result.items, req.auth!.roleName, null);
  sendSuccess(res, scoped, 200, result.meta);
}

export async function getAuditHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const detail = await service.getAudit(id);
  sendSuccess(res, detail);
}

export async function exportAuditHandler(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ExportAuditQuery;
  const { items, format } = await service.exportAudit(q);

  await service.logAuditExport(
    req.auth!.userId,
    format,
    items.length,
    req.context.ipAddress,
    req.context.userAgent,
  );

  if (format === "csv") {
    const csv = toCsv(items);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-export-${new Date().toISOString().slice(0, 19)}.csv"`,
    );
    res.status(200).send(csv);
    return;
  }

  if (format === "pdf") {
    const html = toPdfHtml(items, q);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-report-${new Date().toISOString().slice(0, 19)}.html"`,
    );
    res.status(200).send(html);
    return;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="audit-export-${new Date().toISOString().slice(0, 19)}.json"`,
  );
  res.status(200).json(items);
}

export async function clearAuditHandler(req: Request, res: Response): Promise<void> {
  const cleared = await service.clearAuditLogs(
    req.auth?.userId,
    req.context.ipAddress,
    req.context.userAgent,
  );
  sendSuccess(res, { cleared });
}

export async function myActivityHandler(req: Request, res: Response): Promise<void> {
  const userId = req.auth!.userId;
  const q = req.query as unknown as MyActivityQuery;
  const result = await service.listMyActivity12m(userId, q);
  const scoped = service.scopeIpVisibility(result.items, req.auth!.roleName, null);
  sendSuccess(res, scoped, 200, result.meta);
}

export async function archiveAuditHandler(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as ArchiveAuditQuery;
  const archive = await service.archiveAudit(
    q,
    req.auth!.userId,
    req.context.ipAddress,
    req.context.userAgent,
  );
  sendSuccess(res, archive);
}

export async function purgeAuditHandler(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as PurgeAuditQuery;
  const result = await service.purgeAuditLogs(
    q,
    req.auth!.userId,
    req.context.ipAddress,
    req.context.userAgent,
  );
  sendSuccess(res, result);
}

export async function getRetentionHandler(_req: Request, res: Response): Promise<void> {
  const config = await service.getRetentionConfig();
  sendSuccess(res, config);
}

export async function setRetentionHandler(req: Request, res: Response): Promise<void> {
  const { retentionYears } = req.query as unknown as RetentionConfigQuery;
  await service.setRetentionConfig(
    retentionYears,
    req.auth!.userId,
    req.context.ipAddress,
    req.context.userAgent,
  );
  sendSuccess(res, { retentionYears });
}

export async function listArchivesHandler(_req: Request, res: Response): Promise<void> {
  const archives = await service.listArchives();
  sendSuccess(res, archives);
}

export async function getReviewHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const review = await service.getReview(id);
  sendSuccess(res, review);
}

export async function upsertReviewHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const data = req.query as unknown as import("@/modules/audit/audit.validator").ReviewUpdateQuery;
  const review = await service.upsertReview(
    id,
    req.auth!.userId,
    req.context.ipAddress,
    req.context.userAgent,
    { status: data.status, note: data.note },
  );
  sendSuccess(res, review);
}

export async function getSummaryHandler(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as import("@/modules/audit/audit.validator").SummaryQuery;
  const summary = await service.getAuditSummary(q.days);
  sendSuccess(res, summary);
}

export async function getLoginGroupsHandler(req: Request, res: Response): Promise<void> {
  const q = req.query as unknown as import("@/modules/audit/audit.validator").LoginGroupsQuery;
  const groups = await service.getLoginGroups(q);
  sendSuccess(res, groups);
}

export async function downloadArchiveHandler(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const archive = await service.getArchiveForDownload(id);
  if (!archive) throw new NotFoundError("Archive not found");

  await service.logArchiveDownload(
    id,
    req.auth!.userId,
    req.context.ipAddress,
    req.context.userAgent,
  );

  const ids = await import("@/modules/audit/audit.repository")
    .then((m) => m.findIdsByDateRange(archive.dateRangeFrom, archive.dateRangeTo));
  const items = await import("@/modules/audit/audit.repository")
    .then((m) => m.findManyByIds(ids));

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="audit-archive-${id.slice(0, 8)}.json"`,
  );
  res.status(200).json({ archive, items });
}

export async function getPresetsHandler(_req: Request, res: Response): Promise<void> {
  const presets = service.getAuditPresets();
  sendSuccess(res, presets);
}

// =============================================================================
// CSV
// =============================================================================

const CSV_HEADERS = [
  "id", "timestamp", "action", "category", "severity", "result",
  "module", "status", "userId", "userName", "userEmail", "userRole",
  "actorName", "actorRole", "actorOrganization",
  "targetType", "targetId", "targetName",
  "entityType", "entityId", "ipAddress", "correlationId",
] as const;

function toCsv(items: AuditLogListItem[]): string {
  const rows: string[] = [CSV_HEADERS.join(",")];
  for (const it of items) {
    const fields = [
      it.id,
      it.timestamp.toISOString(),
      it.action,
      it.category,
      it.severity,
      it.result,
      it.module,
      it.status,
      it.user.id ?? "",
      it.user.name ?? "",
      it.user.email ?? "",
      it.user.role ?? "",
      it.actorName ?? "",
      it.actorRole ?? "",
      it.actorOrganization ?? "",
      it.targetType ?? "",
      it.targetId ?? "",
      it.targetName ?? "",
      it.entity.type ?? "",
      it.entity.id ?? "",
      it.ipAddress ?? "",
      it.correlationId ?? "",
    ];
    rows.push(fields.map(csvEscape).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

function csvEscape(v: string): string {
  // Neutralize spreadsheet formula injection (=, +, -, @, tab, CR) before
  // quoting. Titles and names are user-controlled and end up in Excel.
  const value = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// =============================================================================
// PDF (HTML-based report)
// =============================================================================

const LABELS: Record<string, string> = {
  "auth.login.success": "Login Success",
  "auth.login.failed": "Login Failed",
  "auth.logout": "Logout",
  "auth.permission_denied": "Permission Denied",
  "auth.password_reset.completed": "Password Reset Completed",
  "auth.password_reset.requested": "Password Reset Requested",
  "auth.password_reset.failed": "Password Reset Failed",
};

function labelForAction(action: string): string {
  for (const [key, label] of Object.entries(LABELS)) {
    if (action === key) return label;
  }
  return action
    .split(".")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const SEVERITY_COLORS: Record<string, string> = {
  INFO: "#10B981",
  WARNING: "#F59E0B",
  CRITICAL: "#EF4444",
};

const RESULT_COLORS: Record<string, string> = {
  SUCCESS: "#10B981",
  FAILED: "#EF4444",
  DENIED: "#F59E0B",
};

function toPdfHtml(items: AuditLogListItem[], q: ExportAuditQuery): string {
  const now = new Date().toISOString().slice(0, 19);
  const filterSummary = [
    q.from ? `From: ${q.from.toISOString()}` : "",
    q.to ? `To: ${q.to.toISOString()}` : "",
    q.category ? `Category: ${q.category}` : "",
    q.severity ? `Severity: ${q.severity}` : "",
    q.result ? `Result: ${q.result}` : "",
    q.module ? `Module: ${q.module}` : "",
    q.q ? `Search: "${q.q}"` : "",
  ].filter(Boolean).join(" | ") || "None";

  const rows = items.map((it) => `
    <tr>
      <td>${escapeHtml(it.timestamp.toISOString().slice(0, 19).replace("T", " "))}</td>
      <td>${escapeHtml(it.actorName || it.user.name || "—")}</td>
      <td>${escapeHtml(it.user.role || "—")}</td>
      <td>${escapeHtml(labelForAction(it.action))}</td>
      <td>${escapeHtml(it.category)}</td>
      <td>${escapeHtml(it.targetName || it.entity.type || "—")}</td>
      <td style="color:${RESULT_COLORS[it.result] || '#111'}">${escapeHtml(it.result)}</td>
      <td style="color:${SEVERITY_COLORS[it.severity] || '#111'}">${escapeHtml(it.severity)}</td>
      <td>${escapeHtml(it.ipAddress || "—")}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>URS-DMS Audit Log Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111; padding: 40px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 22px; margin-bottom: 4px; color: #2563EB; }
    .subtitle { color: #6B7280; font-size: 13px; margin-bottom: 24px; }
    .meta { background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 16px; margin-bottom: 24px; font-size: 13px; }
    .meta strong { color: #374151; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { background: #F3F4F6; text-align: left; padding: 8px 10px; font-weight: 600; border-bottom: 2px solid #D1D5DB; white-space: nowrap; }
    td { padding: 7px 10px; border-bottom: 1px solid #E5E7EB; }
    tr:nth-child(even) { background: #F9FAFB; }
    .footer { margin-top: 24px; font-size: 11px; color: #9CA3AF; text-align: center; }
  </style>
</head>
<body>
  <h1>URS-DMS — Audit Log Report</h1>
  <p class="subtitle">Generated ${now} | ${items.length} records</p>
  <div class="meta">
    <strong>Generated:</strong> ${now}<br>
    <strong>Filters:</strong> ${escapeHtml(filterSummary)}<br>
    <strong>Records:</strong> ${items.length}
  </div>
  <table>
    <thead>
      <tr>
        <th>Timestamp</th>
        <th>Actor</th>
        <th>Role</th>
        <th>Action</th>
        <th>Category</th>
        <th>Target</th>
        <th>Result</th>
        <th>Severity</th>
        <th>IP</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p class="footer">URS-DMS Audit Log Report &mdash; Generated ${now}</p>
</body>
</html>`;
}
