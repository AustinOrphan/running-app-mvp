# 0026. Work follows events; a timer only for time or an outside system

Status: Proposed 2026-11-18

Builds on ADR 0009 (athlete state is read through memos keyed by the data version) and ADR 0012
(offline). The per-job analysis is a read-only analysis of each job, kept outside the repository
(2026-11-18), produced from `main` at 23bbd492; every file and line below is from that read.

## Context

The scheduler (`startScheduler`, `server/jobs/scheduler.ts`) ran seven jobs on a 2 to 5 minute tick
that were written to backfill one column or to catch up one missed event: `terrain`, `hr-quality`,
`track`, `surface`, `watch-rating`, `replan-catchup` and the 2-minute `publish` check. After the
strength pairing job was replaced by a start pass (SP2, #796), the owner asked about the others
(2026-11-18).

For `terrain` and `hr-quality` the tick did two things: it filled rows imported before the column
existed, and it filled rows the import itself had left null. The second case is a bug, not a
backfill: `storeParsed` chose the column by `parsed.type`, but an update never writes `type`, so a
run the runner had re-typed from cross to run was re-imported with null bins, and a type edit through
`PUT /api/activities/:id` wrote nothing. The tick hid both by repairing the row within 5 minutes.
The tick also never recomputed a stale row: bins of another `walkMps`, window or edges, or a summary
of another `HR_QUALITY_VERSION`, kept their stale shape while `gradeCurve.ts` dropped them.

## Decision

- **Work is wired to the event that creates it.** A derived column is written where its inputs are
  written: `storeParsed` for an import, `PUT /api/activities/:id` for a type or sub-type edit
  (`refreshDerivedAfterEdit`, `server/services/derivedColumns.ts`, before the execution pass).
- **A backfill for rows that predate a feature or a version runs once, as a start pass.**
  `startScheduler` runs the passes in sequence 30 s after start (`once('start-passes', ...)`),
  never awaited before `listen`. `runStartPass` (`server/services/startPass.ts`) drains one user at a
  time in the backfill's existing 20-row batches, yields with `setImmediate` between batches, stops on
  a batch that wrote nothing or on `stopped()`, records one `catchup` run per user and logs one line
  of counts.
- **A recurring job is kept only for time-based work or an outside system that cannot notify.**
- **This change converts `terrain` and `hr-quality`.** Both also recompute a stale row now: terrain
  by `terrainShapePrefix()` (derived from `emptyBins()`), hr-quality by `HR_QUALITY_STAMP` (version
  and thresholds). Both prefixes depend on JSON key order, so tests pin it.
- **Jobs kept** (`plan.keep` and the plan's risk list):
  - `predictions`, every 6 h: the calendar creates its work (one row per goal per local week), and for
    a goal without an active plan nothing else writes it. The pass is already lazy.
  - `sync`, hourly: the one poll of intervals.icu, which cannot notify the app.
  - `publish`, a 30-minute check of intervals.icu (`PUBLISH_BACKSTOP_MS`) and the forced 04:45 run:
    the remote calendar can lose an event, show a push error or change its sport settings without a
    message to the app. The 2-minute tick that wakes the publisher is converted later.
  - `folder` (5 minutes), `weather` (10 minutes) and the daily slots (backup, matching, Monday
    re-plan, Strava check, publish-morning): an outside system, or a clock. The plan did not analyse
    `folder`, because file-system events are a different tool; it stays until it has its own analysis.
- **`surface` and the local part of `track` are converted next.** Trail and road shares are computed by
  `queueSurfaceFill` (`server/services/surfaceFill.ts`) after a map download, an import or track fill
  that wrote a track and a type edit, and by a start pass; its job runs carry the trigger `event`. The
  stored-original part of `track` runs in the start pass and from `refreshDerivedAfterEdit`. The
  chain is terrain, hr-quality, track, surface (a track is written before the shares read it).
- **Still to convert, in later changes:** the intervals.icu stream part of `track` (still the 5-minute
  `track` job, streams only), `watch-rating`, `publish`'s 2-minute tick and `replan-catchup`. Each
  appends its own pass to the chain and removes its own interval.

## Reasons

- **Preference (owner, 2026-11-18, about the 5-minute strength-pair job).** "Auto running every five
  minutes seems a bit much doesn't it? Why wouldn't it be triggered or something." Followed by "Take
  care of the other polls."
- **Fact (`activityStore.ts` as of 23bbd492, checked 2026-11-18).** The update branch never writes
  `type`, while `terrainBins` and `hrQuality` were chosen by `parsed.type`; so only the poll repaired a
  re-typed run, and `storeParsed` is the only writer of `ActivityStream`.
- **Fact (`terrainBackfill.ts`, `hrQualityBackfill.ts` as of 23bbd492).** The selection was `terrainBins:
null`, and `STALE` for hr-quality compared only `th`; a change to `TERRAIN_BINS_VERSION`, window,
  edges, `c9.walkingFloorMps` or `HR_QUALITY_VERSION` was never recomputed, while `gradeCurve.ts`
  drops runs with a stale shape.
- **Fact (SP2, #796, 2026-11-18).** `pairLoggedStrengthAtStart` showed that a pass at start with the
  event hooks already in place replaces a poll without losing a case.
- **Rule (CLAUDE.md, Providers, "Work follows events", added with this decision).** A scheduler job
  is checked against the events that already run its logic before it is added.
- **Opinion.** A one-time need on a timer wastes work (about 288 ticks a day per job to find nothing)
  and hides the real trigger path, which is where a future writer of the column must hook in.
- **Opinion.** The start pass runs in the same process 30 s after start rather than as a migration
  step, because the passes read stored streams and originals, which a migration should not.
- **Preference.** The chain is in one `once()` closure with a catch per pass, so a failure in one pass
  skips none of the others; a per-pass `once()` would work as well.

## Alternatives

- **Keep the polls and only fix the two bugs.** Rejected (Opinion above): the idle ticks stay and the
  trigger path stays hidden.
- **Recompute stale rows at read time.** Rejected (Opinion): a read path would do a write and the
  memos (ADR 0009) would be invalidated by a GET.
- **A migration-time step.** Rejected (Opinion above).
- **One change for all seven jobs.** Rejected in the plan (Opinion): about 2,000 lines across six
  subsystems with one revert unit, where publish and the weekly re-plan carry real behaviour risk.

## Consequences

- **Self-healing is lost.** A future writer of a stream or a run type that forgets its hook leaves rows
  null or stale until the next start. Mitigation: `storeParsed` is the one writer of the stream; a
  missing summary reads as not passing and a missing bin drops out of the grade curve, so neither
  shows a wrong figure.
- **A version or Param bump recomputes every affected run in one pass at the first start after
  deploy,** not 20 per user every 5 minutes. The time on the live copy is not measured. Each
  hr-quality batch decodes up to 20 FIT originals synchronously, as one tick did. While the pass runs,
  the grade curve thins.
- **The data version rises about N/20 times** during a large pass (every `$transaction` raises it).
- **The job log changes.** `terrain` and `hr-quality` runs come from the start pass only (an edit records
  no run). An idle pass stores nothing after an ok run, and does store one on a user's first run or
  after a non-ok run; the age of the last run is not a liveness signal. Nothing on screen reads them.
- **Not verified:** the live copy's terrain bins and quality summaries (the live database was not
  read), so whether the first start recomputes anything is unknown.
