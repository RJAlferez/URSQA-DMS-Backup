# Technology stack

| Area | Verified implementation |
|---|---|
| Language | TypeScript; Node.js `>=20` is declared |
| Client | React `18.3.1`, React Router DOM `7.15.1`, Vite `5.3.1` |
| Styling | Tailwind CSS `3.4.4`, PostCSS, shared React primitives |
| UI libraries | Radix UI, Lucide React `0.400.0`, class-variance-authority, clsx, tailwind-merge, Recharts |
| Client utilities | `pdf-lib`, `tesseract.js` |
| Server | Express `4.21.1`, TypeScript `5.6.3`, tsx, Winston/Morgan |
| Data | Prisma and `@prisma/client` `5.22.0`; PostgreSQL (Compose uses `postgres:16-alpine`) |
| Object storage | MinIO client `8.0.1` (Compose uses `minio/minio`) |
| Queues/cache transport | ioredis `6`, BullMQ `6` (Compose uses Redis 7) |
| Security | argon2, jsonwebtoken `9`, cookie-parser, Helmet, CORS, express-rate-limit |
| Validation | Zod `3.23.8` |
| Email/media | Nodemailer, Sharp, ua-parser-js |
| Tests | Vitest `2.1.3` with V8 coverage; no committed client test runner |
| Static checks | ESLint; Prettier on the server; TypeScript builds/typechecks |

Versions are from committed package manifests and Compose configuration, not from the installed dependency tree.
