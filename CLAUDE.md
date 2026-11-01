# Running log

Self-hosted training log and planner for one runner. Specs, the task plan and ADRs are under
`docs/`; where the design spec's section 7 differs from sections 1-6, section 7 wins.

## Commands

- `npm run check`: `check:static` (lint, `prettier --check .`, typecheck, `research:check`), then
  every Vitest project. Must pass before every commit.
- `npm run test:unit` (every Vitest project except `sweep`) and `npm run test:sweep` (the `sweep`
  project: the long engine files) are the two halves of `npm test` that CI runs in separate jobs;
  both accept `-- --shard=1/2`.
- `npm run build`: Vite build into `dist/web`, server compiled into `dist/server`.
- `npm run test:e2e`: Playwright (chromium) against the production build, on a fresh SQLite file
  that the config's `webServer` creates and migrates. Run `npm run build` first.
- `npm run research:check` (offline corpus and citation check) and `npm run research:verify`
  (online, Crossref, by hand).
- `npm run plan:report`: report-only plan metrics, reference bands and a scorecard per plan over the
  matrix and the sweeps (`tests/reports/`, about 20 s; `-- --matrix-only` skips the sweeps). Not part
  of `check`; nothing outside `tests/` imports it (`harness-isolation.test.ts`). Run
  `npm run -s plan:report` by hand before and after a `PARAMS_VERSION` bump and paste the delta of the
  two outputs into the PR.
- `npm run dev`, `npm run db:migrate`, `npm run format`, `npm run reset-password -- <email>`.
- `npm run icons`: renders the PNG icons in `web/public` from `icon.svg` with Playwright's chromium
  (no image library); commit the four PNGs it writes.
- `npx prettier --check .` is the formatting gate in CI; run `npm run format` to fix it.

## Gates

CI (`.github/workflows/ci.yml`) runs four jobs side by side, each with `npm ci`: `static` (the audit,
then `npm run check:static`), `unit` (`npm run test:unit` in two shards, `--shard=1/2` and `2/2`),
`sweeps` (`npm run test:sweep` in two shards) and `e2e` (the chromium install, `npm run build`,
`npm run test:e2e`, and the Playwright report uploaded on failure). A fifth job, `ci`, fails unless
the four succeeded; it is the one check that branch protection reads. The Docker image must still build (`docker build .`) after a change to
dependencies, the `Dockerfile`, a migration or how the web build is emitted (`web/sw/buildSw.ts`);
its build runs `prisma migrate deploy` as a smoke test.

## Structure

- `server/` Express 5 API (`routes/` thin, `services/` logic, `auth/`), `shared/` pure domain code
  used by server and web, `web/` React SPA (`pages/`, `components/`, `api/` hooks), `prisma/`
  SQLite schema and committed migrations.
- `shared/engine/` is the training engine: pure, deterministic, no I/O. `research/` is the paper
  corpus and `engine-rules.md`; the project skill `research-update` covers changing either.
- `web/pwa/` holds what the page keeps on the device (the outbox, the drafts) and the service worker
  registration. `web/sw/sw.js` is the worker: plain JavaScript, no import, no library;
  `web/sw/buildSw.ts` is the Vite plugin that writes it into `dist/web` with the build id and the list
  of files to keep.
- `tests/unit`, `tests/api`, `tests/web` (Vitest) and `tests/e2e` (Playwright).

## Providers

- Every data source is one module in `server/providers/<key>.ts`, registered in
  `server/providers/registry.ts` with its `ProviderInfo` (key, label, channels, wellness,
  `experimental`). A provider implements only the channels it declares: `pull`, `push`, `upload` or
  `publish`; `folder` has no module because the scheduler scans it. Adding a source means one module
  plus one registry entry (a source with a `publish` channel has a second module, below).
- `publish` is the one outbound channel (ADR 0008): a `PublishProvider` (the interface is in
  `server/providers/types.ts`) in a second module beside the provider's pull module, set as
  `publish` on the same registry entry (only intervals.icu, `server/providers/intervalsPublish.ts`),
  keeps the next 14 days of run sessions in the runner's calendar. It is off until the runner turns
  it on, never writes to the database and never goes through the experimental Garmin provider.
  `server/services/publish.ts` owns the `WristPublication` rows and the `DeliveryChannel` settings.
  `buildDeliverables` (`server/services/workouts.ts`) is the one builder of what goes out: the
  intervals.icu events, the FIT files and the calendar feed render the same `WorkoutPlan`. The
  calendar feed is not a provider (a route behind a hashed token on `DeliveryChannel`, no registry
  entry). How a session stands on its way to the watch is read only through `readWristItems`
  (`server/services/wristItems.ts`), for the Plan page, the settings, Today's `watch` slot and the
  health note about tomorrow's run alike; `WRIST_CHANNEL` there is the one place the channel name
  is written.
- A provider returns `ParsedActivity` and `WellnessInput` values; it never writes to the database.
  `server/services/activityStore.ts` is the only writer of imported activities, and
  `server/services/sync.ts` drives pull providers.
- Network access goes only through `ctx.fetch`, never a global `fetch` or an HTTP client of its own,
  so tests inject synthetic responses and no test touches the network.
- Open-Meteo stays outside the registry: the weather job (`refreshWeatherCaches`, every 10 minutes)
  fills `ForecastCache` and `ClimateCache`. No request handler waits on it except the forecast route
  on a never-filled cell (5 s, then 502) and `ensureClimate` in plan generation on a cell with
  nothing usable (8 s). A profile write that changes the home place, a goal write that creates a
  goal or changes a `CLIMATE_FIELDS` value (`warmWeatherCaches`), a stale forecast read and
  `ensureClimate` on a stale cell start a background refresh. Every other read (engine input,
  predictions, zones, Today) uses the cache only, so a miss gives no forecast and no race heat,
  never a wait. `ForecastCache` is not state: a change key that depends on the forecast adds
  `forecastStamp(prisma, userId)`. The fetch is `Deps.fetch`, read at each call (the global `fetch`
  when unset); tests inject one through the API helpers' `ctx.fetch` and never stub the global, and
  settle a background refresh with `settleWeatherCache`.
- Secrets (API keys, client secrets, tokens) are encrypted and decrypted only through
  `server/crypto.ts`, stored in `Integration.secret`, and never logged or returned by the API.
  Refreshed tokens are saved through `ctx.saveSecret`. No new environment variables.
- `listWellness` never returns a short list as complete: when it stops early (a spent request
  budget) it throws `WellnessTruncated` with the days it read; the sync stores them and records a
  `paused` run, never `ok`.
- Files are parsed through `ctx.parseFile`, not by importing the parsers directly. Fixtures are
  synthetic; FIT test files are built with `tests/fixtures/fit/buildFit.ts`.

## Conventions

- Relative imports carry the `.ts` or `.tsx` extension. No path aliases.
- Import `PrismaClient` and the row types from `server/db.ts`, not from `@prisma/client` or
  `generated/`.
- Distance in metres, duration in seconds, plan targets in minutes, dates as `YYYY-MM-DD`
  strings in the runner's local day, weeks start Monday (ADR 0003).
- Request order (`server/app.ts`, phase 3a design 4.8): authentication comes before any body or
  query parsing. The only JSON parsers ahead of `requireAuth` are the 16 KB parser on `/api/setup`
  and `/api/auth` and the one a token-checked router starts after it has verified its token
  (`/api/ingest/:provider`, 16 MB; the calendar feed `GET /api/calendar/:token/plan.ics` takes no
  body). Every other parser is mounted below `requireAuth`, and a new route that takes a large body
  gets its parser there, so an anonymous request is a 401 before any byte is read. Tests that send
  a large body to a route that answers early use a plain `http.request`, as `bodyParsers.test.ts`
  does (supertest sends `Connection: close` and reports `EPIPE`).
- Server errors are thrown as `HttpError` (`server/errors.ts`) and reach the client as
  `{ error: { code, message, details? } }`. Zod parses every body and query.
- Server data hooks live in `web/api/<resource>.ts`; pages only consume them. Domain rules go in
  `shared/` as pure functions with unit tests.
- Every number in `shared/engine/` is a `Param` from `shared/engine/params/`, with a grade, a rule
  id and cited paper ids that exist in `research/papers/`. A grade D value carries a note that
  says it is a default. A language model never chooses a session (ADR 0005).
- Method presets (ADR 0017, rules P1 to P4): `options.method` (`PresetId`, absent means `default`)
  overrides only the four values of `PRESET_OVERRIDES` (`shared/engine/params/p-methods.ts`): the
  run-day cap, the long-run share, the build length and the table of quality kinds. The readers never
  read those Params directly: `resolveMethod` (`shared/engine/methods.ts`) says which preset applies
  (goal class, persistent holds, novice, a plan with no base week; the transient holds do not hold
  one) and `effective(method, id)` gives the value, as `tidFor` takes `polarized`. A test scans for a
  direct read. The default is today's plan byte for byte (the oracle). A preset that applies is held
  week by week to the default plan of the same input (`WeekLimit`, `generate` in
  `shared/engine/index.ts`), so it never plans more. A new overridable value needs an id, a reader, a
  bound in `methods.test.ts` and a grade D Param under its rule. A week drawn under a preset carries
  the flag `shape-<preset>` (`shared/engine/shape.ts`; the plan's own shape and a start programme's
  weeks carry none), and a re-plan whose shape in effect differs from the stored current week's draws
  that week again under the shape it has (`replan` in `index.ts`, `heldWeek`), except that a persistent
  hold that starts applies at once: the resolver cannot draw a shape it reads as the default (ADR 0017,
  addendum). The change of the preset in place is `PUT /api/plan/method` (`commitMethod`, reason
  `method-change`).
- Targets are a sketch, not minimums: no red, no "behind" or "missed" copy, no streaks or badges.
- npm only. Strict TypeScript. Prettier formats, ESLint 9 flat config lints.
- Env vars are exactly `DATABASE_URL`, `SESSION_SECRET`, `PORT`, `NODE_ENV`, `ALLOW_REGISTRATION`
  and `LOG_LEVEL` (plus `TZ` as an OS setting in Docker).
- Migrations under `prisma/migrations` are committed; never ignore them.
- Callers never bump the data version: `server/dataVersion.ts` raises it after every write to a
  state model and at the end of every `$transaction`, and exports no way to raise it. No raw SQL
  writes a state table (`tests/unit/server/noRawWrites.test.ts` enforces it).
- Every new Prisma model is added to `STATE_MODELS` or `NON_STATE_MODELS` in `server/dataVersion.ts`
  in the PR that adds it; a test fails on a model in neither or both. A model the snapshot, a
  memoised value or a published deliverable reads is state; a table written on a read path or by
  the publisher is non-state.
- Athlete data (the 365-day history, wellness, reviews, the screening, the stored plan) comes from
  `gatherEngineInput`, `gatherContextInput`, `loadAthleteContext` or `memoByVersion`
  (`server/services/athleteState.ts`, ADR 0009); no new code queries that window or the stored plan
  itself. The snapshot is deep-frozen, so copy an array before sorting or editing it.
  `currentGoalFor` (`server/services/currentGoal.ts`) is the one answer to "which goal".
- Migration folder names are regenerated at rebase so they sort after every migration on `main`.
- `PlanSession.externalId` (a uuid, unique per plan) is a session's identity outside the database.
  Session rows are built only by `sessionRow()` in `server/services/planEngine.ts`, which sets
  `externalId` (fresh unless carried) and `trimmed`, the indexed form of `rules` holding
  `design-4.3`. `isTrimmed()` in `shared/domain/sessionStatus.ts` (re-exported by `server/serialize.ts`) is the one derivation: set `trimmed` with it
  on every write of `rules`, and never filter the stored `rules` text with `contains`.
- A re-plan and a `PlanRevision` are written only through `computeReplan` (reads, decides, writes
  nothing), `applyReplan` and `recordPlanWrite` in `server/services/replan.ts` (ADR 0007);
  `replanActivePlan` wraps the first two. Nothing else creates a revision (a test scans `server/`),
  and each revision stores a `PlanDiff` and an `UndoPayload` built from the rows actually written.
  Summaries are templates in `shared/copy/revision.ts`.
- Week and statistics code reads `ActivityCore` rows (`loadActivityCores`, six columns), from
  `activityLoadStart(first week)` to the last Sunday, never every whole activity. A loop over weeks
  reads the database once for all of them (`executionRecordsByWeek`).
- The strength workout (lifts, sets, loads, efforts) is derived on read in `shared/engine/strength.ts`
  only (`workoutFor`, `liftFor`; ADR 0014) and stored nowhere: `PlanSession` holds no exercise and the
  server derives no second one. Every surface renders the one `StrengthWorkout`; a day with no
  planned session reads it from `GET /api/strength/workout`.
- Loads are integer grams on the wire and in the database. The runner's unit (`User.weightUnit`,
  read with `useStrengthUnits()`, pounds when a cached payload lacks it) exists only on screen:
  `shared/domain/weight.ts` is the one formatter and parser and holds the step grid per implement,
  and nothing else converts grams.
- No free-text exercise: an exercise is an id of the closed catalogue in
  `shared/domain/strengthLibrary.ts` (never renamed or reused; a retired one stays), and a route that
  takes one checks `isExerciseId`.
- A strength log is saved only through `server/services/strength.ts` (`saveStrengthLog`, an
  idempotent replace on the log id, with `createManualActivity` for its activity); the duplicate pass
  alone hands a log to the original activity. The logging sheet's draft (`strength-draft:<logId>`) and
  the count prompt's "Not now" (`strength-prompt:*`) are named in `web/pwa/drafts.ts` and purged with
  the other drafts by `purgeDrafts()`, so by `purgeDeviceData()`.
- The `strength.state` memo (`memoByVersion`) is the one read of the strength window (the setup, the
  anchors and 26 weeks of logs), ADR 0009's rule applied: a rule or a surface asks for the memo and
  never queries the strength tables.
- `Sheet` (`web/components/Sheet.tsx`) is stack-aware: only the topmost open sheet answers Tab and
  Escape, and the ones under it are `inert`.
- Packages that only the Vite build uses (react, recharts, fonts, router, query) are
  `devDependencies`, so the Docker image installs without them.
- Offline shell (ADR 0012): the worker keeps the shell and exactly five API reads (`/api/auth/me`,
  `/api/setup`, `/api/settings`, `/api/today` with or without `?date=`, `/api/research/params`), 200
  GETs only, in `rl-api-v1`; a new cached read is a change to the allowlist in `web/sw/sw.js`, to
  `tests/unit/shared/sw.test.ts` and to the ADR. Health data on the device (`rl-api-v1`, the outbox,
  the drafts) is emptied only through `purgeDeviceData()` in `web/pwa/outbox.ts`, which sign-out,
  sign-in, account creation and every 401 call; extend it rather than adding a second purge. The
  page's own cached answers go with `dropUserQueries()` in `web/api/client.ts`. The worker is
  registered in a production build only. A date in the worker is the server's (`tz` of the
  payload), never the phone's. `createQueryClient()` runs queries and mutations in
  `networkMode: 'always'`, so a request made while the browser says it is offline still reaches the
  worker or the outbox.

## Testing

- API tests use `tests/api/helpers.ts` (own SQLite file per context, seeded user and cookie).
  `ctx.fetch` starts as `noNetwork()`, which rejects, names the URL and records it in
  `ctx.refusedFetches` (the weather layer swallows the rejection); end an `afterEach` with
  `expectNoRefusedFetches(ctx)` so an unplanned call still fails the test, and set `ctx.fetch` to a
  `fakeFetch` to plan calls.
- Page tests use `tests/web/helpers.tsx`; query by role and accessible name.
- Vitest projects (`vitest.config.ts`): `server` (`tests/api` and `tests/unit`), `web` and `sweep`
  (the engine files that take about 10 s or more, listed in `SWEEP_FILES` in
  `tests/vitestProjects.ts`, with the one test timeout of the project; CI shards it). A long engine
  file goes into `SWEEP_FILES`, not into a `vi.setConfig({ testTimeout })` of its own;
  `vitest-projects.test.ts` fails on the latter. Every project isolates its files.
- E2E specs in `tests/e2e` drive the UI by role and label, use dates computed from the clock,
  and call `resetData()` and `signedInApi()` from `tests/e2e/helpers.ts` so each spec stands on
  its own. `01-auth.spec.ts` owns the empty database and must stay first. No sleeps; rely on
  auto-waiting assertions.
  `resetData()` derives its table list from `prisma/schema.prisma` (every model with a `userId`
  column except `User`, and the shared caches that have neither a `userId` nor a parent), so a new
  table needs no edit there.
  `signedInApi()` signs in with a minted session cookie once the account exists, because the
  sign-in route allows 10 attempts per window and the suite would exhaust it.
  Playwright blocks service workers (`serviceWorkers: 'block'` in the config, which makes
  `register` do nothing); only `17-offline.spec.ts` allows them, with
  `browser.newContext({ serviceWorkers: 'allow' })`. The worker's rules are tested by running
  `sw.js` in a `vm` sandbox with a fake Cache Storage (`tests/unit/shared/sw.test.ts`).
- Every migration adds a case to `tests/unit/server/migrations.test.ts`: it seeds the previous
  release's rows with raw SQL (sessions linked to activities included), applies the migration and
  asserts nothing was lost. The same file runs `prisma migrate diff --exit-code` against
  `prisma/schema.prisma`, so a schema change without its migration fails `npm run check`. A required
  column on a populated table is generated, then hand-edited so the redefine fills it per row.
- The e2e server port is 3101 plus a per-checkout offset (`E2E_PORT` in `tests/e2e/env.ts`), so
  worktrees can run e2e at the same time. Never hard-code it; use `baseURL` or `E2E_PORT`. Print it
  with `node -e "import('./tests/e2e/env.ts').then((m) => console.log(m.E2E_PORT))"`.
- `tests/e2e/globalSetup.ts` holds a run back until the next local day when fewer than three minutes
  are left before midnight, and prints the wait. The specs take their dates from the clock at the
  start, so a run that crossed midnight would leave a page on a day its plan was not built for.

## Public repository

- No personal data in the repo: fixtures are synthetic, emails use `example.com`, no real names,
  race names or run history. Check a diff for this before every commit.
- Commit subjects are imperative with a conventional prefix (`feat`, `fix`, `test`, `docs`,
  `chore`, `refactor`), at most 72 characters. Comments, commits and ADRs avoid first and second
  person.
- Claude attribution never goes into commits or PRs: no `Co-Authored-By`, no session links, no
  "Generated with" lines.
