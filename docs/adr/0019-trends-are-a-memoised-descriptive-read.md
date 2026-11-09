# 0019. Trends are a memoised descriptive read

Status: Proposed 2026-11-07

Builds on ADR 0005, ADR 0009 and ADR 0012. Adds rule T1 (`research/engine-rules.md`, section (q)). The
design is `docs/superpowers/specs/2026-11-07-trends-design.md`. This record covers the first release of
the page (steps 1 to 4 of the design: rule T1, the baseline helper, the read model, the running half
and the recovery panels). Body weight (step 5 of the design) is the addendum at the end.

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

## Addendum 2026-11-07: body weight (step 5 of the design)

Decided in the design review of 2026-11-06 and built in step 5. Body weight is health data with a
known harm path for a runner with unintended weight change or energy-deficiency flags (rule n-4).

- `User.showBodyWeight` (migration `show_body_weight`) defaults to false and is saved from Settings,
  section "Trends", with `PUT /api/settings`. When false the response has no weight key and the
  route never selects `weightKg` (`loadWeightSeries` is not called). When the latest screening holds
  `j5.redsHoldFlags` (2) or more flags the response carries `weightGate: 'reds'` and no series, and
  the column is not selected either. Otherwise `weight` is one entry per week of the 104
  (`weekStart`, `grams`, `weighIns`): the mean of the week's weigh-ins in integer grams, null under
  `MIN_WEIGHINS_PER_WEEK` (2, a page default). It is memoised as `trends.weight`; the switch and the
  flag count are read outside the memo on every request, so a change of either shows at once.
- The gate is a display choice; the data path stays as it is (open question 1 of the design). `weightKg`
  is in the 60-day snapshot (the wellness `findMany` has no `select`) and every column is returned by
  `GET /api/wellness`, so an authenticated request can read weights whatever the setting. Restricting
  both is a separate change. Hiding the chart deletes nothing.
- `showBodyWeight` travels in `/api/settings`, which ADR 0012 keeps on the offline allowlist, and in
  `/api/auth/me`. Accepted: the device cache then shows that weight tracking is on, next to health
  data it already holds (Today). The flag moves to an uncached route if that stops being acceptable.
- The page draws weekly means in the runner's weight unit, gaps as gaps and a hidden data table. It
  draws no goal, no change figure, no colour but the neutral ink and no verdict; the weight templates
  take no slot except the mean, the unit and the count of weigh-ins, so a difference cannot be
  rendered. With the gate closed, one neutral line says weight is not shown while the screening has
  open items.
- **Opinion:** weight is a display choice for a runner who asks for it, off by default and never
  judged; arguable, because the setting and the flag gate restrict no access to the number.
- **Fact:** `j5.redsHoldFlags` is 2 and rule n-4 holds progression and shows a clinician prompt at
  that count (`shared/engine/params/j-adapt.ts`, `research/engine-rules.md`, read 2026-11-07), so the
  same count stops the page drawing weight.

## Addendum 2026-11-07: the run panels (batch D2-1 of the data track)

Two panels join the page under the weekly running: heart-rate drift on long runs and the heart rate
at one speed. They add rule A11 and an amendment of T1 (`research/engine-rules.md`); no `Param`,
paper, migration or environment variable, and `PARAMS_VERSION` is unchanged.

- `GET /api/trends/runs` (`server/routes/trendsRuns.ts`) answers `longRuns` (the flat runs of the last
  728 days, the page's 104 weeks, with a stored `Activity.decouplingPct`) and `hrWindows` (26 windows of
  `hrModel.windowWeeks` weeks ending every 28 days, `fitHrModel` per window). It is memoised as
  `trends.runs` by data version and day from one column-limited read, `loadRunSeries`
  (`server/serialize.ts`): runs only, flagged duplicates left out, the 14 columns the drift and the
  heart-rate fit read, from 756 days back (the oldest of the 26 windows ends 700 days back and reads the eight weeks before it); `longRuns` is cut to 728. The shape is
  `TrendsRunsView` in `shared/domain/trendsRuns.ts`.
- What the page draws is computed on the client from those rows (`durabilityGroup`,
  `fixedSpeedSeries`), so the range switch moves the median line and the reference speed with the
  runs in view and asks the server for nothing more.
- `fitHrModel`, `hrModelSample`, `durabilityRuns` and `isDurabilityCandidate` take the columns they
  read (`HrFitRun`, `DurabilityRun`) instead of a whole `Activity`, and `isFlatRun` is the one test of
  the climb limit; the logic is unchanged, and the engine tests and `plan:report` are unaffected.
- The route is not on the offline allowlist; offline the panels say Trends need a connection.
  Activity writes read it again (`ACTIVITY_DATA_KEYS` holds `keys.trends`).

### Reasons

- **Fact:** the snapshot holds 365 days of activities (`server/services/athleteState.ts`, read
  2026-11-07), and 26 windows of eight weeks reach back about 100 weeks plus eight, so the read cannot
  come from the snapshot. It is one more exception to "no new code queries that window", beside the
  wellness loader and `loadActivityCores`, and `tests/api/trendsRuns.test.ts` pins its column list.
- **Fact:** about half the runner's runs of the last 12 months had a stream (counted
  2026-11-07), so both panels will often be sparse; each says what would fill it.
- **Rule:** rule B2 does not trust wrist heart rate on hills, so both panels take flat runs only
  (`hrModel.maxGainPerKm`).
- **Opinion:** a hill filter on the panel only, leaving the A7 candidate test as it is, keeps a stored
  descriptor from moving in a display change; the cost is that the panel and the descriptor can pick
  different runs on a hilly history (open question O4 of the data-track design).
- **Opinion:** a reference speed taken from the range shown is better than a fixed one, because a
  fixed speed would sit outside the speeds of a short range and leave every window a gap; the cost is
  that the pace in the caption changes with the range.

## Addendum 2026-11-08: hilly runs whose heart rate passed (batch HQ1)

Status: Accepted 2026-11-08 (#672)

### Decision

- Rule B2 gains five per-run checks on the stored 10 s stream (cadence lock against the stored steps
  per minute, spikes, dropouts, flat lines, and heart rate falling while the grade-adjusted effort
  rises). `computeHrQuality` (`shared/importers/files/hrQuality.ts`) counts the flagged moving
  seconds into `Activity.hrQuality` beside the heart-rate source read from the FIT `device_info`
  (`hrSource.ts`) and the data-preparation thresholds it used (`th`). Import and the `hr-quality`
  backfill job (`server/services/hrQualityBackfill.ts`, modelled on `terrain`) write it; the job also
  computes again a summary whose `th` differs from the current thresholds.
- Whether a run passes is read from the counts (`hrQualityPasses`, `shared/engine/hrQuality.ts`), never
  stored: at least `hrModel.minDurationMin` of moving time, and either an external-sensor source or
  at least `b2.qMinCleanShare` clean. The ten `b2.q*` Params are grade D; eight are data preparation
  and two (`b2.qMinCleanShare`, `b2.qMinHalfCleanMin`) decide which runs the panels draw.
- The drift panel draws a hilly run that passes as a diamond with a grade-adjusted drift
  (`gaDecouplingPct`: per-band, per-half clean seconds, metres and heart rate times seconds, divided
  by the band ratios of the grade curve of the day the page is read, `bandRatios`). The heart-rate
  panel's fit takes passing hilly runs through `HrFitOptions.hilly`, which only `hrWindows` sets, and
  names how many the drawn windows include.
- The engine is untouched: `fitHrModel`, `hrAgainstModel`, My paces, the zones, the A7 test and the C9
  easy pace use the flat-only default, and `plan:report` is unchanged apart from the Params version.
- `loadRunSeries` reads two more columns, `hrQuality` and `terrainBins` (the grade curve needs the
  bins of the runs it already loads); the read is still one query.

### Reasons

- **Rule:** the owner decided on 2026-11-08 to try the middle path (task HQ1), and rule B2 in
  `research/engine-rules.md` (amendment of 2026-11-08) states the checks; the A7 test and the C9 pace
  stay flat-only until the owner decides otherwise.
- **Fact:** a Fenix 5 had 13% MAPE on one trail run [navalta-2020-trail-running-hr]; a Crossref and
  Europe PMC search on 2026-11-08 found no study that validates a rescue of hilly wrist data or any of
  the ten numbers (evidence gap 33). The panels mark such runs.
- **Fact:** on the runner's stored runs, every FIT file lists the watch's own heart-rate sensor
  (`device_type` `whr`, `source_type` `local`) and none an external one (read 2026-11-08), so every
  source there is `wrist`; the hilly runs among them all pass, so the checks have not been scored against
  a strap.
- **Fact:** every importer stores cadence in steps per minute (`fit.ts`, `gpx.ts`, `tcx.ts`, the
  provider modules, read 2026-11-08), so the lock check compares heart rate with the stored value only.
- **Opinion:** a pass read from the counts beats a stored pass, because the two engine numbers can
  then move with a Params version and no job; the cost is that the page cannot list passes without
  the Params.
- **Opinion:** a diamond in the drift panel keeps hilly drift out of the median, which a dot would
  suggest; the cost is a third mark to learn.
- **Preference:** grade-adjusted drift is read against today's curve and not the curve of the run's
  day, so one curve serves every diamond; an old diamond can move a little when the curve changes.

### Alternatives

- Fit hilly runs in the engine's own HR model: rejected. **Rule:** the owner kept the A7 test and the
  C9 pace for a later decision.
- Store the pass with the counts: rejected. **Opinion:** a threshold change would need a backfill.

## Addendum 2026-11-08: climbing and intensity per week (task TL1)

Status: Proposed 2026-11-08

Two weekly panels join the page beside the running weeks: climbing per week and intensity per week.
They add rule A12 and an amendment of T1 (`research/engine-rules.md`); no `Param`, paper, migration
or environment variable, and `PARAMS_VERSION` is unchanged. The panels read `hrQualityPasses` and
`timeInBand` from `shared/engine/` and change nothing there but the export of `timeInBand`; no
engine decision reads the panels.

### Decision

- `GET /api/trends/load` (`server/routes/trendsLoad.ts`) answers one row per run of the last 104
  weeks and the three before them: the date, the length, the elevation gain (null when none is
  stored) and the seconds below, between and above the two heart-rate limits of the zone table
  (`bandSec`, null when the run has no usable heart rate). It is memoised as `trends.load` by data
  version and day from one column-limited read, `loadLoadSeries` (`server/serialize.ts`): runs only,
  flagged duplicates left out, five columns (date, length, gain, histogram, quality summary). The
  zones come from the snapshot (`loadAthleteContext`), the one place they are built, so the limits
  are those `ZoneSummary` shows. The shape is `TrendsLoadView` in `shared/domain/trendsLoad.ts`.
- The weekly sums are pure functions in that file (`climbWeeks`, `intensityWeeks`) run on the client,
  so the range switch asks the server for nothing more. Climbing is bars of the week's gain in the
  runner's unit and the mean of the week and the three before it through complete weeks, the current
  week outlined and without a point on the line, as the running panel draws its minutes. Intensity is
  stacked bars of run time in Zone 1, Zone 2 and Zone 3, plus a fourth neutral part.
- A run with no gain is counted ("N of M runs have elevation") and left out of its week's sum, never
  read as 0. A week with no runs has no bar. A run with no histogram, or a quality summary that is
  missing or does not pass `hrQualityPasses` (rule B2, batch HQ1), puts its whole length in the
  neutral part "No usable heart rate"; a usable run puts there only the time its histogram does
  not cover. Neutral time is never spread over the zones. A summary not yet computed counts as not
  passing, as in the other panels, so a run awaiting the `hr-quality` job sits in the neutral part.
- Every week is read against the zones as they stand on the day the page is read. The caption says
  so, and the panel states the two limits in bpm.
- The route is not on the offline allowlist; ADR 0012 is unchanged. Activity writes read it again
  (`keys.trends` is in `ACTIVITY_DATA_KEYS`; the query key sits under it).
- Neither panel draws an acute:chronic ratio, a band marked high, a comparison with the plan's
  intended split or any colour but neutral ink and one hue in three strengths. The copy is
  templates in `shared/copy/trends.ts` under the G5 lint, with no slot that could carry a
  comparison.

### Reasons

- **Fact:** the plan reads weekly run minutes (rules G-1, G-2, G-8) and Trends already draws them with
  a four-week mean, so a minutes curve would repeat the running panel (`web/pages/TrendsPage.tsx`,
  read 2026-11-08).
- **Fact:** ratings were rare on the runner's own data (checked 2026-11-08); most runs carry an
  elevation gain and about half carry a heart-rate histogram. A panel on session RPE (rule B1) would be empty, so it was not built; unrated runs are
  not estimated from heart rate (rules B2, B4).
- **Rule:** G-5 and T1 forbid a ratio of recent to earlier load, and G5 forbids verdict copy; the
  panels follow them, checked by the copy lint and a scan test.
- **Fact:** the acute:chronic ratio is mathematically coupled and has no causal support
  [impellizzeri-2020-acwr-pitfalls, wang-2020-acwr-lessons], showed no useful association with injury
  in 435 Dutch runners [nakaoka-2021-acwr-runners], and gives different findings under different
  methods [cloosterman-2024-acwr-methods].
- **Rule:** rule B2 does not trust wrist heart rate outside runs that pass the per-run checks, so a
  run that does not pass is shown as unusable and not as a band.
- **Opinion:** counting a week with no runs as no climbing in the line, while leaving out a week whose
  runs lack a gain, matches the minutes line (a rest week is 0) without reading an unknown as 0; the
  cost is that the line's first weeks after the history starts are pulled down by weeks before the
  first run, as the minutes line's are.
- **Opinion:** cutting each histogram bin in proportion to its overlap with a limit (`timeInBand`, the
  engine's own reader) beats assigning a bin whole to one side, because a one-bpm bin at a limit
  would otherwise swing a band; the cost is an assumption that seconds spread evenly inside a bin.
- **Opinion:** reading every week against today's zones keeps one set of limits on the page and
  matches the stated caption; the cost is that an old week can move when the zones change.
- **Preference:** one hue in three strengths and a hatched neutral part, over three hues, keeps the
  bands from reading as a traffic light.
- **Fact:** the two-week minimum for a line point is a page default with no evidence behind it, as the
  four-night minimum of the recovery means is.

### Alternatives

- A session-RPE curve (effort-minutes): rejected for the reasons above (**Fact**: ratings are rare).
- A rating tint on the existing minutes bars: rejected. **Opinion:** it mixes rated and unrated
  minutes in one bar.
- Spreading a run with no usable heart rate over the bands in proportion to the others: rejected.
  **Rule:** B2 and B4 forbid imputing a missing scale.
- Comparing the intensity split with the plan's intended split: rejected. **Opinion:** it would read
  as a target (G5).
- Widening `loadActivityCores` or the snapshot to carry the gain and the histogram: rejected.
  **Fact:** the snapshot holds 365 days and the page reaches 104 weeks; another column-limited loader
  is the exception ADR 0019 already makes for the run panels.
