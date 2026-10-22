# Running log

A self-hosted training log and planner for one runner: activities, goal races, a generated
weekly plan, weekly reviews, a dashboard and stats. One Node process serves the API and the
built web app; data lives in a single SQLite file.

Status: scaffold. Later tasks of `docs/superpowers/plans/2026-10-21-running-app-rewrite.md`
fill in the features, and the final task completes this file.

## Requirements

Node 24 (`.nvmrc`; `engines` allows 22 and newer) and npm.

## Run locally

```sh
npm install
npm run setup        # creates .env and fills SESSION_SECRET
npm run db:migrate   # applies the Prisma migrations
npm run dev          # API on :3001, web app on :5173
```

## Commands

| Command                             | Purpose                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `npm run check`                     | lint, typecheck and unit, API and component tests    |
| `npm run build`                     | build the web app and compile the server into `dist` |
| `npm start`                         | run the built server                                 |
| `npm run test:e2e`                  | Playwright golden paths (needs a build)              |
| `npm run db:migrate`                | apply migrations (`prisma migrate deploy`)           |
| `npm run reset-password -- <email>` | set a new password from the command line             |

## Configuration

Exactly these environment variables, read from the process environment or from `.env`:
`DATABASE_URL`, `SESSION_SECRET` (at least 32 characters), `PORT`, `NODE_ENV`,
`ALLOW_REGISTRATION` and `LOG_LEVEL`. See `.env.example`.

A relative `file:` `DATABASE_URL` resolves against the `prisma/` directory for both the Prisma
CLI and the client. Tests, e2e and Docker use absolute paths.

Rotating `SESSION_SECRET` signs the account out everywhere.

## Layout

- `server/`: Express app, auth, routes, services
- `shared/`: pure domain code used by server and web
- `web/`: React and Vite single-page app
- `prisma/`: schema and migrations; `prisma.config.ts` holds the CLI settings
- `generated/`: Prisma client, gitignored, written by `prisma generate` (the npm pre-scripts run it)
- `tests/`: unit, api, web and e2e
- `docs/`: design specs, plan and ADRs (`docs/adr/`)
