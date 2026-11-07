# Race plan, step 2: a race plan derived on read

Status: design, 2026-11-07 (revised after critique); steps 1 to 3 are built together (task RP2, ADR 0018), steps 4 and 5 are open. Builds on ADR 0005, 0009, 0010, 0011, 0012 and 0014; step 1 (H11 race effort, `h11.raceRpe`, Z1 ceiling) is merged. "The goal race" is the current goal (`currentGoalFor`); no race name, date or history appears here.

## Summary

### Plan in steps

1. **Docs and research pass (S, no code).** Spec into `docs/superpowers/specs/`, ADR 0018 "Proposed" (section 6), rule H14 and gaps R1 to R5 drafted through the `research-update` workflow. `docs/STATUS.md` follow-up 29, finding 1, says four Params are read by nothing; two are (section 5), and the entry is corrected in the same PR. Tests: `npm run research:check`, `prettier --check .`. Changes: docs only.
2. **Core plan without checkpoints (M).** `shared/engine/racePlan.ts` (effort by thirds, climbing, fuel and fluid, K6 race week, heat, dark hours), `raceFuelFor` in `fuel.ts`, `shared/copy/racePlan.ts`, five `r1.*` Params, H14/K6/H11/H6 rule text, `PARAMS_VERSION` bump, and the heat-exposure predicate extracted from `explainInputs.ts` into `shared/engine/heat.ts` (one function, called by Explain and by the race plan). Tests: unit per block, determinism, G5 lint over every template, Param-sentence tests, oracle digests unchanged (`plan:report` before and after pasted into the PR), isolation scan, and the existing Explain tests (`explainInputs.test.ts` and the Explain template and server tests) unchanged and green, since the extraction touches the I8 builder. Changes: engine and copy only.
3. **Server, Race page, Today, session sheet (M).** `server/services/racePlan.ts` (memo `race.plan`), `GET /api/race/plan`, `web/api/race.ts`, `RacePage`, More row, Today slot `race` (race week), race-day block in `SessionSheet`, `H14` in `ruleTitles.ts`. Tests: API tests under `noNetwork()` with `expectNoRefusedFetches`, page tests, the Today payload test with the new slot, fold test with the slot filled, e2e `race-plan.spec.ts` at 360 px (race week, race day, empty states).
4. **Checkpoints and splits (M, last, can be dropped).** Schema edit (model `RaceCheckpoint` plus the back-relation `raceCheckpoints RaceCheckpoint[]` on `User` and on `Goal`), `RaceCheckpoint` in `STATE_MODELS`, migration plus a case in `migrations.test.ts`, `GET/PUT /api/race/checkpoints`, `shared/engine/raceSplits.ts`, table editor sheet. Tests: split properties (finish row equals the prediction range, flat course proportional to distance, climb moves share, interior rows inside the finish range), API validation, `migrate diff --exit-code`, migration case, e2e enter, read, edit.
5. **Offline race page (S, open decision, default: not built).** Only if the Today-only path (section 3) proves too little: sixth allowlisted read `/api/race/plan` in `web/sw/sw.js`, `tests/unit/shared/sw.test.ts`, an ADR 0012 amendment, `offline.test.tsx`, a case in `17-offline.spec.ts`.

No split-share check against the runner's own history is built (section 7).

### Decisions taken

- **One derived `RacePlan`, stored nowhere (ADR 0014 shape).** Reason: forecast, ladder, prediction and checkpoints change without a re-plan. Against: a stored copy would serve a watch or feed with no engine call; rejected because a race is not publishable (ADR 0008) and a stored plan goes stale.
- **Both effort and splits are available (decided 2026-11-06); the checkpoint table is optional.** With no rows the page is the effort, fuel, heat, dark and race-week plan. Against: splits are the weakest part (the corpus holds nothing on aid stations or on pace by segment); step 4 comes last and can be dropped without loss to steps 2 and 3.
- **Effort is the same in all three thirds.** The zone 1 ceiling and `h11.raceRpe` do not vary by third because no study supports a different effort per third and G6 forbids a push at the end. The thirds carry different facts (clock window, heat, dark, fuel total, what late climbing and descending cost). Against: "by thirds" suggests a pacing script; the page says the thirds are a reading aid.
- **Fuel is the highest tolerated rung (`ladder.toleratedIndex`, floor when none), not the rung in trial.** `FUEL_KINDS.race` stays false (the fuel slot, watch lines and `fuelLab.test.ts:542` are untouched); the race reads `raceFuelFor`. The ladder counts a tolerated run only on a day that was not hot (`replayLadder`), so no rung was tested at race heat; a hot race says so. Totals and grams to carry carry the label that tolerance came from runs of a few hours. Against: a runner who tolerated 70 g/h on 3 h runs may want more over 30 h; the page offers no rate above what training showed.
- **Splits weight segments by flat-equivalent distance (L5, `l5.gainEquivalentM`, grade D)** and scale the prediction range by the share of weight. Interior rows are "about" times, rounded to 10 minutes, with no widening Param until the R3 pass. No downhill credit (I11 caps it, G6). Against: Minetti per segment is finer; it needs the grade distribution inside a segment, which the table does not hold.
- **Dark hours use the D1 clock (`d1Dark`, 06:00 to 20:00) in v1.** Reason: the race's time zone is not stored; a dusk time in the wrong zone is worse than a labelled default. Against: a solar module is more correct; the audit (follow-up 29) refuted it as a standalone item because `crossesDarkness` is already true for any 100-mile, so it stays deferred (Q3).
- **Heat does not change the prediction.** The plan states the daytime thirds and the low-confidence label (I6, over 6 h) and shows the I8 credit. The race heat line is climate normals for the race date, not a forecast, and is labelled so. Against: the prediction applies the marathon heat slope to every hour; a daytime-only slope is a separate change that moves the prediction.
- **Ultra classes only (above the marathon, as H11).** Shorter goals keep today's race session.
- **`Goal.supportLevel` is read.** `aided` shows aid-station wording and grams to carry per segment; `self` shows no aid wording, a total-carry framing (all fuel is carried) and "course points" for the table; aid time (R2) does not apply to `self`.
- **Offline: Today only in v1.** The Today payload is already cached, so the race-week card and the race-day block work with no change; the Race page waits for its own ADR 0012 amendment (step 5).
- **No language model, no watch, no feed.** Text is `shared/copy` templates; the race stays out of `buildDeliverables`.

### Open questions

1. Cutoffs: elapsed time or clock time? Default: the form takes either, stored as elapsed seconds (`cutoffSec`), shown in both when a start time exists.
2. A late-race slowing Param (positive split)? Default: none in v1; one sentence names the direction (R1 research pass first).
3. Sunrise and sunset from `raceLat`/`raceLng` plus a race time zone? Default: later, after a `raceTz` decision; v1 uses the D1 clock.
4. Marathon and shorter goals get a plan? Default: no. The generic race purpose at `sessions.ts:134` ("follow the fuel and pacing plan") stays, because rewording it changes `PlanSession` text pinned by `matrix.test.ts:244`, `orchestration.test.ts:420` and `sessions.test.ts:529` and may move oracle digests; a reword is its own PR with a `plan:report` delta.
5. Grams to carry per segment on checkpoint rows (`aided` only)? Default: yes (rate times segment time, rounded), labelled an estimate and carrying the few-hours label.
6. May the cutoff ever change the effort target? Default: no; the cutoff and the expected range are shown as two facts, never compared in words or steered to.
7. Race page offline (step 5)? Default: no; Today-only until a trail case shows the need.

## 2. What the runner sees

**More.** A row "Race plan" (note: "Effort, fuel, heat and arrival times for the goal race"), shown when the current goal is an ultra class with a distance. The race session's sheet and the Today race-week card link to the same page.

**Race page, top.** The race name and days to go (the goal's own fields). One card: "Expected time" as a range (the prediction's `lowSec` to `highSec`, rounded outward to `r1.arrivalRoundMin`), the start time if set, the finish clock range if a start time is set, the `rangeLabel` line ("wide on purpose, grade D"), and the disclaimer ("This plan is a sketch ..."), which the Disclaimer block of `research/engine-rules.md` (section (n), "Red flags and disclaimer") says every race plan shows. Without a prediction the card says the range needs a recent race or a few long runs, and uses the goal's expected duration, labelled "about".

**Effort.** Three cards, each with its elapsed window (and clock window with a start time). Every card repeats the one instruction: heart rate at or below the zone 1 ceiling of {bpm}, effort {low} to {high} out of 10, and "about {85}% of race time at or below the first threshold" (`h11.belowVt1Share`, also read by the H11 Explain study line; the race plan reads it a second way). On a hot race (WBGT at or above `i9.warnWbgtC`) the bpm is dropped and effort leads (I7). Per-third facts:
- A third that starts in daytime heat gets the I6 line (heat applies to daytime hours; low confidence over 6 h). The race WBGT is the climate normal for the race date (`ClimateCache`), and the line says "typical for the date, not a forecast".
- A third with dark hours says so, with the hours range.
- The last third adds, from facts: in a study of 27 runners on 10 passes of a 220 km race, climbing speed changed with distance and the authors read the loss as neuromuscular fatigue, from correlations (R1; `jeker-2020-vertical-speed-ultra`); descents cost about 13% more after a mountain ultra (`i11.lateDescentCostIncrease`, `vernillo-2015-fatigue-energy-cost`); expect slower speed at the same effort. No instruction to speed up. Each slot's wording matches the cited paper's population, as the H11 study text does.
- A "Climbing" card: climb by effort, not by speed (H4); hike the steep parts (`h4.hikeGradePct`; between `h4.walkCheaperGradePct` and it the faster gait depends on climb rate); about 550 m/h is a reference, not a target. Checkpoint rows whose climb reaches `h4.climbNoteGainPerHourM` carry a "climb by effort" tag.

**Fuel and fluid.** One rate from the tolerated rung ("60 g/h of carbohydrate", or the floor range), the low-certainty label above the floor, the multiple-carbohydrate line above 60 g/h. A total per third and for the expected time ("about X to Y g") appears only with the label "Tolerated on runs of a few hours; a race is much longer." On a hot race the line reads "Tolerated on cooler days; no run at race heat counted toward this rate." Fluid: the H8 sentence (drink to thirst, never forced; 450 to 750 mL/h is a reference range) and the EAH card (stronger when the expected time exceeds `n7.eahStrongerAlertHours` or the race is hot; aid-station wording only for `aided`). The nausea plan opens when the race is hot (H7). With a gut condition: the clinician disclaimer and the floor. When no rung above the floor was tolerated: "Training has not tolerated a higher rate; the floor is the rate", with a link to the Fuel lab. For `self`, a card shows the total fuel to carry for the expected range, with the same label.

**Race week.** On the page always, and on Today from `r1.raceWeekCardDays` days before. The K6 line: "In the last 24 to 48 hours before the start, 8 to 10 g of carbohydrate per kg of body mass a day, with little running" (with body mass from the profile: "for {x} kg that is {a} to {b} g"), the dates it covers, the plan's shake-out cap (`k6.dayBeforeMaxMin`) and easy days (`k6.easyDaysBefore`) echoed from the plan, the I8 heat top-up line when `raceWbgtC >= i8.triggerWbgtC` with the credit now (`acclimationCredit`), and the H8/EAH reminder. It says the 8 to 10 g/kg figure comes from one-day trials in eight inactive men.

**Dark hours.** When `crossesDarkness`: "About {a} to {b} hours of the expected time fall after {dusk} or before {dawn} (the engine's default daylight hours; season and place are not modelled)", plus the count of headlamp runs the plan holds (H6). No sleep advice, no kit list.

**Checkpoints** (optional; "course points" for `self`). A table, one row per checkpoint and the finish: name, distance (runner's units), arrival ("about", clock with a start time, else elapsed), a day or night tag, grams to carry from the previous row (`aided` only, with the few-hours label), the climb tag, and the cutoff. Cutoff and arrival are two plain facts side by side ("Cutoff 14:30" and "About 11:50 to 13:10"); no sentence compares them. "Edit checkpoints" opens a sheet: name, distance, climb and descent since the previous row, cutoff (all but name and distance optional). Empty state: one line saying the plan works without the table. Notices, not errors: segments summing to more climb than the course; rows past the finish are ignored, with a count.

**Today.** Race week: one card in the week group (slot `race`, below the fold, no budget): days to go, the K6 line from two days before, "Open the race plan". Race day: the `SessionSheet` of the race session adds a block with the ceiling, the fuel line, the fluid line, the EAH card and the link; the hero is unchanged. Preview days (`?date=`) show the same, read-only.

**Not on:** the watch, the FIT files, intervals.icu events, the calendar feed, the weekly brief. **Offline:** Today's race card and the race-day block read the cached Today payload under the offline note; the Race page and the editor need a connection.

## 3. Data model and reads

```prisma
model RaceCheckpoint {            // the runner's own table; fixtures are synthetic ("Checkpoint A")
  id        String   @id @default(cuid())
  userId    String
  goalId    String
  name      String                // 1 to 60 characters, plain text
  distanceM Int                   // from the start, base units (ADR 0003)
  gainM     Int?                  // climb since the previous row, metres
  lossM     Int?                  // descent since the previous row, metres
  cutoffSec Int?                  // elapsed seconds from the start
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  goal Goal @relation(fields: [goalId], references: [id], onDelete: Cascade)
  @@unique([goalId, distanceM])
  @@index([userId])
}
// User gains:  raceCheckpoints RaceCheckpoint[]
// Goal gains:  raceCheckpoints RaceCheckpoint[]
```
- **State, not non-state.** `'RaceCheckpoint'` goes in `STATE_MODELS`: the memo and the Today slot read it and only the runner writes it. The model has a `userId` column, so `resetData()` picks it up from the schema; `modelClassification.test.ts` covers the list. The migration is additive; its case in `migrations.test.ts` seeds the previous release's rows (goals with plans and predictions) and asserts nothing was lost. `prisma migrate diff --exit-code` needs both back-relations.
- **Write path.** `saveRaceCheckpoints(deps, {userId, goalId, rows})` in `server/services/raceCheckpoints.ts`: one `$transaction` that deletes and recreates the goal's rows (an idempotent replace of the whole table, as `saveStrengthLog` does on its id; no row ids reach the client, so no stale-row edits). Zod validates: distance strictly increasing and below the goal distance (the finish is implicit), at most `r1.maxCheckpoints` rows, gain and loss 0 to 20 000 m, cutoff 0 to 400 h. No raw SQL writes it (`noRawWrites`).
- **Private data.** Checkpoint names and distances are the runner's. Both `GET` and `PUT /api/race/checkpoints`, and `GET /api/race/plan`, mount below `requireAuth` (`app.ts`: `app.use('/api', requireAuth(deps))`), so an anonymous request is a 401 before a byte is read. Validation errors carry row indexes and field names in `details.issues[].path` (as `parse` in `server/errors.ts` builds them) and fixed messages; no message interpolates a name or a distance, and a test asserts that a rejected row's values appear nowhere in the response. `pino-http` logs no body; a test confirms a rejected PUT leaves the row values out of the log. Backup: `server/services/backup.ts` copies the whole SQLite file with SQLite's online backup, so the table is included with no code; no export route covers goals (the only export is the activities CSV, `routes/activities.ts:201`), so no export work is needed.
- **Reads.** `loadRacePlan(deps, {userId, today})` is a `memoByVersion` with `name: 'race.plan'` and `today` set, so the key is `['memo', userId, 'race.plan', today, version.key]`, over: `loadAthleteContext` (goal, profile weight, plan options), the prediction and `GoalModel` from `gatherEngineInput` (climate and `raceWbgtC` come from `ClimateCache`, a state model (`dataVersion.ts`), never a wait), `loadFuelContext` (settings and the replayed ladder), the zone 1 ceiling the race target already uses (`resolveTargets`), the checkpoint rows (read inside the memo's compute and nowhere else, as `strength.state` does for strength), and the acclimation exposure days. Nothing in the race plan reads the forecast: `raceWbgtC` is `climate?.wbgtC` (`goal.ts`), so the `/api/race/plan` ETag is the data version and the day (`athleteKey(version, today)`), with no `forecastStamp`. `PredictionLog` is not read: it is non-state, written weekly and up to a week old; the plan uses the live prediction.
- **Finding on the way.** `acclimationCredit` has a single caller, `heat.ts:396`, and no server caller; the exposure predicate (`acclim.exposureTempC`, `acclim.exposureMinDurationMin`) lives inside the I8 builder of `explainInputs.ts`. Step 2 moves the predicate to `heat.ts` as one function that the builder and the race plan call; the Explain output must not change, and the Explain tests are in step 2's list for that reason.
- **Routes.** `GET /api/race/plan` (no query, `strictObject`) returns `{ plan: RacePlan | null, reason }`; `GET/PUT /api/race/checkpoints`. Authentication precedes the body parser (`app.ts`); the PUT body is small and takes the default parser below `requireAuth`.
- **Today.** Three edits make the slot: the `race: RacePlanSummary | null` field on `TodaySlots` (`shared/types.ts`), a provider in `slotProviders` (`todaySlots.ts`; without it the mapped type is a compile error), and the mount in `SLOT_MOUNTS` (`slotMounts.tsx`); the payload test in `tests/api/today-coach.test.ts` (its `slots` equality) gains `race: null`. The provider returns null outside race week and for non-ultra goals, and reads the same `race.plan` memo, so the data version and forecast stamp already in Today's ETag cover it.
- **Offline (ADR 0012).** ADR 0012 and `CLAUDE.md` say "exactly five" reads, and a sixth would put checkpoint names and weight-derived grams into `rl-api-v1`, which is health data on the device (`purgeDeviceData()` would cover it, but the exposure grows). Today is cached already, so v1 needs no change: the race-week card and the race-day block work offline. The Race page can follow with its own ADR 0012 amendment (step 5) if a case for it appears.

## 4. Engine and server functions

Pure, in `shared/engine/` (no clock, no I/O; `today` and the weather arrive as data):
- `racePlanFor(input: RacePlanInput): RacePlan`. Input: `goal: GoalModel`, `prediction` (or null), `z1CeilingBpm: number | null`, `fuel: { settings, ladder }`, `weightKg: number | null`, `acclimationCredit: number`, `checkpoints: CheckpointInput[]`, `today`. Output: `expected`, `start`, `thirds[3]`, `climbing`, `fuel`, `fluid`, `eah`, `raceWeek`, `heat`, `dark`, `splits`, `notices`, `disclaimer`; every block carries its rule ids and grades, so Explain (H14) can list them.
- `thirdsOf(expectedSec, startTime)`: `r1.thirds` equal windows of the expected time; clock windows when a start time exists.
- `raceFuelFor(ladder, {hot, expectedSec})` in `fuel.ts` beside `fuelTargetFor`, reusing `rungAt` and `rateOf`: rung `max(toleratedIndex, 0)` (0 when `locked`), `lowCertainty`, `multiCarbRequired`, totals over elapsed time (H7 counts over elapsed). Never above `ladder.toleratedIndex`.
- `darkHoursFor(startTime, lowSec, highSec)`: overlap of the race interval with the `d1Dark` night, as an hours range; null without a start time (the plan then states the whole-race fact only).
- `raceWeekFor(goal, weightKg, today)`: dates of the final `k6.carbLoadFinalHours` window and the grams range; only when the expected time is at least `k6.carbLoadMinRaceMin` (the gate `shakeOutFor` in `micro.ts` already uses).
- `splitsFor({ goal, prediction, checkpoints, rate })` in `raceSplits.ts`:
  1. Sort rows; drop rows at or past the finish (counted in `notices`); append the finish.
  2. Segment gain: the row's `gainM`, else `r1.unenteredClimbShare` (1) of the course gain left after the entered rows, spread over the unentered segments by distance (0 with `climbUnknown` when the course gain is unknown). The spreading is a Param, not a hidden default.
  3. Weight `e_i = d_i + l5.gainEquivalentM * gain_i`; fraction `f_k = sum(e_1..e_k) / sum(e)`. Descent adds nothing (I11) and is shown.
  4. Arrival at row k: `[low * f_k, high * f_k]`, the prediction range scaled by the share of weight, rounded outward to `r1.arrivalRoundMin` and shown as "about". The finish row equals the prediction range. There is no interior widening: no study sizes the error of where along the course the time falls (R3), and a number with no source is worse than the plain scaling. The range grows with f, so it is widest at the finish where error accumulates. The page says in words, not numbers, that the late edge is the likelier one (R1) and that the weights are a default.
  5. Carry grams (`aided` only): `rate * segmentHours`; climb tag when `gain_i / segmentHours >= h4.climbNoteGainPerHourM`; day or night tag from the mid arrival against `d1Dark`.
  The cutoff is stored and displayed beside the arrival range; no function compares them. Stops at aid stations are not modelled; they sit inside the elapsed time (R2).
- Copy: `shared/copy/racePlan.ts`, templates `race.plan.*` registered in `TEMPLATES`, each a `tpl` with declared slots (`duration`, `bpm`, `count`, `distance`, `climb`, `date`) and run through the G5 lint (no "behind", "missed", "miss", "short", streaks or badges; targets are a sketch). A number that restates a Param is interpolated from it and tested against it.
- Server: `server/services/racePlan.ts` (`loadRacePlan`, `todayRaceSlot`), `server/services/raceCheckpoints.ts`, `server/routes/race.ts`. Routes thin, `HttpError` for failures, Zod on body and query.
- Web: `web/api/race.ts` (query, and a mutation that invalidates the plan and Today), `web/pages/RacePage.tsx`, `web/components/race/` (`ThirdCard`, `FuelCard`, `CheckpointTable`, `CheckpointSheet` on the stack-aware `Sheet`), `RaceWeekCard` mounted in `slotMounts.tsx`. Units through `formatQuantity` only.
- Seam tests: `racePlanIsolation.test.ts` (nothing outside the race service, route and slot imports `racePlan.ts`; no race template reaches `buildDeliverables`; `workouts.ts` output for a race unchanged), a golden test that the page, the slot summary and the sheet block render the one object, and a determinism test.

## 5. Params, rule text, and what the corpus covers

New Params, group `r1`, rule H14, all grade D with a "Default:" note. None moves a plan, so the `plan:report` digests must not change.

| id | value | grade | rule | citations |
| --- | --- | --- | --- | --- |
| `r1.thirds` | 3 | D | H14 | none (structural) |
| `r1.arrivalRoundMin` | 10 | D | H14 | none (false-precision guard: interior rows rest on grade D weights; a preference) |
| `r1.maxCheckpoints` | 40 | D | H14 | none (input limit) |
| `r1.raceWeekCardDays` | 7 | D | H14 | none |
| `r1.unenteredClimbShare` | 1 | D | H14, L5 | none (the share of the course climb left after the entered rows that is spread over unentered segments by distance; 0 treats them as flat) |

`r1.weightingSpreadPct` is not added: the only paper considered, `dewaal-2021-trail-physiology-sr`, supports no spread of 10%, and a cited id must back the number (CLAUDE.md). The R3 pass may add a spread later.

Unread today: `k6.carbLoadGPerKgDay` and `k6.carbLoadFinalHours` (`params/k-taper.ts`; the race plan is their first reader; `grep` over `shared server web scripts tests` outside `shared/engine/params/`, 2026-11-07, finds no use of either). Read already and read again by the race plan: `h11.belowVt1Share` (C; `explainInputs.ts:2810`, `explainTemplates.ts:911`), `k6.carbLoadMinRaceMin` (C), `k6.easyDaysBefore` and `k6.dayBeforeMaxMin` (D; `micro.ts` `shakeOutFor`), `h11.raceRpe` (D). Read by the race plan, reader status not re-checked: `h8.fluidReferenceMlPerH` (B), `n7.eahStrongerAlertHours` (A), `i8.triggerWbgtC` (D), `i9.warnWbgtC` (C), `d1Dark.*` (D), `l5.gainEquivalentM` (D), `h4.climbNoteGainPerHourM` and the hike Params (C/D), `i11.lateDescentCostIncrease` and `i11.lateDescentEventHours` (C), the `h7` ladder Params.

Rule text (`research/engine-rules.md`, through `research-update`): add **H14 Race plan** (what the page shows, derived on read, each line's rule; a plan is a sketch; the cutoff is shown and never steered to; no downhill credit; fuel never above a tolerated rung; heat is climate normals, not a forecast); amend **K6** with "Read by the engine (added ...)" for the carbohydrate line; amend **H11** (the 85% is also read as a race-plan sentence); amend **H6** (dark hours stated by the D1 clock, no sleep advice); add gaps R1 to R5 to "Top evidence gaps" and a line to "What would change these rules"; bump `PARAMS_VERSION`; add `H14` to `ruleTitles.ts` and `POLICY_ONLY_RULES` until it has an Explain builder.

Corpus coverage (greps of `research/papers` on 2026-11-07, 425 papers):

| Claim | Covered? | Papers or gap |
| --- | --- | --- |
| About 85% of race time at or below VT1 | Yes, C (65 km, n 23) | `fornasiero-2018-ultra-intensity`; the CR-10 mapping is D (`bok-2022-subjective-intensity`) |
| Climb by effort; hike steep grades | Yes, C | `hingrand-2023-power-vs-ascent-speed`, `jeker-2020-vertical-speed-ultra`, `finiel-2026-uphill-walk-run`, `giovanelli-2016-vk-energetics` |
| Vertical speed changes with distance in a 220 km race | Direction, C (27 runners, one race, correlational) | `jeker-2020-vertical-speed-ultra`; slot wording matches that population |
| Descents cost more late; slower finishers lose most downhill time late | Direction, C | `vernillo-2015-fatigue-energy-cost`, `genitrini-2022-downhill-pacing` |
| Heat slows a 161 km race about 8%; pace converges at night | One cohort, C | `parise-2011-161km-pacing-heat`; I6 daytime-only is rule text, low confidence over 6 h |
| Fuel floor, rungs, tolerance, GI symptoms as a reason for dropping out | Yes, A to C | `tiller-2019-issn-ultra-nutrition`, `jeukendrup-2014-cho-intake`, `costa-2017-eigs-sr`, `stuempfle-2015-gi-distress-wser`; no study ties a rung to a race result |
| Thirst-led fluid, EAH card, sodium not preventive | Yes, A/B | `hewbutler-2015-eah-consensus`, `hewbutler-2017-eah-update`, `hoffman-2013-eah-hydration-161km`, `hoffman-2015-sodium-supplementation-eah` |
| 8 to 10 g/kg/day for 24 to 48 h | Thin, C | `bussau-2002-carb-loading-one-day` (8 inactive men, 1 day), `sherman-1981-exercise-diet-glycogen`; none in ultra runners |
| Heat acclimation credit and decay | Yes, A (D for the 40 days) | `racinais-2015-heat-consensus`, `daanen-2018-acclimation-decay` |
| **R1** Pace by third of a 100-mile race; size of the late slowdown | No number | direction only (rows above; `smyth-2018-pacing-start-end` is road pacing); a pass is needed, expected "no study gives a split" |
| **R2** Time stopped at aid stations as a share of elapsed time | None | "aid station" appears in one paper, the EAH review |
| **R3** Flat-equivalent weights for climb in ultra segments, and the error of a share model | D (`l5.gainEquivalentM`) | a pass on trail time models by segment; `ehrstrom-2018-short-trail` and `dewaal-2021-trail-physiology-sr` are short-trail work and a review |
| **R4** Race-day fuel rate against finish or DNF | None | association only (`stuempfle-2015-gi-distress-wser`) |
| **R5** Pre-race and second-night sleep, night pacing | None | `walsh-2021-sleep-athlete-consensus` gives direction without a number; `daniel-2024-217km-sleep-training` is a questionnaire |

R1, R3 and R5 are research passes, deferred; none blocks steps 2 to 4 because v1 states no number from them. Cutoffs need no evidence: they are the runner's own fact.

## 6. ADR 0018 (draft)

**0018. The race plan is derived on read from rules, the prediction, the fuel ladder and the runner's checkpoint table**

Status: Proposed 2026-11-07. Reads "Accepted <date> (#<PR>)" when merged.

Builds on ADR 0005, 0009, 0010, 0011, 0012 and 0014. Adds rule H14 to `research/engine-rules.md`.

*Context.* The race session of an ultra goal gives a heart-rate ceiling and an effort and nothing else. The fuel slot is empty on race day (`FUEL_KINDS.race` is false), `k6.carbLoadGPerKgDay` and `k6.carbLoadFinalHours` have no reader, and the race has no hour-by-hour view (`docs/STATUS.md`, follow-up 29, finding 1). Race effort (H11) was merged on 2026-11-06. Decided 2026-11-06: both effort guidance and splits from a private checkpoint table are available, and the table is optional.

*Decision.* The plan is one pure function of the goal model, the live prediction, the replayed fuel ladder, the zone 1 ceiling, the acclimation credit and the runner's checkpoint rows, evaluated on every read and stored nowhere.
- `racePlanFor` and `splitsFor` in `shared/engine/`; text in `shared/copy/racePlan.ts` under the G5 lint.
- The checkpoint table is the runner's own data in one state model, replaced as a whole.
- Effort is one instruction for the whole race; fuel never exceeds a tolerated rung; splits are "about" ranges scaled from the finish prediction; no downhill credit; the cutoff is shown beside the range and never compared to it or used to steer the target.
- `Goal.supportLevel` `self` drops aid-station wording; aid time (R2) does not apply to it.
- The race is not published to any device or feed.

*Reasons.*
- **Fact:** the forecast, the ladder, the prediction and the rows change without a re-plan (`replan.ts`, ADR 0011), so a stored plan is stale after any of them; ADR 0014 made the same finding for strength.
- **Fact:** `k6.carbLoadGPerKgDay` and `k6.carbLoadFinalHours` have no reader (a search of `shared`, `server`, `web`, `scripts` and `tests` outside `shared/engine/params/`, 2026-11-07, finds none); `h11.belowVt1Share`, `k6.carbLoadMinRaceMin`, `k6.easyDaysBefore` and `k6.dayBeforeMaxMin` are read already (`explainInputs.ts`, `micro.ts`).
- **Fact:** the corpus has no study of pace by third, aid-station time or race-day rung outcomes (section 5), so v1 states no number from them. The ladder counts tolerated runs on non-hot days only (`replayLadder`), so a hot race is outside what any rung showed.
- **Fact:** `ClimateCache` is a state model and `raceWbgtC` comes from it, so the race plan reads no forecast and its ETag needs the data version and the day only.
- **Rule:** ADR 0005 and 0010: rules decide, templates write, no model touches the text.
- **Rule:** G6 and ADR 0011: no rate above a tolerated rung; where rules collide the conservative one wins.
- **Rule:** ADR 0009: athlete data comes through the snapshot or a memo. ADR 0008: a race is not publishable.
- **Rule:** the Disclaimer block of `research/engine-rules.md` section (n): every race plan shows the disclaimer.
- **Rule:** ADR 0012: the offline allowlist is exactly five reads; v1 adds none.
- **Opinion:** one object gives one definition of the race; a cross-surface test holds the page, Today and the sheet to it.
- **Opinion:** a range scaled from the prediction and shown as "about" is less likely to read as a promise than a pace chart, and two plain facts (cutoff, range) leave the comparison to the runner.
- **Preference:** arrival times round outward to 10 minutes; three equal thirds.

*Alternatives.*
- **Store the plan on the goal.** For (Opinion): a feed could read it. Against (Fact): stale after any input change. Against (Rule): ADR 0007's anti-goal of changes the runner cannot see.
- **Effort only, no table.** For (Opinion): no private data, no new model, much smaller. Against (Preference): splits were wanted (decided 2026-11-06); this stays the stop point after step 3.
- **Aid-station table with crew and drop-bag fields.** Against (Fact): the corpus holds nothing on crew or drop-bag content (STATUS follow-up 29 refuted a logistics checklist for want of a source); the table holds name, distance, climb, descent and cutoff only.
- **Minetti cost per segment.** For (Opinion): finer. Against (Fact): needs the grade distribution inside a segment, which the table lacks.
- **Solar module now.** For (Opinion): correct dark hours. Against (Fact): no race time zone is stored.
- **Sixth offline read for the Race page.** For (Opinion): the page is wanted without signal. Against (Rule): the allowlist is five reads (ADR 0012) and the Race page would put private checkpoint names on the device. Deferred to its own amendment.

*Consequences.* A new state model and migration case. Five `r1` Params and a `PARAMS_VERSION` bump with no plan digest change. Rule H14 and gaps R1 to R5. A future watch or feed export of a race must call `racePlanFor`, and ADR 0008 needs an amendment first.

## 7. Risks and arguments against the whole feature

- **Authority.** A page with times and grams reads as a plan to follow. Mitigations: ranges, "about", rounding outward, the disclaimer, "a sketch" on every block, low-certainty labels, no comparison of cutoff and range. Residual: a runner may still chase the early edge; copy cannot remove that.
- **Splits rest on three D-grade choices** (`l5.gainEquivalentM`, the climb spreading `r1.unenteredClimbShare`, no downhill credit) and nothing in the corpus validates them for 100-mile courses; the interior range carries no allowance for that error. It is the weakest part and comes last (step 4), so it can be dropped. No check against the runner's own long runs is built: it would read real history in a public repository and measures training pace, not race pace. If one is wanted later, it reads the database at runtime, prints to the terminal, writes nothing to a committed path and stays outside `check` and CI.
- **The audit's reviewers** (STATUS follow-up 29) called the aid-station part weak. Most of the value (effort, fuel, K6, heat, dark) needs no table and no model, so the smallest honest version is steps 2 and 3.
- **"Effort by thirds" adds little to one sentence.** The three cards repeat one instruction. Their value is the per-third facts (clock window, heat, dark, fuel total). If those read as padding at the step 3 review, collapse to one effort card.
- **Fuel rungs were tolerated on runs of a few hours, on non-hot days,** and the race lasts a day or more (ADR 0011, consequences). A tolerated 60 g/h at hour 2 says little about hour 20. Totals carry the label; the page offers no higher rate.
- **K6 evidence is eight inactive men for one day.** A large carbohydrate increase in race week has comfort costs the corpus does not quantify; the line says "with little running" and that the figure comes from short trials. Against: omit it. For: the Params exist and the rule is C.
- **Heat is counted twice or mislabelled.** The prediction already applies the marathon slope to every hour; the page adds a daytime line from climate normals. The label states both. A daytime-only slope is a separate change that moves the prediction.
- **Private data.** Checkpoint names are the runner's, in the database only; fixtures and tests use synthetic names; validation `details` and logs carry no values (section 3); backups include the table because they copy the file.
- **Time zone and the day.** Clock times are race-local from the start time entered; the countdown uses the server's day (STATUS follow-up 16), which can differ by a day for a race in another zone.
- **Offline staleness.** Today's cached race card can show yesterday's heat line; the offline note already says when the copy was saved.
- **Maintenance cost.** One more state model, route, page, slot and about 40 templates, for a feature used once a year. The tests above are the price of keeping it correct; the stop point after step 3 caps it.

## Appendix: Critique answered

Applied in full in the body: points 1, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14 (the first fix, with the Explain tests added) and 15a, 15b. Applied in part, with the rest rejected:
- Point 5, cut step 4: not cut. Both effort and splits were decided available on 2026-11-06. Step 4 is last and optional, the interior band is "about" with no invented widening, and the climb spreading is now `r1.unenteredClimbShare`. The "widen toward the late edge" option is not taken: no source sizes it (R1), so the late edge is stated in words.
- Point 9, step 6: cut rather than rewritten; section 7 states the constraints for any later version.
- Point 13, dangling audit references: part rejected. Finding 1, the daylight-module refutation and the logistics-checklist refutation are in `docs/STATUS.md` follow-up 29 and are cited there; findings 8, 9, 23 and "the refuters" are inlined or dropped. Open question 8 is dropped; the relayed answers go in the PR comment.
- Point 15c, race purpose string: the default is to leave `sessions.ts:134` unchanged (open question 4), because a reword changes pinned `PlanSession` text and may move oracle digests; the pinning tests are listed.
