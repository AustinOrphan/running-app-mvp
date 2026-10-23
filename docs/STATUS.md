# Status

Current state only; rewritten at every boundary. History lives in `git log`, the specs and
plans under `docs/superpowers/`, the research corpus under `research/` and `docs/adr/`.

Last update: 2026-10-23.

## Where things stand

- **On `main`:** the clean rewrite (#528, rebase-merged) and the evidence engine, data
  foundation and research corpus (#529, squash-merged as `2e17f23a`); the CodeQL escaping fix
  (#536).
- **Merged (#537, 2026-10-22):** the owner's answers to the eight section-10
  builder calls (`docs/superpowers/specs/2026-10-22-training-engine-design.md`), backed by a
  second evidence pass on five questions (70 new sources, corpus 370; `research/README.md`
  method entry 7): four start paths (E6: a 9-rung run-walk ladder, a 3 × 20-30 floor sized from
  the runner's own recent run, ladder entry by the longest recent bout, an injury-return
  ladder), 5 km and 10 km long-run tiers with a 16 km cap (D7), the day-counted post-race
  window with a delay-only check-in gate (H12), marathon-plus races out of the 30-day session
  reference, a 3-min duration step for G-1, the weekly ramp relabelled grade D, a
  low-frequency profile, the ratings-required copy, and one 150-hour activity limit.
  `PARAMS_VERSION` is `2026-10-22.2`.
- Gates on the branch (2026-10-22): `npm run check` (lint, Prettier, typecheck,
  `research:check` with 370 papers and 373 cited ids, Vitest), `npm run build`,
  `npm run test:e2e`; the local validation against the owner's real history (kept outside the
  repository) builds the 100-mile plan with 0 checklist failures of 15, label "tight" (33 of 33
  weeks, the weekly path governs by one week), a 3 × 20 first week and a 9.2 h peak, and
  projects a 15-day hold after the race (10 days × 1.5 for a first finish in the class) followed
  by three 7-day steps.
- An adversarial review of the branch (six lenses, two independent refuters per finding) confirmed
  32 findings and disputed 18; the confirmed ones and the accepted disputed ones are fixed on the
  branch (start paths read only the runs the 30-day reference counts; the injury ladder advances
  by minutes run, not by weeks; tightened profiles take the ladder; the post-race lead-in obeys
  G-1 and the steps start inside the race week; the 16 km cap at the carried pace; one duplicate
  predicate; the half and marathon long-run floors reconciled with the planner; web labels and
  rule text aligned). Re-plan sweeps (0-37 days, logged and unlogged) pass for the reviewed
  fixtures.

- **Phase 3a (branch `feat/coach-phase3`, integration branch; one PR per wave to `main`):**
  the owner's mandate of 2026-10-22 ("a professional, research-informed, self-adjusting coach and
  tracker, better than Strava and Runna") after an audit of the app and the market
  (`docs/superpowers/specs/2026-10-22-coach-phase3a-design.md`, plan
  `docs/superpowers/plans/2026-10-22-coach-phase3a.md`, ADRs 0007-0009 proposed). Seven epics in
  eight waves: the foundation (cached athlete state, data version, one session identity, one
  revision model, sync log), sessions on the wrist (intervals.icu publish, FIT download, ICS
  feed), Today rebuilt as a phone-first coach with an offline shell, explanations from the
  runner's own numbers and a Monday brief, disruptions (dial-back, what-if, moves, undoable
  re-plans), the fuel lab and gut training, and the prediction back-test. The owner's spreadsheet
  plan is a placeholder; only the goal race is firm, and the engine owns the plan.
- **Phase 3a wave 0 (branch `feat/coach-phase3`, PR from `wave/3a-0`, 2026-10-23):** the contracts
  every later task imports. E3-1: the data version (`server/dataVersion.ts`, raised by the Prisma
  client after every state write and at the end of every transaction, model classification tested
  against the schema, `conflict(message, details)`, schema-derived `resetData`). E3-4: one
  `PlanSession` migration (`externalId` unique per plan, `trimmed`, the indexes), the migration-chain
  and drift test, `executionRecordsByWeek`, `loadActivityCores` with a 52-week bounded window.
  E2-1: the Today page split into `web/components/today/*` with named slots. E2-2: one eased
  session, `resolveTargets`/`climbNote`, heat steering shared across surfaces (`PARAMS_VERSION`
  `2026-10-22.3`). E4-1: the copy system (`shared/copy/*`: typed templates, the G5 lint,
  `formatQuantity`, `describeParamValue` in the runner's units, `expectCleanCopy`) and ADR 0010.
  Gates on the merged branch: `npm run check` (123 files, 3336 tests), `npm run build`,
  `npm run test:e2e` (18), `docker build .` (the migration applies), owner validation unchanged
  apart from the date. Adversarial review: see below.
- Known from E4-1, to fix in wave 1: four Param notes (`h8.weightLossToleranceMaxPct`,
  `pain.flagScore`, `h12.laterStepLongRunMaxMin`, `l1.sameDistanceTolerancePct`) and the G-6 rule
  title ("Never make up missed volume") fail the G5 lint; a drawer test that opens them with
  `expectCleanCopy` will fail until they are reworded through `research-update`.
- Fix PRs against `main` from the same day: #538 (dev proxy), #539 (plan form labels, merged),
  #540 (start level from the last two complete weeks, `PARAMS_VERSION` `2026-10-22.3` on `main`),
  #541 (persist `qualitySessions` and `isRecovery` on `PlanWeek` so a re-plan stops reporting a
  phantom change). The integration branch takes `main` after they merge; the two `2026-10-22.3`
  versions are reconciled to `2026-10-23.1` there.

- **Phase 3a wave 1 (branch `feat/coach-phase3`, PR from `wave/3a-1`, 2026-10-23):** the
  foundation every surface reads. E3-2: the cached athlete snapshot (`server/services/athleteState.ts`:
  `loadAthleteContext`, `memoByVersion`, `currentGoalFor`; one build shared by concurrent requests,
  rebuilt once per state write, day change or TTL, never stored when it overlapped a write or a
  transaction; deep-frozen), `GET /api/state` with an ETag and 304, the DataInUse panel on
  Integrations, ADR 0009 accepted; warm Today reads fall from ~8.5 ms to ~2 ms on a three-year
  synthetic history. E3-7: session identity (`pairSessions`, `carryExternalIds`,
  `workoutExternalId` in `shared/domain/sessionIdentity.ts`; `writeReplannedSessions` updates paired
  rows in place and returns a `SessionWriteSet`), so a Monday re-plan of an unchanged plan keeps
  every id and `externalId` (205 of 205 on the owner's plan; the old write kept 0). E3-6: the
  `SyncRun` log (one row per pull, push, folder scan and job; `GET /api/integrations/:provider/runs`,
  `GET /api/jobs`; `safeMessage` strips tokens; 200 rows and 90 days kept), honest Garmin wellness
  truncation (`WellnessTruncated`, `paused` never `ok`), the weekly catch-up re-plan on start and
  every 6 hours (ADR 0007), the SyncHistory card. E2-3: the Today engine pieces (`readinessSignals`,
  `readinessVerdict`, `rangeLabel`, `weekStrip`, `formatEstimate`, `isoDateInZone`,
  `restingHrEval`; templates in `shared/copy/today.ts`). E1-2: the workout model
  (`shared/workouts/*`: `toWorkoutPlan` for every publishable kind including the run-walk ladder,
  `publicTitle` from a closed allowlist, rule O1 with `o1.hrFloorBpm` and `o1.hrTargetMinStepSec`).
  E6-1: the nine `h7` fuel-ladder Params, the H7 rule text and ADR 0011. E10s-2: the prediction
  back-test scorer (`shared/engine/backtest.ts`), the `l7` Params, the L7 rule text and the
  track-record copy. `PARAMS_VERSION` is `2026-10-23.1`. Gates on the merged branch: `npm run
check` (142 files, 4337 tests), `npm run build`, `npm run test:e2e` (18), `docker build .` (the sync-log migration
  applies), owner validation identical to wave 0. One merge interaction was caught by the gates
  and fixed (the sync-history page test did not expect the Integrations page's new state read).
  Adversarial review: see below.
- Wave 1 left for later tasks: `shared/workouts/*` keeps a few fixed fragments ("Warm up", "heart
  rate under") as literals rather than templates (E1-3 to decide); `TODAY_TEMPLATES` verdicts can
  name a session on a day with none (E2-4); `median` now exists three times in `shared/engine`
  (`athlete.ts`, `readiness.ts`, `backtest.ts`); idle folder scans every 5 minutes fill the
  200-row `SyncRun` cap in about 17 hours (E3-8 or the next boundary decides whether idle
  scheduled runs are recorded); a plan generated after the Monday slot gets one redundant
  catch-up re-plan; the fast finish of a long run, the easy part of a strides session and quality
  warm-ups are published as open steps because `resolveTargets` holds no band for them.
- **Session identity (E3-7, the contract for the publish channel in E1):** a session's `externalId`
  is its only durable identity, kept by owner moves, swaps, skips and restores and by every
  re-plan that leaves it on the same day and kind (`pairSessions` in
  `shared/domain/sessionIdentity.ts`), carried by a regenerate for sessions dated today or later,
  and new when a re-plan changes its day or kind, so E1 publishes under
  `workoutExternalId(externalId, userTag)`, creates the new event before it withdraws the old one
  and derives no id from the date, the kind or the order.

## Wave 1 adversarial review (2026-10-23)

Six lenses over the wave-1 diff against `wave/3a-0` (90 files); 23 findings, each tried by two
independent refuters: 8 confirmed (two pairs name one defect each), 15 disputed. Nothing confirmed
is above medium.

Fixed on `wave/3a-1` before its PR (`task/3a-W1-fix-readiness`, `task/3a-W1-fix-synclog`):

1. The HRV "Building your usual range (N of 10 readings)" sentence counted today's reading while
   the threshold counts prior readings only, so 9 prior nights read "10 of 10" with no range; the
   shown count is the count the threshold uses, with boundary tests.
2. The "Signals are a little low. Today's session is already easy, so it stays." verdict fired on
   every non-quality day (a long run, a race, a strength day, a day with no session);
   `readinessVerdict` now reads the day's session kinds and keeps that sentence for easy days only.
3. The check-in signal used the fatigue sentence when a different item was the poor one.
4. The sleep signal could read "averaged 7 h ... under 7 h"; the verdict now compares the value as
   shown.
5. Two sync-log tests could not fail (the `safeMessage` cut-order case and the "hostile message"
   case of `recordSyncRun`); rebuilt so they discriminate.

Accepted from the disputed list and fixed with them: `safeMessage` strips credentials after any
`Authorization` scheme, cookie values and bare token pairs, not only `Bearer`; app-written failure
messages in the sync history are templates under the lint (provider text stays a quoted slot); the
"no token in a log line" test captures real log lines; idle scheduled folder scans and weather runs
are no longer recorded, so the 200-row log holds real syncs.

Disputed and recorded (not fixed; reason in brackets):

- A plan generated after the Monday slot counts as "weekly update due" and gets one redundant
  catch-up re-plan; the catch-up and the 03:00 job can both re-plan one plan in a week [an
  in-process guard serialises them; R0-1's revision model makes the second a no-op diff; revisit
  at E3-8].
- `GET /api/state` can answer 304 for a body the race-climate path would now build differently,
  and a cold read waits on up to three sequential Open-Meteo calls with no timeout [E3-3 replaces
  `raceClimate.ts` with the cache in the same wave 2].
- DataInUse says "No activities yet" for data outside its window [copy choice; E4-8's reading
  pass].
- The workout step vocabulary (`shared/workouts/plan.ts`) is a second copy of the session sheet's
  wording [E1-7's cross-surface adapter reconciles them].
- The Monday re-plan identity test runs a no-op re-plan; the overlap test has one assertion that
  cannot fail; a 50 ms real-time sleep precedes the single-flight assertion; the Vary-header test
  only re-checks the header [test-strength notes; R0-1 and E3-8 add the changed-plan case].
- `latestJobRuns` reads every job row for one per job and the index does not cover its filter
  [small table after idle runs stopped; E3-8].

## Wave 0 adversarial review (2026-10-23)

Six lenses (contracts, correctness, security and privacy, copy and accessibility, tests,
performance) over the merged wave-0 diff against `main` (94 files); 24 findings, each tried by two
independent refuters: 6 confirmed, 18 disputed. All confirmed findings are low or medium.

Fixed in the same wave (`task/3a-W0-fix-copy`, `task/3a-W0-fix-code`):

1. The why drawer printed Param notes with metric figures beside values converted to miles (about
   70 notes restate a figure); notes now go through the same localisation as engine text, with a
   registry-wide test.
2. Four Param notes (`pain.flagScore`, `h8.weightLossToleranceMaxPct`,
   `h12.laterStepLongRunMaxMin`, `l1.sameDistanceTolerancePct`) and the G-6 rule title failed the
   G5 lint and nothing linted them; reworded, with a test over every note and rule title.
3. `computeBaselineRunMin` still loaded whole `Activity` rows for week aggregation; it reads
   `ActivityCore` rows now.
4. The plan's R0-1 acceptance and spec 4.2 still asked migration D to add the `PlanRevision`
   `(planId, reason)` index that migration B (E3-4) created; the index is removed from both.
5. The cooler-hour gain threshold (`i7.coolerMinGainC`) had no pinning test; two cases added.
6. `expectCleanCopy` linted each text node alone, so a banned phrase split by inline markup
   passed; it also lints collapsed block text now.

Accepted from the disputed list and fixed with them: the date-format test pins a time zone so a UTC
runner can catch a local-getter regression; `render()` treats a non-object `slots` record as a
missing slot (fallback in production, `CopyError` under test) instead of throwing.

Disputed and recorded (not fixed; reason in brackets):

- Canonical helpers from wave 0 coexist with in-tree duplicates in `planEngine.ts`; "trimmed" is
  still decided by separate checks in `shared/engine` [the duplicates are on the write path E3-7
  rewrites; revisit at E3-7].
- The climb note fires on every run of a climbing week because the planner spreads gain over all
  run kinds; an eased easy run keeps the original `gainM`; `easedSession` gives one cause for every
  easy downgrade [design intent of E2-2; E2-3 and E2-5 own the sentences].
- The G5 lint passes plural and inflected forms and some injury-probability phrasings [the list is
  spec 4.5's exact list; widen it only with the owner's reading pass, E4-8].
- The spec states the goal race's distance, terrain and month [not a race name, cutoff or course
  fact; distance and terrain are already on `main`].
- Focus drops to the page when the focused control unmounts in `SessionChanges` (confirmed by one
  refuter, narrower than claimed) and `FeedbackCard` [moved unchanged from `main`; E2-6 rebuilds
  the check-in sheet and should move focus].
- Window lengths ("28 days", "12 weeks") are literal in Today headings [duplicates of constants
  the same files own; E2-7 reworks the strip and the recent weeks].
- ADR 0010's parameter count is pinned to a version and dated; its status gets the PR number
  when the wave PR opens [convention].
- `today.module.css` is one 368-line module against the plan's 250-line limit [E2-5 splits it].
- The data-version write hook's nested-relation key list is mostly untested; the batched execution
  query asserts no `orderBy`; the session-kind list in engine fixtures is hand-kept [test-strength
  notes for E3-2 and E3-7].
- The why drawer holds its loading state on the settings request, so the unit fallback applies
  only after retries [E4-3 reworks the drawer's data loading].

## Decisions for the owner

Phase 3a, section 13 of its design, lists sixteen open questions with the defaults the plan
implements (undo policy, hot-day thresholds, the one-row check-in, publishing off by default, who
runs the live intervals.icu and watch checks, the niggle caution, the fuel ladder details, windows
as Params, and smaller defaults). Each default ships unless the owner says otherwise. The section-10 items are confirmed; the builder calls the second pass added are
listed there (experienced returner after 90 days off restarts at 3 × 20; ladder weeks exempt from
the soft ramp warning only; BMI > 30 holds rung 1 for three weeks; the ultra weekly feasibility
path measures toward the long-run week, not the class peak; the check-in gate is computed, not
stored, and a check-in older than 3 days neither delays nor releases a step).

## Open follow-ups (none blocks a merge)

1. The weekly decision's "first days of heat" and "sleep efficiency drop" holds are not derived
   from data yet, so those two J5 signals never fire.
2. Contrived re-plans (sessions marked completed for weeks with no activity behind them) can
   ramp from a zero baseline and collapse to zero-minute weeks or a zero taper (19 of 2310 fuzzed
   re-plans); the app marks a session completed only through activity matching, so no real path
   produces this input. A repeated floor week after a clipped restart carries no flags and is
   placed as a plain week.
3. A true novice with a 5 km time goal 12 weeks away reads "not reachable within default limits"
   (the ladder alone takes 9 weeks and a 30-min run is under 5 km at a novice pace); the label is
   honest but conservative, and the plan still builds.
4. The 8 h race-simulation opt-in (H2) and the "no later than 3 weeks before race day" timing are
   design intent: no code reads `h2.raceSimulationMaxHours`.
5. A declared longest run (A3) has no profile field; a runner with no logs starts at rung 1 or, if
   experienced and unflagged, at 3 × 20. The n1 walk-jog stages for bone stress injuries are not
   implemented: a recent bone stress injury takes the same injury-return ladder.
6. Post-race: strength sessions stay at 0 through the window with no evidence either way; the
   first-finish modifier applies to a runner with no race history at all; the window trigger for a
   new plan uses the D1 class (so a 40 km race counts as a marathon) while G-1 uses the literal
   42,195 m.
7. A session the engine trims after a hold decision is stored without its untrimmed version.
8. Lower-ranked review findings not yet addressed: nested sheets share the Escape key; Apple
   Health push skips the range checks the parsed import applies; the JSON body parsers for ingest
   and imports run before authentication; Goals reads "1:45" as minutes and seconds; a few engine tests assert
   conditionally.
9. Behind a reverse proxy, rate limits key on the proxy's address (no trust-proxy setting by
   design: the environment variables are fixed).
10. "Make active" on a goal other than the plan's goal leaves the plan on the old goal.
11. Spec non-goals still open: readiness and race-decision gates as stored decisions, long-run lab
    and fueling logs, strength programming; Polar, WHOOP, Oura and Google Health providers.
12. Enable branch protection on `main` requiring the `ci` and `analyze` checks.

## Clean-up after the merges

- Delete obsolete remote branches: `feat/comprehensive-ci-cd-infrastructure`,
  `feature/phase3-test-fixes-complete`, the five `fix/*-pr298` branches, the eight July-2025
  rescue branches (`architectural-review-and-improvements`, `error-logging-standardization`,
  `feature/refactor-async-handlers-39`, `fix/footer-css-classes-issue-155`,
  `fix/issue-113-api-mocking-standardization`, `fix/limit-pace-decimal-places-108`,
  `issue-105-fix-unreachable-catch-stats`, `lint-react-hooks`).
- Delete the local `task/*` and `review/*` branches from the parallel agents (including
  `task/round2-B`, `task/round2-C`, `task/round2-D`), remove the agent worktrees under
  `.claude/worktrees/wf_*` and `.claude/worktrees/agent-*`, the stale `build e2e integration
linting unit-tests` worktrees and the detached comparison worktree the start-path task left
  in its job directory (`git worktree prune` after the directory is gone); check `_main` out on
  `main`.
- Unset `core.hooksPath` in the bare repository; it points at a removed `.husky/_`.

## Environment notes

- Bare repository with worktrees (`~/src/BARE-REPO-WORKFLOW.md`). Isolated agent worktrees
  branch from `origin/main` and have no `node_modules`; agents run `npm ci` first.
- Port 3101 is reserved by the Playwright web server, which also clears `test-results/`.
- The owner's intervals.icu account goes dormant without a login; Garmin's official API is
  closed to new applicants (October 2026).
- Personal training data stays in Google Sheets, Smashrun and the owner's own app database; the
  repository holds synthetic fixtures only.
