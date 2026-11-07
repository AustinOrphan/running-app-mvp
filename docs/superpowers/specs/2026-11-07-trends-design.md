# Trends over months and the season: design

Status: proposed 2026-11-07, revised after critique the same day. Steps 1 to 4 are built first (ADR 0019, rule T1); step 5 (the body-weight setting, its series, chart and copy, and the migration) is a later PR, and the first release has no `showBodyWeight`, no weight series and no weight copy. Sections 1 to 3 and 6 describe the weight parts for that later PR. The first release leaves the seam the design names: `weightWeeks` and `formatBodyWeight` are not written, `TrendsView` gains its optional `weight` and `weightGate` keys in that PR, and the route assembles its response in one function (`buildTrendsView`), where those keys are added. Basis: `main` at 3ce475ff, audit finding 6 ("No trends over months", `audit-summary.txt` #26) and its refuters. Body weight is optional and off by default (decided in the design review of 2026-11-06). No personal data: the race is "the runner's goal race".

## Summary

Trends is one new page of descriptive pictures: weekly running over 6, 12 or 24 months, three recovery readings against the runner's recent range, and, only when the runner turns it on, body weight. It sets no target, draws no aim line and never reaches the engine. Running weeks come from the existing `GET /api/weeks`; the new route carries only the recovery and weight series. Version 1 has no intensity mix, no prediction history, no longest-run chart and no Stats change.

### Plan in steps

1. **Rule text and the shared baseline (docs and engine, no screen).** Rule T1 in `research/engine-rules.md` through the `research-update` workflow, with no new Param (section 5). Extract the baseline selection of `hrvOn` and `restingHrEval` in `shared/engine/readiness.ts` into a helper that `recentRange` also uses. Tests: Today's readiness sentences byte-identical before and after (existing readiness tests plus a golden of `readinessSignals`), `npm run research:check`. No Param changes, so no `PARAMS_VERSION` bump and no `plan:report` delta to paste; the PR runs `plan:report` once and states the output is unchanged. Changes: `readiness.ts`, `engine-rules.md`, `research/rules`.
2. **Read model (server, no screen).** `shared/domain/trends.ts` (pure: `weeklyBands`, `weeklySleep`, `weightWeeks`), `loadWellnessSeries` beside `loadActivityCores`, `GET /api/trends` through `memoByVersion`, ADR 0019. Tests: unit tests per pure function; API test (shape, an SDNN-only history gives no HRV series, no weight key by default, the query order in section 2, `expectNoRefusedFetches`); `noRawWrites.test.ts`, `dataVersion.test.ts` and `athleteState.test.ts` unchanged and passing, showing the engine input is untouched. Changes: `shared/types.ts` (`TrendsView`), `server/routes/trends.ts`, `server/app.ts`, the ADR.
3. **Trends page, running half (web).** `/trends` from More and the rail, the range switch, Running per week (time or distance, the 4-week line from `avg4wRunMin`, race flags, strength marks). Tests: page test by role and name, hidden-table test, offline-notice test, `lazyChartImports`, e2e `22-trends.spec.ts` at 360 px (no horizontal scroll). Visual design spec section 7 updated.
4. **Recovery panels (web).** Heart-rate variability and resting heart rate with a band, sleep as weekly hours. Tests: page tests on synthetic history, `expectCleanCopy` on every sentence, e2e extended.
5. **Optional body weight (own PR, cuttable; a later PR, not part of the first release of the page, task TR1 covers steps 1 to 4).** Migration `User.showBodyWeight` (default false), Settings section "Trends", the gated weight series, weight chart and copy, ADR addendum. Tests: migration case in `migrations.test.ts`; API (absent when off, present when on, `weightGate` at two or more REDs flags); page; e2e (off by default, on after Settings, off again hides and deletes nothing).

### Decisions taken

- **A new Trends page from More, not a tab of Stats.** Reason: Stats is lifetime look-up tables; Trends is time series against ranges and the plan, with one switch that gates body data. Against: two pages with a running-hours chart each. Stats is left alone in v1; folding its "Last 12 weeks" chart into Trends is a follow-up (open question 8).
- **Running weeks use the existing `GET /api/weeks` and `WeekRow`, including `avg4wRunMin`; the new route carries recovery and weight only.** Reason: no second aggregation, no second copy of 104 weeks. Against: two requests for one page; both are cached by the client and the weeks read is one `ActivityCore` query.
- **Recent range = mean plus or minus 1 SD of the baseline readings before the week, drawn for heart-rate variability and resting heart rate only.** The HRV baseline is the one `hrvOn` builds, and the lower edge equals its lower bound (`j4.sdBelowMean` = 1); the upper edge and the whole resting-heart-rate band are display-only (Today's resting-heart-rate flag is one-sided, mean plus `j4.restingHrAboveBpm`, with no SD). The band is called the runner's recent range, never J4's and never "the one Today uses". Against: the band moves with the runner, so a slow drift rides inside its own band (open question 5); the resting-heart-rate SD band is grade D and unvalidated.
- **Sleep is weekly hours with no band.** Reason: Today's sleep check is a 7-night mean against fixed J5 thresholds, so a band would be new logic and a new number. Against: no context for a single week.
- **No marker for a week outside the band.** Reason: a runner reads it as red or amber, and a lower resting heart rate or higher HRV is not a concern. The band is drawn; the table shows low, high and mean only.
- **A weekly mean needs enough nights.** Sleep reuses `j5.sleepMinNights` (4 of 7 nights). Heart-rate variability and resting heart rate use a page constant of 4, a display default with no evidence behind it (open question 7). Gaps are drawn as gaps, never interpolated.
- **Strength: one mark per session under the weekly bars and a link to Strength; no lift chart.** Reason: `LiftHistory` and `EstimatedMaxChart` already show per-lift history.
- **Weight is a display choice, not a data barrier.** It is shown only when the setting is on (default off) and fewer than two REDs flags are open in the latest screening (`j5.redsHoldFlags`); otherwise the page draws no weight line. `weightKg` is already in the 60-day snapshot and in `GET /api/wellness` (section 2), so the gates decide what the page draws, not who can read the number. Against: a gate that does not restrict access is a nudge; closing the data path is a separate change (open question 1).
- **Cut from v1: prediction history over time, intensity mix by month, the longest-run dot chart and its "longest in this range" line.** Reasons: the prediction view is a forecast read as a grade of form, and Goals already owns the track record (`PredictionTrackRecord`, `PredictionTrackChart`); the mix counts planned structure, not measured intensity, and only the active plan's sessions exist; the longest run is in the `WeekRow` and on Stats, and a record line is a personal-best statement in other words.
- **`/api/settings` stays on the offline allowlist with `showBodyWeight` in it.** Accepted: the cached payload then shows on the device that weight tracking is on. Reason: `rl-api-v1` already holds heavier health data (Today); moving the flag to its own uncached route is the fallback if that is not acceptable (ADR 0019).
- **`GET /api/trends` is not an offline-cached read (ADR 0012 allowlist unchanged).** Reason: a retrospective page used at home; caching adds months of health data to `rl-api-v1`. Against: no signal means a notice instead of the page.

### Open questions

1. Close the weight data path: a `select` without `weightKg` in the snapshot's wellness read and in `GET /api/wellness`, and `weightKg` read only in the gated loader? Default: not in this design (it touches the engine input and an API contract); the REDs gate then remains a display gate. Cut step 5 if that is not acceptable.
2. Measured intensity mix from heart-rate histograms, over all plans? Default: out of v1; a later research pass on B2 wrist-HR trust and zone drift decides.
3. Aerobic efficiency by month (A8, in the audit proposal)? Default: out of v1; A8 states no cut-off is validated and a month rarely holds the minimum run count per window.
4. Gate weight at two REDs flags? Default: yes; a later decision can lower it to "never gate".
5. A slow (about 60-day) range for heart-rate variability beside the recent range? Default: no; revisit after step 4 runs on real history.
6. Ranges 6, 12 and 24 months, 12 the default? Default: yes; the 24-month range shows shape only and the hidden table is the exact form.
7. Minimum nights for a heart-rate-variability or resting-heart-rate weekly mean: 4 is a default borrowed from sleep. Default: keep 4 as a page constant until a research pass on wearable night-to-night noise gives a figure.
8. Replace Stats' "Last 12 weeks" chart with a link to Trends? Default: later. It touches `StatsPage.tsx:97-105` and `tests/web/stats.test.tsx`, which are not changed here.

## 1. What the runner sees

**Entry.** More gains a row "Trends" with the note "Months of running and recovery readings" after Stats; the desktop rail gains "Trends" beside Stats; `/trends` is current under More. Title "Trends"; context line "Weeks and months of what was run and logged, against your own recent ranges. Nothing here is a target."

**Top of the page.** A range switch (Segmented): 6 months, 12 months, 24 months; 12 selected. The choice is a per-viewer convenience in `localStorage` (try/catch), not a setting. Sections follow in the order below; each has a heading, one caption line, the chart and a visually hidden data table (one row per week).

**Running per week.** Bars of run hours per week (`--chart-1`), switchable to distance in the runner's unit (Segmented "Time | Distance"). A line over the bars is `avg4wRunMin`, the mean of that week and the three before it. The page draws the line through complete weeks only: the current week is a bar with the accent outline captioned "this week so far" and has no line point (a guard in the page, not a second aggregation). A race week carries the existing flag (`--chart-4`, from `raceMin > 0`). Weeks with no run have no bar. Under the bars, a row of small `--chart-2` squares, one per strength session, shares the bar columns, with "Squares are strength sessions. Lifts and loads are on Strength." (link). Tap or hover shows the standard tooltip: week of, run time, runs, strength sessions. `aria-label`: "Run hours per week, last 12 months. Latest complete week 6.2 h."

**Recovery readings.** Three stacked panels (140 px high): overnight HRV (rMSSD, ms), resting heart rate (bpm), sleep (hours). HRV and resting heart rate draw the weekly mean as a 2 px line with a marker per week over a shaded band, the runner's recent range. Sleep draws the weekly mean hours with no band. A week with fewer nights than the minimum has no marker and the line breaks. No week is marked for sitting inside or outside the band; the hidden table has the columns week, mean, nights, low and high (low and high empty for sleep and where no range exists).

The band for a week is computed at the week's Monday from the readings on the days before it, so the week's own nights never build its band (a weekly mean can fall outside a band it did not help build). Until `j4.minReadings` (10) earlier readings exist there is no band and the caption says "The recent range is still being built: 6 of 10 readings."

Captions (templates, one per construction):
- HRV, default profile: "Weekly mean of overnight rMSSD in ms. The band is your recent range: the mean of the latest 10 readings within the 21 days before the week, plus or minus 1 SD."
- HRV, female profile: the same with "the readings within the 35 days before the week", because `hrvOn` uses the 35-day cycle baseline there (`j4.cycleBaselineDays`).
- Resting heart rate: "Weekly mean of resting heart rate in bpm. The band is your recent range: the mean of the latest 10 readings within the 21 days before the week, plus or minus 1 SD."
- Sleep: "Weekly mean of recorded sleep in hours. No range is drawn."

SDNN is never plotted or mixed; a source with only SDNN shows "No rMSSD readings yet." One line under the panels: "These readings never change a plan by themselves." (J4: HRV alone never triggers.)

**Body weight** (only when shown in Settings). A neutral line (`--text-muted`) of weekly means, one marker per week with at least 2 weigh-ins (page constant), in the runner's weight unit; the y axis spans at least 15 percent of the median so ordinary variation does not read as a slope (page constant). Caption: "Mean of each week's weigh-ins. A scale varies by a kilogram or more within a day, so read the line, not a point." Footnote: "If your weight has changed without you meaning it to, say so in the energy screen on Profile." (link). No goal line, no change figure, no BMI, no colour but the neutral ink.

**Weight hidden** (the default): the section does not exist and the page never mentions it. **Weight gated** (two or more REDs flags in the latest screening): only "Body weight is not charted while the energy screen has open flags. The screen and where to find care are on Profile." (link).

**States.** Loading: a skeleton per section at the chart height. No run in the range: `EmptyState` "No runs in this range yet." Offline with no data (`useOnline`): "Trends need a connection. Today, the plan and the log work offline." Error: `role="alert"` with a reload instruction, as Stats.

**Settings.** A new section "Trends" after Appearance: Segmented "Body weight on Trends: Hidden | Shown", saved on change like the weight unit, with "Hidden by default. Hiding removes the chart from the page and keeps every weigh-in."

## 2. Data model and reads

No new table. One column (step 5): `User.showBodyWeight Boolean @default(false)`, a display preference beside `units` and `weightUnit`. `User` is already in `STATE_MODELS`, so a write drops the memo and the next read reflects it. Migration `<ts>_show_body_weight` adds `"showBodyWeight" BOOLEAN NOT NULL DEFAULT false`; its case in `tests/unit/server/migrations.test.ts` seeds the previous release's users, activities and plan sessions with raw SQL, applies it and asserts no row is lost and every user reads false. `UserSettings` gains `showBodyWeight`. `/api/settings` is an offline-allowlist read, so the flag is cached in `rl-api-v1`; that is accepted and recorded in the ADR (a boolean, in the cache that already holds Today).

| Section | Source | Read, and the CLAUDE.md rule it follows |
| --- | --- | --- |
| Weekly time, distance, strength marks, race weeks, 4-week mean | Existing `GET /api/weeks` (`useWeeks`, up to 260 weeks): `ActivityCore` rows from `activityLoadStart(first week)` through `aggregateWeeks` | Nothing new. The page uses `runMin`, `runM`, `strengthSessions`, `raceMin`, `avg4wRunMin`; it never renders `streak3Plus` (no streaks, G5) |
| Recovery means and bands | New `loadWellnessSeries(prisma, userId, {from, to})` in `server/serialize.ts` beside `loadActivityCores`: `date, restingHr, hrvRmssd, sleepSec`, 24 months plus the 35-day lookback (about 760 rows) | The snapshot keeps 60 days (`WELLNESS_DAYS` in `athleteState.ts`). Widening it would change the engine input and the "inputs in use" card. The narrow loader inside `memoByVersion` follows the `loadActivityCores` pattern; ADR 0019 records it as the exception to "no new code queries that window". The engine input is untouched, shown by the unchanged `athleteState.test.ts`, `dataVersion.test.ts` and `noRawWrites.test.ts` |
| Weight | `weightKg` from a second call of the same loader, only when `showBodyWeight` is true and `screeningFlags` is below `j5.redsHoldFlags` | Held in the Trends memo `trends.weight` only in that case. It is not a barrier: `weightKg` is already in the snapshot (the `prisma.wellnessDay.findMany` at `athleteState.ts:462-466` has no `select`) and `GET /api/wellness` returns every column (`server/routes/wellness.ts:40-52`) |

`GET /api/trends` takes an empty strict query (400 on any parameter), sits under `requireAuth` like `/api/stats`, and answers `TrendsView`: `{ asOf, recovery: { hrv, restingHr, sleep }, weight?, weightGate?: 'reds' }`. Each recovery series is one entry per week of the last 24 months (`weekStart, mean, nights, low, high`, bounds null for sleep and where no range exists).

**Order of reads in the route.** (1) The user row for `showBodyWeight` (one `user.findUnique`; skipped if `loadProfile` in the snapshot already carries it). (2) `loadAthleteContext`, for `screeningFlags` and the profile's `sex`: served from the snapshot on a warm request, the snapshot's own reads on a cold one. (3) Memo `trends.recovery` through `memoByVersion` (key: user, name, today, data version): the wellness read and the band computation on a miss. (4) Memo `trends.weight`, only when step 1 and 2 allow it. Only (3) and (4) are memoised; (1) is not. The API test counts the queries of a warm and a cold request against the real route and asserts the real numbers; the design fixes only the order and that a warm request runs no wellness query. `PredictionLog` is not read.

Client: `web/api/trends.ts` (`useTrends()`, `keys.trends`); `dropUserQueries()` gains the key; the Settings mutation invalidates `keys.trends` and `keys.settings`. `useWellness` keeps no consumer.

## 3. Engine and server functions

Pure, in `shared/`:

- `engine/readiness.ts`: a helper `baselineReadings(byDate, date, signal: 'hrv' | 'resting-hr', cyclic)` extracted from `hrvOn` (the lookback of `j4.lookbackDays` or `j4.cycleBaselineDays`, the newest `j4.windowDays` outside the cycle case, ln scale for HRV) and from `restingHrEval` (newest `j4.windowDays` within `j4.lookbackDays`; no cycle handling, as today). `hrvOn` and `restingHrEval` call it and their outputs do not change. `recentRange(byDate, date, signal, cyclic): { low; high; mean; readings } | null` uses it: null below `j4.minReadings`; HRV is `exp(mean ± j4.sdBelowMean × sd)` on the ln scale, resting heart rate `mean ± j4.sdBelowMean × sd` on its own scale. The noise-floor drop and the decline chain in `hrvOn` are not part of the range.
- `domain/trends.ts`: `weeklyBands(byDate, weekStarts, signal, cyclic)` returns `{ weekStart, mean, nights, low, high }`, the range at each Monday, the HRV mean geometric (mean of ln, then exp), a null mean under the minimum nights; `weeklySleep(series, weekStarts)` the same without bounds, minimum `j5.sleepMinNights`; `weightWeeks(series, weekStarts)` returns integer grams (`{ weekStart, grams | null, weighIns }`); `formatBodyWeight(grams, unit)` is added to `shared/domain/weight.ts`, the one converter. Page constants in this file: `MIN_NIGHTS_PER_MEAN = 4` (heart-rate variability and resting heart rate), `MIN_WEIGHINS_PER_WEEK = 2`.
- `copy/trends.ts`: every sentence above as a template `trends.*`, registered in `templates.ts`; the G5 lint test renders all of them (section 4).

Server: `server/routes/trends.ts` (`trendsRouter(deps)`) and `loadWellnessSeries`. No provider, no fetch, no environment variable.

Web: `TrendsPage.tsx`; charts through `lazyCharts.tsx` (new `place` heights); `WeeklyHoursChart` already has a `marks` prop (`current`, `race`, `muted`) that only the compact chart draws: the full-size chart draws the same marks and an overlay line from `avg4wRunMin`; new `RecoveryChart` (line and band) and `WeightChart` (line). All recharts parts are already in the `charts` chunk; no new dependency.

## 4. Chart and copy conventions (visual design section 7)

- Styling only from `charts/theme.ts`. No new colour tokens in v1: the band reuses `--accent-soft`, weight uses neutral ink. `--chart-1..4` keep their fixed meanings (run, strength, cross, race).
- Shape carries meaning, colour second: bar = a total, square = a strength session, flag = race week, shaded band = recent range. Dashed lines stay reserved for plans.
- Axes: no lines, three y ticks at most, horizontal grid only; x ticks are month names, not 104 week labels.
- No legend; series are named in the caption or on the chart. Tooltip is the shared `ChartTooltip`.
- Every chart has an `aria-label` with the latest value and a visually hidden table of the same numbers.
- Each chart reads in greyscale (shape, fill, outline).
- Copy test: every `trends.*` template renders through the existing G5 lint (`shared/copy/lint.ts`), with no second word list and no change to `G5_BANNED` (a ban on "up" and "down" would match "set up"). The weight rule is structural: a unit test requires that the weight templates take no slot except the weekly mean, the unit and the count of weigh-ins, so no difference or change figure can be rendered. No template interprets a point as common, uncommon or outside a range.

## 5. Rule text, Params and constants

New rule **T1 Trends are descriptive**, section (q) of `research/engine-rules.md`, with an entry in `research/rules` under `readiness-monitoring`, written through the `research-update` workflow. Text: Trends show what was run and logged; they set no target, draw no aim line, mark no value as inside or outside a range, compute no ratio of recent to earlier load (G-5) and never feed the engine (ADR 0005). The recent range for heart-rate variability is the baseline `hrvOn` builds (J4, grade C for ln rMSSD) read as mean plus or minus one SD; for resting heart rate it is the baseline of `restingHrEval` with the same width (grade D: Today uses a one-sided offset and no study validates the band). Sleep has no range. The range is the runner's own and is never a threshold. Body weight is shown only on the runner's choice, without a goal, a change figure or a verdict, and not while the latest screening holds `j5.redsHoldFlags` or more flags [mountjoy-2023-reds-consensus], a display gate that restricts no access to the data. J4 gains one line: "Trends display the baseline of this rule as a band."

**No new Param.** The earlier draft listed five `t1.*` Params; none survives. The display window (104 weeks) is not an engine number and comes from the existing weeks route limit; the per-month, per-prediction and per-week-weigh-in counts either left with the cut features or are page constants (`MIN_NIGHTS_PER_MEAN`, `MIN_WEIGHINS_PER_WEEK`, the 15 percent weight-axis span, the 6/12/24 ranges), none read by the engine. Reused: `j4.windowDays` (10), `j4.lookbackDays` (21), `j4.cycleBaselineDays` (35), `j4.minReadings` (10), `j4.sdBelowMean` (1), `j5.sleepMinNights` (4), `j5.redsHoldFlags` (2). With no Param added or changed, `PARAMS_VERSION` stays.

## 6. ADR draft

**0019. Trends are a memoised descriptive read; body weight is an opt-in display**

Status: Proposed 2026-11-07.

Context: Today draws 12 weeks and the Plan page a season strip; nothing shows months of running or the recovery readings against the runner's recent range. The snapshot (ADR 0009) holds 365 days of activities but 60 days of wellness. Body weight is health data with a known harm path for a runner with unintended weight change or energy-deficiency flags (rule n-4).

Decision:
- Weekly running comes from the existing `GET /api/weeks`. `GET /api/trends` answers weekly recovery means with recent ranges and, on the runner's choice, body weight. It is computed by `memoByVersion` from one column-limited wellness loader and the snapshot's screening count.
- The wellness loader is allowed because it selects four columns (five with weight) over a window the snapshot does not hold, about 760 rows; the engine input is untouched. Every other read of athlete data for the page goes through the snapshot or the weeks route.
- Nothing on the page sets a target or an aim line, marks a week as outside a range, divides recent by earlier load, or reaches the engine.
- `User.showBodyWeight` defaults to false. When false the Trends response has no weight key and the Trends memo never selects the column. When the latest screening holds two or more flags the response carries `weightGate: 'reds'` and no series. Hiding deletes nothing.
- The gates are display gates. `weightKg` is in the 60-day snapshot (the wellness `findMany` in `server/services/athleteState.ts` has no `select`) and every column is returned by `GET /api/wellness` (`server/routes/wellness.ts`), so an authenticated request can read weights whatever the setting. Restricting both is a separate change (open question 1).
- `showBodyWeight` travels in `/api/settings`, which ADR 0012 keeps on the offline allowlist. Accepted: the device cache shows that weight tracking is on, next to health data it already holds. The flag moves to an uncached route if that changes.
- `GET /api/trends` is not on the offline allowlist; ADR 0012 is unchanged.

Reasons:
- **Rule:** G5 and G-5 in `research/engine-rules.md` forbid targets read as minimums, verdict words and load ratios; the page follows them, checked by the copy lint and a scan test.
- **Fact:** `WELLNESS_DAYS` is 60 and `inputs.wellness.windowDays` prints it, `server/services/athleteState.ts` lines 72 and 558 (read 2026-11-07); 24 months of means need a longer read.
- **Fact:** `j5.redsHoldFlags` is 2 and rule n-4 (`research/engine-rules.md`) holds progression and shows a clinician prompt at that count, so the same count stops the page drawing weight.
- **Fact:** `hrvOn` draws only a lower bound (mean minus `j4.sdBelowMean` SD) and `restingHrEval` a one-sided offset with no SD; `sleepEval` has no baseline (`shared/engine/readiness.ts`, read 2026-11-07), so only the HRV baseline is shared and the other bands are display-only.
- **Opinion:** weight is a display choice for a runner who asks for it, off by default and never judged; arguable, because the setting and the flag gate restrict no access to the number.
- **Opinion:** leaving the read uncached keeps months of health data out of `rl-api-v1`; the cost is a view that needs a connection.
- **Preference:** one page with a range switch over one page per signal.

Alternatives: (a) a tab on Stats: rejected, different job and different gating (**Opinion**). (b) Widen `WELLNESS_DAYS` to 760: rejected, it changes the engine input and the inputs card for a display need (**Fact**: the card prints the window, `athleteState.ts:558`). (c) Banding on the client from `GET /api/wellness`: rejected, it ships 760 rows and duplicates the baseline in the browser, while the engine's `recentRange` stays server-side and tested (**Opinion**; weight is not a deciding reason, since `GET /api/wellness` returns it today). (d) Measured zone time from heart-rate histograms: deferred (**Fact**: B2 limits optical heart rate to steady flat runs, and zones change over a year).

## 7. Risks and arguments against the whole feature

- **Any trend invites chasing.** A rising line reads as a goal. Mitigation: no targets, no aim line, no change figures, no marker on a week, captions that say what a point is. The 4-week line is still a progression picture, and a runner who reads it as a ladder may overreach. The weekly decision, not the picture, sets load (ADR 0005).
- **Recovery panels over-read wearable noise.** Weekly means of nightly values still carry device error (J4 floors of 6 to 10 percent), and a device change shifts the level. The band is the runner's own and moves with them, so a slow drift is invisible by construction. The resting-heart-rate band is grade D. The panels can look authoritative; the line "never change a plan by themselves" is on the page.
- **Weight.** Even opt-in, a chart can feed checking. Mitigations: the default, the flag gate, no deltas, no goal, a neutral line and the Profile pointer. The gates are not access control (section 6). If that is not acceptable, drop step 5; no other step carries weight.
- **Overlap with Today, Plan and Stats.** Three pages draw weekly bars. Today answers "this week", Plan "the season ahead", Trends "the last year", Stats "totals and look-ups". If that is blurry, fold Trends into Stats instead of removing sections.
- **Cost.** One page, one route, one rule, one ADR, a permanent surface to keep under the copy lint and the 360 px layout. A 24-month weekly bar is narrow; that range exists for shape and the hidden table is the exact form.
- **Not verified in this design:** the SQL Prisma emits for the column add on SQLite (the migration test decides), whether `loadProfile` already carries `showBodyWeight` (decides if the user-row query is needed), the names of the scan tests that exercise `server/` beyond those listed, and the real HRV and sleep coverage of the runner's sources (unknown; the empty states are the fallback).

## Appendix: Critique answered

Applied in full: 2, 3, 4, 5, 6, 9, 10, 11, 13, 15. Applied in part, with the rest declined below: 1, 7, 8, 12, 14.

- **1 (weight gate).** Applied: the "never selected or held in memory" claim is gone; the ADR says the gates are display gates and names the two unrestricted paths with file references. Declined: the "real work" option (a `select` without `weightKg` in the snapshot and in `GET /api/wellness`) stays out of this design because it changes the engine input and an API contract; it is open question 1, and step 5 is its own PR and cuttable.
- **2 (J4 construction).** Applied: the range is extracted for HRV and resting heart rate only; sleep is weekly hours with no band; the caption says "recent range"; the HRV band is not called J4's. The resting-heart-rate SD band stays as a grade D display construction, with the SD width borrowed from `j4.sdBelowMean`; the ADR and rule T1 say so.
- **3 (hollow marker).** Applied: marker, `against` and the table column removed; low, high and mean stay.
- **4 (band date).** Applied: the band is computed at the week's Monday from earlier days; the caption has a 35-day variant for the cycle baseline.
- **5 (Params).** Applied: all five `t1.*` Params removed. `j5.sleepMinNights` is reused for sleep; the other counts are page constants marked as defaults (open question 7).
- **6 (duplicate field).** Applied: `avg4wRunMin` and `useWeeks` reused, `trendWeeksOf` dropped. Correction to the critique's premise: the existing `marks` prop is drawn only by the compact chart, so the full-size chart still needs a change to draw it.
- **7 (loader).** Applied: the plan states the engine input is untouched and names the tests (`noRawWrites.test.ts`, `dataVersion.test.ts`, `athleteState.test.ts`), and the cost (about 760 rows). The loader is kept, since the 60-day snapshot cannot serve 24 months. The pure band function reuses the engine helper, as asked.
- **8 (query counts).** Applied: the numbers are removed and the read order is stated; the test asserts the real counts. `PredictionLog` is no longer read.
- **9 (prediction history).** Applied: cut from v1, Goals owns the track record.
- **10 (intensity mix).** Applied: step, tokens and Param removed; open question 2 kept.
- **11 (longest run).** Applied: dots and facts line removed. The 4-week line stays (critique asked to reuse it, not remove it); the residual is in the risks.
- **12 (settings flag, Stats).** Applied: the flag in the offline cache is stated as accepted, with a fallback. The Stats chart removal is deferred, with the files it would touch.
- **13 (ADR labels).** Applied: sources and rule locations cited; the weight Opinion no longer carries a health claim.
- **14 (copy tests).** Applied: the second word list is dropped and `G5_BANNED` is not extended ("up" and "down" match innocent words); a structural template test replaces it; the "uncommon" templates are gone.
- **15 (estimates, wording).** Applied: size and line estimates and the pixel width removed; "owner" replaced by neutral wording.
