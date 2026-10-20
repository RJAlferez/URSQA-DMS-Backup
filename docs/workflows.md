# Workflows

## Authentication

1. A public login request is validated/rate-limited.
2. The auth service validates credentials/account state and creates session state.
3. The response supplies an access token; refresh state is an httpOnly cookie.
4. The client stores the access token, calls `/auth/me`, and protects shell routes.
5. On a 401, the shared client performs one refresh attempt; failure clears the token and signals logout.

## Document upload and access

1. An authenticated caller with the route permission asks the documents/files APIs for the upload flow.
2. The server validates metadata and returns/uses a signed `/files` upload token as implemented by the route/service.
3. The client uploads through the `/files` endpoint, which streams bytes to MinIO, then calls the applicable document finalization endpoint.
4. Document/version metadata is persisted; downstream audit/notification/thumbnail behavior is service/job dependent.
5. Download/preview and cross-user access are checked by the relevant service/route; folder/document shares and emergency repository access are distinct mechanisms.

## Folder lifecycle

Authorized callers create and update folders, manage shares, and may move/copy/ZIP according to the folder router/service. Deleted and restore/permanent-delete views are present in the router. Copy/ZIP work can be represented by repository/job models and workers.

## Requests and AACCUP

Document requests expose creation plus management actions under `request.create`/`request.manage`. AACCUP area, requirement, submission, and task routers expose the respective creation, review, archive/restore, and analytics operations; exact state transitions are validator/service-defined and must not be inferred from UI labels alone.

## Unsubmit and resubmit task evidence

- My Tasks shows each caller's latest evidence and review status. Unsubmit is
  available for pending, approved, and returned work owned by that caller.
- Unsubmit retains evidence and review history, removes it from current approved
  evidence, and reopens the linked task. Cancelled tasks remain cancelled.
- Resubmit Evidence creates a new pending submission and a fresh workflow instance.
  Previous approval never carries to the replacement. Approval completes its task.
  Concurrent review/withdrawal conflicts require a refresh.
- Reviewers receive a bell notification and one immediate queued email for each
  unsubmission or resubmission, including names and task/accreditation context.
  These workflow alerts bypass digest delivery schedules.

## Action receipts

Authenticated changes and existing success/error popups produce per-user receipts
in the notification bell and immediate email queue, including failed uploads.
Internal upload preparation, polling, session refresh, and notification maintenance
do not create recursive receipts. Popups appear immediately. Receipt delivery
retries after network failure or reconnection, with up to 100 unsent receipts
retained in browser storage for that account.

The authenticated receipt API always targets the caller's inbox and labels the
outcome as client-reported in metadata. It never accepts a recipient ID. Email
content is escaped; actual delivery depends on the configured SMTP provider.

## Audit flow

Route/service operations call `writeAudit` where implemented. Request context supplies actor/network/correlation context. Permission denials are security events. Audit readers/admins use the audit API; ROOT handles retention/archive/review operations.
