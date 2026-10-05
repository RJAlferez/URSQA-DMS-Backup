# Audit logging

## Architecture

Audit records are persisted in `AuditLog` through `modules/audit/audit.service.ts` and repository helpers. Callers provide action, actor/user, entity/id, request context, values, category, severity, and result as applicable. Request context contributes client IP, user agent, and correlation/request identifiers.

## Events and security

The constants module defines action names used across modules. Authentication, document/folder/request/workflow/admin actions, and security checks call audit services where implemented. `requirePermission` and `requireAnyPermission` await a `PERMISSION_DENIED` security event before returning a denial; the committed `requireRole` guard starts the corresponding write without awaiting it.

Audit records are database data, not an external log stream. Application logging is separately handled by Winston/Morgan.

## API and UI support

The audit router supports list/detail, export, summary, presets, login groups, user-scoped activity, and ROOT-only retention, archives, archive download, archival, purge, review, and clear operations. Routes use authentication plus the role/permission requirements declared in `audit.routes.ts`. The UI contains admin audit pages and a root audit page.

## Retention

Retention/archive/purge behavior is implemented behind ROOT-only routes and models `AuditArchive`/`AuditReview`. The exact selection criteria and request schemas must be read from `audit.validator.ts` and service code before operational use. No claim of immutable database enforcement is made by this documentation.
