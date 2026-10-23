# Coach phase 3a — implementation plan

> For agentic workers: one task per engineer, own worktree branched from `origin/main`, `npm ci`
> first, test first. Read `CLAUDE.md`, `docs/superpowers/specs/2026-10-22-coach-phase3a-design.md`
> (section 4 for the shared contracts, then your epic's section), the **Global rules** below and
> your own task. A task never defines a second copy of a section 4 contract; if it needs a change to
> one, it stops and reports.

**Base branch:** `main`. Waves in order; tasks inside a wave run in parallel in isolated worktrees
and merge one at a time. A task starts only when every task it depends on has merged.

## Global rules

- **Contracts.** Session identity (spec 4.1), the revision model (4.2), the state cache and its
  classification (4.3), the publish channel (4.4), the copy system and lint (4.5), the shared
  delivery semantics (4.6), the job and sync log (4.7) and the conventions (4.8) are owned by the
  tasks named there. Other tasks import them.
- **Engine numbers** are `Param`s with grade, rule id and existing evidence ids; grade D carries a
  "default" note; changes follow the `research-update` skill (rule text, Param, `PARAMS_VERSION`).
  The PR that merges takes the next free `PARAMS_VERSION` suffix at rebase and updates the assertion
  in `tests/unit/engine/params.test.ts`; the PR description names the value taken.
- **Migrations.** One per PR. Regenerate the folder name at rebase so it sorts after every migration
  on `main`; add a case to `tests/unit/server/migrations.test.ts`; run `docker build .`.
- **Classification.** Every new Prisma model is added to `STATE_MODELS` or `NON_STATE_MODELS` in
  `server/dataVersion.ts` in the PR that adds it. No code bumps the data version by hand.
- **Snapshot rule.** Athlete data comes from `gatherEngineInput`, `loadAthleteContext` or
  `memoByVersion`; no query of the history window or the stored plan outside them; no raw SQL write
  to a state table.
- **Copy.** Every app-authored string is a template in `shared/copy/` (or `fuelCopy.ts` for E6) and
  passes `shared/copy/lint.ts`; rendered page tests call `expectCleanCopy`. Numbers that restate a
  Param are interpolated from it.
- **Errors.** 400 with issues for validation, 409 `conflict(message, details?)` for conflicts, 422
  only for the plan checklist.
- **Tests.** Web tests query by role and accessible name. New e2e specs take the next free number at
  merge, call `resetData()` and `signedInApi()`, use dates from the clock and no sleeps;
  `01-auth.spec.ts` stays first.
- **Privacy.** Synthetic fixtures only; no personal data, race names or account data in the
  repository, PR descriptions or test output. The owner validation database and its output stay in
  the job directory; PRs quote only the summary figures.
- **Commits** are imperative with a conventional prefix, at most 72 characters, no first or second
  person, and carry no Claude attribution.

## Task id map

Task ids follow the epic designs. Four design tasks were merged during reconciliation:

- **E1-1** (shared delivery semantics) is folded into **E2-2**.
- **E3-9** and **E5-1** (revision columns, compute/apply split, ADR 0007) become **R0-1**.
- **E5-2** (undo, preview, seen, diff and undo UI) is split: the server part becomes **R0-2**, the
  UI moves to **E4-4**.
- E1's separate Today banner (`WristNotice`) is dropped: the watch slot line covers today and a
  health note covers tomorrow.

## Verification gates

**Every PR** before merge:

1. `npm run check` (lint, Prettier, typecheck, `research:check`, Vitest).
2. `npm run build`.
3. `npm run test:e2e` (after the build).
4. `docker build .` when the PR adds a migration, changes dependencies, the `Dockerfile` or what the
   image serves (marked **Docker** below). The build runs `prisma migrate deploy` as a smoke test.
5. The owner validation (`data/validate-owner.ts`, database outside the repository) when the PR
   changes engine code or Params (marked **Validation** below). The expected result is the STATUS
   baseline (0 of 15 checklist failures, label "tight", 33 of 33 weeks, 3 × 20 first week, 9.2 h
   peak) unless the task states otherwise; the PR quotes the summary only.
6. From the PR that creates them on: the migration-chain test, the `prisma migrate diff` drift
   check, the model-classification test, the `resetData` completeness test and the cross-surface
   target test are part of `npm run check`.

**Every wave**, after its last task merges and before the next wave starts:

1. The gates above on the tip of `main`, once.
2. The owner validation if any task of the wave was marked **Validation**, compared with the
   previous wave's result; any difference is explained in STATUS or fixed.
3. `docker build .` if any task of the wave was marked **Docker**.
4. **Adversarial review** of the wave's merged diff (below). Confirmed findings are fixed in a
   follow-up PR in the same wave, or recorded in STATUS with a reason, before the next wave starts.
5. `docs/STATUS.md` updated: what merged, the `PARAMS_VERSION` now on `main`, open findings, owner
   decisions pending.

**Adversarial review.** Run on each wave's diff by reviewers who did not write it, one per lens:

- **Contracts:** no second definition of anything in spec section 4; every new model classified; no
  manual bump; no direct history-window query; identity and revisions used as specified.
- **Correctness:** edge cases named in the task's risks; time zones and week boundaries; undo,
  preview and commit parity.
- **Security and privacy:** auth before parsing, secrets never logged or returned, tokens hashed, no
  health words in public titles, no personal data in fixtures.
- **Copy and accessibility:** the G5 lint, numbers from Params, roles and names, 360 px layout, no
  colour-only meaning.
- **Tests:** tests fail without the change, no conditional assertions, no network, no sleeps.
- **Performance:** query counts, snapshot hits, no request waits on Open-Meteo.

Each finding needs two independent refuters to try to disprove it; a finding stands when neither
can. The review result (confirmed, disputed, fixed) goes into STATUS.

## Wave 0: contracts that everything else imports

### Task P0: Land the phase 3a design, plan and ADR drafts

Size S. Depends on: nothing.

- **Files:** `docs/superpowers/specs/2026-10-22-coach-phase3a-design.md`,
  `docs/superpowers/plans/2026-10-22-coach-phase3a.md`,
  `docs/adr/0007-automatic-replan-visible-and-undoable.md`,
  `docs/adr/0008-outbound-publish-channel.md`,
  `docs/adr/0009-athlete-state-snapshot-and-data-version.md`, `docs/STATUS.md`.
- **Acceptance:** the three ADRs carry "Status: Proposed 2026-10-22"; STATUS names phase 3a, links
  the spec and plan and lists the open owner questions of spec section 13; `npx prettier --check .`
  passes; no code changes.
- **Tests:** none beyond `npm run check`.

### Task E3-1: Data version, write hook, transaction guard, model classification, `conflict(details)`, schema-derived `resetData`

Size S. Depends on: nothing. Contract: spec 4.3, 4.8.

- **Files:** `server/dataVersion.ts`, `server/db.ts`, `server/errors.ts`, `tests/schemaModels.ts`,
  `tests/e2e/helpers.ts`,
  `tests/unit/server/{dataVersion,modelClassification,noRawWrites,errors,resetData}.test.ts`,
  `CLAUDE.md`.
- **Acceptance:**
  - `createPrisma` returns a client whose writes to every state model bump `n` (top level, nested,
    `many` variants, inside interactive transactions, and when the operation throws); reads and
    non-state writes do not.
  - `$transaction` bumps once when it ends, on commit or rollback, and `openTx > 0` while one is in
    flight; a spike test records whether root reads share the handle with an open transaction (PR
    notes the finding).
  - `dataVersionKey` returns a numeric `external` even when the pragma is a `BigInt`; a write
    through a second client on the same file changes it; `onDataVersionChange` fires after a bump;
    two clients have independent counters.
  - `STATE_MODELS` and `NON_STATE_MODELS` cover `prisma/schema.prisma` exactly; the test names any
    unclassified or doubly classified model. No public bump function exists.
  - `Deps`, every `Pick<PrismaClient, ...>` and `tests/api/helpers.ts` compile unchanged; the single
    `as unknown as PrismaClient` cast carries a comment; no new `any`.
  - If the hook does not fire for nested or in-transaction writes, the PR uses the documented
    fallback and says so.
  - `noRawWrites.test.ts` fails on `$executeRaw` against a state table under `server/` or `scripts/`
    and passes on the current tree.
  - `conflict(message, details?)` carries `details` to the response body; existing callers compile
    unchanged.
  - `resetData()` derives its table list from the schema (every model with a `userId` column except
    `User`, in foreign-key passes); a test fails if one is skipped.
  - CLAUDE.md gains: callers never bump the data version; every new table is classified; migration
    folder names are regenerated at rebase.
- **Tests:** as named in spec 5.9 for the data version, classification, raw writes and errors.

### Task E3-4: One `PlanSession` migration, the migration-chain test, batched week queries, bounded loads

Size L. Depends on: nothing. **Docker.** Contract: spec 5.3 migration B.

- **Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_foundation_plan_session/migration.sql`,
  `server/serialize.ts`, `server/services/{planEngine,execution,reviews}.ts`,
  `server/routes/weeks.ts`, `shared/types.ts`, `shared/domain/{weeks,stats}.ts`,
  `tests/unit/server/migrations.test.ts` (new, shared),
  `tests/api/{weeks,weeklyDecisions,trimmed,reviews}.test.ts`, `tests/factories.ts`,
  `tests/web/{plan-fixtures,today-fixtures}.ts`, `tests/unit/shared/{weeks,stats}.test.ts`,
  `CLAUDE.md`.
- **Acceptance:**
  - One migration adds `trimmed`, `externalId` (required, unique per plan) and the indexes of spec
    5.3; the hand-edited redefine fills a distinct `externalId` per existing row, backfills
    `trimmed` from rules, and keeps activity links; `prisma migrate diff ... --exit-code` reports no
    drift.
  - `tests/unit/server/migrations.test.ts` exists: it applies every migration in order to an empty
    database, and for each migration with a fixture case applies the previous ones, inserts the
    previous release's rows (including sessions linked to activities), applies the migration and
    asserts nothing was lost. CI runs the drift check.
  - `sessionRow()` sets `externalId` (a fresh uuid unless one is carried) and `trimmed` through
    `isTrimmed(rules)`, the only derivation; `execution.ts` no longer scans `rules` for a substring;
    payloads and fixtures carry `externalId`.
  - `executionRecordsByWeek(prisma, planId, weekStarts)` issues one session query for any number of
    weeks (a stub client counts one `findMany` for 26 weeks); decisions equal the per-week
    implementation on a 12-week fixture.
  - `loadActivityCores` selects six columns; `/weeks` and review contexts load from 52 weeks before
    the first week; `avg4wRunMin` still looks back before `from`; `streak3Plus` is capped at 52 with
    a doc comment.
  - Existing weeks, reviews, execution and plan tests pass unchanged apart from the streak cap.
- **Tests:** migration cases (`externalId` distinct, links kept, `trimmed` backfill); the batched
  query count; bounded loads.

### Task E4-1: Copy system, the shared G5 lint, quantity formatting, parameter units, ADR 0010

Size M. Depends on: nothing. Contract: spec 4.5.

- **Files:** `shared/copy/{quantity,template,templates,lint,limits,paramUnits}.ts`,
  `shared/dates.ts`, `shared/engine/types.ts` (`Quantity`, `SourceRef`, `InputFact`),
  `web/components/{WhyDrawer.tsx,format.ts}`, `tests/web/helpers.tsx`,
  `tests/unit/shared/{copy-quantity,copy-template,copy-lint,paramUnits}.test.ts`,
  `tests/web/components.test.tsx`, `docs/adr/0010-rule-generated-text.md`.
- **Acceptance:**
  - `shared/copy` exports `Quantity`, `formatQuantity`, `tpl`, `render`, `renderFact`, `TemplateId`;
    `lint.ts` exports `G5_BANNED`, `lintText`, `assertCleanCopy`; `tests/web/helpers.tsx` exports
    `expectCleanCopy`. The list is exactly spec 4.5's; "record" and "RED-S" pass, "PR", "personal
    record" and lowercase "red" fail.
  - `render` rejects an undeclared slot or a wrong `Quantity` kind at compile time (a
    `ts-expect-error` test); `formatQuantity` never prints `NaN`, `undefined` or an ISO date, and
    prints km/m or mi/ft by units.
  - The copy-lint test is data-driven over every template in `TEMPLATES`, so later tasks' templates
    are linted without edits: banned words, undeclared or unused slots, more than 160 rendered
    characters, missing final period.
  - `describeParamValue` translates every unit string in `allParams()` and fails on an unmapped one;
    `0.2` "fraction of duration" reads "20% of the duration"; the why drawer uses it in the runner's
    units.
  - Display caps are constants in `limits.ts`. ADR 0010 is written with status Accepted (structured
    facts stored, prose rendered at read, no model, one lint), labelled reasons and alternatives, no
    first or second person.
- **Tests:** as named in spec 8.8 for the copy system.

### Task E2-1: Split `DashboardPage.tsx` into components with four empty named slots

Size M. Depends on: nothing. Contract: spec 7.6.

- **Files:** `web/pages/DashboardPage.tsx` and `.module.css`, `web/components/today/*`
  (FeedbackCard, CheckinCard, HealthNotes, SessionsSection, HeatSection, DataHealth, RecentStrip,
  DisclaimerNote, `TodaySlot.tsx`, `slots.ts`, `today.module.css`),
  `web/components/SessionChanges.tsx`, `web/components/SessionSheet.tsx` and `.module.css`.
- **Acceptance:**
  - `DashboardPage.tsx` is under 250 lines and only composes; no file under `web/components/today/`
    exceeds 250 lines.
  - `ChangeSection` is extracted to `SessionChanges.tsx` (props `{ session, onClose }`, same markup
    and copy); session-sheet and plan-sessions tests pass unmodified.
  - Dashboard, today and feedback tests pass with import-path edits only.
  - `slots.ts` exports the slot names and budgets (`disruption` 64, `fuel` 26, `watch` 24, `brief`
    52, `fuelPrompt` unbudgeted); `TodaySlot` renders `<div data-slot data-budget-px>` only with
    content; all render nothing in this task.
  - The disclaimer link renders in the accent colour in both themes (the one visible change).
  - `git diff --stat` shows nothing under `shared/`, `server/` or `prisma/`.
- **Tests:** existing web tests; a `TodaySlot` test (empty has zero height, content renders inside
  the wrapper).

### Task E2-2: Shared delivery semantics (absorbs E1-1)

Size M. Depends on: nothing. **Validation** (byte-identical plans). Contract: spec 4.6.

- **Files:** `shared/engine/{readiness,targets,heat,index,types}.ts`,
  `shared/engine/params/{h-ultra,index}.ts`, `shared/domain/sessionStatus.ts`,
  `research/engine-rules.md`, `shared/types.ts`,
  `tests/unit/engine/{easedSession,targets,targetSurfaces,heat,params}.test.ts`,
  `tests/unit/shared/sessionStatus.test.ts`.
- **Acceptance:**
  - `easedSession` exists once (a repository search in the PR shows no other) with the behaviour of
    spec 4.6, generic over the spec type, keeping id and status.
  - `resolveTargets` returns `ResolvedTargets` (including `hotNote`) with the rules of spec 4.6;
    `climbNote` uses `P.h4.climbNoteGainPerHourM`.
  - `isHotForSteering` uses only the `heat` flag and a WBGT peak against `P.i9.warnWbgtC`; an
    air-temperature peak alone is never hot; no new heat Param.
  - `trainingHeatAdvice` returns `peak` and `coolerValue` and offers a cooler hour for any run with
    a positive excess and a gain of at least `P.i7.coolerMinGainC`; strength, mobility and rest
    still return nulls; edited heat tests pass.
  - `isToRun` sits in `shared/domain/sessionStatus.ts` over an exhaustive status map;
    `shared/engine/index.ts` reuses it for `TO_RUN` with unchanged behaviour.
  - `h4.climbNoteGainPerHourM` (150, D, rule H4, two evidence ids) exists; `engine-rules.md` carries
    the H4 bullet, the table row and the I7 edit; `research:check` passes; `PARAMS_VERSION` bumped.
  - `targetSurfaces.test.ts` exists with the hero adapter and a documented registry that later tasks
    extend; it passes for every kind, hot or not, eased or not, in km and miles.
  - `readinessSnapshot`, `todayAdvice` and the existing readiness tests are unchanged; the owner
    validation gives byte-identical plan output.
- **Tests:** as named in spec 7.8 for these functions.

## Wave 1

### Task E3-2: Athlete snapshot, `loadAthleteContext`, `memoByVersion`, `currentGoalFor`, `GET /api/state`, DataInUse, ADR 0009

Size L. Depends on: E3-1. **Validation.** Contract: spec 4.3, 5.4.

- **Files:** `server/services/{athleteState,currentGoal,engineInput,planEngine}.ts`,
  `server/routes/state.ts`, `server/app.ts`, `shared/types.ts`,
  `web/api/{state,client,activities}.ts`, `web/components/DataInUse.tsx` and `.module.css`,
  `web/pages/IntegrationsPage.tsx`, `docs/adr/0009-athlete-state-snapshot-and-data-version.md`,
  `CLAUDE.md`, `tests/unit/server/athleteState.test.ts`, `tests/api/state.test.ts`,
  `tests/web/{dataInUse,integrations,api}.test.tsx`.
- **Acceptance:**
  - `loadAthleteContext`, `memoByVersion` and `currentGoalFor` are exported with the shapes of spec
    4.3; the engine-input functions keep their signatures as adapters and no caller outside
    `engineInput.ts` and `todayView` changes.
  - The build is one `Promise.all` round, selects only `flags` for the screening, and uses
    `P.a5.historyWindowDays`.
  - Concurrent requests share one build; a second request with no write is a hit; a state write, a
    second connection's write, a day change, the TTL or the end of a transaction causes exactly one
    rebuild; a build that overlapped a write or ran during a transaction is returned but not stored
    (tested with a rolled-back transaction).
  - The snapshot is deep-frozen; in-place mutations it exposes are fixed with local copies (count in
    the PR); engine, execution, feedback-loop and plan API tests pass unchanged.
  - `GET /api/state` answers as spec 5.4 (ETag, 304 before serialising, 401, Zod query, `asOf` the
    server day); a plan from a warm snapshot equals one from a cold gather.
  - The PR reports cold and warm timings of `GET /api/state` and `GET /api/today` on a seeded
    three-year synthetic history (no CI timing assertion).
  - DataInUse renders the copy of spec 5.7 with loading, error and empty states;
    `invalidateActivityData` also invalidates `keys.state`.
  - ADR 0009 status becomes "Accepted <date> (#<PR>)"; CLAUDE.md gains the snapshot rule.
- **Tests:** spec 5.9's snapshot and state cases.

### Task E3-7: Session identity: `pairSessions`, the row-level re-plan write, carried ids

Size M. Depends on: E3-4. **Validation** (identical apart from `externalId`). Contract: spec 4.1.

- **Files:** `shared/domain/sessionIdentity.ts`, `server/services/planEngine.ts`,
  `server/serialize.ts`, `docs/STATUS.md`, `tests/unit/shared/sessionIdentity.test.ts`,
  `tests/api/{sessionIdentity,plan}.test.ts`.
- **Acceptance:**
  - `pairSessions`, `carryExternalIds` and `workoutExternalId` are pure and cover every case of spec
    5.9 (kind change, date change, two of a kind, an added strength session does not re-pair, input
    order independence, each id used once).
  - The re-plan write updates paired rows in place (engine-derived columns only), deletes only
    unpaired replaced rows, creates only unpaired drafts, leaves kept rows out of pairing, removes
    `sameSlot`, and returns a
    `SessionWriteSet { created, deleted (full rows), updated { id, before, after } }` for R0.
  - A Monday re-plan of an unchanged plan leaves every future id and `externalId` unchanged (4-week
    fixture); linked activities stay linked; a kind change gets a new `externalId`.
  - Regenerate carries `externalId`s for sessions dated today or later; owner edits keep the id.
  - `GET /api/plan` and the session routes expose `externalId`; the prediction-log call stays a
    one-line call in the same transaction.
  - STATUS states the identity contract for E1 in one sentence.
- **Tests:** unit pairing; API identity cases of spec 5.9.

### Task E3-6: Sync and job log, honest Garmin truncation, weekly catch-up

Size L. Depends on: E4-1. **Docker.** Contract: spec 4.7, 5.6, 5.7.

- **Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_foundation_sync_log/migration.sql`,
  `server/providers/{types,garmin}.ts`, `server/services/{sync,syncLog,folder}.ts`,
  `server/routes/{ingest,integrations,jobs}.ts`, `server/app.ts`, `server/jobs/scheduler.ts`,
  `server/dataVersion.ts`, `shared/types.ts`, `web/api/{integrations,jobs,client}.ts`,
  `web/components/{SyncHistory.tsx,SyncHistory.module.css,syncText.ts}`,
  `web/pages/IntegrationsPage.tsx`, `CLAUDE.md`, tests listed in spec 5.9 for the log, Garmin, jobs
  and integrations.
- **Acceptance:**
  - Garmin `listWellness` reads newest first, returns ascending and throws `WellnessTruncated` with
    the rows, `daysRead` and `daysTotal` (zero days when activities spent the budget).
  - The sync stores truncated rows, records `paused` (never `ok`) with "Wellness stopped after <n>
    of <m> days"; a pull whose activity pass paused first records `wellnessStatus: 'waiting'`;
    "Wellness sync failed" becomes "Wellness could not be read".
  - `SyncRun` (non-state, chain case added) gets one row per pull (idle included), push, folder scan
    and scheduler job; skipped runs record nothing; `recordSyncRun` never throws and prunes to 200
    rows and 90 days; `safeMessage` strips tokens and secret values and cuts at 300 characters; no
    row, response or log line in the tests contains a token.
  - `GET /api/integrations/:provider/runs` and `GET /api/jobs` behave as spec 4.7.
  - The catch-up runs on start and every 6 hours for plans with no weekly or break revision since
    this week's slot, records trigger `catchup`, waits for the next tick after a failure, and leaves
    the 03:00 slot unchanged.
  - SyncHistory renders spec 5.7 (lazy open, `describeRun` sentences through the shared lint, nested
    failures, empty, loading and error states).
  - CLAUDE.md Providers gains the `WellnessTruncated` contract.

### Task E2-3: Today engine pieces

Size M. Depends on: E2-2, E4-1. Contract: spec 7.5.

- **Files:** `shared/engine/{readiness,predict,index}.ts`, `shared/copy/today.ts`,
  `shared/domain/weekStrip.ts`, `shared/{units,dates,types}.ts`,
  `tests/unit/engine/{readinessSignals,predict}.test.ts`,
  `tests/unit/shared/{weekStrip,units,dates,copyToday}.test.ts`.
- **Acceptance:**
  - `readinessSignals`, `readinessVerdict`, `rangeLabel`, `weekStrip`, `formatEstimate` and
    `isoDateInZone` exist, are pure and carry the tests of spec 7.8.
  - Verdict and signal sentences are templates in `shared/copy/today.ts` and pass the shared lint.
  - `restingHrEval` is split from the private helper with no behaviour change; readiness tests pass
    unchanged. This lands before E5-3.
  - `weekStrip` uses the exhaustive status map and `isToRun`; `isoDateInZone` is tested across
    midnight in a zone other than the test machine's.
  - `TodayCoach`, `TodaySlots`, `HealthNote`, `ChangeLine` and the other member types are added to
    `shared/types.ts`.

### Task E1-2: Workout model, public titles, plan mapping, rule O1

Size M. Depends on: E2-2. **Validation** (unchanged output; Params only).

- **Files:** `shared/workouts/{types,labels,plan}.ts`, `shared/engine/params/{o-delivery,index}.ts`,
  `research/engine-rules.md`, `research/rules/` (if the skill requires a machine rule),
  `tests/unit/workouts/{labels,plan}.test.ts`, `tests/unit/engine/params.test.ts`.
- **Acceptance:**
  - `toWorkoutPlan` maps every publishable kind (including the run-walk ladder and the `bouts - 1`
    shape); a table test runs the library through `prescribe` and asserts `totalSec` equals the
    minutes (ladder frames asserted separately); description numbers equal step numbers; units
    honoured.
  - `publicTitle` comes from a closed kind allowlist; a test over every kind and flag combination
    finds no injury, illness, pain, return, post-race, eased or run-walk word.
  - Steps follow spec 6.5's target table; no step under `P.o1.hrTargetMinStepSec` carries a
    heart-rate target; targets come from `resolveTargets`.
  - `o1.hrFloorBpm` and `o1.hrTargetMinStepSec` exist with default notes; rule O1 (section (o)) is
    in `engine-rules.md`; `research:check` passes; `PARAMS_VERSION` bumped.
  - `shared/` gains no Node import.

### Task E6-1: Fuel ladder Params, H7 rule text, ADR 0011

Size S. Depends on: nothing beyond wave 0. Contract: spec 10.5.

- **Files:** `shared/engine/params/{h-ultra,index}.ts`, `research/engine-rules.md`,
  `tests/unit/engine/params.test.ts`, `docs/adr/0011-personal-fuel-ladder.md`.
- **Acceptance:** the nine `h7` Params with the values, grades and notes of spec 10.5
  (`hotDayWbgtC`'s note names the difference from the steering threshold), evidence ids verified;
  the H7 bullets and the copy-guard bullet added; `research:check` passes; `PARAMS_VERSION` bumped;
  ADR 0011 Accepted with labelled reasons and alternatives (a model-written fuel plan, a fixed
  calculator, no ladder, a save-time hot flag).

### Task E10s-2: Back-test scorer, L7 Params and rule text, track-record sentences

Size S. Depends on: E4-1. Contract: spec 11.5.

- **Files:** `shared/engine/{backtest,index}.ts`, `shared/engine/params/{l-predict,index}.ts`,
  `research/engine-rules.md`, `web/components/ruleTitles.ts`, `shared/types.ts`,
  `shared/copy/trackRecord.ts`, `tests/unit/engine/{backtest,params}.test.ts`,
  `tests/unit/copy/trackRecord.test.ts`, `tests/web/ruleTitles.test.ts`.
- **Acceptance:** the two `l7` Params (D, default notes, existing ids); L7 replaced by the four
  bullets and L6 reworded; `PARAMS_VERSION` bumped; `backtest.ts` pure with the tests of spec 11.8
  and the sign convention in a doc comment; every sentence in `trackRecord.ts` passes the lint over
  an input grid; `RULE_TITLES.L7` set; the PR states engine output is unchanged.

## Wave 2

### Task R0-1: Revision foundation, part 1: columns, compute/apply split, diff, undo payload, ADR 0007

Size L. Depends on: E3-1, E3-7, E4-1. **Docker. Validation.** Contract: spec 4.2.

- **Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_revision_model/migration.sql`,
  `shared/types.ts`, `shared/engine/{types,diff}.ts`, `shared/engine/params/{j-adapt,index}.ts`,
  `shared/copy/revision.ts`, `server/services/{replan,planEngine}.ts`, `server/serialize.ts`,
  `server/routes/plan.ts`, `docs/adr/0007-automatic-replan-visible-and-undoable.md`,
  `docs/superpowers/specs/2026-10-21-running-app-rewrite-design.md`,
  `docs/superpowers/specs/2026-10-22-training-engine-design.md`, `CLAUDE.md`,
  `tests/unit/engine/{diff,params}.test.ts`, `tests/unit/server/migrations.test.ts`,
  `tests/api/{revisions,engine,plan,scheduler}.test.ts`.
- **Acceptance:**
  - The migration adds exactly the columns of spec 4.2 with the backfill (`auto` for weekly and
    break, `seenAt = createdAt`); the `[planId, reason]` index is not part of it, because migration B
    (E3-4) already shipped it; chain case and drift check pass; older rows read as `diff` and
    `undo` null.
  - `computeReplan` (no writes; optional input transformer), `applyReplan` and `recordPlanWrite`
    exist in `server/services/replan.ts`; `replanActivePlan` keeps its signature; reviews and the
    scheduler compile unchanged; the pre-split implementation is kept as a test oracle and its
    output equals the new one on the 4-week fixture.
  - Every revision from re-plans (weekly, review, owner, break) and owner session edits stores a
    `PlanDiff` and an `UndoPayload` built from E3-7's write set; a test asserts row writes equal
    `diff.totals`; a no-op re-plan writes a hidden revision with `diff.empty` and `undo` null.
  - The payload round-trips: `applyUndoPayload` restores every scalar column of `PlanSession` and
    `PlanWeek` (field list from the DMMF) of the rows before the re-plan.
  - Revision summaries are rendered from `shared/copy/revision.ts`; `describeChanges` wraps it.
  - `GET /api/plan/revisions` returns the new fields, hides empty revisions by default, accepts
    `limit`, `before` and `include=empty`.
  - `revision.undoWindowDays` (7, D, rule `design-revisions`) exists; `PARAMS_VERSION` bumped.
  - ADR 0007 status becomes Accepted; the rewrite design's anti-goal reads the amended wording; the
    training-engine design section 5 says every re-plan is a visible, undoable revision; CLAUDE.md
    names `computeReplan`/`applyReplan`/`recordPlanWrite` as the only way to write a re-plan.
  - The owner validation matches STATUS with sessions identical apart from `externalId`.

### Task E3-3: Open-Meteo cache tables, scheduler refresh, injectable fetch, `forecastStamp`

Size M. Depends on: E3-2. **Docker.** Contract: spec 5.3 migration A, 5.8.

- **Files:** `prisma/schema.prisma`,
  `prisma/migrations/<ts>_foundation_weather_cache/migration.sql`,
  `server/{app,index,dataVersion}.ts`, `server/providers/openMeteo.ts`,
  `server/services/{weatherCache,weather,engineInput,planEngine}.ts`,
  `server/routes/{weather,profile,goals}.ts`, `server/jobs/scheduler.ts`, `shared/types.ts`,
  `tests/api/{helpers,weather,weatherCache,engine,execution,feedbackLoop,integrations}.test.ts`,
  `tests/unit/server/{providers-openMeteo,weatherCache}.test.ts`,
  `tests/unit/server/migrations.test.ts`, `CLAUDE.md`.
- **Acceptance:**
  - `ForecastCache` (non-state) and `ClimateCache` (state) exist with integer cell keys and unique
    indexes; chain case added.
  - No code outside `weatherCache.ts` and the weather job calls Open-Meteo; `engineInput.ts` has no
    `fetch`, archive URL, in-memory cache or reset function.
  - Today (including `?date=`), predictions, zones and plan make no network call (test with a fetch
    that throws).
  - The weather job refreshes forecast and climate rows on the ages of spec 5.8 through the injected
    fetch, keeps old data on failure with a 15-minute back-off; the engine ignores a forecast older
    than 24 h.
  - `GET /api/weather/forecast` behaves as spec 5.4; generation awaits `ensureClimate` (8 s) and a
    cold-cache plan carries race heat in the fake-fetch test; location and date writes warm in the
    background.
  - `Deps.fetch` is optional and resolved per call; tests inject fetch instead of stubbing the
    global; a climate refresh recomputes a memoised prediction; `forecastStamp` is exported.
  - CLAUDE.md states that request handlers never call Open-Meteo.

### Task E3-5: Slim paginated activity list and server-side stats

Size L. Depends on: E3-2, E3-4. Contract: spec 5.4, 5.7.

- **Files:** `server/routes/{activities,stats}.ts`, `server/app.ts`, `server/serialize.ts`,
  `server/services/athleteState.ts`, `shared/types.ts`, `shared/domain/stats.ts`,
  `web/api/{activities,stats,client}.ts`,
  `web/pages/{ActivitiesPage,ActivitiesPage.module.css,ActivityForm,StatsPage}.tsx`,
  `tests/api/helpers.ts` and the API tests of spec 5.9, `tests/web/helpers.tsx` and the eleven web
  test files, `tests/e2e/{02,03,05,06,07,09}-*.spec.ts`.
- **Acceptance:**
  - `GET /api/activities` returns the envelope of spec 5.4 with Zod-validated `limit` and `offset`
    (400 for 501), items without `hrHistogram`, and `id` as the final tiebreak; detail routes and
    the CSV export are unchanged.
  - `GET /api/stats` equals the in-browser result for the same rows, memoised by version.
  - `useActivities` follows `nextOffset` (pages of 500, at most 20) and returns
    `ActivityListItem[]`; `useActivityPages` drives Activities with the copy of spec 5.7; Stats
    makes no `/api/activities` request.
  - `activityPage(items)` and `listActivities(ctx, query)` absorb the envelope change; the PR lists
    the result of `grep -rn '/activities' tests web` so no caller is missed; the PR description
    states the breaking change.

### Task E1-4: Publish channel: ADR 0008, schema, `PublishProvider`, the intervals.icu module

Size L. Depends on: E1-2, E3-1. **Docker.** Contract: spec 4.4, 6.3, 6.6.

- **Files:** `docs/adr/0008-outbound-publish-channel.md`,
  `docs/adr/0006-provider-framework-and-experimental-garmin.md` (one pointer line),
  `docs/superpowers/specs/2026-10-22-data-foundation-design.md` (a pointer in section 2.6),
  `prisma/schema.prisma`, `prisma/migrations/<ts>_wrist_delivery/migration.sql`,
  `server/dataVersion.ts`, `shared/types.ts`,
  `server/providers/{types,registry,intervals,intervalsPublish}.ts`,
  `tests/unit/server/{providers-intervals-publish,providers-registry,migrations}.test.ts`.
- **Acceptance:**
  - ADR 0008 is Accepted; ADR 0006 gains "Extended by ADR 0008 (outbound publish channel)." in its
    status block; no other ADR text changes.
  - `DeliveryChannel` and `WristPublication` exist as spec 6.3, classified non-state; chain case
    added.
  - `ProviderInfo.channels` accepts `publish`; intervals declares `pull` and `publish`; there is no
    calendar registry entry; the registry test is updated.
  - `intervalsPublish` implements `reference`, `upsert`, `withdraw` and `list` through `ctx.fetch`
    only, with every status path of spec 6.6 covered against `fakeFetch`; the description renderer
    follows spec 6.5; `start_date_local` has no time part.
  - The API key appears in no thrown message, return value or log call (asserted).
  - Manual, recorded in the PR without account data: one live run confirms the sport-settings field
    names, that percent pace and the 40 bpm floor parse (the event's `workout_doc` has steps), what
    `external_id` and upsert do for an API-key caller, and that a date change by PUT works; any
    adjustment lands in this PR.

### Task E4-2: Explain inputs: builders, `o-explain` Params, `GET /api/explain`

Size L. Depends on: E4-1, E3-2. **Validation** (identical drafts). Contract: spec 8.4, 8.5.

- **Files:** `shared/engine/{explainInputs,athlete,execution,types}.ts`,
  `shared/engine/params/{o-explain,index}.ts`, `shared/copy/explainTemplates.ts`,
  `web/components/ruleTitles.ts`, `server/services/explain.ts`, `server/routes/explain.ts`,
  `server/app.ts`, `tests/unit/engine/{explainInputs,params}.test.ts`, `tests/api/explain.test.ts`,
  `tests/web/ruleTitles.test.ts`.
- **Acceptance:**
  - The route parses the discriminated query with Zod (400), is 404 for another user's records, and
    returns `ExplainView`.
  - The service reads only `loadAthleteContext` and `memoByVersion`; two requests on one version fit
    the heart-rate model once; no fallback gather and no history-window query.
  - Builders exist for g-1, g-2, g-6, A2, A3, A5, A6, A7, A8, C1-C5, J2, J3, J4, J5, J7 and L1-L6,
    each with an `insufficient` gap sentence; target facts equal `resolveTargets`.
  - `csEffortsOf`, `efficiencySamples` and `durabilityRuns` are exported with byte-identical
    `estimateState` output.
  - The four standout Params exist under `design-explain` with a rule title; `PARAMS_VERSION`
    bumped; the matrix, replan-chain, fuzz sweeps and the owner validation give identical drafts.
  - The coverage test lists every `RULE_TITLES` id as built, policy-only or in an explicit PENDING
    list.

### Task E5-3: Rule J9, its Params and the pure disruption module

Size M. Depends on: E2-3. **Validation.** Contract: spec 9.5.

- **Files:** `research/engine-rules.md`, `research/README.md`,
  `shared/engine/params/{j-adapt,index}.ts`, `shared/engine/{disruption,readiness,types}.ts`,
  `shared/types.ts`, `shared/copy/revision.ts` (`describeWindow`), `web/components/ruleTitles.ts`,
  `tests/unit/engine/{disruption,params,readiness}.test.ts`, `tests/web/ruleTitles.test.ts`.
- **Acceptance:**
  - J9 and three table rows are in `engine-rules.md`; every cited id exists; `research:check`
    passes; the `research-update` order is followed; `PARAMS_VERSION` bumped.
  - `j9.maxWindowDays` (pinned equal to `j7.tier3Days`), `j9.maxBackdateDays` and
    `j9.niggleEasyDays` exist as grade D with default notes.
  - `disruptionPlan`, `heldDates`, `illnessGate`, `disruptionWeekCap`, `restSessions`,
    `validateDisruption` and `injuryReportOf` exist with the tests of spec 9.8.
  - `illnessPhase` is rebuilt on `illnessGate` with identical results for every check-in case and
    for windows (property test over offsets 0-20 and lengths 1-10).
  - Copy that states n-3 days or window limits is built from the Params and tested against `P`.
  - The module imports only Params, dates and types; determinism is tested.

### Task E6-2: Pure fuel engine, copy and domain arithmetic

Size M. Depends on: E6-1, E4-1, E2-2. Contract: spec 10.5.

- **Files:** `shared/engine/{fuel,fuelCopy,types,index}.ts`, `shared/domain/fuel.ts`,
  `tests/unit/engine/fuel.test.ts`, `tests/unit/shared/fuel.test.ts`.
- **Acceptance:** every function of spec 10.5 exists with the stated imports and no clock or I/O;
  `fuelTargetFor` serves planned, moved, downgraded and adjusted sessions through `isToRun` and none
  for completed, partial or skipped; no hard-coded Param value in `fuel.ts` or `fuelCopy.ts` (source
  scan); every generated string passes the shared lint; no fluid figure other than the reference
  range; Param-agreement copy tests pass; `heat.ts` is not edited.

### Task E6-3: Gut-training option and fuel-practice flags

Size S. Depends on: E6-1. **Validation** (only flags may differ).

- **Files:** `shared/engine/{types,macro,micro,sessions}.ts`,
  `tests/unit/engine/{macro,micro}.test.ts`.
- **Acceptance:** `options.gutTraining === false` removes every `gut-training` week flag; the block
  ends before the first taper week for every ultra and marathon fixture; in a gut-training week up
  to `h7.gutBlockSessionsPerWeek` runs of at least `h7.gutTrainingSessionMinMin` carry
  `fuel-practice` and rule H7 with minutes, days, zones and distances identical to before (a
  before-and-after test); matrix and replan sweeps pass; the PR quotes the validation summary.

### Task E10s-1: `race_results` migration, weekly de-duplicated log, ensure job

Size M. Depends on: E3-1, E3-2. **Docker.** Contract: spec 11.3, 11.7.

- **Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_race_results/migration.sql`,
  `server/{db,dataVersion,serialize}.ts`, `server/services/{predictionLog,planEngine}.ts`,
  `server/jobs/scheduler.ts`, `shared/types.ts`, `tests/unit/server/migrations.test.ts`,
  `tests/api/predictionLog.test.ts`.
- **Acceptance:**
  - The hand-edited migration computes `weekStart` and `loggedOn`, deletes nothing and leaves no
    database default; the chain case covers the four fixture rows of spec 11.3; no drift.
  - `RaceResult` is state and `PredictionLog` non-state; nothing bumps by hand.
  - `recordPrediction` replaces `logPrediction` at both call sites inside their transactions;
    regenerating twice in a week leaves one row with the newer values; a later week adds a row; no
    row on or after race day, with a result, without a distance or without a prediction; new rows
    carry `inputs.course`.
  - `runPredictionJob` runs every 6 hours (first after 30 s), uses `currentGoalFor`, does no engine
    work when the week has a row (spy), continues past a failing user and records a `job` run.
  - `GET /api/predictions` collapses a week to its newest row and carries `weekStart` and
    `loggedOn`; the existing engine tests pass unchanged.

## Wave 3

### Task R0-2: Revision foundation, part 2: undo, preview, seen, safety guard (server only)

Size M. Depends on: R0-1. Contract: spec 4.2.

- **Files:** `shared/engine/undoGuard.ts`, `shared/types.ts`,
  `server/services/{revisions,planActions}.ts`, `server/routes/plan.ts`, `server/serialize.ts`,
  `tests/unit/engine/undoGuard.test.ts`, `tests/api/revisions.test.ts`.
- **Acceptance:**
  - `POST /api/plan/preview` accepts `replan` and `undo`; `computeAction` is the only builder of a
    preview or a commit; the undo preview's diff deep-equals the committed undo revision's diff; the
    preview writes nothing and leaves the data version unchanged.
  - `POST /api/plan/revisions/:id/undo` restores exact rows (ids and `externalId`s), writes an
    `undo` revision linked both ways, answers 409 with `details.reasons` for every structural code,
    409 stale-preview on a hash mismatch, 422 with the checklist when the restored plan fails, and
    writes nothing on refusal (the cached state then equals the database).
  - Undo is refused only by touched rows changed since (by hash): a later revision that touched
    other rows does not block it; a linked session gives `session-run`; a cited active safety flag
    gives `safety-rule`, except for a runner-created rest window; rows before today are left as they
    are.
  - `GET /api/plan/revisions` computes `undo.available` structurally with one id query per page and
    at most one cached input read, and never runs the checklist (spy).
  - `POST /api/plan/revisions/:id/seen` is idempotent (204).
- **Tests:** spec 4.2 policy cases; the DMMF round trip; the rollback leaves no stale snapshot.

### Task E3-8: Parsers after authentication, Make active moves the plan, restore, foundation e2e

Size L. Depends on: E3-3, E3-6, E3-7, R0-1. **Docker.** Contract: spec 4.8, 5.4, 5.7.

- **Files:** `server/app.ts`, `server/routes/{ingest,goals,plan}.ts`,
  `server/services/planEngine.ts`, `shared/types.ts`, `web/api/{goals,plan,client}.ts`,
  `web/components/{ActivateConfirm.tsx,ActivateConfirm.module.css}`, `web/pages/GoalsPage.tsx`,
  `tests/api/{bodyParsers,goals}.test.ts`, `tests/web/goals.test.tsx`,
  `tests/e2e/NN-foundation.spec.ts`, `tests/e2e/06-narrow-viewport.spec.ts`, `CLAUDE.md`,
  `docs/STATUS.md`, `docs/adr/0009-athlete-state-snapshot-and-data-version.md`.
- **Acceptance:**
  - The pipeline order of spec 4.8 holds; the six body-parser tests pass (401 before 413 without a
    session; ingest 401 on a bad token with a 5 MB body; 413 only after a valid token).
  - Activate behaves as spec 5.4 for every case, writing the `goal-switch` revision through
    `recordPlanWrite`; a generate failure changes nothing.
  - Archived plans list and restore as spec 5.4 (409 cases; `replanned: false` with the checklist
    message).
  - The confirm and restore UI follow spec 5.7 (focus, Escape, toasts), queried by role.
  - The foundation e2e passes its four specs; the 360 px spec covers Integrations with Recent syncs
    open and the Goals confirm.
  - STATUS removes follow-ups 8 and 10; CLAUDE.md records the request-order rule; ADR 0009 gets the
    measured numbers.

### Task E2-4: Today service and route: one coach payload

Size M. Depends on: E2-2, E2-3, E3-1, E3-2, E3-3. Contract: spec 7.4.

- **Files:** `server/services/{today,todaySlots,todayHealth,planEngine}.ts`,
  `server/routes/today.ts`, `server/serialize.ts`, `shared/types.ts`,
  `tests/api/today-coach.test.ts`, `tests/web/today-fixtures.ts`.
- **Acceptance:**
  - `todayView` moves to `server/services/today.ts` (`planEngine.ts` re-exports it); later fields go
    under `TodayCoach`; the route parses `todayQuery` (400 "Use today or one of the next two
    days.").
  - Inputs come from `loadAthleteContext` and the forecast cache only.
  - The hero, eased session, targets (`resolveTargets` plus `climbNote`, hot from
    `isHotForSteering`), week strip, race block (through `currentGoalFor`, `predictFromState` and
    `rangeLabel`), change line (newest weekly, break or review revision of the last 7 days, stored
    summary) and health counts follow spec 7.4.
  - `tz` is the server's zone; slots build under `Promise.allSettled` and return null in this task;
    health-note producers are a registry; a future date returns a read-only preview.
  - API tests of spec 7.8 pass, including health parity with the old client computation.

### Task E1-3: FIT writer, deliverable builder, per-session and per-week downloads

Size M. Depends on: E1-2, E2-2, E3-2, E3-3, E3-7. Contract: spec 6.4, 6.5.

- **Files:** `server/services/{workoutFit,workouts,fuelLine}.ts` (`fuelLine.ts` a stub over E6's
  seam), `server/routes/plan.ts`, `tests/fixtures/fit/readWorkout.ts`,
  `tests/fixtures/fit/workouts/`, `tests/unit/server/workoutFit.test.ts`,
  `tests/unit/engine/targetSurfaces.test.ts` (FIT adapter), `tests/api/workouts.test.ts`.
- **Acceptance:**
  - `encodeWorkoutFit` writes the messages and fields of spec 6.5 with `FitEncoder`, lives under
    `server/`, adds no dependency, and decodes back with the asserted units, repeats and step count;
    `fitText` sizes are correct for ASCII and non-ASCII input; output is byte-identical for
    identical input.
  - `buildDeliverables` reads `loadAthleteContext` once (no history-window query), the cached
    forecast through `trainingHeatAdvice(...).peak`, eases today only, uses `isToRun` and
    `publishable`, calls the fuel seam once, and is the single builder for the routes.
  - The two download routes behave as spec 6.4 (filenames from date and kind slug, 404 and 409
    cases, Monday check, cookie required, `no-store`, `fflate` zip); today's eased session downloads
    the easy version; a moved long run still downloads.
  - The FIT adapter is registered in the cross-surface test.
  - Manual, recorded in the PR: one easy, one interval and one long file loaded on the owner's watch
    or opened in a FIT viewer; any change to manufacturer, repeat target type or string caps lands
    here.

### Task E4-7: What stood out: facts, `ActivityInsight`, pipeline hook, activity card

Size L. Depends on: E4-1, E4-2, E3-2. **Docker.** Contract: spec 8.3-8.6.

- **Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_activity_insight/migration.sql`,
  `server/dataVersion.ts`, `shared/engine/{standout,execution}.ts`,
  `shared/copy/{standoutTemplates,standoutRender}.ts`, `server/services/{insight,execution}.ts`,
  `server/routes/activities.ts`, `server/jobs/scheduler.ts`, `web/api/activities.ts`,
  `web/components/{StandoutCard.tsx,StandoutCard.module.css}`, `web/pages/ActivityDetailPage.tsx`,
  `tests/unit/engine/standout.test.ts`, `tests/api/standout.test.ts`,
  `tests/web/standout-card.test.tsx`, `tests/unit/server/migrations.test.ts`.
- **Acceptance:** the eleven selections and ranking of spec 8.5 (pain first; no effort verdict
  without the runner's rating; heart-rate facts above `standout.hrDeltaMinBpm`; drift only from 90
  min and below 25 C); the route computes from the snapshot and the memoised heart-rate model,
  stores on first read, recomputes after a rating, an edit or a version bump, returns none for
  strength and cross, 404 for another user; a moved or eased linked session still yields the
  assessment (`isToRun`); `ActivityInsight` is non-state and writing it leaves the version
  unchanged; the card renders the copy of spec 8.6; no change to the stored assessment shape.

### Task E5-4: Disruption windows in the engine

Size L. Depends on: E5-3. **Validation.** Contract: spec 9.5.

- **Files:**
  `shared/engine/{index,micro,adapt,athlete,limits,guards,checklist,macro,execution,types}.ts`,
  `server/services/engineInput.ts`,
  `tests/unit/engine/{disruption-integration,disruption-sweep,adapt,week-caps,matrix}.test.ts`.
- **Acceptance:**
  - Without `EngineInput.disruptions`, `buildPlan` and `replan` give byte-identical output on every
    matrix athlete.
  - Held days carry rest sessions with window copy; no quality on quiet days; caps respected; no
    strength on hold days.
  - Return caps apply to the return week (prorated) and the next full week; no minutes added to any
    week (per-week invariant against the baseline); no double restart for a back-dated long illness.
  - `keptByReplan` takes the hold dates; `adjusted` joins `OWNER_EDITS` and `isToRun`'s map;
    `injuryTight` replaces the listed `recentInjury` reads and leaves `cycleWorkWeeks` unchanged
    (test).
  - `weeklyDecision` returns the early hold for disrupted weeks and excludes covered days from
    completion; the checklist gains `disruption-window` and the exemptions; adjacent-day matching
    uses `isToRun`.
  - The seeded sweep of spec 9.8 passes in CI under 60 seconds; the owner validation before and
    after with a 3-day illness window keeps the 100-mile label and checklist outside the window.

### Task E6-4: Fuel schema, products, settings and log API

Size M. Depends on: E6-1, E6-2, E3-1. **Docker.** Contract: spec 10.3, 10.4.

- **Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_fuel_lab/migration.sql`,
  `server/{db,dataVersion,app,serialize}.ts`, `server/routes/fuel.ts`, `server/services/fuel.ts`,
  `shared/types.ts`, `tests/api/fuel.test.ts`, `tests/unit/server/migrations.test.ts`.
- **Acceptance:** the three models (state) with the chain case; routes mounted under `requireAuth`
  with Zod and the errors of spec 10.4 (400 with paths, 404, 409, never 422); logs snapshot
  products, store `hotOverride` null unless the runner chose, and return the replayed
  `{ log, ladder, message }`; live-name uniqueness frees a name on archive; the settings rules hold;
  a late weather fill re-judges a saved run; the PUT is idempotent.

### Task E10s-3: Race results and the track-record read model

Size M. Depends on: E10s-1, E10s-2. Contract: spec 11.4.

- **Files:** `server/services/{raceResults,trackRecord,execution}.ts`,
  `server/routes/{goals,predictions}.ts`, `server/serialize.ts`, `tests/api/raceResults.test.ts`.
- **Acceptance:** the result routes behave as spec 11.4 (one transaction, retype, `syncActuals`,
  `runExecutionQuietly` after commit, 400 with paths, 409, 404); `actualSec` is set only on
  comparable pre-race rows; the record loads all of a goal's rows, collapses each week to its newest
  row, then scores; `summary.enough` only from 3 scored races; the linked activity appears among the
  race anchors of the next engine input; cascades as specified; no secret or provider code touched.

## Wave 4

### Task E2-5: The coach hero UI and the spec edit

Size L. Depends on: E2-1, E2-4. Contract: spec 7.6.

- **Files:** `web/pages/DashboardPage.tsx` and `.module.css`, `web/api/today.ts`,
  `web/components/today/{ReadinessRead,SessionHero,SessionTargets,CoolerStart,KnowToday,WeekStrip,RaceCountdown,ChangeLine,ChangeSheet,TodaySkeleton,targetText}.tsx`
  and CSS modules, `web/components/{Meter.tsx,format.ts}`,
  `docs/superpowers/specs/2026-10-21-running-app-rewrite-design.md`,
  `docs/superpowers/specs/2026-10-21-visual-design.md`, `README.md`,
  `tests/web/{today,dashboard,feedback}.test.tsx`, `tests/web/today-fixtures.ts`,
  `tests/e2e/09-engine.spec.ts`, `tests/unit/engine/targetSurfaces.test.ts` (hero adapter reads the
  rendered view).
- **Acceptance:**
  - Above the fold Today requests only `/api/today` and `/api/settings` (the unmocked-call guard
    asserts it); unrated runs come from `today.unrated`.
  - Every hero variant, the targets order by mode, the cooler start, the disclosure, the week strip
    (marks, names, `aria-current`, Meter, the advisory line), the race countdown, the change line in
    the `brief` slot and the skeleton render as spec 7.6; slots render through `TodaySlot`.
  - Explain opens the why drawer with the session's rules (J3 for an eased session); Done and Not
    today render in their final positions (wired in E2-6).
  - The spec edits of decision 2 land: §4.7 reads "`/` Today" as a coach, section 7 gains the owner
    decision, the visual design's dashboard hierarchy matches, and
    `grep -n "leads with the week's hours" docs/superpowers/specs/*.md` returns nothing; README
    notes that offline use needs https or localhost.
  - Migrated tests pass, including the shared-lint copy test; 09-engine finds the hero by role
    `article` and the session title.

### Task E1-5: Publish service, jobs, status and settings API

Size L. Depends on: E1-3, E1-4, E3-6, E3-7. Contract: spec 6.4, 6.8.

- **Files:** `server/services/publish.ts`, `server/routes/{wrist,integrations}.ts`, `server/app.ts`,
  `server/jobs/scheduler.ts`, `server/serialize.ts`, `server/services/todayHealth.ts` (the
  tomorrow-not-on-watch producer), `shared/types.ts`,
  `tests/api/{wristPublish,wristRoutes,scheduler}.test.ts`.
- **Acceptance:**
  - `publishForUser` follows the eight steps of spec 6.8: 14 days only, create before withdraw, no
    write when content is unchanged, moves are in-place PUTs, skip and rest withdraw, eased
    replaces, owner removals are not recreated, done sessions are left alone.
  - The remote id is `workoutExternalId(externalId, userTagOf(userId))`; no id is derived from date,
    kind or order anywhere.
  - Change detection is the composed key plus the 30-minute backstop; a run leaves the data version
    unchanged (asserted); the forecast stamp is part of the key (tested).
  - Retry rules of spec 6.8 hold; each run writes one `SyncRun` of channel `publish`; a skipped tick
    writes none; the jobs are registered and never overlap.
  - Status, settings, publish and disconnect routes behave as spec 6.4 with Zod; a failed withdraw
    on disconnect answers 409 `remove-failed` and keeps the integration; the on-watch rule is tested
    both ways; no secret is logged or returned.
  - Sessions restored the way an undo restores them reach the next run as an upsert (rows written
    directly).

### Task E1-6: Private ICS feed with a hashed token

Size M. Depends on: E1-3, E1-4. Contract: spec 6.4, 6.5.

- **Files:** `server/services/calendar.ts`, `server/routes/{calendar,wrist}.ts`, `server/app.ts`,
  the pino-http serializer, `tests/unit/server/ics.test.ts`, `tests/api/calendarFeed.test.ts`,
  `tests/unit/engine/targetSurfaces.test.ts` (ICS adapter).
- **Acceptance:** the feed is mounted where spec 4.8 says and answers as spec 6.4; only the token's
  hash is stored on `DeliveryChannel`; there is no Integration row or registry entry; titles are
  `publicTitle` only and descriptions carry no numbers or reasons (a test seeds injury, illness and
  pain and scans the whole output); the access log shows `/api/calendar/:token/`; skipped and done
  sessions are omitted, moved and eased ones included; race day is a bare "Race day".

### Task E4-3: The why drawer opens with the runner's numbers

Size M. Depends on: E4-2, E2-1. Merges after E3-8 on `GoalsPage.tsx`. Contract: spec 8.6.

- **Files:** `web/api/{explain,client}.ts`,
  `web/components/{WhyDrawer,InputFacts,ExplainButton,SessionSheet}.tsx` and CSS,
  `web/components/today/` (Explain call sites),
  `web/pages/{PlanPage,ReviewPage,GoalsPage,ProfilePage}.tsx`,
  `tests/web/{why-drawer-inputs,session-sheet,plan,review,goals,profile,today}.test.tsx`.
- **Acceptance:** "From your numbers" comes before the rule section; the request runs only while
  open; sources link to activities with dates and distances in the runner's units; insufficient and
  policy-only states and the failure alert render as spec 8.6; every call site passes an
  `ExplainRef` (asserted per page); `DashboardPage.tsx` itself is not edited; `ExplainButton`'s
  props and name format are unchanged; pages pass `expectCleanCopy`.

### Task E4-4: Revision presentation: causes and the one set of diff and undo components

Size M. Depends on: R0-2, E3-7, E4-1. Contract: spec 4.2, 8.6.

- **Files:** `shared/engine/revisionDiff.ts` (`attributeChange`),
  `shared/copy/{revision,briefTemplates}.ts`, `server/serialize.ts`, `server/services/reviews.ts`,
  `web/api/{plan,client}.ts`, `web/components/revisions/{PlanDiffView,RevisionDiff,UndoControl}.tsx`
  and CSS, `web/components/planChanges.ts`, `web/pages/{PlanPage,ReviewPage}.tsx`,
  `tests/unit/engine/revisionDiff.test.ts`, `tests/unit/shared/undo-copy.test.ts`,
  `tests/api/revision-presentation.test.ts`, `tests/web/{revision-diff,plan,review}.test.tsx`.
- **Acceptance:**
  - `attributeChange` gives every diff line at least one cause, tested over the replan-chain matrix;
    `PlanRevisionView` gains derived causes without changing its shape.
  - `PlanDiffView` renders a `PlanDiff` (week lines, session lines as from and to, the "moved"
    presentation, five lines then "Show all N changes"); `RevisionDiff` adds the reason label,
    causes, Why and `UndoControl`; `UndoControl` opens the undo preview, shows the restore diff and
    the confirm copy of spec 8.6 (auto revisions add the next-update sentence), toasts on success,
    and renders every `UndoReasonCode` as a muted line through one exhaustive `Record` (a new code
    fails the build until it has copy).
  - Plan "What changed" and Review's post-save block use these components; unseen revisions show
    "New" and the panel sends `seen` on open; reason labels cover every reason value.
  - `planChanges.ts` keeps only the legacy renderer for `diff = null`; no other formatter exists.
  - Undo success invalidates the plan, revisions, brief, state and Today keys.

### Task E5-5: Disruptions on the server

Size M. Depends on: R0-1, R0-2, E5-4, E3-1. **Docker.** Contract: spec 9.3, 9.4.

- **Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_disruptions/migration.sql`,
  `server/dataVersion.ts`, `shared/types.ts`,
  `server/services/{disruptions,planActions,replan,engineInput,todaySlots}.ts`,
  `server/routes/{plan,today}.ts`, `server/serialize.ts`, `server/jobs/scheduler.ts`,
  `web/api/{disruptions,client}.ts`, `tests/api/{disruptions,scheduler}.test.ts`,
  `tests/unit/server/migrations.test.ts`. Merges after or before E5-6 with a rebase on
  `planActions.ts` and `routes/plan.ts`.
- **Acceptance:**
  - Routes and the preview's disruption types use the Zod shapes of spec 9.4; validation 400;
    checklist 422 only; no new environment variable.
  - `Disruption` is state (chain case added); right after POST the next `GET /api/today` reflects
    the window with no TTL wait.
  - Preview and commit diffs are deep-equal per disruption action; the preview writes nothing (row
    counts of five tables and the data version unchanged); a stale hash answers 409 with the new
    preview.
  - Back-dating skips unlinked planned sessions (flag `rest-window`, original kept), leaves linked
    and completed ones, and both directions are in the undo payload.
  - Windows load within `j9.maxWindowDays`; a regenerate re-applies them; `GET /api/today` returns
    phases for the viewed date, including `?date=`; the Monday job honours a window created the
    evening before.
  - DELETE writes a forward revision with its own undo, never blocked by later edits; windows are
    scoped per user; `resetData()` clears them (test).

### Task E5-6: Move, swap, shorten and skip as one guarded action

Size M. Depends on: R0-1, R0-2, E5-3. Contract: spec 9.4, 9.5.

- **Files:** `shared/engine/{adjust,index,execution}.ts`, `shared/copy/revision.ts`,
  `shared/types.ts`, `server/services/{adjust,planActions,planEngine}.ts`, `server/routes/plan.ts`,
  `tests/unit/engine/adjust.test.ts`, `tests/api/{adjust,plan}.test.ts`,
  `tests/e2e/04-plan.spec.ts`.
- **Acceptance:** `adjustCheck` holds the moved guard logic plus the new guards and the shorten
  builder, each guard with a code, a template message with rule ids and a `suggest` where one
  exists; the adjust route and preview behave as spec 9.4; shorten never lengthens, never goes below
  the minimum, never adds minutes elsewhere, and sets `adjusted`, which survives a re-plan and is
  treated as to-run by every known reader (test lists them); the legacy PUT delegates and existing
  plan tests and 04-plan pass unchanged; every commit updates the row in place and writes a revision
  whose undo restores it.

### Task E6-5: Lab view, fuel context, targets, prompts, Today fields, plan option

Size M. Depends on: E6-2, E6-3, E6-4, E2-4, E3-3, R0-1. Contract: spec 10.4, 10.5.

- **Files:** `server/services/{fuel,planEngine,replan,duplicates,todaySlots}.ts`,
  `server/routes/fuel.ts`, `server/services/fuelLine.ts` (replaces E1-3's stub), `shared/types.ts`,
  `tests/web/today-fixtures.ts`, `tests/api/fuel.test.ts`,
  `tests/unit/engine/targetSurfaces.test.ts` (fuel line adapter).
- **Acceptance:** `GET /api/fuel` returns `FuelLabView` with the replayed ladder (hot by `runIsHot`,
  block credit by `isBlockRun` with the week fallback); `loadFuelContext` plus the pure
  `fuelLineForSession` give the watch line for a moved and an eased long run; targets validate their
  range; Today carries `coach.fuel`; `options.gutTraining` is merged inside R0's single
  `applyReplan` path and a regenerated plan for a gut condition has no gut-training flag; a
  confirmed duplicate's log moves to the original; the fuel line is in the cross-surface test.

## Wave 5

### Task E2-6: One-row check-in with the outbox, Done, Not today, the check-in sheet

Size M. Depends on: E2-5. Contract: spec 7.6.

- **Files:**
  `web/components/today/{CheckinRow,CheckinSheet,SessionActions,DoneSheet,NotTodaySheet,ReadinessRead}.tsx`
  and CSS, `web/components/{ScalePicker.tsx,ScalePicker.module.css}`, `web/pages/ActivityForm.tsx`,
  `web/api/checkins.ts`, `web/pwa/outbox.ts`, `tests/web/{today,components}.test.tsx`,
  `tests/web/outbox.test.ts`, `tests/e2e/NN-today.spec.ts`, `tests/e2e/06-narrow-viewport.spec.ts`.
- **Acceptance:** the radiogroup saves `{ fatigue }` in one tap, moves focus to the verdict and
  folds; the outbox queues only allowlisted idempotent PUTs (one array E6 extends), coalesces by
  URL, replays on `online` and foreground, drops 4xx with one message and entries older than 7 days,
  and is cleared on logout and any 401; the check-in sheet keeps pain, illness and bone tenderness
  one tap away with n-1 inheritance unchanged and 44 px targets; Done posts one prefilled run, keeps
  a draft offline and disables Save with the offline sentence; Not today hosts `SessionChanges` and
  takes `children` for E5; 360 px chips fit with no horizontal scroll.

### Task E1-7: Wrist status on Plan, session-sheet targets and downloads, the watch line

Size M. Depends on: E1-5, E1-6. Contract: spec 6.7.

- **Files:** `web/api/{wrist,client,plan}.ts`,
  `web/components/{WristStatus,WristStrip,WristLine}.tsx` and CSS,
  `web/components/SessionSheet.tsx`, `web/pages/PlanPage.tsx`,
  `tests/unit/engine/targetSurfaces.test.ts` (sheet and intervals.icu adapters),
  `tests/web/{WristStatus,PlanWrist}.test.tsx`.
- **Acceptance:** every chip state and code renders the copy of spec 6.7, passes the lint and
  renders nothing offline; the Plan strip, chips in the 14-day window, week zip links with
  day-specific names and the sheet's "On your watch" section render; the sheet's targets use
  `resolveTargets` ("under N bpm"); `WristLine` is self-contained and tested; `DashboardPage.tsx` is
  not edited; the cross-surface test passes for every kind with the sheet and intervals.icu
  adapters; 360 px has no horizontal scroll.

### Task E4-5: Weekly brief: facts, storage, scheduler hook, API

Size L. Depends on: E4-1, E4-2, E4-4, R0-1, E3-6, E10s-1. **Docker.** Contract: spec 8.3-8.5, 8.7.

- **Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_weekly_brief/migration.sql`,
  `server/dataVersion.ts`, `shared/engine/{brief,types}.ts`,
  `shared/copy/{briefTemplates,briefRender}.ts`, `server/services/brief.ts`,
  `server/routes/brief.ts`, `server/app.ts`, `server/jobs/scheduler.ts`, `server/serialize.ts`,
  `shared/types.ts`, `tests/unit/engine/brief.test.ts`, `tests/unit/shared/brief-render.test.ts`,
  `tests/unit/engine/targetSurfaces.test.ts` (key-session adapter),
  `tests/api/{brief,scheduler}.test.ts`, `tests/unit/server/migrations.test.ts`.
- **Acceptance:** `buildBriefFacts` is pure and deterministic with causes on every change, at most
  four noticed facts with frozen inputs, and a key session from `isToRun` sessions whose target
  equals Today's (cross-surface); a 50-week fuzz render passes the lint; the job writes a brief
  after a re-plan and a brief with a replan note after a failure, and a brief failure never fails
  the re-plan; the catch-up produces a normal brief; the routes behave as spec 8.4 (seen stamps the
  revision; no seen column); `BriefView.revision.undo` equals the list's state; `WeeklyBrief` is
  non-state and writing it leaves the version unchanged; concurrent GETs create one row; the
  prediction line stays hidden without two weekly rows.

### Task E5-7: Not 100% sheet, banner, adjust section, Plan integration

Size L. Depends on: R0-2, E4-4, E5-5, E5-6. Contract: spec 9.6.

- **Files:**
  `web/components/disruption/{NotFullSheet,ReplanSheet,DisruptionBanner,AdjustSection}.tsx` and CSS,
  `web/components/{SessionSheet.tsx,planChanges.ts,format.ts}`, `web/api/{disruptions,plan}.ts`,
  `web/pages/PlanPage.tsx` and CSS,
  `tests/web/{not-full-sheet,disruption-banner,session-adjust,session-sheet,plan}.test.tsx`,
  `tests/e2e/NN-disruptions.spec.ts`, `tests/e2e/06-narrow-viewport.spec.ts`.
- **Acceptance:** the header has "Not 100%" and "Update plan from latest data" opens a preview; the
  sheet implements the three steps and every sentence of spec 9.6 with bounds from the Params and
  dates from the server; the preview reuses E4-4's `PlanDiffView`; Apply sends `expectHash`, a stale
  preview swaps in, a blocked preview disables Apply; `AdjustSection` replaces the change section
  with live dry-run guards and the swap suggestion, and the web no longer calls the legacy PUT;
  rest-window days and week chips render; no red; the lint passes over rendered pages; the e2e
  back-dated illness applied and undone passes with service workers blocked.

### Task E6-6: Fuel hooks, the 20-second log, activity and Today surfaces

Size M. Depends on: E6-5, E2-5. Contract: spec 10.6.

- **Files:** `web/api/{fuel,client}.ts`,
  `web/components/fuel/{FuelLogForm,ProductPicker,SymptomScale,FuelPromptCard,FuelTargetLine,fuelText}.tsx`,
  `web/components/today/` (slot mounts), `web/pages/ActivityDetailPage.tsx`,
  `web/components/SessionSheet.tsx`, `web/pwa/outbox.ts` (allowlist entry),
  `tests/web/{fuel,dashboard,activity-detail}.test.tsx`.
- **Acceptance:** the form meets spec 10.6 (live total, "Same as last long run", gut required, hot
  chip sending `null` until touched, the interpolated reference note, the server message toast,
  alert on error, the kept draft in try/catch); `PUT /api/fuel/logs/:activityId` is in the outbox
  allowlist; the prompt card and target line mount in the `fuelPrompt` and `fuel` slots without
  editing `DashboardPage.tsx`; the activity page and the session sheet gain their Fuel sections; a
  first log is possible without a keyboard; pages pass the lint.

### Task E10s-4: Goals page: record a result and the track record

Size M. Depends on: E10s-3, E3-8, E4-3, E3-5. Contract: spec 11.6.

- **Files:** `web/api/{predictions,client}.ts`,
  `web/pages/{GoalsPage,GoalsPage.module.css,RaceResultSheet}.tsx`,
  `web/components/{PredictionTrackRecord.tsx,PredictionTrackRecord.module.css,goalFormat.ts}`,
  `web/components/charts/{PredictionTrackChart.tsx,PredictionTrackChart.module.css,theme.ts}`,
  `tests/web/{track-record,goals}.test.tsx`.
- **Acceptance:** rebased onto E3-8's and E4-3's `GoalRow` with their tests unchanged; the button,
  sheet, toasts, removal confirm and field errors follow spec 11.6; the activity list reads the
  paged envelope through the hook; the track record renders the lead, summary (needed count from the
  API), headline, chart (static import, accessible name) and captioned table; copy comes from
  `shared/copy/trackRecord.ts`; no horizontal page scroll at 360 px; parse helpers extracted with
  GoalSheet tests unchanged.

## Wave 6

### Task E2-7: Two columns, lazy recent weeks, server-day rollover, the measured fold

Size M. Depends on: E2-6. Contract: spec 7.6.

- **Files:** `web/pages/DashboardPage.tsx` and CSS, `web/components/today/RecentWeeks.tsx`,
  `web/components/{useMediaQuery,useInView}.ts`, `web/api/{today,weeks}.ts`,
  `tests/web/today-layout.test.tsx`, `tests/e2e/NN-today.spec.ts`.
- **Acceptance:** the 900 px grid and the single-column order of spec 7.6 with the hero first in DOM
  order with every slot filled; RecentWeeks lazy-loads the chart and fetches only in view;
  `useServerToday` requests the new day after midnight in the server zone (fake timers, different
  device zone); Playwright fills every slot to its budget and asserts Done's bottom ≤ 788 at 390 ×
  844 unanswered and ≤ 707 at 390 × 707 answered, inside the viewport at 360 × 740, and the strip in
  the right column at 1280 × 800, with a screenshot attached; no horizontal scroll at 360 px;
  `slots.ts` documents the budgets as the contract for E1, E4, E5 and E6.

### Task E1-8: Publishing settings, disconnect choice, calendar link, Today mount, e2e, docs

Size M. Depends on: E1-5, E1-6, E1-7, E2-5. Contract: spec 6.7.

- **Files:** `web/components/{WristSettings,CalendarFeed}.tsx`, `web/pages/IntegrationsPage.tsx`,
  `web/api/wrist.ts`, `web/components/today/` (watch slot mount),
  `tests/web/{WristSettings,TodayWrist}.test.tsx`, `tests/e2e/NN-wrist.spec.ts`, `CLAUDE.md`,
  `docs/STATUS.md`, `README.md`, `docs/superpowers/specs/2026-10-22-training-engine-design.md` (a
  delivery pointer).
- **Acceptance:** the intervals.icu card and the standalone Calendar link section follow spec 6.7
  (both checkboxes off by default, last send, Send now, remove-sent, dormant-account note,
  disconnect choice and fallback; link shown once, copy, `webcal://`, turn off, the 28-day and
  14-day sentence); `WristLine` fills the `watch` slot within its 24 px budget at 360 px; the e2e
  covers the file name, the week zip, the calendar link fetched without a cookie and revoked, and
  the "sending is off" sentence; CLAUDE.md Providers names the publish channel; STATUS lists the
  manual watch checks done or open; README describes the three delivery routes.

### Task E4-6: Brief page, the brief line and navigation

Size M. Depends on: E4-3, E4-4, E4-5, E2-5. Contract: spec 8.6.

- **Files:** `web/api/{brief,client,plan}.ts`, `web/pages/{BriefPage.tsx,BriefPage.module.css}`,
  `web/components/{BriefLine.tsx,BriefLine.module.css}`, `web/components/today/` (brief slot),
  `web/{App,pages/MorePage}.tsx`, `tests/web/{brief,brief-line,nav}.test.tsx`,
  `tests/e2e/NN-explain-brief.spec.ts`.
- **Acceptance:** `/brief` and `/brief/:weekStart` render every section of spec 8.6 in order at 360
  px and in two columns from 900 px (Playwright screenshots); loading, error, no-plan, not-yet,
  provisional and replan-note states use the exact copy and only a real error uses `role="alert"`;
  `BriefLine` replaces `ChangeLine` in the `brief` slot within its budget with one "New" marker
  driven by `seenAt`; More lists "Weekly brief"; the e2e covers a change with its cause and undo,
  undo refused after a run and while a warning sign is active; plan-changing mutations invalidate
  the brief.

### Task E6-7: The Fuel lab page

Size M. Depends on: E6-6. Contract: spec 10.6.

- **Files:** `web/pages/{FuelLabPage.tsx,FuelLabPage.module.css}`,
  `web/components/fuel/{FuelTargetCard,TierLadder,FuelHistory,ProductManager,GutBlockCard,FuelSettingsForm,EahCard}.tsx`,
  `web/{App.tsx,pages/MorePage.tsx,components/Nav.tsx}`, `tests/web/{fuel,nav}.test.tsx`.
- **Acceptance:** `/fuel` renders every section of spec 10.6 in phone order and in two columns from
  900 px, reachable from More and highlighted in the nav; the ladder shows state words and a grade
  per rung; history is a scrollable labelled region with the replayed note; products, settings and
  the gut condition behave as specified; the EAH card's standard and stronger variants render with
  `role="note"` and numbers from `P`; empty, loading and error states use the exact copy.

### Task E10s-5: Track-record e2e and docs

Size S. Depends on: E10s-4.

- **Files:** `tests/e2e/NN-track-record.spec.ts`, `tests/e2e/helpers.ts` (`seedPredictionLogs`),
  `docs/STATUS.md`, `docs/superpowers/specs/2026-10-22-training-engine-design.md` (pointer to L7).
- **Acceptance:** the spec records, persists, edits and removes a result through the UI with
  clock-computed dates and checks 360 px; `seedPredictionLogs` writes through Prisma with the reason
  documented; STATUS records the weekly logging, the 3-race summary and the open questions.

## Wave 7

### Task E2-8: Offline shell, icons, manifest, ADR 0012

Size L. Depends on: E2-4, E2-7. **Docker.** Contract: spec 7.6.

- **Files:** `web/sw/{sw.js,buildSw.ts}`, `web/pwa/register.ts`, `web/main.tsx`, `web/api/auth.ts`,
  `web/components/today/OfflineNote.tsx`, `web/components/useOnline.ts`,
  `web/pages/SettingsPage.tsx`, `web/index.html`,
  `web/public/{manifest.webmanifest,icon-192.png,icon-512.png,icon-maskable-512.png,apple-touch-icon.png}`,
  `scripts/make-icons.ts`, `package.json` (an `icons` script only), `vite.config.ts`,
  `playwright.config.ts`, `server/static.ts`, `eslint.config.js`, `CLAUDE.md`,
  `docs/adr/0012-offline-shell.md`, `tests/unit/shared/{sw,swBuild,pwaAssets}.test.ts`,
  `tests/web/offline.test.tsx`, `tests/e2e/NN-today.spec.ts`.
- **Acceptance:** the build emits `sw.js` with the build id and precache list substituted and no new
  dependency; the worker implements exactly the strategies, allowlist, TTLs, 401 purge, server-day
  fallback and throttled warm of spec 7.6, each covered by a unit test; two shell generations are
  kept and `main.tsx` reloads once on `vite:preloadError`; registration only in production builds;
  logout clears `rl-api-v1` and the outbox; the four PNGs are committed and their IHDR sizes tested;
  the manifest and `index.html` carry the fields of spec 7.6; Playwright blocks workers except the
  offline spec; `sw.js` and the manifest are served with `no-cache`; ADR 0012 Accepted; OfflineNote
  and the Settings row render; the offline e2e opens today's session with the network off, keeps a
  check-in and sends it on reconnect; logout clears the caches; `docker build .` and the healthcheck
  pass.

### Task E4-8: Remaining input builders, coverage, docs, owner reading pass

Size M. Depends on: E4-2, E4-3, E4-5, E4-6, E4-7. **Validation.**

- **Files:** `shared/engine/explainInputs.ts`, `shared/copy/explainTemplates.ts`,
  `tests/unit/engine/explainInputs.test.ts`,
  `docs/superpowers/specs/2026-10-22-training-engine-design.md`,
  `docs/superpowers/specs/2026-10-21-running-app-rewrite-design.md`, `docs/STATUS.md`,
  `research/engine-rules.md` (only if the owner approves the G5 line),
  `tests/e2e/NN-explain-brief.spec.ts`.
- **Acceptance:** builders exist for every rule still PENDING (including rules added by E1, E5, E6
  and E10s); the PENDING list is empty and the coverage test fails on a rule with neither builder
  nor policy entry; the rewrite design section 7 and section 6 describe the new pages and endpoints;
  a reading pass on three generated briefs and ten standout cards from the owner validation database
  (outside the repository) finds no wrong, alarming or banned sentence, and fixes land in the
  templates; plan output unchanged.

### Task E5-8: Today slots, publish and brief wiring for disruptions

Size S. Depends on: E5-7, E2-7, E1-5. Contract: spec 9.6.

- **Files:** `web/components/today/` (disruption slot, Not today handler),
  `web/components/disruption/DisruptionBanner.tsx`, `web/api/today.ts`,
  `server/services/todaySlots.ts`, `tests/web/{today,dashboard}.test.tsx`,
  `tests/api/wristPublish.test.ts`, `tests/e2e/NN-disruptions.spec.ts`, `docs/STATUS.md`.
- **Acceptance:** Not today opens `NotFullSheet` with today's server date while the skip stays in
  the session sheet; the banner fills the `disruption` slot only with a window, within its 64 px
  budget, and E2-7's worst-case test still passes; the "Set a rest window and a return plan?" prompt
  appears after an illness or pain check-in with no window and creates nothing; a window created
  through the API withdraws held days on the next `publishForUser` and its undo upserts them again;
  Today, the session sheet and the publish set agree on a rest-window day; STATUS lists the E5
  follow-ups (prediction widening for planned windows, moves across weeks, merge-style undo,
  open-ended windows, travel across time zones).

### Task E6-8: Fuel e2e, narrow viewport, handoff docs

Size S. Depends on: E6-7.

- **Files:** `tests/e2e/NN-fuel.spec.ts`, `tests/e2e/06-narrow-viewport.spec.ts`,
  `tests/e2e/helpers.ts` (`apiFor().put`), `docs/STATUS.md`, `CLAUDE.md` (only if a convention
  changed).
- **Acceptance:** the e2e adds a product, logs a 3-hour run, sees the target step up, logs two runs
  scored 2 and reads the fall-back explanation, and sees the stronger EAH card for a 100-mile goal;
  the lab and an open log form fit 360 px; STATUS records the E1 seam and the E11/E12 surface and
  closes the "long-run lab and fuelling logs" non-goal of follow-up 11.

### Task C1: Close phase 3a

Size S. Depends on: every task above.

- **Files:** `docs/STATUS.md`, `CLAUDE.md` (Structure and Conventions, only where a convention
  changed), the phase 3a spec (status line).
- **Acceptance:** full gates on `main`; a final owner validation compared with the phase start
  (differences explained); `docker build .`; a last adversarial review across the whole phase for
  contract drift (a repository search for second implementations of every section 4 contract); the
  spec's status reads "Implemented <date>"; STATUS lists what shipped, the manual checks still open
  (watch files, intervals.icu live run), the owner questions still open, and the phase 3b design as
  next.

## Wave summary

| Wave | Tasks                                                  | Migrations                           | Validation             |
| ---- | ------------------------------------------------------ | ------------------------------------ | ---------------------- |
| 0    | P0, E3-1, E3-4, E4-1, E2-1, E2-2                       | plan session                         | E2-2                   |
| 1    | E3-2, E3-7, E3-6, E2-3, E1-2, E6-1, E10s-2             | sync log                             | E3-2, E3-7, E1-2       |
| 2    | R0-1, E3-3, E3-5, E1-4, E4-2, E5-3, E6-2, E6-3, E10s-1 | revision model, weather, wrist, race | R0-1, E4-2, E5-3, E6-3 |
| 3    | R0-2, E3-8, E2-4, E1-3, E4-7, E5-4, E6-4, E10s-3       | activity insight, fuel lab           | E5-4                   |
| 4    | E2-5, E1-5, E1-6, E4-3, E4-4, E5-5, E5-6, E6-5         | disruptions                          | none                   |
| 5    | E2-6, E1-7, E4-5, E5-7, E6-6, E10s-4                   | weekly brief                         | none                   |
| 6    | E2-7, E1-8, E4-6, E6-7, E10s-5                         | none                                 | none                   |
| 7    | E2-8, E4-8, E5-8, E6-8, then C1                        | none (E2-8 Docker for static output) | E4-8, C1               |

Several tasks in one wave touch the same file in different functions (E5-5 and E5-6 on
`routes/plan.ts` and `planActions.ts`; E3-8 and E4-3 on `GoalsPage.tsx`, which is why E4-3 waits for
wave 4). The second to merge rebases; neither redefines the other's code. Tasks that add Params in
the same wave (wave 1: E1-2, E6-1, E10s-2; wave 2: R0-1, E4-2, E5-3) each take the next suffix at
rebase.
