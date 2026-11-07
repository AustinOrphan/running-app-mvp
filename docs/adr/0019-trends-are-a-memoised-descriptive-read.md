# 0019. Trends are a memoised descriptive read

Status: Proposed 2026-11-07

Builds on ADR 0005, ADR 0009 and ADR 0012. Adds rule T1 (`research/engine-rules.md`, section (q)). The
design is `docs/superpowers/specs/2026-11-07-trends-design.md`. This record covers the first release of
the page (steps 1 to 4 of the design: rule T1, the baseline helper, the read model, the running half
and the recovery panels). Body weight (step 5 of the design) is a later change with its own
addendum; the decisions the design took for it are listed at the end so that they are not lost, and
nothing in this release implements them.

## Context

Today draws 12 weeks and the Plan page a season strip; nothing shows months of running or the
recovery readings against the runner's recent range. The snapshot (ADR 0009) holds 365 days of
activities but 60 days of wellness (`WELLNESS_DAYS`).

## Decision

- Weekly running comes from the existing `GET /api/weeks` (`WeekRow`, including `avg4wRunMin`; at most
  260 weeks). `GET /api/trends` answers only the weekly recovery means of the last 104 weeks, with the
  runner's recent range for heart-rate variability and resting heart rate. It is computed by
  `memoByVersion` (name `trends.recovery`, keyed by user, day and data version) from one
  column-limited wellness loader, `loadWellnessSeries`, and the profile from the snapshot.
- The loader is allowed because it selects four columns (date, resting heart rate, rMSSD, sleep) over
  a window the snapshot does not hold, about 760 rows; the engine input is untouched
  (`athleteState.test.ts`, `dataVersion.test.ts` and `noRawWrites.test.ts` pass unchanged). It is the
  one exception to "no new code queries that window", beside `loadActivityCores`. Every other read of
  athlete data for the page goes through the snapshot or the weeks route.
- The recent range is the baseline of Today's readiness read. `baselineReadings` in
  `shared/engine/readiness.ts` is the one selection of those readings, and `hrvOn`,
  `restingHrEval` and `recentRange` call it, so the page and Today never disagree on which readings
  make a baseline. Today's sentences are unchanged (a golden of `readinessSignals` and
  `readinessSnapshot` over six synthetic histories, byte-identical before and after).
- Heart-rate variability is read as mean plus or minus 1 SD on the ln scale and returned in ms; its
  lower edge equals the bound `hrvOn` flags against. The upper edge and the whole resting-heart-rate
  band are display-only. Sleep has no range. A weekly mean needs `j5.sleepMinNights` nights for
  sleep and a page constant of 4 for the other two; a week short of that is a gap.
- Nothing on the page sets a target or an aim line, marks a week as outside a range, divides recent by
  earlier load, or reaches the engine (rule T1, G5, G-5).
- `GET /api/trends` is not on the offline allowlist; ADR 0012 is unchanged. The page says it needs a
  connection when offline.
- No new `Param`, paper, migration or environment variable; `PARAMS_VERSION` is unchanged and
  `plan:report` output is identical before and after.

## Reasons

- **Rule:** G5 and G-5 in `research/engine-rules.md` forbid targets read as minimums, verdict words
  and load ratios; the page follows them, checked by the copy lint and a scan test.
- **Fact:** `WELLNESS_DAYS` is 60 and `inputs.wellness.windowDays` prints it,
  `server/services/athleteState.ts` (read 2026-11-07); 24 months of means need a longer read.
- **Fact:** `hrvOn` draws only a lower bound (mean minus `j4.sdBelowMean` SD) and `restingHrEval` a
  one-sided offset with no SD; `sleepEval` has no baseline (`shared/engine/readiness.ts`, read
  2026-11-07), so only the heart-rate-variability baseline is shared and the other bands are
  display-only.
- **Fact:** the golden `tests/unit/engine/readinessGolden.test.ts` and the existing readiness tests
  pass before and after the extraction of `baselineReadings`; `plan:report` printed the same 635 lines
  with the old and the new `readiness.ts` (2026-11-07).
- **Opinion:** leaving the read uncached keeps months of health data out of `rl-api-v1`; the cost is
  a view that needs a connection.
- **Opinion:** the band moves with the runner, so a slow drift rides inside its own band; the
  resting-heart-rate band is grade D and unvalidated. A fixed, slower range would show drift, and is
  open question 5 of the design.
- **Preference:** one page with a range switch over one page per signal.

## Alternatives

- A tab on Stats: rejected, different job and different gating (**Opinion**).
- Widen `WELLNESS_DAYS` to 760: rejected, it changes the engine input and the inputs card for a
  display need (**Fact**: the card prints the window).
- Banding on the client from `GET /api/wellness`: rejected, it ships 760 rows and duplicates the
  baseline in the browser, while `recentRange` stays server-side and tested (**Opinion**).
- Measured zone time from heart-rate histograms: deferred (**Fact**: rule B2 limits optical heart
  rate to steady flat runs, and zones change over a year).

## Consequences

- One page, one route, one rule and a permanent surface under the copy lint and the 360 px layout.
  A 24-month weekly bar is narrow; that range exists for shape and the hidden table is the exact form.
- Today and the page share `baselineReadings`: a change to the baseline of rule J4 moves both.

## Later change: body weight (not built in this release)

Decided in the design review of 2026-11-06 and recorded here so that the later change starts from it.
Body weight is health data with a known harm path for a runner with unintended weight change or
energy-deficiency flags (rule n-4).

- `User.showBodyWeight` defaults to false. When false the response has no weight key and the memo
  never selects the column. When the latest screening holds `j5.redsHoldFlags` (2) or more flags the
  response carries `weightGate: 'reds'` and no series. Hiding deletes nothing.
- The gates are display gates. `weightKg` is in the 60-day snapshot (the wellness `findMany` has no
  `select`) and every column is returned by `GET /api/wellness`, so an authenticated request can read
  weights whatever the setting. Restricting both is a separate change.
- `showBodyWeight` would travel in `/api/settings`, which ADR 0012 keeps on the offline allowlist;
  the flag moves to an uncached route if the cache showing that weight tracking is on is not
  acceptable.
- **Opinion:** weight is a display choice for a runner who asks for it, off by default and never
  judged; arguable, because the setting and the flag gate restrict no access to the number.
- The seam in this release: `TrendsView` has no weight key and `buildTrendsView` in
  `server/routes/trends.ts` is the one place the response is assembled.
