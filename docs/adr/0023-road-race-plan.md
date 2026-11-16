# 0023. The road race plan is derived on read for the half marathon and the marathon

Status: Proposed 2026-11-16

Builds on ADR 0005, 0008, 0009, 0010, 0011, 0012 and 0018. Implements owner decision D11
(2026-11-14). Replaces the sentence "Ultra classes only" of ADR 0018 for the half marathon and the
marathon, and changes nothing else in ADR 0018. The research pass for D11 is
`research/topics/road-racing.md` (19 papers, #741). This PR holds the decision only: no engine,
server or web code, and no road rule text (see Consequences).

## Context

ADR 0018 gives an ultra goal a race plan and leaves every shorter goal with its race session. Owner
decision D11 (2026-11-14) asks for a full road race plan covering pacing, fuel and heat, sequenced
after the June-critical engine work, with a research pass first and a change to ADR 0018. RT1 (#738)
already reworded the race purpose of a non-ultra goal to "Race day: run by effort." so that it
promises no plan. The research pass ran on 2026-11-16 and merged as #741. This ADR records what it
found and what the plan may therefore say.

## Decision

The owner's answers of 2026-11-16 settle the scope.

- **Classes (Q1).** A goal in the `half` or `marathon` distance class gets the full road plan. A
  `10k` goal gets the time, pace and heat blocks only. A `5k` goal is unchanged, and so is an
  ultra's plan. Entered B or C races (`entered-race`) get no plan, as today.
- **Course surface (Q2).** A trail or mixed half or marathon gets the plan without the average pace
  and the first-half lines.
- **Plan.** `roadRacePlanFor` (planned in `shared/engine/racePlanRoad.ts`) is a pure function of the
  goal model, the live prediction, the same prediction without race heat from one helper, the
  runner's critical speed (A6), the replayed fuel ladder, body mass and the acclimation credit. It is
  evaluated on every read, memoised by data version and day (ADR 0009), and stored nowhere. Text is
  `shared/copy` templates under the G5 lint. No new Param, Prisma model, migration or route.
- **Heat (Q3).** Heat is read from the prediction, never applied twice. The line reads "about N min
  of this range is the usual weather for the date", with N the difference between the prediction and
  the one without race heat. The marathon adds the I5 finding stated for its population; a half adds
  none. The climate-normal line above `i9.warnWbgtC` uses its own template, since the engine's
  message says "forecast".
- **First half (Q10).** For a marathon on a road or track course whose expected time is at least
  `l2.csFractionShortMin`, with a critical speed that is not from a widened window, the plan states
  the population finding of `k6.firstHalfWarningCsFraction` with the runner's figure, worded as
  where slowing was more common and never as a limit or a pace to run. It shows for every marathon
  that passes those gates, with no margin gate (a margin would need a Param with no paper).
- **Fuel.** The rate is the tolerated rung (`raceFuelFor`), stated only for an expected time of at
  least `h7.logMinDurationMin` (120 min). A half under 2 h gets no rate and one fact line (Q5). The
  FT1 hold facts stay on the Fuel lab, and the plan links to it (Q9). The H8 fluid line and the EAH
  card show for every road race. No fuel timing.
- **Race week.** The K6 block of the ultra plan, for an expected duration of
  `k6.carbLoadMinRaceMin` or more.
- **No printable card (Q4).** The plan is a page, kept offline as part of the sixth read (ADR 0012
  addendum of 2026-11-16).
- **My paces (Q7).** My paces stays weather-free (ADR 0020). The Race page says what its range holds.
- **Wire shape.** The plan travels in new optional fields, `RacePlanView.road` and
  `TodaySlots.roadRace`. For a road goal the server keeps answering `plan: null`,
  `reason: 'not-ultra'` and `slots.race: null`, so a shell built before this change shows what it
  shows today and never meets a shape it does not know.
- **Not in the plan.** Pace per kilometre or split; late slowing; a rate above a tolerated rung;
  fuel timing; a rate for a half under 2 h; the FT1 hold facts; a warm-up or pre-cooling; a heart
  rate or RPE; a finish target; I5's top-quartile branch; any I5 line for a half.
- **Not published.** The plan reaches no watch file, intervals.icu event, calendar feed or brief
  (ADR 0008, unamended).

ADR 0018 moves to Accepted in the same PR, and its Decision line "Ultra classes only" gains a pointer
to this ADR.

## Reasons

- **Fact:** the prediction already holds the race heat (`predictFromState`, `shared/engine/predict.ts`
  applies the heat penalty whenever `wbgtC` is set and a marathon-equivalent ability exists). A second
  adjustment would count it twice. Read from the code on 2026-11-16.
- **Fact:** `k6.firstHalfWarningCsFraction` is a grade C Param with two cited papers and no reader.
  Searched in `shared`, `server`, `web`, `scripts` and `tests` on 2026-11-16.
- **Fact:** the finding behind it is one study: more than 25,000 recreational marathoners who ran the
  first half above 94% of critical speed were more likely to slow by more than 25% in the second half
  [smyth-2020-cs-training-data]. Records added by the pass show the half marathon is paced more evenly
  than the marathon (average change of speed across five segments 3.36 to 3.60% against 4.12 to 5.46%
  [cuk-2020-sex-pacing-half-marathon-marathon]) and that typical slowing is about 3 to 4% at 10 km
  against 10 to 13% in the marathon [cuk-2021-pacing-10km-marathon]. That limits the line to the
  marathon. Read from the stored records on 2026-11-16.
- **Fact:** the pace sentence rests on observational finish lists: a first or last stretch run too
  fast went with a slower finish in 1.7 million recreational marathoners [smyth-2018-pacing-start-end];
  marathoners slow in the second half at every level [santos-lozano-2014-nyc-marathon-pacing]. Grade
  C. None compares pacing shapes by assignment, so no shape is recommended.
- **Fact:** no source in the corpus names a carbohydrate rate for the 1 to 2 h band. The nearest are a
  null result at about 74 min [burke-2005-half-marathon-gel], a crossover at about 110 min with no
  no-carbohydrate arm and no symptom outcome [lee-2014-half-marathon-fluid-cho], a systematic review
  with no statement between about 1 h and 2 h [stellingwerff-2014-cho-supplementation-durations], and
  a grade D narrative review that gives 30 to 60 g/h for events longer than about 1 h without a stated
  lower bound [burke-2011-cho-training-competition]. Read from the records on 2026-11-16.
- **Fact:** the corpus holds one half marathon heat source, directional with no slope
  [hodgson-2022-great-north-run-heat-pollution], and none for 10 km. No half-specific or 10 km
  time-per-degree figure is stated. Read from the records on 2026-11-16.
- **Fact:** the two pacing-in-heat papers report different contrasts and do not test the same one.
  Ely 2008 (three Japanese women's championship marathons, elite to sub-elite, 5 to 21 C air) found
  warm air slowed the winners and the 25th place more, late in the race, while the 50th and 100th
  places lost their time to a slower pace from the start [ely-2008-pacing-temperature]. Trubee 2014
  reports heat as an independent element of pacing in two Chicago marathons, with no direction or size
  in the abstract [trubee-2014-heat-sex-pacing-marathon]. Rule I5 is neither confirmed nor contradicted.
- **Fact:** Roberts 2010 gives no support for the I9 warning at WBGT 25 C and points lower for a
  marathon: unsuccessful starts rose rapidly from a start WBGT of 13 C in one race, mass-casualty events
  or cancellation followed above 21 C in several, and the do-not-start WBGT was 20.5 C for one race on
  its model (unacclimatised northern-latitude fields; outcomes are medical encounters, not finishing
  time) [roberts-2010-do-not-start-wbgt-marathon]. `i9.warnWbgtC` stays 25 here (the plan changes no
  Param), and the engine PR must say so when it words the road heat line.
- **Fact:** an ultra-only shell looks the empty text up by reason and renders `plan` and `slots.race`
  as ultra objects (`shared/copy/racePlan.ts`, `RaceSessionSection.tsx`), so a road object in those
  fields, or a new reason, would throw in a shell kept on a phone, and the Today slot would take the
  page to its error boundary. Read from the code on 2026-11-16.
- **Rule:** ADR 0005 and 0010: rules decide and templates write; no model touches the text.
- **Rule:** G6 and ADR 0011: no rate above a tolerated rung; the more conservative rule wins.
- **Rule:** G5: a target is a sketch, never a minimum; no "behind" or "missed".
- **Rule:** ADR 0008: a race is not publishable.
- **Rule:** rule H7, FT1 amendment (`research/engine-rules.md`): the hold facts are shown on the Fuel
  lab only, not in the race plan.
- **Rule:** a number in `shared/engine/` is a `Param` with a grade, a rule id and cited papers; a
  grade D default needs a note. This plan adds none.
- **Opinion:** a separate plan type keeps each plan's fields meaningful; a `RacePlan` with half its
  fields null for road invites rendering bugs on both pages.
- **Opinion:** I5's mid-pack reading (a uniformly slower range) for every runner, with no
  top-quartile branch. The app cannot place a runner in a field, and the paper's top quartile is an
  elite women's field. For a marathoner of 150 min or more the first-half line already speaks to the
  first half.
- **Opinion:** the first-half line is useful even where the figure is far from the expected pace.
  Against: for a slow runner it adds little. The wording names where slowing was more common and asks
  for nothing.
- **Preference:** the road page rounds as the Today countdown does (whole minutes under 6 h), not to a
  coarser step.

## Alternatives

- **A goal-class switch inside `racePlanFor`.** For (Opinion): one type. Against (Fact): `RacePlan`
  is ultra-shaped (effort, thirds, climbing, dark hours, rehearsal, splits) and `racePlanFor` throws
  `RangeError` for a non-ultra by contract.
- **A `kind` union in `RacePlanView.plan` and `TodaySlots.race`.** Against (Fact): an ultra-only
  shell throws on it (see the last Fact above).
- **A new `RacePlanReason` for road.** Against (Fact): the empty text is looked up by reason, so a
  reason a kept shell does not know has no template.
- **The road plan as an addendum to ADR 0018.** For (Preference): fewer files, closer to how R1, E
  and RC1 were recorded. Against (Opinion): the road plan has its own evidence, alternatives and wire
  fields, and an addendum would make ADR 0018 the record of two plans.
- **A km-mark or split table.** Against (Fact): no study in the corpus gives a road split pattern or
  a best shape; a uniform table is a pace chart under another name.
- **A late-fade or negative-split Param.** Against (Rule): no paper, so no Param.
- **A rate for a half under 2 h from the ultra floor.** Against (Fact): that floor comes from an ultra
  population [tiller-2019-issn-ultra-nutrition], and no road source supports the band (above).
- **The FT1 hold facts on the road fuel block.** For (Opinion): for a 3 to 5 h marathon, how long the
  rate held is the most relevant fuel fact. Against (Rule): FT1 scopes them to the Fuel lab. Declined
  for v1 by the owner (Q9).
- **Hiding the first-half line when the figure is far from the expected pace.** Against (Rule): needs
  a grade D Param with no paper.
- **The H11 heart-rate ceiling and RPE for road.** Against (Fact): H11 rests on a 65 km trail study
  at an effort far below marathon effort, and nothing in the corpus gives a road race heart rate.
- **A structured heat field on `Prediction`, or parsing `prediction.conditions`.** Against (Fact): a
  new field moves every digest of `tests/unit/engine/history-oracle.ts`; the conditions are free text.
- **A road print card or a km-mark card.** Declined for v1 by the owner (Q4); the page is kept offline.
- **A 10 km plan with fuel and race week.** Against (Fact): K6 (90 min) and the H7 ladder (120 min)
  never apply under their gates, and no 10 km source gives a heat cost or a split pattern.
- **Heat on My paces.** Declined by the owner (Q7): My paces is a flat, cool reference by design.

## Consequences

- **No code and no road rule text in this PR.** `research/engine-rules.md` describes what the engine
  does, and the road plan does not exist yet, so the road rule (H15) and the K6, I5 and H7 additions
  land with the engine PR (PR 2), worded from this ADR. The one rules edit here is an evidence note on
  I9 (Roberts 2010), which is true of the engine today.
- No new Param, and no Param value, grade or rule changes. `PARAMS_VERSION` is unchanged. No digest
  of the history oracle moves.
- `reason: 'not-ultra'` stays on the wire for every goal that is not an ultra, the road ones included.
  Its text is reworded with the server switch, to say the plan covers the half marathon, the marathon
  and ultras.
- A future watch or feed export of the road plan needs ADR 0008 amended first.
- The rollout is four PRs: this docs PR, the engine and copy (not wired), the web, and the server
  switch. Each is mergeable alone; reverting the last removes the feature from every surface.
- The owner's goal race is not in the half or marathon class, so the road path is verified by
  synthetic fixtures and e2e only. No check on the live copy can confirm it.

## What the evidence does not support

Stated so the plan's words stay inside them.

- A best pacing shape, a pace per kilometre or a late-fade size, for the marathon or the half. The
  records are finish lists with no effort measure and no assignment of shapes.
- A first-half threshold other than the 94% critical speed figure, a second paper repeating it, or any
  such threshold for the half.
- A half marathon time cost per degree or per WBGT, and any 10 km heat time cost.
- A carbohydrate rate for the 1 to 2 h band; a dose-response in the 2 to 3 h band; a rate for a 3 to
  5 h marathon from a road trial; fuel timing in a road marathon; gut training in road runners.
- A fluid volume for a road marathon that is safe and optimal for a given runner. The 2% body-mass
  limit of the older ACSM stand is supported by neither road result in the corpus.
- A road race heart rate or RPE, a warm-up, and pre-cooling.
- The 25 C of `i9.warnWbgtC` for a marathon (Roberts 2010 points lower). Unresolved here; the
  engine PR decides how the road heat line is worded.
- Burke 2011 gives 30 to 60 g/h for events of longer duration after its "about 1 h" statement; the
  abstract states no lower bound, and the review is grade D.
