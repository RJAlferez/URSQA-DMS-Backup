# URS-DMS documentation

## Release baseline

This documentation describes committed `main` at `9d8208c344e55d03cc514453a3ce9db6cfb0f6bb` (10 September 2026), package version `1.5.0`. It intentionally excludes the uncommitted working-tree changes present when this set was generated.

URS-DMS is a university document-management system with authenticated user and administrator workspaces, accreditation (AACCUP) work, configurable organization/folder/requirement/workflow/form engines, audit records, and object-backed document storage.

## Major modules

- Identity, sessions, registration, password reset, users, roles, permissions, notifications, and audit.
- Documents, folders, shares, requests, personal repositories, and file-object upload/download endpoints.
- AACCUP areas, requirements, submissions, tasks, and analytics.
- Root-only configuration, organization, folder, requirement, workflow, form, and setup surfaces.
- Dashboards, analytics, reports, maintenance, email, and navigation assistant support.

## Documentation index

- [Architecture](architecture.md), [technology stack](tech-stack.md), [project structure](project-structure.md)
- [Frontend](frontend.md), [backend](backend.md), [database](database.md), [API reference](api-reference.md)
- [Authentication and RBAC](authentication-rbac.md), [document management](document-management.md), [audit logging](audit-logging.md), [workflows](workflows.md)
- [UI guidelines](ui-guidelines.md), [configuration](configuration.md), [Root Console manual](ROOT_CONSOLE_MANUAL.md), [testing](testing.md), [known issues](known-issues.md), [development guide](development-guide.md)
- [Source backup and future updates](BACKUP_AND_UPDATES.md)

## Development notes

The repository has a root package and a separate `client` package; only `server` is declared as a root npm workspace. Development needs PostgreSQL, MinIO, and Redis for the complete stack. Do not treat older documents as authoritative when they disagree with the code named in this set.
