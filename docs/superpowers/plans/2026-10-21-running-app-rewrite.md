# Running App Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `running-app-mvp` code with a small, self-hosted training log and planner for one runner: activities, goal races, a generated weekly plan, weekly reviews, a dashboard and stats.

**Architecture:** One npm package, one production process: an Express 5 API that also serves the built React SPA. SQLite through Prisma. All domain rules are pure functions in `shared/` (unit-tested, used by server and web); `server/` owns auth, validation and persistence; `web/` is a Vite + React 18 SPA with TanStack Query.

**Tech Stack:** Node 24 (`engines` `>=22`), TypeScript strict, Express 5, Prisma 7 + SQLite (better-sqlite3 driver adapter), zod, bcryptjs, jsonwebtoken, pino (no upload library: imports post CSV text as JSON); React 18, react-router-dom 6, TanStack Query 5, recharts, CSS modules, `@fontsource-variable/*`; Vitest (two projects), supertest, Testing Library, Playwright (chromium); ESLint 9 flat config, Prettier; GitHub Actions; Docker (`node:24-slim`).

**Spec:** `docs/superpowers/specs/2026-10-21-running-app-rewrite-design.md` (section 7 refines sections 1-6; where they differ, section 7 wins) and `docs/superpowers/specs/2026-10-21-visual-design.md` (tokens, layout, components, charts, copy tone). Executors read both.

## Global Constraints

- Public repository: no personal data in code, fixtures, docs or commits. Every fixture is synthetic; emails use `example.com`; no real names, race names or run history.
- Node 24 locally (`.nvmrc` = `24`), `engines.node` `>=22`. npm only. Strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), ESLint 9 flat config with typescript-eslint and react-hooks, Prettier. No `postinstall`.
- Distance is stored in **metres (Int)**, duration in **seconds (Int)**, plan targets in **minutes (Int)**. Display units follow the user setting (default `mi`; `km` supported). Hours are shown with one decimal, minutes as integers.
- Dates are `YYYY-MM-DD` strings in the runner's local day, with optional `startTime` `HH:MM`. Never use a UTC-midnight `DateTime` for a date. Weeks start Monday; the week key is the Monday's date string.
- Auth: single account; httpOnly, SameSite=Lax cookie holding a signed JWT valid **30 days**; bcrypt cost **12**; password minimum **12** characters; login limited to **10 attempts per 15 minutes per IP** (in memory); mutating requests need a matching `Origin` or `Sec-Fetch-Site: same-origin`; no localStorage tokens.
- Error wire shape: `{ error: { code: 'validation'|'unauthorized'|'not_found'|'conflict'|'internal', message: string, details?: unknown } }`. Zod on every body and query. Request id header `X-Request-Id`.
- Env vars are exactly: `DATABASE_URL` (default `file:./data/app.db`), `SESSION_SECRET` (>=32 chars), `PORT` (3001), `NODE_ENV`, `ALLOW_REGISTRATION` (false), `LOG_LEVEL`. Nothing else.
- Suggestions never change a target by themselves. The plan never makes up missed volume. Unparseable import rows are reported, never silently dropped. Targets are "a sketch, not minimums": no red, no "behind"/"missed" copy, no streak flames or badges (visual design doc, sections 1 and 6).
- Imports between source files are relative and carry the `.ts`/`.tsx` extension (`import { x } from '../shared/dates.ts'`); `tsc` rewrites them on emit (`rewriteRelativeImportExtensions`). No path aliases.
- Commit messages: imperative subject, at most 72 characters, conventional prefix (`feat`, `fix`, `test`, `docs`, `chore`), no attribution trailers of any kind. Commit messages, code comments and ADRs contain no "I", "we", "you" or "the user".
- Every task ends with `npm run check` (lint + typecheck + test) passing in its own worktree, and with a commit. No task adds a dependency (Task 1 installs all of them) or touches a file outside its own **Files** list.

## Execution model

Tasks inside a group run in parallel, each in its own worktree branched from `rewrite/v2` after the previous group merged. File sets within a group are disjoint, so merges are conflict-free. Shared touchpoints (`server/app.ts` registration, `web/App.tsx` routes, `web/api/client.ts`, `package.json`, the test helpers) are completed in Task 1 or Task 12 and not edited later. Group order: 0 (Task 1) -> A (2-6) -> B (7-11) -> C0 (12) -> C (13-17) -> D (18).

Three deviations from the requested split, each forced by the parallelism rule:

1. `server/auth/session.ts` and `server/auth/middleware.ts` are written in Task 1 (not Task 7). Every Group B test needs an authenticated request, and the Group B worktrees cannot wait for Task 7. Task 7 owns the credential flow (password, rate limit, routes, reset script) and the tests that pin session and middleware behaviour; it may edit those two files only to fix a defect its tests expose.
2. Task 12 also writes every `web/api/<resource>.ts` hooks file (Task 1 writes only `useMe` and `useSetupStatus` in `auth.ts`). Dashboard (Task 17) needs hooks for resources whose pages belong to Tasks 14-16; one owner for all hook files avoids cross-task edits. Group C tasks only consume them.
3. Task 1 adds test helpers (`tests/api/helpers.ts`, `tests/factories.ts`, `tests/web/helpers.tsx`, `tests/web/setup.ts`, `tests/globalSetup.ts`), `server/serialize.ts` and `web/pages/MorePage.tsx`, none of which is in the requested file list. Parallel tasks share them, so they must exist before the groups start.

## Shared contract

### Anchors

These signatures are the source of truth; "exactly as in the anchors" in a task means this block. Task 1 writes the types into `shared/types.ts` and implements `dates.ts` and `units.ts`; Group A tasks implement the rest in the files named.

```ts
// shared/types.ts
export type ActivityType = 'run' | 'race' | 'strength' | 'cross'
export type ActivitySource = 'manual' | 'smashrun' | 'csv'
export type DuplicateStatus = 'none' | 'possible' | 'confirmed' | 'dismissed'
export interface Activity { id: string; userId: string; date: string; startTime: string | null; type: ActivityType; durationSec: number; distanceM: number | null; rpe: number | null; avgHr: number | null; maxHr: number | null; elevationGainM: number | null; notes: string | null; source: ActivitySource; providerKey: string | null; importBatchId: string | null; duplicateOfId: string | null; duplicateStatus: DuplicateStatus; createdAt: string; updatedAt: string }
export interface WeekRow { weekStart: string; runMin: number; runM: number; runSessions: number; runDays: number; strengthSessions: number; crossMin: number; raceMin: number; longestRunMin: number; longRunShare: number | null; avg4wRunMin: number; streak3Plus: number }
export type Phase = 'restart' | 'base1' | 'base2' | 'endurance' | 'specific' | 'peak' | 'taper' | 'race'
export type DistanceClass = 'short' | 'half' | 'marathon' | 'ultra50' | 'ultra100'
export type TargetSource = 'baseline' | 'review' | 'override'
export interface PlanWeek { id: string; planId: string; weekStart: string; index: number; phase: Phase; focus: string | null; baselineRunMin: number; targetRunMin: number; targetSource: TargetSource; longRunMin: number; day2Min: number | null; runDays: number; strengthSessions: number; overrideNote: string | null; updatedAt: string }
export type DataStatus = 'unconfirmed' | 'complete' | 'missing'
export type Symptoms = 'none' | 'mild' | 'persistent'
export type SuggestedAction = 'upcoming' | 'in_progress' | 'await_data' | 'review_duplicates' | 'reduce' | 'repeat' | 'needs_recovery_review' | 'hold' | 'progress'
export interface WeeklyReview { id: string; userId: string; weekStart: string; dataStatus: DataStatus; fatigue: number | null; symptoms: Symptoms | null; recoveryConstrained: boolean; suggestedAction: SuggestedAction | null; suggestedReason: string | null; suggestedNextMin: number | null; finalDecision: string | null; finalNextMin: number | null; notes: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string }

// shared/dates.ts (all take and return YYYY-MM-DD strings; invalid input throws RangeError)
mondayOf(date: string): string; addDays(date: string, days: number): string; todayIso(now?: Date): string
weekStartsBetween(from: string, to: string): string[]   // Mondays from mondayOf(from) to mondayOf(to) inclusive; [] when from > to
daysLeftInWeek(date: string): number                    // through Sunday, including the date: Monday 7, Sunday 1

// shared/units.ts
milesToM(mi: number): number; mToMiles(m: number): number; kmToM(km: number): number; mToKm(m: number): number
formatDuration(sec: number): string; formatPace(durationSec: number, distanceM: number, units: Units): string
formatDistance(distanceM: number, units: Units): string; minutesToHours1(min: number): string

// shared/domain/plan.ts (Task 3)
export interface GeneratePlanInput { startDate: string; raceDate: string; distanceClass: DistanceClass; baselineRunMin: number; strengthPreference: 0 | 1 | 2 }
export type PlanWeekInput = Pick<PlanWeek, 'weekStart' | 'index' | 'phase' | 'baselineRunMin' | 'longRunMin' | 'day2Min' | 'runDays' | 'strengthSessions'> & { focus: string }

// shared/domain/review.ts (Task 4)
export interface SuggestInput { today: string; weekStart: string; phase: Phase; targetRunMin: number; baselineRunMin: number; nextBaselineMin: number | null; week: WeekRow; review: Pick<WeeklyReview, 'dataStatus' | 'fatigue' | 'symptoms' | 'recoveryConstrained'> | null; hasPossibleDuplicates: boolean }
export interface Suggestion { action: SuggestedAction; reason: string; suggestedNextMin: number | null }

// shared/domain/stats.ts (Task 5)
export interface FastestEffort { label: string; targetM: number; activityId: string; date: string; distanceM: number; durationSec: number; paceSecPerKm: number }
export interface PeriodTotal { runMin: number; runM: number; runs: number; longestRunMin: number }
fastestEfforts(activities: Activity[]): FastestEffort[]
monthlyTotals(activities: Activity[]): Array<PeriodTotal & { month: string }>   // 'YYYY-MM', ascending
yearlyTotals(activities: Activity[]): Array<PeriodTotal & { year: string }>     // 'YYYY', ascending

// shared/importers/*.ts and shared/domain/duplicates.ts (Task 6)
export interface ImportRow { providerKey: string; date: string; startTime: string | null; durationSec: number; distanceM: number; avgHr: number | null; maxHr: number | null; elevationGainM: number | null; notes: string | null }
export interface RowError { line: number; reason: string }
parseCsv(text: string): string[][]
parseGenericCsv(text: string): { rows: ImportRow[]; errors: RowError[] }
findPossibleDuplicate(candidate: Activity, sameDayRuns: Activity[]): Activity | null
```

Types added to `shared/types.ts` in Task 1, beyond the anchors:

```ts
export type Units = 'mi' | 'km'
export interface UserSettings { email: string; displayName: string | null; units: Units }
export interface SessionUser extends UserSettings { id: string }
export type GoalPriority = 'A' | 'B' | 'C'
export type GoalStatus = 'target' | 'considering' | 'done' | 'dropped'
export interface Goal { id: string; userId: string; name: string; priority: GoalPriority; status: GoalStatus; targetDate: string; dateProvisional: boolean; distanceM: number | null; location: string | null; successCriteria: string | null; notes: string | null; url: string | null; isActive: boolean; createdAt: string; updatedAt: string }
export interface Plan { id: string; userId: string; goalId: string; name: string; startDate: string; raceWeekStart: string; status: 'active' | 'archived'; generatorVersion: number; createdAt: string; updatedAt: string }
export interface PlanWithWeeks extends Plan { weeks: PlanWeek[] }
export interface ImportReportRow { line: number | null; reason: string }   // line null: skipped duplicate (ImportRow carries no line)
export interface ImportBatch { id: string; userId: string; source: ActivitySource; fileName: string | null; rowCount: number; accepted: number; skippedDuplicate: number; skippedInvalid: number; errors: ImportReportRow[]; createdAt: string }
export type ApiErrorCode = 'validation' | 'unauthorized' | 'not_found' | 'conflict' | 'internal'
export interface ValidationIssue { path: string; message: string }          // validation details: { issues: ValidationIssue[] }
export interface ApiErrorBody { error: { code: ApiErrorCode; message: string; details?: unknown } }
```

Endpoints (all JSON under `/api`; every route except those marked *public* requires the session cookie; bare objects and arrays, no wrappers; distances in metres):

| Method and path | Body / query | Response |
| --- | --- | --- |
| `GET /health` *public* | | `{status:'ok'}` |
| `GET /setup` *public* | | `{needsSetup:boolean}` |
| `POST /setup` *public* | `{email, password, displayName?}` | 201 `SessionUser` + cookie; 409 `conflict` when a user exists and `ALLOW_REGISTRATION` is false |
| `POST /auth/login` *public* | `{email, password}` | `SessionUser` + cookie; 401 generic message; 429 `unauthorized` |
| `POST /auth/logout` | | 204, cookie cleared |
| `GET /auth/me` | | `SessionUser` or 401 |
| `GET /settings`, `PUT /settings` | `{units?, displayName?}` | `UserSettings` |
| `GET /activities?from&to&type` | inclusive dates; newest first | `Activity[]` (flagged duplicates included) |
| `POST /activities`, `PUT /activities/:id` | `{date, startTime?, type, durationSec, distanceM?, rpe?, avgHr?, maxHr?, elevationGainM?, notes?}` | `Activity` (201 on create) |
| `GET /activities/:id`, `DELETE /activities/:id` | | `Activity`, 204 |
| `POST /activities/:id/duplicate` | `{status:'confirmed'\|'dismissed'}` | `Activity`; 409 when the row is not flagged |
| `GET /activities/export.csv` | | `text/csv` attachment |
| `POST /imports/smashrun`, `POST /imports/csv` | JSON (not multipart; no upload library): `{ fileName, text, distanceUnit? }` where `text` is the whole CSV file; `distanceUnit` (`mi`\|`km`, default the user's units) is read by smashrun only; body at most 10 MB | 201 `ImportBatch` |
| `GET /imports` | | `ImportBatch[]` newest first |
| `GET /goals`, `POST /goals`, `GET/PUT/DELETE /goals/:id` | `{name, priority, status, targetDate, dateProvisional, distanceM?, location?, successCriteria?, notes?, url?}` | `Goal[]`, `Goal`, 204 |
| `POST /goals/:id/activate` | | `Goal` (all others deactivated) |
| `GET /plan` | | `PlanWithWeeks` or `null` |
| `POST /plan/generate` | `{goalId, baselineRunMin?, startDate?, strengthPreference?(0\|1\|2, default 2)}` | 201 `PlanWithWeeks`; previous active plan archived |
| `PUT /plan/weeks/:weekStart` | `{targetRunMin?, longRunMin?, day2Min?, runDays?, strengthSessions?, focus?, overrideNote?}` | `PlanWeek` |
| `GET /reviews?from&to` | Mondays inclusive | one `WeeklyReview` per week in range; weeks with no stored row come back synthetic (`id:''`, `dataStatus:'unconfirmed'`) |
| `PUT /reviews/:weekStart` | `{dataStatus?, fatigue?, symptoms?, recoveryConstrained?, finalDecision?, finalNextMin?, notes?}` | `WeeklyReview` |
| `GET /weeks?from&to` | max 260 weeks | `WeekRow[]` |

Hooks (Task 12, `web/api/`): `auth.ts` `useMe useSetupStatus useLogin useSetup useLogout`; `settings.ts` `useSettings useUpdateSettings`; `activities.ts` `useActivities(params) useCreateActivity useUpdateActivity useDeleteActivity useResolveDuplicate`; `imports.ts` `useImports useImportFile` (mutation variables `{ kind: 'smashrun' | 'csv'; fileName: string; text: string; distanceUnit?: Units }`); `goals.ts` `useGoals useCreateGoal useUpdateGoal useDeleteGoal useActivateGoal`; `plan.ts` `usePlan useGeneratePlan useUpdatePlanWeek`; `reviews.ts` `useReviews({from,to}) useSaveReview`; `weeks.ts` `useWeeks({from,to})`. Query keys are `[keys.<resource>, params]` with `keys` from `web/api/client.ts`.

## Review Focus

Inputs the spec implies but its rules do not test. Each line has a test in the owning task.

1. **Excel-saved or Windows CSV** (UTF-8 BOM, CRLF, quoted commas and doubled quotes in Description, blank trailing lines) must import like a clean file. Task 6 (`csv.test.ts`, `smashrun.test.ts`) and Task 9 (the same text posted through the API).
2. **Password longer than 72 bytes** must be rejected with `validation`; bcrypt would silently truncate it and a different long password would log in. A 12-character password of multibyte characters counts characters, not bytes, for the minimum. Task 7.
3. **Race date in the current week, in the past, or fewer than 8 weeks away** must give a sensible plan (race week only, or short-plan allocation) or a `validation` error, never an empty plan or an exception. Task 3 (generator) and Task 10 (route).
4. **Deleting or editing the imported row that a flagged manual row points to** must release the flagged row (back to `none`), so totals recover. Task 8.
5. **A brand-new account with no runs, goal, plan or reviews** must render every page with an empty state and never show `NaN`, `Infinity` or `0:00 /mi`. Task 2 (null `longRunShare`, zero rows), Task 1 (`formatPace` with 0 m), Tasks 13-17 (page tests with empty API responses).

Also pinned, though outside the five: CSV formula injection in the export (Task 8), `javascript:` goal URLs (Task 10), an import body over the 10 MB limit (Task 9), a dismissed duplicate staying dismissed across re-imports (Task 8).

## Domain numbers and where each is pinned

| Number (spec) | Test |
| --- | --- |
| Phase shares 10:19:19:19:12:14, largest remainder; taper 2 if weeks >= 24, 1 if >= 8, else 0; race week 1; short-plan rules | Task 3 `allocates 37 build weeks`, `taper length by plan length`, `short plans` |
| Cutback every 4th week at 75-80% of previous, one run day fewer | Task 3 `cutback weeks` |
| First week <= baseline + 15% | Task 3 `first week` |
| Weekly ramp <= +10% over the previous non-cutback week | Task 3 `ramp cap` |
| Class ceilings 5 / 6 / 8 / 9 / 9.5 h | Task 3 `peak ceilings by class` |
| Long run round(27 x hours), cap 240 | Task 3 `longRunMinutes` |
| Taper 65% then 45%; race week 90 min, 2 run days | Task 3 `taper and race week` |
| Run days 3/4/5; strength 2/2/2/1-2/1-2/1/0/0; day 2 from Endurance only in build weeks | Task 3 `run days`, `strength`, `day 2` |
| 70% repeat, 85% hold/progress, fatigue 5 / 6-7 / 8, +10% cap, reduce x0.70, 50%-of-baseline floor | Task 4 `thresholds`, `next-week minutes` |
| Remaining per day = round(remaining / days left through Sunday including today) | Task 2 `remaining minutes and per-day advice` |
| `SESSION_SECRET` generated into `.env` when missing | Task 1 `setup-env.test.ts` |
| 80 m duplicate rule | Task 6 `duplicates.test.ts` boundary 80 / 81 |
| 2% fastest-effort window | Task 5 `window` |
| 10 logins / 15 min; 30-day cookie; bcrypt 12; 12-char minimum | Task 7 `rate limit: 10 attempts per 15 minutes per IP`, `POST /api/setup creates the account and a 30-day ... cookie`, `hash cost`, `password rules` |
| Distance classes 10 000 / 21 100 / 42 195 / 80 500 | Task 3 `distanceClassOf` |
| Median of last 4 run weeks | Task 10 `computeBaselineRunMin` |
| Working target chain (`targetSource`) | Task 10 `PUT week: override rules`, Task 11 `a final decision on a finished complete week sets reviewedAt and writes next week target` |

---

### Task 1: Scaffold the new tree

**Files:**
- Delete: everything tracked except `LICENSE`, `docs/superpowers/`, `.git`
- Create: every file in the root list (`package.json`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `.prettierrc`, `.nvmrc`, `.env.example`, `.gitignore`, `Dockerfile`, `docker-compose.yml`, `README.md`, `CLAUDE.md`)
- Create: `prisma/schema.prisma`, `prisma/migrations/<timestamp>_init/migration.sql`
- Create: `shared/types.ts`, `shared/units.ts`, `shared/dates.ts`
- Create: `server/index.ts`, `server/app.ts`, `server/config.ts`, `server/db.ts`, `server/logger.ts`, `server/errors.ts`, `server/static.ts`, `server/serialize.ts`
- Create: `server/auth/session.ts`, `server/auth/middleware.ts`, and empty stubs for Task 7 to fill: `server/auth/routes.ts` (an empty `authRouter`), `server/auth/password.ts`, `server/auth/rateLimit.ts`, `scripts/reset-password.ts` (each `export {}`)
- Create: `scripts/setup-env.ts` (complete; spec 4.9)
- Create: `server/routes/{health,settings,activities,imports,goals,plan,reviews,weeks}.ts` (empty routers except health), `server/services/{duplicates,plan,reviews,baseline}.ts` (stubs; `duplicates.ts` as specified below, the others `export {}`)
- Create: `web/index.html`, `web/main.tsx`, `web/App.tsx`, `web/api/client.ts`, `web/api/auth.ts` (`useMe`, `useSetupStatus`), `web/styles/tokens.css`, `web/styles/global.css`, `web/components/Layout.tsx` (renders `<Outlet/>`), `web/pages/MorePage.tsx`
- Create placeholders that Group C fills (each exports its named component; route pages render an `<h1>` with the page name, `ActivityForm` and `ImportDialog` render `null`): `web/pages/{SetupPage,LoginPage,SettingsPage,DashboardPage,ActivitiesPage,ActivityForm,ImportDialog,GoalsPage,PlanPage,ReviewPage,StatsPage}.tsx`
- Create: `tests/unit/shared/units.test.ts`, `tests/unit/shared/dates.test.ts`, `tests/unit/server/config.test.ts`, `tests/unit/server/setup-env.test.ts`, `tests/api/app.test.ts`, `tests/api/helpers.ts`, `tests/factories.ts`, `tests/globalSetup.ts`, `tests/web/setup.ts`, `tests/web/helpers.tsx`, `tests/web/app.test.tsx`, `tests/web/client.test.ts`, `tests/e2e/smoke.spec.ts`
- Create: `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`
- Create: `docs/adr/0001-clean-rewrite.md`, `0002-cookie-session.md`, `0003-units-and-dates.md`, `0004-single-test-runner.md`

**Interfaces:**
- Produces (anchors, exactly as specified): everything in `shared/types.ts` listed under the anchors plus the **Shared contract** types above; `shared/dates.ts`: `mondayOf addDays todayIso weekStartsBetween daysLeftInWeek` plus two extras: `daysBetween(from: string, to: string): number` (days from `from` to `to`, negative allowed) and `isIsoDate(value: string): boolean` (real calendar date in `YYYY-MM-DD` form; never throws); `shared/units.ts`: the eight functions in the anchors; `loadConfig(env: NodeJS.ProcessEnv): Config`; `createApp(deps: { prisma: PrismaClient; config: Config }): Express`.
- Produces (server):
  - `Config = { databaseUrl: string; sessionSecret: string; port: number; nodeEnv: 'development'|'test'|'production'; allowRegistration: boolean; logLevel: string }`.
  - `loadEnvFileIfPresent(): void` in `server/config.ts` (wraps `process.loadEnvFile('.env')`, ignores a missing file).
  - `scripts/setup-env.ts`: `ensureEnvFile(envPath: string, examplePath: string): { created: boolean; generatedSecret: boolean }` (copies `.env.example` to `.env` when `.env` is missing; when `SESSION_SECRET` is empty or absent, writes `randomBytes(48).toString('base64')`; never overwrites a non-empty secret or any other line); run directly it calls `ensureEnvFile('.env', '.env.example')` and prints what it did without printing the secret.
  - `export interface Deps { prisma: PrismaClient; config: Config }` from `server/app.ts` (import it with `import type`). Route modules export `<name>Router(deps: Deps): Router` (`healthRouter`, `settingsRouter`, `activitiesRouter`, `importsRouter`, `goalsRouter`, `planRouter`, `reviewsRouter`, `weeksRouter`, and `authRouter` in `server/auth/routes.ts`).
  - `server/errors.ts`: `class HttpError extends Error { status: number; code: ApiErrorCode; details?: unknown }`, `validationError(message, issues?)`, `unauthorized(message?, status?)`, `notFound(message?)`, `conflict(message)`, `parse<T>(schema: ZodType<T>, data: unknown): T` (throws `validationError` with `details: { issues: ValidationIssue[] }`, `path` dot-joined), `errorHandler(logger)`, `apiNotFound`. Malformed JSON bodies (body-parser `entity.parse.failed`) map to 400 `validation`; bodies over the size limit (`entity.too.large`) to 413 `validation`; unknown errors to 500 `internal` with a generic message.
  - `server/db.ts`: `createPrisma(databaseUrl: string): PrismaClient` and `initSqlite(prisma): Promise<void>` (`PRAGMA journal_mode=WAL`, `busy_timeout=5000`). It also re-exports `PrismaClient` and the row types `Activity Goal ImportBatch Plan PlanWeek WeeklyReview` from the generated client (`generated/prisma/`, gitignored, written by `prisma generate`). Every other file imports Prisma types from `server/db.ts` (`import type { PrismaClient } from "./db.ts"`), never from `@prisma/client` or `generated/`.
  - `server/auth/session.ts`: `SESSION_COOKIE = 'rl_session'`, `SESSION_MAX_AGE_SEC = 2_592_000`, `signSession(userId, secret): string` (HS256, `sub`, expiry 30 d), `verifySession(token, secret): { userId: string } | null` (`algorithms: ['HS256']`), `setSessionCookie(res, token, secure: boolean)`, `clearSessionCookie(res)`.
  - `server/auth/middleware.ts`: `sameOriginGuard(): RequestHandler` (POST/PUT/PATCH/DELETE under `/api` need `Sec-Fetch-Site: same-origin` or an `Origin` whose host equals the `Host` header, else 403 `unauthorized`), `requireAuth(deps): RequestHandler` (cookie -> `verifySession` -> user row exists -> sets `req.userId: string`, else 401), global `Express.Request.userId`.
  - `server/serialize.ts`: `toActivity(row): Activity`, `toGoal`, `toPlan`, `toPlanWeek`, `toWeeklyReview`, `toImportBatch` (Prisma row -> shared type: Dates to ISO strings, string columns narrowed to unions, `errors` JSON parsed), `loadActivities(prisma, userId, opts?: { from?: string; to?: string; type?: ActivityType }): Promise<Activity[]>`.
  - `server/services/duplicates.ts` stub: `markDuplicates(prisma: PrismaClient, userId: string, activityIds: string[]): Promise<number>` returning 0 (Task 8 implements; Task 9 calls).
  - `tests/api/helpers.ts`: `createTestCtx(overrides?: Partial<Config>): Promise<TestCtx>` with `TestCtx = { app: Express; prisma: PrismaClient; config: Config; close(): Promise<void> }` (copies the template database made by `globalSetup`, so each test file has its own SQLite file); `seedUser(ctx, opts?: { email?: string; units?: Units; password?: string }): Promise<{ id: string; email: string; cookie: string }>` (inserts directly with bcryptjs cost 4; cookie from `signSession`); `client(ctx, user?): { get(url); post(url); put(url); delete(url) }` returning supertest `Test`s with `Host: app.test`, `Origin: http://app.test` and the session cookie preset.
  - `tests/factories.ts`: `makeActivity(over?: Partial<Activity>): Activity` (defaults: `userId 'u1'`, `date '2026-03-02'`, `type 'run'`, `durationSec 1800`, `distanceM 5000`, `source 'manual'`, `duplicateStatus 'none'`, unique `id`), `makeWeekRow(over?: Partial<WeekRow>): WeekRow` (all zero, `longRunShare null`).
  - `web/api/client.ts` (complete): `class ApiError extends Error { status; code: ApiErrorCode; details? }`, `api<T>(method: string, path: string, body?: unknown): Promise<T>` (same-origin `fetch` under `/api`, JSON, throws `ApiError` from the error body, dispatches the `window` event `rl:unauthorized` on 401 outside `/auth/*` and `/setup`), `qs(params: Record<string, string | number | undefined>): string`, `fieldErrors(err: unknown): Record<string, string>`, `createQueryClient(): QueryClient`, `keys = { me, setup, settings, activities, imports, goals, plan, reviews, weeks }` (string roots).
  - `tests/web/helpers.tsx`: `mockApi(routes: Record<string, (req: { body: unknown; query: URLSearchParams }) => unknown | { status: number; body: unknown }>): { calls: Array<{ method: string; url: string; body: unknown }> }` stubs `fetch` (keys like `'GET /api/plan'`; an unmatched call fails the test); `renderWithProviders(ui, opts?: { route?: string }): RenderResult` (fresh `QueryClient` with `retry: false`, `MemoryRouter`).

- [ ] **Step 1: Remove the old tree**

Delete every tracked path except `LICENSE` and `docs/superpowers/`: list them with `git ls-files | grep -v -e '^LICENSE$' -e '^docs/superpowers/'` and pass that list to `git rm -q` (git history keeps the old code). Also remove the untracked leftovers (`dist`, `coverage-data`, `logs`, `lib`, `middleware`, `routes`, `server.ts`, `node_modules`). The owner approved this deletion in spec section 4.8.
Run: `ls -A` — expected: `.git LICENSE docs`.

- [ ] **Step 2: Toolchain files and dependencies**

`package.json`: `"type": "module"`, `engines.node ">=22"`, scripts exactly: `dev` (`concurrently -k "tsx watch server/index.ts" "vite"`; `server/index.ts` and `scripts/reset-password.ts` call `loadEnvFileIfPresent()` from `server/config.ts`, which wraps `process.loadEnvFile('.env')` and ignores a missing file), `build` (`vite build && tsc -p tsconfig.server.json`), `start` (`node dist/server/index.js`), `lint` (`eslint .`), `format` (`prettier --write .`), `typecheck` (`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.server.json --noEmit`), `test` (`vitest run`), `test:e2e` (`playwright test`), `db:migrate` (`prisma migrate deploy`), `db:studio` (`prisma studio`), `check` (`npm run lint && npm run typecheck && npm run test`), `reset-password` (`tsx scripts/reset-password.ts`), `setup` (`tsx scripts/setup-env.ts`). No install hooks. Add `predev prebuild prelint pretypecheck pretest` = `prisma generate`: lint, typecheck and tests need the generated client, and `postinstall` is forbidden.
Install everything the plan needs in this task so later tasks add nothing. Runtime: `express@5 zod@4 @prisma/client@7 prisma@7 @prisma/adapter-better-sqlite3@7 better-sqlite3@12 pino pino-http helmet cookie-parser jsonwebtoken bcryptjs@3 react@18 react-dom@18 react-router-dom@6 @tanstack/react-query@5 recharts @fontsource-variable/source-serif-4 @fontsource-variable/libre-franklin` (`prisma` stays a runtime dependency because the Docker image runs `prisma migrate deploy`; `bcryptjs@3` ships its own types). Dev: `typescript tsx concurrently vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom supertest @playwright/test eslint @eslint/js typescript-eslint eslint-plugin-react-hooks globals prettier @types/node @types/express @types/cookie-parser @types/jsonwebtoken @types/supertest @types/react@18 @types/react-dom@18`. No upload library (no `multer`, `busboy` or `formidable`).
`tsconfig.json`: `module ESNext`, `moduleResolution Bundler`, `jsx react-jsx`, `lib ["ES2023","DOM","DOM.Iterable"]`, `allowImportingTsExtensions`, `noEmit`, `include` web, shared, server, scripts, tests and the config files. `tsconfig.server.json`: `module NodeNext`, `lib ["ES2023"]`, `types ["node"]`, `rewriteRelativeImportExtensions`, `outDir dist`, `rootDir .`, `include ["server","shared","scripts"]` (emits `dist/server/index.js`, `dist/shared`, `dist/scripts/reset-password.js`). `vite.config.ts`: root `web`, `build.outDir ../dist/web`, dev proxy `/api` -> `http://localhost:3001`. `vitest.config.ts`: `test.projects` = `server` (node; `tests/unit/**/*.test.ts`, `tests/api/**/*.test.ts`; `globalSetup tests/globalSetup.ts`) and `web` (jsdom; `tests/web/**/*.test.{ts,tsx}`; `setupFiles tests/web/setup.ts`; react plugin). `tests/globalSetup.ts` runs `prisma migrate deploy` once against a template SQLite file in the OS temp directory and exposes its path to `createTestCtx`. `tests/web/setup.ts` loads the jest-dom matchers, stubs `ResizeObserver` and `matchMedia`, and cleans up after each test. `playwright.config.ts`: chromium only, `workers: 1`, `testDir tests/e2e`, `baseURL http://localhost:3101`, `webServer` command `sh -c "mkdir -p data && rm -f data/e2e.db* && npm run db:migrate && npm start"` with env `DATABASE_URL=file:<absolute cwd>/data/e2e.db`, a fixed 40-character test-only `SESSION_SECRET`, `PORT=3101`. `eslint.config.js`: flat config, ignores `dist data coverage playwright-report test-results`, typescript-eslint recommended-type-checked for `.ts/.tsx`, react-hooks for `web/`, Node globals for `server/ scripts/ tests/`, browser globals for `web/`. `.gitignore`: `node_modules dist data prisma/data .env coverage playwright-report test-results`. `.env.example` lists the six variables with placeholder values (`SESSION_SECRET=` empty, comment "filled by `npm run setup`").
A relative `file:` `DATABASE_URL` resolves against the `prisma/` directory for both the CLI and the client; tests, e2e and Docker use absolute paths. Note this in `.env.example` and `README.md`.

- [ ] **Step 3: Prisma schema and init migration**

Write `prisma/schema.prisma` exactly per spec 4.4 plus 7.4: provider `sqlite`, generator `prisma-client` with `output = "../generated/prisma"` (no `url` in the datasource; `prisma.config.ts` supplies it, resolving a relative `file:` path against `prisma/`), models `User Activity ImportBatch Goal Plan PlanWeek WeeklyReview`; enum-like columns are `String`; `Activity.source` allows `manual|smashrun|csv`; `PlanWeek.targetSource String @default("baseline")`; `WeeklyReview.symptoms String?` (null = not recorded, which `suggestAction` needs), `recoveryConstrained Boolean @default(false)`, `dataStatus String @default("unconfirmed")`; `Activity` has `@@index([userId, date])`, `@@unique([userId, providerKey])` and a self-relation `duplicateOf` with `onDelete: SetNull`; `PlanWeek` `@@unique([planId, weekStart])`; `WeeklyReview` `@@unique([userId, weekStart])`; every user-owned model has `onDelete: Cascade` to `User`; `Plan.goal` is `onDelete: Cascade` (the goals route refuses to delete a goal that has an active plan). Generate the SQL with `npx prisma migrate dev --name init --create-only` and commit it (never gitignore migrations). One active plan and one active goal per user are enforced in service transactions, not in SQL.
Run: `npx prisma migrate deploy` with a temp `DATABASE_URL` — expected: `All migrations have been successfully applied`.

- [ ] **Step 4: Write the failing shared tests, then implement `shared/`**

`tests/unit/shared/dates.test.ts` (dates are strings; arithmetic is UTC so it is independent of timezone and DST):

```ts
test('mondayOf maps every weekday to its Monday', () => {
  expect(mondayOf('2026-10-21')).toBe('2026-10-19')   // Wednesday
  expect(mondayOf('2026-10-19')).toBe('2026-10-19')   // Monday
  expect(mondayOf('2026-10-25')).toBe('2026-10-19')   // Sunday
})
test('addDays crosses month, year and leap-day boundaries', () => {
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
})
test('weekStartsBetween is inclusive and stays 7 days apart across DST changes', () => {
  expect(weekStartsBetween('2026-10-21', '2026-11-03')).toEqual(['2026-10-19', '2026-10-26', '2026-11-02'])
  expect(weekStartsBetween('2026-03-02', '2026-03-16')).toEqual(['2026-03-02', '2026-03-09', '2026-03-16'])
  expect(weekStartsBetween('2026-11-03', '2026-10-21')).toEqual([])
})
test('daysLeftInWeek counts through Sunday including the date', () => {
  expect(daysLeftInWeek('2026-10-19')).toBe(7); expect(daysLeftInWeek('2026-10-21')).toBe(5); expect(daysLeftInWeek('2026-10-25')).toBe(1)
})
test('todayIso uses the local calendar date, not UTC', () => {
  expect(todayIso(new Date(2026, 9, 21, 23, 59))).toBe('2026-10-21'); expect(todayIso(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
})
test('invalid dates throw RangeError', () => {
  expect(() => mondayOf('2026-02-30')).toThrow(RangeError); expect(() => addDays('2026-2-3', 1)).toThrow(RangeError)
})
test('daysBetween', () => { expect(daysBetween('2026-10-21', '2026-10-24')).toBe(3); expect(daysBetween('2026-10-24', '2026-10-21')).toBe(-3) })
test('isIsoDate', () => { expect(isIsoDate('2028-02-29')).toBe(true); expect(isIsoDate('2026-02-29')).toBe(false); expect(isIsoDate('2026-2-9')).toBe(false) })
```

`tests/unit/shared/units.test.ts`:

```ts
test('conversions use 1609.344 m per mile', () => {
  expect(milesToM(1)).toBe(1609.344); expect(mToMiles(1609.344)).toBe(1); expect(kmToM(5)).toBe(5000); expect(mToKm(5000)).toBe(5)
})
test('formatDuration', () => {
  expect(formatDuration(59)).toBe('0:59'); expect(formatDuration(125)).toBe('2:05'); expect(formatDuration(3725)).toBe('1:02:05')
})
test('formatPace per unit, and a dash instead of garbage for zero distance', () => {
  expect(formatPace(480, 1609.344, 'mi')).toBe('8:00 /mi'); expect(formatPace(1500, 5000, 'km')).toBe('5:00 /km'); expect(formatPace(1500, 0, 'mi')).toBe('—')
})
test('formatDistance and minutesToHours1', () => {
  expect(formatDistance(1609.344, 'mi')).toBe('1.00 mi'); expect(formatDistance(5000, 'km')).toBe('5.00 km')
  expect(minutesToHours1(450)).toBe('7.5'); expect(minutesToHours1(95)).toBe('1.6'); expect(minutesToHours1(0)).toBe('0.0')
})
```

Run: `npx vitest run --project server tests/unit/shared` — expected: FAIL (modules missing). Implement `shared/dates.ts` and `shared/units.ts` with the anchor signatures (strict `^\d{4}-\d{2}-\d{2}$` parse plus a `Date.UTC` round-trip check; no local-time `Date` parsing except inside `todayIso`). Re-run — expected: PASS.

- [ ] **Step 5: Config, errors and app skeleton, with tests**

`tests/unit/server/config.test.ts`: defaults (`databaseUrl 'file:./data/app.db'`, `port 3001`, `allowRegistration false`, `logLevel 'info'`, `nodeEnv 'development'`) when only a 32-character `SESSION_SECRET` is set; throws a message naming `SESSION_SECRET` when it is missing or 31 characters; `ALLOW_REGISTRATION='true'` -> true and `'1'` -> throws; `PORT='abc'` throws; `NODE_ENV='staging'` throws. Implement `loadConfig` with zod.
`tests/unit/server/setup-env.test.ts` (temp directory): no `.env` -> created from the example with a generated secret of at least 32 characters, `{ created: true, generatedSecret: true }`; an existing `.env` with an empty `SESSION_SECRET=` gets one and keeps its other lines; an existing non-empty secret is untouched (`generatedSecret: false`); two runs generate once. Implement `ensureEnvFile`.
`tests/api/app.test.ts` (uses `createTestCtx`): `GET /api/health` -> 200 `{status:'ok'}` with an `x-request-id` header and `x-content-type-options: nosniff`; authenticated `GET /api/nope` -> 404 `not_found`; `GET /api/settings` without a cookie -> 401 `unauthorized`; malformed JSON body -> 400 `validation`; an authenticated 2 MB JSON `PUT /api/settings` -> 413 `validation`; a `POST` without `Origin` and `Sec-Fetch-Site` -> 403. A separate `errorHandler` unit test mounts it on a tiny Express app with a throwing route: 500 `internal`, generic message, no stack in the body.
Implement `server/app.ts` complete, in this order: `helmet` (CSP `default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data:`), pino-http with request id echo, `app.use('/api/imports', express.json({ limit: '10mb' }))` (imports carry the CSV text), then `express.json({ limit: '1mb' })` for everything else (it skips bodies already parsed), `cookie-parser`, `sameOriginGuard` on `/api`, `healthRouter`, `authRouter`, `requireAuth`, the seven protected routers mounted at `/api/settings /activities /imports /goals /plan /reviews /weeks`, `apiNotFound`, `mountStatic`, `errorHandler`. `server/static.ts` serves `dist/web` (resolved next to the compiled file, falling back to `../dist/web` from source) with long cache for hashed assets, no cache for `index.html`, an `index.html` fallback for non-`/api` GET requests, and does nothing when the directory is missing. `server/index.ts`: load config, `createPrisma`, `initSqlite`, listen on `0.0.0.0:PORT`, graceful shutdown on `SIGTERM` and `SIGINT`.

- [ ] **Step 6: Web skeleton, with tests**

`web/styles/tokens.css`: copy the CSS block of visual design section 3 verbatim. `web/styles/global.css`: box-sizing reset, body in `--font-sans` at `--text-base`, headings in `--font-serif`, `font-variant-numeric: lining-nums tabular-nums` on `body`, focus ring from the tokens, `.visually-hidden`, a static skeleton block style. `web/main.tsx` imports both fontsource packages and both CSS files and renders `<App/>` inside `QueryClientProvider` (`createQueryClient()`) and `BrowserRouter`. `web/App.tsx` complete: routes `/setup`, `/login`, and inside an auth gate (`useSetupStatus` -> redirect to `/setup` when `needsSetup`; `useMe` null -> `/login`; the `rl:unauthorized` event also redirects) the `Layout` route with children `/` Dashboard, `/activities`, `/plan`, `/review`, `/goals`, `/stats`, `/settings`, `/more`. Each page is a placeholder exporting its component and rendering an `<h1>` with its name.
`tests/web/client.test.ts`: an error body with `details.issues` becomes an `ApiError` with `code 'validation'`, and `fieldErrors(err)` -> `{ password: 'Use at least 12 characters.' }`; a 401 on `/api/settings` dispatches `rl:unauthorized` while a 401 on `/api/auth/login` does not; `qs({a:1,b:undefined})` -> `?a=1`. `tests/web/app.test.tsx`: with `needsSetup:true` the app lands on the setup heading; with `needsSetup:false` and `GET /api/auth/me` returning 401 it lands on the login heading; with a user it shows the dashboard heading.

- [ ] **Step 7: Playwright smoke, CI, Docker, docs**

`tests/e2e/smoke.spec.ts`: `request.get('/api/health')` is `{status:'ok'}`; `page.goto('/')` redirects to `/setup` on the fresh database. `ci.yml`: one job; triggers `push` and `pull_request`; `permissions: contents: read`; `concurrency` cancelling superseded runs; steps checkout, `actions/setup-node` with `node-version-file: .nvmrc` and `cache: npm`, `npm ci`, `npx playwright install --with-deps chromium`, `npm run check`, `npm run build`, `npm run test:e2e`, upload `playwright-report` on failure (latest major tag of each action at implementation time). `codeql.yml`: `javascript-typescript`, on push, pull request and a weekly schedule. `dependabot.yml`: npm weekly with minor and patch grouped; github-actions monthly. `Dockerfile`: build stage `node:24-slim` (`npm ci`, `npx prisma generate`, `npm run build`); runtime stage `node:24-slim` with `openssl` installed, `npm ci --omit=dev` then `npx prisma generate`, `dist` and `prisma` copied from the build stage, `ENV NODE_ENV=production DATABASE_URL=file:/data/app.db PORT=3001`, `/data` owned by the non-root `node` user and declared a `VOLUME`, `USER node`, `HEALTHCHECK` using `node -e` with `fetch` against `/api/health`, `CMD ["sh","-c","npx prisma migrate deploy && node dist/server/index.js"]`. `docker-compose.yml`: one service, port `3001:3001`, volume `app-data:/data`, `SESSION_SECRET: ${SESSION_SECRET:?set SESSION_SECRET}`, `ALLOW_REGISTRATION` passthrough, and `TZ: ${TZ:-UTC}` (the server derives "today" and the current week from its own clock, so the container needs the runner's timezone; `TZ` is an OS setting, not an app variable). `README.md` and `CLAUDE.md` are short stubs (commands, structure, conventions; Task 18 finishes them). ADRs (sections Context, Decision, Consequences; Status `Proposed 2026-10-21`; each reason labelled **Fact**, **Rule**, **Opinion** or **Preference**; no first or second person): 0001 clean rewrite over keeping the old code (Fact: the 2026-10-21 audit scored it 2/5 with red CI; Opinion: a small tree is cheaper to keep correct); 0002 cookie session over bearer tokens (Fact: the audit found localStorage tokens and a login bypass; Opinion: a same-origin SPA needs no refresh flow; against: a JWT cannot be revoked before expiry, mitigated by rotating `SESSION_SECRET`); 0003 metres, seconds and date strings (Fact: the audit found a UTC-midnight day-shift bug; Rule: spec 4.3); 0004 Vitest for unit, API and component tests, Playwright only for end-to-end (Preference: the owner's sibling repos; Opinion: one runner removes config drift).

- [ ] **Step 8: Verify and commit**

Run: `npm run check` — expected: lint, typecheck and both Vitest projects pass. Run: `npm run build`, then start the server with `PORT=3101`, a 40-character `SESSION_SECRET` and an absolute `DATABASE_URL` after `npm run db:migrate`, and `curl -s localhost:3101/api/health` — expected `{"status":"ok"}`. Run: `npm run test:e2e` — expected: the smoke spec passes.
```bash
git add -A
git commit -m "chore: replace the old tree with the rewrite scaffold"
```

---

## Group A: pure shared modules (Tasks 2-6, parallel)

Each task adds only `shared/` code and its unit tests. Run a single file with `npx vitest run --project server <file>`. Build activities with `makeActivity` from `tests/factories.ts`.

### Task 2: Weekly aggregation and workout adaptation

**Files:**
- Create: `shared/domain/weeks.ts`, `shared/domain/adaptation.ts`
- Test: `tests/unit/shared/weeks.test.ts`, `tests/unit/shared/adaptation.test.ts`

**Interfaces:**
- Consumes: `Activity`, `WeekRow`, `mondayOf`, `addDays`, `daysLeftInWeek`, `makeActivity`, `makeWeekRow`.
- Produces: `aggregateWeeks(activities: Activity[], weekStarts: string[]): WeekRow[]` (pass every activity up to the last week, not only the requested range: `avg4wRunMin` and `streak3Plus` look back) and `remainingPlan(input: { today: string; weekStart: string; targetRunMin: number; runMinSoFar: number }): { remainingMin: number; remainingDays: number; perDayMin: number | null }` (spec 4.5: remaining days run through Sunday **including today**, whether or not today already has a run).

- [ ] **Step 1: Write the failing tests**

```ts
// weeks.test.ts (W = '2026-03-02', a Monday)
test('run minutes count only runs; race, strength and cross are separate', () => {
  // run 3600 s + run 1800 s, race 7200 s, strength 2700 s, cross 1800 s, all in W
  expect(row).toMatchObject({ runMin: 90, raceMin: 120, crossMin: 30, strengthSessions: 1, runSessions: 2 })
})
test('run days are distinct dates', () => { /* two runs on 2026-03-02 and one on 2026-03-04 */ expect(row).toMatchObject({ runSessions: 3, runDays: 2 }) })
test('possible and confirmed duplicates are excluded; dismissed ones count', () => { /* 3 runs of 30 min with the three statuses */ expect(row.runMin).toBe(60) })
test('Sunday belongs to the preceding Monday, Monday to its own week', () => { /* runs on 2026-03-08 and 2026-03-09 */ })
test('longest run and share; no runs gives null share and zeros, never NaN', () => {
  // runs of 60 and 30 min -> longestRunMin 60, longRunShare toBeCloseTo(0.667, 3)
  // empty week -> runMin 0, runM 0, longestRunMin 0, longRunShare null, avg4wRunMin 0, streak3Plus 0
})
test('runM sums distance, treating null as 0', () => {})
test('runMin rounds the summed seconds to whole minutes', () => { /* 3570 s -> 60 (59.5 rounds up) */ })
test('avg4wRunMin is the mean of this and the previous 3 calendar weeks, empty weeks included', () => {
  // weekly run minutes W-3..W = 60, 120, 0, 180 -> avg4wRunMin 90 at W
})
test('streak3Plus counts consecutive weeks ending here with at least 3 run sessions', () => {
  // W-2, W-1, W each with 3 runs -> 3 at W; make W-1 have 2 runs -> 1 at W; W with 2 runs -> 0
})
test('rows follow weekStarts order and include weeks with no activity', () => {})
```

```ts
// adaptation.test.ts (Wednesday 2026-03-04 in week '2026-03-02')
test('remaining minutes and per-day advice', () => {
  expect(remainingPlan({ today: '2026-03-04', weekStart: '2026-03-02', targetRunMin: 240, runMinSoFar: 90 }))
    .toEqual({ remainingMin: 150, remainingDays: 5, perDayMin: 30 })
  // today 2026-03-05, same numbers -> remainingDays 4, perDayMin round(150 / 4) = 38
})
test('never negative once the target is passed', () => { /* so far 300 of 240 -> remainingMin 0, perDayMin 0 */ })
test('Sunday still counts as one day', () => { /* 2026-03-08, 200 of 240 -> remainingDays 1, perDayMin 40 */ })
test('a date outside the week gives no per-day advice', () => { /* today 2026-03-10 -> remainingDays 0, perDayMin null */ })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project server tests/unit/shared/weeks.test.ts tests/unit/shared/adaptation.test.ts` — expected: FAIL, modules not found.

- [ ] **Step 3: Implement `aggregateWeeks` and `remainingPlan`**

`aggregateWeeks`: filter out `possible`/`confirmed` duplicates first and bucket the rest by `mondayOf(date)` once. `longestRunMin` is the longest single `run` rounded to minutes; `longRunShare = longestRunMin / runMin`. `avg4wRunMin` is the rounded mean of the four weekly `runMin` values ending at the row's week; `streak3Plus` walks back while `runSessions >= 3`, stopping at the earliest activity week. `remainingPlan` is the spec 4.5 formula as pinned by the tests.

- [ ] **Step 4: Run to verify pass, then check and commit**

Run: `npx vitest run --project server tests/unit/shared/weeks.test.ts tests/unit/shared/adaptation.test.ts` — expected: PASS. Run `npm run check` — expected: pass.
```bash
git add shared/domain/weeks.ts shared/domain/adaptation.ts tests/unit/shared/weeks.test.ts tests/unit/shared/adaptation.test.ts
git commit -m "feat(shared): add weekly aggregation and remaining-plan advice"
```

### Task 3: Plan generator

**Files:**
- Create: `shared/domain/plan.ts`
- Test: `tests/unit/shared/plan.test.ts`

**Interfaces:**
- Consumes: `Phase`, `DistanceClass`, `PlanWeek`, `mondayOf`, `addDays`, `weekStartsBetween`.
- Produces: `distanceClassOf(distanceM: number): DistanceClass`; `GeneratePlanInput`; `PlanWeekInput` (anchors); `generatePlan(input: GeneratePlanInput): PlanWeekInput[]` (throws `RangeError` when the race week precedes the start week or `baselineRunMin < 1`); `longRunMinutes(weekMin: number): number`; `isCutbackIndex(index: number, phase: Phase): boolean` (true when `index % 4 === 3` and the phase is a build phase; the web uses it to draw cutback rows); `BUILD_PHASES: readonly Phase[]` (`restart base1 base2 endurance specific peak`); `PEAK_MIN_BY_CLASS: Record<DistanceClass, number>` (300, 360, 480, 540, 570); `GENERATOR_VERSION = 1`.

- [ ] **Step 1: Write the failing tests**

Fixture: `fixture = { startDate: '2026-03-02', raceDate: '2026-12-05', distanceClass: 'marathon', baselineRunMin: 120, strengthPreference: 2 }` (40 Mondays, race week starts 2026-11-30). Helper `planOf(weeks, over?)` builds a plan with `raceDate = addDays(start, 7 * (weeks - 1) + 3)`.

```ts
test('distanceClassOf boundaries', () => {
  const c = [[10000, 'short'], [10001, 'half'], [21100, 'half'], [21101, 'marathon'], [42195, 'marathon'], [42196, 'ultra50'], [80500, 'ultra50'], [80501, 'ultra100']]
  for (const [m, cls] of c) expect(distanceClassOf(m)).toBe(cls)
})
test('allocates 37 build weeks by largest remainder (10:19:19:19:12:14), then taper 2 and race 1', () => {
  expect(countsByPhase(generatePlan(fixture))).toEqual({ restart: 4, base1: 8, base2: 7, endurance: 7, specific: 5, peak: 6, taper: 2, race: 1 })
  // phases appear in order, indexes are 0..39, weekStart values are consecutive Mondays from 2026-03-02, last weekStart is 2026-11-30
})
test('taper length by plan length', () => {
  // weeks 24 -> 2 taper, 23 -> 1, 8 -> 1, 7 -> 0
})
test('short plans', () => {
  // 1 week -> [race]; 2 weeks -> base1 + race; 3 -> base1, peak, race; 6 -> base1 x3, peak x2, race;
  // 7 -> restart..peak one week each + race, no taper; 8 -> same + 1 taper
})
test('restart is skipped when the baseline exceeds the Base 1 floor', () => {
  // baselineRunMin 300 (> 0.40 * 480 = 192): no restart weeks; the 37 build weeks split 19:19:19:12:14 over 83
  // -> { restart: 0, base1: 9, base2: 9, endurance: 8, specific: 5, peak: 6 }
})
test('first week is at most baseline + 15%', () => { expect(plan[0].baselineRunMin).toBe(138) })
test('ramp cap: each non-cutback build week is at most +10% over the previous NON-cutback build week', () => {
  // fixture weeks 0..4: 138, 152, 167, 129 (cutback), 184 — week 4 is round(1.1 * 167) = 184, measured against week 2,
  // not round(1.1 * 129) = 142 against the cutback, so a cutback never stalls the ramp
  // for every non-cutback build week i > 0: baselineRunMin <= round(1.1 * last earlier non-cutback build week)
  // baseline 100, 3 weeks (base1, peak, race): [100, 110, 90]
})
test('cutback weeks', () => {
  // every week with isCutbackIndex(index, phase): baselineRunMin / previous.baselineRunMin in [0.75, 0.80],
  // runDays === normal run days of its phase - 1; indexes 3, 7, 11, 15, 19, 23, 27, 31, 35 for the fixture
})
test('peak ceilings by class', () => {
  // 60-week plan, baseline 120, each class: max baselineRunMin <= [300, 360, 480, 540, 570] and > 0.9 * ceiling
  // fixture marathon: the last peak week (index 36) is exactly 480
})
test('longRunMinutes: round(27 x weekly hours), capped at 240', () => {
  expect(longRunMinutes(120)).toBe(54); expect(longRunMinutes(90)).toBe(41)    // 40.5 rounds up
  expect(longRunMinutes(480)).toBe(216); expect(longRunMinutes(533)).toBe(240); expect(longRunMinutes(720)).toBe(240)
  // every non-race week of the fixture: longRunMin === longRunMinutes(baselineRunMin); no share-of-week cap exists
})
test('run days', () => { /* non-cutback: restart 3, base1 3, base2 4, endurance 4, specific 5, peak 5; taper 4 then 3; race 2 */ })
test('strength by preference', () => {
  // pref 2: restart/base1/base2/endurance/specific 2, peak 1, taper 0, race 0; pref 1: 1 through peak; pref 0: all 0
})
test('day 2 appears only from Endurance on, in non-cutback build weeks, as half the long run', () => {
  // restart/base1/base2, cutback, taper, race -> day2Min null; others -> round(longRunMin / 2)
})
test('taper and race week', () => {
  // L = baselineRunMin of the last non-cutback build week (480): taper weeks 312 (65%) then 216 (45%); with 1 taper week only 312
  // race week: baselineRunMin 90, runDays 2, longRunMin 0, day2Min null, strengthSessions 0, weekStart = mondayOf(raceDate)
})
test('race in the starting week gives a race-only plan; invalid input throws', () => {
  // planOf(1).length === 1; raceDate before startDate's week -> RangeError; baselineRunMin 0 -> RangeError
})
test('every week has non-empty focus text and integer minutes', () => {})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project server tests/unit/shared/plan.test.ts` — expected: FAIL, module not found.

- [ ] **Step 3: Implement `distanceClassOf`, `longRunMinutes`, `isCutbackIndex` and the constants**

`longRunMinutes(w) = min(round(27 * w / 60), 240)`; there is no percentage-of-week cap.

- [ ] **Step 4: Implement `generatePlan` in `shared/domain/plan.ts`**

The spec leaves phase floors and ceilings open; this algorithm is the decision (spec section 6 allows adjusting the constants):

```
weeks    = weekStartsBetween(startDate, raceDate).length            // Mondays start..race week
taper    = weeks >= 24 ? 2 : weeks >= 8 ? 1 : 0;   build = weeks - 1 - taper
classPeak = PEAK_MIN_BY_CLASS[class]
peak     = max(baseline, min(classPeak, round(baseline * 1.1 ** build)))   // no more than +10% per build week
skipRestart = baseline > round(0.40 * classPeak)
phases   : build == 0 -> none; 1..5 -> base1 = ceil(build/2), peak = floor(build/2);
           >= 6 -> shares restart 10, base1 19, base2 19, endurance 19, specific 12, peak 14 (restart dropped if skipRestart);
           quota = build * share / sum(shares), floor each, hand the remainder to the largest fractional parts (ties to the earlier phase),
           then any present phase with 0 weeks takes one from the phase with the most weeks (ties: the later phase)
ceiling fractions of `peak`: restart .40, base1 .55, base2 .70, endurance .82, specific .92, peak 1.00
floor of the first present phase = baseline; floor of each later phase = previous phase's ceiling;
ceiling = max(fraction * peak, floor);   week k (0-based) of an n-week phase = round(floor + (ceiling - floor) * (k + 1) / n)
week 0 = min(week 0, round(baseline * 1.15))
ramp cap: every later non-cutback build week = min(its value, round(1.10 * R)), where R is the baselineRunMin of the most
          recent earlier NON-cutback build week (cutback weeks never become R, so the week after a cutback is measured
          against the week before it and the ramp does not stall)
cutback (isCutbackIndex): baselineRunMin = round(0.775 * previous week's baselineRunMin); runDays = phase run days - 1 (minimum 2)
taper:   65% then 45% of L (the last non-cutback build week, or the baseline when there is none); 1 taper week uses 65%
race:    90 min, runDays 2, longRunMin 0, no day 2, strength 0
```

Per-week fields: `longRunMin = longRunMinutes(baselineRunMin)` (race week 0); `day2Min` as in the test; `strengthSessions = min(strengthPreference, phaseMax)` with phase maxima restart..specific 2, peak 1, taper 0, race 0; `runDays` per the test; `focus` from a constant map with one short sentence per phase (for example base1: "Build easy aerobic volume"); `index` is 0-based.

- [ ] **Step 5: Run to verify pass, then check and commit**

Run: `npx vitest run --project server tests/unit/shared/plan.test.ts` — expected: PASS. Run `npm run check` — expected: pass.
```bash
git add shared/domain/plan.ts tests/unit/shared/plan.test.ts
git commit -m "feat(shared): add the weekly plan generator"
```

### Task 4: Weekly review rules

**Files:**
- Create: `shared/domain/review.ts`
- Test: `tests/unit/shared/review.test.ts`

**Interfaces:**
- Consumes: `Phase`, `SuggestedAction`, `WeekRow`, `WeeklyReview`, `addDays`, `makeWeekRow`.
- Produces: `SuggestInput`, `Suggestion`, `suggestAction(input: SuggestInput): Suggestion` exactly as in the anchors.

- [ ] **Step 1: Write the failing tests**

Helper `input(over)` builds a past, non-taper week: `today '2026-03-16'`, `weekStart '2026-03-02'`, `phase 'base2'`, `targetRunMin 300`, `baselineRunMin 300`, `nextBaselineMin 400`, `week` = `makeWeekRow({ runMin: 300, runDays: 4, runSessions: 4 })`, `review` = `{ dataStatus: 'complete', fatigue: 4, symptoms: 'none', recoveryConstrained: false }`, `hasPossibleDuplicates: false`.

```ts
test('order: upcoming, in_progress, await_data, review_duplicates, reduce', () => {
  // weekStart after today -> upcoming; today inside the week -> in_progress (even with complete data);
  // review null or dataStatus 'unconfirmed' or 'missing' -> await_data; hasPossibleDuplicates -> review_duplicates;
  // review_duplicates beats reduce; await_data beats review_duplicates
})
test('reduce triggers', () => { /* fatigue 8 -> reduce; fatigue 7 -> not; symptoms 'persistent'; recoveryConstrained true */ })
test('taper and race weeks hold with reason taper, after reduce', () => {
  // phase 'taper' and 'race' with fatigue 3 -> action 'hold', reason matches /taper/i, suggestedNextMin = min(targetRunMin, nextBaselineMin)
  // phase 'taper' with fatigue 8 -> 'reduce'
})
test('thresholds: 70% repeat, 85% hold, fatigue 5 / 6-7', () => {
  // runMin 209 of 300 (69.7%) -> repeat; 210 (70.0%) -> not repeat (hold: below 85%); 254 (84.7%) -> hold; 255 (85.0%) -> progress
  // runDays 2 -> repeat even at 100% of target; a complete week with runMin 0 -> repeat
  // fatigue 5 -> progress; 6 -> hold; 7 -> hold; symptoms 'mild' -> hold
  // fatigue null or symptoms null (and volume fine) -> needs_recovery_review; repeat is checked before needs_recovery_review
})
test('next-week minutes', () => {
  // progress: target 300, next baseline 400 -> 330 (+10%); next baseline 320 -> 320 (capped)
  // hold: 300; reduce: 210 (70%); repeat: target 100 with this week's baselineRunMin 300 -> 150 (50% of baseline floor); repeat target 300 -> 300
  // upcoming / in_progress / await_data / review_duplicates / needs_recovery_review -> suggestedNextMin null
  // nextBaselineMin null -> suggestedNextMin null for every action
})
test('every suggestion has a one-sentence reason', () => { /* non-empty, ends with a period, no newline */ })
test('zero target does not divide by zero', () => { /* targetRunMin 0 -> no NaN, action defined */ })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project server tests/unit/shared/review.test.ts` — expected: FAIL, module not found.

- [ ] **Step 3: Implement `suggestAction` in `shared/domain/review.ts`**

Evaluate in this order (spec 7.6) and return the first match. A week is *past* when `addDays(weekStart, 6) < today`. Compare percentages as integers (`runMin * 100 < 70 * target`) to avoid float edges.
1. `weekStart > today` -> `upcoming`. 2. `today` within the week -> `in_progress`. 3. `review?.dataStatus !== 'complete'` -> `await_data`. 4. `hasPossibleDuplicates` -> `review_duplicates`. 5. `fatigue >= 8` or `symptoms === 'persistent'` or `recoveryConstrained` -> `reduce`. 6. phase `taper` or `race` -> `hold`. 7. `runMin * 100 < 70 * target` or `week.runDays < 3` -> `repeat`. 8. `fatigue === null` or `symptoms === null` -> `needs_recovery_review`. 9. `symptoms === 'mild'` or `fatigue >= 6` or `runMin * 100 < 85 * target` -> `hold`. 10. otherwise `progress`.
Reasons (exact): upcoming "This week has not started."; in_progress "This week is in progress."; await_data "Confirm that this week's data is complete before deciding."; review_duplicates "Resolve the possible duplicate runs before deciding."; reduce "Fatigue, symptoms or recovery point to a lighter next week."; taper "Taper week: hold the plan as written."; repeat "Volume or run days fell short of the plan, so repeat the target."; needs_recovery_review "Record fatigue and symptoms to complete the review."; hold "Keep the target: volume, fatigue or symptoms are in the middle band."; progress "Volume, fatigue and symptoms support a small increase.".
Next minutes, all rounded, `null` unless the action is `progress`, `hold`, `repeat` or `reduce` and `nextBaselineMin !== null`: progress `min(next, 1.10 * target)`; hold `min(next, target)`; repeat `min(next, max(target, 0.5 * baselineRunMin))` (spec 4.5: "never lower than 50% of baseline", this week's baseline); reduce `min(next, 0.70 * target)`.

- [ ] **Step 4: Run to verify pass, then check and commit**

Run: `npx vitest run --project server tests/unit/shared/review.test.ts` — expected: PASS. Run `npm run check` — expected: pass.
```bash
git add shared/domain/review.ts tests/unit/shared/review.test.ts
git commit -m "feat(shared): add weekly review suggestion rules"
```

### Task 5: Stats

**Files:**
- Create: `shared/domain/stats.ts`
- Test: `tests/unit/shared/stats.test.ts`

**Interfaces:**
- Consumes: `Activity`, `makeActivity`.
- Produces: `fastestEfforts`, `monthlyTotals`, `yearlyTotals` exactly as in the anchors, plus `longestRuns(activities: Activity[], limit?: number): Activity[]` (addition; `limit` default 10). All four ignore `possible` and `confirmed` duplicates. Totals use `run` activities only, matching `WeekRow.runMin` (races are separate there); efforts include races.

- [ ] **Step 1: Write the failing tests**

```ts
test('fastestEfforts labels and targets', () => {
  // one qualifying run per distance -> labels ['1 mi','5K','10K','Half','Marathon','50K'], targetM [1609.344, 5000, 10000, 21097.5, 42195, 50000]
})
test('window: from the target up to 2% above', () => {
  // 5000 m qualifies; 5100 m (2.0%) qualifies; 5101 m does not; 4999 m does not
  // 1 mi window is 1609.344..1641.53 m; 1642 m is excluded
})
test('pace is whole-run seconds per km, fastest wins, earlier date breaks ties', () => {
  // 5000 m in 1500 s -> paceSecPerKm 300; 5050 m in 1500 s -> 297.03 (faster) wins; same pace on two dates -> the earlier one
})
test('races qualify; strength, cross and flagged duplicates do not; distances absent -> no entry', () => {})
test('labels without a qualifying run are omitted', () => { expect(fastestEfforts([])).toEqual([]) })
test('monthlyTotals ascending, runs only, rounded minutes', () => {
  // runs in 2026-02 and 2026-03 -> [{ month: '2026-02', runMin, runM, runs, longestRunMin }, ...]; a race and a strength session are not counted
})
test('yearlyTotals', () => { /* 2025 and 2026 rows, ascending */ })
test('longestRuns orders by duration, limits, excludes duplicates', () => {})
test('empty input gives empty arrays', () => {})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project server tests/unit/shared/stats.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement in `shared/domain/stats.ts`**

Compare with integers where possible; a `run` or `race` qualifies when `target <= distanceM <= target * 1.02` (whole-run pace, no split detection, spec 7.11).

- [ ] **Step 4: Run to verify pass, then check and commit**

Run: `npx vitest run --project server tests/unit/shared/stats.test.ts` — expected: PASS. Run `npm run check` — expected: pass.
```bash
git add shared/domain/stats.ts tests/unit/shared/stats.test.ts
git commit -m "feat(shared): add fastest efforts and period totals"
```

### Task 6: CSV importers, duplicate finder and fixture

**Files:**
- Create: `shared/importers/csv.ts`, `shared/importers/smashrun.ts`, `shared/importers/generic.ts`, `shared/domain/duplicates.ts`, `tests/fixtures/smashrun-sample.csv`
- Test: `tests/unit/shared/csv.test.ts`, `smashrun.test.ts`, `generic.test.ts`, `duplicates.test.ts`

**Interfaces:**
- Consumes: `Activity`, `Units`, `milesToM`, `kmToM`, `makeActivity`.
- Produces: `parseCsv`, `ImportRow`, `RowError`, `parseGenericCsv` exactly as in the anchors; `parseSmashrunCsv(text: string, options?: { distanceUnit?: Units; utcOffsetMinutes?: (instant: Date) => number }): { rows: ImportRow[]; errors: RowError[] }` (spec 7.13; `distanceUnit` defaults to `mi`; `utcOffsetMinutes` gives the runner's offset east of UTC for a given instant, so DST is handled per row, and defaults to `() => 0`; the server passes `(d) => -d.getTimezoneOffset()`, its own timezone); `findPossibleDuplicate` exactly as in the anchors; `DUPLICATE_TOLERANCE_M = 80`; `pickDuplicate<T extends Pick<Activity, 'id' | 'source'>>(a: T, b: T): { duplicate: T; original: T }` (source precedence `manual` < `csv` < `smashrun`; the lower one is the duplicate). `RowError.line` is the 1-based record number (a header counts).

- [ ] **Step 1: Write the fixture and the failing tests**

`tests/fixtures/smashrun-sample.csv` (synthetic; header plus three rows in the real 26-column layout; single-digit hours are deliberate; row 1 has a quoted comma):

```
Run Id,Source,Key,Distance,Duration (ms),Duration,Speed,HR Average,HR Max,HR Min,Start Date,Start Date (utc),Created Date (utc),Updated Date (utc),Is Deleted,Is Manual Edit,Elevation Gained,Elevation Lost,Hill Difficulty,SPI,Description,Tags,PowerAverage,PowerMax,PowerFormAverage,PowerFormMax
1001,Synthetic,synthetic-key-1001,3.1,1800000,00:30:00,6.2,150,170,110,26/03/02 7:15,2026-03-02T12:15:00Z,2026-03-02T13:00:00Z,2026-03-02T13:00:00Z,false,false,100,90,2,50,"Easy loop, flat",easy,,,,
1002,Synthetic,synthetic-key-1002,5,2700000,00:45:00,6.7,0,0,0,26/03/04 18:30,2026-03-04T23:30:00Z,2026-03-04T23:50:00Z,2026-03-04T23:50:00Z,false,false,,,,,,,,,,
1003,Synthetic,synthetic-key-1003,8,4800000,01:20:00,6.0,148,165,120,26/03/07 8:00,2026-03-07T13:00:00Z,2026-03-07T14:30:00Z,2026-03-07T14:30:00Z,false,false,250,240,3,55,Long run,long,,,,
```

```ts
// csv.test.ts
test('quotes, escaped quotes, embedded commas and newlines', () => {
  expect(parseCsv('a,"b,c","say ""hi""","l1\nl2"\n')).toEqual([['a', 'b,c', 'say "hi"', 'l1\nl2']])
})
test('CRLF line ends, a BOM and blank trailing lines', () => {
  expect(parseCsv('﻿a,b\r\n1,2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']])
})
test('empty fields are kept; a final line without newline works; empty input gives []', () => {
  expect(parseCsv('a,,c')).toEqual([['a', '', 'c']]); expect(parseCsv('')).toEqual([])
})
// smashrun.test.ts
test('fixture parses to three rows', () => {
  expect(rows[0]).toEqual({ providerKey: 'smashrun:1001', date: '2026-03-02', startTime: '07:15', durationSec: 1800, distanceM: 4989,
    avgHr: 150, maxHr: 170, elevationGainM: 30, notes: 'Easy loop, flat' })
  // row 2: distanceM 8047, durationSec 2700, startTime '18:30', avgHr null, maxHr null, elevationGainM null, notes null
  // row 3: distanceM 12875, durationSec 4800, date '2026-03-07', elevationGainM 76 (250 ft)
})
test('distanceUnit km reads Distance as kilometres and elevation as metres', () => { /* 5 -> 5000 m; 100 -> 100 m */ })
test('headerless 26-column files and files with a leading index column parse the same rows', () => {})
test('header detection is case-insensitive and tolerates a leading index column', () => {})
test('date forms: YY/MM/DD H:MM, YYYY-MM-DD HH:MM:SS, ISO 8601 with offset keeps the literal local digits', () => {
  // '26/03/02 7:15', '2026-03-02 07:15:30', '2026-03-02T07:15:00-05:00' -> date 2026-03-02, startTime 07:15
})
test('blank Start Date falls back to the UTC column with utcOffsetMinutes', () => {
  // utc 2026-03-03T02:30:00Z with utcOffsetMinutes: () => -300 -> date 2026-03-02, startTime '21:30'; without the option -> 2026-03-03 '02:30'
})
test('rows with problems are reported, not dropped, with 1-based record numbers', () => {
  // unparseable date -> 'unparseable start date'; distance 0 -> 'distance must be positive'; duration blank -> 'duration must be positive'
  // Is Deleted true -> 'deleted in Smashrun'; blank Run Id -> 'missing Run Id'; 25 fields -> 'expected 26 columns, got 25'
  // valid rows around an invalid one still import; rows + errors account for every non-blank record after the header
})
test('BOM, CRLF and Excel-style quoting import like the clean fixture', () => {})
test('heart rates outside 30..250 become null; every row type is a run (no type field)', () => {})
// generic.test.ts
test('date,type,minutes,miles,notes with any header case', () => {
  // '2026-03-02,run,45,5,Hill repeats' -> { providerKey: /^csv:[0-9a-f]{40}$/, date: '2026-03-02', startTime: null, durationSec: 2700, distanceM: 8047, notes: 'Hill repeats', avgHr: null, maxHr: null, elevationGainM: null }
  // minutes '45.5' -> 2730 s; type blank accepted
})
test('providerKey is the sha1 of "date|minutes|miles" and is stable', () => { /* compare with node:crypto sha1 of '2026-03-02|45|5' */ })
test('rows that cannot become runs are reported', () => {
  // type 'strength' -> 'unsupported type "strength": only run rows can be imported'; date '03/02/2026' -> 'date must be YYYY-MM-DD'
  // miles blank -> 'miles must be positive'; minutes 0 -> 'minutes must be positive'; missing minutes column -> rows [] and one error { line: 1, reason: 'missing required column: minutes' }
})
// duplicates.test.ts
test('80 m rule: same date, different source, runs only', () => {
  // distance diff 80 m -> match; 81 m -> null; same source -> null; different date -> null
  // candidate without distance, or type strength/cross -> null; candidate type race can match a run
  // sameDayRuns with duplicateStatus possible/confirmed are ignored; dismissed ones still match; rows without distance ignored
  // several matches -> the one with the closest distance (ties: the first in the given order)
})
test('pickDuplicate: manual < csv < smashrun', () => {})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project server tests/unit/shared/csv.test.ts tests/unit/shared/smashrun.test.ts tests/unit/shared/generic.test.ts tests/unit/shared/duplicates.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement `parseCsv` and the generic importer**

`parseCsv` is a small RFC 4180 state machine (no dependency): strips a leading BOM, treats `\r\n`, `\n` as record ends, drops records that are entirely empty. `parseGenericCsv` maps columns by header name (case-insensitive), requires `date` and `minutes` and `miles` columns, and applies the error reasons in the tests; `providerKey = 'csv:' + sha1(`${date}|${Number(minutes)}|${Number(miles)}`)` using `node:crypto` (this file is server-and-test only; it must not be imported by `web/`).

- [ ] **Step 4: Implement `parseSmashrunCsv` in `shared/importers/smashrun.ts`**

Column order when there is no header (spec 7.13, 7.7): `0 Run Id, 1 Source, 2 Key, 3 Distance, 4 Duration (ms), 5 Duration, 6 Speed, 7 HR Average, 8 HR Max, 9 HR Min, 10 Start Date, 11 Start Date (utc), 12 Created Date (utc), 13 Updated Date (utc), 14 Is Deleted, 15 Is Manual Edit, 16 Elevation Gained, 17 Elevation Lost, 18 Hill Difficulty, 19 SPI, 20 Description, 21 Tags, 22-25 power columns`. A header record is one whose first or second cell matches `/^run id$/i`; with a header, map by name. Without one, a 27-field record has its leading integer dropped. Mapping: `providerKey = 'smashrun:' + RunId`; `distanceM = round(Distance * (mi ? 1609.344 : 1000))`; `durationSec = round(Duration(ms) / 1000)`; `avgHr`/`maxHr` null when 0, blank or outside 30..250; `elevationGainM = round(gain * (mi ? 0.3048 : 1))` (call: the export's elevation unit is unverified, assumed to follow the distance unit); `notes` = trimmed Description or null; `Tags` and `Key` ignored. Date: read `Start Date` first (`YY/MM/DD H:MM` as `20YY`, or `YYYY-MM-DD HH:MM[:SS]`, or ISO 8601 using its literal date and time digits, no offset conversion); if blank or unparseable fall back to `Start Date (utc)` shifted by `utcOffsetMinutes(instant)`; if that also fails report `unparseable start date`. Validate real calendar dates and `HH:MM` ranges.

- [ ] **Step 5: Implement `findPossibleDuplicate` and `pickDuplicate` in `shared/domain/duplicates.ts`** (the tests pin the rule)

- [ ] **Step 6: Run to verify pass, then check and commit**

Run the Step 2 command — expected: PASS. Run `npm run check` — expected: pass.
```bash
git add shared/importers shared/domain/duplicates.ts tests/fixtures/smashrun-sample.csv tests/unit/shared/csv.test.ts tests/unit/shared/smashrun.test.ts tests/unit/shared/generic.test.ts tests/unit/shared/duplicates.test.ts
git commit -m "feat(shared): add csv importers and the duplicate finder"
```

---

## Group B: server (Tasks 7-11, parallel)

Each task owns its route file(s), service file(s) and `tests/api/` file(s), mounted already by Task 1's `app.ts`. Tests use `createTestCtx`, `seedUser` and `client` from `tests/api/helpers.ts`; each test file gets its own SQLite database. Validate every body and query with zod through `parse`. Every query filters by `req.userId`; a row owned by another user is `not_found`, never `forbidden`. Run one file with `npx vitest run --project server tests/api/<file>`. Tests that depend on "today" fake only the clock: `vi.useFakeTimers({ toFake: ['Date'] })` then `vi.setSystemTime(new Date(2026, 2, 18, 12))` (local noon, so `todayIso()` is `2026-03-18`); the server derives today from its own clock.

### Task 7: Authentication flow

**Files:**
- Modify: `server/auth/routes.ts`, `server/auth/password.ts`, `server/auth/rateLimit.ts`, `scripts/reset-password.ts` (Task 1 stubs)
- Modify only to fix a defect the tests expose: `server/auth/session.ts`, `server/auth/middleware.ts`
- Test: `tests/api/auth.test.ts`

**Interfaces:**
- Consumes: `Deps`, `HttpError` helpers, `parse`, `SESSION_COOKIE`, `SESSION_MAX_AGE_SEC`, `signSession`, `verifySession`, `setSessionCookie`, `clearSessionCookie`, `requireAuth`, `loadConfig`, `createPrisma`, `loadEnvFileIfPresent`.
- Produces: `hashPassword(plain: string): Promise<string>` (bcryptjs, cost 12); `verifyPassword(plain: string, hash: string): Promise<boolean>`; `passwordSchema` (zod string: at least 12 characters counted as code points, message `Use at least 12 characters.`; at most 72 UTF-8 bytes, message `Use at most 72 bytes; shorten the password.`); `setPasswordByEmail(prisma, email: string, plain: string): Promise<boolean>` (validates with `passwordSchema`, false when no such user); `createLoginLimiter(opts?: { max?: number; windowMs?: number; now?: () => number }): RequestHandler` (defaults 10 and 900 000 ms; counts every login attempt per `req.ip`; the next one gets 429 `unauthorized` with a `Retry-After` header and `details: { retryAfterSec }`); `authRouter(deps)`: `GET /setup`, `POST /setup`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` (contract table).

- [ ] **Step 1: Write the failing tests**

```ts
test('GET /api/setup flips after the first account', async () => { /* needsSetup true, then false */ })
test('POST /api/setup creates the account and a 30-day httpOnly SameSite=Lax cookie', async () => {
  // 201; body is SessionUser without passwordHash; units 'mi'; email trimmed and lower-cased ('  Runner@Example.com ' -> 'runner@example.com')
  // Set-Cookie contains rl_session=, HttpOnly, SameSite=Lax, Path=/, Max-Age=2592000, and no Secure over plain http
  // with header x-forwarded-proto: https the cookie also has Secure
})
test('setup is closed after the first account unless ALLOW_REGISTRATION is true', async () => {
  // second POST -> 409 conflict; ctx with allowRegistration true -> 201; duplicate email -> 409
})
test('password rules', async () => {
  // 11 characters -> 400 validation with issue path 'password'; 12 -> ok
  // 12 emoji (48 bytes) -> ok (characters, not bytes, count); 18 emoji (72 bytes) -> ok; 19 emoji (76 bytes) -> validation
  // 73 ASCII characters -> validation; bad email -> validation; missing fields -> validation
})
test('hash cost', async () => { /* stored passwordHash matches /^\$2[aby]\$12\$/ and never appears in any response */ })
test('login success and failure share one message', async () => {
  // correct -> 200 SessionUser + cookie; wrong password and unknown email -> 401 with the identical body { error: { code: 'unauthorized', message: 'Invalid email or password' } }
  // email match is case-insensitive
})
test('rate limit: 10 attempts per 15 minutes per IP', async () => {
  // limiter unit test with an injected clock: attempts 1..10 pass, 11th -> 429 with Retry-After; at +15 min the counter resets
  // integration: 11 bad logins through the app -> the 11th is 429 'unauthorized'
})
test('logout clears the cookie and works without a session', async () => { /* 204; Set-Cookie expires rl_session */ })
test('me', async () => {
  // valid cookie -> SessionUser; no cookie, garbage token, token signed with another secret, expired token (jsonwebtoken sign with exp in the past),
  // HS256-only (a token with alg none) and a token for a deleted user -> 401 unauthorized
})
test('same-origin guard', async () => {
  // POST without Origin and Sec-Fetch-Site -> 403; Origin http://evil.example -> 403; Origin matching Host -> ok;
  // Sec-Fetch-Site: same-origin alone -> ok; Sec-Fetch-Site: cross-site -> 403; GET needs neither
})
test('setPasswordByEmail', async () => { /* new password logs in, old does not; unknown email -> false; short password rejects */ })
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project server tests/api/auth.test.ts` — expected: FAIL (routes empty, 404s).

- [ ] **Step 3: Implement `password.ts`, `rateLimit.ts` and `authRouter`**

Login looks the user up by lower-cased email and always runs one `bcrypt.compare` (against a module-level dummy cost-12 hash when the user is missing) so unknown emails cost the same as wrong passwords. `POST /setup` and `POST /auth/login` set the cookie with `secure = req.secure || req.get('x-forwarded-proto') === 'https'`. The limiter wraps only `POST /auth/login`, keyed by `req.ip` (no `trust proxy`, so behind a reverse proxy all requests share one bucket; acceptable for one user). Setup race: a unique-constraint failure on email maps to `conflict`.

- [ ] **Step 4: Implement `scripts/reset-password.ts`**

Reads the email from `argv[2]`, calls `loadEnvFileIfPresent()` and `loadConfig`, prompts for the new password twice on a TTY with echo disabled (single line from stdin when not a TTY), calls `setPasswordByEmail`, prints `Password updated for <email>.` or exits 1 with a message. Manual check: `printf 'a-new-password-123\n' | DATABASE_URL=file:/tmp/rl-auth.db SESSION_SECRET=<40 chars> npm run reset-password -- runner@example.com` against a migrated temp database seeded by the test — expected: `Password updated for runner@example.com.`

- [ ] **Step 5: Run to verify pass, then check and commit**

Run: `npx vitest run --project server tests/api/auth.test.ts` — expected: PASS. Run `npm run check` — expected: pass.
```bash
git add server/auth scripts/reset-password.ts tests/api/auth.test.ts
git commit -m "feat(server): add setup, login, logout, me and password reset"
```

### Task 8: Settings and activities

**Files:**
- Modify: `server/routes/settings.ts`, `server/routes/activities.ts`, `server/services/duplicates.ts` (Task 1 stubs)
- Test: `tests/api/settings.test.ts`, `tests/api/activities.test.ts`

**Interfaces:**
- Consumes: `Deps`, `parse`, `notFound`, `conflict`, `toActivity`, `loadActivities`, `isIsoDate`, `findPossibleDuplicate`, `pickDuplicate`, `parseGenericCsv` (round-trip test only).
- Produces: `settingsRouter`, `activitiesRouter` per the contract table; `markDuplicates(prisma, userId, activityIds): Promise<number>` (the Task 1 signature, now real; returns how many rows it newly flagged); `releaseDuplicatesOf(prisma, userId, activityId: string): Promise<void>` (rows flagged `possible` or `confirmed` as duplicates of that activity go back to `none` with `duplicateOfId` null).

- [ ] **Step 1: Write the failing tests**

```ts
// settings.test.ts
test('GET returns email, displayName and units; PUT updates units and displayName', async () => {})
test('PUT validates: units must be mi or km, displayName at most 80 characters (empty string becomes null), unknown keys such as email are rejected', async () => {})
// activities.test.ts
test('create, read, update, delete a run; new rows are source manual with duplicateStatus none', async () => {})
test('validation', async () => {
  // durationSec 0 and 172801 -> 400; distanceM -1 and 1000001 -> 400; rpe 0 and 11; avgHr 29 and 251; date '2026-02-30'; startTime '25:00';
  // type 'swim'; strength with no distanceM is accepted; notes over 2000 characters -> 400; every error has code 'validation' and issues[].path
})
test('list filters from, to (inclusive) and type, newest first; from after to -> 400', async () => {})
test('rows of another user are not_found on read, update, delete and duplicate resolution', async () => {})
test('a manual run within 80 m of an imported run on the same date is flagged possible with duplicateOfId', async () => {
  // seed an imported smashrun row (prisma direct) at 5000 m; POST manual run at 5080 m -> duplicateStatus 'possible', duplicateOfId = imported id;
  // at 5081 m -> 'none'; different date -> 'none'; strength never flagged; two manual rows never flag each other
})
test('flagged rows are excluded from totals only through duplicateStatus; GET still returns them', async () => {})
test('confirm and dismiss', async () => {
  // POST /:id/duplicate {status:'confirmed'} -> 'confirmed'; 'dismissed' -> 'dismissed'; on a row with status none -> 409; bad status -> 400
  // a dismissed row stays dismissed when markDuplicates runs again (simulating a later import)
})
test('editing date, distance or type re-evaluates the flag; other edits keep it', async () => {
  // move a flagged manual run to another date -> 'none', duplicateOfId null; edit only notes -> unchanged
  // editing an imported original so it no longer matches releases the 'possible' rows that pointed to it
})
test('deleting the original releases the flagged rows', async () => {
  // delete the imported row -> the manual row is 'none' with duplicateOfId null (also when it was 'confirmed')
})
test('export.csv', async () => {
  // 200, Content-Type text/csv, Content-Disposition attachment; header row date,start_time,type,minutes,miles,avg_hr,max_hr,elevation_gain_m,rpe,notes,source,duplicate_status
  // minutes with 2 decimals, miles with 4 (always miles, independent of the units setting); quotes, commas, newlines and doubled quotes in notes are RFC 4180 correct
  // a note beginning with =, +, -, @ or a tab is prefixed with ' (formula injection); only the caller's rows
  // run rows round-trip through parseGenericCsv with distanceM within 1 m
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project server tests/api/settings.test.ts tests/api/activities.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement the settings route**

`GET /settings` reads the caller's user row; `PUT /settings` takes a strict zod object `{ units?: 'mi'|'km'; displayName?: string|null }` (trim, empty to null, max 80).

- [ ] **Step 4: Implement the activities route**

Body schema (also used for `PUT`, a full replace of the editable fields): `date` `isIsoDate`; `startTime` `HH:MM` 00:00-23:59 or null; `type` enum; `durationSec` int 1..540000; `distanceM` int 0..1 000 000 or null; `rpe` int 1..10 or null; `avgHr`/`maxHr` int 30..250 or null; `elevationGainM` int 0..9000 or null; `notes` trimmed, max 2000, empty to null. Register `GET /export.csv` before `/:id`. Export columns as in the test; text cells quoted when they contain a comma, quote, CR or LF; a text cell starting with `=`, `+`, `-`, `@`, tab or CR gets a leading `'`. `PUT`: when `date`, `distanceM` or `type` changed, set the row's own flag to `none`/null first and release `possible` rows pointing at it, then call `markDuplicates` for the row and for the released ids. `DELETE`: `releaseDuplicatesOf`, then delete.

- [ ] **Step 5: Implement `markDuplicates` in `server/services/duplicates.ts`**

For each id that is a `run` or `race` with a non-null `distanceM`: load that date's other `run`/`race` rows with a distance, call `findPossibleDuplicate(row, sameDay)`; on a match `pickDuplicate(row, match)` gives `{ duplicate, original }`; skip when `duplicate.duplicateStatus` is `confirmed` or `dismissed`; otherwise set `duplicate.duplicateStatus = 'possible'` and `duplicateOfId = original.id`. Rows already `possible` against the same original are not counted again.

- [ ] **Step 6: Run to verify pass, then check and commit**

Run: `npx vitest run --project server tests/api/settings.test.ts tests/api/activities.test.ts` — expected: PASS. Run `npm run check` — expected: pass.
```bash
git add server/routes/settings.ts server/routes/activities.ts server/services/duplicates.ts tests/api/settings.test.ts tests/api/activities.test.ts
git commit -m "feat(server): add settings, activities, duplicate pass and csv export"
```

### Task 9: Imports

**Files:**
- Modify: `server/routes/imports.ts` (Task 1 stub)
- Test: `tests/api/imports.test.ts`

**Interfaces:**
- Consumes: `Deps`, `parse`, `toImportBatch`, `parseSmashrunCsv`, `parseGenericCsv`, `markDuplicates` (Task 1 signature; Task 8 supplies the behaviour). The 10 MB JSON parser for `/api/imports` and the 413 mapping already exist in Task 1's `app.ts` and `errors.ts`.
- Produces: `importsRouter(deps)`: `POST /smashrun` and `POST /csv` with the strict JSON body `{ fileName: string (1..255); text: string (non-empty after trimming); distanceUnit?: 'mi' | 'km' }` (`distanceUnit` used by smashrun only, default the user's units), `GET /` newest first. Response is the stored `ImportBatch`.

- [ ] **Step 1: Write the failing tests**

`vi.mock('../../server/services/duplicates.ts')` makes `markDuplicates` a spy, so this task does not depend on Task 8's behaviour; the end-to-end flagging is exercised in Task 18.

```ts
test('imports the fixture: 201 batch with accepted 3, skippedDuplicate 0, skippedInvalid 0, rowCount 3, fileName kept', async () => {
  // rows saved as type run, source smashrun, providerKey smashrun:1001..1003, durationSec 1800, distanceM 4989, importBatchId = batch id
})
test('re-importing the same file changes nothing', async () => {
  // second upload: accepted 0, skippedDuplicate 3, errors has 3 entries { line: null, reason: /already imported/ }; activity count unchanged
})
test('invalid rows are reported and valid rows around them still import', async () => {
  // fixture with one row having distance 0 and one Is Deleted true: accepted 1, skippedInvalid 2, errors carry line numbers and reasons; accepted + skippedDuplicate + skippedInvalid === rowCount
})
test('a key repeated inside one file counts as a duplicate; the same key for another user does not', async () => {})
test('distanceUnit is applied and defaults to the user units setting; a blank Start Date uses the server timezone', async () => {
  // user units km, no field -> Distance 5 becomes 5000 m; distanceUnit 'mi' overrides
  // a row with blank Start Date and utc 2026-03-03T02:30:00Z gets the date and HH:MM of new Date('2026-03-03T02:30:00Z') in local time
})
test('Excel-style file: BOM, CRLF, quoted commas', async () => {})
test('generic csv import: source csv, providerKey csv:<sha1>, re-import is idempotent, a strength row is reported not dropped', async () => {})
test('markDuplicates is called once with the ids of the newly created rows, and not at all when nothing was accepted', async () => {})
test('bad uploads', async () => {
  // missing text, whitespace-only text, missing fileName, unknown keys -> 400 validation; body over 10 MB -> 413 with code 'validation';
  // a 9 MB body is accepted by the parser (it is not cut off by the global 1 MB limit); more than 50 000 records -> 400;
  // distanceUnit 'furlong' -> 400; unauthenticated -> 401; no Origin -> 403
})
test('GET /imports lists only the caller batches, newest first', async () => {})
test('the whole batch is atomic: a database failure leaves no partial rows and no batch', async () => {})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project server tests/api/imports.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement `importsRouter`**

Validate the body with `parse` (the parsers strip a BOM from `text`). Smashrun calls `parseSmashrunCsv(text, { distanceUnit, utcOffsetMinutes: (d) => -d.getTimezoneOffset() })`. Flow: parse -> look up existing `providerKey`s for the user in chunks of 500 -> split accepted / duplicate (including repeats inside the file) -> in one `$transaction` create the rows with `createMany` and the `ImportBatch` (`errors` = parser errors plus `{ line: null, reason: 'already imported (<providerKey>)' }` per skipped duplicate; `fileName` reduced to its basename, at most 200 characters) -> after commit read back the new ids by `importBatchId` and call `markDuplicates(prisma, userId, ids)` when there are any.

- [ ] **Step 4: Run to verify pass, then check and commit**

Run: `npx vitest run --project server tests/api/imports.test.ts` — expected: PASS. Run `npm run check` — expected: pass.
```bash
git add server/routes/imports.ts tests/api/imports.test.ts
git commit -m "feat(server): add idempotent smashrun and csv imports"
```

### Task 10: Goals, plan generation and baseline

**Files:**
- Modify: `server/routes/goals.ts`, `server/routes/plan.ts`, `server/services/plan.ts`, `server/services/baseline.ts` (Task 1 stubs)
- Test: `tests/api/goals.test.ts`, `tests/api/plan.test.ts`

**Interfaces:**
- Consumes: `Deps`, `parse`, `HttpError` helpers, `toGoal`, `toPlan`, `toPlanWeek`, `loadActivities`, `aggregateWeeks`, `generatePlan`, `distanceClassOf`, `GENERATOR_VERSION`, `mondayOf`, `todayIso`, `isIsoDate`, `weekStartsBetween`.
- Produces: `goalsRouter`, `planRouter` per the contract table; `computeBaselineRunMin(prisma, userId, today: string): Promise<number | null>` (median `runMin` of the most recent up to 4 completed weeks, looking back at most 26 weeks, that contain at least one run, ignoring `dataStatus` and the current partial week; an even count averages the middle two, rounded; `null` when none); `generatePlanForGoal(deps: Deps, input: { userId: string; goalId: string; baselineRunMin?: number; startDate?: string; strengthPreference?: 0 | 1 | 2; today: string }): Promise<PlanWithWeeks>`.

- [ ] **Step 1: Write the failing tests**

```ts
// goals.test.ts
test('CRUD with trimmed strings, empty strings stored as null, defaults dateProvisional false and isActive false', async () => {})
test('validation: priority A|B|C, status enum, targetDate real date, distanceM 1..500000, url must be http(s) and at most 500 characters', async () => {
  // 'javascript:alert(1)', 'data:text/html,x', 'ftp://example.com' -> 400; 'https://example.com/race' accepted
})
test('activate makes exactly one goal active and never generates a plan', async () => { /* activate B after A -> A inactive; GET /plan still null (spec 7.5); a done or dropped goal -> 409 */ })
test('delete: 204, but 409 while the goal has an active plan; other users get not_found', async () => {})
// plan.test.ts
test('GET /plan is null before any plan', async () => {})
test('computeBaselineRunMin', async () => {
  // runs in the last 5 completed weeks of 60, 90, 120, 150, 180 min -> uses the latest 4 (90,120,150,180) -> median 135
  // weeks with no run are skipped, not counted as zero; the current partial week is ignored; nothing in 26 weeks -> null; flagged duplicates are ignored
})
test('generate: baseline from request wins, else from runs, else validation', async () => {
  // body baselineRunMin 200 -> every week baselineRunMin chain starts from 200; no runs and no baseline -> 400 validation mentioning baseline
})
test('generate persists weeks with targetRunMin = baselineRunMin and targetSource baseline', async () => {
  // 201 PlanWithWeeks; weeks sorted by index from 0; first weekStart is the Monday of startDate (a Wednesday startDate normalises); name = goal name; generatorVersion 1; raceWeekStart = Monday of the goal date
})
test('regenerating archives the old plan, keeps exactly one active plan and keeps reviews', async () => {
  // seed a WeeklyReview, generate twice: first plan archived, one active, review row untouched; overrides from the first plan are gone
})
test('generate errors', async () => {
  // unknown goal or another user goal -> 404; goal without distanceM -> 400; goal status done or dropped -> 400;
  // goal date in the past -> 400; race Monday before the start Monday -> 400; more than 156 weeks -> 400; baselineRunMin 0 or 1_000_000 -> 400
})
test('race in the current week gives a one-week plan', async () => { /* goal date within this week: weeks.length 1, phase race */ })
test('a past startDate creates past weeks and leaves activities untouched', async () => {})
test('PUT week: override rules', async () => {
  // targetRunMin different from baseline without overrideNote -> 400; whitespace-only note -> 400; with note -> targetSource 'override', note stored
  // targetRunMin equal to baseline -> note cleared, targetSource 'baseline' (also when it was 'review' or 'override')
  // editing longRunMin / day2Min / runDays / strengthSessions / focus alone leaves target and source unchanged
  // weekStart not a Monday or malformed -> 400; Monday outside the plan -> 404; archived plan weeks are not editable; ranges enforced (runDays 0..7)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project server tests/api/goals.test.ts tests/api/plan.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement goals**

Body schema per the contract table; strings trimmed, empty to `null`; `url` parsed with `new URL` and limited to `http:`/`https:`. `activate` runs in a transaction (`updateMany` isActive false for the user, then set this goal). `DELETE` returns 409 `conflict` when an `active` plan references the goal; archived plans are deleted by the cascade.

- [ ] **Step 4: Implement `computeBaselineRunMin` and `generatePlanForGoal`**

`generatePlanForGoal` runs in one `$transaction`: load the caller's goal (not found -> 404) -> validate (distance present, status `target` or `considering`, `targetDate >= today`, race Monday not before the start Monday, at most 156 weeks) -> resolve the baseline (request value, else `computeBaselineRunMin`, else `validation` "Enter a weekly run-minutes baseline: no recent runs were found") -> `generatePlan({ startDate: mondayOf(startDate ?? today), raceDate: goal.targetDate, distanceClass: distanceClassOf(goal.distanceM), baselineRunMin, strengthPreference ?? 2 })` -> `updateMany` the user's `active` plans to `archived` -> create the `Plan` (`generatorVersion: GENERATOR_VERSION`) and its weeks with `targetRunMin = baselineRunMin`, `targetSource = 'baseline'`, `overrideNote = null`. The route passes `todayIso()` as `today`.

- [ ] **Step 5: Implement `PUT /plan/weeks/:weekStart`**

Strict zod body; look up the week in the caller's active plan; apply the override rules in the test (`effective target = body.targetRunMin ?? stored`; a note without a target change is only accepted while the source is `override`).

- [ ] **Step 6: Run to verify pass, then check and commit**

Run: `npx vitest run --project server tests/api/goals.test.ts tests/api/plan.test.ts` — expected: PASS. Run `npm run check` — expected: pass.
```bash
git add server/routes/goals.ts server/routes/plan.ts server/services/plan.ts server/services/baseline.ts tests/api/goals.test.ts tests/api/plan.test.ts
git commit -m "feat(server): add goals, plan generation and week overrides"
```

### Task 11: Reviews and weeks

**Files:**
- Modify: `server/routes/reviews.ts`, `server/routes/weeks.ts`, `server/services/reviews.ts` (Task 1 stubs)
- Test: `tests/api/reviews.test.ts`, `tests/api/weeks.test.ts`

**Interfaces:**
- Consumes: `Deps`, `parse`, `toWeeklyReview`, `toPlanWeek`, `loadActivities`, `aggregateWeeks`, `suggestAction`, `weekStartsBetween`, `addDays`, `mondayOf`, `todayIso`, `isIsoDate`.
- Produces: `reviewsRouter`, `weeksRouter` per the contract table; `listReviews(prisma, userId, weekStarts: string[], today: string): Promise<WeeklyReview[]>`; `saveReview(prisma, userId, weekStart: string, patch: ReviewPatch, today: string): Promise<WeeklyReview>` where `ReviewPatch = Partial<Pick<WeeklyReview, 'dataStatus'|'fatigue'|'symptoms'|'recoveryConstrained'|'finalDecision'|'finalNextMin'|'notes'>>` (`undefined` keeps, `null` clears).

- [ ] **Step 1: Write the failing tests**

Seed: clock fixed at `2026-03-18`; an active plan with weeks `W = 2026-03-02` (target 300, baseline 300, phase base2) and `W+7 = 2026-03-09` (target 300, baseline 400), both finished; 5 runs of 60 min in `W`.

```ts
// reviews.test.ts
test('list returns one row per week; unsaved weeks are synthetic with a computed suggestion', async () => {
  // week with no row: id '', dataStatus 'unconfirmed', suggestedAction 'await_data' (past) / 'upcoming' (future) / 'in_progress' (current)
})
test('save computes and stores the suggestion', async () => {
  // PUT { dataStatus:'complete', fatigue:4, symptoms:'none' } -> suggestedAction 'progress', suggestedNextMin 330, reviewedAt null
  // fatigue 8 -> 'reduce' with suggestedNextMin 210; possible duplicate in the week -> 'review_duplicates'
})
test('a final decision on a finished complete week sets reviewedAt and writes next week target', async () => {
  // PUT { finalDecision:'progress', finalNextMin:330 } -> reviewedAt set; plan week W+7 targetRunMin 330, targetSource 'review'
  // when W+7 is an override: left untouched
  // re-save with finalNextMin 320 -> W+7 is 320; re-save with dataStatus 'missing' (or finalNextMin null) -> reviewedAt null and W+7 back to baseline 400 / 'baseline'
  // finalDecision without finalNextMin -> reviewedAt set, next week untouched
})
test('after reviewedAt the stored snapshot is returned even when data changes', async () => {})
test('a week that is not finished rejects a final decision; data status and fatigue are accepted', async () => {})
test('a week outside the plan saves fine and has suggestedAction null', async () => {})
test('validation and isolation', async () => {
  // weekStart not a Monday -> 400; fatigue 0 and 11; symptoms 'severe'; finalNextMin -1; unknown keys; another user's review is never read or written
})
// weeks.test.ts
test('GET /weeks aggregates server-side and excludes flagged duplicates', async () => {})
test('avg4wRunMin and streak3Plus look back before from', async () => {})
test('range: from after to -> 400; more than 260 weeks -> 400; malformed date -> 400; empty account -> rows of zeros', async () => {})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project server tests/api/reviews.test.ts tests/api/weeks.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement `weeks` route**

Parse `from` and `to` (default `to` = this week's Monday, `from` = 11 weeks earlier); `loadActivities(prisma, userId, { to: addDays(mondayOf(to), 6) })`; return `aggregateWeeks(activities, weekStartsBetween(from, to))`.

- [ ] **Step 4: Implement `listReviews` and `saveReview` in `server/services/reviews.ts`**

For each week: stored row (or a synthetic one), the active plan's week and the following week, `aggregateWeeks` row, and whether any activity that week has `duplicateStatus = 'possible'`. Suggestion: if the stored row has `reviewedAt`, return its stored snapshot; otherwise call `suggestAction({ today, weekStart, phase, targetRunMin, baselineRunMin, nextBaselineMin, week, review, hasPossibleDuplicates })` (`nextBaselineMin` null when the plan has no following week) (weeks without a plan week get `suggestedAction: null`). `saveReview` upserts the patch, recomputes and stores the suggestion, and then: `qualifies = dataStatus === 'complete' && finalDecision !== null && week is finished`; `reviewedAt = qualifies ? existing ?? now : null`; in one transaction, if `qualifies && finalNextMin !== null`, set next week's `targetRunMin = finalNextMin`, `targetSource = 'review'` unless its source is `override`; if the review no longer qualifies (or `finalNextMin` is null) and next week's source is `review`, reset it to `targetRunMin = baselineRunMin`, `targetSource = 'baseline'`. A `finalDecision` or `finalNextMin` on an unfinished week is a `validation` error. `finalDecision` is a string of at most 40 characters; the web sends one of `progress hold repeat reduce`.

- [ ] **Step 5: Implement the reviews routes**

`GET /reviews?from&to` (Mondays, max 260 weeks, defaults like weeks) and `PUT /reviews/:weekStart` (strict zod body, `weekStart` must be a Monday), using `todayIso()` for `today`.

- [ ] **Step 6: Run to verify pass, then check and commit**

Run: `npx vitest run --project server tests/api/reviews.test.ts tests/api/weeks.test.ts` — expected: PASS. Run `npm run check` — expected: pass.
```bash
git add server/routes/reviews.ts server/routes/weeks.ts server/services/reviews.ts tests/api/reviews.test.ts tests/api/weeks.test.ts
git commit -m "feat(server): add weekly reviews and weekly aggregates"
```

---

## Group C0: web shell (Task 12, sequential)

### Task 12: Layout, primitives, charts theme, hooks, PWA

**Files:**
- Modify: `web/components/Layout.tsx`, `web/pages/MorePage.tsx`, `web/index.html`, `web/api/auth.ts`
- Create: `web/components/{Nav,Button,Field,Sheet,Meter,EmptyState,Toast,PageHeader,Segmented,Skeleton}.tsx` each with a `.module.css` (plus `Layout.module.css`), `web/components/format.ts`, `web/components/charts/theme.ts`, `web/components/charts/ChartTooltip.tsx` (+ `.module.css`)
- Create: `web/api/{settings,activities,imports,goals,plan,reviews,weeks}.ts`
- Create: `web/public/manifest.webmanifest`, `web/public/icon.svg`
- Test: `tests/web/components.test.tsx`, `tests/web/nav.test.tsx`, `tests/web/api.test.tsx`

**Interfaces:**
- Consumes: `api`, `qs`, `keys`, `ApiError` from `web/api/client.ts`; shared types; `minutesToHours1`; visual design document sections 2 to 7 (tokens already in `tokens.css`; retune values only if a contrast ratio in the doc would fail, never rename a token).
- Produces components (all named exports):
  - `Layout()` (rail >= 900px, tab bar below, `<main id="main">`, skip link, wraps `ToastProvider`); `useTheme(): { theme: 'system'|'light'|'dark'; setTheme(t): void }` exported from `Layout.tsx` (sets `data-theme` on `<html>`, removed for `system`; persisted in `localStorage` key `rl_theme` inside try/catch).
  - `Nav()`: five items Today `/`, Log `/activities`, Plan `/plan`, Review `/review`, More `/more` (More is active on `/more /goals /stats /settings`); the rail adds a group with Goals, Stats, Settings and the theme toggle; active item has `aria-current="page"`.
  - `Button(props: ButtonHTMLAttributes & { variant?: 'primary'|'secondary'|'quiet'|'danger'; loading?: boolean })`.
  - `Field(props: { label: string; hint?: string; error?: string; children: (a: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode })`; `Input`, `Select`, `Textarea` styled controls (forward refs, 16px+ text).
  - `Segmented<T extends string>(props: { label: string; options: Array<{ value: T; label: string }>; value: T; onChange(v: T): void })` (radiogroup, arrow keys).
  - `Sheet(props: { open: boolean; onClose(): void; title: string; children: ReactNode; footer?: ReactNode })` (role `dialog`, `aria-modal`, scrim, focus trap, Escape and scrim click close, focus returns to the trigger, bottom sheet below 900px and 440px right panel above).
  - `Meter(props: { valueMin: number; targetMin: number; label: string })`; `EmptyState(props: { title: string; body?: string; action?: ReactNode })`; `PageHeader(props: { title: string; context?: string; actions?: ReactNode })`; `Skeleton(props: { lines?: number })` (renders nothing for the first 300 ms).
  - `ToastProvider`, `useToast(): { show(message: string, opts?: { action?: { label: string; onClick(): void } }): void }` (role `status`, 4 s).
  - `format.ts`: `formatShortDate(iso): string` ("19 Oct"), `formatWeekday(iso): string` ("Mon"), `formatLongDate(iso): string` ("Mon 19 Oct 2026"), all `en-GB` with `timeZone: 'UTC'`; `phaseLabel(p: Phase): string` ("Base 2", "Race week").
  - `charts/theme.ts`: `chartColors` (`run strength cross race planned actual grid` as `var(--chart-*)` strings), `axisProps`, `gridProps` (no axis or tick lines, `--text-xs`, muted fill, horizontal grid only); `ChartTooltip({ active, payload, label, format? })`.
- Produces hooks (names and shapes fixed by the **Shared contract**): `useLogin() useSetup() useLogout()` added to `auth.ts` (login and setup put the `SessionUser` in the `me` cache; logout clears the whole query cache); request types exported from the hook files: `ActivityInput`, `GoalInput`, `PlanWeekPatch`, `ReviewPatch`, `GeneratePlanRequest`. `useMe` resolves to `null` on 401. Mutations invalidate by prefix: activities and imports -> `activities weeks reviews` (imports also `imports`); goals -> `goals plan`; plan generate and week edit -> `plan reviews`; review save -> `reviews plan`; settings -> `settings me`.

- [ ] **Step 1: Write the failing tests**

```ts
// components.test.tsx
test('Meter states and captions (visual design section 5)', () => {
  // valueMin 186 / targetMin 450 -> under: caption '3.1 h of 7.5 h target'
  // 384 / 450 (85.3%) -> near: '1.1 h to target'
  // 474 / 450 -> over: '0.4 h past target'
  // role 'meter' with aria-valuenow 186 / aria-valuemax 450 and text equivalent '3.1 of 7.5 hours'; the state is in words, not colour; target 0 renders without NaN
})
test('Button loading disables and sets aria-busy; variants render', () => {})
test('Field connects label, hint and error: aria-describedby, aria-invalid, error replaces hint', () => {})
test('Segmented: one tab stop, ArrowRight moves and selects, aria-checked reflects value', () => {})
test('Sheet: role dialog, Escape and scrim click call onClose, Tab stays inside, focus returns to the opener', () => {})
test('Toast: role status, hides after 4000 ms (fake timers), action button fires', () => {})
test('Skeleton shows nothing before 300 ms and its block after', () => {})
test('EmptyState and PageHeader render title, body, action, context', () => {})
test('format helpers', () => { /* formatShortDate('2026-10-19') '19 Oct'; formatWeekday '2026-10-19' 'Mon'; phaseLabel('base2') 'Base 2'; phaseLabel('race') 'Race week' */ })
// nav.test.tsx
test('five items; More is active on /goals; aria-current marks exactly one item', () => {})
test('theme toggle cycles system, light, dark, sets data-theme and survives a storage error', () => {})
// api.test.tsx (mockApi)
test('every hook sends the contract method, URL, query string and JSON body', () => {
  // useActivities({from,to,type}) -> GET /api/activities?from=..&to=..&type=run; useCreateActivity -> POST; useUpdateActivity -> PUT /api/activities/:id;
  // useResolveDuplicate -> POST /api/activities/:id/duplicate {status}; useGeneratePlan -> POST /api/plan/generate; useUpdatePlanWeek -> PUT /api/plan/weeks/2026-03-02;
  // useSaveReview -> PUT /api/reviews/2026-03-02; useWeeks({from,to}) -> GET /api/weeks?from=..&to=..;
  // useImportFile({ kind: 'smashrun', fileName, text, distanceUnit: 'mi' }) -> POST /api/imports/smashrun with JSON { fileName, text, distanceUnit }; kind 'csv' -> POST /api/imports/csv
})
test('mutations invalidate the listed query roots (refetch counts)', () => {})
test('useMe is null on 401 and useLogout clears the cache', () => {})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run --project web tests/web/components.test.tsx tests/web/nav.test.tsx tests/web/api.test.tsx` — expected: FAIL.

- [ ] **Step 3: Implement components and layout**

Follow visual design sections 4 and 5 exactly: radii, heights, the Meter's dotted target tick, 85%-100% soft band and hatched overshoot, bottom tab bar at 56 px plus safe-area inset, 220 px rail with serif wordmark "Running log", sheet slide-up 220 ms and scrim fade 160 ms only (reduced-motion handled by the duration tokens), no hover lifts. Meter caption rule: under below 85% of target, near from 85% up to the target, over above it; hours via `minutesToHours1`.

- [ ] **Step 4: Implement hooks, charts theme and PWA files**

Hooks are thin `useQuery`/`useMutation` wrappers over `api` with `[keys.<resource>, params]` keys. `manifest.webmanifest`: `name "Running log"`, `short_name "Running log"`, `start_url "/"`, `display "standalone"`, `background_color "#f6f6f9"`, `theme_color "#3a36b5"`, one `image/svg+xml` icon with `sizes "any"` and `purpose "any maskable"`. `icon.svg`: a simple geometric mark in the accent on paper, no text. `web/index.html` links the manifest, sets `<meta name="theme-color">` and `lang="en"`. No service worker in v1 (installable, not offline).

- [ ] **Step 5: Run to verify pass, then check and commit**

Run the Step 2 command — expected: PASS. Run `npm run check` — expected: pass. Run `npm run dev` and open `http://localhost:5173` at 390 px and 1280 px width — expected: tab bar on the narrow view, rail on the wide one, theme toggle switches palettes.
```bash
git add web tests/web
git commit -m "feat(web): add layout, primitives, query hooks and manifest"
```

---

## Group C: web pages (Tasks 13-17, parallel)

Each task owns its page files (with `.module.css`) and one `tests/web/<name>.test.tsx`; hooks, primitives and `format.ts` come from Task 12 and are not edited. Page tests use `mockApi` and `renderWithProviders`, including a test with empty API responses (Review Focus 5). Copy follows visual design section 6: sentence case, plain, neutral about targets. Use `todayIso()` for today. Run one file with `npx vitest run --project web tests/web/<file>`.

### Task 13: Setup, Login and Settings pages

**Files:**
- Modify: `web/pages/SetupPage.tsx`, `web/pages/LoginPage.tsx`, `web/pages/SettingsPage.tsx` (+ `.module.css`)
- Test: `tests/web/auth-pages.test.tsx`

**Interfaces:**
- Consumes: `useSetup`, `useLogin`, `useLogout`, `useSettings`, `useUpdateSettings`, `Field`, `Input`, `Button`, `Segmented`, `PageHeader`, `useToast`, `useTheme`, `fieldErrors`, `ApiError`.
- Produces: default-route pages. Accessible names used by Task 18: Setup heading "Set up your training log", fields "Email", "Display name (optional)", "Password", "Confirm password", button "Create account"; Login heading "Sign in", fields "Email", "Password", button "Sign in"; Settings heading "Settings", `Segmented` "Distance units" with options "Miles" and "Kilometres", field "Display name", button "Save settings", button "Sign out", link "Export activities" (`/api/activities/export.csv`), theme control.

- [ ] **Step 1: Write the failing tests**

```ts
test('setup: mismatched confirmation shows "Passwords do not match" and posts nothing', async () => {})
test('setup: an 11-character password shows the server message under Password; success navigates to /', async () => {
  // before submit the hint under Password reads "At least 12 characters."; a 400 with issue { path: 'password', message: 'Use at least 12 characters.' }
  // replaces the hint with that message; body posted { email, password, displayName }
})
test('setup is not reachable once an account exists: needsSetup false redirects to /login', async () => {})
test('login: 401 shows "Invalid email or password" without clearing the email; 429 shows "Too many attempts. Try again in 15 minutes." from details.retryAfterSec; success lands on /', async () => {})
test('settings: switching to Kilometres PUTs { units: "km" } and toasts "Settings saved"; display name over 80 characters shows the error', async () => {})
test('settings: Sign out posts /api/auth/logout and returns to /login', async () => {})
test('settings with an empty display name renders without "null" or "undefined"', async () => {})
```

- [ ] **Step 2: Run to verify failure, implement, verify**

Run: `npx vitest run --project web tests/web/auth-pages.test.tsx` — expected: FAIL. Implement the three pages (server field errors via `fieldErrors`; the submit button shows `loading`; the password field has a show/hide toggle; Setup and Login are centred single-column layouts outside the `Layout`). Re-run — expected: PASS.

- [ ] **Step 3: Check and commit**

Run `npm run check` — expected: pass.
```bash
git add web/pages/SetupPage.tsx web/pages/SetupPage.module.css web/pages/LoginPage.tsx web/pages/LoginPage.module.css web/pages/SettingsPage.tsx web/pages/SettingsPage.module.css tests/web/auth-pages.test.tsx
git commit -m "feat(web): add setup, login and settings pages"
```

### Task 14: Activities page, activity form and import dialog

**Files:**
- Modify: `web/pages/ActivitiesPage.tsx`, `web/pages/ActivityForm.tsx`, `web/pages/ImportDialog.tsx` (+ `.module.css`)
- Test: `tests/web/activities.test.tsx`

**Interfaces:**
- Consumes: `useActivities useCreateActivity useUpdateActivity useDeleteActivity useResolveDuplicate useImportFile useSettings`, `Sheet Segmented Field Input Select Textarea Button EmptyState PageHeader Skeleton useToast`, `formatDuration formatPace formatDistance milesToM kmToM mToMiles mToKm`, `formatShortDate formatWeekday`.
- Produces: `ActivitiesPage` (heading "Activities", sticky primary button "Log activity", button "Import", filters, list; opens the add sheet when the URL has `?new=1`, shows only flagged rows when `?duplicates=1`); `ActivityForm(props: { open: boolean; onClose(): void; activity?: Activity })`; `ImportDialog(props: { open: boolean; onClose(): void })`; exported helpers `parseDurationInput(text: string): number | null` (bare number = minutes, `m:ss`, `h:mm:ss`; seconds and minutes parts below 60; 1 s to 150 h) and `parseDistanceInput(text: string, units: Units): number | null` (decimal point or comma; result in whole metres).

- [ ] **Step 1: Write the failing tests**

```ts
test('parseDurationInput', () => {
  // '45' 2700; '90' 5400; '45:30' 2730; '1:05:30' 3930; '0:45:00' 2700; '' null; '0' null; 'abc' null; '1:75' null; '49:00:00' null
})
test('parseDistanceInput: 5 mi -> 8047, 5,2 km -> 5200, "-1" and "abc" -> null', () => {})
test('empty list shows "No activities yet." with Log and Import actions, never an error', async () => {})
test('rows show date, type, duration, distance and pace in the user units (mi and km)', async () => {
  // 2700 s / 8047 m for mi -> '45:00', '5.00 mi', '9:00 /mi'; for km -> '8.05 km', '5:36 /km'; strength rows have no pace; null distance shows an en dash
})
test('quick log: date defaults to today, type Run, entering 45 and 5 posts { date, type: "run", durationSec: 2700, distanceM: 8047 } and toasts "Run saved"', async () => {})
test('an invalid duration shows "Enter minutes like 45, or 0:45:00" under Duration and posts nothing; the sheet keeps the entries when the server fails', async () => {})
test('More details holds Start time, RPE chips 1 to 10, Average HR, Max HR, Elevation gain and Notes', async () => {})
test('editing an imported row PUTs; Delete asks for confirmation; deleting a manual row toasts "Activity deleted" with Undo that re-posts it', async () => {})
test('a possible duplicate shows a "Possible duplicate" badge with "Confirm duplicate" and "Not a duplicate" buttons that POST the status', async () => {})
test('?new=1 opens the sheet; ?duplicates=1 filters to flagged rows', async () => {})
test('import dialog: choosing a file and Import file posts JSON { fileName, text, distanceUnit } then shows "3 imported, 0 already imported, 0 skipped" and the per-row reasons', async () => {})
```

- [ ] **Step 2: Run to verify failure, implement, verify**

Run: `npx vitest run --project web tests/web/activities.test.tsx` — expected: FAIL. Implement. Form layout follows visual design section 4 (date, type segmented with Run default, duration, distance; the rest behind "More details"; the Distance label reads "Distance (mi)" or "Distance (km)"; Elevation gain is entered in feet for `mi` users and metres for `km` users and stored in metres; Strength hides Distance). The list is grouped under date headings and filtered by a type `Segmented` ("All, Run, Race, Strength, Cross") and "From"/"To" date fields. `ImportDialog` sends `utcOffsetMinutes = -new Date().getTimezoneOffset()` and defaults the unit to the user's setting. Re-run — expected: PASS. Run `npm run check` — expected: pass.

- [ ] **Step 3: Commit**
```bash
git add web/pages/ActivitiesPage.tsx web/pages/ActivityForm.tsx web/pages/ImportDialog.tsx web/pages/*.module.css tests/web/activities.test.tsx
git commit -m "feat(web): add activities list, quick log form and import dialog"
```

### Task 15: Goals and Plan pages

**Files:**
- Modify: `web/pages/GoalsPage.tsx`, `web/pages/PlanPage.tsx` (+ `.module.css`)
- Test: `tests/web/goals.test.tsx`, `tests/web/plan.test.tsx`

**Interfaces:**
- Consumes: `useGoals useCreateGoal useUpdateGoal useDeleteGoal useActivateGoal usePlan useGeneratePlan useUpdatePlanWeek useWeeks useSettings`, primitives, `format.ts`, `isCutbackIndex BUILD_PHASES` from `shared/domain/plan.ts`, `minutesToHours1`, `mondayOf todayIso`.
- Produces: `GoalsPage` (heading "Goals", button "Add goal", sheet form with "Name", "Priority" A/B/C, "Status", "Race date", checkbox "Date is provisional", distance preset buttons "5K" "10K" "Half" "Marathon" "50K" "50 mi" "100K" "100 mi" plus a custom "Distance (mi|km)" field, "Location", "Success criteria", "Notes", "Link"; active goal badge "Active goal"; button "Make active"); `PlanPage` (heading "Plan"; generate form with "Goal", "Weekly run minutes", "Plan start (Monday)", "Strength sessions per week" Segmented 0/1/2, button "Generate plan"; week table; edit-week sheet with "Target (minutes)", "Long run (minutes)", "Day 2 (minutes)", "Run days", "Strength sessions", "Focus", "Override note", buttons "Reset to baseline" and "Save week"; button "Regenerate plan").

- [ ] **Step 1: Write the failing tests**

```ts
// goals.test.tsx
test('empty state "No goals yet." with an Add goal action', async () => {})
test('creating a goal posts metres: Marathon preset -> distanceM 42195; custom 10 mi -> 16093; km user custom 12 -> 12000; the date is not shifted by timezone', async () => {})
test('invalid link shows the server error under Link; Make active posts /activate and only one badge shows; delete asks for confirmation and surfaces a 409 message', async () => {})
// plan.test.tsx
test('no plan: shows "No plan yet. Choose a goal race, then generate weekly targets." and the generate form; no goals shows an Add goal link instead', async () => {})
test('generate posts { goalId, baselineRunMin, startDate, strengthPreference } and shows the server validation message inline (for example no baseline)', async () => {})
test('week table: phase chips with --phase-level 1..6 (taper and race dashed), cutback rows italic with the word "cutback", race row emphasised, current week aria-current="date", targets via minutesToHours1', async () => {})
test('edited week shows the baseline struck through, "edited" and the note on focus; a review-sourced week shows "from review"', async () => {})
test('actual hours appear for past weeks from useWeeks and are absent for future weeks', async () => {})
test('edit week: target different from baseline without a note shows "Add a note explaining the change" and posts nothing; with a note PUTs { targetRunMin, overrideNote }; Reset to baseline PUTs the baseline value', async () => {})
test('Regenerate plan explains that edited weeks are not carried over and reviews are kept, then posts generate', async () => {})
```

- [ ] **Step 2: Run to verify failure, implement, verify**

Run: `npx vitest run --project web tests/web/goals.test.tsx tests/web/plan.test.tsx` — expected: FAIL. Implement per visual design section 5 (week table row: two-line list on phones, true table from 900 px with columns Week, Phase, Target, Actual, Long run, Day 2, Run days, Strength, Focus; the `PhaseChip` lives in `PlanPage.tsx`). Goal dates stay strings end to end. Re-run — expected: PASS. Run `npm run check` — expected: pass.

- [ ] **Step 3: Commit**
```bash
git add web/pages/GoalsPage.tsx web/pages/PlanPage.tsx web/pages/*.module.css tests/web/goals.test.tsx tests/web/plan.test.tsx
git commit -m "feat(web): add goals and plan pages"
```

### Task 16: Review page

**Files:**
- Modify: `web/pages/ReviewPage.tsx` (+ `.module.css`)
- Test: `tests/web/review.test.tsx`

**Interfaces:**
- Consumes: `useReviews useSaveReview usePlan useWeeks useActivities`, primitives, `format.ts`, `suggestAction` from `shared/domain/review.ts`, `minutesToHours1`, `addDays mondayOf todayIso`.
- Produces: `ReviewPage` (heading "Review"). Controls: buttons "Previous week" and "Next week" around the label "Week of 12 Oct"; `Segmented` "Data status" with "Data complete" and "Missing data"; `Segmented` "Fatigue (1-10)" with ten options; `Segmented` "Symptoms" with "None", "Mild", "Persistent"; checkbox "Recovery is constrained"; a suggestion region headed "Suggested action" showing the action name, the reason and "Suggested next week: 330 min (5.5 h)"; `Segmented` "Final decision" with "Progress", "Hold", "Repeat", "Reduce"; field "Next week minutes"; field "Notes"; button "Save review"; a history list of reviewed weeks.

- [ ] **Step 1: Write the failing tests**

```ts
test('default week is the latest finished week without reviewedAt, else the latest finished week', async () => {})
test('shows the week summary: run time against target with Meter, run days against target, longest run share, strength sessions', async () => {})
test('the suggestion updates live from the form using suggestAction: fatigue 8 -> Reduce with 70% next minutes; fatigue 4 + symptoms None + 300 of 300 min -> Progress 330', async () => {})
test('final decision defaults to the suggested action and Next week minutes to the suggested minutes; both stay editable', async () => {})
test('Save review PUTs { dataStatus: "complete", fatigue: 4, symptoms: "none", recoveryConstrained: false, finalDecision: "progress", finalNextMin: 330, notes } and toasts "Week of 12 Oct saved"', async () => {})
test('a current or upcoming week shows its reason, disables Final decision and says it becomes available once the week is finished', async () => {})
test('possible duplicates in the week show review_duplicates guidance with a link to /activities?duplicates=1', async () => {})
test('a week outside the plan says there is no plan for it and offers no suggestion', async () => {})
test('empty states: no plan and no runs shows "Nothing to review. Last week is closed." or the no-plan message, never NaN', async () => {})
test('history lists reviewed weeks with decision and next minutes', async () => {})
```

- [ ] **Step 2: Run to verify failure, implement, verify**

Run: `npx vitest run --project web tests/web/review.test.tsx` — expected: FAIL. Implement. The live suggestion is computed client-side with the shared `suggestAction` from the plan week, the following week's baseline, the `WeekRow`, `possible` duplicates among that week's activities, and the unsaved form values; the server recomputes on save. The week picker covers the last 12 finished weeks plus the current one, regardless of plan. Re-run — expected: PASS. Run `npm run check` — expected: pass.

- [ ] **Step 3: Commit**
```bash
git add web/pages/ReviewPage.tsx web/pages/*.module.css tests/web/review.test.tsx
git commit -m "feat(web): add the weekly review page"
```

### Task 17: Dashboard and Stats pages

**Files:**
- Modify: `web/pages/DashboardPage.tsx`, `web/pages/StatsPage.tsx` (+ `.module.css`)
- Create: `web/components/charts/WeeklyHoursChart.tsx` (+ `.module.css`)
- Test: `tests/web/dashboard.test.tsx`, `tests/web/stats.test.tsx`

**Interfaces:**
- Consumes: `useGoals usePlan useWeeks useActivities useReviews useSettings`, `Meter PageHeader EmptyState Skeleton`, `chartColors axisProps gridProps ChartTooltip`, `remainingPlan`, `monthlyTotals yearlyTotals fastestEfforts longestRuns`, `daysBetween addDays mondayOf todayIso`, `phaseLabel`, `formatShortDate`, unit formatters.
- Produces: `DashboardPage` (title "Today", context "Week of 19 Oct, Base 2"); `StatsPage` (title "Stats"); `WeeklyHoursChart(props: { weeks: WeekRow[]; planned?: Array<{ weekStart: string; targetRunMin: number }>; ariaLabel: string })` (planned as an outlined unfilled bar behind a narrower solid actual bar, `aria-label`, and a visually hidden data table of the same figures).

- [ ] **Step 1: Write the failing tests**

```ts
// dashboard.test.tsx (fixed clock 2026-03-18, a Wednesday)
test('hero: week hours as the display figure ("6.4"), "h of 7.5 h target", a Meter, and the line "Base 2, week 5 of 18"', async () => {})
test('"87 days to the race" from daysBetween and "34 min a day left, through Sunday" with the caption "advisory" from remainingPlan', async () => {})
test('run days and strength are stated against target as text ("3 of 4 run days", "1 of 2 strength sessions")', async () => {})
test('last 28 days strip and the last 12 weeks chart expose their data in a visually hidden table', async () => {})
test('data-health flags: possible duplicates link to /activities?duplicates=1; past plan weeks without complete data link to /review; a finished unreviewed week shows "Last week is ready to review."', async () => {})
test('"Log activity" links to /activities?new=1', async () => {})
test('new account: no goal and no plan shows "No plan yet. Choose a goal race, then generate weekly targets." with a link to /goals; a plan with no runs says "No runs this week yet. Log one when you\'re out."; no NaN, Infinity or "0:00" anywhere', async () => {})
test('race day shows "Race day" and a past race date shows no countdown', async () => {})
// stats.test.tsx
test('monthly totals, yearly totals, longest runs and fastest efforts render from activities in the user units', async () => {})
test('fastest efforts with sparse data say which distances have no qualifying run and that a run counts within 2% over the distance', async () => {})
test('weekly history table lists the last 26 weeks with run hours, runs, run days and long-run share (an en dash when null)', async () => {})
test('no runs: "No runs yet. Stats appear after the first run." and no charts', async () => {})
```

- [ ] **Step 2: Run to verify failure, implement, verify**

Run: `npx vitest run --project web tests/web/dashboard.test.tsx tests/web/stats.test.tsx` — expected: FAIL. Implement the hierarchy of visual design section 4 (one display-size figure, the two secondary figures at `--text-xl`, hairline rules, no boxes or sparklines on those three). Data: `useActivities` for the last 90 days (28-day strip, flag counts, `hasRunToday`), `useWeeks` and `useReviews` for the last 12 weeks, `useGoals` for the active goal, `usePlan` for the current week. Stats uses all activities for totals and `useWeeks` for the last 26 weeks; efforts show the whole-run time and pace in the user's units with the run date. Charts follow visual design section 7 (no legend; "Solid is actual, outline is planned" in the caption). Re-run — expected: PASS. Run `npm run check` — expected: pass.

- [ ] **Step 3: Commit**
```bash
git add web/pages/DashboardPage.tsx web/pages/StatsPage.tsx web/components/charts/WeeklyHoursChart.tsx web/components/charts/WeeklyHoursChart.module.css web/pages/*.module.css tests/web/dashboard.test.tsx tests/web/stats.test.tsx
git commit -m "feat(web): add the dashboard and stats pages"
```

---

## Group D: end to end and finish (Task 18, sequential)

### Task 18: Golden paths, Docker verification, docs

**Files:**
- Create: `tests/e2e/golden-paths.spec.ts`
- Modify: `README.md`, `CLAUDE.md`, `docs/adr/0001-clean-rewrite.md`, `0002-cookie-session.md`, `0003-units-and-dates.md`, `0004-single-test-runner.md`; `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml` only if verification finds a defect

**Interfaces:**
- Consumes: the accessible names listed in Tasks 13-16 and `tests/fixtures/smashrun-sample.csv`.
- Produces: a serial Playwright describe (one database for the run, steps share state) and the finished docs.

- [ ] **Step 1: Write the golden-path spec**

`test.describe.configure({ mode: 'serial' })`; dates computed in the test from `todayIso`-equivalent local dates (never hard-coded): `lastWednesday` = the Wednesday of last week, `planStart` = the Monday three weeks ago, `raceDate` = the Saturday 20 weeks ahead. Synthetic data only (`runner@example.com`, goal "Test marathon").

```ts
test('1 setup, sign out, sign in', async ({ page }) => {
  // / redirects to /setup; create the account (password of 12+ characters); land on the "Today" heading
  // Settings -> Sign out -> /login; sign in with the same credentials; reload keeps the session
})
test('2 log activities', async ({ page }) => {
  // Log activity: date lastWednesday, Duration 45, Distance 5 -> toast "Run saved"; row shows "45:00" and "5.00 mi"
  // Log a second run on 2026-03-02 with distance 3.1 (a manual twin of fixture row 1001)
})
test('3 import the fixture CSV and resolve the duplicate', async ({ page }) => {
  // Import -> Smashrun CSV, unit mi, file tests/fixtures/smashrun-sample.csv -> "3 imported, 0 already imported, 0 skipped"
  // importing again -> "0 imported, 3 already imported, 0 skipped"
  // the manual 2026-03-02 run shows "Possible duplicate"; "Confirm duplicate" removes the badge and the dashboard flag count drops to zero
})
test('4 goal and plan', async ({ page }) => {
  // Goals -> Add goal "Test marathon", priority A, raceDate, Marathon preset -> Make active
  // Plan -> Weekly run minutes 150, Plan start planStart, Generate plan -> a table with a "Restart" chip and a "Race week" row
  // edit a week: target 200 without a note -> "Add a note explaining the change"; add a note -> saved, row shows "edited"
})
test('5 complete a review', async ({ page }) => {
  // Review opens on last week; Data complete, Fatigue 3, Symptoms None; a suggestion with a reason is visible; Next week minutes 160; Save review -> toast
  // Plan: the current week now shows "2.7" hours with the source marked "from review"
})
```

Run: `npm run test:e2e` — expected: all steps pass on a fresh database. If a step fails because a page lacks an accessible name from the earlier tasks, fix the page in the smallest way and note it in the commit body.

- [ ] **Step 2: Verify the Docker image**

Run `docker build -t running-log:test .`, then run it with a named volume, `SESSION_SECRET` of 40 characters and `-p 3101:3001`. Check: `curl -s localhost:3101/api/health` returns `{"status":"ok"}`; `docker inspect --format '{{.State.Health.Status}}'` reaches `healthy`; `curl -s -H 'Origin: http://localhost:3101' -H 'Content-Type: application/json' -d '{"email":"runner@example.com","password":"correct horse battery"}' localhost:3101/api/setup` returns 201; stop and start the container with the same volume and `POST /api/auth/login` still succeeds (data persisted); `docker exec` shows `id -u` is not 0; `docker compose config` with `SESSION_SECRET` unset fails with the "set SESSION_SECRET" message. If Docker is not available, record "Docker build not verified" in the final report instead of claiming it.

- [ ] **Step 3: Finish README, CLAUDE.md and ADRs**

`README.md`: what the app is (one runner, self-hosted); quick start (`nvm use`, `cp .env.example .env`, `openssl rand -base64 48` into `SESSION_SECRET`, `npm ci`, `npm run db:migrate`, `npm run dev`, open `http://localhost:5173`, create the account); scripts table; environment table of the six variables plus `TZ` for Docker; Docker (`docker compose up -d`, volume `/data`, bind mounts need `chown 1000:1000`); importing a Smashrun CSV (distance unit choice, idempotent re-imports, duplicate review); password reset (`npm run reset-password -- <email>`, in Docker `docker compose exec app node dist/scripts/reset-password.js <email>`); rotating `SESSION_SECRET` logs the owner out; backup note (`sqlite3 /data/app.db ".backup 'backup.db'"` while WAL is on); installable as a home-screen app, no offline mode; privacy (no telemetry, no third-party requests). `CLAUDE.md` (short): commands, the three source roots, conventions (relative imports with extensions, date strings, metres/seconds/minutes, errors through `HttpError`, route/service split, hooks in `web/api`), testing conventions (API tests use `tests/api/helpers.ts`, fixtures are synthetic, one runner), commit rules, and the rule that Claude attribution never goes into commits or PRs.
After the PR is opened, replace each ADR status line `Proposed 2026-10-21` with `Accepted 2026-10-21 (#<PR number>)`.

- [ ] **Step 4: Whole-branch verification and commit**

Run: `npm run check && npm run build && npm run test:e2e` — expected: all pass. Push and confirm the CI run is green (lint, typecheck, unit and API tests, build, Playwright) before declaring the rewrite done.
```bash
git add tests/e2e README.md CLAUDE.md docs/adr Dockerfile docker-compose.yml .github
git commit -m "test: add golden-path e2e; docs: finish README, CLAUDE.md and ADRs"
```
