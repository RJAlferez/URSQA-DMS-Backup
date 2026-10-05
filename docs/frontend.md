# Frontend

## Structure and routing

`client/src/main.tsx` renders `App` inside an error boundary. `App.tsx` supplies browser routing, theme and auth providers, protected-route decisions, and separate administrator/root and user shells. Public routes include login, registration, forgotten-password, and reset-password pages. Administrator routes cover dashboard, documents/repository, submissions, requests, users, audit, settings, notifications, AACCUP/ISO, and root pages. Non-administrators use `/user/*` with user dashboard, documents, requests, archive browsing, AACCUP, notifications, activity, profile, and settings views.

Route visibility is a client-side convenience. Backend authorization remains authoritative.

## State and API communication

`AuthContext` subscribes to `authService` and exposes current user/authentication state. Domain API calls live in `client/src/services/`; `client/src/lib/http.ts` is the common JSON client. It sends a locally stored access token as `Authorization: Bearer`, sends cookies, performs a single-flight `/auth/refresh` retry after a 401, and dispatches a session-expired browser event on refresh failure.

No general-purpose state-store dependency is declared. Pages use React state/effects and service calls.

## Major UI areas

- Shared primitives: `components/ui` (buttons, cards, tables, badges, inputs, dialogs, dropdowns, selectors, pagination, states, and guards).
- Admin shell: `components/layout` sidebar, top navigation, page headers, chart/stat cards, command palette, and mobile navigation.
- User shell: `components/user` navigation and user-oriented pages.
- Domain components: repository, preview, AACCUP, auth, modals, and navigation assistant.

## Conventions

Use the existing service layer rather than direct `fetch` in page code unless extending the common transport. Use `RoleGuard` and permission helpers only for presentation; retain matching API protection. Reuse shared primitives and semantic badge variants. Current theme support is class-based Tailwind dark mode; individual page support should be checked before assuming all screens are dark-mode complete.
