# Running app rewrite — design

Status: Accepted 2026-10-21 by the owner's instruction ("rewrite whatever you want"); the
calls below marked **(call)** were made by the builder session, not the owner.

## 1. Intent

A personal training log and planner for one runner, self-hosted, used daily from a phone and
weekly from a laptop. It replaces two things: the existing `running-app-mvp` code (a small
Strava-style log buried under enterprise scaffolding, audited 2026-10-21 at 2/5 with almost
nothing worth keeping) and the owner's Google Sheets training tracker, whose workflow is the
real product spec. The sheet already does the hard thinking; the app makes that workflow
fast, trustworthy and pleasant.

The sheet's own words set the tone: "Targets are a sketch, not minimums." "Keep training
mostly easy. Progress volume only when sleeping, recovering and feeling well." "Recovery and
symptoms govern decisions; do not force missed hours into future weeks." "This is
training-planning support, not an injury-prediction or medical clearance system."

## 2. Goals, non-goals, anti-goals

Goals (v1, all required for "done"):

1. **Activities.** Log a run, race, strength or cross-training session in under 20 seconds on
   a phone. Import a Smashrun CSV export idempotently. Edit and delete. Flag likely
   duplicates between manual and imported runs.
2. **Goals.** A small registry of goal races (A/B/C priority, target date, distance,
   success criteria). One goal is _active_ and drives the plan.
3. **Plan.** Generate Monday-start weekly targets from today to the active goal's race week:
   phase, run hours, long-run minutes, optional second long day, run days, strength
   sessions, focus text. Every week stays editable; the generated value is kept as the
   baseline so edits are visible.
4. **Weekly review.** For each finished week: confirm the data is complete, enter fatigue,
   symptoms and recovery, read a computed _suggested action_ with its reason, record the
   final decision and next-week hours. The next week's working target follows the sheet's
   adaptive rule.
5. **Dashboard.** Days to race, current week and phase, this week's hours and run days and
   strength against target, remaining minutes per day, last 28 days, last 12 weeks,
   data-health flags, and a nudge when a review is due.
6. **Stats.** Weekly and monthly history, longest runs, fastest efforts by distance, yearly
   totals.
7. **Rock solid.** Green CI on every push: lint, typecheck, unit and API tests, build, and
   Playwright golden paths. One command to run locally, one Docker image to deploy.
8. **Shine.** A distinctive, calm visual design that works at phone width, in light and dark,
   installable as a home-screen app.

Non-goals (deliberately later; the schema must not block them):

- Readiness and race-decision gates as stored human decisions (v1 shows the computed
  evidence counts only where cheap).
- Long-run lab, fueling log, specificity tracker, race-prep checklist, strength program and
  per-exercise log, training blocks and goal calendar.
- Live Smashrun, Strava or Garmin sync; GPS routes and maps; heart-rate zones.
- Multi-user, social features, sharing, public profiles.
- Migrating data from the old app's database (it was never deployed; the owner's history
  lives in Smashrun and the sheet and arrives through CSV import).

Anti-goals (would make v1 a failure even if it "works"):

- Any automatic change to a training target without the owner's decision. Suggestions
  explain themselves; people decide.
- A plan that makes up missed volume in later weeks.
- Silent data loss on import (unparseable rows must be reported, not dropped).
- Red or flaky CI, skipped tests, or test suites that only run in deploy workflows.
- Generated-looking sprawl: duplicate components, speculative abstractions, config knobs
  nobody set.

## 3. Constraints

- Public GitHub repository: no personal data (runs, race choices, emails, local paths) in
  code, fixtures, docs or commits. Test fixtures are synthetic.
- Solo owner; other Claude sessions may work in the repo concurrently. Bare repo with
  worktrees (`~/src/BARE-REPO-WORKFLOW.md`).
- Keep the repository's package manager (npm) and the owner's usual tools in sibling repos:
  TypeScript, ESLint 9 flat config, Prettier, Vitest, Playwright.
- No live deployment exists today; nothing to keep compatible with.
- Node 24 locally (Volta); `engines` `>=22`.

## 4. Decisions made **(call)**

### 4.1 Architecture

One npm package, one process in production: an Express 5 API that also serves the built
React app. SQLite through Prisma. Three source roots:

```
server/   Express app: config, db, auth, routes, error handling, logging
shared/   pure domain code used by both sides: units, weeks, plan, review, stats, importers
web/      React 18 + Vite SPA: pages, components, api client, styles
prisma/   schema and migrations
tests/    unit (shared), api (supertest against a temp SQLite file), e2e (Playwright)
```

Reasons. Fact: the existing app already runs this stack and the owner's sibling repos use
Vite, Vitest and Playwright. Opinion: a single process with SQLite is the simplest thing that
is robust for one user; it removes CORS, token refresh, and multi-service deploys. The
domain lives in `shared/` as pure functions so the dashboard can compute from fetched rows
without a bespoke endpoint per number, and so every rule has a fast unit test.

Rejected: Next.js/Remix (new toolchain the owner does not use elsewhere); Hono or Fastify
(fine, but Express 5 is already known and adequate); Postgres (operational cost for one
user); keeping the old code (audit: 2/5, three loggers, three chart families, red CI).

### 4.2 Authentication

Single account. First run shows a setup page that creates the account; afterwards
registration is closed unless `ALLOW_REGISTRATION=true`. Login sets an httpOnly, SameSite=Lax
cookie holding a signed JWT (30 days). Mutating requests must carry a matching `Origin` or
`Sec-Fetch-Site: same-origin` header. Logout clears the cookie. No refresh tokens, no
localStorage tokens, no token blacklist.

Reasons. Fact: the audit found tokens in localStorage, an in-memory logout blacklist and a
production login bypass. Opinion: for a same-origin SPA a cookie session is both simpler and
safer. Passwords hashed with bcrypt (cost 12), minimum 12 characters, no composition rules.

### 4.3 Units and time

- Distance stored in **metres (Int)**, duration in **seconds (Int)**, plan targets in
  **minutes (Int)**. Display units follow a user setting, default miles; pace is derived.
- Activity `date` is a **calendar date string `YYYY-MM-DD`** in the runner's local day, with
  an optional `startTime` `HH:MM`. No UTC-midnight DateTime for dates (the audit found a
  day-shift bug caused by exactly that).
- Weeks start **Monday**, fixed in v1. Week keys are the Monday's date string.
- Hours shown with one decimal; minutes as integers.

### 4.4 Data model (Prisma, SQLite)

```
User          id, email (unique), passwordHash, displayName?, units ('mi'|'km', default 'mi'),
              createdAt, updatedAt
Activity      id, userId, date, startTime?, type ('run'|'race'|'strength'|'cross'),
              durationSec, distanceM?, rpe? (1-10), avgHr?, maxHr?, elevationGainM?,
              notes?, source ('manual'|'smashrun'), providerKey? (unique per user),
              importBatchId?, duplicateOfId?, duplicateStatus ('none'|'possible'|'confirmed'|'dismissed'),
              createdAt, updatedAt
              index (userId, date); unique (userId, providerKey)
ImportBatch   id, userId, source, fileName?, rowCount, accepted, skippedDuplicate,
              skippedInvalid, errors (JSON text), createdAt
Goal          id, userId, name, priority ('A'|'B'|'C'), status ('target'|'considering'|'done'|'dropped'),
              targetDate, dateProvisional (Bool), distanceM?, location?, successCriteria?,
              notes?, url?, isActive (Bool), createdAt, updatedAt
Plan          id, userId, goalId, name, startDate (Monday), raceWeekStart, status ('active'|'archived'),
              generatorVersion, createdAt, updatedAt
PlanWeek      id, planId, weekStart (unique per plan), index, phase, focus?,
              baselineRunMin, targetRunMin, longRunMin, day2Min?, runDays, strengthSessions,
              overrideNote?, updatedAt
WeeklyReview  id, userId, weekStart (unique per user), dataStatus ('unconfirmed'|'complete'|'missing'),
              fatigue? (1-10), symptoms ('none'|'mild'|'persistent'), recoveryConstrained (Bool),
              suggestedAction?, suggestedReason?, suggestedNextMin?, finalDecision?,
              finalNextMin?, notes?, reviewedAt?, createdAt, updatedAt
```

Free-text enums are validated with zod at the API edge and typed as string unions in
`shared/`. Derived numbers (weekly totals, completion, streaks) are never stored.

### 4.5 Domain rules (`shared/domain`)

Activities and weeks:

- Run minutes = sum of `run` durations; race minutes separate; strength and cross never
  count as running. Run days = distinct dates with a run. Weekly rows carry run minutes,
  run metres, run sessions, run days, strength sessions, cross minutes, race minutes,
  longest run minutes, long-run share (longest ÷ run minutes), 4-week average run minutes,
  and 3-plus-runs streak (consecutive weeks ending at this week with ≥3 runs).
- Activities with `duplicateStatus` `possible` or `confirmed` are excluded from totals.

Import (Smashrun CSV):

- Accept the 26-column Smashrun export (`Run Id, Source, Key, Distance, Duration (ms),
Duration, Speed, HR Average, HR Max, HR Min, Start Date, Start Date (utc), Created Date
(utc), Updated Date (utc), Is Deleted, Is Manual Edit, Elevation Gained, Elevation Lost,
Hill Difficulty, SPI, Description, Tags, PowerAverage, PowerMax, PowerFormAverage,
PowerFormMax`) with or without a header row and with an optional leading index column.
  Distance is miles, duration from milliseconds, start date `YY/MM/DD HH:MM` local.
- Identity: `providerKey = smashrun:<Run Id>`; the raw `Key` is kept in notes-free metadata
  only if needed. A row is accepted when its key is new for the user, `Is Deleted` is false,
  the date parses and distance and duration are positive. Everything else is reported per
  row (skipped duplicate / skipped invalid with reason). Re-importing the same file changes
  nothing.
- After import, any manual run on the same date within 80 m (0.05 mi) of an imported run is
  marked `possible` duplicate and excluded until the owner confirms or dismisses it.
- Also accept a minimal generic CSV (`date, type, minutes, miles, notes`) for hand-kept logs.

Plan generation (`generatePlan`):

- Inputs: start Monday, race date, distance class, baseline weekly run minutes (median of
  the last 4 confirmed weeks, or user-entered), and strength preference.
- Phases, in order, with their share of the weeks before taper: Restart (≥3 weeks, ~10%),
  Base 1 (~19%), Base 2 (~19%), Endurance (~19%), Specific (~12%), Peak (~14%); then Taper
  (2 weeks for ≥30-week plans, else 1) and Race week (1). Whole weeks are allocated by
  largest remainder so the total is exact.
- Hours ramp linearly within each phase between that phase's floor and ceiling. Ceilings by
  distance class (hours/week at peak) **(call, editable per week)**: `≤10K` 5, `half` 6,
  `marathon` 8, `50K–50mi` 9, `100K–100mi` 9.5. The first week is never above the baseline
  plus 15%. Every 4th week is a cutback at 75–80% of the previous week and drops one run
  day. Taper weeks are ~65% then ~45% of the last build week; race week ~1.5 h with 2 run
  days.
- Long-run minutes ≈ 27 × weekly hours, capped at 240 and never above 40% of the week.
  Day-2 (back-to-back) minutes appear only from Endurance onward and only in build weeks.
- Run days 3 → 4 → 5 by phase; strength 2 through Base 2, 1–2 in Endurance and Specific, 1
  in Peak, 0 in Taper and Race week.
- Weeks already in the past when generating are created with their actual data untouched;
  the plan is truncated at race week.

Weekly review (`suggestAction`): evaluate in this order and return the first match with a
one-sentence reason.

1. `upcoming` — week starts after today.
2. `in_progress` — week contains today.
3. `await_data` — past week whose `dataStatus` is not `complete`.
4. `review_duplicates` — the week has `possible` duplicates.
5. `reduce` — fatigue ≥ 8, or symptoms `persistent`, or recovery constrained.
6. `repeat` — run minutes < 70% of target, or run days < 3 (or a confirmed zero-run week).
7. `needs_recovery_review` — fatigue or symptoms not recorded.
8. `hold` — symptoms `mild`, or fatigue 6–7, or 70–85% of target **(call: the sheet leaves
   this band undefined)**.
9. `progress` — fatigue ≤ 5, no symptoms, ≥ 85% of target, ≥ 3 runs.

Suggested next-week minutes: `progress` → min(next week's baseline, this week's target +
10%); `hold` → this week's target; `repeat` → this week's target (never lower than 50% of
baseline); `reduce` → 70% of this week's target. Never above the next week's baseline.
Taper and race weeks always return `hold` with reason "taper".

Working target for a week = manual override (an edited `targetRunMin` with
`overrideNote`) → previous week's `finalNextMin` if that week is `complete` and has
`reviewedAt` → baseline. Expose the reason ("override", "from review", "baseline;
previous week unconfirmed").

Workout adaptation (dashboard): remaining = max(0, target − run minutes so far);
remaining days = days left through Sunday including today; suggested per day =
round(remaining ÷ remaining days), shown as advisory.

Stats: fastest efforts for 1 mi, 5K, 10K, half, marathon, 50K computed from runs whose
distance is within 2% above the target distance, ranked by pace; weekly and monthly totals;
longest runs; yearly totals by distance and time.

### 4.6 API (JSON, `/api`, cookie auth)

```
GET  /api/health                         {status:'ok'}
GET  /api/setup                          {needsSetup:boolean}
POST /api/setup                          create first user, sets cookie
POST /api/auth/login | /logout           ; GET /api/auth/me
GET/PUT /api/settings                    units, displayName
GET  /api/activities?from&to&type        ; POST ; GET/PUT/DELETE /:id
POST /api/activities/:id/duplicate       {status:'confirmed'|'dismissed'}
POST /api/imports/smashrun (multipart)   returns ImportBatch with per-row report
GET  /api/imports                        list batches
GET  /api/activities/export.csv
CRUD /api/goals ; POST /api/goals/:id/activate
GET  /api/plan                           active plan with weeks
POST /api/plan/generate                  {goalId, baselineRunMin?, startDate?}
PUT  /api/plan/weeks/:weekStart          edit a week (sets overrideNote)
GET  /api/reviews?from&to ; PUT /api/reviews/:weekStart
GET  /api/weeks?from&to                  computed weekly rows (server-side aggregate)
```

Errors: `{error:{code, message, details?}}` with codes `validation`, `unauthorized`,
`not_found`, `conflict`, `internal`. Zod on every body and query. Request id header.

### 4.7 Frontend

Routes: `/setup`, `/login`, `/` dashboard, `/activities` (list, filters, add/edit sheet,
import), `/plan` (week table with phases, generate and edit), `/review` (current and past
weeks), `/goals`, `/stats`, `/settings`. Mobile-first; a bottom tab bar on phones, a side
rail on wide screens. TanStack Query for data; CSS modules with design tokens; `recharts`
for the few charts; no component library. Light and dark via `prefers-color-scheme` with a
manual override. PWA manifest and icon. The visual direction is decided by the
`frontend-design` skill at build time: calm, editorial, high contrast, one accent.

### 4.8 Tooling, CI, deploy

- `package.json` scripts: `dev`, `build`, `start`, `lint`, `format`, `typecheck`, `test`,
  `test:e2e`, `db:migrate`, `db:studio`, `check` (lint + typecheck + test). No postinstall.
- Vitest with two projects (node for `server/` and `shared/`, jsdom for `web/`); supertest
  API tests against a temporary SQLite file per test file; Playwright chromium golden paths:
  setup and login, log an activity, import a CSV, generate a plan, complete a review.
- ESLint 9 flat config with typescript-eslint and react-hooks; Prettier; strict TypeScript.
- GitHub Actions: `ci.yml` (one job matrix-free: install, lint, typecheck, test, build, e2e)
  and `codeql.yml`. Dependabot: npm weekly with minor and patch grouped; actions monthly.
- Docker: multi-stage image on `node:24-slim`, `prisma migrate deploy` then `node dist/server`,
  SQLite on a volume at `/data`, non-root user, HEALTHCHECK on `/api/health`.
  `docker-compose.yml` with one service.
- Repo hygiene: everything not in the new tree is removed (git history keeps it): the 32
  root markdown files, `docs/` reports, 17 workflows, deployment/monitoring/nginx, vendored
  `packages/`, old `src/ server/ tests/ e2e/`. Kept: `LICENSE`, a new `README.md`, a short
  `CLAUDE.md`, this spec, ADRs under `docs/adr/`.

### 4.9 Environment

`DATABASE_URL` (default `file:./data/app.db`), `SESSION_SECRET` (≥32 chars; generated into
`.env` by the setup script if missing), `PORT` (3001), `NODE_ENV`, `ALLOW_REGISTRATION`
(false), `LOG_LEVEL`. Nothing else.

## 5. Left to the builders

- Exact visual design, typography and colour tokens (use the frontend-design skill).
- Component boundaries inside `web/`, the API client shape, query keys.
- Prisma migration naming; whether `shared/` compiles via path alias or a package export.
- CSV parsing library versus a small hand-written parser (either; must handle quoted fields
  and CRLF).
- Chart choices on Stats and the dashboard (recharts, kept minimal).
- How much of the Stats page's "fastest efforts" to show when data is sparse.

## 6. Open questions for the owner (answered by assumption for now)

1. Distance class ceilings and the 70–85% band rule are the builder's calls; adjust in
   `shared/domain/plan.ts` and `review.ts` constants.
2. Race date for the active goal is entered by the owner; the app never guesses it.
3. Strength and cross sessions are counted but not programmed; a program builder is later.
4. Km display exists but miles is the default and the tested path.

## 7. Resolutions from the builder check **(all calls)**

A fresh reader of sections 1–6 raised these; each answer refines the section named.

1. **Short plans (4.5).** Weeks = Mondays from the start to the race week inclusive. Race
   week = 1. Taper = 2 if weeks ≥ 24, 1 if weeks ≥ 8, else 0. The rest is split among
   Restart, Base 1, Base 2, Endurance, Specific, Peak with shares 10:19:19:19:12:14 by
   largest remainder. If the rest is ≥ 6 every phase gets at least 1 week; if it is 1–5, use
   only Base 1 and Peak split evenly (Base 1 first); if it is 0, the plan is taper and race
   only. Restart is skipped when the baseline already exceeds the Base 1 floor.
2. **Duplicates (4.5).** The newer manual row is the duplicate: it gets `duplicateOfId`
   pointing at the imported row and `duplicateStatus = 'possible'`; the imported row keeps
   counting. Confirm → the manual row becomes `confirmed` and stays excluded; dismiss →
   `dismissed`, counted. The near-duplicate pass runs on every import and on every manual
   create or edit, comparing against same-date runs of a different source within 80 m. Rows
   from the same import source are never duplicates of each other (the key handles that).
3. **Data status (4.4, 4.5).** Set only by the owner on the review page: a "Data complete"
   control with an alternative "Missing data". Never set automatically. A week confirmed
   complete with zero runs is the "confirmed zero-run week". `missing` behaves like
   `unconfirmed` for the working-target chain.
4. **Working target (4.4, 4.5).** `PlanWeek.targetRunMin` _is_ the working target, stored,
   with `baselineRunMin` kept beside it and a new field `targetSource:
'baseline'|'review'|'override'`. A `PUT` on a week with a value ≠ baseline requires a
   non-empty `overrideNote` and sets `targetSource = 'override'`; a `PUT` with the baseline
   value clears the note and resets to `'baseline'`. Saving a review with `finalNextMin`
   while the week is `complete` and gets `reviewedAt` writes the _next_ week's
   `targetRunMin` with `targetSource = 'review'` unless that week is an override. Nothing is
   computed at read time; the reason shown is the stored `targetSource`.
5. **Regenerate (4.6).** `POST /api/plan/generate` archives the current active plan and
   creates a new one. Reviews are keyed by user and week, so they survive; overrides do not
   carry over. Activating a goal never generates a plan by itself; the plan page offers it.
   One active plan per user.
6. **Taper order (4.5).** The `suggestAction` list becomes: upcoming, in_progress,
   await_data, review_duplicates, reduce, **then** taper/race → hold ("taper"), repeat,
   needs_recovery_review, hold, progress. Next-week minutes are always capped at the next
   week's baseline, so the week before taper lands on the taper baseline.
7. **Smashrun CSV (4.5).** `Start Date` (local) is authoritative for the calendar date and
   start time; accept `YY/MM/DD HH:MM`, `YYYY-MM-DD HH:MM[:SS]` and ISO 8601. A header row
   is detected by a first cell matching `Run Id` (case-insensitive); with a header, columns
   map by name; without one, the 26-column order is assumed and a 27th leading integer
   column is dropped. Every Smashrun row is `type = 'run'`. The unit test fixture is a
   synthetic three-row sample in the real layout.
8. **Dedupe scope (4.5).** The 80 m rule is the owner's (0.05 mi); keep it. Generic CSV
   rows get `source = 'csv'` and a `providerKey` of `csv:<sha1 of date|minutes|miles>` so
   re-imports are idempotent; they take part in the near-duplicate pass like manual rows.
9. **Distance class (4.5).** Derived from the goal's `distanceM`: ≤ 10 000 `short`;
   ≤ 21 100 `half`; ≤ 42 195 `marathon`; ≤ 80 500 `ultra50`; else `ultra100`. Generating
   for a goal without a distance returns a `validation` error.
10. **Baseline fallback (4.5).** Baseline = median run minutes of the last 4 calendar weeks
    that contain at least one run, ignoring `dataStatus`. If none exist the request must
    carry `baselineRunMin`; when supplied it always wins.
11. **Fastest efforts (4.5).** Whole-run pace; a run qualifies for a distance when its
    distance is between the target and 2% above it. Races count; `possible` and `confirmed`
    duplicates do not. No split detection in v1.
12. **Auth details (4.2).** Email is the login identifier and is required at setup. Login is
    rate-limited to 10 attempts per 15 minutes per IP (in memory). Password reset is a CLI
    script `npm run reset-password -- <email>` that prompts for a new password. Rotating
    `SESSION_SECRET` logs the owner out; documented in the README.
