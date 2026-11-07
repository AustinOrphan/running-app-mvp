# 0018. The race plan is derived on read from rules, the prediction, the fuel ladder and the runner's checkpoint table

Status: Proposed 2026-11-07

Builds on ADR 0005, 0009, 0010, 0011, 0012 and 0014. Adds rule H14 to `research/engine-rules.md` and
amends H6, H11 and K6 there. The design is `docs/superpowers/specs/2026-11-07-race-plan-design.md`;
steps 1 to 3 of its plan are built first (the effort, fuel, heat, dark-hours and race-week plan, with
the Race page, the More row, the Today slot and the race-day block of the session sheet). Step 4 (the
checkpoint table and splits) and step 5 (the Race page offline) stay in the design, and the decision
below about the table holds when step 4 is built.

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
  `shared/copy/racePlan.ts` under the G5 lint. `splitsFor` in `shared/engine/raceSplits.ts` follows in
  step 4.
- The checkpoint table (step 4) is the runner's own data in one state model, replaced as a whole.
- Effort is one instruction for the whole race; fuel never exceeds a tolerated rung; heat is climate
  normals for the race date and does not change the prediction; splits (step 4) are "about" ranges
  scaled from the finish prediction with no downhill credit; the cutoff is shown beside the range and
  never compared to it or used to steer the target.
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
- **Sixth offline read for the Race page.** For (Opinion): the page is wanted without signal. Against
  (Rule): the allowlist is five reads (ADR 0012) and the Race page would put weight-derived grams and
  later checkpoint names on the device. Deferred to its own amendment.

## Consequences

Three `r1` Params (grade D) and a `PARAMS_VERSION` bump with no plan digest change. Rule H14, amended
H6, H11 and K6, and gaps R1 to R5. A future watch or feed export of a race must call `racePlanFor`,
and ADR 0008 needs an amendment first. Step 4 adds a state model, a migration case and two Params.
