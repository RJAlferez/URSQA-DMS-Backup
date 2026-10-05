# Known issues and verification limits

## Confirmed

- The committed testing guide names nine `scripts/smoke-*.ps1` scripts, but committed `scripts/` contains no such files. Do not rely on those commands.
- The committed preview header contains Share and Fullscreen controls explicitly titled “not implemented”.
- The root `package.json` is not marked `type: module` while root PostCSS config uses module syntax; Node may emit module-type warnings depending on invocation.
- No committed frontend component-test or browser E2E test suite was found.

## Suspected

- The client’s access token is stored in `localStorage`; that increases the impact of a client-side script injection compared with a refresh-cookie-only design. This is an architectural security consideration, not a demonstrated exploit.
- Some route-level role-denial audit writes are fire-and-forget in the committed `requireRole` middleware, unlike awaited permission-denial writes. Delivery timing under process failure requires runtime verification.

## Not verified

- Existing reports of startup environment failures, test-launcher failures, or audit fixes come from uncommitted logs/changes and are excluded from this release baseline.
- Deployment behavior beyond committed Compose/Docker/deploy configuration is not verified against a running production environment.
- Remote navigation-assistant provider availability is not verified in the current repository.
