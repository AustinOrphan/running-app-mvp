# 0018. The race plan is derived on read from rules, the prediction, the fuel ladder and the runner's checkpoint table

Status: Proposed 2026-11-07

Builds on ADR 0005, 0009, 0010, 0011, 0012 and 0014. Adds rule H14 to `research/engine-rules.md` and
amends H6, H11 and K6 there. The design is `docs/superpowers/specs/2026-11-07-race-plan-design.md`;
steps 1 to 3 of its plan were built first (the effort, fuel, heat, dark-hours and race-week plan, with
the Race page, the More row, the Today slot and the race-day block of the session sheet). Step 4 (the
checkpoint table and the arrival ranges, task RP3) is built on top of them. Step 5 (the Race page
offline) stays in the design.

## Context

The race session of an ultra goal gives a heart-rate ceiling and an effort and nothing else. The fuel
slot is empty on race day (`FUEL_KINDS.race` is false), `k6.carbLoadGPerKgDay` and
`k6.carbLoadFinalHours` have no reader, and the race has no hour-by-hour view (`docs/STATUS.md`,
follow-up 29, finding 1). Race effort (H11) was merged on 2026-11-06. Decided 2026-11-06: both effort
guidance and splits from a private checkpoint table are available, and the table is optional.

## Decision

The plan is one pure function of the goal model, the live prediction, the replayed fuel ladder, the
zone 1 ceiling, the acclimation credit and, from step 4, the runner's checkpoint rows, evaluated on
every read and stored nowhere.

- `racePlanFor` in `shared/engine/racePlan.ts` and `raceFuelFor` in `shared/engine/fuel.ts`; text in
  `shared/copy/racePlan.ts` under the G5 lint. `splitsFor` in `shared/engine/raceSplits.ts` (step 4)
  returns the arrival ranges of the runner's rows and the finish.
- The checkpoint table (step 4) is the runner's own data in one state model, `RaceCheckpoint`,
  replaced as a whole by `PUT /api/race/checkpoints` (a name, a distance, and optionally the climb and
  descent since the previous row and a cutoff in elapsed seconds; at most `r1.maxCheckpoints` rows).
  The plan's memo reads the rows, so a save drops it. The rows are private: they appear in no fixture
  made from real data, no log and nowhere in the repository, and a refused save names a row index and
  a field and never a value.
- Effort is one instruction for the whole race; fuel never exceeds a tolerated rung; heat is climate
  normals for the race date and does not change the prediction; the arrival ranges (step 4) are
  "about" ranges scaled from the finish prediction by each row's share of the course, with no downhill
  credit and no widening of an interior row, and the finish row is the expected range itself; the
  cutoff is shown beside the range as the runner's own fact and never compared to it or used to steer
  the target.
- A segment weighs its distance plus `l5.gainEquivalentM` metres of flat per metre of climb, or, when the
  runner's own climbing moved the prediction (rule L5, 2026-11-08), the figure that prediction used
  (`Prediction.climb.usedM`), and the plan says so. A segment
  with no climb of its own takes `r1.unenteredClimbShare` of the course climb left after the entered
  rows, spread by distance (nothing when the goal holds no course climb).
- Grams to carry per segment are shown for an `aided` race only, as an estimate (the rate of the fuel
  line over the time of the segment) with the few-hours label; a `self` race calls the rows course
  points and shows no aid wording and no grams per segment.
- Ultra classes only (every class above the marathon, as H11). Shorter goals keep today's race session.
- `Goal.supportLevel` `self` drops aid-station wording; aid time (R2) does not apply to it.
- The race is not published to any device or feed.
- The data version and the day are the plan's change key. The plan reads no forecast, so its ETag has
  no forecast stamp.

## Reasons

- **Fact:** the forecast, the ladder, the prediction and the rows change without a re-plan (`replan.ts`,
  ADR 0011), so a stored plan is stale after any of them; ADR 0014 made the same finding for strength.
- **Fact:** `k6.carbLoadGPerKgDay` and `k6.carbLoadFinalHours` have no reader (a search of `shared`,
  `server`, `web`, `scripts` and `tests` outside `shared/engine/params/`, 2026-11-07, finds none);
  `h11.belowVt1Share`, `k6.carbLoadMinRaceMin`, `k6.easyDaysBefore` and `k6.dayBeforeMaxMin` are read
  already (`explainInputs.ts`, `micro.ts`).
- **Fact:** the corpus has no study of pace by third, aid-station time or race-day rung outcomes
  (design, section 5), so no number from them is stated. The ladder counts tolerated runs on non-hot
  days only (`replayLadder`), so a hot race is outside what any rung showed.
- **Fact:** `ClimateCache` is a state model and `raceWbgtC` comes from it, so the race plan reads no
  forecast and its ETag needs the data version and the day only.
- **Fact:** the acclimation credit is already in the snapshot (`AthleteState.heatAcclimation`,
  `athlete.ts`), computed from an exposure predicate that was written out twice (`athlete.ts` and the I8 Explain
  builder, read 2026-11-07); the plan reads the snapshot's credit and the predicate is one function in
  `heat.ts`.
- **Rule:** ADR 0005 and 0010: rules decide, templates write, no model touches the text.
- **Rule:** G6 and ADR 0011: no rate above a tolerated rung; where rules collide the conservative one
  wins.
- **Rule:** ADR 0009: athlete data comes through the snapshot or a memo. ADR 0008: a race is not
  publishable.
- **Rule:** the Disclaimer block of `research/engine-rules.md` section (n): every race plan shows the
  disclaimer.
- **Rule:** ADR 0012: the offline allowlist is exactly five reads; steps 1 to 3 add none. Today's
  payload is cached already and carries the race-week card and the race-day block.
- **Opinion:** a Param read by nothing is a finding of the audit (follow-up 29), so the Params of step 4
  (`r1.maxCheckpoints`, `r1.unenteredClimbShare`) are added with the code that reads them.
- **Fact:** the plan's memo reads the rows and the memo key is the data version (ADR 0009), so
  `RaceCheckpoint` is in `STATE_MODELS` (`server/dataVersion.ts`) and a save drops the memoised plan;
  `tests/unit/server/modelClassification.test.ts` holds the list to the schema. The rows are written
  and read in `server/services/raceCheckpoints.ts` only (`racePlanIsolation.test.ts`).
- **Fact:** the corpus holds no study of segment times in an ultra: `l5.gainEquivalentM` is grade D and
  rests on short-trail work and a review (gap R3), so the interior rows carry no widening that a number
  could claim, and the page says in words that the weights are defaults and that speed tends to fall
  late in a long race (gap R1; direction only).
- **Fact:** validation messages are fixed text and the route logs no body (`pino-http` logs the request
  line); `tests/api/raceCheckpoints.test.ts` sends rows whose values it then searches for in the
  response and in every log line of a rejected and an accepted save (2026-11-07).
- **Fact:** the backup copies the whole SQLite file (`server/services/backup.ts`), so the table is
  included with no code, and no export route covered goals (the only export was the activities CSV), so
  no export work was needed (read 2026-11-07). Superseded 2026-11-08 (task X1): `GET /api/export`
  (`server/services/exportArchive.ts`) now writes `race-checkpoints.json` for the runner's own
  download; it is the one reader of the table besides the checkpoint service
  (`racePlanIsolation.test.ts`), and the plan itself stays derived and out of the archive.
- **Opinion:** one object gives one definition of the race; a cross-surface test holds the page, Today
  and the sheet to it.
- **Opinion:** a range scaled from the prediction and shown as "about" is less likely to read as a
  promise than a pace chart, and two plain facts (cutoff, range) leave the comparison to the runner.
- **Preference:** arrival times round outward to 10 minutes; three equal thirds.

## Alternatives

- **Store the plan on the goal.** For (Opinion): a feed could read it. Against (Fact): stale after any
  input change. Against (Rule): ADR 0007's anti-goal of changes the runner cannot see.
- **Effort only, no table.** For (Opinion): no private data, no new model, much smaller. Against
  (Preference): splits were wanted (decided 2026-11-06); this is the stop point after step 3.
- **Aid-station table with crew and drop-bag fields.** Against (Fact): the corpus holds nothing on crew
  or drop-bag content (STATUS follow-up 29 refuted a logistics checklist for want of a source); the
  table holds name, distance, climb, descent and cutoff only.
- **Minetti cost per segment.** For (Opinion): finer. Against (Fact): needs the grade distribution
  inside a segment, which the table lacks.
- **Solar module now.** For (Opinion): correct dark hours. Against (Fact): no race time zone is
  stored; the dark hours use the D1 clock (`d1Dark`, 06:00 to 20:00), labelled as a default.
- **Widen each interior row toward the late edge.** For (Opinion): errors accumulate late in a race.
  Against (Fact): no study sizes the error of where along the course the time falls (R3) or the late
  slowdown (R1), and a number with no source reads as more certain than it is; the words say it.
- **Check the weights against the runner's own long runs.** Against (Rule): it would read real history
  in a public repository, and it measures training pace, not race pace (design, section 7).
- **Sixth offline read for the Race page.** For (Opinion): the page is wanted without signal. Against
  (Rule): the allowlist is five reads (ADR 0012) and the Race page would put weight-derived grams and
  later checkpoint names on the device. Deferred to its own amendment.

## Consequences

Five `r1` Params (grade D; three with steps 2 and 3, two with step 4) and a `PARAMS_VERSION` bump
with no plan digest change. Rule H14, amended H6, H11 and K6, and gaps R1 to R5. A future watch or feed
export of a race must call `racePlanFor`, and ADR 0008 needs an amendment first. Step 4 adds a state
model, `RaceCheckpoint`, with its migration and its migration case, two routes under `requireAuth`, a
table and an editor sheet on the Race page, and a note in the H14 rule text. The Race page and the
editor need a connection (step 5 is not built).

## Addendum: rehearsal count (task R1, 2026-11-07)

The plan carries `rehearsal` (`rehearsalFor`, `shared/engine/rehearsal.ts`): the night runs and the
downhill time in the runs of the last `r1.rehearsalWindowWeeks` weeks, beside the ask of H6 and H5.
It is read-only and derived like the rest of the plan.

- **Data.** The runs come from `context.activities` (ADR 0009) inside `buildRacePlan`, so the `race.plan`
  memo holds the count and no new query of the history window exists. The change key is unchanged: a
  new run raises the data version.
- **Sun.** `shared/domain/sun.ts` (`sunAltitudeDeg`, `darkMinutesOf`) is a NOAA approximation from a
  UTC instant and a place, so no time zone is needed. It places the runs only. The race's own dark
  hours still use the D1 clock (**Fact:** the race's time zone is still not stored), so the "Solar
  module now" alternative above stays declined for the race and is taken for the rehearsal, where
  the instant and the home place are known.
- **Place.** The run's own start point first, so a run away from home sits under its own sun; the
  home place of the profile for a run with no coordinates; a run with neither, or with no start
  instant, is counted as unplaced and said so, never as day. The sun is sampled over the elapsed span
  and the dark minutes are scaled by moving over elapsed time.
- **Words.** Plain counts, no target, no comparison with the ask, no colour (G5). Six grade D `r1`
  Params (window, dark altitude, minimum dark minutes, long run, descent band, sustained descent),
  `PARAMS_VERSION` raised, no plan digest change.
- **Not elsewhere.** The block is on the Race page only. It is not in the Today summary, the race card,
  the watch files, the feed or the brief (`racePlanIsolation.test.ts`).
