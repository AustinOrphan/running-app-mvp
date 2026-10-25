# Load progression from the runner's history — proposal

Status: Proposed 2026-10-24; owner decisions recorded 2026-10-24 (section 7). This document changes
no code, no Param and no rule text. It asks the questions in section 6, records the answers in
section 7 and lists the tasks in section 8. Where an answer changed the proposal, the body says so
and names the question. Baseline: `main` at `bfb6c9f2` (`PARAMS_VERSION` `2026-10-23.3`).

Written for a report of 2026-10-24: for a runner with about a year of running, a strong recent block
and sparse recent weeks, the plan starts low and ramps slowly, and the runner can carry more load
than the plan prescribes. The owner asked that the answer come from the literature and the runner's
own history, "not necessarily start from scratch". The report's figures are not repeated here; the
repository holds no personal data, so every number below comes from a synthetic runner (appendix A)
run through the engine on the baseline commit.

## 1. Summary

**Finding 1: two different limits hold the plan back, and only one of them is the weekly ramp.** The
weekly total is held by the start level, the E6 floor and a 10% soft step (grade D). The long run is
held by the session spike guard G-1 (grade B), which reads the longest run of the last 30 days and
forgets a summer block after a month. On the synthetic runner, with weekly time not limiting at all,
the first 150-minute long run comes in week 20; the plan as generated reaches it in week 29.

**Finding 2: most of that gap is one rule.** The 3 × 30 start (instead of 3 × 20) needs two years of
running (E6 path 2, `macro.ts` `startPath`). The synthetic runner has one year, so week 1 is 60
minutes, not 90. With the 3 × 30 start alone, the long run reaches 150 minutes in week 22 and the
weekly total reaches the old summer level in week 18 instead of 25. Raising the weekly step to 14%
as well brings the weekly total to week 13 and moves the long run by none.

**Finding 3: the evidence does not support more than this.** The corpus has no running study of a
return to an earlier peak after a short reduction. The detraining papers describe complete cessation
and show endurance fitness falling slowly and plateauing; the few tissue papers that can be found
(not yet in the corpus) show tendon stiffness falling faster than fitness under complete unloading,
in young non-runners. The session guard's cohort did not separate returners from other runners (the
corpus says its window "cannot tell a first-time build from a return after a break"). Every number a
history credit would need is therefore a grade D default.

**Proposal.** Four parts, all leaving every existing guard in place. Parts (a) to (c) act only at
the standard and upper positions; part (d) acts only when the runner raises a week by hand.

- (a) A **history block** (the steadiest four weeks of the last 12) read from data the engine
  already holds. It does two things: it lets a runner with a year of running and a demonstrated
  block take the 3 × 30 start, and it sets a **rebuild ceiling** `R`, a fraction of the block, below
  which the weekly step may be larger than 10%.
- (b) A **load setting** with three positions: steady (today's engine, byte for byte), standard (12%
  a week while below `R`, `R` = 70% of the block) and upper band (the step at which two weeks reach
  the existing 30% ceiling, 14.0%, while below `R`, `R` = 85% of the block). It never touches G-1,
  the 30% hard ceiling over two weeks, the tightened profiles or the post-race and disruption rules.
- (c) A **response to weeks run above plan** (standard and upper only): the baseline of the next
  week is the higher of the planned minutes and the trailing four-week mean of the minutes actually
  run, and the position's step applies to it (section 4.7). Added by the owner's answer to
  question 5.
- (d) A **raised week target survives a re-plan** when it is within the limits the engine already
  enforces, and the revision shows any clipping (section 4.8). Added by the owner's answer to
  question 9.

**Recommendation and push-back.** Build in two stages. Stage 1 is the history block and the 3 × 30
start (task L2); it buys seven of the nine recoverable weeks on the long run. Stage 2 is the rebuild
ceiling and the setting (tasks L3 to L5; the response and the raised target are L3b and L3c). The
default stays **steady**, because rule G6 and the
research README ask for stronger evidence before a change toward more load, and this proposal has
none above grade D. G-1 stays as it is: loosening the best-evidenced guard in the engine on the
strength of a "year of history" is the one step this proposal recommends against (section 4.9).
Section 6 lists the questions. Section 7 records the owner's answers: stages 1 and 2 are adopted,
steady stays the default, G-1 stays as it is, and the owner overruled the proposal's default (no)
on two points, the response to weeks run above plan (c) and raised week targets (d).

## 2. What the engine does now

Every statement below was checked against the code at the baseline commit; the file and function are
named so that it can be checked again. Numbers in parentheses are `Param` values.

### 2.1 How the first weeks are sized

1. **The start level** (`limits.ts` `startLevelMin`) is the higher of the typical week and the
   recent level. The typical week (`athlete.ts` `estimateState`) is the median of the last four
   complete weeks that hold a run, taken from the 16 weeks the state shows (`WEEKS_SHOWN`). The
   recent level (`athlete.ts` `recentLevel`) is the lesser of the last two complete weeks, and 0
   unless both hold a run. Weeks without a run are skipped, so a sparse stretch is the level;
   nothing older enters.
2. **A start path** (`macro.ts` `startPath`) applies when the start level is under
   `restartFloor.sessions × restartFloor.sessionMin` = 3 × 20 = 60 minutes. A runner with a
   continuous run of 20 minutes or more in the last 30 days takes the **3 × N floor**, N being that
   run rounded down to 5 minutes and held between 20 and 30 (`restartFloor.sessionStepMin`,
   `sessionMaxMin`), and never above what G-1 leaves a session. N above 20 (the "lift") needs
   `yearsRunning >= a5.trainedMinYears` (2), an empty `noviceFlags` (age 45 or over, BMI above 30,
   an injury in the last 12 months, no running history) and no tightened profile (`startPath`:
   `experienced`, `lifts`). A runner with fewer than two years takes N = 20, however long the recent
   runs were. `yearsRunning` is `yearOf(today) - runningSinceYear` (`athlete.ts`), a calendar-year
   difference, so "1" covers anything from about 10 to about 22 months. This is owner decision 1 of
   the engine design (section 10, "the 30-minute lift needs 2 years of running and no soft flag").
3. **The floor week is a baseline.** It is exempt from G-2 up to its minutes and every later week is
   measured from it (`limits.ts` `rampLimits`, `RampContext.floor`). Ladder and injury-return weeks
   have their own steps (`startWeeks.ts`); a run-walk ladder is for true novices and for returners
   whose reference run is under 20 minutes.
4. **A start level at or above 60 minutes** has no start path: week 1 is the start level and the
   ramp applies from there (`macro.ts` `planWeeks`, `start`).

### 2.2 What the weekly ramp allows

- **Baseline.** A week is measured from the highest of the two preceding loading weeks, as run
  (`limits.ts` `highestBaseline`, `g2.baselineWeeks` = 2). Recovery, taper and the partial current
  week are skipped. A zero week gives no baseline and the typical week stands in.
- **Soft step** (`g2.rampSoft` = 10%, grade D): `plan = min(soft, allowed)`, so outside start-path
  weeks the generator plans at most the soft step (`rampLimits` `plan`). A week above it carries a
  warning (`checklist.ts` `progression`).
- **Hard ceiling** (`g2.rampCeilingTwoWeeks` = 30% over two weeks, grade C): measured against the
  highest of the weeks that began two and three weeks before it. A week above it is cut (`guards.ts`
  `rampWeek`) and fails the checklist's progression item.
- **Cadence.** A recovery week every fourth week (`e3.defaultCycleWorkWeeks` = 3), 25% lower,
  counted back from the race, so the alignment depends on the race date. Novices and runners under
  two runs a week take 2:1 (`macro.ts` `cycleShortReason`).
- **A tightened profile** (recent injury 5 to 7%, prior bone stress injury 5%, two or more BSI
  factors half the soft step) lowers the soft step (`limits.ts` `weeklyRamp`, `tightRamp`).
- **Compounding.** From 60 minutes, 10% steps and one recovery week in four give 285 minutes in week
  25 (table 1).

### 2.3 What holds the long run

G-1 (`limits.ts` `runCaps`, `referenceBetween`) caps a planned run at 1.10 times the longest
completed run of the 30 days before it, and a hard limit in every start path. The generator also
counts its own planned long runs as completed ones (`macro.ts` `record`), so after the 30-day window
has passed the last real run, each long run is at most 1.10 times the longest long run planned in
the last 30 days. A recovery week does not reset the reference. With a three-weeks-plus-one cycle
the long run therefore grows about 33% per four weeks at best. A window with no run at all has no
G-1 limit (`runCaps` returns infinity), and the J7 fraction of the 90-day longest run stands in
instead (`macro.ts` `startPath`, E6 paths 3 and 4).

Reason (G-1 evidence): the rule rests on one cohort of 5205 runners; sessions more than 10% above
the longest run of the prior 30 days carried HRR 1.64 (10 to 30%), 1.52 (30 to 100%) and 2.28 (over
100%) [frandsen-2025-session-spike]. The corpus states that "the 30-day window cannot tell a
first-time build from a return after a break" (`research/topics/injury-load.md`).

### 2.4 How a gap triggers the floor, the ladder or the J7 restart

- **A layoff is days since the last run** (`athlete.ts` `layoffDays`). J7 applies at 7 days or more
  (`j7.tier1Days`): `afterBreak` (`adapt.ts`) replaces the typical week and the recent level by the
  lesser of themselves and `typicalWeekMin × restartFraction(layoffDays)` (`disruption.ts`: 100%
  under 7 days, 90% to 14, 75% to 28, 50% beyond). The checklist's `break-restart` item holds the
  first week to that restart plus one step (`checklist.ts` `breakRestartItem`).
- **Sparse weeks are not a layoff.** A runner who runs once a week never reaches 7 days, so J7 does
  not apply, `afterBreak` returns the state unchanged, and the sparse weeks themselves become the
  typical week and the ramp baseline. This is the reported situation.
- **The pre-break week is a proxy.** J7 is worded as a fraction of "the pre-break week"; the code
  uses the typical week, the median of the last four weeks with a run. A runner who tapered into a
  break has sparse lead-in weeks in that median: on the synthetic layoff case (S5) the typical week
  is 178 minutes against a block of 280, so the 50% restart is 89 minutes, 32% of the block.
- **True novices and those with a short reference run** enter the ladder; a recent-injury flag
  enters the injury-return ladder (E6 paths 1, 3 and 5). History does not change those paths.

### 2.5 How an overshot or a short week feeds the next

- **An overshot week lifts nothing.** A loading week of the plan whose logged minutes pass its
  target takes them as its target (`index.ts` `takenAsRun`, flags `overshoot` and `planned-<n>`),
  and "the weeks after it are drawn from the planned minutes, not from the minutes run" (`limits.ts`
  `plannedMinOf`, `macro.ts` `replanAnchor`, rule G-2, PR #545). Nothing is made up and nothing is
  lifted. A new plan, by contrast, starts from the weeks as run (`planWeeks` seeds `volumes` from
  `state.weeks`). This is the baseline; the owner's answer to question 5 changes it at standard and
  upper (section 4.7).
- **A short week caps the next.** G-6: next week's target is `min(planned, actual × (1 + ramp))`
  (`guards.ts` `nextWeekCap`). The weekly decision uses it for hold and reduce (`adapt.ts`
  `weeklyDecision`, `replan.ts`: only a decision other than progress becomes a `weekCaps` entry).
  Progress adds nothing beyond the plan's own step: J5 never raises the rate, it only holds or
  reduces.
- **So the plan has no memory.** Each rebuild step is a fraction of the last weeks as run. A runner
  who is below an earlier level is rebuilt at 10% from wherever the last two weeks were, with no
  reference to what the same runner sustained a few weeks earlier.

### 2.6 What the runner can change today

- **The week target.** `PUT /api/plan/weeks/:weekStart` (`server/routes/plan.ts`) accepts any whole
  number of minutes with a note and stores `targetSource: 'override'`. It writes the week row only;
  no session is added. A re-plan (`replan.ts` `planWeekWrites`) keeps an override only when it is at
  or below the engine's new target for that week (`old.targetRunMin <= week.targetRunMin`); a higher
  one is replaced by the engine's week, and the revision shows the change. The lower overrides also
  cap the week (`weekCaps`). A newly generated plan starts without the earlier overrides
  (`tests/api/plan.test.ts`, "regenerating ... drops overrides"). In short: **the one upward lever
  does not survive the next re-plan.** The owner's answer to question 9 changes this (section 4.8).
- **The re-plan** (`Update plan from latest data`, and the weekly one) recomputes from the data with
  the same limits.
- **Session edits** (move, swap, swap-kind, shorten, skip, restore; `shared/engine/adjust.ts`) are
  checked against G-1 and the week target (a restore against the target), so none is a way to ask
  for a larger week.
- **Plan options** chosen at generation and stored in `Plan.options`: the recovery cycle, strength
  sessions, the polarized model (`server/routes/plan.ts` `generateBody`). Nothing in them changes
  the start or the step.

### 2.7 Measured behaviour on a synthetic runner

The runner is described in appendix A: a profile with one year of running (S3), a 13-week summer
block of 265 to 285 minutes a week with 130 to 150-minute long runs, then seven sparse weeks of 0 to
80 minutes, and a synthetic 100-mile goal on 2027-05-29. `buildPlan` on the baseline commit gives,
with no checklist failure and no spike warning in any row:

| Case                                                       | Week 1 | Weekly >= 150 | >= 200 | >= 285 | Long >= 90 | >= 120 | >= 150 |
| ---------------------------------------------------------- | ------ | ------------- | ------ | ------ | ---------- | ------ | ------ |
| S3, one year of running (floor 3 × 20)                     | 60     | 16            | 20     | 25     | 21         | 25     | 29     |
| S3, three years of running (floor 3 × 30)                  | 90     | 9             | 13     | 18     | 14         | 18     | 22     |
| S4, control: weekly time not limiting (225 min weeks, 3 y) | 225    | 1             | 1      | 9      | 13         | 17     | 20     |
| S5, layoff of 41 days (J7 restart, one year)               | 89     | 9             | 14     | 20     | 15         | 21     | 24     |

Entries are the plan week (week 1 is the Monday of 2026-10-19) in which the weekly target or the
long run first reaches the figure, in minutes. The recovery-week alignment moves every entry by up
to a week with the race date, because recovery weeks are counted back from the race. The control row
is the G-1 floor: with enough weekly time, the long run still needs 20 weeks to go from a 45-minute
reference to 150 minutes.

Table 2 replaces the soft step by 12% and 14% in the whole plan, with no ceiling `R`, so it is an
upper bound on what a faster step can buy (the override was applied to the process only; no file
changed).

| Profile | Step | Weekly >= 150 | >= 200 | >= 285 | Long >= 90 | >= 120 | >= 150 |
| ------- | ---- | ------------- | ------ | ------ | ---------- | ------ | ------ |
| 1 year  | 10%  | 16            | 20     | 25     | 21         | 25     | 29     |
| 1 year  | 12%  | 13            | 16     | 21     | 21         | 25     | 29     |
| 1 year  | 14%  | 12            | 16     | 18     | 21         | 25     | 29     |
| 3 years | 10%  | 9             | 13     | 18     | 14         | 18     | 22     |
| 3 years | 12%  | 8             | 12     | 16     | 14         | 18     | 22     |
| 3 years | 14%  | 6             | 10     | 13     | 14         | 18     | 22     |

Reading: the weekly step moves the weekly total (five to seven weeks) and not the long run, because
G-1 binds the long run from about week 5 on. The 3 × 30 start moves both (seven weeks each). Between
the 3-year row (22) and the control (20) there are two weeks of headroom on the long run; there is
no more without crossing G-1.

## 3. What the evidence says

Paper ids in brackets are in `research/papers/`. Papers marked **(candidate Cn)** are not in the
corpus; section 3.7 lists them. The corpus is a reading of studies, not a systematic review
(`research/README.md`), and its own principle applies here: a change toward more load needs stronger
evidence than a change toward less, and the conservative rule wins (G6).

### 3.1 Endurance fitness after a reduction or a stop

- Complete cessation: VO2max fell 7% by day 21 and settled 16% below the trained value by day 56 in
  seven trained subjects; oxidative enzymes fell with a half-time of 12 days; capillarisation held
  [coyle-1984-detraining-time-course]. A meta-analysis of 21 studies found a larger fall after long
  than after short cessation (effect sizes -1.42 and -0.62; heterogeneity 76% in the long group,
  small-study bias), no significant further change beyond 30 days, and a smaller fall when some
  exercise continued [zheng-2022-detraining-vo2max]. The engine models this as saturating
  (`j7.vo2maxFallDay21Pct`, `day56`, `detrainingCapPct`).
- Training history matters: in long-trained athletes VO2max falls but stays above control values;
  recently acquired gains are lost completely; moderately trained people sit between
  [mujika-2000-detraining-part1], [mujika-2000-detraining-part2] (narrative reviews, grade D). By
  inference, a runner with a year of running is closer to "recently acquired" than to
  "long-trained", which argues for a smaller credit than the physiology of an old athlete would
  give.
- Reduced training, not cessation: VO2max was held for 15 weeks at 2 or 4 sessions a week with
  intensity and duration unchanged in 12 young adults [hickson-1981-reduced-frequency]; a review of
  mostly non-athletes finds endurance performance kept for up to 15 weeks at 2 sessions a week or 33
  to 66% less volume if intensity is kept, and says there are too few data for athletes
  [spiering-2021-minimal-dose]. "Sparse" short easy runs are not a maintenance dose by that reading
  (intensity is the key variable), so these papers support the sparse period being benign for
  fitness only in part.
- Retraining speed: nothing in the corpus. Candidate evidence is a single 53-year-old master
  triathlete whose VO2max fell 10.9% (running) in 12 weeks off and was regained in 12 weeks of
  progressive retraining, with running economy and lean mass still depressed (candidate C9, n = 1),
  and a two-week detraining study in soccer players that needed a similar or longer retraining
  period (candidate C10). Neither supports "regain faster than it was gained".
- The J7 fractions (90%, 75%, 50%) are more cautious than these fitness losses (7% and 16%); the
  corpus says so and lists "running evidence on retraining speed and restart fractions" as what
  would replace them (`research/engine-rules.md`, J7 and "What would change these rules").

### 3.2 Tissue tolerance (tendon, bone): the gap that matters

The corpus has no paper on how fast tendon or bone capacity falls or returns after two to eight
weeks of reduced running. Its only tissue-timing line is a clinical convention of 72 hours between
runs for tendon collagen synthesis [sanford-2024-return-to-running] (grade D).

Candidate papers, read on Europe PMC on 2026-10-24, point the other way from fitness:

- Under 23 days of complete unilateral lower-limb suspension (9 of 17 young men suspended), patellar
  tendon stiffness fell 9.8% by day 14 and 29.3% by day 23, and knee-extensor torque 14.8% and 21.0%
  (candidate C1).
- Achilles tendon stiffness, raised 50% by three months of isometric training, was back at its
  pre-training value after one month of detraining, in nine young men; it had not changed until the
  second month of training (candidate C2).
- A meta-analysis of tendon adaptation to loading (27 studies, 37 interventions of 8 weeks or more)
  finds adaptation driven mainly by loading magnitude, with larger but not significantly larger
  effects for 12 weeks or more (candidate C3).
- Tendon core turnover after maturity is very slow or absent; loading stimulates synthesis at the
  periphery (candidate C4, review).
- Bone stress injury in runners arises from "an error in workload" in which the number and magnitude
  of loading cycles exceeds what the bone resists; progressing training "sensibly, particularly
  training intensity" limits damage accumulation, and no single optimal workload exists (candidate
  C7, review; candidate C6, level 5 commentary).

Reading, with the limits stated: these studies are complete unloading, in young non-runners, with no
runner outcome. They suggest that tissue capacity can fall faster than aerobic fitness does and is
built slowly, which is the asymmetry the owner's question raises. They do not say what a large but
partial reduction in running does to a runner's tendon, and nothing here dates a bone remodelling
window. The engine cannot tell the two apart from minutes. This is why the proposal credits the
**weekly total** (the quantity fitness can carry) and leaves the **session length** (the quantity
tissue carries) under G-1.

### 3.3 The acute:chronic workload ratio: band, use, criticisms

- Origin and band. The ratio comes from team sports, where a "sweet spot" of 0.8 to 1.3 was proposed
  (the corpus entries [griffin-2020-acwr-systematic-review] and [impellizzeri-2020-acwr-pitfalls]
  name it and advise against carrying it to running plans). A review of 22 team-sport studies
  supports an association with non-contact injury and prefers EWMA
  [griffin-2020-acwr-systematic-review]; in 59 Australian football players a ratio above 2.0 carried
  relative risks of about 6 to 21 [murray-2017-ewma-acwr]; the advocate's case, including the
  "training-injury prevention paradox" (athletes used to high loads have fewer injuries), is a
  single-author narrative [gabbett-2016-paradox].
- Running cohorts disagree. 435 runners: an inverse association, a predicted probability of injury
  of 9.6% below a ratio of 0.70 against 1.3% above 1.38 [nakaoka-2021-acwr-runners]. 5205 runners: a
  negative dose-response for the 1:3-week ratio and none for the week-to-week ratio
  [frandsen-2025-session-spike]. 735 marathon registrants: each day with a 7:28 ratio of 1.5 or more
  OR 1.06 [toresdahl-2023-nyc-marathon-training-injury]. 119 ultra runners: injury above 1.5 and
  illness below 0.5, and a load relationship only for those under 30 km a week
  [craddock-2020-acwr-two-oceans]; 106 ultra runners: minimal ratio effect, and less distance in the
  12 weeks before the race went with more injury [burgess-2025-training-load-injury-gam]. 461
  runners: duration ratio HR 1.33, gone once runners injured at baseline were excluded
  [cloosterman-2026-gps-load-injury].
- Criticisms. No study estimates a causal effect; the ratio fails to normalise and is coupled
  [impellizzeri-2020-acwr-pitfalls]; exponentially weighted versions have an initial-load problem
  and do not suit tapering [wang-2020-acwr-lessons]; the method changes which sessions are flagged
  (16 to 33% at the same cutoffs) [cloosterman-2024-acwr-methods]; progression rules can be tested
  by target trial emulation [wang-2024-target-trial-load].
- "Chronic load protects" is the claim behind a history credit. The corpus holds it only as
  team-sport narrative [gabbett-2016-paradox] and as large-cohort associations in runners that
  survivors and high-volume runners confound: fewest injuries at over 105 km a week and seven runs a
  week, more at under two runs a week or 25 km [abrahamson-2025-self-reported-characteristics]. Low
  ratios in runners may mark a return from a break, which the cohort did not test
  [nakaoka-2021-acwr-runners].
- Consequence for the engine: G-5 stands. The proposal uses **no ratio**: the rebuild ceiling is an
  absolute number of minutes taken from the runner's own steady weeks, it gates nothing, and the
  hard ceiling and G-1 stay in force. The ratio remains display-only. G-5 says no ratio band
  "blocks, caps or justifies progression"; a history credit does justify a faster step, so the
  wording needs a clarifying amendment (question 4, approved by the owner; section 7). The
  amendment also names the trailing mean of section 4.7: an absolute number of minutes, never
  divided by another load.

### 3.4 The 10% rule and faster progressions

- The only randomised trial of a 10%-rule programme: 532 novices, a 13-week programme built on the
  10% rule against an 8-week standard programme, injuries 20.8% and 20.3%; the arms differed in
  length too [buist-2008-graded-training].
- Cohorts: 874 novices, no overall difference between under 10%, 10 to 30% and over 30% weekly
  progression, with a non-significant signal for distance-related injuries above 30% (HR 1.59, 0.96
  to 2.66) [nielsen-2014-weekly-progression]; 60 novices, healthy runners averaged +22.1% a week and
  the week before an injury was +86% [nielsen-2013-gps-progression]; 261 runners, more injuries
  after a 20 to 60% weekly increase than under 20% at day 21 but not at days 56 or 98
  [damsted-2019-weekly-distance-change]; a review of four studies found no difference between a 10%
  and a 24% average weekly increase (HR 0.8, 0.6 to 1.3) [damsted-2018-training-load-change]; 36
  prospective studies, 23,047 runners, conflicting
  [fredette-2022-training-parameters-injury-review]; mean quality 44% in an earlier review
  [nielsen-2012-training-errors].
- Practice: published marathon plans build 5 to 9% a week on average [knopp-2024-marathon-plans].
- Reading. The 10% step has no validated threshold behind it (the engine says so: grade D). Weekly
  increases up to about 20 to 25% show no overall injury difference in the novice groups studied,
  and the first signals sit at 20% in a single week and 30% over two. All of it is observational,
  mostly in novices, and none follows a return after a break. The outer edge of what the data
  tolerate is the engine's own hard ceiling (grade C): 30% over two weeks is 14.0% a week if even.
- Session versus week. The session guard is the better-supported rule (HRR above 1 for any session
  more than 10% over the 30-day longest run) and the week-to-week ratio showed nothing
  [frandsen-2025-session-spike]. A faster **weekly** step that leaves the session guard intact is
  therefore the lower-evidence-cost change.

### 3.5 Masters runners

- Performance falls modestly to 50 or 60 and faster after, mainly through VO2max, and the fall is
  mediated in large part by the reduced volume and intensity masters train at; load should not be
  cut by age alone [tanaka-2008-masters-endurance], [borges-2016-masters-recovery-review]. Even
  continuing runners lose 8 to 15% of VO2max a decade; the group that largely stopped lost 18% and
  34% per interval (two people) [pollock-1997-older-track-athletes]; [hawkins-2003-vo2max-decline].
- Recovery: reviews are inconclusive [fell-2008-aging-muscle-recovery]; one 17-cyclist study found
  equal physical recovery at 48 hours and poorer perceived recovery in masters
  [borges-2018-masters-hiit-recovery]. The engine keeps standard spacing and a perceived-recovery
  gate (J6).
- Injury: masters reported more calf, Achilles and hamstring problems, but trained more, and running
  frequency itself raised risk [mckean-2006-masters-injury].
- Retraining speed in masters runners: nothing in the corpus; candidate C9 is one 53-year-old.
  Tendon ageing candidates (C4, C16) say the tendon keeps its response to loading, with similar
  biomechanical changes in older adults over 12 to 14 weeks of training, and slow core turnover.
- Engine position: age is a modifier of projection, not of prescription (A9, E3), and age 45 or over
  is a soft start flag that blocks the 3 × 30 start by the years route (E6 path 2), which this
  proposal leaves as it is. On the block route of section 4.2 the owner decided (question 12) that
  the flag warns and caps the load setting at standard instead of blocking the lift.

### 3.6 What the corpus lacks

1. A running study of the injury rate when a runner returns to an earlier weekly level or long run
   after two to eight weeks of reduced running. (G-1's cohort contains such runs but does not
   separate them.)
2. Tendon and bone capacity time courses in runners after a partial reduction.
3. Retraining speed in recreational and masters runners.
4. A running trial of any progression rule other than the novice 10% programme.

Items 1 and 3 are what the J7 line of "What would change these rules" asks for. Until they exist
every rule in this proposal is grade D.

### 3.7 Papers to add through research-update

None is added by this task. Each was found by web search or recalled, and checked on 2026-10-24;
"metadata" means title, authors, year, journal and DOI matched Crossref that day; "abstract" means
the abstract was read on Europe PMC. A paper is added only after its record is rebuilt in the
session that adds it (the `research-update` skill: Crossref, abstract, the JSON record,
`npm run research:check` and `npm run research:verify -- <id>`).

- **C1.** De Boer MD, Maganaris CN, Seynnes OR, Rennie MJ, Narici MV (2007). Time course of
  muscular, neural and tendinous adaptations to 23 day unilateral lower-limb suspension in young
  men. _J Physiol_ 583(3):1079-1091. DOI 10.1113/jphysiol.2007.135392. Verified: metadata, abstract.
  Use: tendon stiffness falls within 2 weeks of complete unloading. Confidence: high.
- **C2.** Kubo K, Ikebukuro T, Maki A, Yata H, Tsunoda N (2012). Time course of changes in the human
  Achilles tendon properties and metabolism during training and detraining in vivo. _Eur J Appl
  Physiol_ 112(7):2679-2691. DOI 10.1007/s00421-011-2248-x. Verified: metadata, abstract. Use: a
  stiffness gain back to baseline after 1 month of detraining. Confidence: high.
- **C3.** Bohm S, Mersmann F, Arampatzis A (2015). Human tendon adaptation in response to mechanical
  loading: a systematic review and meta-analysis of exercise intervention studies on healthy adults.
  _Sports Med Open_ 1:7. DOI 10.1186/s40798-015-0009-9. Verified: metadata, abstract (article number
  not confirmed). Use: tendon adaptation needs 8 weeks or more and depends on load magnitude.
  Confidence: high, volume and page to confirm.
- **C4.** Svensson RB, Heinemeier KM, Couppé C, Kjaer M, Magnusson SP (2016). Effect of aging and
  exercise on the tendon. _J Appl Physiol_ 121(6):1353-1362. DOI 10.1152/japplphysiol.00328.2016.
  Verified: metadata, abstract. Use: tendon ageing and loading, for masters. Confidence: high.
- **C5.** Magnusson SP, Kjaer M (2019). The impact of loading, unloading, ageing and injury on the
  human tendon. _J Physiol_ 597(5):1283-1298. DOI 10.1113/JP275450. Verified: metadata, abstract
  (general). Use: review of the tendon's response to loading and unloading. Confidence: high.
- **C6.** Warden SJ, Davis IS, Fredericson M (2014). Management and prevention of bone stress
  injuries in long-distance runners. _J Orthop Sports Phys Ther_ 44(10):749-765. DOI
  10.2519/jospt.2014.5334. Verified: metadata, abstract (level of evidence 5). Use: bone stress
  injury as microdamage against its removal. Confidence: high.
- **C7.** Warden SJ, Edwards WB, Willy RW (2021). Preventing bone stress injuries in runners with
  optimal workload. _Curr Osteoporos Rep_ 19(3):298-307. DOI 10.1007/s11914-021-00666-y. Verified:
  metadata, abstract. Use: a workload range, progress intensity sensibly. Confidence: high.
- **C8.** Bertelsen ML, Hulme A, Petersen J, Brund RK, Sørensen H, Finch CF, Parner ET, Nielsen RO
  (2017). A framework for the etiology of running-related injuries. _Scand J Med Sci Sports_
  27(11):1170-1180. DOI 10.1111/sms.12883. Verified: metadata, abstract. Use: capacity against load
  as the frame for any history credit. Confidence: high.
- **C9.** Lepers R, Mater A, Assadi H, Zanou N, Gremeaux V, Place N (2024). Effect of 12 weeks of
  detraining and retraining on the cardiorespiratory fitness in a competitive master athlete: a case
  study. _Front Physiol_ 15:1508642. DOI 10.3389/fphys.2024.1508642. Verified: metadata, abstract.
  Use: masters retraining, n = 1. Confidence: high on the reference, weak as evidence.
- **C10.** Joo CH (2018). The effects of short term detraining and retraining on physical fitness in
  elite soccer players. _PLoS One_ 13(5):e0196212. DOI 10.1371/journal.pone.0196212. Verified:
  metadata, abstract. Use: two weeks off needed a similar or longer retraining period; team sport.
  Confidence: high on the reference, weak as evidence.
- **C11.** Gabbett TJ (2020). Debunking the myths about training load, injury and performance:
  empirical evidence, hot topics and recommendations for practitioners. _Br J Sports Med_
  54(1):58-66. DOI 10.1136/bjsports-2018-099784. Verified: metadata only (no abstract on Europe
  PMC). Use: the "chronic load protects" argument at its strongest. Confidence: medium, content
  unverified.
- **C12.** Windt J, Gabbett TJ, Ferris D, Khan KM (2017). Training load-injury paradox: is greater
  preseason participation associated with lower in-season injury risk in elite rugby league players?
  _Br J Sports Med_ 51(8):645-650. DOI 10.1136/bjsports-2016-095973. Verified: metadata, abstract.
  Use: 30 players, 10 more preseason sessions went with an odds ratio of 0.83 for injury in the next
  week; team sport. Confidence: high on the reference, weak as evidence.
- **C13.** Neufer PD (1989). The effect of detraining and reduced training on the physiological
  adaptations to aerobic exercise training. _Sports Med_ 8(5):302-320. DOI
  10.2165/00007256-198908050-00004. Verified: metadata only (Crossref gives pages 302-321). Use: an
  older review of reduced training. Confidence: medium.
- **C14.** Reaburn P, Dascombe B (2008). Endurance performance in masters athletes. _Eur Rev Aging
  Phys Act_ 5:31-42. DOI 10.1007/s11556-008-0029-2. Verified: metadata only. Use: masters endurance
  review. Confidence: medium, content unverified.
- **C15.** Lolli L, Batterham AM, Hawkins R, et al. (2019). Mathematical coupling causes spurious
  correlation within the conventional acute-to-chronic workload ratio calculations. _Br J Sports
  Med_ 53(15):921-922. DOI 10.1136/bjsports-2017-098110. Verified: metadata only. Use: the coupling
  critique; optional, the corpus has two critiques. Confidence: medium, content unverified.
- **C16.** McCrum C, Leow P, Epro G, König M, Meijer K, Karamanidis K (2018). Alterations in leg
  extensor muscle-tendon unit biomechanical properties with ageing and mechanical loading. _Front
  Physiol_ 9:150. DOI 10.3389/fphys.2018.00150. Verified: metadata only; the claim of similar tendon
  changes in older adults over 12 to 14 weeks of training comes from a search summary. Use: older
  adults' tendon response to training. Confidence: medium, read before use.

Owner decision (question 11): the first research-update session adds six papers, C1 (De Boer
2007), C2 (Kubo 2012), C3 (Bohm 2015), C6 (Warden 2014), C7 (Warden 2021) and C8 (Bertelsen 2017),
each verified online in that session. The other ten (C4, C5 and C9 to C16) are reviewed afterwards,
in a later session, and added only if they pass the same checks.

Priority as proposed, which now orders that later review: C1 to C3 (tissue time course), C6 to C8 (load
capacity), C4, C9, C16 (masters), then C11, C12, C10. A topic run of the corpus workflow
(`research/tools/build-corpus.workflow.js`) with the scope "retraining and tissue capacity after a
short reduction in running load" would also look for the running studies in section 3.6; nothing
found by search on 2026-10-24 answers items 1 to 3. The search also surfaced a lead on bone
remodelling timing in military recruits that was not identified and is not listed.

## 4. The proposal

### 4.1 Principles and what stays unchanged

- **Opt-in and byte-identical by default.** With the setting absent or steady, `buildPlan` and
  `replan` give the same drafts as the baseline, except for a week target the runner has raised by
  hand (section 4.8), which is the runner's own act and not a default. The owner validation
  (`data/validate-owner.ts`) is then unchanged (section 5).
- **History credits the weekly total, never the session.** Fitness is what the history evidence
  speaks to (section 3.1); tissue is not covered (section 3.2).
- **Bounded by guards that already exist.** The setting can use the hard ceiling and nothing above.
- **Unchanged:** the plan currency (minutes, ADR 0003); G-1 (1.10 warn, 2.00 override, 30-day
  window, hard in every start path); the 30% ceiling over two weeks (grade C); the tightened
  profiles G-3, the progression hold (REDs flags, focal bone pain) and the injury-return ladder; G-5
  (no ratio gates); G-6 (never make up lost volume); the J5 hold and reduce signals; the J7 table
  and `afterBreak`; the H12 post-race window and the J9 disruption windows; the recovery cadence and
  cut; the checklist's 15 items; ADR 0005 (rule code chooses sessions; text comes from templates);
  ADR 0007 (every change is a visible, undoable revision).

### 4.2 (a) The history block and the rebuild ceiling

**The block.** `estimateState` (`athlete.ts`) adds `history` to `AthleteState`, computed from
`state.weeks` (16 weeks already aggregated by `aggregateWeeks`, 20 for the 16-week window below; no new query, so ADR 0009's snapshot
contract holds):

- A window is four consecutive complete weeks (`g8.blockWeeks`) that each hold at least
  `a5.lowFrequencyRunsPerWeek` (2) runs. Race minutes are not in `runMin`.
- A window is scored by the mean of its three lowest weeks (`g8.blockWeeksDropped` = 1 week
  dropped), so one big week cannot set it, the same idea as E6's start level ("one big week alone
  does not").
- Only windows that end within the credit window of the current Monday qualify, and the highest
  score after the taper below wins. `history` is `{ blockMin: H, endWeek, taper }` or `null`. Both
  windows the owner asked for are built behind Params (question 7). With `g8.creditTaperEndWeeks` =
  12, a block that ended within `g8.creditWindowWeeks` (12) weeks of the current Monday counts in
  full and an older one not at all. With `g8.creditTaperEndWeeks` = 16, a block that ended within 12
  weeks counts in full, and one that ended 13 to 16 weeks ago counts with a `taper` factor that
  falls in a straight line from 1 at 12 weeks to `g8.creditTaperFloor` (0.5) at 16:
  `taper = 1 − (1 − 0.5) × (w − 12) / (16 − 12)` for a block that ended `w` weeks before the current
  Monday (0.875 at 13 weeks, 0.75 at 14, 0.625 at 15, 0.5 at 16). The owner's replay chooses the
  shipped value (section 5.2); the code supports both and the tests run both.
- The 12-week option fits the 16 weeks `state.weeks` shows. The 16-week option reaches a block whose
  first week began 20 weeks before the current Monday, so `estimateState` reads those weeks from the
  activities the snapshot already holds (`aggregateWeeks` over a longer span, no new query), and
  `WEEKS_SHOWN`, which is what the screens show, does not change.
- On the synthetic runner H = 280 minutes, ending 8 weeks before the plan. No qualifying window
  gives `null`, and the plan is the baseline's.

Reason: the owner's request names the best four-week block of the last year; this proposal started
from the 16 weeks the state already holds, and the owner decided to build both windows and let the
replay choose (question 7). Twelve weeks sits
between the plateau of the detraining papers (about 8 weeks, day 56 in
[coyle-1984-detraining-time-course]; no further change beyond 30 days on average in
[zheng-2022-detraining-vo2max]) and the 16 weeks within which a disruption is counted
[feely-2022-training-disruptions]; it is a grade D convention. The 16-week option ends the taper at
that same count, and the floor of one half is a **Preference** (taste, no claim that it is better).
The block is not an EWMA: it is
auditable on a calendar and shows in the Why drawer as a sentence, and G-5's objections to ratios
and the EWMA initial-load problem [wang-2020-acwr-lessons] do not arise.

**The 3 × 30 start from capacity (stage 1).** E6 path 2 lets N rise above 20 only for a runner with
at least 2 years of running, no soft flag, no tightened profile and no recent-injury flag. The
proposal adds a second route, in standard and upper only: `yearsRunning >= a5.noviceMaxYears` (1)
**and** a block with `blockMin >= restartFloor.sessions × restartFloor.sessionMaxMin` (3 × 30 = 90
minutes) that ended within 12 weeks, whichever window ships (question 1), with `noviceFlags` empty
apart from the age flag (below), no tightened profile and no recent injury. N stays the
longest continuous run of the last 30 days, rounded down to 5 and capped at 30, and G-1 still bounds
every session by the runner's own completed run. The synthetic runner moves from 3 × 20 to 3 × 30
(week 1: 60 to 90).

**Age (question 12).** The age-45 flag does not block the block route. At 45 or over the route is
open, the position is capped at standard (a choice of upper is read as standard, with the reason
shown, section 4.6) and the Why drawer carries a warning line. The years route (E6 path 2) is
unchanged and the flag still blocks it, so a runner of 45 or over can take the lift by a
demonstrated block but not by calendar years; case H11 pins both. The effect is that the more
cautious position stays for the group the corpus knows least about (section 3.5) without refusing
the lift. Against: the flag was a start flag for a reason (owner decision 1 of the engine design),
and the block route is now more permissive than the years route for the same runner.

Reason: this is the largest single lever (section 2.7) and the least exposed: sessions stay inside
the runner's own longest run and G-1, which was already the justification of the lift
[frandsen-2025-session-spike], [pollock-1977-frequency-duration-injury]. A year of running is
outside the highest-risk bucket of fewer than one year
[abrahamson-2025-self-reported-characteristics]. It replaces a proxy (calendar years) with a
measurement (a block). Against: it overturns a detail of owner decision 1 of the engine design, and
"nothing supports looser limits for experienced runners" (`research/topics/injury-load.md`, rule
`injury-no-experience-loosening`, grade C). The route does not key on experience but on a
demonstrated load, but it still moves toward more load for a class of runners. The floor week is
also exempt from the G-2 ceiling up to its minutes (E6, a grade D choice: no study tests how long a
start week lasts), so a longer N makes the first week stand further above the recent weeks (90
minutes against a highest recent week of 75 and a typical week of 53 on the synthetic runner). The
owner said yes at the standard and upper positions (question 1, section 7).

**The rebuild ceiling `R` and the zone (stage 2).** `R = credit × taper × H`, with `credit` = 0.70
in standard and 0.85 in upper (section 4.3; both provisional, question 3) and `taper` as above (1
for a block that ended within 12 weeks). A loading week whose baseline (the highest of the two
preceding loading weeks) is below `R` is in the **zone**, and its soft step is the position's step
instead of 10%, clamped so that the zone never plans a week above `R` except by the ordinary 10%:

```
soft(base) = max(base × 1.10, min(base × (1 + step), R))
```

Above `R` the soft step is 10% again. The hard ceiling is untouched, so a zone week is also at most
`allowed` (`limits.ts` `rampLimits`, `plan = min(soft, allowed)`). The zone does not apply to:
programme weeks (floor, ladder, injury-return), recovery and taper weeks, the weeks of a post-race
window (H12) or a disruption window and its J9 return, any plan under a tightened profile or a
progression hold, and a runner flagged low frequency (A5; the novice ramp and 2:1 cadence continue
until the 4-week average reaches two runs a week, which after a layoff of a month takes about three
weeks of three runs).

Reason: `R` answers "how far may a fast ramp go". A runner is asked to rebuild only toward a weekly
level that was sustained in the last 12 weeks, never toward an untested one, and beyond it the
engine's own convention resumes. Against: nothing in the corpus tests any such ceiling (grade D),
and it relies on the fitness-side evidence for a quantity that tissue also carries (section 3.2).

**What the credit fractions are.** 0.85 is the fitness retained at day 56 of complete cessation (1 −
0.16, [coyle-1984-detraining-time-course]); 0.70 is the approximate fall in tendon stiffness at day
23 of complete unloading (candidate C1) and the cautious end of the J7 table. Both are cessation
values, so both are conservative for a runner who kept running a little; neither is a measurement
for runners. Both are grade D and provisional (question 3).

### 4.3 (b) The load setting

| Position     | Label in the UI | History credit (`R` as a share of H) | Weekly step below `R`                                        | Lift from capacity | Weeks run above plan                              |
| ------------ | --------------- | ------------------------------------ | ------------------------------------------------------------ | ------------------ | ------------------------------------------------- |
| conservative | Steady          | none                                 | 10% (`g2.rampSoft`), today                                   | no                 | taken as run, lift nothing (today)                |
| standard     | Standard        | 0.70 (provisional)                   | 12% (`g8.stepStandard`, provisional)                         | yes                | baseline follows the four-week mean (section 4.7) |
| upper        | Upper band      | 0.85 (provisional)                   | `sqrt(1 + g2.rampCeilingTwoWeeks) − 1` = 14.0% (provisional) | yes                | as standard                                       |

- **Stored** as a plan option (`options.loadAppetite`) in `Plan.options`, which is JSON text on the
  `Plan` row (`prisma/schema.prisma`); no migration, no new model, no `STATE_MODELS` change, no
  Docker rebuild. A re-plan reuses the plan's options (`athleteState.ts` `planOptions`). Changed on
  the Generate form like the recovery cycle; a later task adds a plan action with a preview and an
  undo (question 6, decided).
- **Default:** steady (decided, question 2): today's engine byte for byte.
- **Never above the observed bands.** The setting reaches only the weekly step, and its largest
  value is the weekly rate at which two weeks meet the existing hard ceiling, derived from the Param
  so it can never exceed it. The bands in the engine are: a session more than 10% above the 30-day
  longest run [frandsen-2025-session-spike] (untouched), a weekly increase of 20% or more in one
  week [damsted-2019-weekly-distance-change] (14.0% is below it) and more than 30% over two weeks
  [nielsen-2014-weekly-progression] (equal to the ceiling at most, never above).
- **Forced to steady** with a stated reason when a recent injury is on file, a prior bone stress
  injury or two BSI factors apply, a REDs hold or focal bone pain holds progression, a rest window
  or injury report is active, the plan is inside a post-race window, or the runner is low frequency.
  The setting is kept and resumes when the reason ends.
- **Capped at standard, not forced to steady,** at age 45 or over (question 12): a choice of upper
  is read as standard, and the form and the drawer say so. The zone, the response and the lift
  route stay on at standard.
- **The trade-off shown with the choice** (copy in section 4.6): a faster step brings the earlier
  weekly level back sooner; the studies that compared weekly steps found no clear injury difference
  between about 10% and about 24% in the groups studied, mostly new runners, and none followed a
  return after a break, so the effect on this runner is not known; staying at 10% is the more
  cautious choice; long runs keep the 30-day rule.

### 4.4 (c) How both interact with the existing rules

- **G-1 session spike.** Unchanged (the owner left it as it is, question 10) and hard in start paths. It is the binding limit on the long run
  from about week 5 in the measured cases; the control case (table 1) gives the floor the setting
  cannot go below. A zone week still plans its long run at or under 1.10 times the 30-day longest
  run.
- **G-2 hard ceiling.** Unchanged. The upper step is derived from it, so the plan rides it and never
  passes it. `allowed` still cuts a week in `guards.ts` `rampWeek` and fails `progression`.
- **G-2 soft step.** In the zone the warning threshold is the position's step; elsewhere 10%. One
  new `rebuild` field on `RampContext` carries it to the generator (`macro.ts`), the guards
  (`guards.ts`) and the checklist (`checklist.ts`), built by one function, so the three agree and
  there is no fourth definition.
- **G-3 tightened profiles.** Zone off, lift route off, response off, the position reads as steady. `weeklyRamp`
  and `tightRamp` are unchanged and still win over any step.
- **G-5 ACWR never a gate.** No ratio is computed, in section 4.7 either. The clarifying wording is
  decided (question 4).
- **G-6 and J5, the weekly decision.** `weeklyDecision` receives the zone step for the next week as
  its `ramp` (`replan.ts` passes `weeklyRamp(state)` today), so `nextWeekCap` and the plan agree.
  Hold and reduce still hold or cut, and they win over the response of section 4.7; a hold week does
  not advance the zone. At steady an overshot week still lifts nothing; at standard and upper
  section 4.7 applies.
- **E6 floor.** Week 1 is the floor week and the baseline. The lift route (stage 1) changes N only.
  The zone starts the week after the floor week.
- **E6 ladder and injury-return.** Unchanged; history does not alter those paths and their weeks are
  outside the zone.
- **E3 cadence.** Unchanged; recovery weeks are not in the zone. A 2:1 cadence from a flag
  continues.
- **J7 and `afterBreak`.** Unchanged. `afterBreak` still scales the typical week after a layoff of 7
  days or more; the zone then starts after the restart week. The proxy problem of section 2.4 is not
  touched: the J7 tiers are the lines the corpus says await running evidence, and the owner left
  them as they are for now (question 8).
- **H12 and J9.** Zone off during a post-race window and a disruption window and its return; the
  first loading week after keeps its J7 restart volume.
- **Checklist (15 items).** No new item, so the 15-item shape and the "0 of 15" baseline stay.
  `progression` uses the position's threshold and says in its detail when weeks used the zone or
  the response;
  `break-restart` is unchanged (the floor week still counts as its own start).
- **Revisions and undo.** A change by plan action (task L4b) is a revision with a diff and an undo
  (ADR 0007), its summary a template; a change by generating again is a new plan, and the archived
  plan can be restored. A week target kept or clipped at a re-plan (section 4.8) appears in the diff.
- **Offline, Today, the watch.** No change; targets are the plan's minutes.

Overshoot interplay: the zone itself does not read overshoot; the response of section 4.7 does, and
only at standard and upper. At steady an overshot week is still taken as run and lifts nothing. A
runner who wants a higher plan has three levers, each bounded by the hard ceiling and G-1: the
setting, the response, and a raised week target (section 4.8).

### 4.5 (d) Params: values, grades today, evidence

All new Params are grade D and go in `shared/engine/params/g-limits.ts` as group `g8` under a new
rule **g-8** "History-informed rebuild" in `research/engine-rules.md`, section (g). The README rule
applies: edit the rule text first, then the Params, then bump `PARAMS_VERSION`. Reused Params are
named, not duplicated.

| Param                    | Value                               | Grade today  | Rule |
| ------------------------ | ----------------------------------- | ------------ | ---- |
| `g8.blockWeeks`          | 4                                   | D            | g-8  |
| `g8.blockWeeksDropped`   | 1                                   | D            | g-8  |
| `g8.creditWindowWeeks`   | 12                                  | D            | g-8  |
| `g8.creditTaperEndWeeks` | 12 or 16, chosen by the replay (Q7) | D            | g-8  |
| `g8.creditTaperFloor`    | 0.50                                | D            | g-8  |
| `g8.creditStandard`      | 0.70, provisional (Q3)              | D            | g-8  |
| `g8.creditUpper`         | 0.85, provisional (Q3)              | D            | g-8  |
| `g8.stepStandard`        | 0.12, provisional (Q3)              | D            | g-8  |
| `g8.responseWeeks`       | 4                                   | D            | g-8  |
| upper step (derived)     | 0.140, provisional (Q3)             | C, inherited | g-2  |

Evidence ids in the corpus today, then the candidates that would join them after L0:

- `g8.blockWeeks`: [mujika-2000-detraining-part1], [mujika-2000-detraining-part2] (short-term under
  4 weeks, long-term over). Candidates: none.
- `g8.blockWeeksDropped`: none (E6's rule that one big week does not set the level has none either).
  Candidates: none.
- `g8.creditWindowWeeks`: [coyle-1984-detraining-time-course], [zheng-2022-detraining-vo2max],
  [feely-2022-training-disruptions]. Candidates: C9.
- `g8.creditTaperEndWeeks`: the same three; 16 is the span of the disruption count in
  [feely-2022-training-disruptions]. Candidates: C9.
- `g8.creditTaperFloor`: none; one half is a **Preference**. Candidates: none.
- `g8.responseWeeks`: none; four is the length of the typical week (`a5.typicalWeekCount`).
  Candidates: none.
- `g8.creditStandard`: [coyle-1984-detraining-time-course], [mujika-2000-detraining-part2]; the
  tissue side has no corpus paper. Candidates: C1, C2.
- `g8.creditUpper`: [coyle-1984-detraining-time-course], [zheng-2022-detraining-vo2max],
  [hickson-1981-reduced-frequency], [spiering-2021-minimal-dose]. Candidates: C9.
- `g8.stepStandard`: [nielsen-2013-gps-progression], [damsted-2018-training-load-change],
  [buist-2008-graded-training], [fredette-2022-training-parameters-injury-review]. Candidates: none.
- The upper step is `sqrt(1 + g2.rampCeilingTwoWeeks) − 1`, not a new number; it carries the
  evidence of `g2.rampCeilingTwoWeeks`: [buist-2008-graded-training],
  [nielsen-2014-weekly-progression], [nielsen-2013-gps-progression],
  [damsted-2019-weekly-distance-change], [damsted-2018-training-load-change],
  [fredette-2022-training-parameters-injury-review].

Reused: `a5.lowFrequencyRunsPerWeek` (2) for the block's weekly floor and the low-frequency
exclusion; `a5.noviceMaxYears` (1) and `restartFloor.sessions` × `restartFloor.sessionMaxMin` (3
× 30) for the lift route; `g2.rampSoft` (10%) above `R`; `g2.rampCeilingTwoWeeks` (30%).

No candidate paper raises any grade: C1 to C3 and C9 to C12 are non-runners, team sports, young men
or one person. The upper step is not a new number; deriving it keeps "the upper band the literature
tolerates" equal to the grade C ceiling and moves with it. The Params need a default note each (a
unit test enforces it) and the notes pass the G5 lint (no "injury risk", "fail", "miss", "behind",
"red"). The default position is a product constant, not a Param (display caps are constants and data
thresholds are Params, phase 3a design section 12, decision 21; a default choice on the plan form is
neither a cap nor a threshold about the runner's data).

Reasons for the values: 0.70 and 0.85 as in section 4.2. 12% is the midpoint between the 10%
convention and the 14.0% edge and is a **Preference** (taste, no claim that it is better); the
observed no-difference range for novices is wider. All of these values are provisional: the owner
deferred them until the proposal had been read, and the own-tolerance replay decides (question 3).
The window of 12 and 16 weeks and the floor of one half are in section 4.2. 4 weeks is the length the
owner named and the typical-week length (`a5.typicalWeekCount`); the response uses the same length
(section 4.7).

### 4.6 (e) Copy

Rules: templates in `shared/copy/` (explain templates in `explainTemplates.ts`, the revision line in
`revision.ts`), every number interpolated from a Param, `shared/copy/lint.ts` (G5) on all of it, no
model-written text (ADR 0005), no "you" in explain copy (the existing templates use none), no
"behind", "missed" or red, no streaks, no probability on an injury. A rule `g-8` needs a title in
`web/components/ruleTitles.ts` ("History-informed rebuild") and one builder in `explainInputs.ts`;
the coverage test fails on a rule with neither or both.

Why-drawer facts (`explain.g8-*`):

- block: "Four steady weeks ending {weeks} ago averaged {minutes} a week."
- zone: "While a week is under {minutes}, the plan adds up to {pct} a week; past that it adds up to
  {soft}."
- setting: "Load setting: {position}. It sets how fast the plan adds running time while rebuilding."
- held: "The steady step applies for now: {reason}." with reasons such as "a recent injury is on
  file", "a rest window is active", "the plan is in the weeks after a race", "recent weeks held
  fewer than two runs a week".
- none (gap sentence): "No four steady weeks in the last 12 weeks, so the plan builds from recent
  weeks."
- limits: "Long runs keep the 30-day rule, and growth never passes 30% over two weeks."

The choice (form hint and drawer):

- Steady: "Adds up to {10%} a week, the plan's usual step."
- Standard: "Adds up to {12%} a week while rebuilding toward a level held in the last 12 weeks."
- Upper band: "Adds up to {14%} a week while rebuilding, the most the plan allows (30% over two
  weeks). Long runs and recovery weeks keep their usual rules."
- Trade-off line: "A faster step brings the earlier weekly level back sooner. Studies comparing
  weekly increases found no clear difference in injuries between steps of about 10% and about 24%,
  but they followed mostly new runners and none followed a return after a break, so the effect here
  is not known. Staying with {10%} is the more cautious choice."

Every string above was run through `lintText` (`shared/copy/lint.ts`) on 2026-10-24 with no hit.
Plan week focus in the zone: "Rebuilding toward {minutes} a week". Revision summary on a change:
"Load setting changed to {position}: weeks ahead add up to {pct} while rebuilding." The checklist
detail keeps its form: "{n} week(s) step above the soft {pct} and carry a warning", with the
position's pct.

Added with the owner's decisions (run through `lintText` on 2026-10-25, no hit):

- Window (taper): "The block ended {weeks} weeks ago, so it counts for {pct} of its size."
- Response: "The last four weeks averaged {mean} a week, above the {planned} planned, so the next week
  builds from {mean}."
- Standard hint, added sentence: "Weeks run above the plan raise the starting point of the next week,
  within the same limits."
- Age cap, drawer: "The setting is held at Standard: age 45 or over."
- Age cap, form: "At age 45 or over, Upper band is held at Standard."
- Revision, target kept: "Week of {date}: the target set by hand, {kept} min, stays; the plan's own
  figure would be {engine} min."
- Revision, target clipped: "Week of {date}: the target set by hand, {asked} min, is lowered to {kept}
  min, the most the limits allow that week (growth over two weeks stays within {pct})."

### 4.7 (f) The response to weeks run above plan

Added by the owner's answer to question 5. Today a week run above its target is taken as run and
lifts nothing: the weeks after it are drawn from the planned minutes (section 2.5, rule G-2, PR
#545). At standard and upper the ramp responds, in a bounded form.

**The rule.** The baseline of a loading week is the higher of two numbers, and the position's step
then applies to it exactly as in section 4.2:

- the planned baseline, as today (the highest of the two preceding loading weeks, `highestBaseline`,
  drawn from the planned minutes after an overshot week);
- the mean of the minutes actually run in the last `g8.responseWeeks` (4) eligible weeks.

```
baseline     = max(planned baseline, mean of actual run minutes over the last 4 eligible weeks)
planned week = soft(baseline), with R and the clamp of section 4.2
```

**Eligible weeks.** Complete weeks, newest first, skipping every week that holds a race and every
week inside a rest window (a disruption window or an injury report). The window reaches back until
it holds four. Recovery weeks count as run, which can only lower the mean, since the planned
baseline wins when it is higher. A state with fewer than four eligible weeks has no response and the
planned baseline stands. The mean reads `runMin` from `state.weeks` and queries nothing new (ADR
0009). It is an absolute number of minutes and forms no ratio (G-5, question 4).

**What it can do, and what it cannot.** It can lift a baseline and never lowers one. It follows what
the runner has done, and lags it: one big week moves a four-week mean by a quarter of its excess. On
the synthetic runner at standard, planned weeks of 100, 110 and 121 minutes and a recovery week of
91, run at 120, 132, 145 and 110, give a mean of 126.75 against a planned baseline of 121, so the
next loading week is measured from 126.75 (4.8% higher). It cannot pass the hard ceiling or G-1,
because both are applied after it, as today.

**Guards.**

1. Off at steady, where an overshot week still lifts nothing, so steady stays today's engine byte
   for byte (question 2).
2. Off wherever the position is forced to steady (section 4.3) and in the weeks the zone excludes:
   programme weeks (floor, ladder, injury return), recovery and taper weeks, post-race and
   disruption windows with their J9 return, and a low-frequency runner.
3. A hold or reduce decision (J5, G-6) wins: the week it covers uses the planned baseline and
   `nextWeekCap` as today.
4. The 30% hard ceiling over two weeks and G-1 are applied after the response and are unchanged. A
   week the response would plan above `allowed` is cut by `rampLimits`, and a session above the G-1
   limit is cut by the generator, as today.
5. Above `R` the step is 10% again, so the response moves where a week starts and not how fast a
   runner who is back at the earlier level keeps growing.

**Param.** `g8.responseWeeks` = 4, grade D, rule g-8 (section 4.5): the length of the typical week
(`a5.typicalWeekCount`) and of the block the owner named. Its default note says that it is a
default.

**More early, less late.** The owner asked whether the lift should be larger early in a rebuild and
smaller late. The rebuild ceiling already gives that shape: below `R` the position's step applies
(12% or 14.0%) and above `R` it is 10% again, so the weekly addition is largest far below the
earlier level and falls to the usual one as the plan nears it. No calendar rule (a step that
shrinks with the week number) is added: it would ignore where the runner stands, and nothing in the
corpus dates it. The response moves the baseline a week starts from and leaves this shape as it is.

**Tests** (section 5.3, H16 to H21): three weeks above plan at standard; one big week damped; race
and rest-window weeks skipped; steady equal to the oracle, overshot weeks included; hold and reduce
winning; the ceiling and G-1 holding across the seeded sweep. Property: the response never lowers a
baseline and never raises it past the larger of the planned baseline and the largest week in its
window.

### 4.8 (g) A raised week target survives a re-plan

Added by the owner's answer to question 9. Today `planWeekWrites` keeps a week override only when it
is at or below the engine's new target for that week; a higher one is replaced by the engine's week,
and the revision shows the change (section 2.6).

**The rule.** At every position, an override above the engine's target is kept at a re-plan within
the step limit. The override is an explicit act of the runner, not a default, so the byte-identical
principle of section 4.1 does not extend to it.

- **The limit** is the largest target the engine's own limits allow for that week, taken from the
  function the generator uses (`rampLimits`: the hard ceiling of 30% over two weeks, with the
  tightened profiles, a progression hold and a post-race or disruption window applied as they are to
  any week). One function, so the generator, the guards, the checklist and this rule agree; task
  L3c checks that profiles, holds and windows are in it and adds them if they are not.
- **Kept or clipped.** A target at or under the limit is kept as set. A target above it is clipped
  to the limit. The revision's diff names each kept week and each clipped week, and a clipped week
  says which limit applied (templates in section 4.6, ADR 0007: the diff and the undo are built from
  the rows actually written).
- **Lowered targets are unchanged.** A target below the engine's is kept and caps the week
  (`weekCaps`), as today.
- **Sessions.** The week's sessions are the engine's, as today; the override stays a target and adds
  none. The weeks after a kept week are planned by the ordinary rules from the kept minutes, so the
  limits apply to them from the raised week and the raise is no way past the ramp (case H22 pins
  it).
- **The route is unchanged.** `PUT /api/plan/weeks/:weekStart` still accepts any whole number of
  minutes with a note. The clip happens at the re-plan, where the revision can explain it. A newly
  generated plan still starts without the earlier overrides.
- **Warning.** A kept target above the soft step carries the existing `progression` warning, like
  any week above it.

**Consequence.** At steady and at standard a raised week can exceed the position's own step, up to
the ceiling, because the runner asked for it by hand; the position governs what the engine plans on
its own.

**Tests** (section 5.3, H22 to H25): a kept target, a clipped target with its explanation, a lowered
target as today, and a target inside a post-race window or under a tightened profile.

### 4.9 Arguments against, and what was not proposed

- **Against the whole proposal.** Everything new is grade D; the corpus principle is that a change
  toward more load needs stronger evidence. The report that the runner can carry more is also the
  situation in which observational associations mislead: runners who tolerate more are the ones who
  run more [abrahamson-2025-self-reported-characteristics]. Sparse running is not protective: fewer
  than two runs a week marks higher injury [abrahamson-2025-self-reported-characteristics]; the
  tissue papers suggest capacity can fall faster than fitness. The proposal answers with defaults
  (steady), a clamp (`R`), and unchanged guards, not with evidence.
- **Against stage 2 alone.** The step buys five to seven weeks on the weekly total and none on the
  long run (table 2). If the owner's aim is the long run, stage 1 is the whole benefit and stage 2
  is optional.
- **Not proposed: a G-1 history reference.** The measured G-1 floor is 20 weeks to a 150-minute long
  run from a 45-minute reference. A reference lifted by history would remove most of it, and that is
  the one step that overrides the engine's best-evidenced guard (grade B, 5205 runners, HRR 1.5 to
  2.3 above the band) on a question the cohort never separated. The practical route inside G-1 is
  the lift (stage 1) and a rebuild of the weekly total that lets the early long runs reach the limit
  sooner. Disagreement stated: do not loosen G-1 on a year of history. The owner agreed and left G-1 as it is
  (question 10).
- **Not proposed: an EWMA chronic-load ceiling.** G-5, the initial-load problem and the coupling
  critique; an absolute block is auditable.
- **Not proposed: an age or experience credit.** The corpus rejects both.
- **Against the response (section 4.7).** It is the second place where a plan moves toward more
  load without an explicit choice each time, although the owner chose the position. Runners who run
  above their plans are also the runners who tolerate more
  [abrahamson-2025-self-reported-characteristics]. One big week lifts the next baseline by a quarter
  of its excess before the position's step applies: a 150-minute week among three 100-minute weeks
  gives a baseline of 112.5 and, at standard, a next week of 126, inside the ceiling but a large
  effect for one run. If the replay shows this, a cap on the response (for example the position's
  step over the planned baseline) is one more Param; it is not included because the owner asked for
  the rule as stated.
- **Against kept raised targets (section 4.8).** A target is a number without sessions, and the rule
  is only as safe as the limit function it reads. At steady a runner can ask for a week well above
  the steady step, up to the ceiling. The ceiling is the engine's own grade C line, and the clip and
  the diff keep the choice visible.
- **Cost.** One new state field, one rule, nine Params, a `RampContext` field read in three places
  (generator, guards, checklist), a change to the baseline in `planWeeks` for the response, a change
  to the override rule in `replan.ts`, one explain builder, one option, one form control, fixtures
  and a sweep. The simpler alternative, stage 1 alone, is one rule change in `startPath` plus the
  block.

## 5. Validation plan

Gates as in the phase 3a plan: `npm run check`, `npm run build`, `npm run test:e2e`. No migration,
so no `docker build .`. The Params change, so the owner validation applies.

**5.1 Byte-identical by default.** The new code must be a no-op with `options.loadAppetite` absent
or `conservative` and no week target raised by hand. A test keeps the pre-change `buildPlan`/`replan` as an oracle on the 4-week
fixture, the matrix, the replan chain and the seeded sweeps, and asserts equal drafts (the method
phase 3a used). `data/validate-owner.ts` then reports the STATUS baseline for the same database
state: 39 weeks, 210 sessions, 0 of 15 checklist failures, label "tight", a 3 × 20 first week and a
9.2 h peak, sessions identical apart from `externalId`. The database and the script's output stay
outside the repository; pull requests quote summary figures only. (The database changes as new runs
arrive, so a new baseline is taken first, on the commit before the change.)

**5.2 The owner's history, used three ways, all outside the repository.**

1. _Replay at three positions and two windows._ The same script runs once per position, and at
   standard and upper once per credit window (12 weeks; 16 weeks with the taper), and prints, per run,
   the
   opening week, the weeks to reach `R`, the weekly path to the old block level, the weeks to the
   first long run at 80% of the block's longest run, the zone weeks, the weeks in which the response of
   section 4.7 moved a baseline and by how much, and the checklist and spike
   counts. The expectation from table 2, for a runner shaped like the synthetic one, is: the opening
   week 90 instead of 60 where the lift applies; the weekly total back at the block level five or so
   weeks sooner at upper; the long run within two weeks of the G-1 floor.
2. _Own-tolerance check (descriptive)._ From the 12 months of activities: the largest weekly and
   two-week increases the runner actually completed, how often they came with a pain or fatigue
   flag, and how the runner's own earlier rebuilds compare with the 12% and 14.0% steps. No new code
   in the engine; a one-off analysis. Its result decides question 3 (the values, provisional until then) for this runner and, with the
   replay, question 7 (which window ships); it proves
   nothing for others.
3. _Back-test of decisions._ From several dates in the last year at which a rebuild began, generate
   the plan at each position and window and compare the planned weeks with what was run in the
   following weeks
   (weeks run at or above plan, overshoot weeks, holds, and how the response would have moved each
   baseline). Descriptive: no injury outcome exists, and
   the app records planned and actual load, which would also support a later target trial emulation
   [wang-2024-target-trial-load].

**5.3 New fixtures and seeded cases** (synthetic, in `tests/unit/engine/history-fixtures.ts`,
following `e8-fixtures.ts`; no personal data):

| Case | Shape                                                                                    | Expectation                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1   | Strong block, sparse weeks since, one year of running (appendix A, S3)                   | Lift at standard and upper; zone to `R`; no spike warning; no checklist failure                                                                                                                        |
| H2   | H1 with three years                                                                      | Same week 1 as steady; zone only                                                                                                                                                                       |
| H3   | Strong block, then a 41-day layoff (S5)                                                  | J7 restart unchanged; zone off while the low-frequency flag holds (about three weeks of three runs), then on                                                                                           |
| H4   | Steady runner, no gap (recent weeks near the block)                                      | `R` below the base; zone never entered; drafts equal across positions                                                                                                                                  |
| H5   | Block older than 16 weeks                                                                | `history` null at both windows; drafts equal to steady                                                                                                                                                 |
| H6   | One 600-minute week among 100-minute weeks                                               | The dropped-week rule keeps H at the steady weeks; no zone credit from the spike                                                                                                                       |
| H7   | Block weeks with one run each                                                            | Not a block (fewer than 2 runs); `history` null                                                                                                                                                        |
| H8   | Recent-injury flag, prior bone stress injury, two BSI factors                            | Position reads as steady with a stated reason; no response; drafts equal to steady                                                                                                                     |
| H9   | REDs hold, focal bone pain (progression hold)                                            | Zone and response off; volume held                                                                                                                                                                     |
| H10  | Low-frequency runner above the floor                                                     | Zone and response off; 2:1 cadence kept                                                                                                                                                                |
| H11  | Age 45 or over (soft flag)                                                               | Lift by block on at standard, the years route still blocked; upper reads as standard with the reason shown; zone on                                                                                    |
| H12  | Ladder novice with no history                                                            | History null; ladder unchanged                                                                                                                                                                         |
| H13  | Plan inside a post-race window; plan with an active disruption window                    | Zone and response off; restart volumes as before                                                                                                                                                       |
| H14  | Re-plan chain: an overshot week, a hold week, a reduce week, then progress               | At steady an overshot week lifts nothing; at standard the response applies; hold and reduce pause the zone and win over the response; zone resumes                                                     |
| H15  | Race 12 weeks away (short horizon)                                                       | Zone ends at the plan's peak ceiling; taper unchanged                                                                                                                                                  |
| H16  | Standard; three weeks run 20% above plan, no flag                                        | Next baseline is the four-week mean of minutes run, above the planned baseline; then the position's step; no week above the ceiling                                                                    |
| H17  | Standard; one 150-minute week among three 100-minute weeks                               | Baseline moves by a quarter of the excess (112.5); the week after stays inside the 30% two-week ceiling                                                                                                |
| H18  | Standard; a race week and a rest-window week among the last four                         | Both skipped; the window reaches back to four eligible weeks; fewer than four in the state: no response                                                                                                |
| H19  | Steady; the weeks of H16                                                                 | Drafts equal the oracle; the overshot weeks lift nothing                                                                                                                                               |
| H20  | Standard; a hold or reduce decision after overshot weeks; a forced-to-steady condition   | The planned baseline stands and `nextWeekCap` applies as today; no response under the flags                                                                                                            |
| H21  | Standard and upper; a mean far above the plan                                            | Weeks cut by the ceiling; no session `override-required` or `spike-warn`                                                                                                                               |
| H22  | Week target raised by hand within the limit, at each position                            | Kept at the re-plan; the revision shows the kept week; later weeks plan from it by the ordinary rules                                                                                                  |
| H23  | Week target raised past the limit                                                        | Clipped to the limit; the diff names the limit                                                                                                                                                         |
| H24  | Week target lowered by hand                                                              | As today: kept, and caps the week (`weekCaps`)                                                                                                                                                         |
| H25  | Raised target in a post-race window, under a tightened profile or in a disruption window | Kept no higher than those rules allow; the diff says which                                                                                                                                             |
| H26  | Peak block that ended 14 weeks ago, modest weeks since                                   | 12-week window: `history` reads the modest weeks since the peak if they form a block, else null. 16-week window: `taper` 0.75 scales `R`; no lift by the old block, which ended more than 12 weeks ago |

Property checks over every case and position: no week above the 30% two-week ceiling; no session
`override-required` or `spike-warn` in a generated plan; the zone step never above 14.0%; steady
equals the oracle; standard and upper are never below steady in cumulative planned minutes up to the
week `R` is reached; the weeks to the first long run never beat the control case (a result below the
G-1 floor is a bug); adding the setting changes no week after the zone ends for a runner who runs
the plan as planned (the response moves a baseline only when the weeks run exceed the plan); the
taper factor is 1 up to 12 weeks and falls in a straight line to the floor at 16; the response never
lowers a baseline and never raises it past the larger of the planned baseline and the largest week
in its window; a raised target is never kept above the limit.

**5.4 What "better" means.** Per case and position, measured by the script and not argued:

1. Fewer weeks to the first long run of the target length (80% of the block's longest run) with no
   `spike-warn` flag, compared with steady; the G-1 floor is the lower bound.
2. Fewer weeks to the weekly level of `R`, with no week above the hard ceiling.
3. No checklist failure in any week, and the `progression` detail names the zone weeks.
4. Week 1 not above the E6 floor or the lift; no change to H4, H5 or H8 cases.
5. No change at all at steady, and a correct reason shown wherever a position is forced to steady
   or capped at standard.
6. The response moves a baseline only when the mean of the minutes run exceeds the planned
   baseline, and never past the ceiling.

A result that satisfies 1 and 2 at upper but misses them at standard is a reason to revisit 0.70 and
12% (question 3), not to raise upper.

**5.5 Other tests.** API tests for the option (`tests/api`, own SQLite file per context): accepted,
stored in `Plan.options`, reused by the weekly re-plan, rejected when unknown; a revision on change.
Page tests by role and name for the form and the drawer; e2e spec `19-load-setting.spec.ts` (the
next free number) driving the form and the drawer text with dates from the clock, no sleeps;
`expectCleanCopy` on every new string; the params test (grade D notes, rule heading in
`engine-rules.md`, `PARAMS_VERSION`); the rule-title and explain coverage tests; the research check.

## 6. Decisions and open questions for the owner

Ranked by how much they change behaviour. Each has a default that the tasks implement. All twelve
were answered on 2026-10-24. Section 7 records the answers; where an answer differs from the
default below, the body above and the tasks in section 8 follow the answer.

1. **The 3 × 30 start from a demonstrated block (stage 1).** Default: yes at standard and upper, no
   at steady. It overturns the "2 years" detail of owner decision 1 and sits against the rule
   "nothing supports looser limits for experienced runners". The year count is a calendar-year
   difference (10 to 22 months); the 365-day history could tighten it to "first run at least 40
   weeks ago". Arguments for: it is worth about seven weeks and keeps every session inside the
   runner's own longest run and G-1. Against: grade D, and one more way to start higher.
   Alternative: amend E6 for everyone with no setting; simplest, but every default plan then changes
   and the validation baseline moves.
2. **The default position.** Default: steady for everyone, so nothing changes until a runner or the
   owner chooses. Alternative: standard for new plans after the validation passes. The README asks
   for stronger evidence before a default moves toward more load; this proposal has none above D.
3. **The values.** Standard 12% and 0.70; upper 14.0% (derived) and 0.85. Accept, or lower. The
   own-tolerance check (5.2) is the input for this runner.
4. **G-5 wording.** Amend G-5 to say that no acute:chronic ratio band gates a plan and that a
   personal ceiling in minutes taken from the runner's own steady weeks is not a ratio, with an ADR
   (0013, task L1). Without the amendment the history credit sits uneasily against "no ratio band
   ... justifies progression".
5. **Data-driven appetite as well.** Should two or more weeks run above plan with no flag, no pain
   and ratings in range raise the step by itself (inside the position's limit)? Default: no, the
   setting is the only lever; an overshot week lifts nothing (G-2). It would be the second place
   where a plan moves toward more load without an explicit choice.
6. **Where the setting lives and how it changes.** Default: a plan option on the Generate form,
   changed by generating again (a new plan drops week overrides and archives the old one). Task L4b
   adds a plan action with a preview and an undo. Alternative: a runner-level setting, which needs a
   migration and a state classification.
7. **The credit window.** Default: 12 weeks, using the 16 weeks the state already holds.
   Alternative: up to 26 weeks or the 52-week history with a smaller credit; that needs a longer
   state window and more evidence than exists.
8. **The J7 pre-break week.** Default: untouched. The proxy (median of four weeks with a run)
   under-reads a block after a taper (section 2.4). Using the block instead would raise the restart
   after a layoff of 7 to 28 days, a larger step toward more load on a table the corpus marks as
   awaiting running evidence.
9. **Raised week targets.** Today a re-plan removes a week target above the engine's. Should a
   raised target be kept when it is within the position's limit, the hard ceiling and G-1? That is
   the cheapest way to ask for more, but it is a number without sessions and bypasses the checklist
   unless the same limits are applied; it is an alternative to the setting, not a part of it.
10. **G-1 history reference.** Default: no. The proposal recommends against offering a session-level
    credit (4.9). If wanted anyway, it is a separate evidence-first change.
11. **Which candidates to add, and how much research.** C1 to C3, C6 to C8 first; whether the topic
    workflow run (section 3.7) is worth its cost.
12. **Age.** The soft flag at 45 blocks the lift route; kept as it is. Say if it should not.

## 7. Owner decisions (2026-10-24)

Recorded from the owner's walkthrough of this proposal on the evening of 2026-10-24 (PR #558). Each
entry gives the answer, the owner's reason where one was given, and where the body applies it. "No
reason recorded" means the owner answered without one and the proposal's own reasoning stands. The
questions stay in section 6 as asked.

1. **Q1, the 3 × 30 start from a demonstrated block: yes**, at the standard and upper positions (a
   year of running and a block of 90 minutes a week or more that ended within 12 weeks). No reason
   recorded. Applied in section 4.2; task L2.
2. **Q2, the default position: steady**, today's engine byte for byte. No reason recorded. Sections
   4.3 and 5.1.
3. **Q3, the values: deferred, so provisional.** Standard 12% and 0.70 and upper 14.0% and 0.85 stay
   as proposed. Reason: the owner wants to read the proposal first, and the own-tolerance replay on
   the owner's data (section 5.2) decides. Marked provisional in sections 4.2, 4.3 and 4.5; task L6.
4. **Q4, G-5: amend the wording and write an ADR, yes.** The ADR is 0013 for this decision; the
   strength design's ADR (E14-1) moves to 0014. No reason recorded. Section 3.3; tasks L0 and L1.
5. **Q5, the ramp responds to weeks run above plan: yes, in a bounded form.** The baseline of the
   next week is the higher of the planned minutes and the trailing four-week mean of the minutes
   actually run, then the position's step applies; race weeks and rest-window weeks are ignored. The
   owner asked whether the lift should be larger early and smaller late; the answer recorded is that
   the rebuild ceiling already gives that shape (the faster step below `R`, 10% above it), so no
   calendar rule is added. Section 4.7; task L3b.
6. **Q6, where the setting lives: a plan option on the Generate form**, with a plan action later. No
   reason recorded. Section 4.3; tasks L4 and L4b.
7. **Q7, the credit window: build both behind a Param and let the owner's replay decide.** One is 12
   weeks at full credit; the other is 16 weeks with credit tapering to half after 12. No reason
   recorded beyond leaving the choice to the replay. The owner's note: a peak block that
   ended more than 12 weeks before the plan is invisible to the 12-week window, which then reads the
   more modest weeks after it; that is the case the 16-week option is for. Section 4.2; tasks L2 and
   L6.
8. **Q8, the J7 pre-break proxy: leave alone for now.** No reason recorded. Sections 2.4 and 4.4.
9. **Q9, raised week targets: yes.** A raised target survives a re-plan within the step limit and is
   shown in the revision; a clipped target is explained in the diff. No reason recorded. Section
   4.8; task L3c.
10. **Q10, a G-1 history reference: none; G-1 stays as it is.** No reason recorded. Section 4.9.
11. **Q11, papers: the six tissue papers first** (De Boer 2007, Kubo 2012, Bohm 2015, Warden 2014,
    Warden 2021, Bertelsen 2017), then a review of the other ten. Online verification is still
    required for every paper. Section 3.7; task L0.
12. **Q12, age 45 or over: the soft flag warns and caps the position at standard** instead of
    blocking the lift route. No reason recorded. Sections 3.5, 4.2 and 4.3; case H11.

### Readings of the answers

Some answers leave a point open. The body adopts the readings below, each the smallest reading of
the owner's words, and the owner may overrule any of them.

1. **The response acts at standard and upper only.** Q2 (steady is today's engine byte for byte) and
   Q5 (the position's step then applies) are read together.
2. **Ignored weeks are skipped, not zeroed.** For Q5 the window reaches back to four eligible weeks.
   Recovery weeks count as run, because the owner named only race weeks and rest-window weeks.
3. **The "step limit" of Q9 is the limit the engine already applies to every week** (the hard
   ceiling of 30% over two weeks, with profiles, holds and windows), and not the position's soft
   step. At steady the soft step is what the engine plans by itself, so reading it as the limit
   would make a raise impossible.
4. **Q9 applies at every position**, because a raised target is an explicit act of the runner.
5. **The lift route reads a block that ended within 12 weeks, whichever window ships.** Q1 names 12
   weeks; the taper of Q7 scales `R` only.
6. **The taper of Q7 is linear** from full credit at 12 weeks to half at 16.
7. **Q12 changes the block route only.** The years route (E6 path 2) is unchanged, and the age flag
   still blocks it.

## 8. Task list

Style as in the phase 3a plan: one task per engineer, own worktree from `origin/main`, test first; a
task starts when its dependencies have merged. **Validation** means the owner validation runs
(`data/validate-owner.ts`) and the pull request quotes the summary only. The research-update task is
first. Tasks L3b and L3c were added with the owner's answers to questions 5 and 9.

### Task L0: Research update for load history and retraining

Size M. Depends on: nothing. Skill: `research-update`. Two sessions (question 11): the first adds
the six tissue papers (C1, C2, C3, C6, C7, C8); a later one reviews the other ten (C4, C5, C9 to C16).

- **Files:** `research/papers/<id>.json` for the papers of the session (section 3.7),
  `research/topics/{injury-load,beginners-return,age-masters}.md` (or a new topic through the
  workflow, section 3.7), `research/rules/*.json`, `research/engine-rules.md`, `research/README.md`
  (method entry 9), `docs/STATUS.md`.
- **Acceptance:**
  - Each added paper was looked up in the session (Crossref and abstract), its record has every
    field, `verification.checkedAt` is that day, and the DOI check passes
    (`npm run research:verify -- <ids>`); a paper that cannot be verified is left out.
  - `engine-rules.md` gets rule **g-8** with the definitions of sections 4.2 and 4.7, grade D as a whole, the
    evidence and the arguments against; E6 path 2 gets the second route (marked proposed until L2
    lands); G-5 gets the clarification of question 4 (approved); G-2 and J7 gain a pointer; the
    numeric table gets the g8 rows; "Top evidence gaps" and "What would change these rules" name the
    three gaps of section 3.6.
  - No Param, no code and no `PARAMS_VERSION` change in this task; `npm run research:check` and
    `npm run check` pass.

### Task L1: ADR 0013, history-informed rebuild and the load setting

Size S. Depends on: L0.

- **Files:** `docs/adr/0013-history-informed-rebuild-and-load-setting.md`, `docs/STATUS.md`.
- **Acceptance:** the status reads "Accepted 2026-10-24 (#<number of the pull request that adds
  it>)" (the owner decided on 2026-10-24; the merge shows who accepted); each reason carries a Fact,
  Rule, Opinion or Preference label; it records the answers to questions 1, 2, 4, 5, 6, 7, 9 and 12,
  the G-5 wording (including the trailing mean of section 4.7), the guards that stay (G-1, the 30%
  ceiling, G-3, ADR 0005, ADR 0007), the alternatives of section 4.9, and that the strength design's
  ADR is numbered 0014.

### Task L2: The history block and the 3 × 30 start from capacity (stage 1)

Size M. Depends on: L1. **Validation.**

- **Files:** `shared/engine/types.ts` (`AthleteState.history`,
  `EngineInput['options'].loadAppetite`), `shared/engine/athlete.ts`,
  `shared/engine/params/g-limits.ts` (`g8.blockWeeks`, `blockWeeksDropped`, `creditWindowWeeks`,
  `creditTaperEndWeeks`, `creditTaperFloor`),
  `shared/engine/params/index.ts` (`PARAMS_VERSION`), `shared/engine/macro.ts` (`startPath`: the block route and the age exception),
  `shared/engine/explainInputs.ts` (E6 facts), `server/routes/plan.ts` (`generateBody.options`),
  `server/serialize.ts` (`parsePlanOptions`), `shared/types.ts`,
  `tests/unit/engine/{athlete,start-paths,params}.test.ts`, `tests/unit/engine/history-fixtures.ts`,
  `tests/api/plan.test.ts`.
- **Acceptance:** the block follows section 4.2 on H1, H2, H5, H6, H7 and H26, at both windows and
  with the taper (the 16-week option reads its weeks from the snapshot's activities, no new query);
  the lift route follows questions 1 and 12 and is off at steady and under every excluded profile
  (H8), and on at standard for age 45 or over with upper read as standard (H11); steady equals the
  oracle; the plan's checklist passes on every case; `PARAMS_VERSION` bumped and pinned in
  `params.test.ts`; the option is validated by Zod, stored in `Plan.options` and reused by the
  re-plan; standard and upper differ from steady only by the lift until L3; the owner validation at
  steady is byte-identical to the new baseline.

### Task L3: The rebuild zone (stage 2)

Size L. Depends on: L2. **Validation.**

- **Files:** `shared/engine/limits.ts` (`rebuildStep`, `RampContext.rebuild`, `rampLimits`),
  `shared/engine/macro.ts` (`planWeeks`: `stepCap`, `wanted`), `shared/engine/guards.ts`
  (`rampWeek`), `shared/engine/checklist.ts` (`progression` detail), `server/services/replan.ts`
  (decision `ramp`), `shared/engine/params/g-limits.ts` (`creditStandard`, `creditUpper`,
  `stepStandard`), tests under `tests/unit/engine/` (`history-rebuild.test.ts`, matrix and
  replan-chain extensions).
- **Acceptance:** H1, H3, H4, H9, H10, H13, H14 (without the response, which is L3b), H15 and H26
  behave as section 5.3 says; the taper scales `R` as section 4.2 says; the property checks of 5.3
  hold in a seeded sweep that runs in CI under 60 seconds; the three `RampContext` builders share one
  function; no new checklist item; the weeks to the long run never beat the control floor; steady
  equals the oracle.

### Task L3b: The response to weeks run above plan

Size M. Depends on: L3. **Validation.**

- **Files:** `shared/engine/macro.ts` (`planWeeks`: the baseline of a loading week, `replanAnchor`),
  `shared/engine/limits.ts` (`highestBaseline`, `plannedMinOf`, or one new function beside them, so
  that the generator, the guards and the checklist read one baseline), `shared/engine/index.ts`
  (`takenAsRun`, unchanged flags), `shared/engine/params/g-limits.ts` (`g8.responseWeeks`),
  `server/services/replan.ts` (the decision `ramp`), tests under `tests/unit/engine/`
  (`history-rebuild.test.ts`, matrix and replan-chain extensions).
- **Acceptance:** H16 to H21 behave as section 5.3 says; at steady the drafts equal the oracle,
  overshot weeks included; hold and reduce win over the response; `takenAsRun` still flags
  `overshoot` and `planned-<n>`; no new checklist item; the three baseline readers share one
  function; the property checks of 5.3 hold in the seeded sweep; the Param has a default note that
  passes the G5 lint.

### Task L3c: A raised week target survives a re-plan

Size M. Depends on: L1 (parallel with L2 and L3). **Validation.**

- **Files:** `server/services/replan.ts` (`planWeekWrites`), `shared/engine/limits.ts` (the limit
  function, reused and, where profiles, holds or windows are missing from it, completed),
  `shared/copy/revision.ts` (the kept and clipped templates), `tests/api/plan.test.ts`, replan-chain
  tests under `tests/unit/engine/`.
- **Acceptance:** H22 to H25 behave as section 5.3 says; the existing test that expects a higher
  override to be replaced is changed to the new rule and a regenerated plan still drops overrides;
  the diff names each kept and each clipped week and the limit that applied; the diff and the undo
  are built from the rows actually written (ADR 0007), so an undo restores the override as it was;
  the revision strings pass the G5 lint and `expectCleanCopy`; the route `PUT
/api/plan/weeks/:weekStart` is unchanged.

### Task L4: The load setting

Size M. Depends on: L3. No Docker (no migration).

- **Files:** `web/pages/PlanPage.tsx` (the Generate form), `web/api/plan.ts`, `shared/types.ts`,
  `tests/web/PlanPage.test.tsx`, `tests/e2e/19-load-setting.spec.ts`.
- **Acceptance:** the form offers the three positions with their hints and the trade-off line; the
  chosen position reaches the plan and is kept by the weekly re-plan and the "Update plan from
  latest data" action; a position forced to steady, or capped at standard at age 45 or over, shows its reason; the e2e spec drives the form by
  role and label. **L4b** (separate PR, optional): a plan action that changes the position through
  preview and commit with an undo.

### Task L5: Copy and the Why drawer

Size M. Depends on: L3, L3b and L3c (parallel with L4).

- **Files:** `shared/copy/explainTemplates.ts`, `shared/copy/revision.ts`,
  `shared/engine/explainInputs.ts` (builder `g-8`), `web/components/ruleTitles.ts`,
  `web/components/WhyDrawer.tsx` if the trade-off line needs a slot, tests for the lint and the
  coverage.
- **Acceptance:** every string in section 4.6, the added ones included (window, response, age cap,
  kept and clipped targets), is a template over Param values, passes the G5 lint and
  `expectCleanCopy`; the drawer shows the block, the taper, the zone, the response, the position,
  the held or capped reason, the limits line and the trade-off; `g-8` has a title and exactly one
  builder.

### Task L6: Fixtures, sweep and owner validation

Size M. Depends on: L3, L3b and L3c. **Validation.**

- **Files:** `tests/unit/engine/history-fixtures.ts`, `tests/unit/engine/history-rebuild.test.ts`,
  the owner validation script and database (outside the repository), `docs/STATUS.md`.
- **Acceptance:** all cases of 5.3 (H1 to H26) exist and pass; the owner replay, the
  own-tolerance check and the back-test of 5.2 are run at the three positions and, at standard and
  upper, at both credit windows; the PR quotes summary figures only; the numbers decide question 3
  (the provisional values) and question 7 (the shipped value of `g8.creditTaperEndWeeks`), and show
  what the response of section 4.7 would have done.

### Task L7: Close

Size S. Depends on: L1 to L6, L3b and L3c.

- **Acceptance:** `npm run check`, `npm run build`, `npm run test:e2e`; an adversarial review of the
  merged diff with an added lens, **evidence honesty** (no sentence or Param note claims more than
  grade D, none says a limit prevents an injury or that the response or a raised target is safe,
  G-5 and G-1 unchanged); ADR 0013 accepted; `docs/STATUS.md` updated with the baseline, the
  setting's default, the shipped window and values, and the open questions.

## Appendix A. The synthetic runner and how the numbers were produced

- **Profile** (`tests/unit/engine/e8-fixtures.ts`): born 1985, no injuries, all days available,
  `runningSinceYear` 2025 (S3, one year) or 2023 (three years); no height or weight.
- **History:** 13 summer weeks from 2026-06-01, four runs a week (45, 50 and 40 minutes plus a
  Saturday long run of 130 to 150 minutes), 265 to 285 minutes a week. The cases differ after it.
  S3: runs of 40 minutes (2 Sep), 45 (9 Sep), 35 (13 Sep), 30 (22 Sep), 35 (26 Sep), 40 (1 Oct), 30
  (8 Oct), 45 (14 Oct) and 30 (18 Oct), none in the week of 2026-10-19; that is weeks of 40, 80, 0,
  65, 40, 30, 75 and 0 minutes, and a longest run of 45 minutes in the last 30 days. S4 (control):
  five 45-minute runs a week for eight weeks, so the 30-day longest run is 45 minutes and weekly
  time never limits. S5: the first three S3 runs only, nothing after 2026-09-13 (a 41-day layoff on
  2026-10-24).
- **Goal:** a synthetic 100-mile trail goal on 2027-05-29 (class `ultra100mi`, 2500 m of gain);
  today is 2026-10-24.
- **Engine:** `buildPlan(input)` from `shared/engine/index.ts` on `bfb6c9f2`, no state beyond the
  history, options empty. Table 2 overrode `P.g2.rampSoft.value` inside the throwaway process to 12%
  and 14%; nothing in the repository changed. The H of 280 is the mean of the three lowest weeks of
  the best four-week window ending within 12 weeks (weeks of 2026-08-03 to 2026-08-24).
- **Reproduction:** the script is a few dozen lines importing the fixtures above; the task L6
  fixtures replace it with committed tests. The first table's entries move by up to a week with the
  race date because the recovery weeks are counted back from the race.
