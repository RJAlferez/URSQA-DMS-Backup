# Testing and validation

## Declared commands

Run from repository root unless shown otherwise:

```powershell
npm run lint:client
npm run typecheck:client
npm run build:client
npm run lint:server
npm run typecheck:server
npm run build:server
npm --workspace server test
npm --workspace server run test:coverage
```

The server also declares `test:watch`, `format:check`, `prisma:generate`, `prisma:migrate`, `prisma:deploy`, `prisma:seed`, and `deepseek:smoke`. `scripts/lint.sh` runs server lint/Prettier/typecheck and client typecheck; it is a Bash script. `scripts/load-test.ps1` is present. The previously documented `scripts/smoke-*.ps1` files are not present in committed `main`.

## Tests

Vitest config includes `server/src/**/*.test.ts`/`*.spec.ts`, using `server/src/__tests__/setup.ts`. Committed tests cover RBAC, repository behavior, audit, navigation assistant, and AACCUP export. The configured test database defaults to the local `urs_dms` connection unless `DATABASE_URL` is supplied; integration tests can mutate test-prefixed records. Use a dedicated database when possible.

## Expectations

For UI work, run client lint/typecheck/build. For API work, run server lint/typecheck and focused Vitest tests before broader tests. Inspect `git diff` and verify no schema/configuration change was accidental. No committed browser E2E or client component-test framework was found.
