import type { Request, Response } from "express";
import { sendCreated, sendSuccess } from "@/utils/apiResponse";
import * as service from "@/modules/aaccup/submissions/aaccup.submissions.service";
import type {
  CreateSubmissionInput,
  ExportSubmissionsQuery,
  ListSubmissionsQuery,
  ReviewSubmissionInput,
  UnsubmitSubmissionInput,
  UpdateSubmissionInput,
} from "@/modules/aaccup/submissions/aaccup.submissions.validator";

// =============================================================================
// URS-DMS — AACCUP submission controller (thin)
// =============================================================================

function toActor(req: Request): service.Actor {
  return {
    id: req.auth!.userId,
    permissions: req.auth!.permissions,
    ipAddress: req.context.ipAddress,
    userAgent: req.context.userAgent,
  };
}

export async function listSubmissionsHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const query = req.query as unknown as ListSubmissionsQuery;
  const result = await service.listSubmissions(query, toActor(req));
  sendSuccess(res, result.items, 200, result.meta);
}

export async function getSubmissionHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params as { id: string };
  const submission = await service.getSubmission(id, toActor(req));
  sendSuccess(res, submission);
}

export async function createSubmissionHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const input = req.body as CreateSubmissionInput;
  const submission = await service.createSubmission(input, toActor(req));
  sendCreated(res, submission);
}

export async function updateSubmissionHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params as { id: string };
  const input = req.body as UpdateSubmissionInput;
  const submission = await service.updateSubmission(id, input, toActor(req));
  sendSuccess(res, submission);
}

export async function archiveSubmissionHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params as { id: string };
  const submission = await service.archiveSubmission(id, toActor(req));
  sendSuccess(res, submission);
}

export async function reviewSubmissionHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params as { id: string };
  const input = req.body as ReviewSubmissionInput;
  const submission = await service.reviewSubmission(id, input, toActor(req));
  sendSuccess(res, submission);
}

export async function unsubmitSubmissionHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params as { id: string };
  const input = req.body as UnsubmitSubmissionInput;
  const submission = await service.unsubmitSubmission(id, input, toActor(req));
  sendSuccess(res, submission);
}

export async function restoreSubmissionHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const { id } = req.params as { id: string };
  const submission = await service.restoreSubmission(id, toActor(req));
  sendSuccess(res, submission);
}

export async function exportSubmissionsZipHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const query = req.query as unknown as ExportSubmissionsQuery;
  const { filename, stream } = await service.exportApprovedSubmissionsZip(
    query.areaIds,
    query.areaSet,
    toActor(req),
  );
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  stream.on("error", () => {
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  stream.pipe(res);
}
