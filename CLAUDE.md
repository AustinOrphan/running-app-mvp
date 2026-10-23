# Running log

Self-hosted training log and planner for one runner. Specs, the task plan and ADRs are under
`docs/`; where the design spec's section 7 differs from sections 1-6, section 7 wins.

## Commands

- `npm run check`: lint, `prettier --check .`, typecheck, `research:check`, tests. Must pass before
  every commit.
- `npm run build`: Vite build into `dist/web`, server compiled into `dist/server`.
- `npm run test:e2e`: Playwright (chromium) against the production build, on a fresh SQLite file
  that the config's `webServer` creates and migrates. Run `npm run build` first.
- `npm run research:check` (offline corpus and citation check) and `npm run research:verify`
  (online, Crossref, by hand).
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
- `shared/engine/` is the training engine: pure, deterministic, no I/O. `research/` is the paper
  corpus and `engine-rules.md`; the project skill `research-update` covers changing either.
- `tests/unit`, `tests/api`, `tests/web` (Vitest) and `tests/e2e` (Playwright).

## Providers

- Every data source is one module in `server/providers/<key>.ts`, registered in
  `server/providers/registry.ts` with its `ProviderInfo` (key, label, channels, wellness,
  `experimental`). A provider implements only the channels it declares: `pull`, `push` or `upload`;
  `folder` has no module because the scheduler scans it. Adding a source means one module plus one
  registry entry.
- A provider returns `ParsedActivity` and `WellnessInput` values; it never writes to the database.
  `server/services/activityStore.ts` is the only writer of imported activities, and
  `server/services/sync.ts` drives pull providers.
- Network access goes only through `ctx.fetch`, never a global `fetch` or an HTTP client of its own,
  so tests inject synthetic responses and no test touches the network.
- Secrets (API keys, client secrets, tokens) are encrypted and decrypted only through
  `server/crypto.ts`, stored in `Integration.secret`, and never logged or returned by the API.
  Refreshed tokens are saved through `ctx.saveSecret`. No new environment variables.
- Files are parsed through `ctx.parseFile`, not by importing the parsers directly. Fixtures are
  synthetic; FIT test files are built with `tests/fixtures/fit/buildFit.ts`.

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
- Every number in `shared/engine/` is a `Param` from `shared/engine/params/`, with a grade, a rule
  id and cited paper ids that exist in `research/papers/`. A grade D value carries a note that
  says it is a default. A language model never chooses a session (ADR 0005).
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
  `signedInApi()` signs in with a minted session cookie once the account exists, because the
  sign-in route allows 10 attempts per window and the suite would exhaust it.
- The e2e server port is 3101 plus a per-checkout offset (`E2E_PORT` in `tests/e2e/env.ts`), so
  worktrees can run e2e at the same time. Never hard-code it; use `baseURL` or `E2E_PORT`. Print it
  with `node -e "import('./tests/e2e/env.ts').then((m) => console.log(m.E2E_PORT))"`.

## Public repository

- No personal data in the repo: fixtures are synthetic, emails use `example.com`, no real names,
  race names or run history. Check a diff for this before every commit.
- Commit subjects are imperative with a conventional prefix (`feat`, `fix`, `test`, `docs`,
  `chore`, `refactor`), at most 72 characters. Comments, commits and ADRs avoid first and second
  person.
- Claude attribution never goes into commits or PRs: no `Co-Authored-By`, no session links, no
  "Generated with" lines.
