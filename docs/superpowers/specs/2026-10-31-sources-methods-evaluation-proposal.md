# Sources beyond the corpus, a methods layer and an evaluation harness — proposal

Status: Implemented 2026-10-31 for S0 to S2, S4, H0 to H5, M0 to M6, and 2026-11-01 for RU1 (#619)
and RF2 (#621) (see `docs/STATUS.md`, follow-up 28); open: RU2, RU3, S3, H2b. Proposed 2026-10-31;
owner decisions recorded 2026-10-31 (section 7), one part open (decision 6). As proposed, this
document changed no code, Param, rule text or research record. It answers the owner's three
requests: which sources beyond the corpus should inform plans and how they are vetted; how plans
could follow different methods; which tools would test and evaluate plans. Baseline:
`main` at `bb63e675` (`PARAMS_VERSION` `2026-10-25.6`, 396 papers, 632 Params), re-read at
`b3e1093b` (docs and test fixes only). Four research reports and two reviews were data: every source
was checked against `research/papers` and Crossref on 2026-10-31, abstracts relied on were read on
Europe PMC that day, and no book was read. Engine claims were read in the code; figures come from
throwaway scripts in the git-ignored `data/` on the twelve synthetic matrix athletes.

## 1. Summary

**Finding 1: the corpus holds no book, and its source policy is a convention.** The 19 practice
records (`design: "book-or-guideline"`, level D, no DOI) are web pages, PDFs and magazine articles.
No field holds an edition, page, credentials, interests or agreement, and `research:verify` skips
records without a DOI. "May set a default, never raise a grade" holds (33 Params cite a practice
source, all D), but nothing enforces it. Daniels reaches the engine second-hand:
`macroDesign.longRunShareOfWeek` cites, among three grade D sources, a magazine whose record says
"the book was not checked"; its 0.35 is a share of time, not Daniels's share of distance.

**Finding 2: no method has been tested as a package, and no study shows that matching one to a
runner gives better races.** The one study of published plans finds no evidence for their
effectiveness [knopp-2024-marathon-plans]. E4 grades the choice by level A, but its base is one
exploratory subgroup on surrogate outcomes [rosenblat-2025-tid-ipd-nma]; it is the `tidModel` option.

**Finding 3: the suites prove conformance, not quality.** The matrix, sweeps and 142 oracle digests
show that every limit holds and steady plans do not change; none measures shape, compares plans or
misses days at random. Seven of twelve matrix plans have a median step of 0% between loading weeks;
six reach their class ceiling (`peakWeeklyMin.*`, D) within nine weeks and hold it to the taper.

**Finding 4: the checklist cannot see a loosened guard.** It reads the Params the generator reads:
with `g1.spikeRatioWarn` at 1.20, 11 of 12 plans changed and no item failed. Only literals
(`matrix.test.ts`, the 1.10 in `guards.test.ts`) and the pins of `params.test.ts` catch it.

**Finding 5 (outside the request): the Generate form switches off a rule.** `PlanPage.tsx` always
sends `recoveryCycle: '3:1'`; an explicit 3:1 makes `cycleShortReason` (`macro.ts`) and the same test
in `recoveryCadence` (`checklist.ts`) skip the new or low-frequency runner, so the novice-5k and
returning athletes plan 2:1 with the option absent and 3:1 with the form's value, though the hint
says the plan "shortens the rhythm itself". `computeReplan` reads the stored value at each re-plan.

**Proposal.** Three parts, none touching a guard. (a) Sources (3): a six-gate rubric, a cap per
class, optional book fields on paper records, a `training-methods` topic, a corrections check. (b)
Methods (4): a named preset over four values, chosen at generation, shown as a grade D choice, held
by persistent risk conditions; at most four, the default byte for byte. (c) Evaluation (5): metrics,
bands, simulation, back-test, outcome learning, scorecard, review; report-only, scan-tested.

**Recommendation and push-back.** Build the rubric and the metrics first (S0 to S2, H0, H1): cheap,
no plan changes, and they make a preset testable. Build presets only if the owner wants choice with
no outcome evidence behind it (decision 5). The engine already limits by days, injury history and
experience; the one pooled result on adapting training to the individual (HRV-guided, day to day)
improved submaximal markers, not performance [duking-2021-hrv-guided-meta]. A preset is honest as a
preference, never as a better plan.

## 2. What exists

### 2.1 The research base and its policy

- **Records.** 396 papers: A 55, B 64, C 188, D 89; 23 without a DOI. `paperSchema`
  (`scripts/research-check.ts`) is strict, `design` free text (18 values), no `kind` field. The 19
  practice records (7 programme pages, 10 coach or magazine articles, 2 clinical documents) appear
  65 times in `shared/engine/params`; 15 Params cite nothing else. The 14 consensus statements are
  graded by content: A 8, B 3, D 3.
- **Policy and checks.** README method step 7; no test ties a Param citing only practice sources to
  D. `research:check` (CI) checks schema and ids (`citations()` accepts paper ids only);
  `research:verify` checks DOI, title and year, no correction notice. Of four Crossref corrections,
  `tyler-2016-heat-adaptation-meta` and `mountjoy-2023-reds-consensus` go unmentioned.
- **Display and skill.** `PaperCard` links a DOI only; `researchBundle.ts` loads papers, rules and
  topics. The skill `research-update` has no step for a book or a column.

### 2.2 The engine's Params and the runner's options

- **Params.** 632 (`param()`): D 428, C 132, B 36, A 36; 110 cite no paper; 33 carry a `range`. `P`
  is a module singleton read at call time by 51 files (31 engine modules).
- **What fixes the method.** `planPhases` (`macro.ts`): base, build up to `macroDesign.buildWeeks`
  (6), specific 6 to 8 weeks, taper (K1). `cycleShortReason`: 3:1, or 2:1 for injury, choice, a new
  or low-frequency runner. `tidFor`: 83/12/5 base, 80/12/8 build. `wantedQuality`: up to
  `f2.qualitySessionsPerWeek` (2). `QUALITY_BY_PHASE` (`micro.ts`): a code table of kinds per phase.
  `daysFor` (`macroPlan`): 3 to `f5.mastersMaxRunDays` (6) run days, for every runner.
  `macroDesign.longRunShareOfWeek` 0.35, also read by `longRunFloor` and `startReach` (`goal.ts`)
  and `postRace.ts`. Ceilings `peakWeeklyMin.*`, `peakLongRunMin.*` (D).
- **Options.** `recoveryCycle`, `strengthSessions`, `tidModel` (polarized, 5 and 10 km only),
  `loadAppetite` (G-8), `gutTraining`; a `z.strictObject` (`server/routes/plan.ts`), and
  `parsePlanOptions` validates only `loadAppetite`. Only the load setting changes after generation
  (`commitLoadSetting`). A goal switch carries the options (`planSwitch.ts`).

### 2.3 Measured behaviour

`buildPlan` on the twelve matrix athletes; every plan passes the checklist. Weeks count from 1; a
loading week is not a recovery, taper or race week. "First at highest" is the first week whose
target equals the plan's highest; "within 5%" counts loading weeks within 5% of it.

| Athlete                 | Weeks | Peak min | First at highest | Loading weeks within 5% | Median step |
| ----------------------- | ----: | -------: | ---------------: | ----------------------: | ----------: |
| novice-5k               |    14 |       90 |                9 |                 1 of 11 |        7.9% |
| half                    |    20 |      270 |                5 |                11 of 13 |          0% |
| marathon                |    24 |      330 |                2 |                14 of 14 |          0% |
| trail-50k               |    23 |      390 |                6 |                11 of 14 |          0% |
| first-100-mile          |    34 |      600 |                9 |                16 of 21 |          0% |
| masters                 |    21 |      330 |                8 |                 7 of 13 |        3.1% |
| returning               |    21 |      270 |               14 |                 4 of 13 |        9.6% |
| prior-bsi               |    16 |      203 |               13 |                  2 of 9 |        4.7% |
| hot-race                |    29 |      330 |                6 |                15 of 18 |          0% |
| sparse-100-mile         |    38 |      600 |               30 |                 3 of 24 |        9.7% |
| reds-hold               |    23 |      285 |                1 |                14 of 14 |          0% |
| post-marathon-short-run |    16 |       99 |               13 |                 1 of 13 |          0% |

The plateaus sit at `peakWeeklyMin`, near which those runners already run. A marathon build week has
six run days, five of 43 minutes (two quality) and a 115-minute long run (0.35 × 330).

One Param at a time (a plan "changed" when its week list differs), no checklist item failed for
`longRunShareOfWeek` 0.30 (8 changed), `f2.qualitySessionsPerWeek` 1 (8), `buildWeeks` 4 and 9 (11,
9), `e2.specificWeeksMax` 6 (12), `recoveryWeekCutPct` 20 and 30 (11) or `g2.rampSoft` 0.07 (10);
`longRunShareOfWeek` 0.40 failed one `tid` item, `recoveryWeekCutPct` 15 ten `recovery-cadence`
items, and `g1.spikeRatioWarn` 1.20 and `g2.rampCeilingTwoWeeks` 0.35 (11, 1 changed) none.

### 2.4 The evaluation assets

- **Conformance and regression.** `matrix.test.ts` (12 athletes, limits re-derived with literals);
  `runChecklist` (15 items; a failure blocks publishing); sweeps of 150 runners and 576 rest
  windows; 142 oracle digests hashed without `paramsVersion`; `replanChain`, weekly to the race.
- **Records.** `PredictionLog`, `summariseRecord` (`backtest.ts`, "never pass or fail"),
  `PlanSession.execution`, `WeeklyReview`, `PlanRevision`; `data/validate-owner.ts` (git-ignored).
  Reusable: `monotonyStrain` (`load.ts`, B7), `RUN_KINDS` (`adjust.ts`), `pairSessions`.
- **Missing:** shape, comparison between plans, random misses, churn, skill, any outcome measure.

## 3. Sources beyond the corpus

### 3.1 What each class may do

| Class                            | Named examples (appendix A)                                                          | May                                                       | May not                                                | Cap               |
| -------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------ | ----------------- |
| Coaching books and manuals       | Daniels; Pfitzinger and Douglas; Koop; House, Johnston and Jornet; Humphrey; Magness | describe a prescription read in the book; fill a rule gap | raise a grade; move toward more load; enter by summary | D (Rule)          |
| Programme pages, columns         | the 19 practice records; columns that cite primary studies                           | find the primary study; be the sole source of a practice  | stand in for the study they report                     | D (Rule)          |
| Consensus statements, guidelines | 14 in the corpus; Bahr 2020; AGREE II as the appraisal tool                          | grade by content (rigour, base of studies)                | take a grade from the label                            | A to D by content |
| Conference abstracts, theses     | `baldea-2009-leadville-training` (an abstract, C)                                    | report a result read in the abstract or thesis            | outrank the peer-reviewed version                      | C (Opinion)       |
| Preprints                        | SportRxiv                                                                            | sit on a watch list until published                       | be cited by a rule or a Param                          | not admitted      |
| Trial registrations              | ClinicalTrials.gov, ISRCTN                                                           | show what a trial planned to measure                      | carry a result                                         | not admitted      |
| Data reports outside journals    | RunRepeat race results                                                               | describe distributions                                    | show that a plan works; set a default toward more load | D (Opinion)       |

Journal dataset analyses stay papers graded by design (`feely-2022-training-disruptions`,
`smyth-2021-marathon-taper-big-data` and `wegelin-2010-odds-finishing-161km` keep their B). **Why
the caps.** D is a Rule (README method step 7); the C cap and keeping preprints out are Opinion,
from biomedical studies outside sport: 62% of 102 trials approved in Copenhagen in 1994-95 changed,
added or omitted a primary outcome [Chan 2004]; 37.3% of meeting abstracts reached full publication,
positive ones more often (RR 1.31) [Scherer 2018]; peer-reviewed articles reported about 5% more
checked items than bioRxiv preprints (95% CI 1.4 to 8.6), "within a similar range" by the authors'
reading [Carneiro 2020]. Data reports select runners: among 2,172 respondents of one half marathon,
app and watch use differed by profile [Janssen 2017].

### 3.2 Books

| Work                                                                                   | Identified by                                     | Adds over the corpus                                                  |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Daniels J, _Daniels' Running Formula_, Human Kinetics; 1st ed. 1998, 4th ed. ©2022     | Open Library; publisher page (ISBN 9781718203662) | VDOT pace tables, season plans; the long-run limit the corpus quotes  |
| Pfitzinger P, Douglas S, _Advanced Marathoning_, Human Kinetics; 2001, 4th ed. ©2026   | Open Library; publisher page (ISBN 9781718237476) | 18- and 12-week plans at under 55, 55-70, 70-85, over 85 miles a week |
| Koop J (with Rutberg J, Malcolm C), _Training Essentials for Ultrarunning_; 2016, 2021 | Open Library                                      | the one complete ultra method found; the corpus has no ultra trial    |
| House S, Johnston S, Jornet K, _Training for the Uphill Athlete_, Patagonia, 2019      | Open Library                                      | aerobic-threshold base and strength for mountain running              |
| Humphrey L, _Hansons Marathon Method_, VeloPress; 2012, 2016                           | Open Library; author page (2011, read)            | a long run near 16 miles, 25-30% of weekly mileage, on prior fatigue  |
| Magness S, _The Science of Running_, Origin Press, 2014                                | Open Library                                      | physiology and sample programmes from 800 m to the marathon           |
| Hudson B, Fitzgerald M, _Run Faster from the 5K to the Marathon_, Broadway Books, 2008 | Open Library                                      | a self-coaching framework (assess, then build)                        |
| Lydiard A, Gilmour G, _Running to the Top_, Meyer & Meyer, 1997                        | Open Library (also _Run to the Top_, 1962)        | base-first periodisation as widely described; the most dated          |

Shared limits: no controls, survivorship, authors who sell plans, drifting editions, disagreement
(Hansons' 16 miles is "not the magic number" by its author). Daniels died in 2025 (Boston Globe,
2025-09-28); the 4th edition is the latest known. Table copyright is unassessed; records paraphrase.

### 3.3 The vetting rubric

Every source outside the journals passes six gates, and its record states each result: admit as
evidence (by design level) or as practice (D), hold, or leave out. The owner, or two independent
passes that each read the source (README method steps 2 and 3), sign an admission off.

- [ ] **R1 Provenance (hard).** The claim is located (edition and page, table, or URL and fetch
      date) and read in the source in the session that records it; a DOI resolves and Crossref's
      `updated-by` is read. Fails: known by report, an agent's summary or a mirror.
- [ ] **R2 Author (hard).** Named; credentials or track record confirmed in a record independent of
      the author (university, federation, publisher), the author's site only as a second;
      interests recorded. A seller is not excluded; an undisclosed interest in the claim is.
- [ ] **R3 Currency.** Date and edition recorded; the latest edition read or the difference stated;
      later consensus and corpus papers checked. Supersession decides, not age.
- [ ] **R4 Agreement.** Two independent sources agree (a magazine quoting a book is one source, as
      are papers sharing authors), or a graded corpus paper does; disagreement recorded, the
      conservative reading used (G6). A single source is held unless it is a practice's sole source.
- [ ] **R5 Applicability.** Population stated (distance, level, volume, age, sex, terrain); use
      outside it labelled extrapolated.
- [ ] **R6 Grade cap.** As in 3.1, outside the journals only; a journal paper keeps its design level.

R4 reaches the corpus: Foster, Seiler, Casado or Esteve-Lanao write `esteve-lanao-2007-tid-runners`,
`casado-2022-elite-runners-review`, Foster 2022, Casado 2023 and (Esteve-Lanao) Rosenblat 2025;
`oliveira-2024-pol-meta` and `filipas-2022-pyr-pol-periodization` come from other groups. The
Daniels magazine record fails R1 as Daniels's own rule. AGREE II [Brouwers 2010] can back R6.

**What stays out.** Forums (they may locate a claim, never support one); anonymous or uncited blogs;
marketing; calculator pages; mirrored books; retracted work; text written by a language model, a
model's summary of a book included. That last is a Rule (R1, ADR 0005): the two corpus studies test
model-written plans, not summaries [duking-2024-chatgpt-running-plans;
montaruli-2026-ai-marathon-programs].

### 3.4 Recording

- **A.** Books as paper records as they stand: no field for edition, page, interests or gates.
- **B (recommended).** Optional `paperSchema` fields (`edition`, `isbn`, `pagesRead`, `interests`,
  `vetting`) on `book-or-guideline` records: a Param can still cite the book (`citations()` and
  `params.test.ts` accept paper ids only), `researchBundle.ts` loads it, `PaperCard` shows it. What
  a method prescribes goes in a new topic `training-methods`.
- **C.** A `research/methods/<id>.json` type: not now; no Param can cite it and nothing loads it.
- **Corrections.** `research:verify` reads Crossref's `updated-by` and reports unmentioned notices.

## 4. The methods layer

### 4.1 Method families

"Basis" says what was read; "survey report" means unverified until a record passes R1. Candidates
(not in the corpus) carry no grade.

| Method                     | Basis                                                                                                  | Evidence for and against                                                                                                                                                                                                                                                                                 | Preset?                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Daniels                    | VDOT paces from a race: survey report; "2Q" plans by weekly mileage: Knopp's table of plans            | VDOT underestimated VO2max in both groups; threshold pace did not differ from lactate-threshold pace in 9 recreational runners but was faster in 11 collegiate athletes; interval pace was slower than VO2max pace in the recreational group [Scudamore 2018, candidate]; no trial of the plans          | no: paces stay C2           |
| Pfitzinger                 | 12- and 18-week plans in four mileage tiers: publisher page (4th ed.) read                             | none for the plans; volume and longest run go with faster marathons between cohorts, in univariate models [doherty-2020-marathon-training-meta, B]                                                                                                                                                       | no: volumes above D3        |
| Hansons                    | a long run near 16 miles, 25-30% of weekly mileage, on accumulated fatigue: author page read           | none for the plan; long-run evidence mixed: a longest run under 25 km went with slower marathons (self-reported categories) [fokkema-2020-half-marathon-volume-long-run, B]; at equal monthly volume it was unrelated to marathon time (men, one race) [yamaguchi-2023-volume-frequency-run-distance, C] | no                          |
| Lydiard                    | aerobic base, then hills, then track work: survey report citing the 1997 book                          | none; reverse periodization no better than traditional [gonzalezrave-2022-reverse-periodization, B]; E1 already puts base first                                                                                                                                                                          | as structure (P4)           |
| Polarized or pyramidal     | about 80% of sessions at low intensity in competitive endurance athletes [Seiler 2010, candidate]      | no overall difference; competitive polarized, recreational pyramidal in an exploratory subgroup on VO2max (13 short studies, 15% female) [rosenblat-2025-tid-ipd-nma, A]; a VO2peak edge only, pooled across sports [oliveira-2024-pol-meta, A]; disputed [Burnley 2022; Foster 2022]                    | stays the `tidModel` option |
| Norwegian double threshold | 3-4 lactate-guided threshold sessions and one VO2max session a week in up to 150-180 km: abstract read | a review of mechanisms [Casado 2023, candidate]; no controlled trial found; double days went with injury in trail runners [viljoen-2022-trail-risk-factors, B], a link by analogy only (other population and protocol)                                                                                   | no                          |
| Hudson                     | assess, then build the programme for the runner: survey report                                         | by analogy from another method (HRV-guided, day to day): performance g = 0.079, not significant; submaximal markers g = 0.296, significant; fewer non-responders; 8 small studies, fixed effects [duking-2021-hrv-guided-meta, A]; J5 already adapts weekly                                              | no                          |
| Koop; Uphill Athlete       | time-based ultra volume; base at or below aerobic threshold: survey report, pages not fetched          | no ultra training trial (gap 1)                                                                                                                                                                                                                                                                          | no                          |
| Run-walk (Galloway)        | walk breaks set by pace: corpus page `galloway-2026-beginner-run-walk`                                 | a race-day run/walk in 42 non-elite marathoners, walk ratio not given: similar times, less muscle pain [hottenrott-2016-run-walk-marathon, C]; not a test of the beginner programme                                                                                                                      | no: the E6 ladder           |
| Three runs a week (FIRST)  | three key runs plus cross-training: survey report                                                      | no study of the plan found; at equal monthly volume, frequency was unrelated to marathon time (men, one race, finishers) [yamaguchi-2023-volume-frequency-run-distance, C]                                                                                                                               | as structure (P2)           |
| Maffetone                  | 180 minus age as a heart-rate ceiling: survey report, page not fetched                                 | no study of the formula found; C1 and C2 rank thresholds above fixed heart-rate rules; in 50 cyclists, fixed %HRmax markers varied widely against VT1 [Meixner 2025, candidate], an extrapolation to runners and to another rule                                                                         | no                          |

Knopp analysed 92 non-peer-reviewed 12-week sub-elite marathon plans from 20 sources (top ten Google
and Amazon book results, August 2022; up to 17 plans per source; few state a target time). Over the
last 12 weeks they built 5-9% a week, peaked 3.6 to 4.4 weeks out, fell by a "22–31% weekly
decrease" to race week and 46-54% in the final week, with 4.1 to 6.8 runs a week by tier
[knopp-2024-marathon-plans; full text PMC11065819].

### 4.2 Does a characteristic of the runner predict the better method?

- **Level and goal.** E4's grade A rests on one exploratory subgroup (SMD -0.63 on VO2max) in 13
  short studies on surrogates [rosenblat-2025-tid-ipd-nma]; Oliveira's edge is on VO2peak only;
  marathoners lean pyramidal and 1500 m runners polarized, descriptively
  [casado-2022-elite-runners-review]. No study shows that a matched method gives better races.
- **Injury history and days free.** Injury history raises risk
  [vanpoppel-2021-overuse-risk-factors-review, A], a reason for G-3, not a method; three days a week
  injured fewer young men jogging hard than five [pollock-1977-frequency-duration-injury, C].
- **Response.** One block cannot separate response from noise; the remedy proposed is repeated
  interventions [hecksteden-2015-individual-response, D], and G4 forbids responder labels. Zinner
  2018 and Qin 2025 classify responders from one block each, so they show only a direction: Zinner
  counted more responders with low-intensity than with high-intensity or polarized mesocycles
  [Zinner 2018, candidate]; a TRIMP-matched trial found equal gains with 17% less time on a
  threshold focus [Festa 2019, candidate]. Of 774 novices 29.5% stopped within 26 weeks, 48% of
  them through injury [fokkema-2019-discontinuation-start-to-run, B].
- **The one matching claim.** Qin 2025 (120 recreational marathoners, randomised) reports experience
  predicting the better distribution (r = 0.72). Its headline, polarized gaining more on less volume,
  conflicts with Rosenblat's null; the methods survey found no registration (not re-checked). A
  review states "no consensus on the best practice" for recreational runners [Boullosa 2020,
  candidate].

### 4.3 Design

Options: (A) relabel `tidModel` and `recoveryCycle` as styles, which adds little; (B, recommended) a
typed preset overlay; (C) a generator per method, rejected because it duplicates every guard.

- **Storage and timing.** `EngineInput.options.method?`, absent meaning `default`; `Plan.options` is
  JSON, so no migration; `generateBody` and `parsePlanOptions` accept and validate it. Chosen at
  generation only: a change means generating again, which writes a `generate` revision (M6 optional).
- **Values.** A static record of overrides keyed only by the ids of 4.4. Each numeric override is a
  grade D `Param` in `params/p-methods.ts` with a default note and a rule headed `**P1 ` (to `P4`)
  in a new section (p) of `engine-rules.md`, which the heading check of `params.test.ts` finds
  (`M-<key>` would escape it: ids starting `m-` are exempt). The quality-kind table holds kinds, and
  a Param value must be numeric, so it stays a code table in `micro.ts` keyed by preset id. The 4.4
  bounds are asserted by a test over the static table (`methods.test.ts`), not clamped at run time.
- **Override points.** The four values are read in five files (`macro.ts`, `micro.ts`, `goal.ts`,
  `postRace.ts`, `explainInputs.ts`); a resolver replaces `P.<id>.value` there, as `tidFor` takes
  `polarized`, and `checklist.ts` reads effective values. No global swap of `P`, which module-level
  snapshots such as `CYCLE_REASON_WORDS` would read stale. Feasibility reads the effective share.
- **Applicability and display.** Each preset names its distance classes; one carried to a goal it
  does not fit (a goal switch) reads as the default, with the reason shown. Form and Why drawer show
  the rule, "grade D: a choice, not a better plan", each override against the default (ADR 0010) and
  the component grades; a book is credited only once its record passes R1.
- **Selection.** The runner chooses. Fit notes state facts the page already loads (availability from
  `useProfile`, the goal's class), never a score; experience and injury facts need a new read
  through `loadAthleteContext` and wait. Nothing is inferred from logs (G3, G4); no model picks.

### 4.4 What a preset may vary, and what it may never touch

| Value                                                        | Rule, grade     | A preset may                  | Bound (asserted by test)                 |
| ------------------------------------------------------------ | --------------- | ----------------------------- | ---------------------------------------- |
| `f5.mastersMaxRunDays` (run-day cap, `macro.ts`, `micro.ts`) | F5, D           | lower                         | 3 to 6; novices keep `f5.noviceRunDays`  |
| `macroDesign.longRunShareOfWeek`                             | design-macro, D | lower                         | 0.30 to 0.35                             |
| `macroDesign.buildWeeks`                                     | design-macro, D | shorten, lengthening base     | 4 to 6; specific phase and taper as now  |
| quality-kind table (`QUALITY_BY_PHASE`, code)                | F2              | choose another table of kinds | existing kinds; taper and race rows kept |

The 0.30 and 4 are test preferences, not Params. Every other Param and rule is never overridable:
among them `g1.*`, `g2.*`, G-3, G-5, G-6, G-8 and the load setting, `peakWeeklyMin.*`,
`peakLongRunMin.*`, `e3.*`, `e4.*`, `f2.*`, `k1.*` to `k3.*`, F1, F7 to F9, the E6 start paths, J7,
the H12 and J9 windows, the holds of section (n) and the checklist. The override type admits only
the four ids and a test rejects any other; each preset is also tested against literal bounds.

### 4.5 Coexistence with the load setting, the start paths and the options

- **Load setting.** Separate: how fast a plan rebuilds (G-8) against the plan's shape.
- **Holds.** A preset is held at the default, with the reason shown, while a persistent condition
  holds the load setting (`holdOf`, `loadSetting.ts`: `recent-injury`, `bone-stress`,
  `bsi-factors`, `reds-hold`, `bone-pain`). The transient `rest-window` and `post-race` holds do
  not: they open and close between weekly re-plans, and a preset following them would switch run
  days mid-plan, the mechanism of follow-up 27 (#570). E6 start paths plan their own weeks first.
- **Existing options.** A preset sets none of `recoveryCycle`, `tidModel`, `strengthSessions`,
  `loadAppetite`. **Ceilings** are not a decision: G6 keeps a preset from raising one, so it carries
  a method's shape at the runner's volume, never a 20-mile long run or 160 km weeks.

### 4.6 Candidate presets, measured with stand-ins

Each figure sets the one Param in-process on the twelve matrix athletes (no resolver exists yet).
No checklist item failed in any run.

| Preset (rule)         | Structure                                                           | Measured                                                                                                                                                                                                                                                                                                                                     | Honest note                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default (P1)          | today's engine, byte for byte                                       | —                                                                                                                                                                                                                                                                                                                                            | the evidence default                                                                                                                                                 |
| Three run days (P2)   | run-day cap 3; quality and long run as the default                  | weekly minutes unchanged in 8 of 12; the marathon build week becomes a 108-minute threshold session, a 107-minute easy run and the 115-minute long run; no `spike-warn` flag; minutes fall in the builds of sparse-100-mile (peak 600 to 570) and returning, in one masters week (by 1) and in first-100-mile's two post-race weeks (halved) | not FIRST's three hard runs; at marathon volume every run nears 110 minutes, so its classes are decision 6                                                           |
| Shorter long run (P3) | long-run share 0.30                                                 | longest run 115 to 99 minutes (marathon, masters, hot-race), 94 to 81 (half); `weeksNeeded` falls (half 5 to 4, masters 10 to 7, hot-race 6 to 3), as `longRunFloor` counts weeks toward the shorter run                                                                                                                                     | further below the D3 floor (25 km, B): 99 minutes is about 19 km in the marathon plan; long-run evidence mixed (4.1); run days and quality are already the default's |
| Longer base (P4)      | build 4 weeks; base quality strides only; build hills and threshold | with `buildWeeks` 4 alone, weekly minutes unchanged in all 12, sessions changed in 10; the kind table not prototyped                                                                                                                                                                                                                         | E1 is already base first; this lengthens it and delays intervals                                                                                                     |

Not offered: polarized as a preset (`tidModel` already is one), the Norwegian model, 180 minus age,
Pfitzinger and Lydiard volumes, Hudson, Daniels paces.

## 5. The evaluation harness

Report-only parts; the conformance asserts stay the only gate. By value for size: metrics,
scorecard and review, bands, simulation, back-test, outcome learning. No metric becomes a target: no
threshold without a rule, each figure labelled with its rule's grade (a band row "D, practice
source"), no injury probability, "safe", "behind" or "missed" (G5), reports stratified by the
sweep's axes, and a change that improves a metric still enters through `research-update`. A scan
test, as `noRawWrites.test.ts` scans `server/`, fails when a file under `shared/`, `server/`, `web/`
or `scripts/` imports the harness. G-5 gains one sentence: a descriptive figure in a report gates,
caps and justifies nothing, so it is not the ratio band the rule forbids (as ADR 0013 did).

### 5.1 Plan metrics

`describePlan(draft, input)` in `tests/unit/engine/plan-metrics.ts` (tests in
`plan-metrics.test.ts`, hand-computed), from the `PlanDraft` and Params alone, never from the code
that enforces a limit: weekly series, steps and headroom under G-2, plateau length (within 5% of the
peak, a preference), peak position, long-run share, realised against declared distribution, planned
load (minutes × the midpoint of `expectedRpe.<kind>`, grade D, relative only), monotony and strain
through `monotonyStrain` (B7, grade C; no flag, as a plan has no own range)
[foster-1998-monotony-strain], cycle and taper descriptors, run days (`RUN_KINDS`) and churn along
a chain (`pairSessions`). Treff's polarization index, log10((Z1 / Z2) × Z3 × 100) on fractions, an
empty zone 2 set to 0.01 (Eq. 2), prints as a value with the zone order, never a label: its 2.00
cut-off has no engine rule, and it calls a distribution polarized only when Z1 > Z3 > Z2 [Treff
2019, a hypothesis paper]. Computed here: 80/12/8 gives 1.73 (Z2 > Z3, not a polarized structure),
80/5/15 gives 2.38; Treff's own 80/8/12 gives 2.08. It stays in tests until a page shows it.

### 5.2 Reference bands

None is a verdict. (a) Knopp's peak position, build-up, taper steps and runs a week (4.1; CC BY
4.0), applied only to the last 12 weeks of marathon plans, each row "D, practice source". (b) The
corpus's 5 and 10 km programme pages and the start ladder. (c) Daniels and Pfitzinger only from an
edition the owner holds, as descriptors (weekly totals, long run, quality count, taper) with edition,
page, transcriber, date and a second check, outside the repository until copyright is settled.
Distance from a band, aligned on race week, is reported and never minimised.

### 5.3 Scenario simulation

`SimAthlete(seed, level)` drives the real `replan` as an extension of `replanChain`: session
completion, skipped days, weeks above plan, illness and niggle windows through the real `Disruption`
path, availability changes. Per chain: weeks at 80% of target or more (`j5.completionHoldShare`)
and above 120% (a test preference: `completion.extendedAbove` is per session), minutes moved per
re-plan, hold-progress-hold flips, peak drift, conformance at each step (`problemsOf`), minutes
delivered against the first plan. No fitness model (G2). Feely 2022 supports the shape of a
"ragged" level (over half of marathoners in 300,000 logs stopped for up to 6 days in the last 16
weeks, survivors only [feely-2022-training-disruptions, B]), not its rates. Metamorphic relations
[Segura 2016]: a closed day never raises a week; a re-plan with no new data is a fixed point.

### 5.4 Back-test, outcome learning and their limits

- **Back-test.** A replay beside `data/validate-owner.ts`, outside the repository: each Monday with
  only the activities up to it; the 5.1 metrics, how far the next weeks ran from the plan, what the
  re-plan changed; counts only. It measures plan against behaviour, not whether a plan works. Two
  report figures join it, with no change to L7, `backtest.ts` or the track-record page: skill
  against a naive baseline (Riegel gave half of marathoners a time 10 minutes or more too fast
  [vickers-2016-race-times]) and an interval score [Gneiting 2007], since coverage rewards wide
  bands. Showing either in the app would be a rule change with Params.
- **Concludable for one runner, descriptively:** adherence by session kind and week type, time to a
  completed week after a disruption, reported effort against the D `expectedRpe` defaults (G3),
  calibration after 3 scored races.
- **Not concludable:** that a plan or method worked. One race a season is confounded; repeated
  interventions [hecksteden-2015-individual-response] do not fit a season; a causal answer needs
  many runners and a target-trial emulation [wang-2024-target-trial-load], a product and privacy
  decision (decision 12). Injury outcomes, if recorded, follow [Bahr 2020].

### 5.5 Scorecard and plan review

A one-page scorecard per plan from 5.1; each row carries its rule's grade. No overall score: no
outcome validates a weighting of the 22 criteria coaches used [duking-2024-chatgpt-running-plans].
No acute:chronic ratio (G-5): the direction changes with study and method, inverse in two cohorts
[nakaoka-2021-acwr-runners; frandsen-2025-session-spike], more injury above 1.5 in two others
[toresdahl-2023-nyc-marathon-training-injury; craddock-2020-acwr-two-oceans], and the methods flag
different sessions [cloosterman-2024-acwr-methods]. A project skill `plan-review` applies the
close-review pattern of `docs/STATUS.md` (lenses, two independent refuters per finding) to one plan
and its why-text: rules re-derived apart from the engine, evidence honesty, the objections a coach
might raise as a language model voices them, fit to availability, a lost week. Output is a list for
the owner, never a plan edit (ADR 0005), and an unvalidated judgement that vouches for nothing.

## 6. Arguments against, and what is not proposed

- **Presets sell choice without outcomes**, and a menu implies that one method suits the runner
  better. Mitigation: structural names, "a choice, not a better plan"; the alternative: no presets.
- **Credits overstate fidelity** (a shape inside every guard is not a book's method), so a credit
  waits for a read record. Each preset adds matrix and chain runs (M5); the oracle pins the default.
- **Book fields** grow a strict schema for a few records and can lend popular plans authority; the
  rubric's own evidence is general biomedicine (3.1); and no book was read.
- **The harness can steer the engine**: a plateau metric invites tuning toward progression without
  evidence, a simulator tuning to itself, a review a coach's taste. The scan test and the
  `research-update` route block code paths; neither stops a reader tuning toward a figure.
- Not proposed: raising a ceiling or guard; lactate-guided or double-day training; inferring a
  method from logs; a model ranking methods; pooled data; scraping; reproducing book tables.

## 7. Decisions for the owner

1. **Book records.** Default: option B and a `training-methods` topic. Against: a strict schema
   grows for a few records; C makes methods first-class but needs a citation and display path.
   **Answered 2026-10-31:** B, the default: optional `edition`, `isbn`, `pagesRead`, `interests`
   and `vetting` fields on `book-or-guideline` records, and a `training-methods` topic.
2. **Rubric and corrections.** Default: R1 to R6 in the README and the skill, `updated-by` in
   `research:verify`, the Tyler and Mountjoy records annotated, the 19 practice records marked as
   predating the rubric and re-vetted when next touched. Against: more steps per source.
   **Answered 2026-10-31:** the default for the rubric R1 to R6 in the README and the skill,
   `updated-by` read by `research:verify` (done in #596), and the Tyler and Mountjoy records
   annotated. Beyond the default, all 19 practice records are re-vetted now (S4), not marked and
   left until next touched. Reason: the owner chose one standard across the corpus over the
   cheaper mark-and-wait.
3. **Daniels citation.** Default: relabel it "as reported by Running Magazine" in the record and the
   Param note; 0.35 stays, held by three D sources. Against: cosmetic until a page is read.
   **Answered 2026-10-31:** the default: relabel it "as reported by Running Magazine"; 0.35
   stays; S3 reads the page.
4. **Other classes.** Default: columns are finding aids; preprints and registrations on a watch list
   in `docs/research/watch-list.md`; abstracts and theses at C at most; data reports outside
   journals at D; model-written text never a source. Against: a strong preprint waits.
   **Answered 2026-10-31:** the default: the 3.1 caps; preprints and registrations on the watch
   list; model-written text never a source.
5. **Build the methods layer?** Default: yes, option B, after H0 and H1, at most four presets with
   the default. Against: no matching evidence (4.2); each preset adds tests and copy.
   **Answered 2026-10-31:** yes, option B (a typed preset overlay), after H0 and H1, at most four
   presets with the default.
6. **Which presets.** Default: P1, P4, and P2 for 5 km to half-marathon goals only, whose class
   ceilings in the matrix (180, 210, 270 minutes) three runs carry at 60 to 90 minutes each; P3 out,
   as it moves the long run further below the grade B D3 floor while the outlook shortens. Against:
   P3 is one value near the Hansons page's 25-30%; a weekly cap for P2 (less load, which G6 allows)
   would serve marathoners too, at the cost of a new grade D Param on the whitelist.
   **Answered 2026-10-31:** the default: P1, P4, and P2 for 5 km to half-marathon goals only; P3
   out. Open: whether P2 is extended to marathon goals with a weekly-minutes cap or a
   cross-training session kind; the owner has not yet said.
7. **Finding 5.** Default: fix the form only (an Automatic state; `recoveryCycle` sent only when
   picked; an explicit 3:1 still honoured; stored plans untouched). Against: plans stored with the
   form's 3:1 keep the rule off until regenerated. Alternative: read `'3:1'` as no choice in
   `cycleShortReason` and `recoveryCadence`, reaching stored plans at the next re-plan (less load),
   which drops an explicit 3:1 and reverses `macro.test.ts` and a `replan-chain.test.ts` premise.
   **Answered 2026-10-31:** done in #587.
8. **Changing a preset later.** Default: at generation only. Against: a change is a regeneration,
   not one undoable revision; M6 adds that action, as the load setting has.
   **Answered 2026-10-31:** M6 now, not the default: an in-place change action like the load
   setting's, through `computeReplan` with the current week held, as one undoable revision. The
   mid-plan run-day switch (follow-up 27) is guarded as the transient holds are (4.5). Reason:
   consistency with the load setting's in-place change.
9. **Report-only harness.** Default: yes, `npm run check` unchanged, the scan test, an ADR with the
   G-5 sentence. Against: a report nobody reads protects nothing.
   **Answered 2026-10-31:** the default: report-only; `npm run check` unchanged; the scan test;
   the ADR with the G-5 sentence. One habit is added: `research-update` and the kickoff require
   `npm run plan:report` at every `PARAMS_VERSION` bump, and its scorecard delta in the PR.
10. **The plateau.** Default: report it; no engine change (G6). Alternative: a `research-update`
    pass on progressive builds against early plateaus. Against: the shape stays unexplained.
    **Answered 2026-10-31:** the alternative, not the default (RU2): a `research-update` pass on
    progressive builds against early plateaus, asking whether the ceiling is the evidence,
    whether the class `peakWeeklyMin` or the history-informed ceiling (ADR 0013) should bind, and
    what the literature says about volume inside a plateau. It ends in a rule change or a stated
    reason in the Why drawer. Reason: the plateau is the shape the runner sees, and a report
    without a reason explains nothing.
11. **Simulator.** Default: three stress levels (compliant, ragged, overshooting), ragged first, by
    hand and at each `PARAMS_VERSION` bump. Against: chain time is unmeasured.
    **Answered 2026-10-31:** the default: compliant, ragged and overshooting; ragged first; by
    hand at each `PARAMS_VERSION` bump. The two metamorphic invariants may enter `npm run check`
    as plain invariants if H2 measures their chain time under a minute (they are rules, not
    metrics).
12. **Outcome learning.** Default: descriptive; baseline and interval score as back-test figures; no
    pooled data. Against: "which method works" stays unanswerable for one runner.
    **Answered 2026-10-31:** the default: descriptive; the baseline and the interval score as
    back-test figures; no pooled data.
13. **Qin 2025.** Default: watch list. Alternative: admit as C, cited by no rule.
    **Answered 2026-10-31:** the alternative, not the default: read Qin 2025 in full (Scientific
    Reports, open access) in a `research-update` session and admit it at its design level if R1
    to R6 pass, cited by no rule until a rule exists. No reason recorded.

**Question of fact.** Which books of 3.2 does the owner hold? S3 and band (c) wait for the answer.
**Answered 2026-10-31:** the owner will buy or borrow any title not held, so S3 and band (c)
proceed as though every book of 3.2 is held, with the owner reading the pages a record needs.

Owner decisions recorded 2026-10-31 (this session's walk-through). Also decided 2026-10-31 on
the strength side: the logging sheet keeps reps left (reps in reserve) and a `research-update`
pass grounds the RIR Params (`f7.heavyRir`, `f8.progressMinRir`, `f8.bigStepRir`, grade D).

## 8. Task list

One task per engineer, own worktree from `origin/main`, test first, after its dependencies merge.
**Validation**: 142 oracle digests byte-identical; owner validation quotes counts only. Each ADR
takes the next free number at merge (0015 at `b3e1093b`) and labels every reason Fact, Rule,
Opinion or Preference; each corpus change adds a README method entry.

- **S0. Three record edits.** S. Done in #600. Skill `research-update`: the Daniels citation in its
  record and the note of `longRunShareOfWeek`; the Tyler and Mountjoy corrections. No value or grade
  changes.
- **S1. Corrections check.** S. Done in #596. `scripts/research-verify.ts`: a pure function over a
  stored Crossref message, tested in `tests/unit/research/` without network; a run by hand reports
  four notices.
- **S2. Rubric and book fields.** M. Done in #602. Decisions 1, 2, 4. `research/README.md` (R1 to
  R6, sign-off; S4 re-vets the 19 records), the skill ("add a source outside the journals"),
  optional fields in `paperSchema`, the workflow's paper schema and `write-corpus.mjs` with tests; a
  `params.test.ts` case that a Param citing only practice sources is D; `PaperCard` shows `url`; the
  watch list; ADR.
- **S4. Re-vet the 19 practice records.** M. Done in #606 (two passes, S4 and S4b; 15 pass and 4
  stay on `PREDATES_RUBRIC`). Decision 2. Depends S2. Each of the 19 is read against R1 to R6 (3.3)
  and states its gate results in `vetting` (3.4, B). A change to a Param's value or grade is not
  part of this task and goes through `research-update`.
- **S3. First book records.** M each. Open: the owner reads the pages. Depends S2 and S4; the
  question of fact is answered. From read pages only: works a preset would credit (Pierce, Murr and
  Moss; Lydiard), then corpus gaps (Koop 2nd ed., Daniels 4th, Pfitzinger 4th); topic
  `training-methods`.
- **H0. Plan metrics.** S to M. Done in #597. `plan-metrics.ts` and `plan-metrics.test.ts` with
  hand-computed cases, reusing `monotonyStrain`, `RUN_KINDS` and `pairSessions`; no engine file
  changes.
- **H1. Report, bands, scorecard, scan.** M. Done in #601. Depends H0.
  `tests/reports/plan-report.ts` (outside the Vitest include; `scripts/` imports nothing from
  `tests/`), run by a new `npm run plan:report` with a CLAUDE.md Commands line: the 5.1 table over
  matrix and sweep; Knopp's marathon bands as a fixture with source id and read date; a scorecard
  per plan; `harness-isolation.test.ts` (5).
- **H2. Simulator.** M to L. Done in #604; most of the engine defects it found were fixed in #608
  (RF1) and the rest in #621 (RF2), apart from the cases that stay pinned for RF4
  (`docs/STATUS.md`, follow-up 28). Depends H0.
  `tests/unit/engine/sim-athlete.ts`, a scorer, the ragged level, a measured chain time, metamorphic
  cases. **H2b** (S, open): the tuning of the other two levels (H2 shipped all three, with their
  rates as named constants).
- **H3 to H5.** S each. Done: H3 in #601, H4 in #603, H5 in #605. H3:
  `.claude/skills/plan-review/SKILL.md`, output headed unvalidated. H4: the back-test in `data/`,
  counts only, with baseline skill and interval score; no change to L7, `backtest.ts` or
  `trackRecord.ts`. H5: the G-5 sentence through `research-update`, and the ADR.
- **M0. Finding 5.** S. Done in #587. Default: `PlanPage.tsx` (an Automatic state),
  `GeneratePlanRequest`, `tests/web/plan.test.tsx`; no engine change, so the oracle holds. The
  alternative adds `macro.ts`, `checklist.ts`, the two reversed tests and a stored-3:1 chain case,
  naming each moved digest.
- **M1. Research update for methods.** M. Done in #607 (second pass M1b). Skill `research-update`:
  the candidates of 4.1 and 4.2 read in that session, topic `training-methods`, section (p) with
  `**P1 ` to `**P4 ` headings.
- **M2. Preset type and override points.** M. Done in #610. Depends M1, H1.
  `shared/engine/types.ts`, `params/p-methods.ts`, the resolver, the five readers and
  `checklist.ts`, `server/routes/plan.ts`, `server/serialize.ts`, `GeneratePlanRequest`, an ADR.
  Absent and `default` give today's plans byte for byte (a `method: 'default'` case in
  `history-oracle.test.ts`); a test rejects ids outside 4.4; API tests reject an unknown method and
  read an inapplicable one as the default. **Validation.**
- **M3. Presets and holds.** M. Done in #610 (the Params, the kind table, applicability and the
  holds) and #612 (the two decisions it left). Depends M2. Decision 6. `p-methods.ts`, the kind
  table, applicability by class, holds through the persistent `holdOf` reasons, `methods.test.ts`
  bounds.
- **M4. Form, Why drawer, copy.** L. Done in #611. Depends M3. `PlanPage.tsx` (fit notes from
  `useProfile`), `WhyDrawer.tsx`, `INPUT_BUILDERS`, `ruleTitles.ts`, templates in `shared/copy/`
  passing `lint.ts`; page tests by role and name; an e2e spec at the next free number (20 at
  `b3e1093b`).
- **M5. Presets across matrix and chains.** L. Done in #612. Depends M3, H1. `matrix.test.ts` at
  every preset; `replanChain` per preset, with a rest window opening and closing mid-plan; the
  fixed-point relation; fidelity from finished sessions (run days, quality count, long-run share);
  an H1 column.
- **M6. Change action.** M. Done in #615. Decision 8. Decided: ships with M3 to M5. A `PUT` in
  `server/routes/plan.ts`, a commit in `planActions.ts` like `commitLoadSetting`, a `method`
  argument through `computeReplan` with the current week held, its diff and undo `setting`,
  `PlanRevisionReason`, `shared/copy/revision.ts`, `web/api/plan.ts`, a sheet; the run-day switch of
  follow-up 27 guarded as the transient holds are (4.5); API, page and chain tests.
- **RU1. RIR research update.** S. Done in #619, with a second reading pass (RU1b). Skill
  `research-update`: the Params `f7.heavyRir`, `f8.progressMinRir` and `f8.bigStepRir` (grade D);
  Zourdos 2016 and the RIR-based RPE literature, read in that session; gap 2 of the strength spec
  (no paper mentions RIR). `f7.heavyRir` is now grade C; no value changed.
- **RU2. Plateau research update.** M. Open. Decision 10. Skill `research-update`: progressive
  builds against early plateaus (Finding 3: six of twelve matrix plans reach their class ceiling
  within nine weeks); whether the ceiling is the evidence, whether the class `peakWeeklyMin` or the
  history-informed ceiling (ADR 0013) should bind, and what the literature says about volume inside
  a plateau. It ends in a rule change, which names each moved oracle digest, or a stated reason in
  the Why drawer.
- **RU3. Rest days between return runs.** S. Open; a value question for the owner. S4b (#606) found
  that `injuryReturn.restDaysBetween` is 1 day while the tendon table it takes its levels from (the
  Sanford record) says 2 to 3 days between runs, so the Param is less conservative than its source.
  Skill `research-update`; a change names each moved oracle digest.
- **C. Close.** S, after each wave: a `docs/STATUS.md` entry with counts and the oracle result. Done
  for this build in `docs/STATUS.md`, follow-up 28.

Every decision of section 7 is answered, so only the open part of decision 6 (P2 for marathon
goals) waits for the owner. Every task above is done except RU2, RU3, S3 and H2b, and none of
those waits on another task: S3 waits on the owner's reading of the pages, RU3 on the owner's
answer, and RU2 and H2b on a session to run them.

## Appendix A. Sources

Checked 2026-10-31. Candidate: DOI resolved on Crossref with matching title, first author and year;
"abstract": read on Europe PMC that day; "full text": read in PubMed Central; "metadata": not read.

**In the corpus**

- Knopp M et al., Quantitative Analysis of 92 12-Week Sub-elite Marathon Training Plans, 2024, 10.1186/s40798-024-00717-5 (`knopp-2024-marathon-plans`; full text PMC11065819 read)
- Düking P et al., ChatGPT Generated Training Plans for Runners are not Rated Optimal by Coaching Experts, but Increase in Quality with Additional Input Information, 2024, 10.52082/jssm.2024.56 (`duking-2024-chatgpt-running-plans`)
- Montaruli G et al., Artificial intelligence-generated marathon training programs: reliable tools in exercise prescription for athletic performance?, 2026, 10.1093/bmb/ldag010 (`montaruli-2026-ai-marathon-programs`)
- Hecksteden A et al., Individual response to exercise training - a statistical perspective, 2015, 10.1152/japplphysiol.00714.2014 (`hecksteden-2015-individual-response`)
- Rosenblat MA et al., Which Training Intensity Distribution Intervention will Produce the Greatest Improvements in Maximal Oxygen Uptake and Time-Trial Performance in Endurance Athletes? A Systematic Review and Network Meta-analysis of Individual Participant Data, 2025, 10.1007/s40279-024-02149-3 (`rosenblat-2025-tid-ipd-nma`)
- Silva Oliveira P et al., Comparison of Polarized Versus Other Types of Endurance Training Intensity Distribution on Athletes' Endurance Performance: A Systematic Review with Meta-analysis, 2024, 10.1007/s40279-024-02034-z (`oliveira-2024-pol-meta`)
- Casado A et al., Training Periodization, Methods, Intensity Distribution, and Volume in Highly Trained and Elite Distance Runners: A Systematic Review, 2022, 10.1123/ijspp.2021-0435 (`casado-2022-elite-runners-review`)
- Esteve-Lanao J et al., Impact of training intensity distribution on performance in endurance athletes, 2007, 10.1519/r-19725.1 (`esteve-lanao-2007-tid-runners`)
- Filipas L et al., Effects of 16 weeks of pyramidal and polarized training intensity distributions in well-trained endurance runners, 2022, 10.1111/sms.14101 (`filipas-2022-pyr-pol-periodization`)
- González-Ravé JM et al., Reverse Periodization for Improving Sports Performance: A Systematic Review, 2022, 10.1186/s40798-022-00445-8 (`gonzalezrave-2022-reverse-periodization`)
- Doherty C et al., An evaluation of the training determinants of marathon performance: A meta-analysis with meta-regression, 2020, 10.1016/j.jsams.2019.09.013 (`doherty-2020-marathon-training-meta`)
- Fokkema T et al., Training for a (half-)marathon: Training volume and longest endurance run related to performance and running injuries, 2020, 10.1111/sms.13725 (`fokkema-2020-half-marathon-volume-long-run`)
- Fokkema T et al., Reasons and predictors of discontinuation of running after a running program for novice runners, 2019, 10.1016/j.jsams.2018.06.003 (`fokkema-2019-discontinuation-start-to-run`)
- Viljoen C et al., Trail running injury risk factors: a living systematic review, 2022, 10.1136/bjsports-2021-104858 (`viljoen-2022-trail-risk-factors`)
- Düking P et al., Monitoring and adapting endurance training on the basis of heart rate variability monitored by wearable technologies: A systematic review with meta-analysis, 2021, 10.1016/j.jsams.2021.04.012 (`duking-2021-hrv-guided-meta`)
- Hottenrott K et al., Does a run/walk strategy decrease cardiac stress during a marathon in non-elite runners?, 2016, 10.1016/j.jsams.2014.11.010 (`hottenrott-2016-run-walk-marathon`)
- Yamaguchi A et al., Interactions between monthly training volume, frequency and running distance per workout on marathon time, 2023, 10.1007/s00421-022-05062-7 (`yamaguchi-2023-volume-frequency-run-distance`)
- van Poppel D et al., Risk factors for overuse injuries in short- and long-distance running: A systematic review, 2021, 10.1016/j.jshs.2020.06.006 (`vanpoppel-2021-overuse-risk-factors-review`)
- Pollock ML et al., Effects of frequency and duration of training on attrition and incidence of injury, 1977, 10.1249/00005768-197721000-00005 (`pollock-1977-frequency-duration-injury`)
- Foster C, Monitoring training in athletes with reference to overtraining syndrome, 1998, 10.1097/00005768-199807000-00023 (`foster-1998-monotony-strain`)
- Feely C et al., Estimating the cost of training disruptions on marathon performance, 2022, 10.3389/fspor.2022.1096124 (`feely-2022-training-disruptions`)
- Smyth B et al., Longer Disciplined Tapers Improve Marathon Performance for Recreational Runners, 2021, 10.3389/fspor.2021.735220 (`smyth-2021-marathon-taper-big-data`)
- Wegelin JA et al., Variables associated with odds of finishing and finish time in a 161-km ultramarathon, 2010, 10.1007/s00421-010-1633-1 (`wegelin-2010-odds-finishing-161km`)
- Vickers AJ, Vertosick EA, An empirical study of race times in recreational endurance runners, 2016, 10.1186/s13102-016-0052-y (`vickers-2016-race-times`)
- Wang C et al., Target trial framework for determining the effect of changes in training load on injury risk, 2024, 10.1136/bmjsem-2024-002037 (`wang-2024-target-trial-load`)
- Nakaoka G et al., The association between the acute:chronic workload ratio and running-related injuries in Dutch runners, 2021, 10.1007/s40279-021-01483-0 (`nakaoka-2021-acwr-runners`)
- Schuster Brandt Frandsen J et al., How much running is too much? Identifying high-risk running sessions in a 5200-person cohort study, 2025, 10.1136/bjsports-2024-109380 (`frandsen-2025-session-spike`)
- Toresdahl BG et al., Training patterns associated with injury in New York City Marathon runners, 2023, 10.1136/bjsports-2022-105670 (`toresdahl-2023-nyc-marathon-training-injury`)
- Craddock N et al., Does a greater training load increase the risk of injury and illness in ultramarathon runners? A prospective, descriptive, longitudinal design, 2020, 10.17159/2078-516x/2020/v32i1a8559 (`craddock-2020-acwr-two-oceans`)
- Cloosterman KLA et al., Comparison of Weekly Training Load and Acute: Chronic Workload Ratio Methods to Estimate Change in Training Load in Running, 2024, 10.4085/1062-6050-0430.23 (`cloosterman-2024-acwr-methods`)
- Baldea JD et al., Training patterns, non-steroidal anti-inflammatory medication use, and effects on high-altitude ultramarathon performance, 2009, conference abstract, https://coachsci.sdsu.edu/csa/vol161/baldea.htm (`baldea-2009-leadville-training`)
- Baswick P, Is your long run too long?, Running Magazine, 2023, https://runningmagazine.ca/?p=99607 (`runningmagazine-2023-daniels-long-run-limit`)
- Galloway J, Getting Started Running Without Aches and Pains, jeffgalloway.com, https://www.jeffgalloway.com/01/getting-started-running-without-aches-and-pains/ (`galloway-2026-beginner-run-walk`)
- Tyler CJ et al., The Effects of Heat Adaptation on Physiology, Perception and Exercise Performance in the Heat: A Meta-Analysis, 2016, 10.1007/s40279-016-0538-5 (`tyler-2016-heat-adaptation-meta`; correction 10.1007/s40279-016-0572-3)
- Molina-Garcia P et al., Validity of Estimating the Maximal Oxygen Consumption by Consumer Wearables: A Systematic Review with Meta-analysis and Expert Statement of the INTERLIVE Network, 2022, 10.1007/s40279-021-01639-y (`molinagarcia-2022-wearable-vo2max`; correction 10.1007/s40279-026-02547-9)
- Mountjoy M et al., 2023 International Olympic Committee's (IOC) consensus statement on Relative Energy Deficiency in Sport (REDs), 2023, 10.1136/bjsports-2023-106994 (`mountjoy-2023-reds-consensus`; correction …106994corr1)
- Lu C et al., Validity of smartwatch-derived estimates of lactate threshold heart rate and pace compared to graded exercise testing, 2025, 10.3389/fphys.2025.1621996 (`lu-2025-smartwatch-lactate-threshold`; corrigendum 10.3389/fphys.2025.1661421)

**Candidates (not in the corpus)**

- Casado A, Foster C, Bakken M, Tjelta LI, Does Lactate-Guided Threshold Interval Training within a High-Volume Low-Intensity Approach Represent the "Next Step" in the Evolution of Distance Running Training?, 2023, 10.3390/ijerph20053782 (abstract; it mentions neither double days nor controlled trials)
- Seiler S, What is best practice for training intensity and duration distribution in endurance athletes?, 2010, 10.1123/ijspp.5.3.276 (abstract)
- Burnley M et al., Polarized Training Is Not Optimal for Endurance Athletes, 2022, 10.1249/mss.0000000000002869 (metadata)
- Foster C, Casado A, Esteve-Lanao J, Haugen T, Seiler S, Polarized Training Is Optimal for Endurance Athletes, 2022, 10.1249/mss.0000000000002871 (metadata; authors read on Crossref)
- Zinner C, Schäfer Olstad D, Sperlich B, Mesocycles with Different Training Intensity Distribution in Recreational Runners, 2018, 10.1249/mss.0000000000001599 (abstract)
- Festa L et al., Effects of Different Training Intensity Distribution in Recreational Runners, 2019 (print 2020), 10.3389/fspor.2019.00070 (abstract)
- Qin G, Lee S, Kim S, Machine learning-based personalized training models for optimizing marathon performance through pyramidal and polarized training intensity distributions, 2025, 10.1038/s41598-025-25369-7 (abstract; the survey's full-text points unverified)
- Scudamore EM, Barry VW, Coons JM, An Evaluation of Time-Trial-Based Predictions of VO2max and Recommended Training Paces for Collegiate and Recreational Runners, 2018, 10.1519/jsc.0000000000001942 (abstract)
- Boullosa D et al., Factors Affecting Training and Physical Performance in Recreational Endurance Runners, 2020, 10.3390/sports8030035 (abstract)
- Meixner B, Filipas L, Holmberg HC, Sperlich B, Zone 2 Intensity: A Critical Comparison of Individual Variability in Different Submaximal Exercise Intensity Boundaries, 2025, 10.1155/tsm2/2008291 (abstract)
- Treff G et al., The Polarization-Index: A Simple Calculation to Distinguish Polarized From Non-polarized Training Intensity Distributions, 2019, 10.3389/fphys.2019.00707 (full text PMC6582670)
- Segura S et al., A Survey on Metamorphic Testing, 2016, 10.1109/TSE.2016.2532875 (metadata)
- Gneiting T, Raftery AE, Strictly Proper Scoring Rules, Prediction, and Estimation, 2007, 10.1198/016214506000001437 (metadata)
- Chan AW et al., Empirical Evidence for Selective Reporting of Outcomes in Randomized Trials, 2004, 10.1001/jama.291.20.2457 (abstract)
- Scherer RW et al., Full publication of results initially presented in abstracts, 2018, 10.1002/14651858.MR000005.pub4 (abstract)
- Carneiro CFD et al., Comparing quality of reporting between preprints and peer-reviewed articles in the biomedical literature, 2020, 10.1186/s41073-020-00101-3 (abstract)
- Janssen M et al., Who uses running apps and sports watches? Determinants and consumer profiles of event runners' usage of running-related smartphone applications and sports watches, 2017, 10.1371/journal.pone.0181167 (abstract)
- Brouwers MC et al., AGREE II: advancing guideline development, reporting and evaluation in health care, 2010, 10.1503/cmaj.090449 (metadata)
- Bahr R et al., International Olympic Committee consensus statement: methods for recording and reporting of epidemiological data on injury and illness in sport 2020, 2020, 10.1136/bjsports-2019-101969 (metadata)

**Books and pages (no book read)**

- Daniels J, Daniels' Running Formula, Human Kinetics, 4th ed. ©2022, https://us.humankinetics.com/products/daniels-running-formula-4th-edition (publisher page; Open Library lists 1998 onward)
- Pfitzinger P, Douglas S, Advanced Marathoning, Human Kinetics, 4th ed. ©2026, https://us.humankinetics.com/products/advanced-marathoning-4th-edition (publisher page; Open Library lists 2001 and 2009)
- Koop J, Training Essentials for Ultrarunning, VeloPress 2016; 2nd ed., Koop Endurance Services, 2021 (Open Library; the CTS page refused a plain fetch)
- House S, Johnston S, Jornet K, Training for the Uphill Athlete, Patagonia, 2019 (Open Library)
- Humphrey L, Hansons Marathon Method, VeloPress, 2012 and 2016 (Open Library); Humphrey L, Hanson's Marathon Method: The 16 Miler, 2011-07-06, https://lukehumphreyrunning.com/hansons-marathon-method-the-16-miler/ (read: 16 miles, 25-30% of weekly mileage, accumulated fatigue; no run-day or key-session count)
- Magness S, The Science of Running, Origin Press, 2014 (Open Library)
- Hudson B, Fitzgerald M, Run Faster from the 5K to the Marathon, Broadway Books, 2008 (Open Library)
- Lydiard A, Gilmour G, Running to the Top, Meyer & Meyer, 1997 (Open Library)
- Pierce B, Murr S, Moss R, Run Less, Run Faster, Rodale, 2007 (Open Library)
- Maffetone P, The Maffetone Method, Ragged Mountain Press, 1999 (Open Library)
- Boston Globe, Jack Daniels, Olympic medalist and 'world's best' running coach, dies at 92, 2025-09-28, https://www.bostonglobe.com/2025/09/28/metro/jack-daniels-olympic-medalist-worlds-best-running-coach-dies-92 (title and date read)
- RunRepeat, The State of Running 2019, https://runrepeat.com/state-of-running (read: 107.9 million race results; commercial publisher, funding not checked)

**Unverified**

- What the Daniels, Lydiard, Hudson, FIRST, Koop and Uphill Athlete books or pages prescribe (survey reports only; 4.1); the pages https://philmaffetone.com/180-formula/ and https://uphillathlete.com/aerobic-training/death-by-threshold/ refused a plain fetch
- SportRxiv, https://sportrxiv.org (named as a preprint server; launch date and screening not checked)
- Zheng L et al., Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena, 2023, arXiv 2306.05685 (named by the evaluation survey as the validation of model judges; not reached)
