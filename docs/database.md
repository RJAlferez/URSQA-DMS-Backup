# Database

## Configuration and migrations

Prisma is configured for PostgreSQL through `DATABASE_URL`. The committed schema is `server/prisma/schema.prisma`; ordered SQL migrations are under `server/prisma/migrations`. Run neither migration nor seed commands against a database without explicit authorization.

## Core identity and auditing

- `Role`, `Permission`, and join model `RolePermission` define database-backed RBAC.
- `User` has unique employee ID/email, a role, optional department/program, account status/lockout fields, soft-delete timestamp, profile photo key, and relations to owned records.
- `Session` stores refresh-token/session state; `PasswordResetToken` and `RegistrationInvite` support recovery/onboarding.
- `AuditLog`, `AuditArchive`, and `AuditReview` support activity history, archive metadata, and review state.

## Documents and requests

- `Department`, `Folder`, `FolderShare`, `Document`, `DocumentVersion`, `DocumentTag`, and `DocumentShare` represent organization, ownership, sharing, versioned documents, tags, and object metadata.
- `DocumentRequest` and `DocumentRequestItem` represent document-access requests and their requested items.
- `Repository`, `RepositoryFavorite`, `RepositoryRecent`, `RepositoryPin`, `RepositoryCopyJob`, and `EmergencyAccess` support personal repository views, copy jobs, and elevated access grants.

## Accreditation, organization, and configurable engines

- AACCUP: `AaccupArea`, `AaccupRequirement`, `AaccupSubmission`, and `AaccupTask`.
- Notifications/email: `Notification` and `EmailMessage`.
- Organization: `Campus`, `College`, `Office`, `Program`, `OrganizationVersion`.
- Root configuration: `SystemSetting`, `ConfigurationCategory`, `Configuration`, `ConfigurationVersion`, `ConfigurationHistory`.
- Folder builder: `FolderTemplate`, `FolderNode`, `FolderAssignment`, `FolderVersion`, `FolderHistory`.
- Requirement builder: `AccreditationCycle`, `RequirementTemplate`, `RequirementNode`, `RequirementValidation`, `RequirementAssignment`, `RequirementVersion`, `RequirementHistory`.
- Workflow: `WorkflowDefinition`, `WorkflowStep`, `WorkflowTransition`, `WorkflowAssignment`, `WorkflowVersion`, `WorkflowHistory`, `WorkflowInstance`, `WorkflowStepInstance`, `WorkflowAction`.
- Forms/setup/maintenance: `FormTemplate`, `FormField`, `FormAssignment`, `FormVersion`, `FormHistory`, `SetupState`, `MaintenanceJob`, `MaintenanceOrphanCandidate`, `MaintenanceLock`.

## Enums and integrity

The schema defines enums for user/role, document/share/request, AACCUP, notification/email, configuration, organization, folder/requirement/workflow/form, repository-copy, and setup states. Relationships and `onDelete` actions are declared in the schema; use the schema rather than this summary for field-level or index-level changes. Examples of explicit constraints include unique `Role.name`, `Permission.code`, `User.email`, `User.employeeId`, the composite `RolePermission` key, and owner/item uniqueness for repository favorites/recents/pins.

Soft deletion is represented by `deletedAt` on several domain models; it is not a database-wide rule.
