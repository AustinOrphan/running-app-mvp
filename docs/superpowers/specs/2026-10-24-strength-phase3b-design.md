# Strength programming (phase 3b, E14) — design

Status: Proposed 2026-10-24; owner decisions recorded 2026-10-24 (section 18). Written under the
owner's direction of 2026-10-23 (section 1.1) as the first epic of phase 3b, after the phase 3a
close (`docs/STATUS.md`, follow-up 18). Decisions are the builder's unless marked **owner**;
section 15 lists every decision with its reason and section 16 lists the questions that the owner
has since answered. Section 18 records the answers and the changes they made. The task list is
section 17; phase 3a kept its plan in a file of its own, and this list moves to
`docs/superpowers/plans/` unchanged when the epic is scheduled.

This document decides rules, data, flows, copy and tests for strength programming. It does not
restate the rule numbers in `research/engine-rules.md`; where it adds a number, the number is a
`Param` with a grade and evidence ids (section 5.4), and where the evidence is thin the number is
grade D and says so (section 4.4). Every claim about the code was checked against `main` at
`bfb6c9f2` on 2026-10-24. The one behaviour found there that the design changes, a strength block
that restarts at every re-plan, is in section 1.2.

## 1. Purpose and mandate

### 1.1 The owner's direction

On 2026-10-23 the owner said: "Strength training part of the app needs a lot of work with specific
exercises weight rep recording and tracking and suggestions", and, on the order of work, "users
should be able to select equipment and provide history and that kinda stuff." The agreed order was
the distance estimate first (STATUS follow-up 17), then strength as the first phase 3b epic
(follow-up 18). The standing mandate of 2026-10-22 applies: a professional, research-informed,
self-adjusting coach, better than Strava and Runna.

On 2026-10-24 the owner answered the 16 open questions of section 16 (section 18). Two of the
answers set requirements that run through the design: equipment is a setting that can be changed at
any time (section 6.5), and the logging and the history must be good enough to replace a dedicated
lifting app (section 1.4).

### 1.2 What exists today

Checked on `main` at `bfb6c9f2`:

- **A strength session is a label.** The planner places `strength` sessions (`macro.ts` sets the
  weekly count, `micro.ts` `planStrength` picks the days). A session has the title "Strength", 30
  minutes (`fplace.strengthSessionMin`), an empty `structure`, the zone `strength`, an expected
  effort of 4 to 6 on CR-10 (`expectedRpe.strength`), the rules `F-lib`, `F4` and `E5`, and one
  sentence (`heavyStrengthPurpose()` in `sessions.ts`): "Heavy strength: 3 exercises of 3 sets of 5
  reps at 80% of 1RM or more, with heavy calf raises. Ramp in over 3 weeks and keep it 3 h from a
  key run." The sentence restates five Params and names no exercise, load or plyometric work.
- **The block is counted from the first week of every plan.** `macro.ts` (lines 1171 to 1192) flags
  the first `blockLen` weeks `strength-block`, where `blockLen` is the smaller of
  `e5.strengthBlockWeeks` (12) and the non-specific weeks before the taper, and zero when those are
  fewer than `e5.strengthBlockMinWeeks` (8). It never reads the replaced plan's flags, and a re-plan
  regenerates from the current week (`firstMonday` in `macro.ts`). A probe on 2026-10-24
  (`buildPlan` on the matrix athlete `first-100-mile` of `tests/unit/engine/matrix-fixtures.ts`,
  `today` moved forward by 0, 7, 28, 56 and 84 days) gave 12 flagged weeks at 0, 7 and 28 days, 11
  at 56 days and none at 84 days. A runner re-planned every week therefore meets the first week of a
  new block every week until fewer than 8 non-specific weeks remain: the block lasts the
  non-specific weeks at plan start minus 7 (12 weeks for 19, 5 weeks for 12, 23 weeks for 30),
  which agrees with rule E5 (10 to 14 weeks, grade A) only from 17 to 21 such weeks. Section 8.3
  fixes it.
- **Frequency.** With `strengthPreference` 2 the same plan holds 2 sessions a week for the 12 block
  weeks, 1 a week for the next 16 weeks (the last of them a taper week) and none in the race week or
  the five post-race weeks. `macro.ts` takes `min(flib.strengthPerWeek, strengthPreference)` in the
  block and `min(that, e5.strengthMaintenancePerWeek)` after it, so the Profile choices "Some" (2)
  and "A lot" (3) both plan 2.
- **Placement.** `planStrength` allows an open day that carries no hard run, no long run and is not
  the day before the first long-run day, with room for the session after the day's run
  (`capMin - run minutes >= 30`). It prefers days that already hold a run, then days apart from the
  other strength day, then the earlier day. A session on a run day is ordered after the run
  (`order` 1). No clock time exists on a `PlanSession`, so "3 h from key runs" holds by construction
  (a different day from every key run), not by a measured gap. In the probe, week 0 puts a session
  on the Sunday after the Saturday long run.
- **Logging.** There is none beyond a generic activity: the Done sheet logs a `strength` activity
  with a duration and an effort (`doneEntryFor`, `DoneSheet`), and `compatible` in `execution.ts`
  links it to a strength session. Strava (`WeightTraining`), Apple Health and intervals.icu imports
  also arrive as `strength` activities with a duration and no sets.
- **Surfaces.** Today names strength only in "Also today: Strength (30 min)" under a run, and makes
  it the hero when it is the day's only session (`mainSession` in `server/services/today.ts`). The
  Plan page and the Review page count sessions ("2 of 2 strength sessions"). The Profile asks how
  much strength work to include (none, a little, some, a lot).
- **Params that nothing reads.** `h10.strengthBlockWeeks`, `h10.strengthSessionsPerWeek`,
  `flib.plyoContactsMax`, `flib.plyoEmphasisPaceKmh`, `flib.hipCoreSessionsPerWeek` and
  `h5.kneeExtensorForceLossPct` have no reader outside the registry; `flib.heavyRampInWeeks`,
  `heavyExercises`, `heavySets`, `heavyReps`, `heavyMinPct1rm` and `f4.strengthSeparationHours` are
  read only to build the sentence above. No plyometric, calf, hip or trunk work is placed anywhere,
  and the `mobility` session kind exists in the library but no code places one.

### 1.3 What the epic delivers

"Incredible" for strength means four things:

1. **A session is a workout.** Named lifts with sets, a rep range, a load and an effort target, built
   from the runner's equipment and the point in the block, deterministic and shown identically on
   every surface.
2. **Logging that costs under a minute.** A sheet that opens already filled with the suggestion; the
   common session is a few taps; weight, reps and reps-in-reserve are recorded per set.
3. **Suggestions that explain themselves.** The next load follows from the runner's own sets by a
   small set of written rules, and the Why drawer states the sets behind it.
4. **Honest and evidence-graded.** Every number has a grade; the thin ones say so; no promise of
   speed, no injury-prevention claim, and nothing blames (G5).

### 1.4 The bar (owner, 2026-10-24)

The owner has used Strong and may use it again unless the logging and the history here are good
enough to skip it (section 18, question 4). So v1 has no importer (section 2.2), and the logging and the history must
be good enough that a runner can leave a dedicated lifting app for this programme. That bar needs
four things, each already in this design and each an acceptance criterion:

1. **Pre-filled sets.** The sheet opens filled with the suggestion, with "As suggested" and "Same as
   last time" (section 9.1).
2. **Sub-minute logging.** A session logged as suggested takes at most 3 interactions, and at most
   12 with two changed sets and one reps-left value per lift (sections 9.1 and 13).
3. **A per-lift history with the estimated maximum.** A table by date and a line of the estimated
   maximum, labelled an estimate (section 11.3).
4. **Suggestions with reasons.** The next load follows from the runner's own sets by written rules,
   and the Why drawer shows the sets behind it (section 10).

What this design does not have, and a dedicated app does: a rest timer, a plate calculator, logged
warm-up sets (the sheet says they are not logged), upper-body lifts and any exercise outside the
catalogue (question 11). The bar therefore holds for the lower-body programme of this epic, and a
runner who also lifts other things keeps an app for those. Whether the bar is met is the owner's
judgement after a month of use (task C2). If it is not, the first additions are a rest timer and a
plate calculator, in a later task that this design does not plan.

## 2. Scope and non-goals

### 2.1 In scope

| Part                    | What                                                                          | Section |
| ----------------------- | ----------------------------------------------------------------------------- | ------- |
| Research base           | Rules, Params and papers; the gaps and their defaults; rule text F7 to F9     | 4       |
| Shared contracts        | One derived workout, loads in grams, rule ids, Params, copy                   | 5       |
| Setup                   | Equipment, weight unit, lifting history, optional anchors, exercises to avoid | 6       |
| Exercise library        | A fixed catalogue with ladders, substitutions and a bodyweight path           | 7       |
| Templates and placement | Ramp-in, heavy, lighter week, maintenance, taper; the block anchor; F4        | 8       |
| Logging                 | The sheet, the data model, the API, offline                                   | 9       |
| Suggestions             | Rule-based loads, the first session, the Why drawer                           | 10      |
| Surfaces                | Today, the sheet, the Strength page, history, settings, copy                  | 11      |
| Tracking and review     | The weekly review, a skipped session, how the plan reacts                     | 12      |

### 2.2 Non-goals

- **A general-purpose gym app.** No upper-body programming, no body-part splits, no custom
  programmes, no sharing. The catalogue serves one purpose: lower-body and trunk strength for a
  runner, with an ultra runner in mind (the owner's goal race is a 100-mile trail race).
- **A video or image library.** Each exercise has a name and one or two sentences of text cues.
- **Free-text exercises in v1.** The reasons are in section 7.5; the owner decided on 2026-10-24
  that an exercise outside the catalogue stays out of v1 (section 18, question 11).
- **A maximal-effort test.** The app never asks for a one-rep-max attempt. A maximum is estimated
  from submaximal sets, or entered by a runner who already knows one (section 6.3).
- **Strength on the watch or in the calendar feed.** Publishing carries run sessions only
  (CLAUDE.md, Providers).
- **Importing another lifting app in v1.** Past sessions can be entered by hand (section 6.4). The
  owner decided on 2026-10-24 that there is no importer in v1 (question 4); the bar that replaces it
  is in section 1.4.
- **A change to running load.** No rule here touches the weekly ramp, the session spike guard or any
  run minute. Strength minutes are not running time (`isRunningTime` in `shared/engine/index.ts`).
- **A promise.** No race-time gain, no VO2max or threshold claim, no injury-prevention claim
  (section 4.5).
- **A model-written workout or sentence.** ADR 0005 and ADR 0010.
- **The weekly brief.** `WeeklyBrief.facts` and `BRIEF_VERSION` stay as they are; strength shows in
  the Review page and on its own page (section 12).
- **Export of sets.** The activity CSV (`GET /api/activities/export.csv`) carries no sets; the
  data-ownership epic (E17) should add them.

### 2.3 Anti-goals

- A load suggestion whose reason the runner cannot read.
- A strength log that changes a run, a week's running minutes or a stored session.
- Two definitions of one thing: a second one-rep-max estimator, a second weight formatter, a second
  exercise list, a second readiness test, a second block counter.
- "PR", "personal best", streaks, badges, red states and "failed" or "missed" sets (G5).
- A request for a maximal attempt, or a suggestion above 90% of the estimated maximum.
- A stored prescription that can drift from the rules that produced it.

## 3. Standing constraints

The constraints of the phase 3a design (section 3 there) bind this epic unchanged: ADR 0005 and
0010, Params with grades and cited papers, thin routes with Zod, errors as `HttpError`, migrations
committed, the snapshot and data-version rules, the G5 lint, tests by role and accessible name, and
the gates. In addition:

- **Engine.** `shared/engine/strength.ts` is pure: no clock, no I/O, no randomness; `today` and the
  history arrive as arguments. Every number in it is a `Param`; a source scan fails on a literal
  equal to a value of the `f7`, `f8` and `f9` groups, and a second on a figure inside a string of
  the copy (the two scans that guard `fuel.ts` in `tests/unit/engine/fuel.test.ts` are the model).
- **Data.** A new Prisma model is added to `STATE_MODELS` or `NON_STATE_MODELS` in
  `server/dataVersion.ts` in the PR that adds it. Callers never bump the data version. Athlete data
  comes from `loadAthleteContext` and `memoByVersion`; the strength tables are read through one
  memo (`strength.state`), as the fuel tables are.
- **Units.** Distance, duration and dates are as in ADR 0003. A load is stored in grams, an integer,
  and shown in the runner's weight unit (section 5.2).
- **Environment.** No new environment variable and no new runtime dependency.
- **Privacy.** Synthetic fixtures only: no real lifting history, equipment, injuries or names.
- **Copy.** Strength text is a template in `shared/copy/` and passes the one lint. The words "PR",
  "personal best", "failure", "fail", "missed", "crush" and "smash" never appear, which rules out
  most of the usual lifting vocabulary (section 11.6).
- **Safety.** G6 applies: where rules collide the more conservative wins, and a change toward more
  load needs stronger evidence than a change toward less.

## 4. The research base

### 4.1 Rules and Params that exist

`research/engine-rules.md` holds the strength rules below and `shared/engine/params/` the numbers.
The last column says whether code outside the registry reads the Param today (searched on
2026-10-24).

| Rule                 | Statement                                                                                                | Param (value, grade)                                                                                                                                       | Read today                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| E5 fixed blocks      | A 10 to 14 week heavy-plus-plyometric block in base and early build (A), then 1 maintenance session (D)  | `e5.strengthBlockWeeks` 12 (A, range 10-14); `e5.strengthBlockMinWeeks` 8 (A); `e5.strengthMaintenancePerWeek` 1 (D)                                       | Yes, `macro.ts`                                |
| F-lib heavy strength | At least 80% 1RM (90% where tolerated); 2-4 exercises x 3-4 sets x 3-6 reps (D); 2-4 week ramp-in (D)    | `flib.heavyMinPct1rm` 80 (A method, D dose); `heavyExercises` 3; `heavySets` 3 (3-4); `heavyReps` 5 (3-6); `heavyRampInWeeks` 3 (2-4); the last four are D | Only to build the purpose sentence             |
| F-lib plyometrics    | 200 contacts or fewer a session (the highest dose observed); emphasise at 12 km/h or slower              | `flib.plyoContactsMax` 200 (A); `flib.plyoEmphasisPaceKmh` 12 (A)                                                                                          | No                                             |
| F-lib hip and core   | Before runs, for novices, 2-3 a week (dose D)                                                            | `flib.hipCoreSessionsPerWeek` 2 (D)                                                                                                                        | No                                             |
| F-lib frequency      | 2 a week, range 2-3; maintenance 1                                                                       | `flib.strengthPerWeek` 2 (A, range 2-3)                                                                                                                    | Yes, `macro.ts`                                |
| F-lib session length | Placement default of a strength session                                                                  | `fplace.strengthSessionMin` 30 (D)                                                                                                                         | Yes, `micro.ts`                                |
| F4 placement         | At least 3 h from key runs, preferably easy days, never directly before the long run (A, low confidence) | `f4.strengthSeparationHours` 3 (A)                                                                                                                         | Only to build the purpose sentence             |
| H5 eccentric note    | Eccentric-biased strength inside the block; knee-extensor force fell 29-38% after 110 km; no dose (D)    | `h5.kneeExtensorForceLossPct` [29, 38] (D)                                                                                                                 | No                                             |
| H10 strength         | A 12-week block, 2 a week, slow-speed plyometric emphasis, knee-extensor and plantar-flexor work (C)     | `h10.strengthBlockWeeks` 12 (C); `h10.strengthSessionsPerWeek` 2 (C)                                                                                       | No                                             |
| Execution            | Expected effort of a strength session                                                                    | `expectedRpe.strength` [4, 6]                                                                                                                              | Yes, `execution.ts`, `adapt.ts`, `standout.ts` |

The rule ids of Params are checked against the headings of `engine-rules.md` by
`tests/unit/engine/params.test.ts` (`F-lib` is the exception), so a new rule needs a heading there
before its Params can exist (section 5.3).

### 4.2 What each paper supports

Every paper below is in `research/papers/`. "Grade" is the corpus evidence level.

| Paper                                            | Design, grade         | What it supports here                                                                                                                                                                    | Limit that matters                                                                         |
| ------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `llanoslagos-2024-economy-speeds`                | Meta-analysis, A      | High-load work (80% 1RM or more) improved running economy (ES -0.266); plyometrics improved it at 12 km/h or slower (ES -0.307); submaximal and isometric work did not                   | Small to moderate effects; certainty low for combined methods                              |
| `llanoslagos-2024-performance-methods`           | Meta-analysis, A      | High-load training improved running performance (ES -0.469), combined methods more (ES -1.035); no method moved VO2max; sessions a week and weeks did not moderate                       | Very low to moderate certainty; moderators may be underpowered                             |
| `eihara-2022-heavy-vs-plyo`                      | Meta-analysis, A      | Heavy resistance beat plyometrics on economy (g -0.32 against -0.13); 10-14 weeks beat 6-8 (g -0.45 against -0.21); 90% 1RM or more g -0.31                                              | Wide intervals; misprints in the abstract; disagrees with Llanos-Lagos on slow-speed plyos |
| `denadai-2017-explosive-heavy-economy`           | Meta-analysis, A      | Concurrent strength training improved economy by 3.9%; explosive 4.8%, heavy 3.7%; isometric not significant; longer programmes did better                                               | Exploratory meta-regression on 20 effects                                                  |
| `balsalobre-2016-running-economy-highly-trained` | Meta-analysis, A      | Source of the dose: 2-4 lower-body exercises plus up to 200 jumps and 5-10 short sprints, 2-3 times a week for 8-12 weeks, in 93 highly trained runners (SMD -1.42)                      | Five small trials; the pooled effect is an upper bound                                     |
| `blagrove-2018-strength-determinants`            | Systematic review, A  | Economy improved 2-8% across 24 controlled studies; 2-3 sessions a week; VO2max and body composition unchanged                                                                           | Narrative synthesis; recommendation, not a tested dose                                     |
| `berryman-2018-strength-performance-meta`        | Meta-analysis, A      | A strength mesocycle gave a moderate performance gain (SMD 0.52); maximal-force training beat other intensities                                                                          | Pools running with cycling, skiing and swimming                                            |
| `storen-2008-maximal-strength-economy`           | RCT, C                | The one template: half-squats, 4 sets of 4RM, 3 times a week for 8 weeks, 17 runners; 1RM +33.2%, economy +5.0%, time to exhaustion +21.3%                                               | One lift, 8 in the lifting arm, laboratory outcomes                                        |
| `zanini-2025-strength-economy-durability-rct`    | RCT, B                | Maximal strength plus plyometrics twice a week for 10 weeks kept economy during a 90-minute run (-2.1% against +0.6%) and raised time to exhaustion after it (+35% against -8%)          | 28 well-trained men; a laboratory run                                                      |
| `giovanelli-2017-ultra-sep`                      | Controlled trial, C   | A 12-week home-based strength, explosive and plyometric programme lowered energy cost 3.2-6.4% in 25 male ultra-marathoners                                                              | Randomisation not stated; no performance or injury outcome                                 |
| `eihara-2024-middle-aged-pt-rt`                  | RCT, C                | Plyometric or resistance training (leg press, leg curl, calf raise at 50-90% 1RM) twice a week for 10 weeks gave 2.0% lower oxygen cost; the calf-raise 1RM change correlated (r -0.477) | 20 runners, no running-only control; the only calf-specific datum                          |
| `piacentini-2013-masters-runners`                | RCT, C                | Master runners aged 43-45: maximal strength training raised 1RM 16.3% and economy 6.2% at marathon pace                                                                                  | 5-6 per arm; self-described preliminary                                                    |
| `pastor-2022-trail-determinants-distances`       | Cross-sectional, C    | At 101 km, performance was explained by VO2max, maximal isometric strength and body fat                                                                                                  | 16 finishers; laboratory predictors                                                        |
| `schumann-2022-concurrent-compatibility`         | Meta-analysis, A      | Concurrent training did not compromise maximal strength or size; explosive strength fell more when sessions shared a session than when 3 h apart; no age or frequency effect             | Strength outcomes, not running                                                             |
| `wilson-2012-concurrent-interference`            | Meta-analysis, A      | Interference with running (not cycling) grew with endurance frequency and duration                                                                                                       | Pre-2012; strength outcomes                                                                |
| `lauersen-2014-exercise-injury-prevention`       | Meta-analysis, A      | Strength training RR 0.315 for sports injuries; stretching no benefit                                                                                                                    | Not running-specific                                                                       |
| `lauersen-2018-strength-dose-dependent`          | Meta-analysis, A      | RR 0.338 across six trials; more strength volume went with fewer injuries                                                                                                                | Post-hoc dose-response; not running-specific                                               |
| `toresdahl-2020-nyc-marathon-rct`                | RCT, B                | A 10-minute self-directed programme three times a week for 12 weeks did not change overuse-injury non-completion (RR 0.97)                                                               | Low load, self-directed, first-time marathoners                                            |
| `leppanen-2024-hip-core-novice`                  | RCT, B                | Hip and core exercises before runs lowered injury in novices (HR 0.66)                                                                                                                   | Dose not in the abstract; novices                                                          |
| `spiering-2021-minimal-dose`                     | Narrative review, D   | Strength and size were kept for up to 32 weeks with 1 session a week and 1 set per exercise at kept relative load; older people may need 2 sessions and 2-3 sets                         | General population; no athletes                                                            |
| `mujika-2000-detraining-part2`                   | Narrative review, D   | Force production declines slowly; reduced training keeps adaptations when intensity is kept                                                                                              | Not running-specific                                                                       |
| `temesi-2015-female-neuromuscular-fatigue`       | Cross-sectional, C    | Knee-extensor torque fell 29-38% after a 110 km race                                                                                                                                     | 20 finishers, one race                                                                     |
| `millet-2011-ultramarathon-neuromuscular`        | Prospective cohort, C | Knee-extensor and plantar-flexor force fell 35% and 39% after 166 km; back to baseline at 16 days, mostly by day 9                                                                       | 11 runners followed                                                                        |
| `mchugh-2003-repeated-bout`                      | Narrative review, D   | One eccentric bout protects against damage in later bouts                                                                                                                                | No dose or duration                                                                        |
| `mckean-2006-masters-injury`                     | Cross-sectional, C    | Calf, Achilles and hamstring injuries were more common in masters runners                                                                                                                | Retrospective self-report                                                                  |
| `hawkins-2003-vo2max-decline`                    | Narrative review, D   | Lean mass can be partly kept with age; strength training is recommended                                                                                                                  | Review                                                                                     |
| `jones-2025-resilience-training`                 | Narrative review, D   | Heavy strength and plyometric training appear to help resilience                                                                                                                         | The review calls its data scant                                                            |
| `bosquet-2007-taper-meta-analysis`               | Meta-analysis, A      | Endurance tapers worked with volume cut 41-60% and intensity and frequency kept                                                                                                          | Endurance training, not strength: used as an analogy only (section 8.2)                    |

### 4.3 Rules in the topic files that the engine rules do not carry yet

`research/topics/strength-plyometrics.md` (and the masters, ultra and durability topics) hold six
rules that `engine-rules.md` does not state, the first six bullets below. The other five restate
rules that it does state; they are listed for the evidence ids that the matching Params do not cite
yet (for example `spiering-2021-minimal-dose` for maintenance). E14-1 folds all of it in; none needs
a new paper.

- **Expected benefit** (grade A, moderate): a planning figure of 2 to 4% lower oxygen cost after a
  full block, up to 6 to 8% in single studies, never a VO2max, threshold or pace change
  [`denadai-2017-explosive-heavy-economy`, `llanoslagos-2024-economy-speeds`,
  `llanoslagos-2024-performance-methods`, `blagrove-2018-strength-determinants`].
- **Injury claims** (A, low): strength is supportive; no running-specific reduction is stated,
  because the sports-general meta-analyses [`lauersen-2014-exercise-injury-prevention`,
  `lauersen-2018-strength-dose-dependent`] were not confirmed by the one running RCT
  [`toresdahl-2020-nyc-marathon-rct`].
- **No static stretching as injury prevention** (A, moderate) [`lauersen-2014-exercise-injury-prevention`].
- **Novices** (B, moderate): a graded mileage progression is the injury control; strength is an
  addition [`toresdahl-2020-nyc-marathon-rct`].
- **Masters** (C, low): the same prescription, a ramp-in of 4 weeks (a design choice)
  [`piacentini-2013-masters-runners`, `eihara-2024-middle-aged-pt-rt`,
  `schumann-2022-concurrent-compatibility`]; calf, Achilles and hamstring work from 40 (C, low)
  [`mckean-2006-masters-injury`]; lean mass (D) [`hawkins-2003-vo2max-decline`].
- **Durability** (B, moderate): two weekly sessions for at least 10 weeks improved economy
  durability, untested in women, novices and older runners
  [`zanini-2025-strength-economy-durability-rct`, `jones-2025-resilience-training`].
- **Ultra** (D, low): knee-extensor and plantar-flexor work for goals of about 100 km and longer
  [`pastor-2022-trail-determinants-distances`].
- **Maintenance** (D): the dose is a design choice; the direction is [`spiering-2021-minimal-dose`].
- **Frequency** (A, moderate): 3 sessions for lifters with a background in a base phase, never more
  [`blagrove-2018-strength-determinants`, `balsalobre-2016-running-economy-highly-trained`].
- **Separation** (A, low): 3 h or a different day; evidence concerns strength outcomes
  [`schumann-2022-concurrent-compatibility`, `wilson-2012-concurrent-interference`].
- **Heavy method** (A method, D dose): the 80% 1RM floor and 90% where tolerated.

### 4.4 Evidence gaps and their defaults

A corpus search on 2026-10-24 (`grep -li` over `research/papers/*`) found no paper on repetitions in
reserve, autoregulation, resistance-training progression schemes, tendon loading or calf dosing (the
"load progression" hits are running-load papers), and the only strength-maintenance paper is a
narrative review of non-athletes. Each gap below names the kind of
paper to add through the `research-update` skill and the default that stands, at grade D, until it
exists. No paper outside the corpus is named here; E14-1 runs the lookup and adds only what
verifies. The gaps are numbered for reference.

| #   | Gap                                     | What the corpus lacks                                                                                                                                                                                             | Kind of paper to add                                                                                                                | Default until then (grade D)                                                                                                                             |
| --- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Progression scheme                      | Nothing compares linear, double, percentage-based or autoregulated progression in any population. The one template is a fixed 4 x 4RM, 3 a week, 8 weeks (`storen-2008-maximal-strength-economy`)                 | A systematic review or RCT of load-progression models in resistance training, ideally in endurance runners                          | Double progression inside a 3-6 rep range: top of the range on every set with reps to spare raises the load by one step (F8)                             |
| 2   | Reps-in-reserve autoregulation          | No paper mentions repetitions in reserve, RIR or autoregulation                                                                                                                                                   | A validation of RIR or effort-based load prescription in trained and untrained lifters; a trial of autoregulated against fixed load | Targets of 1-3 in reserve in the block and 3 or more in ramp-in, taper and return; an unrecorded RIR holds the load                                      |
| 3   | Minimal effective dose                  | `spiering-2021-minimal-dose` is the only maintenance evidence: a narrative review, general population, no athletes                                                                                                | A trial of 1 against 2 sessions a week and 1 against 2-3 sets in endurance runners through a racing phase                           | 1 session a week, 2 sets per lift at the kept relative load, plyometrics at 60 contacts                                                                  |
| 4   | Masters runners                         | Two small trials (`piacentini-2013-masters-runners`, n=16; `eihara-2024-middle-aged-pt-rt`, n=20); no one over about 50; no women                                                                                 | An RCT of heavy resistance training in runners over 50, women and men, with economy and injury outcomes                             | The general prescription; a 4-week ramp-in from age 40; no age-based cut                                                                                 |
| 5   | Calf and plantar-flexor dosing          | One correlation (`eihara-2024-middle-aged-pt-rt`, r -0.477, n=20) supports "include heavy calf raises"; no paper gives sets, reps, load, tempo, knee angle or Achilles tolerance                                  | A dose-response trial of calf-raise loading in distance runners, with Achilles and calf injury outcomes                             | The heavy rep range and effort targets of the other lifts; standing and bent-knee or single-leg raises alternate; slow lowering                          |
| 6   | Plyometric dose and progression         | 200 contacts is "the highest dose observed" (`balsalobre-2016-running-economy-highly-trained`, `llanoslagos-2024-economy-speeds`), not a tested limit; no starting dose, progression, surface or bone-stress data | A dose-response trial of ground contacts in distance runners; a cohort on bone stress injury after added plyometrics                | Start at 40 contacts, add 20 every 2 weeks, four low-amplitude movements, half the dose where the pace is above 12 km/h or bone stress is in the history |
| 7   | Eccentric dose                          | H5 and the topic: no trial of eccentric-biased or downhill-specific strength work in trail runners                                                                                                                | A trial of eccentric-biased knee-extensor and plantar-flexor training in trail runners, with soreness and downhill outcomes         | A 3-second lowering on the lifts and the calf raise; no loaded eccentric above the concentric                                                            |
| 8   | Strength in the taper                   | No evidence on strength during a taper; `bosquet-2007-taper-meta-analysis` supports cutting volume and keeping intensity and frequency for endurance                                                              | A taper trial that keeps against stops resistance training before a long race                                                       | One light session a week until the race week, load kept, two sets, no plyometrics; none in the race week (as the engine plans today)                     |
| 9   | Women                                   | No female-only trial; 8 women in `storen-2008-maximal-strength-economy`; `zanini-2025-strength-economy-durability-rct` and `giovanelli-2017-ultra-sep` are male only                                              | Female-only or sex-stratified strength trials in distance runners                                                                   | Sex never changes the dose (A5, G-4)                                                                                                                     |
| 10  | 100-mile and trail runners              | One 25-person male ultra study (`giovanelli-2017-ultra-sep`); `pastor-2022-trail-determinants-distances` is a cross-section                                                                                       | Training trials in ultra and trail runners                                                                                          | The general prescription, labelled "extrapolated" for ultra goals                                                                                        |
| 11  | Repetitions to a one-rep maximum        | No paper validates a repetitions-to-maximum equation                                                                                                                                                              | A validation of repetition-based maximum prediction in runners and recreational lifters                                             | The linear form `load x (1 + (reps + RIR) / 30)`, used for starting loads, a 90% ceiling and display, labelled an estimate                               |
| 12  | Barbell lifting by recreational runners | No injury or technique data                                                                                                                                                                                       | A cohort of recreational runners starting barbell lifts                                                                             | Barbell lifts only for a runner who describes themself as experienced (section 6.2)                                                                      |

Amended by the owner's decisions of 2026-10-24 (section 18): the default of gap 6 also steps the
dose only after a completed running week (section 8.2), and the default of gap 12 is replaced:
barbell lifts are offered after the ramp-in to any lifting level that has the equipment (section
7.2), which the owner chose over the experienced-only default. The gaps themselves stand.

### 4.5 What the app says about benefit

One sentence, on the Strength page and in the Why drawer, with its numbers interpolated from
`f7.expectedBenefitPct`: strength work may lower the oxygen cost of running by about 2 to 4% after a
full block, which is small, takes the whole block, and says nothing about race time. Heavy loads have
the strongest support; jumps help at slower paces; the evidence for 100-mile runners is thin and the
loads and sets are defaults. The app states no injury-prevention figure and never shows a personal
injury probability (G5).

## 5. Shared contracts

### 5.1 One derived workout

The prescription of a strength session is derived on every read; it is not stored on `PlanSession`.
The stored session keeps its kind, date, order, duration (the time budget), rules and flags; the
workout is `workoutFor(context, session)` in `shared/engine/strength.ts`. This is how the fuel
target works (ADR 0011), and for the same reasons:

- The workout depends on things that change without a re-plan: the runner's equipment, the
  exercises left out, the last sets logged. A stored copy would be stale after each, and a re-plan
  to refresh it would be a revision of a plan the runner did not change (the anti-goal of ADR 0007).
- Loads change after every session. Storing them would put a data write in the middle of the plan
  tables and a revision behind each log.
- The engine stays small: `PlanSession`, `sessionRow()`, pairing, diffs and undo are untouched.

One module and one catalogue hold the logic:

| File                               | Holds                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `shared/domain/weight.ts`          | Grams, pounds and kilograms, rounding to a step, formatting a load                                      |
| `shared/domain/strengthLibrary.ts` | The catalogue (ids, slots, equipment, load basis, ladders, rule tags), feasibility, substitutions       |
| `shared/engine/strength.ts`        | Templates, block position, exercise selection, suggestions, the one-rep-max estimate, history summaries |
| `shared/copy/strengthTemplates.ts` | Every sentence (names, cues, reasons, the benefit sentence)                                             |
| `server/services/strength.ts`      | The settings, anchors and logs; `loadStrengthContext`; the Today slot; the Strength page view           |
| `server/routes/strength.ts`        | The routes of section 9.5                                                                               |

The result type, in `shared/types.ts`:

```ts
type StrengthTemplate = 'ramp-in' | 'heavy' | 'lighter-week' | 'maintenance' | 'taper' | 'return'
type Slot = 'knee' | 'hip' | 'calf' | 'plyo' | 'trunk'

interface StrengthWorkout {
  sessionId: string
  date: string
  template: StrengthTemplate
  variant: 'A' | 'B'
  /** Week k of n of the block; null outside the block. */
  block: { week: number; of: number; rampInWeeks: number } | null
  /** The session's planned minutes, a budget; the workout may finish sooner. */
  budgetMin: number
  /** False until the runner has saved the setup: the workout is then built for bodyweight only. */
  setupSaved: boolean
  lifts: WorkoutLift[]
  plyo: PlyoDose | null
  trunk: WorkoutLift[]
  rules: string[]
}
interface WorkoutLift {
  exerciseId: string
  slot: Slot
  /** The equipment the load is for; null for bodyweight. */
  implement: string | null
  sets: number
  /** Reps, seconds or contacts, by the exercise's measure. */
  range: { min: number; max: number }
  /** The count to aim at in each set. */
  targets: number[]
  loadG: number | null
  /** The loads the equipment can make, so a stepper and a suggestion stay on them; null without a load. */
  steps: LoadSteps | null
  /** Reps in reserve to leave; null for exercises without an effort target. */
  rir: { min: number; max: number } | null
  change: 'start' | 'increase' | 'hold' | 'reduce' | 'return' | 'variation' | 'lighter-day'
  /** On a lighter day, the load the progression would otherwise have asked for. */
  usualLoadG: number | null
  basis: SuggestionBasis
}
/** A uniform ladder (a barbell, a machine) or the list of loads there are (dumbbells, kettlebells). */
type LoadSteps = { minG: number; stepG: number; maxG: number | null } | { loadsG: number[] }
interface PlyoDose {
  contacts: number
  movements: string[]
}
/** The reason for a figure as data (ADR 0010): templates and slots, never prose. */
interface SuggestionBasis {
  rule: 'F7' | 'F8' | 'F9'
  facts: Array<{ template: string; slots: Record<string, Quantity | string> }>
}
```

Every surface renders this one object: the Today hero, the session sheet, the logging sheet and the
Strength page. A cross-surface test (`tests/unit/engine/strengthSurfaces.test.ts`, modelled on
`targetSurfaces.test.ts`) feeds one workout to each adapter and asserts that the same lifts, sets,
loads and efforts appear.

### 5.2 Loads in grams and the weight unit

- **Storage.** A load is an integer number of grams (`loadG`), in line with ADR 0003 (integers in
  base units, converted at the display edge). Kilograms as a float, as `AthleteProfile.weightKg`
  does, would make "same as last time" and the equality tests in the progression rules depend on
  floating-point rounding; 45 lb is 20 411.7 g and is stored as 20 412 g.
- **What a load means** is fixed per implement and shown beside the field: a barbell load is the
  total including the bar; a dumbbell or kettlebell load is the weight of one implement; a machine
  load is the stack or plate total; an added load on a bodyweight movement is the extra weight; a
  bodyweight movement with nothing added is `null`.
- **The unit.** `User.weightUnit` (`'lb'` or `'kg'`) is a per-runner display setting next to
  `User.units`, returned by `/api/settings` and edited in Settings. It is not derived from the
  distance unit, because miles with kilograms is common. The migration backfills it from the
  distance unit (`km` gives `kg`, otherwise `lb`). The owner chose pounds on 2026-10-24 (section 18, question 3), and any runner
  can switch in Settings or in the first sheet of the setup.
- **Display rounding** follows the equipment, not the number of decimals: pounds to the nearest 0.5,
  kilograms to the nearest 0.25. A value typed in pounds converts to the nearest gram and shows
  back as typed.
- **Steps.** `stepsFor(equipment, implement, unit)` returns the loads the runner can actually
  make: a barbell moves in multiples of its smallest jump (a pair of the smallest plates), dumbbells
  and kettlebells in the entered list, a machine in its stack step. Suggestions and steppers use
  these, so no suggestion asks for a load the equipment cannot make.
- **Formatting.** `shared/copy/quantity.ts` gains a `load` quantity (`{ kind: 'load', g }`).
  `render` and `formatQuantity` gain an optional fourth argument, the weight unit, which only a
  `load` reads; every existing call is unchanged. A stored fact holds grams and no unit, so a change
  of unit reaches old logs and old explanations.
- **Body weight on the Profile** stays in kilograms in v1 (the field feeds no strength rule).

### 5.3 Rule ids

Three rules are added to section (f) of `engine-rules.md` by E14-1, and five are amended. Each new
id needs a heading there (the Param test), a title in `web/components/ruleTitles.ts` and either a
builder in `INPUT_BUILDERS` or an entry in `POLICY_ONLY_RULES` (the coverage test of
`explainInputs.ts`).

- **F7 Strength session structure and exercise selection.** The templates of section 8, the
  catalogue of section 7, the equipment rule, the plyometric ladder and the trunk finisher. Grades:
  A for heavy plus plyometrics in a block, D for every dose. Explain builder: reads the block
  position, the template and the equipment.
- **F8 Strength load progression.** The double-progression rules, the first-session load and the
  one-rep-max estimate (section 10). Grade D throughout (gaps 1, 2, 11). Explain builder: reads the
  sets of the exercise.
- **F9 Lighter days, recovery weeks, the taper and the return after a layoff.** Section 10.4.
  Grade D (gaps 3, 8). Explain builder: reads the readiness read, the week's flags and the gap
  since the last session.
- **Amended:** E5 (the block is anchored, section 8.3), F-lib (the strength rows point to F7), F4
  (the construction that satisfies it), H10 (the engine reads the `h10` Params for ultra goals)
  and H5 (the 3-second lowering is the eccentric emphasis). `F4`, `E5` and `F-lib` stay
  policy-only; `H10` keeps its builder, which gains the block week.

A strength session's `rules` become `['F-lib', 'F4', 'E5', 'F7']` (plus `H10` for an ultra goal);
`F8` and `F9` appear on a lift's reason, not on the session.

### 5.4 Params

New Params go in `shared/engine/params/f-micro.ts` in groups named after their rules (`f7`, `f8`,
`f9`), following the registry's convention. Every value below is grade D unless a grade is shown;
each grade D value carries a note that says it is a default. "Evidence" lists ids that exist in
`research/papers/`; an empty cell means the value is an engineering default with no direct paper.

| Param                        | Value            | Grade | Evidence and note                                                                                                                                   |
| ---------------------------- | ---------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `f7.blockSessionMin`         | 40 min           | D     | The time budget of a block session; sets of 3-6 reps with full rests and a plyometric dose take about this long                                     |
| `f7.maintenanceSessionMin`   | 25 min           | D     | The budget of a maintenance, taper or lighter session                                                                                               |
| `f7.maintenanceSets`         | 2                | D     | `spiering-2021-minimal-dose` (1 set kept strength in younger adults; older people may need 2-3); used for maintenance, a lighter week and the taper |
| `f7.rampInReps`              | [6, 8]           | D     | Lighter loads for a technique base (`flib.heavyRampInWeeks` text)                                                                                   |
| `f7.rampInSets`              | [2, 3]           | D     | The first ramp-in week uses the first value, later weeks the second                                                                                 |
| `f7.easyRir`                 | 3                | D     | Reps to leave in ramp-in, taper and return sessions                                                                                                 |
| `f7.heavyRir`                | [1, 3]           | D     | Reps to leave in block sessions; no paper in the corpus (gap 2)                                                                                     |
| `f7.bodyweightReps`          | [8, 15]          | D     | Rep range of a bodyweight movement taken near the limit; the heavy range cannot apply without added load                                            |
| `f7.lowerSeconds`            | 3 s              | D     | The lowering phase of a lift (H5, gap 7); `temesi-2015-female-neuromuscular-fatigue` is the rationale only                                          |
| `f7.plyoStartContacts`       | 40               | D     | Start of the ground-contact ladder (gap 6)                                                                                                          |
| `f7.plyoStepContacts`        | 20               | D     | Added at each step                                                                                                                                  |
| `f7.plyoStepEveryWeeks`      | 2                | D     | Weeks between steps; the cap is `flib.plyoContactsMax` (A)                                                                                          |
| `f7.plyoRungWeeks`           | 3                | D     | Weeks on one movement of the four-rung ladder                                                                                                       |
| `f7.maintenancePlyoContacts` | 60               | D     | Contacts in a maintenance session                                                                                                                   |
| `f7.reducedPlyoShare`        | 0.5              | D     | Share of the ladder for a goal pace above `flib.plyoEmphasisPaceKmh`, a bone stress history or a recent injury, and a lighter week                  |
| `f7.blockCreditWeeks`        | 4                | D     | Consecutive weeks with a logged block session that let a new block skip its ramp-in (a regenerate, section 8.3)                                     |
| `f7.trunkSets`               | 2                | D     | Sets of each trunk and hip movement (`leppanen-2024-hip-core-novice`: the programme is B, the dose D)                                               |
| `f7.trunkReps`               | [8, 12]          | D     | Reps of a counted trunk movement                                                                                                                    |
| `f7.trunkHoldSec`            | [30, 45]         | D     | Seconds of a held trunk movement                                                                                                                    |
| `f7.taperLifts`              | 2                | D     | Lifts in a taper session: the lead lift and the calf raise                                                                                          |
| `f7.expectedBenefitPct`      | [2, 4] %         | A     | Oxygen-cost planning figure: `denadai-2017-explosive-heavy-economy`, `llanoslagos-2024-economy-speeds`, `blagrove-2018-strength-determinants`       |
| `f8.progressMinRir`          | 1                | D     | Reps in reserve on every set, at the top of the range, to add one step                                                                              |
| `f8.bigStepRir`              | 4                | D     | Reps in reserve on every set that earn two steps                                                                                                    |
| `f8.maxStepPct`              | 15 %             | D     | The largest single step, as a share of the load, that a suggestion makes; a larger step is not offered (a 20 lb to 25 lb dumbbell is 25%)           |
| `f8.reducePct`               | 5 %              | D     | Reduction after a set short of the range (at least one step)                                                                                        |
| `f8.ceilingSessions`         | 3                | D     | Sessions at the top of the range with no usable step before the next variation of the exercise                                                      |
| `f8.layoffDays`              | 28 days          | D     | A gap after which the return rule applies; `mujika-2000-detraining-part2` says force declines slowly                                                |
| `f8.layoffLoadFraction`      | 0.9              | D     | The return load as a share of the last base load                                                                                                    |
| `f8.startPctOf1rm`           | 70 %             | D     | The first ramp-in load as a share of an entered or estimated maximum                                                                                |
| `f8.e1rmDivisor`             | 30               | D     | The linear estimate `load x (1 + (reps + RIR) / divisor)` (gap 11)                                                                                  |
| `f8.startFractionBodyweight` | one per exercise | D     | A table (exercise id to fraction of body weight) for a first load with no history and no anchor                                                     |
| `f9.lowReadinessLoadPct`     | 10 %             | D     | Load reduction on a low-readiness day; readiness never adds load (J3, G6)                                                                           |
| `f9.lowReadinessSetsCut`     | 1                | D     | Sets removed from each lift on a low-readiness day (at least 2 remain)                                                                              |
| `f9.countPromptWeeks`        | 3                | D     | Finished weeks with fewer strength sessions than planned before the page asks about a lower weekly count (section 12.4)                             |

Amended by section 18: `f7.plyoStepEveryWeeks` is the earliest cadence and not the whole rule. A
step of contacts, and a move to the next rung (`f7.plyoRungWeeks`), is taken only after a completed
running week, defined in section 8.2 with `j5.completionHoldShare`; no new Param is added. The
owner confirmed the budgets (`f7.blockSessionMin` 40 and `f7.maintenanceSessionMin` 25), the start
of 40 contacts, the cap `flib.plyoContactsMax` (200) and the smaller defaults (question 16) as
grade D defaults with notes that say so.

Existing Params that change role: `fplace.strengthSessionMin` is retired in E14-3 (replaced by
`f7.blockSessionMin` and `f7.maintenanceSessionMin`); `flib.heavyMinPct1rm` becomes the floor shown
beside a load and its range maximum (90) the ceiling no suggestion passes; `flib.plyoEmphasisPaceKmh`
and `flib.plyoContactsMax` are read at last; `h10.*` are read for ultra goals (section 8.3).
`PARAMS_VERSION` is bumped by E14-1 and again by E14-3.

### 5.5 Copy and G5

Every sentence is a template in `shared/copy/strengthTemplates.ts`, spread into `TEMPLATES`, at most
160 characters, ending in a full stop, with typed slots (ADR 0010). Names, cues and reasons are
templates over ids and `Quantity` slots; a reason stored on a log is a template id with slots, so a
wording fix and a change of unit reach old logs. Numbers that restate a Param (the rep range, the
reps to leave, the separation hours, the benefit range) are interpolated from `P` and compared with
it by a copy test. Section 11.6 lists the vocabulary rules.

## 6. Setup

### 6.1 When the app asks

Not up front. Nothing is asked at sign-up or on the Profile page. The first time a strength session
falls within 7 days, or the Strength page is opened, a card offers "Set up strength", and the
logging sheet carries a one-line row with the same offer. Until the setup is saved, `setupSaved` is
false and the workout is built for bodyweight only, with the default ramp-in length
(`flib.heavyRampInWeeks`) and a note that says what the lifts would be with equipment. Reason: the
owner asked for equipment and
history to be captured in the app, not requested before the app is useful (G6 makes the unknown
case the conservative one, so an unanswered setup never produces a heavy barbell load).

### 6.2 What is asked

Five parts, each its own short sheet, each skippable; parts 2 to 5 are saved by
`PUT /api/strength/settings` and part 5 by `PUT /api/strength/lifts/:exerciseId`:

1. **Weight unit** (lb or kg), first, because it changes every later entry. Saved to
   `User.weightUnit` through `PUT /api/settings`, the route that already saves the distance unit,
   so one route writes each unit.
2. **Equipment.** A checklist, with the detail the progression needs for each item:

   | Item                                 | Detail asked                                                        | Used by                                                     |
   | ------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------- |
   | Barbell, plates and a rack or stands | Bar weight (20 kg or 45 lb); the smallest pair of plates (the jump) | Back squat, Romanian deadlift, hip thrust, calf raise       |
   | Dumbbells                            | The weights available, as a range and a step or as a list           | Goblet squat, split squat, step-up, lifts, carries          |
   | Kettlebells                          | The weights available, as a list                                    | The same movements as dumbbells, and the carry              |
   | Bands                                | Nothing; they carry no tracked load                                 | Lateral walk, Pallof press                                  |
   | A step or box                        | Nothing                                                             | Step-up, single-leg calf raise, box squat, rear foot raised |
   | Leg press, calf raise, leg curl      | The weight step and the top weight, for each machine                | Leg press, calf raise, leg curl                             |

   Bodyweight needs no entry; it is always available. The step of each item is what every
   suggested load rounds to (section 5.2), so a runner with dumbbells in 5 lb steps is never asked
   for 52.5 lb.

3. **Lifting history**, two questions. "Lifting level": new (not lifted regularly, or for under a
   year), some (lifted for a while but not consistently), or experienced (lifted consistently for a
   year or more and comfortable with squat and hinge movements under load). "Lifting now": at
   least once a week in the last month, yes or no. They set the ramp-in length (section 8.2). The
   level no longer gates the barbell (owner, question 7): the barbell is offered to any runner who
   has a bar, once the ramp-in is done (section 7.2). Reason: the topic rule asks for a technique
   base before heavy loading (`research/topics/strength-plyometrics.md`,
   `strength-primary-method-heavy`), and the ramp-in on other lifts is that base. The corpus holds
   no safety data on barbell lifting by recreational runners (gap 12); the first version of this
   design kept the barbell for the level "experienced" (G6), and the owner chose the wider rule.
4. **Exercises to leave out**, a list of the catalogue with a switch on each, and a note that
   nothing reads (stored only so the runner sees it again). Injuries are not asked here: the
   Profile already records them (`AthleteProfile.injuries`), the Strength page shows them with a
   link, and the engine already reads `state.risk` for a bone stress history or a recent injury
   (section 8.2). Two places for one fact would drift.
5. **Starting points** (optional). Section 6.3.

### 6.3 Anchors and the estimated maximum

A runner who knows a lift can enter it: pick an exercise, then either a recent set (weight, reps,
reps left) or a known maximum. It is stored as one row per exercise (`StrengthLift`) and replaces
the previous one. The estimated maximum is a derived number, never stored:

```
estimateOneRm(loadG, reps, rir) = loadG x (1 + (reps + rir) / f8.e1rmDivisor)
```

A set entered without a count of reps left is taken as 0 left, the lowest estimate (G6). The
estimate for an exercise comes from its anchor until the first log, then from the best set of the
latest logged session. It is used for three things only: a first load (70% of it,
`f8.startPctOf1rm`), the ceiling no suggestion passes (90%, the range maximum of
`flib.heavyMinPct1rm`) and a figure beside a load ("about 83% of the estimated maximum, heavy work
asks for 80% or more"). It is labelled "estimated maximum", never "max" or "1RM test", and never
appears on Today. The owner confirmed it for the history view on 2026-10-24 (question 10), always
labelled an estimate. The corpus has no validation of the equation (gap 11).

### 6.4 History

A runner's past sessions enter as ordinary logs: the logging sheet opens with a date field from
"Add a past session" (any date up to a year back, never in the future). The sets feed the
suggestion rules like any other. A strength activity that arrived by import shows "Add the sets"
on its page and opens the same sheet attached to that activity (section 9.4). No separate history
table exists, so the history cannot disagree with the logs.

### 6.5 What a change does

Equipment is a setting of the runner and not a fact about the plan, and it can be changed at any
time: a gym membership that starts, a week away with dumbbells only, a bar sold. The workout is
derived on read, so a saved change shows on the next read, which makes it the workout of the next
session. Nothing is re-planned, and the block position and the ramp-in do not restart, because both
belong to the block (section 8.3). A session already open in the logging sheet keeps the workout it
was opened with; a future session shown "as of today" (section 11.2) updates.

- **Taking equipment away** makes the next workout use the next feasible exercise of each slot; the
  loads of the new exercise start from section 10.3, and the old exercise's history stays.
- **Adding equipment** makes the better-supported lifts of each ladder feasible (section 7.2). A
  barbell lift is offered after the ramp-in only, so a runner who gets a bar during the ramp-in
  keeps the ramp-in lifts until it ends. The first session of an exercise with no history is a
  ramp-in structure session at a conservative load, whatever the week (section 10.3); the history
  of the dumbbell or kettlebell lift is not converted.
- **A typical change** (question 1): a runner with a few dumbbells or kettlebells at home who gains
  gym access later. The setup is saved with the home items and edited on the Strength page
  ("Equipment and units", section 11.3) when the gym access starts; the workouts from the next
  session on use the gym equipment.
- **"Switchable"** is read as editable at any time (section 18). Named equipment sets chosen per
  day, such as "home" and "gym", are not in v1; "Swap" (section 7.3) changes one exercise for one
  session.

## 7. The exercise library

### 7.1 A fixed catalogue

`shared/domain/strengthLibrary.ts` holds 25 exercises. An entry has an id, a slot (`knee`, `hip`,
`calf`, `plyo` or `trunk`), the implements it can be done with (any one of; or none, for
bodyweight), anything else it needs (a step), its measure (reps, seconds or contacts), its load
basis (section 5.2), the next harder movement, the rules it serves and the ids of its cue
templates. The catalogue holds no engine number: reps, sets, contacts, efforts and starting
fractions are Params, so the catalogue is content and the numbers are graded. An id is never
renamed or reused, because logs store it; an exercise that leaves the catalogue stays in it marked
retired, so history still renders and the ladders skip it.

| Id                      | Name                         | Slot  | Implement (any one)                           | Also needs | Measure  | Load basis             | Harder movement         | Serves                |
| ----------------------- | ---------------------------- | ----- | --------------------------------------------- | ---------- | -------- | ---------------------- | ----------------------- | --------------------- |
| `back-squat`            | Back squat                   | knee  | Barbell and rack                              |            | reps     | Total with the bar     |                         | F-lib, F7, H10, H5    |
| `leg-press`             | Leg press                    | knee  | Leg press machine                             |            | reps     | Stack or plates        |                         | F-lib, F7, H10, H5    |
| `goblet-squat`          | Goblet squat                 | knee  | Dumbbell, kettlebell                          |            | reps     | One implement          | `split-squat`           | F-lib, F7, H10, H5    |
| `split-squat`           | Split squat                  | knee  | Dumbbells, kettlebells, none                  | Step (opt) | reps     | One implement a hand   | `step-up`               | F-lib, F7, H10, H5    |
| `step-up`               | Step-up                      | knee  | Dumbbells, kettlebells, none                  | Step       | reps     | One implement a hand   | `single-leg-box-squat`  | F-lib, F7, H10, H5    |
| `tempo-squat`           | Tempo squat                  | knee  | None                                          |            | reps     | Bodyweight             | `split-squat`           | F-lib, F7, H10, H5    |
| `single-leg-box-squat`  | Single-leg box squat         | knee  | Dumbbell, kettlebell, none                    | Step       | reps     | Added, if any          |                         | F-lib, F7, H10, H5    |
| `romanian-deadlift`     | Romanian deadlift            | hip   | Barbell                                       |            | reps     | Total with the bar     |                         | F-lib, F7, H5, m-age  |
| `dumbbell-rdl`          | Dumbbell Romanian deadlift   | hip   | Dumbbells                                     |            | reps     | One implement a hand   | `single-leg-rdl`        | F-lib, F7, H5, m-age  |
| `kettlebell-rdl`        | Kettlebell Romanian deadlift | hip   | Kettlebell                                    |            | reps     | One implement          | `single-leg-rdl`        | F-lib, F7, H5, m-age  |
| `leg-curl`              | Leg curl                     | hip   | Leg curl machine                              |            | reps     | Stack                  |                         | F-lib, F7, m-age      |
| `hip-thrust`            | Hip thrust (glute bridge)    | hip   | Barbell, dumbbell, none                       | Step (opt) | reps     | Total or one implement | `single-leg-rdl`        | F-lib, F7, m-age      |
| `single-leg-rdl`        | Single-leg Romanian deadlift | hip   | Dumbbell, kettlebell, none                    |            | reps     | One implement          |                         | F-lib, F7, H5, m-age  |
| `standing-calf-raise`   | Standing calf raise          | calf  | Calf machine, barbell, dumbbells, none        | Step (opt) | reps     | By implement           | `single-leg-calf-raise` | F-lib, F7, H10, m-age |
| `seated-calf-raise`     | Bent-knee calf raise         | calf  | Calf machine (seated), dumbbells on the knees |            | reps     | By implement           | `single-leg-calf-raise` | F-lib, F7, H10, m-age |
| `single-leg-calf-raise` | Single-leg calf raise        | calf  | Dumbbell, none                                | Step       | reps     | Added, if any          |                         | F-lib, F7, H10, m-age |
| `pogo-hop`              | Pogo hops                    | plyo  | None                                          |            | contacts | Bodyweight             | `line-hop`              | F-lib, F7, H10        |
| `line-hop`              | Line hops                    | plyo  | None                                          |            | contacts | Bodyweight             | `squat-jump`            | F-lib, F7, H10        |
| `squat-jump`            | Squat jumps                  | plyo  | None                                          |            | contacts | Bodyweight             | `single-leg-hop`        | F-lib, F7, H10        |
| `single-leg-hop`        | Single-leg hops in place     | plyo  | None                                          |            | contacts | Bodyweight             |                         | F-lib, F7, H10        |
| `side-plank`            | Side plank                   | trunk | None                                          |            | seconds  | Bodyweight             |                         | F-lib, F7             |
| `dead-bug`              | Dead bug                     | trunk | None                                          |            | reps     | Bodyweight             |                         | F-lib, F7             |
| `banded-lateral-walk`   | Banded lateral walk          | trunk | Bands                                         |            | reps     | Band, not tracked      |                         | F-lib, F7             |
| `pallof-press`          | Pallof press                 | trunk | Bands                                         |            | reps     | Band, not tracked      |                         | F-lib, F7             |
| `farmer-carry`          | Farmer carry                 | trunk | Dumbbells, kettlebells                        |            | seconds  | One implement a hand   |                         | F-lib, F7             |

"Serves" lists the rules each exercise is there for: `F-lib` (the session-library rows), `F7` (this
design's structure rule), `H10` (knee-extensor and plantar-flexor work, and the plyometric
emphasis), `H5` (the slow lowering as the eccentric emphasis) and `m-age` (calf, Achilles and
posterior-chain work from age 40). What the choices serve:

- **Squat and hinge lifts** are the heavy method (F-lib, A for the method). The squats and the leg
  press load the knee extensors that H10 names; the hinges and the curl load the hamstrings and hip
  extensors that the masters topic asks for from age 40 (`mckean-2006-masters-injury`). A slow
  lowering on them also meets the H5 eccentric note.
- **Calf raises** meet "include heavy calf raises" (F-lib; `eihara-2024-middle-aged-pt-rt`) and the
  plantar-flexor half of H10. Straight-knee and bent-knee raises alternate between the two weekly
  sessions so both calf muscles are loaded; that alternation is practice, not a cited finding.
- **The plyometric ladder** is the plyometric half of the block (F-lib, A for combined methods at
  slow paces). Its four movements are low-amplitude and on the spot; depth jumps and bounds are
  left out because the corpus holds no dose or bone-stress data for them (gap 6). Short sprints,
  which `balsalobre-2016-running-economy-highly-trained` counts in the dose, stay with the existing
  `strides` run sessions (`flib.stridesCount`); no sprint is added to a strength session.
- **Trunk and hip movements** are the hip and core row of F-lib (`leppanen-2024-hip-core-novice`,
  B for novices; D beyond). They are a finisher of two movements, not a block of their own. The
  novice pre-run hip and core block that the row describes, and the unplaced `mobility` kind, stay
  out of scope (decided: later; section 18, question 12).
- **No nordic or supramaximal eccentric exercise** is in the catalogue: H5 and gap 7 give no dose,
  and the repeated-bout literature (`mchugh-2003-repeated-bout`) describes damage from unaccustomed
  eccentric work.

### 7.2 Slot ladders and selection

Each slot has an ordered list of exercise ids, best-supported first:

```
knee:  back-squat, leg-press, goblet-squat, tempo-squat
hip:   romanian-deadlift, dumbbell-rdl, kettlebell-rdl, leg-curl, hip-thrust
calf:  standing-calf-raise, seated-calf-raise, single-leg-calf-raise
```

The harder movements (`split-squat`, `step-up`, `single-leg-box-squat`, `single-leg-rdl`) are
reached through the "harder movement" links of section 7.1 and by a swap or a pin, not by the
ladder: a runner with dumbbells starts on the goblet squat and moves to the split squat when the
dumbbells run out (section 10.2).

`pickLift(slot, context)` returns the first exercise that is feasible (its implement is in the
saved equipment, or it needs none; anything else it needs is there), allowed (the runner has not
left it out; the barbell as an implement is allowed only after the ramp-in, at any lifting level),
and, if the runner pinned one for the slot and it is feasible, the pinned one instead. Bodyweight
is always feasible, so every slot has an answer: with no equipment the knee slot gives
`tempo-squat`, the hip slot `hip-thrust` as a glute bridge, the calf slot `standing-calf-raise` on
the floor; if the runner has left out every feasible exercise of a slot, its floor exercise (these
three) is used and the sheet says so. Both weekly sessions use the same knee and hip exercise, so
each has one history that moves twice a week; the calf slot takes the first ladder entry on session
A and the second feasible entry on session B (the first again when only one is feasible).

**The barbell** (owner, question 7). A barbell exercise is feasible when the saved equipment has the
bar, plates and a rack. It is allowed in the heavy, lighter-week, maintenance and taper templates
and not in the ramp-in or return templates, whatever the lifting level. The lead lift is the first
exercise of its slot's ladder, so the back squat and the Romanian deadlift lead for anyone with a
bar once the ramp-in is over, and the goblet squat, the leg press or the dumbbell lifts lead before
that. The first barbell session is a ramp-in structure session (section 10.3). Against: the corpus
holds no safety data on barbell lifting by recreational runners (gap 12). The controls are the
safety line (section 7.6), the absence of any maximal attempt and the 3 or more reps left in the
first session.

### 7.3 Substitutions and swaps

`substitutes(exerciseId, context)` is the slot's ladder without the exercise, feasible entries only.
The logging sheet's "Swap" lists them; a swap holds for that session and is recorded in the log's
snapshot. "Always use this" writes the choice to `pinned` in the settings. A swap to an exercise
with no history starts it from section 10.3.

### 7.4 The bodyweight path

A runner with no equipment, or with equipment that cannot give a heavy load, still gets a workout.
Bodyweight movements use the rep range `f7.bodyweightReps` (8 to 15) taken to 1 to 3 reps left
(`f7.heavyRir`), and progress by reps, then by the next harder movement when the top of the range
is reached with reps to spare for `f8.ceilingSessions` sessions in a row (section 10.2). The copy
is plain about it: heavy loads have the strongest support (A); single-leg work near the limit and
jumps are the closest a bodyweight programme gets; plyometrics alone improved economy at slow
paces in `llanoslagos-2024-economy-speeds` (ES -0.307) and matched resistance training in
`eihara-2024-middle-aged-pt-rt`, which had no control group. The plan does not hide the weaker
evidence and does not call the path heavy.

### 7.5 Why no free-text exercises

- **Selection, stepping and explanation need metadata.** A suggestion has to know the exercise's
  slot, implement, step, load basis and harder movement; the Why drawer has to cite a rule. An
  exercise typed as text has none of them, so it could be logged but not progressed, substituted or
  explained (ADR 0005, 0010).
- **The evidence is about specific movements.** The corpus supports heavy lower-body lifts, calf
  raises and low-amplitude jumps (section 4). A free-text lift carries no grade, and the app would
  have nothing honest to say about it.
- **The cost is small and bounded.** A missing lift is a data change plus a catalogue test; a
  session note (the activity's `notes`) records anything else.
- **Against.** A runner who lifts other things, or whose gym has a machine not in the list, loses a
  place to keep that history, and "specific exercises" is the owner's own word. The owner decided on
  2026-10-24 (question 11) not to add an "other lift", logged but never progressed, in v1.

### 7.6 Cues

Each exercise has two templates: `cue`, how it is done, and `note`, where a tempo or an effort
matters. A cue is one or two sentences with no number except those interpolated from Params, for
example for the back squat: "Bar on the upper back, feet about shoulder width, sit back and down
until the thighs are about parallel, and stand up." The safety line, shown once at the top of the
setup and under any barbell lift, is: "Stop a set if anything hurts or form changes. Learn barbell
lifts from a coach before adding load." (a restatement of G6, not a medical claim).

Tempo and eccentric notes, all grade D (gap 7), by group:

- **Lifts, squats, hinges, leg press and curl:** "Lower over {seconds} seconds, then stand up
  without a pause." with `{seconds}` from `f7.lowerSeconds`. The slow lowering is the eccentric
  emphasis of H5; no eccentric load above the lifted load is prescribed.
- **Calf raises:** the same lowering, down to a full stretch with a short pause, then up.
- **Plyometrics:** "Land softly and leave the ground quickly. Stop the set when contacts get
  slower." No height, no depth.
- **Trunk movements:** slow and controlled; no tempo is prescribed.

## 8. Session templates by phase

### 8.1 The five templates

A strength session's template is a pure function of its week (`strengthTemplate` in
`shared/engine/strength.ts`): the week's flags, its position in the block and the runner's ramp-in
length. A workout holds three lifts (the slots `knee`, `hip` and `calf`; two in the taper), then the
plyometric dose, then the trunk movements.

| Template     | When                                                                        | Sessions a week | Lifts and sets                                                     | Reps                      | Reps left (RIR)       | Plyometrics                                       | Trunk               | Budget |
| ------------ | --------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------ | ------------------------- | --------------------- | ------------------------------------------------- | ------------------- | ------ |
| Ramp-in      | The first R weeks of the block (R = 2 to 4); injury-return weeks (`return`) | 2               | Knee, hip, calf; 2 sets in week 1, then 3                          | 6 to 8 (`f7.rampInReps`)  | 3 or more (`easyRir`) | 40 contacts, the first movement; none in `return` | 2 movements, 2 sets | 40 min |
| Heavy        | The rest of the block (12 weeks in all, `e5.strengthBlockWeeks`)            | 2               | Lead lift 4 sets, the other two 3 (`flib.heavySets`)               | 3 to 6 (`flib.heavyReps`) | 1 to 3 (`heavyRir`)   | 40 contacts rising by 20 every 2 weeks to the cap | 2 movements, 2 sets | 40 min |
| Lighter week | A running recovery week inside the block                                    | 2               | The same lifts, 2 sets (`maintenanceSets`), load kept              | 3 to 6                    | 1 to 3                | Half the dose (`reducedPlyoShare`)                | As heavy            | 40 min |
| Maintenance  | After the block until the taper, in the specific phase                      | 1               | Knee, hip, calf; 2 sets, load kept                                 | 3 to 6                    | 1 to 3                | 60 contacts (`maintenancePlyoContacts`)           | 2 movements, 2 sets | 25 min |
| Taper        | The taper weeks; none in the race week or after the race                    | 1               | The lead lift and the calf raise (`taperLifts`), 2 sets, load kept | 3 to 6                    | 3 or more             | None                                              | 1 movement, 2 sets  | 25 min |

The `return` template is the ramp-in structure without plyometrics, used in injury-return, ladder
and restart-floor weeks. Session A leads with the knee lift (4 sets in the heavy template, the range
maximum of `flib.heavySets`) and session B with the hip lift; with one session a week A and B
alternate by week. The planned `durationMin` of a block session is the budget,
`f7.blockSessionMin` (40), and of every other session `f7.maintenanceSessionMin` (25); a workout
that takes less is fine. Reasons for the numbers are in section 5.4; the structure follows the
trial template of `balsalobre-2016-running-economy-highly-trained` (2 to 4 lower-body exercises plus
jumps, 2 to 3 times a week for 8 to 12 weeks) and the economy-durability RCT
`zanini-2025-strength-economy-durability-rct` (maximal strength plus plyometrics, twice a week, 10
weeks).

A worked heavy session A, week 6, a barbell and rack, a runner at 6 minutes 30 seconds a kilometre
goal pace: back squat 4 x 3-6 at 110 lb leaving 1-3 reps; Romanian deadlift 3 x 3-6 at 95 lb;
standing calf raise 3 x 3-6 at 80 lb on the machine; 60 contacts of pogo hops (the third heavy
week of a 3-week ramp-in); side plank and dead bug, 2 sets each.

### 8.2 What each phase does and why

- **Ramp-in.** A technique base and lighter loads before heavy work (the topic rule
  `strength-heavy-dose-and-ramp-in`, `flib.heavyRampInWeeks`, grade D). The length R is 3 weeks by
  default (`flib.heavyRampInWeeks`), 2 for a runner who is experienced and lifting now, and 4 for a
  runner whose lifting level is new or who is 40 or older (`f5.mastersMinAge`; the topic rule
  `strength-masters`, C, low). Without a saved setup it is the default. The ramp-in uses no barbell
  lift (section 7.2). For the owner (level "some", not lifting now, no anchors) it is 3 weeks, with
  conservative first loads from section 10.3 and double progression (question 2).
- **Heavy.** The method with the best support: loads at 80% of the estimated maximum or more, in
  low reps (`llanoslagos-2024-economy-speeds`, `eihara-2022-heavy-vs-plyo`), with the plyometric
  dose at the same time because combined methods have the largest effect (low certainty). The
  plyometric dose is `min(cap, 40 + 20 x s)` contacts, where s counts the steps taken and the cap
  is `flib.plyoContactsMax` (200); it moves one rung of the four-movement ladder every
  `f7.plyoRungWeeks` (3) weeks on the same condition. The ladder starts at 40 contacts (owner,
  question 13). A step, of contacts or of rung, is taken only after a **completed running week**: a
  step is due when `f7.plyoStepEveryWeeks` (2) heavy weeks have passed since the last one, and it is
  taken only if the week just finished was a completed running week; otherwise the dose holds, and
  the step is taken at the first week that follows a completed one. A completed running week is a
  finished week in which the runner ran at least `j5.completionHoldShare` (80%) of the run minutes
  planned for it, the test that J5 already applies to the weekly volume; a week inside a rest window
  is not completed. So s is derived on read from the finished weeks of the snapshot
  (`StrengthContext` carries each finished week's run minutes and target) and no counter is stored.
  Ramp-in weeks hold 40 contacts on the first rung. After a ramp-in of 3 weeks, a 12-week block in
  which every week was completed ends at 120 contacts at most: the cap
  binds only in a longer block, on purpose, because 200 is the highest dose observed in trials and
  not a target (gap 6). The dose is multiplied by `f7.reducedPlyoShare` (0.5) when the goal pace
  is faster than `flib.plyoEmphasisPaceKmh` (12 km/h, from the goal's distance and expected
  duration: `llanoslagos-2024-economy-speeds` found the plyometric effect at 12 km/h or slower), and
  when `state.risk` shows a bone stress history or a recent injury (G6; gap 6). A runner with a
  bone stress history or a recent injury also stops at the second rung of the ladder.
- **Lighter week.** The running recovery week (rule E3) is a lighter week for lifting too: the same
  lifts at the same loads with fewer sets. Volume is cut and load kept, the pattern
  `spiering-2021-minimal-dose` found enough to keep strength; using it for recovery is a design
  choice (gap 3). The progression state is untouched (section 10.4).
- **Maintenance.** One session a week for the rest of the plan before the taper (E5), the block's
  lifts at the kept load, two sets, and 60 contacts. Evidence for the dose is a narrative review of
  non-athletes (gap 3).
- **Taper.** One light session a week until the race week: the lead lift and the calf raise,
  two sets, load kept, 3 or more reps left, no plyometrics, one trunk movement. Rule K3 keeps
  intensity and frequency in a taper and cuts volume (analogy from `bosquet-2007-taper-meta-analysis`,
  which concerns endurance training); no paper tests resistance training in a taper (gap 8). The
  engine already plans no session in the race week and none in the post-race window (`macro.ts`,
  STATUS follow-up 6), and that stays.
- **Return.** Injury-return, ladder and restart-floor weeks (E6, G-3) are weeks of reduced running.
  Lifting is not stopped by them, but the app does not prescribe heavy or jumping work in them: the
  ramp-in structure without plyometrics (G6; no evidence either way).
- **Ultra goals** read `h10.strengthBlockWeeks` and `h10.strengthSessionsPerWeek` (12 and 2, grade
  C) in place of the E5 and F-lib Params, so the grade shown in the Why drawer is the ultra one.
  The values are equal, so no plan changes.

### 8.3 The block is anchored (an engine change, E14-3)

Section 1.2 showed the block restarting at every re-plan. `macroPlan` reads the replaced plan's
past weeks (`input.existing`, as it already does for the run-walk ladder and the injury-return
levels) and counts the past weeks that carry `strength-block`. When that count is above 0 the block
is under way: the remaining block weeks are `e5.strengthBlockWeeks` minus the count, no more than
the non-specific weeks left, and the minimum of `e5.strengthBlockMinWeeks` no longer applies. When
it is 0 the rule is as today. A week's position in the block, "week k of n", is the number of
consecutive flagged weeks up to and including it in the stored plan (`context.existing()`), so the
workout derives it with no new column. The ramp-in is the first R of those weeks.

Consequences, each tested in E14-3:

- A plan re-planned every week for 12 weeks has exactly `e5.strengthBlockWeeks` flagged weeks in
  total (today: the non-specific weeks at the start minus 7).
- A plan with fewer than 8 non-specific weeks gets no block, as today, and maintenance only.
- **A regenerate starts a new block.** `generateEnginePlan` builds with no `existing` plan
  (`gatherEngineInput` without `existing: true`), so an accidental regenerate in week 6 would restart
  the ramp-in. The workout compensates: a runner who has logged heavy sessions
  (`template` `heavy` or `ramp-in` in the snapshot) in each of the last 4 weeks starts the new block
  at the heavy template (the ramp-in is skipped). No plan data changes. This is a design default
  (G6 is satisfied because the loads continue from the logs).
- A weekly update therefore changes no strength flag unless the plan's weeks themselves change.

### 8.4 Placement (F4) with the existing planner

Placement stays in `planStrength` (`micro.ts`). What it already guarantees, and what this design
adds:

| F4 says                            | How the planner meets it today                                                                                                   | Change                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| At least 3 h from key runs         | Never on the day of a hard run, a long run or a back-to-back day; on an easy or strides day the session is ordered after the run | The workout and the hero say "at least {hours} hours from the run" from `f4.strengthSeparationHours` |
| Preferably easy days               | Prefers days that already hold a run, then days apart from the other strength day                                                | None                                                                                                 |
| Never directly before the long run | Excludes the day before the first long-run day of the week                                                                       | None                                                                                                 |
| Capacity                           | Needs `capMin - run minutes >= minutes` on the day                                                                               | `minutes` is 40 in a block week and 25 otherwise (`f7.*SessionMin`), not 30                          |

Two things the planner does not do and this design leaves alone, which the owner decided on
2026-10-24 to leave allowed (section 18, question 8):
a session may fall on the day after the long run, and the day before a quality session is not
avoided. F4 does not ask for either, and the corpus has no paper that does. A session that a runner
moves or logs outside the plan is not blocked; the Strength page notes a logged session on the day
before a long run once, in plain words, and changes nothing.

**Lifts and runs** (owner, questions 5 and 6). A lift on the same day as an easy run is the
preferred placement: the order of preference above puts a session on a day that already holds a
run, ordered after the run and at least `f4.strengthSeparationHours` from it, so two sessions in a
day, a run and a lift, are the norm and not the exception. A lift never displaces a run:
`planStrength` places strength after the runs, and when no legal day exists the week holds fewer
lifts and never fewer runs. The budgets are 40 minutes in a block week and 25 otherwise.

### 8.5 How the `strength` kind becomes a real session

| Field of `PlanSession`  | Before                             | After                                                                                            |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `kind`, `date`, `order` | `strength`, as placed              | Unchanged                                                                                        |
| `title`                 | "Strength"                         | Unchanged (it is a stored label; the template shows in the workout)                              |
| `durationMin`           | 30                                 | 40 in a block week, 25 otherwise: the budget                                                     |
| `structure`, `target`   | Empty; zone `strength`, RPE 4 to 6 | Unchanged                                                                                        |
| `purpose`               | The sentence of section 1.2        | One short sentence naming the week of the block or the maintenance; the lifts are in the workout |
| `rules`                 | `F-lib`, `F4`, `E5`                | Adds `F7` (and `H10` for an ultra goal)                                                          |
| The workout             | None                               | Derived on read (section 5.1)                                                                    |

`purpose` is the one engine-authored sentence, in the style `sessions.ts` already uses, and it no
longer restates five Params that the workout now shows and keeps in step. Nothing is added to
`PlanWeek` or `PlanSession`, so `sessionRow()`, pairing, diffs and undo are untouched.

## 9. Logging

### 9.1 The sheet

The strength sheet is a lazy sheet (`web/components/lazySheets.tsx`) on the existing `Sheet`: a
bottom sheet on phones (up to 92% of the height, the primary button pinned above the safe area) and
a 440 px panel from 900 px. It opens from the Today hero ("Log sets") and the "Also today" line, the
session sheet on the Plan page, the Strength page ("Log a session", "Add a past session") and an
imported strength activity ("Add the sets"). Top to bottom:

1. **Header.** "Strength, heavy A" and the date; the safety line once; the weight unit. A log made
   without a planned session (an off-plan day, a past session) starts from the workout of the next
   planned strength session, else from the maintenance template of that week; every value can be
   edited.
2. **Two quiet buttons.** "As suggested" fills every set of every lift with the suggested load, the
   target reps and the lowest reps-in-reserve of the range. "Same as last time" copies the sets of
   the last logged session of each lift (load and reps; reps-in-reserve stay unset, because they
   describe a different day). Each lift also carries its own "Same as last time".
3. **One section per lift.** A heading with the exercise name, the one-line suggestion ("Suggested
   110 lb, 4 sets of 3 to 6, leave 1 to 3 in reserve"), "Why" and "Swap", then one row per set:
   - **Load**: a stepper of two 44 x 44 px buttons around the value; one press moves one step of the
     equipment (section 5.2), and the value can be typed. Absent for bodyweight movements.
   - **Reps** (or seconds, or contacts): a stepper that moves by 1 (by 5 for seconds, 10 for
     contacts).
   - **Reps left**: the scale 0 to 5 (5 means five or more) as 44 px buttons (the existing
     `ScalePicker` with `touch`), plus "All sets" above the rows, which sets one value for the
     lift. Tapping the chosen value clears it.
   - "Add a set" and "Remove" per row; warm-up sets are not logged, and the sheet says so.
4. **The plyometric dose and the trunk movements** as the same kind of rows, with the count
   prefilled from the dose. After the last row, "Add a lift" lists the feasible catalogue
   exercises that are not in the workout; its sets are logged after the others and, having no
   suggestion, start from section 10.3.
5. **Footer.** Minutes (prefilled from the planned budget), effort 1 to 10 (optional), and under
   "More details" pain 0 to 10 and a note. "Save" is the one primary button. "Save without sets" is
   quiet; it records the duration and effort only, which is what the Done sheet does today, so the
   old path stays.

**The time budget.** "Under a minute" is a property of the common case, which is why the sheet
opens filled: "As suggested", one "All sets" value per lift and Save is 6 taps for a three-lift
session; each set that differs adds a stepper press or two. An e2e test counts interactions
(at most 3 for a session logged as suggested: open, "As suggested", Save; at most 12 with two
changed sets and one reps-left value per lift); it cannot time them and does not try.

**What "As suggested" records.** The reps left are the lowest of the range, not the highest or the
middle, so the shortcut never claims more spare capacity than the plan asked for and cannot trigger
the two-step rule (section 10.2). A runner who has no count of reps left in mind leaves the field
empty, and the rules then hold the load.

**Drafts.** The sheet writes its state to `localStorage` under `strength-draft:<logId>` on every
change (inside `try`, as the other drafts do), so a reload or a dropped connection keeps it. The
`logId` is generated when the sheet first opens (`crypto.randomUUID()`), is part of the draft, and
is the idempotency key of the save. `STRENGTH_DRAFT_PREFIX` is added to `web/pwa/drafts.ts`, so
`purgeDrafts()` and therefore `purgeDeviceData()` remove it; no second purge exists.

### 9.2 What is recorded

Per set: the exercise, the position in the session, the load in grams (null for a bodyweight
movement), the count (reps, seconds or contacts) and the reps left (0 to 5, or null). Per session:
the date, the minutes, the effort, the pain and the note, which are the fields of the linked
`Activity` (type `strength`), and a snapshot of what was shown (section 9.3). Nothing is derived and
stored: totals, estimated maxima, trends and the next load are computed on read.

### 9.3 Data model (migration `strength`, E14-5; all state)

One migration. `User` gains the weight unit; four models are new.

```prisma
// User gains:
weightUnit String @default("lb") // 'lb' | 'kg'; the migration sets 'kg' where units = 'km'

// The runner's equipment and lifting history (state: it decides which lifts a workout holds).
// One row per user, created on the first PUT; a missing row means the defaults below.
model StrengthSettings {
  userId           String    @id
  equipment        String    @default("[]")    // JSON text: EquipmentConfig[]
  level            String    @default("new")   // 'new' | 'some' | 'experienced'
  currentlyLifting Boolean   @default(false)
  avoid            String    @default("[]")    // JSON text: exercise ids left out
  pinned           String    @default("{}")    // JSON text: slot to exercise id
  note             String?                      // never read by the engine
  savedAt          DateTime?                    // null until the runner saves the setup
  updatedAt        DateTime  @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// A starting point the runner entered for one exercise (state: it sets a first load).
model StrengthLift {
  id         String   @id @default(cuid())
  userId     String
  exerciseId String
  kind       String   // 'set' | 'max'
  loadG      Int
  reps       Int      // 1 for a max
  rir        Int?     // 0-5
  asOf       String   // YYYY-MM-DD
  updatedAt  DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, exerciseId])
}

// One strength session's sets (state: the next suggestion and Today read it). `id` is chosen by
// the client (a UUID), so the save is an idempotent PUT that the outbox may replay.
model StrengthLog {
  id         String   @id
  userId     String
  activityId String   @unique
  prescribed String   // JSON text: the snapshot of what the sheet showed (see below)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  user     User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  activity Activity      @relation(fields: [activityId], references: [id], onDelete: Cascade)
  sets     StrengthSet[]

  @@index([userId])
}

model StrengthSet {
  id         String  @id @default(cuid())
  logId      String
  userId     String
  exerciseId String
  position   Int     // order within the session
  loadG      Int?
  count      Int
  rir        Int?    // 0-5

  log  StrengthLog @relation(fields: [logId], references: [id], onDelete: Cascade)
  user User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([logId, position])
  @@index([userId, exerciseId])
}
```

`Activity` gains the back-relation `strengthLog StrengthLog?`.

- **Classification.** All four are in `STATE_MODELS` (`server/dataVersion.ts`). The suggestion memo
  (`strength.state`) and the Today payload read them, so a write must drop the memo; none is
  written on a read path or by a job, which is the test for non-state in CLAUDE.md. A source test
  for new models (`modelClassification.test.ts`) fails if one is missing.
- **`resetData()`** derives its table list from the schema; `StrengthSet` carries `userId` for that
  reason and for ownership checks without a join.
- **The snapshot** `prescribed` holds the `template`, `variant`, `week` and `mode` of the session
  and, for each lift, the `exerciseId`, `implement`, `sets`, `range`, `rir`, `baseLoadG`,
  `shownLoadG`, `change` and `basis`. It is written by the
  client from the workout it displayed and validated by shape and size; it is the runner's own
  data, so a wrong snapshot affects only that runner's next suggestion, and the server does not
  recompute it (a replayed offline save must record what was shown, not what the rules say now).
  `mode` is `normal`, `lighter-day`, `lighter-week`, `taper` or `return`; only `normal` logs move
  the base load (section 10.4).
- **The migration test** (a new case in `tests/unit/server/migrations.test.ts`) seeds the previous
  release's rows with raw SQL, including a `strength` activity linked to a plan session and one
  user with `units = 'km'`, applies the migration and asserts that nothing was lost, that
  `weightUnit` is `kg` for that user and `lb` for the others, and that no strength row exists.
  `docker build .` runs `prisma migrate deploy` as the smoke test.

### 9.4 Linking, imports and duplicates

- **Create or attach.** `PUT /api/strength/logs/:logId` without `activityId` creates the `strength`
  activity (source `manual`) and the log in one transaction; with `activityId` it attaches to an
  owned `strength` activity that has no log (an import, or an earlier "Save without sets"). The
  manual create is the inline code of `POST /api/activities` today (`prisma.activity.create`,
  `markDuplicates`, `runExecutionQuietly`); E14-5 extracts it into `createManualActivity` in
  `server/services/activityStore.ts`, called by both routes, so there is one writer.
- **Session link.** With `sessionId` the activity is linked to that session through
  `linkPlanSession` (`server/services/planEngine.ts`; an owner link). Without it the matcher links as for any strength activity.
- **Duplicates.** A runner who logs sets for a session that an import also brought gets a possible
  duplicate through the existing flow (`markDuplicates`); confirming it moves the log to the
  original activity when that has none, as the fuel log does (`duplicates.ts`).
- **Delete.** Deleting an activity deletes its log (cascade); deleting a log leaves the activity.
- **A second log for an activity** with another `logId` is a 409 with `details.logId`.

### 9.5 API

All routes are mounted under `requireAuth` in `server/routes/strength.ts`; Zod parses every body and
query; validation is 400 with issues; 404 for another user's record; 409 for a conflict; 422 is
not used.

| Route                                 | Purpose                                                                                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/strength`                   | `StrengthView`: settings, the block position, the next workouts, recent logs, the lifts with their summaries, the setup state, the sentences' facts            |
| `PUT /api/strength/settings`          | Equipment, level, currently lifting, exercises left out, pinned choices and the note (the weight unit is saved by `PUT /api/settings`)                         |
| `PUT /api/strength/lifts/:exerciseId` | One starting point (a set or a maximum); `DELETE` removes it                                                                                                   |
| `GET /api/strength/workouts`          | `from`, `to` (a span of at most 62 days): the workouts of the active plan's strength sessions                                                                  |
| `GET /api/strength/logs`              | `activityId` or `from` and `to`: logs with their sets                                                                                                          |
| `PUT /api/strength/logs/:logId`       | The idempotent save. Body: `date`, optional `activityId` and `sessionId`, `durationMin`, optional `rpe` and `pain`, `notes`, `prescribed`, `sets` (at most 80) |
| `DELETE /api/strength/logs/:logId`    | Removes the log and its sets                                                                                                                                   |
| `GET /api/strength/exercises/:id`     | The history of one exercise: sessions, sets, the estimated maximum per session (at most 60 sessions)                                                           |
| `GET /api/today`                      | Gains `coach.slots.strength`: the viewed day's workout, or null                                                                                                |

The save validates: `date` is a real date, not in the future and not more than a year back;
`durationMin` 1 to 300; `rpe` 1 to 10; `pain` 0 to 10; each set's `exerciseId` is in the
catalogue, `count` 1 to 500, `rir` 0 to 5 or null, `loadG` null or 0 to 1 000 000, and a load on a
bodyweight-only exercise is allowed (an added load). `prescribed` is capped at 16 KB; the JSON
parser is the one mounted below `requireAuth`, as CLAUDE.md requires for every body that is not
the setup or sign-in. The response is
`{ log, activity, next }`, where `next` lists, for each lift of the session, the exercise, the
change and the load now suggested (grams), so the client can say "Next time: back squat up to 115
lb" with a template. The server never returns prose.

### 9.6 Offline

The gym is a bad place for a signal. The save is an idempotent `PUT` keyed by the client's `logId`,
so it joins the outbox allowlist (`web/pwa/outbox.ts`) beside the check-in and the fuel log:

```ts
{
  label: 'strength log',
  matches: (url) => /^\/api\/strength\/logs\/[\w-]{8,64}$/.test(url),
  combine: 'replace',
  invalidates: [keys.strength, keys.today, keys.activities],
}
```

The sheet needs three things offline, and has them: the workout (it travels in the Today payload,
`coach.slots.strength`, which the worker already keeps, ADR 0012), the weight unit (it is in
`/api/settings`, also kept) and the equipment steps (inside the workout's lifts as `steps`). The
Strength page is not kept and says it needs a connection. The suggestion for the next session is
not updated until the save reaches the server, and the sheet says "Saved on this phone"
in the outbox's own words. A save refused when it is finally sent (the activity was deleted
meanwhile) shows the outbox's one-time notice. No change to `web/sw/sw.js`, and no new cached read,
is needed.

### 9.7 Jobs

None. The workout is derived on every read and the suggestion memo drops with the data version, so
nothing is scheduled, no job writes strength rows, and the weekly update touches no strength data
beyond the week flags the engine already writes.

## 10. Suggestions

### 10.1 Principles

- **Rule-based and explained.** One pure function, `suggestLoad`, written in rules F8 and F9. A
  language model never chooses a load (ADR 0005); every figure has a reason a person can read
  (section 10.5).
- **Toward less load by default.** An increase needs every logged set at the top of the range with
  reps left and a recorded count of them; any set short of the range lowers the next load; a
  missing count holds it (G6).
- **A suggestion is a sketch.** Every load can be changed in the sheet, and the sheet never calls a
  different load wrong.
- **History decides, not the calendar.** The rules read the latest logged session of the exercise,
  however long ago; a gap has its own rule.

### 10.2 The rules (F8)

For an exercise, `last` is the latest logged session of it in the mode `normal`, and `base` is its
working load: the load used in most of its sets, the lower on a tie. When the exercise has no
`normal` session but has a lighter one (a first session done on a lighter day), `base` is the
`baseLoadG` recorded in that session's snapshot. `lo` and `hi` are the ends of the rep range of the
template; `steps` are the loads the equipment can make (section 5.2). The rules judge the load
that was lifted, not the load that was suggested, so a runner who chose another load is read as
lifting it. The first rule that applies wins.

| Id   | Condition                                                                                                    | Next load (base)                                                            | `change`    | Targets                                  |
| ---- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------- | ---------------------------------------- |
| F8.1 | No logged session of the exercise                                                                            | The first load (section 10.3)                                               | `start`     | `lo` in every set; the ramp-in structure |
| F8.2 | The latest session of any mode was `f8.layoffDays` (28) or more days ago                                     | The last base x `f8.layoffLoadFraction` (0.9), rounded down to a step       | `return`    | `lo`; reps left `f7.easyRir` or more     |
| F8.3 | Any logged set in `last` has fewer than `lo` reps                                                            | Base less `f8.reducePct` (5%), rounded down to a step, at least one step    | `reduce`    | `lo` in every set                        |
| F8.4 | Every logged set has `hi` or more, every count of reps left is recorded and at least `f8.bigStepRir` (4)     | Two steps up, if each step is within `f8.maxStepPct` (15%) of the base      | `increase`  | `lo` in every set                        |
| F8.5 | Every logged set has `hi` or more, every count of reps left is recorded and at least `f8.progressMinRir` (1) | One step up, if the step is within `f8.maxStepPct` of the base              | `increase`  | `lo` in every set                        |
| F8.6 | Otherwise (reps in the range but not all at `hi`; or reps left not recorded; or no usable step)              | The base                                                                    | `hold`      | `min(hi, last count + 1)` for each set   |
| F8.7 | F8.5 found no usable step in `f8.ceilingSessions` (3) sessions in a row                                      | The first load of the exercise's harder movement (section 7.1), if feasible | `variation` | `lo`; the ramp-in structure              |

Worked examples (barbell step 5 lb; range 3 to 6):

- Back squat 110 lb, sets of 6, 6, 6, 6 with 2, 2, 1, 1 left: F8.5, 115 lb (a 4.5% step).
- The same sets with 4, 4, 4, 4 left: F8.4, 120 lb.
- Sets of 6, 5, 4, 3: F8.6, 110 lb, targets 6, 6, 5, 4.
- Sets of 6, 6, 2: F8.3, 5% of 110 lb is 5.5 lb, rounded down to a step, 105 lb.
- Sets of 6, 6, 6, 6 with no count of reps left: F8.6, 110 lb, and the reason says the count was
  not recorded.
- Goblet squat with 50 lb dumbbells and 60 lb the next weight (20%): no usable step; after 3
  sessions at the top of the range with 1 or more left, F8.7 moves to the split squat.

The ceilings: no suggestion exceeds 90% of the estimated maximum (the range maximum of
`flib.heavyMinPct1rm`); when the next step would, the load holds and the reason says so. The
sheet shows the percentage of the estimated maximum beside a load once there is an estimate.

### 10.3 The first load of an exercise (F8.1)

A new exercise is new to the body even for a trained runner (the repeated-bout reasoning of
`mchugh-2003-repeated-bout`; a design default), so its first session always uses the ramp-in
structure: `f7.rampInSets`, `f7.rampInReps` and at least `f7.easyRir` reps left, whatever the
template of the week. The load comes from, in order:

1. **An anchor** the runner entered (section 6.3): `f8.startPctOf1rm` (70%) of its estimated
   maximum, rounded down to a step.
2. **A bodyweight start.** `f8.startFractionBodyweight` is a table from exercise to a fraction of
   the Profile's body weight, applied to the implement's load basis and rounded down to a step. The
   fractions are set in E14-1 to be light for a new lifter; where the product is below the lightest
   load the equipment makes (the empty bar, the lightest dumbbell, the first stack setting) the
   lightest load is used. A bodyweight movement starts with no added load. With no body weight on
   the Profile the lightest load is used.

The history of a related exercise is not converted: the exercises are different movements and the
catalogue claims no conversion.

The start is a calibration, not a prescription of a weight: a start that is too light is corrected
by F8.4 in a few sessions, and one that is too heavy shows as a set short of the range and is
reduced by F8.3. The numbers are defaults that a real log will show to be too cautious or too bold
(gaps 1 and 2); a replay test over synthetic histories records how many sessions a light start takes
to reach the heavy range, and tuning is a Param change through `research-update`.

### 10.4 Lighter days, weeks, the taper and a gap (F9)

- **A low-readiness day.** On the viewed day, if Today's readiness read has `state` other than
  `normal` (`possible-fatigue` or `persistent-suppression`), or a pain report at or above
  `pain.flagScore` is recent, or illness is in its easy-only phase, each lift has one set fewer
  (`f9.lowReadinessSetsCut`, at least 2 remain) and the load is the base less `f9.lowReadinessLoadPct`
  (10%), rounded down to a step. The change is `lighter-day` and the usual load is shown beside it
  with "Use the usual load". These are the readiness tests that rule J3 already applies to runs
  (`todayAdvice` in `readiness.ts`); no second test and no new threshold. Readiness never adds
  load. A day of the illness `rest` phase withdraws the session, as it does today. A preview or a
  past day has no readiness read and therefore no reduction.
- **A lighter week** (a running recovery week inside the block): two sets (`f7.maintenanceSets`),
  the base load, half the plyometric dose. The change is `hold`; the mode is `lighter-week`.
- **The taper**: the lead lift and the calf raise, two sets, the base load, at least `f7.easyRir`
  reps left, mode `taper`.
- **A gap** of `f8.layoffDays` or more: F8.2, mode `return`.
- **A session in any mode other than `normal` neither raises nor lowers the base.** The next
  suggestion is made from the latest `normal` session's working load, so a run of lighter sessions
  cannot drift the load down by repeated rounding. Each snapshot also stores `baseLoadG`, the load
  the rules asked for before the mode changed it, for the case in section 10.2 where no `normal`
  session exists. A lighter session still appears in the history and in the weekly count, and the
  gap rule (F8.2) counts from the latest session of any mode.
- **Sessions the runner moves, skips or does not finish** change nothing by themselves (section 12).

### 10.5 The Why drawer

`ExplainRequest` gains a subject, `{ subject: 'strength', id: <sessionId>, exercise?: <exerciseId> }`
(`GET /api/explain?subject=strength&id=...&exercise=...`, strict like the others). The drawer opens
from a lift's "Why" and from the hero's Explain. It shows, in the existing order:

1. **F8 or F9 facts for the lift** (a builder in `explainInputs.ts` reads the sets of the exercise,
   the same function that made the suggestion, so the reason cannot differ from the number). For
   example: "On 12 Oct every set of back squat reached 6 reps with 1 to 2 left, so the load goes up
   one step, from 110 lb to 115 lb." / "Set 3 of back squat on 12 Oct ended at 2 reps, below the 3 to
   6 range, so the load comes down one step." / "The count of reps left was not recorded on 12 Oct,
   so the load holds." / "Today's readiness read is lower than usual, so each lift has one set
   fewer at a lighter load; the usual load is 110 lb."
2. **F7 facts for the session**: the week of the block, the template and what sets it ("Week 6 of
   12 of the strength block; heavy work follows a ramp-in of 3 weeks"), the equipment the lift is
   for, and why a plyometric dose is half (pace above 12 km/h, a bone stress history).
3. **The rules that rest on the rule alone** (E5, F4, F-lib), each with its grade and papers, as
   now.
4. **The grade and the gap**: F8 and F9 show grade D with one sentence from section 4.4 ("No study in
   runners compares ways of choosing the next load; this is a default.").

Every sentence is a template over a fact (ADR 0010): the suggestion carries `basis`, a list of
`{ template, slots }`, so the sheet's one-line reason, the drawer and the stored snapshot render
from the same facts, in the runner's units. New rule ids F7, F8 and F9 get titles in
`web/components/ruleTitles.ts` ("Strength session structure", "Strength load progression", "Lighter
days and the taper"); the coverage test requires each to have a builder or a policy entry, and F7,
F8 and F9 have builders.

## 11. Surfaces

### 11.1 Today

Strength is not a new budgeted slot. The workout travels in the Today payload as
`coach.slots.strength` (`TodaySlots` gains the field; `slotProviders` in `todaySlots.ts` gains a
provider, which the mapped type makes a compile error to forget), and two existing places render
it, so the first screen and the fold budgets of `slots.ts` are unchanged.

- **A day whose only session is strength** (`mainSession` returns it): the hero keeps its title,
  the planned-minutes figure and its action row, and replaces the targets list with the workout:
  one row per lift ("Back squat" / "4 x 3 to 6, 110 lb, leave 1 to 3"), one for the jumps ("Hops,
  60 contacts"), one for the trunk movements, at most five rows. The primary button reads "Log sets"
  and opens the sheet; Explain and Not today stay; "Save without sets" in the sheet is the old Done.
  A low-readiness day shows the lighter loads and one line: "Lighter today: one set fewer and 10%
  less. The usual load is one tap away." (figures from `P`).
- **A day with a run and strength** (the hero is the run): the "Also today" line already names
  strength (`SessionHero.tsx`, `today.hero.also`). The strength item becomes a button with the
  accessible name "Strength, 40 minutes: open the workout". It adds no height.
- **A preview day** shows the workout read-only, as the other previews do.
- **Offline** the hero and the sheet work from the kept payload (section 9.6).
- **The fold** is measured by `tests/e2e/12-today.spec.ts`; E14-8 adds a case for a strength-only
  day at 390 x 844 and at 360 px, with the check-in unanswered.
- **The estimated maximum** is never shown on Today, in the hero or in the "Also today" line (owner,
  question 10).

### 11.2 The session sheet and the Plan page

`SessionSheet` shows a Strength section for a strength session: the template and week, the lifts
with their loads and efforts, the jumps and trunk movements, "Log sets" (for today and earlier
dates), "Why" per lift, and the separation line ("Lift at least 3 hours before or after a run.",
the 3 from `f4.strengthSeparationHours`). A future session shows the workout as it would be now,
labelled "as of today": loads depend on sessions not yet done. The week rows keep their strength
count. The Profile hint under the strength choice says that the plan asks for at most two a week.

### 11.3 The Strength page

`/strength`, reached from More (`MorePage`, a link with the note "Lifts, loads and history"), not in
the tab bar. In phone order, in two columns from 900 px, with the sections of the Fuel lab as the
model:

1. **Setup** (only while `setupSaved` is false): "Set up strength", one sentence on what it changes,
   and the five parts of section 6.2.
2. **Next session**: the workout card with "Log sets" and "Add a past session".
3. **This block**: "Week 6 of 12, heavy", what follows in one line ("Maintenance from week 13; the
   taper keeps one light session a week"), the benefit sentence (section 4.5) with its grade badge,
   and a link to the research page.
4. **Lifts**: each exercise in the recent workouts with its last load, its estimated maximum and the
   last change in words.
5. **History of one lift** (chosen from the list): a table by date (load and reps of each set, reps
   left, the mode) and a line of the estimated maximum by session, drawn by the lazy chart module
   with the table as the accessible form; no colour carries meaning alone, and the line is labelled
   "Estimated maximum, from submaximal sets". This history, with its estimated maximum, is part of
   the bar of section 1.4.
6. **Recent sessions**: the last 30 with edit and delete.
7. **Equipment and units**: the weight unit, the equipment, the exercises left out and the injuries
   from the Profile with a link.
8. **About**: the evidence in four sentences, the grades, the defaults that are defaults, and the
   safety line.

Empty, loading and error states use exact copy from the templates, like the other pages. The page
is route-lazy if it imports a chart, so the entry chunk stays under the 500 kB that `vite.config.ts`
keeps it to.

### 11.4 Settings, the activity page and the list

- **Settings** gains "Weight units" (lb, kg) beside "Distance units"; it saves through
  `PUT /api/settings`, as the distance unit does.
- **The activity page** of a strength activity shows its sets as a table with "Edit sets", or "Add
  the sets" when it has none. The activities list shows "9 sets" in place of a distance.
- **The Log page** is unchanged; a strength entry made there still works and can get sets later.

### 11.5 What the Monday brief says about strength

Today it says nothing beyond a label: `brief.kind-strength` names the kind when a plan change
touches a strength session ("1 strength session added"), and `isKeyKind('strength')` is false, so a
strength session is never "the next key session". That stays in v1. Reason: the brief stores facts
under `BRIEF_VERSION` (ADR 0010), a strength line would be a new fact kind and a version bump, and
strength has its own weekly line in the Review page and on the Strength page (section 12). A later
brief line is a question for the owner, not a gap.

### 11.6 Copy

Strength copy is a template, at most 160 characters, ending in a full stop, with typed slots, and
passes `lintText`. The G5 list removes most gym vocabulary, so the app has its own words:

| Say                                                    | Never say                                      | Why                                         |
| ------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------- |
| "Suggested", "a sketch"                                | "Required", "target to hit"                    | Targets are a sketch                        |
| "Reps left" (first use: "reps left in reserve")        | "To failure", "failed set"                     | The lint bans "fail"; the idea is reps left |
| "Short of the range", "ended at 2 reps"                | "Missed", "failed"                             | G5                                          |
| "Heaviest set", "estimated maximum"                    | "PR", "personal best", "max out"               | G5                                          |
| "Lighter day", "lighter week"                          | "Deload" (jargon), "reduced because tired"     | Plain words, no blame                       |
| "Up one step", "the load holds"                        | "Progressive overload", "level up", "crush it" | Plain, G5                                   |
| "Add the sets", "Log sets"                             | "Complete workout", "streak"                   | No streaks, no badges                       |
| "Learn barbell lifts from a coach before adding load." | "No pain, no gain"                             | G6                                          |

Examples of the templates (each a registered id, with its slots):

- `strength.reason.increase`: "Every set of {exercise} reached {top} reps with reps left, so the load goes up one step."
- `strength.reason.hold-unrecorded`: "The count of reps left was not recorded, so the load holds."
- `strength.reason.reduce`: "Set {set} of {exercise} ended at {count} reps, below the {lo} to {hi} range, so the load comes down one step."
- `strength.reason.lighter-day`: "Readiness is lower than usual today, so each lift has one set fewer at a lighter load."
- `strength.hero.workout-row`: "{exercise}: {sets} x {lo} to {hi}, {load}, leave {rirLo} to {rirHi}."
- `strength.benefit`: "Strength work may lower the oxygen cost of running by about {lo} to {hi}%. It says nothing about race time."

Numbers that restate a Param (`{lo}`, `{hi}`, the reps left, the separation hours, the benefit
range) are filled from `P`, and a copy test renders each template next to the Param. A sentence
about a race time, an injury or another runner is never produced.

### 11.7 Accessibility and layout

- Every stepper is a group with an accessible name ("Back squat, set 2, load") and two buttons named
  "Lower the load by one step" and "Raise the load by one step", each at least 44 x 44 px; the value
  is a text field with `inputmode="decimal"`, so a keyboard works.
- At 360 px a set is two lines (load and reps, then reps left); there is no horizontal scroll, and
  the sheet's footer stays above the safe area.
- A state is never colour alone: "Lighter today", "Short of the range" and the mode of a logged
  session are words.
- Focus returns to the control that opened the sheet; Escape closes it and keeps the draft.

## 12. Tracking and review

### 12.1 What is tracked

Per exercise: the date, the sets (load and count, reps left), the mode, the estimated maximum of
the session, the heaviest set and the number of sets. Per week: the strength sessions planned and
logged (`WeekRow.strengthSessions` already counts logged ones), the sets and the loads that moved.
Everything is computed on read from the logs through the `strength.state` memo and shown on the
Strength page.

### 12.2 The weekly review

The Review page keeps "N of M strength sessions" for each week (`ReviewPage.tsx`) and gains, under
a week that has a logged session, one line per lift that moved ("Back squat 110 lb to 115 lb") and
a link to that lift's history. The data is the `weeks` list of `StrengthView` (the last 12 weeks);
no new request on the Review page beyond the one the Strength hook already makes, and no change to
`WeeklyReview` or to its stored record.

### 12.3 A skipped, moved or part-done session

- **Not today** records the session as skipped (the existing status). Nothing about the lifts
  changes; the next session starts from the last logged one, and the page says so: "Skipped. The
  next session picks up from the last logged one."
- **A moved or swapped session** (the adjust actions of phase 3a) keeps its row; the workout
  derives on the new date from the history only.
- **A part-done session**: a lift with no logged set is not judged and holds; a lift with a set
  short of the range is reduced; the others progress. The activity's status follows the existing
  completion rule (`completion.partialBelow`) by minutes.
- **A long gap** is the return rule (F8.2), not a penalty, and is worded as one: "A few weeks
  since the last session, so this one starts about 10% lighter."
- **No streaks, no counts of days in a row, no "behind".** A week with fewer sessions than planned
  reads "1 of 2 strength sessions", the form the Review page already uses.

### 12.4 How the plan reacts

- **Never to the loads.** Lifting data does not change a run minute, a run day, a stored session or
  a week's target. The workout reads the plan and the logs; it writes neither.
- **Consistently fewer sessions than planned.** After `f9.countPromptWeeks` (3, grade D)
  consecutive finished weeks in which fewer strength sessions were logged than planned, the
  Strength page and the Review page show one line: "Two a week is the plan; one fits a busy
  stretch too. Plan one a week?" with the button "Plan 1 a week". The button changes the Profile's
  strength choice, which takes effect at the next weekly update as a revision the runner can read
  and undo (ADR 0007). It is a question, never an automatic change, and it does not return for 4
  weeks after "Not now" (kept in the browser, a per-viewer convenience). Reason: the plan's count
  rests on grade A for the frequency and D for the dose, and ADR 0007 forbids a hidden change to a
  target.
- **More sessions than planned.** Nothing changes. The Strength page says "3 sessions logged; the
  plan asks for 2. More does not add to the block." with the range from `flib.strengthPerWeek`
  (2 to 3). Reason: the topic rule says not to raise frequency to chase benefit, and one lever at a
  time (F6).
- **Off the plan's days.** A session logged on the day before a long run, or on a day with a hard
  run, gets one plain note on the Strength page: "The long run is tomorrow; the plan keeps heavy
  lifting off that day." It does not move anything and does not repeat for that session.
- **A rest window** (J9) holds strength on its days as today; a log made on a held day is accepted.
- **Pain.** A pain score on a strength log is the activity's `pain`, so it reaches the existing
  readiness and niggle handling (`recentPain`) with no new path.

## 13. Tests

**Unit.** Weight: grams and pounds round-trip at the display step for every step the equipment
makes; display rounding; `stepsFor` for each equipment shape. Catalogue: ids unique; every slot
ladder ends in a feasible bodyweight answer; `harder` links form no cycle; every cue and note
template exists and passes the lint; every rule id used exists in `engine-rules.md`.
`strength.ts`: the template of every combination of block week, recovery flag, taper and return;
the block position and ramp-in length (lifting level, age 40, no setup); `pickLift` over every
subset of the eight equipment ids (a workout always exists; the barbell appears only when the bar is in the
equipment and never in a ramp-in or return week, at any lifting level; avoided and pinned
exercises are honoured); a change of equipment between two reads changes the next workout and not
the block position; the plyometric dose by week, pace, bone stress history and lighter week, with a
step taken only after a completed running week (a finished week at 79% and at 80% of its planned
run minutes, a week in a rest window, a run of incomplete weeks that holds the dose); `suggestLoad` row by row for F8.1 to F8.7 and F9 including each
boundary (a set one rep short, RIR exactly at the thresholds, a step exactly at the maximum, a gap
of 27 and 28 days, an unrecorded count, ties in the working load); order independence of the
history; no suggestion above the 90% ceiling; `estimateOneRm`; the replay of a synthetic six-week
history for a light start; the two source scans of section 3; every generated sentence passes
`lintText`; Param agreement tests for the rep range, reps left, the
separation hours and the benefit range. `macro.ts`: the anchored block (a plan re-planned weekly
for 12 weeks has exactly `e5.strengthBlockWeeks` flagged weeks; a goal 10 weeks out has none; a
goal 40 weeks out; a regenerate), session length by week type, `h10` read for ultra goals, the
existing matrix, replan-chain and weekend-plan tests unchanged except where the new session length
moves a day. `explainInputs.ts`: builders for F7, F8 and F9, and the coverage test for the three
new titles. A cross-surface test (`strengthSurfaces.test.ts`): the hero, the session sheet, the
logging sheet and the Strength page show one workout.

**API** (`tests/api/strength.test.ts`, with `expectNoRefusedFetches`): settings round trip and the
weight unit on `/api/settings`; anchors; the save creates an activity and a log, is idempotent on a
repeat with the same `logId`, replaces its sets, attaches to an imported strength activity, links a
session, refuses a non-strength activity and a second `logId` (409), rejects an unknown exercise, a
future date and an oversize body (400 with issues); another user's records are 404; delete cascades;
the data version changes on each write and the memo drops; `GET /api/strength/workouts` over a span;
the Today slot for a strength-only day, a run day, a preview and a day whose run is eased; Explain for the new
subject; the migration chain case; `createManualActivity` leaves `POST /api/activities` unchanged.

**Web** (`tests/web`, by role and name, with `expectCleanCopy`): the sheet filled as suggested and
saved; stepper presses move by the equipment step and stop at the ends; "As suggested" and "Same as
last time"; the bodyweight path has no load field; "Swap" and "Always use this"; the draft survives
a remount and is cleared on save, and a blocked `localStorage` does not break the sheet; the outbox
entry queues an offline save; the Today hero in the three cases; the "Also today" button; the
Strength page in each state; the setup parts; the weight unit row; the activity page's sets;
the count prompt.

**E2E** (`NN-strength.spec.ts`, the next free number at merge; `resetData()` and `signedInApi()`;
dates from the clock; no sleeps): save the setup with a barbell and dumbbells; change the equipment and the weight unit and see the
next workout follow; log a strength-only
session as suggested in three interactions; see the next session's load rise by one step after a
session at the top of the range with reps left; log a session with a set short of the range and see
the lighter next load and its reason in the Why drawer; the bodyweight path for a runner with no
equipment; the 360 px layout of the sheet and the page; a strength log saved offline in the offline
spec (`17-offline.spec.ts`, the only spec that allows service workers) and sent when the connection
returns.

## 14. Risks

- **Logging cost.** The rules need reps and reps left, and a log nobody makes helps nobody.
  Mitigation: the sheet opens filled, "As suggested" and "Same as last time", one value for the
  reps left of a lift, a draft that survives a reload, "Save without sets", and the offline outbox.
  The honest residual risk is that a runner logs sets with no reps left, and the load then holds
  for ever (F8.6). The sheet says why once ("Add the reps left to let the load move") and the
  Strength page counts how many recent sets have none.
- **Self-reported reps left are noisy** (gap 2). Mitigation: increases need every set at the top of
  the range with a recorded count; any short set lowers the load; the "As suggested" shortcut
  records the lowest value of the range; the two-step rule needs a count of 4 or more on every set.
- **Grade D numbers read as precision.** Mitigation: every Param says it is a default, the page
  says which numbers are, and the Why drawer shows the grade; a replay test records the behaviour
  so a change is deliberate.
- **Heavy lifting without technique** can hurt. The barbell leads for anyone with a bar after the
  ramp-in (owner, question 7), so the self-described level no longer limits it. Mitigation: the
  ramp-in on other lifts first, a first barbell session in the ramp-in structure at a conservative
  load with 3 or more reps left, the safety line, and no maximal attempt. Residual: the corpus holds
  no safety data on barbell lifting by recreational runners (gap 12), and G6 would have kept the
  barbell for the experienced.
- **The block anchor changes plan output.** Weeks flagged `strength-block` differ for a re-planned
  runner. Mitigation: the owner validation (E14-3), the tests of section 13, and the STATUS note.
- **A 40-minute budget changes placement.** A day with less than 40 free minutes after its run no
  longer takes a block session, so a tight week may hold fewer strength sessions than before.
  Mitigation: the matrix tests count strength sessions per week before and after; a week that loses
  one is listed in the PR; the owner confirmed 40 and 25 minutes (question 6).
- **A catalogue gap.** A runner's gym has a machine the catalogue lacks. Mitigation: bodyweight is
  always feasible, any catalogue exercise can be added to a session, and question 11.
- **Plyometrics add impact for a runner with 100-mile mileage.** Mitigation: low-amplitude movements
  only, a dose that ends well under the cap, a halved dose and a two-rung limit with a bone stress
  history, none in the taper, and the gap (6) stated.
- **Equipment changes mid-block.** A runner whose gym access starts after the ramp-in meets the
  barbell lifts at once (owner, question 1). Mitigation: the first session of an exercise with no
  history is a ramp-in structure session at a conservative load whatever the week (section 10.3),
  the history of related lifts is not converted, the block position does not restart, and the
  change shows only from the next session.
- **The bar of section 1.4 is not met.** A dedicated lifting app has features this design leaves
  out, and the owner may keep using one. Mitigation: the four requirements of section 1.4 are
  acceptance criteria, and the owner judges the result after a month of use.
- **Duplicates with imports.** A Strava or Apple Health strength activity and a manual log of the
  same session. Mitigation: the existing duplicate flow, with the log following the original.
- **Offline replay of a save after the activity was deleted.** The outbox shows its one-time
  refusal; no data is created.
- **Time zones.** Dates are the server's day, as everywhere; a log made while travelling is dated
  by the runner's date field.

## 15. Decisions taken

Each decision is overturnable by the owner; section 16 lists the ones that most need a look. Labels
follow the ADR convention: **Fact** (checkable), **Rule** (a standing policy), **Opinion** (an
arguable claim) and **Preference** (taste).

### 15.1 Owner direction (2026-10-23)

1. **Strength is the first phase 3b epic, after the distance estimate, with equipment and lifting
   history captured in the app and not asked up front.** Reason: the owner's words (section 1.1).

### 15.2 Decisions taken by the builder

2. **The prescription is derived on read and not stored on `PlanSession`** (section 5.1). Reasons:
   **Fact:** the equipment, the exercises left out and the logs all change without a re-plan, so a
   stored copy would be stale after each; **Rule:** a change to a target the runner cannot see and
   reverse is an anti-goal (ADR 0007), and a re-plan to refresh a prescription would be one;
   **Opinion:** the fuel target (ADR 0011) shows the pattern working, and `PlanSession`, pairing,
   diffs and undo stay untouched. Against: a stored prescription would make the session readable by
   a future watch or calendar export with no engine call; the workout function can serve that
   export when it is wanted.
3. **One pure module and one catalogue** (`shared/engine/strength.ts` and
   `shared/domain/strengthLibrary.ts`). Reason: **Rule:** one definition per concept (section 2.3);
   a cross-surface test holds the surfaces to it.
4. **A fixed catalogue of 25 exercises and no free-text exercises in v1** (section 7.5). Reasons:
   selection, stepping and explanation need metadata that free text lacks; the evidence is about
   named movements. Against: the owner asked for "specific exercises" and a runner who lifts
   something else has nowhere to keep it (question 11).
5. **Loads are stored in integer grams; the weight unit is `User.weightUnit`** (section 5.2).
   Reasons: **Rule:** ADR 0003 stores integers in base units; **Fact:** equality tests such as
   "same as last time" and the working-load rule would otherwise depend on floating-point
   rounding of pounds. The unit sits next to `User.units`, and `/api/settings` is one of the five
   reads the worker keeps. Against: a column in `StrengthSettings` is a smaller change; the `User`
   table is state either way.
6. **The log is an `Activity` of type `strength` plus sets, saved by an idempotent `PUT` with a
   client id** (sections 9.3 and 9.6). Reasons: matching, week counts, execution assessment, imports
   and duplicates already work on activities; an idempotent save can use the outbox. Against: a
   separate workout entity would be cleaner on paper and would put two counts of one session in the
   app.
7. **Reps in reserve regulates the load; the maximum is estimated and never tested** (sections 6.3
   and 10). Reasons: **Rule:** G6 and the anti-goal of a maximal attempt; **Opinion:** a tested
   maximum is a risk for a runner without a spotter. The equation and the thresholds are grade D
   (gaps 2 and 11).
8. **Double progression with steps from the runner's equipment** (section 10.2). Reason: **Opinion:**
   it is readable (the runner can predict the next load from the last session), it matches the
   3 to 6 range of the template, and it never asks for a load the equipment cannot make. Grade D
   (gap 1). Against: percentage waves or a fixed 5 x 5 would be simpler to write and no better
   supported.
9. **The strength block is anchored in the stored plan's week flags** (section 8.3). Reason:
   **Fact:** the probe of section 1.2 shows the block restarting at every re-plan and lasting the
   non-specific weeks minus 7. The flags already record the weeks; a block start date in
   `Plan.options` would be a second record of the same fact.
10. **Session budgets of 40 and 25 minutes** (sections 5.4 and 8.4). Reason: **Opinion:** 9 to 10
    heavy sets with full rests plus jumps take about 40 minutes; 30 forces fewer lifts than the
    template. It changes placement (risks); the owner confirmed it on 2026-10-24 (question 6).
11. **Until the setup is saved the workout is bodyweight-only** (section 6.1). Reason: **Rule:** G6.
12. **The barbell leads for anyone with a bar, after the ramp-in** (sections 6.2 and 7.2). The
    builder's first version required the self-described level "experienced"; the **owner** chose
    the wider rule on 2026-10-24 (question 7), with no reason recorded. Reasons: **Opinion:** the
    ramp-in on other lifts is the technique base that the topic rule asks for, and the barbell
    squat and hinge are the best-supported lifts of the ladders. Against: **Fact:** the corpus holds
    no safety data (gap 12), and **Rule:** G6 would have kept the barbell for the experienced.
13. **A four-rung ladder of low-amplitude movements, halved for a pace above 12 km/h, a bone stress
    history, a recent injury and a lighter week** (section 8.2). Reasons: **Fact:**
    `flib.plyoEmphasisPaceKmh` is graded A and nothing reads it; **Rule:** G6 for the injury cases. The dose, steps and rungs
    are grade D (gap 6). The owner confirmed the start at 40 contacts and the cap of 200 and added that a
    step is taken only after a completed running week (question 13).
14. **The taper keeps one light session a week and the race week none** (section 8.2). Reason: this
    is what the engine plans today (`macro.ts`), kept; rule K3 keeps intensity and frequency in a
    taper. Grade D (gap 8).
15. **Lifting data never changes the plan; the only prompt is a question about the weekly count**
    (section 12.4). Reasons: **Rule:** ADR 0007; **Opinion:** adherence is the runner's call, and a
    quiet change to a number the evidence rates A would be a worse default than asking.
16. **Strength has its own vocabulary** (section 11.6). Reason: **Rule:** G5 and the lint remove "PR",
    "fail" and "miss".
17. **Strength is not published to the watch or the calendar, and the weekly brief says nothing
    new** (sections 2.2 and 11.5). Reasons: publishing carries runs only (CLAUDE.md); a brief line
    is a new fact kind under `BRIEF_VERSION`.
18. **Today gets no new budgeted slot** (section 11.1). Reason: the fold is measured to the pixel
    (`slots.ts`); the hero and the "Also today" line already have room.
19. **Rule ids F7, F8 and F9, Params in `f-micro.ts`, ADR 0014** (0013 went to the load-progression
    decision on 2026-10-24). Reason: **Rule:** a Param's rule
    id must be a heading in `engine-rules.md` (`params.test.ts`); the numbers follow the registry's
    convention of a group per rule.
20. **Ultra goals read the `h10` Params** (section 8.2). Reason: **Fact:** they are registered and
    unread; the values equal the E5 and F-lib ones, so the plan does not change, and the grade the
    Why drawer shows becomes the ultra one (C).
21. **A regenerate starts a new block, and recent logged weeks skip its ramp-in** (section 8.3).
    Reason: `generateEnginePlan` passes no existing plan; the credit keeps an accidental regenerate
    from sending a lifter back to light loads. Grade D (`f7.blockCreditWeeks`).
22. **The plan keeps at most two strength sessions a week** (section 1.2). Reason: **Opinion:**
    placement with five or more run days and rule F6 (one lever at a time) argue against a third,
    although the topic rule allows 3 for lifters with a background. The Profile hint says so.
23. **All four strength tables are state** (section 9.3). Reason: **Rule:** CLAUDE.md: a model the
    snapshot, a memo or a published deliverable reads is state; none is written on a read path.
24. **Body weight on the Profile stays in kilograms.** Reason: no strength rule needs it beyond the
    first load (a table over `weightKg`); a unit-aware Profile is a separate small change.
25. **The novice pre-run hip and core block and the unplaced `mobility` kind stay out** (section
    7.1). Reason: they serve a different runner (novices) and a different session, and the corpus
    dose is D. Question 12.
26. **`PARAMS_VERSION`** follows the phase 3a policy: the PR that merges takes the next free suffix
    at rebase and updates the assertion in `tests/unit/engine/params.test.ts`; its description
    names the value. Tasks that change Params: E14-1, E14-3.
27. **The task list is part of this document** (section 17). Reason: **Preference:** one file to
    review for one epic; it moves to `docs/superpowers/plans/` unchanged when scheduled.
28. **The owner's answers to section 16 are in section 18.** Where one replaced a default of the
    builder, the decision above says so (10, 12, 13 and 19).

## 16. Open questions for the owner

Ranked by how much they change behaviour. Each has a default that the plan implements, and none
blocks a task. All sixteen were answered on 2026-10-24. Section 18 records the answers; where an
answer differs from a default below, the sections above and the tasks follow the answer.

1. **Equipment.** Which of the eight items does the owner have, where (home or a gym), and with what
   weights: the bar weight and the smallest plate; the dumbbell range and step; the kettlebell
   weights; bands; a step or box; a leg press, calf raise or leg curl machine? Default: bodyweight
   until the setup is saved. The answer decides which lifts appear.
2. **Lifting history.** The level ("new", "some", "experienced"), whether the owner lifts now, any
   recent working set or known maximum for a squat, a hinge or a calf raise, and any movement to
   leave out. Default: no setup saved, which gives a bodyweight workout and the 3-week ramp-in.
   "New" and "40 or older" give 4 weeks, "experienced" and lifting now gives 2.
3. **Weight unit.** Pounds or kilograms? Default: pounds, because miles is the distance unit. The
   Profile's body weight stays in kilograms either way.
4. **An existing lifting app.** Is there one whose history should come across? Default: none in v1;
   past sessions enter by hand or as a starting point. A CSV import of per-set data would be a
   separate task once the app and its export are named (its format is not assumed here).
5. **May the block displace an easy run in a low-volume week?** Default: never. The planner places
   strength after the runs, so a week with little free time holds fewer strength sessions, not
   fewer runs. For displacing: adherence in a short week. Against: the runs carry the load that the
   rest of the evidence is about, rule G-6 forbids making up volume, and one lever at a time (F6).
6. **Session length.** 40 minutes in a block week and 25 otherwise (default) or the current 30?
   Forty is closer to what the template takes and may drop a session from a tight week.
7. **Barbell lifts for "some".** Offer the barbell only to "experienced" (default), or to anyone
   who has the equipment?
8. **Lifting the day after the long run, or the day before a quality session.** Both are allowed
   today and F4 does not forbid them. Default: unchanged. Avoid them when another day fits?
9. **Session A and B.** Alternate the lead lift (default, a **Preference**) or repeat the same full
   session?
10. **The estimated maximum.** Shown on the Strength page and beside a load (default) or not at
    all? It is never on Today.
11. **A lift outside the catalogue.** Add an "other lift" that is logged but never progressed, or
    keep the catalogue closed (default)?
12. **The novice hip and core block and mobility sessions.** In scope for a later epic (default
    out)?
13. **The plyometric ladder.** Is a start at 40 contacts on the first rung right for a 100-mile
    runner's calves and Achilles tendons, or lower?
14. **The taper.** Keep one light session a week until the race week (default), or stop lifting
    when the taper starts?
15. **The count prompt.** Ask about a lower weekly count after 3 weeks of fewer sessions (default),
    or never?
16. **Smaller defaults to confirm:** the working-load tie rule (the lower load), the 28-day gap, the
    5% reduction, the 15% step limit, the history windows (26 weeks read, 12 weeks on the review, 60
    sessions in a lift's history), a year of backdating, and the four-week quiet period after "Not
    now".

## 17. Task list

The Global rules and the Verification gates of `docs/superpowers/plans/2026-10-22-coach-phase3a.md`
apply to every task unchanged: one task per engineer in a worktree from `origin/main`, test first,
`npm run check`, `npm run build` and `npm run test:e2e` before merge, `docker build .` for a task
marked **Docker**, the owner validation (`data/validate-owner.ts`, database outside the repository,
the PR quotes only the summary) for a task marked **Validation**, a wave review by reviewers who did
not write the diff, and `docs/STATUS.md` updated at each wave. A task never defines a second copy of
a contract in section 5; if it needs a change to one, it stops and reports. The migration folder is
renamed at rebase so it sorts after every migration on `main`. New e2e specs take the next free
number at merge.

### Wave 0

#### Task E14-1: Research update: rules F7 to F9, the Params, the gap pass, ADR 0014 (draft)

Size M. Depends on: nothing. **Validation** (Params only: the output is identical except
`paramsVersion`). Contract: sections 4 and 5.4.

- **Files:** `research/engine-rules.md`, `research/README.md` (method entry, if the gap pass runs),
  `research/papers/*.json`, `research/topics/strength-plyometrics.md` and
  `research/rules/strength-plyometrics.json` (only if papers are added),
  `shared/engine/params/{f-micro,index}.ts`, `tests/unit/engine/params.test.ts`,
  `docs/adr/0014-strength-prescription-derived-on-read.md`.
- **Acceptance:** rules F7, F8 and F9 are added to section (f) with grades and `[ids]`, and E5, F4,
  F-lib, H5 and H10 are amended as in section 5.3; the six topic rules of section 4.3 are folded
  in and the evidence ids of section 4.3 are added to the matching rows and Params; the numeric
  table gets the new rows; the gaps of section 4.4 join the evidence-gap list. Every Param of
  section 5.4 exists with its value, grade, rule id, evidence ids that exist in `research/papers/`
  and, for grade D, a note that says it is a default; the table `f8.startFractionBodyweight` holds
  a conservative fraction for every loaded exercise, listed in the PR for the owner. The gap pass
  is one `research-update` run on the gaps (a topic key such as `strength-progression`), its raw
  result kept outside the repository; each paper added is looked up (Crossref for metadata, Europe
  PMC or PubMed for the abstract) and passes `npm run research:verify -- <id>`; a paper that does
  not verify is left out, and if none does the rule text says the gap stands. No id, DOI or number
  is invented. `PARAMS_VERSION` is bumped. ADR 0014 is drafted as "Proposed 2026-10-24" with
  labelled reasons and the alternatives of decisions 2, 4, 5, 7 and 12; it is numbered 0014 because
  0013 records the load-progression decision of 2026-10-24.
- **Tests:** `params.test.ts` (headings, evidence ids, grade D notes); `npm run research:check`.

### Wave 1

#### Task E14-2: Weights, the catalogue, the load quantity and the copy

Size M. Depends on: E14-1. Contract: sections 5.2, 5.5, 7, 11.6.

- **Files:** `shared/domain/{weight,strengthLibrary}.ts`,
  `shared/copy/{quantity,template,templates,paramUnits,strengthTemplates}.ts`, `shared/types.ts`
  (the types of section 5.1, `EquipmentConfig`, `weightUnit` on `UserSettings`),
  `tests/unit/shared/{weight,strengthLibrary,strengthCopy}.test.ts`.
- **Acceptance:** the 25 exercises of section 7.1 with their implements, needs, measures, load
  bases, harder movements and rule tags; `isFeasible`, `substitutes` and the three slot ladders;
  `toGrams`, `fromGrams`, `stepsFor` and `formatLoad` with the display rounding of section 5.2; the
  `load` quantity and the optional weight-unit argument of `render` and `formatQuantity`, with
  every existing call and test unchanged; every name, cue, note and sentence of section 11.6 is a
  registered template within 160 characters, ending in a full stop, passing `lintText`; the units
  of the new Params have entries in `paramUnits.ts`; no numeric literal in the catalogue file.
- **Tests:** the unit tests above; the existing copy-lint test picks the templates up unedited.

#### Task E14-3: Engine: the anchored block, the session budgets, the rule ids

Size M. Depends on: E14-1. **Validation**. Contract: sections 1.2, 5.3, 8.3, 8.4, 8.5.

- **Files:** `shared/engine/{macro,micro,sessions,index}.ts`, `shared/engine/params/f-micro.ts`
  (`fplace.strengthSessionMin` retired), `research/engine-rules.md` (its table row),
  `tests/unit/engine/{macro,micro,sessions,matrix,replan-chain,params}.test.ts`.
- **Acceptance:** `macroPlan` counts the past `strength-block` weeks of `input.existing`, so a plan
  re-planned weekly (a `replan` chain with stored plans, not only regeneration) has exactly
  `e5.strengthBlockWeeks` flagged weeks in total, a goal fewer than 8 non-specific weeks away has
  none, and a regenerate starts a new block; `planStrength` and `placeWeek` use `f7.blockSessionMin`
  in a block week and `f7.maintenanceSessionMin` otherwise; the purpose sentence is the one-line
  form of section 8.5 and no longer restates Params; a strength session's rules include `F7` (and
  `H10` for an ultra goal); ultra goals read `h10.*`; nothing else in a plan changes except the
  days a longer session moves. The PR lists, for every matrix athlete, the strength sessions per
  week before and after; a week that loses a session is named. The validation summary is compared
  with the STATUS baseline and every difference is explained (expected: strength minutes and
  purposes, the number of weeks that carry the block flag in a re-planned chain). `PARAMS_VERSION`
  is bumped.
- **Tests:** the matrix, replan-chain and weekend-plan tests pass; the probe of section 1.2 becomes
  a test; a test replays weekly regeneration for 12 weeks.

### Wave 2

#### Task E14-4: The pure strength engine

Size L. Depends on: E14-1, E14-2. Contract: sections 5.1, 8, 10.

- **Files:** `shared/engine/{strength,types,index}.ts`,
  `tests/unit/engine/{strength,strengthSurfaces}.test.ts`.
- **Acceptance:** `strengthTemplate`, `blockPosition`, `rampInWeeks`, `pickLift`, `workoutFor`,
  `suggestLoad`, `estimateOneRm` and `summariseHistory` exist with the inputs of sections 8 and 10;
  they import `P`, types and the catalogue only, read no clock, and make no call; every row of
  sections 10.2 and 10.4 has a test, with the boundaries listed in section 13; `pickLift` yields a
  workout for all 256 subsets of the eight equipment ids, with the barbell only after the ramp-in and
  only with a bar; the plyometric dose steps only after a completed running week (section 8.2); the
  history is order-independent; no
  suggestion passes the 90% ceiling; every fact the module emits is a registered template and
  renders in both units; the two source scans of section 3 pass (no literal equal to a value of the
  `f7`, `f8` and `f9` groups, no figure inside a copy string); the replay of a six-week synthetic
  history for a light start is recorded in the test.
- **Tests:** the unit tests above, including the cross-surface registry with the workout adapter.

#### Task E14-5: Schema, settings, anchors and the log API

Size M. Depends on: E14-1, E14-2. **Docker**. Contract: sections 5.2, 6, 9.3 to 9.6.

- **Files:** `prisma/schema.prisma`, `prisma/migrations/<ts>_strength/migration.sql`,
  `server/{db,dataVersion,app,serialize}.ts`, `server/routes/{strength,settings,activities}.ts`,
  `server/services/{strength,activityStore,duplicates}.ts`, `shared/types.ts`,
  `tests/api/strength.test.ts`, `tests/unit/server/{migrations,modelClassification}.test.ts`.
- **Acceptance:** `User.weightUnit` with the backfill and the four models of section 9.3, all in
  `STATE_MODELS`; `PUT /api/settings` accepts `weightUnit`; the routes `PUT /api/strength/settings`,
  `PUT` and `DELETE /api/strength/lifts/:exerciseId`, `PUT` and `DELETE /api/strength/logs/:logId`
  and `GET /api/strength/logs` behave as in sections 9.4 and 9.5 (create or attach, session link,
  idempotent replace, 409 for a non-strength activity and for a second `logId`, 400 with issues,
  404 for another user's record, cascade on delete); `createManualActivity` is extracted and
  `POST /api/activities` behaves as before; a confirmed duplicate moves the log to the original;
  the migration test case passes and `docker build .` succeeds.
- **Tests:** the API tests listed in section 13; the migration chain.

### Wave 3

#### Task E14-6: The server read side: the strength state, workouts, the page view, Today and Explain

Size M. Depends on: E14-3, E14-4, E14-5. Contract: sections 5.1, 9.5, 10.5, 11.1, 12.

- **Files:** `server/services/{strength,today,todaySlots,explain}.ts`,
  `server/routes/{strength,explain}.ts`, `shared/engine/explainInputs.ts`, `shared/types.ts`,
  `shared/copy/explainTemplates.ts`, `web/components/ruleTitles.ts`, `tests/api/strength.test.ts`,
  `tests/unit/engine/explainInputs.test.ts`.
- **Acceptance:** `loadStrengthContext` reads the settings, anchors and the last 26 weeks of logs
  in one round through `memoByVersion` (`strength.state`), with a query-count test; the three read
  routes (workouts, the page view with `weeks` and the lift summaries, and one exercise's history)
  answer as in section 9.5; `coach.slots.strength` is correct for a strength-only day, a run day, a
  preview and a day whose run is eased, with the readiness read of the viewed day only;
  `GET /api/explain` accepts the subject `strength` and returns the F7, F8 and F9 facts and the
  policy rules, and the `session` subject of a strength session lists its own rules and no run
  rule; the titles for F7 to F9 and their builders land together and pass the coverage test; the
  Today ETag changes with a log (state) and needs no extra stamp.
- **Tests:** the API and unit tests listed in section 13.

#### Task E14-7: Web foundations: hooks, the strength sheet, drafts, the outbox entry

Size M. Depends on: E14-4, E14-5 (it builds against fixtures until E14-6 merges). Contract:
sections 9.1, 9.2, 9.6, 11.7.

- **Files:** `web/api/{strength,client}.ts`, `web/components/strength/*`,
  `web/components/lazySheets.tsx`, `web/pwa/{drafts,outbox}.ts`,
  `tests/web/{strength,strength-outbox}.test.tsx` (the second modelled on `fuel-outbox.test.tsx`),
  and `tests/web/lazySheetImports.test.ts`, whose list of sheets gains
  `components/strength/StrengthSheet.tsx` so a static import of it fails the test.
- **Acceptance:** the sheet of section 9.1 with 44 px steppers moving by the equipment step,
  "As suggested", "Same as last time", the reps-left scale with "All sets", add and remove a set,
  the bodyweight path with no load field, "Swap", "Save without sets", and a save that returns the
  `next` loads for a toast; the draft is kept under `strength-draft:<logId>` inside `try`, is
  cleared on save, and `purgeDrafts()` removes it; the `strength log` entry is in `OUTBOX_ROUTES`
  and a save made offline queues and replays; the sheet is lazy; pages and sheet pass
  `expectCleanCopy`. A session logged as suggested takes at most 3 interactions (the bar of section
  1.4).
- **Tests:** the web tests listed in section 13.

### Wave 4

#### Task E14-8: Today and Plan surfaces

Size M. Depends on: E14-6, E14-7. Contract: sections 11.1, 11.2.

- **Files:** `web/components/today/{SessionHero,StrengthHero}.tsx`, `web/components/SessionSheet.tsx`,
  `web/pages/ProfilePage.tsx` (the hint under the strength choice),
  `tests/web/{dashboard,session-sheet,profile}.test.tsx`, `tests/e2e/12-today.spec.ts`.
- **Acceptance:** the strength-only hero lists the lifts, the jumps and the trunk movements (at most
  five rows) with "Log sets"; the "Also today" strength item is a button with the accessible name
  of section 11.1; the lighter-day line and the usual-load control; the session sheet's Strength
  section; `DashboardPage.tsx` is not edited and `SLOT_BUDGETS_PX` is unchanged; the fold test has a
  strength-only case at 390 x 844 and at 360 px; offline, the hero and the sheet open from the kept
  payload.
- **Tests:** the web tests; the fold case.

#### Task E14-9: The Strength page, the setup, the history, Settings and More

Size M. Depends on: E14-6, E14-7. Contract: sections 6, 11.3, 11.4.

- **Files:** `web/pages/{StrengthPage,SettingsPage,MorePage}.tsx` (+ CSS), `web/App.tsx`,
  `web/components/Nav.tsx`,
  `web/components/strength/{SetupSheets,WorkoutCard,BlockCard,LiftHistory,AboutCard}.tsx`,
  `tests/web/strength.test.tsx` and the existing navigation and settings tests.
- **Acceptance:** `/strength` renders every section of 11.3 in phone order and in two columns from
  900 px, reachable from More and highlighted in the navigation; the five setup parts save as in
  section 6.2 and the workout changes on the next read; the lift history is a labelled table with a
  lazy line of the estimated maximum; empty, loading and error states use the exact copy; Settings
  saves the weight unit through `PUT /api/settings` (pounds by default for the owner, switchable by
  any runner); the equipment can be edited at any time and the next workout follows it (section
  6.5); the entry chunk stays under its budget.
- **Tests:** the web tests above.

### Wave 5

#### Task E14-10: Review lines, the count prompt, the activity page and imports

Size S. Depends on: E14-8, E14-9. Contract: sections 11.4, 12.

- **Files:** `web/pages/{ReviewPage,ActivityDetailPage,ActivitiesPage,StrengthPage}.tsx`,
  `web/components/strength/CountPrompt.tsx`, `tests/web/{review,activity-detail,strength}.test.tsx`.
- **Acceptance:** the Review page shows the lifts that moved for a week with a logged session; the
  activity page shows the sets and "Edit sets" or "Add the sets" for an imported strength activity;
  the list shows "9 sets"; the count prompt appears after `f9.countPromptWeeks` finished weeks with
  fewer sessions than planned, changes the Profile choice only on the button and is quiet for 4
  weeks after "Not now"; the more-than-planned and day-before-the-long-run notes read as specified;
  every page passes the lint.
- **Tests:** the web tests above.

#### Task E14-11: E2E, the narrow viewport, the offline case, handoff docs

Size S. Depends on: E14-10.

- **Files:** `tests/e2e/NN-strength.spec.ts`, `tests/e2e/17-offline.spec.ts`,
  `tests/e2e/06-narrow-viewport.spec.ts`, `tests/e2e/helpers.ts`, `docs/STATUS.md`.
- **Acceptance:** the e2e flows of section 13, including the interaction counts of section 9.1 (the bar of section
  1.4); the sheet and the page fit 360 px; a strength save
  made offline is sent when the connection returns; STATUS records the stable surface for the later
  epics (`StrengthView` and the workout, which an ultra-readiness epic can read) and closes
  follow-up 18.

#### Task C2: Close the strength epic

Size S. Depends on: every task above.

- **Files:** `docs/STATUS.md`, `CLAUDE.md` (Structure and Conventions, only where a convention
  changed), this document (the status line), `docs/adr/0014-...` (Accepted).
- **Acceptance:** full gates on `main`; a final owner validation compared with the epic's start,
  differences explained; `docker build .`; a last review for contract drift (a repository search
  for a second weight formatter, estimator, block counter or exercise list); CLAUDE.md names the
  conventions the epic added (the workout is derived through `shared/engine/strength.ts` only;
  loads are grams; no free-text exercise; strength logs are saved through
  `server/services/strength.ts`; the strength draft is purged with the others); the status reads
  "Implemented <date>"; STATUS lists what shipped, the manual checks still open (a real session
  logged on a phone in a gym, with and without a connection), the owner questions still open and a
  note that the owner judges the bar of section 1.4 after a month of use.

### Wave summary

| Wave | Tasks              | Migrations | Validation | Docker |
| ---- | ------------------ | ---------- | ---------- | ------ |
| 0    | E14-1              | none       | E14-1      | no     |
| 1    | E14-2, E14-3       | none       | E14-3      | no     |
| 2    | E14-4, E14-5       | strength   | none       | E14-5  |
| 3    | E14-6, E14-7       | none       | none       | no     |
| 4    | E14-8, E14-9       | none       | none       | no     |
| 5    | E14-10, E14-11, C2 | none       | C2         | C2     |

E14-1 (wave 0) and E14-3 (wave 1) are the only tasks that change Params; each takes the next
`PARAMS_VERSION` suffix at rebase. Two tasks in a wave that touch one file in different functions
(E14-6 and E14-5 on `server/services/strength.ts` and `server/routes/strength.ts`, E14-8 and E14-9
on `ProfilePage.tsx` and `MorePage.tsx`) rebase onto each other; neither redefines the other's
code. The owner answered section 16 on 2026-10-24 (section 18). Questions 1 to 3 are saved in the
app once E14-9 merges, and none of them is needed to build or merge any task.

## 18. Owner decisions (2026-10-24)

Recorded from the owner's walkthrough of section 16 on the evening of 2026-10-24 (PR #559). Each
entry gives the answer, the owner's reason where one was given, and where the body applies it. "No
reason recorded" means the owner answered without one and the reasoning of sections 15 and 16
stands. The questions stay in section 16 as asked.

1. **Q1, equipment: a per-user setting that can be changed at any time.** The owner's own setup is
   a small home set that a gym will soon replace, which is the change section 6.5 describes.
   Requirement, in the owner's words: equipment is "customizable for any user and switchable", and the workout, which
   is derived on read, follows the current equipment from the next session. Section 6.5; tasks
   E14-4, E14-9 and E14-11.
2. **Q2, lifting level: "some"**, with lifting on and off and no current working weights.
   Consequence: a 3-week ramp-in, conservative first loads and double progression. Sections 8.2
   and 10.3.
3. **Q3, weight unit: pounds by default for the owner, with a switch between lb and kg for any
   user.** No reason recorded. Sections 5.2 and 11.4.
4. **Q4, import: none in v1**, because the owner has no recent data to bring. Reason: the owner used
   Strong and may use it again unless the logging and the history here are good enough to skip it,
   so they have to be that good. Sections 1.4, 9.1 and 11.3.
5. **Q5, blocks and runs: a lift never displaces a run;** when no legal day exists the week holds
   fewer lifts. The owner asked for "two a day": a lift on the same day as an easy run, three hours
   apart, is already F4's preferred placement, so doubles stay the norm. Section 8.4.
6. **Q6, session budgets: 40 minutes in a block week and 25 in maintenance.** No reason recorded.
   Sections 5.4 and 8.4.
7. **Q7, barbell lifts: for anyone with a bar, after the ramp-in.** No reason recorded. Sections
   6.2, 7.2 and 14, and decision 12.
8. **Q8, placement: both stay allowed**, the day after the long run and the day before a quality
   run. No reason recorded. Section 8.4.
9. **Q9, session templates: alternate A (squat-led) and B (hinge-led).** No reason recorded.
   Section 8.1.
10. **Q10, the estimated one-rep maximum: yes in the history view, labelled an estimate, never on
    Today.** No reason recorded. Sections 6.3, 11.1 and 11.3.
11. **Q11, an "other lift" outside the catalogue: not in v1.** No reason recorded. Sections 2.2
    and 7.5.
12. **Q12, the novice hip and core block and mobility sessions: later.** No reason recorded.
    Section 7.1.
13. **Q13, the plyometric ladder: start at 40 contacts, step up only after a completed running
    week, cap 200.** No reason recorded. Section 8.2.
14. **Q14, the taper: one light session a week until the race week, none in the race week.** No
    reason recorded. Section 8.2.
15. **Q15, the prompt after three weeks of fewer lifts: keep it**, as a choice and within the slot
    budget. No reason recorded. Section 12.4.
16. **Q16, the smaller defaults: accept all, as grade D Params.** They are the working-load tie
    rule, the 28-day gap, the 5% reduction, the 15% step limit, the history windows, a year of
    backdating and the four-week quiet period after "Not now". No reason recorded. Section 5.4.

### Readings of the answers

Some answers leave a point open. The body adopts the readings below, each the smallest reading of
the owner's words, and the owner may overrule any of them.

1. **"Switchable" (Q1) means editable at any time.** Named equipment sets chosen per day, such as
   "home" and "gym", are not in v1; "Swap" (section 7.3) changes one exercise for one session.
2. **"Per profile" (Q3) means per runner:** `User.weightUnit`, changed in Settings and in the first
   sheet of the setup. The body weight on the Profile stays in kilograms (decision 24). With pounds
   as the default a kilogram field on the Profile reads oddly, and a unit-aware Profile is a small
   follow-up that the owner may want.
3. **The "history view" (Q10) is the Strength page:** the Lifts list and one lift's history, each
   labelled an estimate. The percentage of the estimated maximum beside a load in the logging sheet
   and the Why drawer stays, because the question's default included it and the answer accepted the
   question. Nothing about it appears on Today, in the hero or in the "Also today" line.
4. **A "completed running week" (Q13) is a finished week in which the runner ran at least
   `j5.completionHoldShare` (80%) of the planned run minutes,** the test that J5 already applies to
   the weekly volume. The condition gates both a step of contacts and a move to the next rung.
5. **"After the ramp-in" (Q7) excludes return weeks:** the ramp-in and return templates use no
   barbell lift (section 7.2).
6. **The bar (Q4) is judged on the lower-body programme.** A rest timer, a plate calculator, logged
   warm-up sets and upper-body lifts are not in v1 (section 1.4).
