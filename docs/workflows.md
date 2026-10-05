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

## Audit flow

Route/service operations call `writeAudit` where implemented. Request context supplies actor/network/correlation context. Permission denials are security events. Audit readers/admins use the audit API; ROOT handles retention/archive/review operations.
