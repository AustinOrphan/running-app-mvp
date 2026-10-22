# Running log

Self-hosted training log and planner for one runner. Specs, the task plan and ADRs are under
`docs/`; where the design spec's section 7 differs from sections 1-6, section 7 wins.

## Commands

- `npm run check`: lint, `prettier --check .`, typecheck, tests. Must pass before every commit.
- `npm run build`: Vite build into `dist/web`, server compiled into `dist/server`.
- `npm run test:e2e`: Playwright (chromium) against the production build, on a fresh SQLite file
  that the config's `webServer` creates and migrates. Run `npm run build` first.
- `npm run dev`, `npm run db:migrate`, `npm run format`, `npm run reset-password -- <email>`.
- `npx prettier --check .` is the formatting gate in CI; run `npm run format` to fix it.

## Gates

CI (`.github/workflows/ci.yml`) runs `npm ci`, the chromium install, `npm run check`,
`npm run build` and `npm run test:e2e`, and uploads the Playwright report on failure. The Docker
image must still build (`docker build .`) after a change to dependencies or the `Dockerfile`; its
build runs `prisma migrate deploy` as a smoke test.

## Structure

- `server/` Express 5 API (`routes/` thin, `services/` logic, `auth/`), `shared/` pure domain code
  used by server and web, `web/` React SPA (`pages/`, `components/`, `api/` hooks), `prisma/`
  SQLite schema and committed migrations.
- `tests/unit`, `tests/api`, `tests/web` (Vitest) and `tests/e2e` (Playwright).

## Conventions

- Relative imports carry the `.ts` or `.tsx` extension. No path aliases.
- Import `PrismaClient` and the row types from `server/db.ts`, not from `@prisma/client` or
  `generated/`.
- Distance in metres, duration in seconds, plan targets in minutes, dates as `YYYY-MM-DD`
  strings in the runner's local day, weeks start Monday (ADR 0003).
- Server errors are thrown as `HttpError` (`server/errors.ts`) and reach the client as
  `{ error: { code, message, details? } }`. Zod parses every body and query.
- Server data hooks live in `web/api/<resource>.ts`; pages only consume them. Domain rules go in
  `shared/` as pure functions with unit tests.
- Targets are a sketch, not minimums: no red, no "behind" or "missed" copy, no streaks or badges.
- npm only. Strict TypeScript. Prettier formats, ESLint 9 flat config lints.
- Env vars are exactly `DATABASE_URL`, `SESSION_SECRET`, `PORT`, `NODE_ENV`, `ALLOW_REGISTRATION`
  and `LOG_LEVEL` (plus `TZ` as an OS setting in Docker).
- Migrations under `prisma/migrations` are committed; never ignore them.
- Packages that only the Vite build uses (react, recharts, fonts, router, query) are
  `devDependencies`, so the Docker image installs without them.

## Testing

- API tests use `tests/api/helpers.ts` (own SQLite file per context, seeded user and cookie).
- Page tests use `tests/web/helpers.tsx`; query by role and accessible name.
- E2E specs in `tests/e2e` drive the UI by role and label, use dates computed from the clock,
  and call `resetData()` and `signedInApi()` from `tests/e2e/helpers.ts` so each spec stands on
  its own. `01-auth.spec.ts` owns the empty database and must stay first. No sleeps; rely on
  auto-waiting assertions.

## Public repository

- No personal data in the repo: fixtures are synthetic, emails use `example.com`, no real names,
  race names or run history. Check a diff for this before every commit.
- Commit subjects are imperative with a conventional prefix (`feat`, `fix`, `test`, `docs`,
  `chore`, `refactor`), at most 72 characters. Comments, commits and ADRs avoid first and second
  person.
- Claude attribution never goes into commits or PRs: no `Co-Authored-By`, no session links, no
  "Generated with" lines.
