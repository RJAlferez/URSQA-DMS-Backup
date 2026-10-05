# URS-DMS agent guidance

## Project

URS-DMS is a React/Vite client and Express/Prisma API for university document, accreditation, workflow, and administration work. See `docs/README.md` for the release baseline and documentation index.

## Boundaries

- Keep UI code in `client/`; keep HTTP, authorization, persistence, storage, and jobs in `server/`.
- Use the existing controller/route/service/repository pattern. Do not bypass service authorization or audit paths.
- Prisma schema and migrations are database contracts. Do not change either without explicit authorization.

## Change rules

- Inspect the affected code and existing dirty changes before editing. Keep changes scoped; do not add mock data or invented features.
- Preserve the established Tailwind/shared-component design system in `client/src/components/ui`, `layout`, and `user`.
- Preserve `authenticate`, permission/role guards, ownership checks, and audit logging. Security-sensitive denials must remain protected.
- Use existing validation, error, storage, queue, and API helpers rather than parallel implementations.
- Run the narrowest relevant lint/typecheck/test/build command after changes, then review `git diff` before finishing.

## References

Read `docs/frontend.md`, `docs/backend.md`, `docs/authentication-rbac.md`, `docs/document-management.md`, `docs/audit-logging.md`, `docs/database.md`, and `docs/development-guide.md` before work in those areas. Commands and known limitations are in `docs/testing.md` and `docs/known-issues.md`.
