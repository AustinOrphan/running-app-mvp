# Sources beyond the corpus, a methods layer and an evaluation harness — proposal

Status: Proposed 2026-10-31. This document changes no code, Param, rule text or research record. It
answers three requests of the owner: which sources beyond the peer-reviewed corpus (books, journals,
credible blogs) should inform the plans and how they are vetted; how plans could follow different
methods for different runners; and which tools would test, analyse and evaluate generated plans.
Baseline: `main` at `bb63e675` (`PARAMS_VERSION` `2026-10-25.6`, 396 papers, 632 Params). Four
research passes (sources, methods, evaluation, a repository audit) ran on 2026-10-31 at `8c2cf6f4`.

Their reports were treated as data: every source they name was checked against `research/papers` by
DOI and every new DOI against Crossref on 2026-10-31, abstracts relied on were read on Europe PMC
that day, and books were identified in Open Library or on publisher pages (none was read). Engine
claims were read in the code at `bb63e675`. Figures come from a throwaway script in the git-ignored
`data/` on the twelve synthetic matrix athletes; no personal data was used. Appendix A lists sources.

## 1. Summary

**Finding 1: the corpus holds no book, and its source policy is a convention.** The 19 practice
records (`design: "book-or-guideline"`, level D, no DOI) are web pages, PDFs and magazine articles.
No field holds an edition, page, credentials, interests or agreement (there is no `kind` field), and
`research:verify` skips records without a DOI. "May set a default, never raise a grade" holds (33
Params cite a practice source, all D), but nothing enforces it. The Daniels long-run share reaches
`macroDesign.longRunShareOfWeek` through a magazine whose record says "the book was not checked".

**Finding 2: no method has been tested as a package, and nothing shows that matching one to a runner
helps.** The one study of published plans (92 marathon plans) finds no evidence for their
effectiveness [knopp-2024-marathon-plans]. Evidence covers components, held as graded Params; the
only supported matching, polarized against pyramidal by level (E4, A), is offered as `tidModel`.

**Finding 3: the suites prove conformance, not quality.** The matrix, sweeps and 142 oracle digests
show that every limit holds and steady plans do not change; none measures shape, compares plans or
runs a runner who misses days at random. Seven of twelve matrix plans have a median step of 0%
between loading weeks; five reach their class ceiling (`peakWeeklyMin.*`, D) within nine weeks and
hold it (marathon: 330 minutes from week 2 of 24). The corpus cannot say whether that is worse.

**Finding 4: the checklist cannot see a loosened guard.** It reads the Params the generator reads:
with `g1.spikeRatioWarn` at 1.20, 11 of 12 matrix plans changed and no item failed. Only literals in
`matrix.test.ts` and pins in `params.test.ts` catch it, so a preset must be unable to name a guard.

**Finding 5 (outside the request): the Generate form switches off a rule.** `PlanPage.tsx` always
sends `recoveryCycle: '3:1'`, and an explicit 3:1 makes `cycleShortReason` return before it tests
for a new or low-frequency runner: the novice-5k and returning athletes plan 2:1 with the option
absent and 3:1 with the form's value, though the hint says the plan "shortens the rhythm itself".

**Proposal.** Three parts, each report-only or opt-in, none touching a guard.

- (a) **Sources** (section 3): a six-gate rubric, a grade cap per class, a `method` record holding
  a book's prescriptions as provenance with no evidence level, a corrections check.
- (b) **Methods layer** (section 4): a named preset over a whitelist of Params and two rule variants,
  chosen by the runner with stated facts, shown as a grade D choice with its provenance, held by the
  profiles that hold the load setting, never past a guard; at most five, the default byte for byte.
- (c) **Evaluation harness** (section 5): plan metrics, reference bands, simulation, a back-test,
  descriptive outcome learning, a scorecard and a plan review; report-only, `npm run check` as now.

**Recommendation and push-back.** Build the rubric and the metrics first (S0 to S2, H0, H1): cheap,
no plan changes, and they make any preset testable. Build presets only if the owner wants choice
with no outcome evidence behind it (decision 6). The request assumes different methods suit
different people; the corpus supports choice by level, goal and constraint (days free, injury
history, experience), which the engine already reads, and nothing supports choice by individual
response (G4; [hecksteden-2015-individual-response]). A preset is honest as a preference, never as a
better plan.

## 2. What exists

### 2.1 The research base and its policy

- **Records.** 396 papers: level A 55, B 64, C 188, D 89; 23 without a DOI. `paperSchema`
  (`scripts/research-check.ts`) is strict; `design` is free text (18 values). The 19 practice records
  are 7 programme pages, 10 coach or magazine articles and 2 clinical return-to-run documents; their
  ids appear 65 times in `shared/engine/params`, and 15 Params cite nothing else.
  `runningmagazine-2023-daniels-long-run-limit` and `skurka-2017-roche-100-recovery` report another
  person's rule. The 14 consensus statements are graded by content: A 8, B 3, D 3.
- **Policy and checks.** README method step 7 and the `engine-rules.md` header; `book-or-guideline`
  appears in code only in the workflow enum, and no test ties a Param citing only practice sources
  to grade D. `research:check` (CI) checks schema and ids; `research:verify` (by hand) checks DOI,
  title and year and reads no correction notice. Crossref lists corrections for four corpus papers:
  `molinagarcia-2022-wearable-vo2max` and `lu-2025-smartwatch-lactate-threshold` mention theirs,
  `tyler-2016-heat-adaptation-meta` and `mountjoy-2023-reds-consensus` do not.
- **Display and skill.** `PaperCard` links a DOI only (the `url` is not shown). The skill
  `research-update` has no step for a book, a column or a method.

### 2.2 The engine's Params and the runner's options

- **Params.** 632 (`param()`, `define.ts`): D 428, C 132, B 36, A 36; 110 cite no paper; 33 carry a
  `range`. `P` is a module singleton read at call time by 51 files (31 engine modules); the Why
  drawer reads its defaults from `/api/research/params`. Six Params have no reader, among them
  `e4.z2CapAnyPhase` (the cap enforced is `f2.z2z3ShareMax`).
- **What fixes the method.** `planPhases` (`macro.ts`): base, build up to `macroDesign.buildWeeks`
  (6), specific `e2.specificWeeksMin` to `Max` (6 to 8), taper by `taperDays` (K1).
  `cycleShortReason`, `cycleWorkWeeks`: 3:1, or 2:1 for injury, choice, a new or low-frequency
  runner; cut `e3.recoveryWeekCutPct` 25 (range 20 to 30). `tidFor`: 83/12/5 base, 80/12/8 build,
  floor `e4.z1Floor` 70. `wantedQuality`: 1 or 2 a week. `QUALITY_BY_PHASE` (`micro.ts`), a code
  constant: base strides and hills, build threshold and intervals, specific race pace and threshold.
  `capIntensity`: Z2+Z3 at most 25%. `daysFor` in `macroPlan`: 3 to 6 run days from the minutes
  (F5). `macroDesign.longRunShareOfWeek` 0.35 (ultra 0.45). Ceilings `peakWeeklyMin.*`,
  `peakLongRunMin.*` (D). E1's reverse and block periodization are not built.
- **Options.** `EngineInput.options`: `recoveryCycle`, `strengthSessions`, `tidModel` (polarized
  acts only for 5 and 10 km), `loadAppetite` (G-8), `gutTraining` (server-set). The request's
  `options` is a `z.strictObject` (`server/routes/plan.ts`), so a new key is a 400 until the schema
  changes; `parsePlanOptions` (`server/serialize.ts`) validates only `loadAppetite`. Only the load
  setting changes after generation (`commitLoadSetting`, `planActions.ts`, revision and undo).

### 2.3 Measured behaviour

`buildPlan` on the twelve matrix athletes; every plan passes the checklist. A loading week is not a
recovery, taper or race week; "at peak" is within 5% of the plan's highest week.

| Athlete                 | Weeks | Peak min | First week at peak | Loading weeks at peak | Median step |
| ----------------------- | ----: | -------: | -----------------: | --------------------: | ----------: |
| novice-5k               |    14 |       90 |                  9 |               1 of 11 |        7.9% |
| half                    |    20 |      270 |                  5 |              11 of 13 |          0% |
| marathon                |    24 |      330 |                  2 |              14 of 14 |          0% |
| trail-50k               |    23 |      390 |                  6 |              11 of 14 |          0% |
| first-100-mile          |    34 |      600 |                  9 |              16 of 21 |          0% |
| masters                 |    21 |      330 |                  8 |               7 of 13 |        3.1% |
| returning               |    21 |      270 |                 14 |               4 of 13 |        9.6% |
| prior-bsi               |    16 |      203 |                 13 |                2 of 9 |        4.7% |
| hot-race                |    29 |      330 |                  6 |              15 of 18 |          0% |
| sparse-100-mile         |    38 |      600 |                 30 |               3 of 24 |        9.7% |
| reds-hold               |    23 |      285 |                  1 |              14 of 14 |          0% |
| post-marathon-short-run |    16 |       99 |                 13 |               1 of 13 |          0% |

The plateaus sit at `peakWeeklyMin` (half 270, marathon 330, 50 km 390, 100 miles 600) because those
runners already run near it; reds-hold is held by the REDs rule; the post-marathon plan climbs in
pairs of equal weeks. A marathon build week has six run days, five of 43 minutes (two quality) and a
115-minute long run (0.35 × 330). The upper load position changes no marathon week; the 2:1 cycle
puts a cutback every third week; the polarized option turns the weeks from the specific phase on of
the three 5 and 10 km athletes from 80/12/8 into 80/5/15 and changes no minutes.

One Param at a time, no checklist item failed for `longRunShareOfWeek` 0.30 (8 plans changed),
`f2.qualitySessionsPerWeek` 1 (8), `buildWeeks` 4 and 9 (11, 9), `e2.specificWeeksMax` 6 (12),
`recoveryWeekCutPct` 20 and 30 (11), `e3.defaultCycleWorkWeeks` 2 (8), `f2.z2z3Share` 15 (5) or
`g2.rampSoft` 0.07 (10); `longRunShareOfWeek` 0.40 failed one `tid` item, `recoveryWeekCutPct` 15
ten `recovery-cadence` items, and the guard changes `g1.spikeRatioWarn` 1.20 and
`g2.rampCeilingTwoWeeks` 0.35 (11 and 1 plans changed) failed nothing.

### 2.4 The evaluation assets

- **Conformance.** `matrix.test.ts` (12 athletes; the header says ten): every checklist item,
  determinism, limits re-derived from finished sessions with literals (1.3, 70, 0.25).
  `runChecklist`: 15 items, a sixteenth with a rest window; a failure blocks publishing
  (`failedChecklist`, 422). Sweeps: 150 seeded runners at three load positions, 576 rest windows.
- **Regression and chains.** 142 oracle digests of steady plans (12 matrix, 20 named, 40 sweep, 70
  chain); a changed digest means different, not worse. `replanChain`: weekly re-plans to the race.
- **Records.** `PredictionLog`, `scorePredictions`, `summariseRecord` (`backtest.ts`; a summary from
  3 races), `trackRecord.ts`, `PlanSession.execution`, `WeeklyReview`, `PlanRevision` diffs;
  `data/validate-owner.ts` (git-ignored) replays real history. **Missing:** shape, comparison
  between plans, random misses in a chain, churn, skill against a baseline, any outcome measure.

## 3. Sources beyond the corpus

### 3.1 What each class may do

| Class                            | Named examples (appendix A)                                                          | May                                                                      | May not                                                | Cap                  |
| -------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------- |
| Coaching books and manuals       | Daniels; Pfitzinger and Douglas; Koop; House, Johnston and Jornet; Humphrey; Magness | describe a prescription; set a default where `engine-rules.md` has a gap | raise a grade; move toward more load; cite a summary   | D                    |
| Programme pages, columns         | the 19 practice records; columns that cite primary studies                           | find the primary study; be the sole source of a practice                 | stand in for the study they report                     | D                    |
| Consensus statements, guidelines | 14 in the corpus; Bahr 2020; AGREE II as the appraisal tool                          | grade by content (rigour, base of studies)                               | take a grade from the label                            | A to D by content    |
| Preprints, theses, abstracts     | SportRxiv; `baldea-2009-leadville-training` (an abstract)                            | sit on a watch list                                                      | outrank the peer-reviewed version                      | C                    |
| Trial registrations              | ClinicalTrials.gov, ISRCTN                                                           | show what a trial planned to measure                                     | carry a result                                         | not evidence         |
| Datasets and large cohorts       | `muniz-pumares-2025-marathon-tid`; RunRepeat race results                            | describe distributions, prediction error, associations                   | show that a plan works; set a default toward more load | C; B for prospective |

Why the caps: 62% of 102 trials changed, added or omitted a primary outcome [Chan 2004]; 37.3% of
meeting abstracts reached full publication, "positive" ones more often (RR 1.31) [Scherer 2018];
preprints reported about 5% fewer of the checked items than articles [Carneiro 2020]; app and watch
users differ from other runners, which a large n does not repair [Janssen 2017].

### 3.2 Books

| Work                                                                                   | Identified by                                     | Adds over the corpus                                                  |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| Daniels J, _Daniels' Running Formula_, Human Kinetics; 1st ed. 1998, 4th ed. ©2022     | Open Library; publisher page (ISBN 9781718203662) | VDOT pace tables, season plans; the long-run limit the corpus quotes  |
| Pfitzinger P, Douglas S, _Advanced Marathoning_, Human Kinetics; 2001, 4th ed. ©2026   | Open Library; publisher page (ISBN 9781718237476) | 18- and 12-week plans at under 55, 55-70, 70-85, over 85 miles a week |
| Koop J (with Rutberg J, Malcolm C), _Training Essentials for Ultrarunning_; 2016, 2021 | Open Library                                      | the one complete ultra method found; the corpus has no ultra trial    |
| House S, Johnston S, Jornet K, _Training for the Uphill Athlete_, Patagonia, 2019      | Open Library                                      | aerobic-threshold base and strength for mountain running              |
| Humphrey L, _Hansons Marathon Method_, VeloPress; 2012, 2016                           | Open Library; author page (2011)                  | six run days; a long run of about 16 miles on accumulated fatigue     |
| Magness S, _The Science of Running_, Origin Press, 2014                                | Open Library                                      | physiology and sample programmes from 800 m to the marathon           |
| Hudson B, Fitzgerald M, _Run Faster from the 5K to the Marathon_, Broadway Books, 2008 | Open Library                                      | a self-coaching framework (assess, then build)                        |
| Lydiard A, Gilmour G, _Running to the Top_, Meyer & Meyer, 1997                        | Open Library (also _Run to the Top_, 1962)        | base-first periodisation as widely described; the most dated          |

Shared limits: no controls, survivorship, authors who sell plans, editions that drift, methods that
disagree (long run: Daniels at most 25-30% of the week or 150 minutes as the corpus reports him,
Hansons about 16 miles). Books give a season in sequence, tables and volume tiers. Daniels died in
2025 (Boston Globe, 2025-09-28), so his 4th edition is the last. Copyright of copying a table into
this public repository was not assessed; records paraphrase and cite pages.

### 3.3 The vetting rubric

Every source outside the journal pipeline passes six gates, and its record states each result.
Outcome: admit as evidence (by design level), as practice (D) or as method (D), hold, or leave out.

- [ ] **R1 Provenance (hard).** The claim is located (edition and page, table, or URL and fetch
      date) and read in the source itself in the session that records it; a DOI resolves and
      Crossref's `updated-by` is read. Fails: known by report, an agent's summary or a mirror.
- [ ] **R2 Author (hard).** Named; credentials or track record confirmed off the author's own site;
      interests recorded. A seller is not excluded; an undisclosed interest in the claim is.
- [ ] **R3 Currency.** Date and edition recorded; the latest edition read or the difference stated;
      later consensus and corpus papers checked. Supersession decides, not age.
- [ ] **R4 Agreement.** Two independent sources agree (a magazine quoting a book is one), or a graded
      corpus paper does; disagreement recorded, the conservative reading used (G6), the corpus
      winning over a method. A single source is held, unless it is the sole source of a practice.
- [ ] **R5 Applicability.** Population stated (distance, level, volume, age, sex, terrain); use
      outside it labelled extrapolated.
- [ ] **R6 Grade cap.** As in 3.1: a preprint, thesis or abstract is C until the peer-reviewed text
      is read; a registration is held; a dataset analysis is C, B only with prospective outcomes.

Today, `runningmagazine-2023-daniels-long-run-limit` fails R1 as Daniels's own rule, and R2 and R4
cannot be tested on any practice record. AGREE II [Brouwers 2010] can back R6 for guidelines.

**What stays out.** Forums and social threads (they may locate a claim, never support one);
anonymous or uncited blogs; marketing; text written by a language model, including a model's summary
of a book (two corpus studies found model-written plans wanting, `duking-2024-chatgpt-running-plans`
and `montaruli-2026-ai-marathon-programs`; ADR 0005); calculator
pages; mirrored copies of books; retracted work. Agents may find a source; none may vouch for one.

### 3.4 Recording

- **A.** Books as paper records: nothing new, no field for edition, page or interests. **B.**
  Optional fields on `paperSchema`: one record type; touches `research-check.ts` and the writer.
- **C (recommended).** Practice pages stay paper records; a book-derived method gets
  `research/methods/<id>.json`: `originators` (credentials, how checked), `works` (edition, year,
  publisher, ISBN, pages read), `prescriptions` (paraphrased, located), `applicability`,
  `interests`, `currency`, `corpus` (ids that agree, disagree, are silent), `engine` (rule ids;
  same, stricter or looser), `status` (reference, default-source, selectable), `grade` fixed at D,
  `verification`. `research:check` validates it; a looser prescription is never `default-source`.
- **Corrections.** `research:verify` reads Crossref's `updated-by` and reports unmentioned notices.

## 4. The methods layer

### 4.1 Method families

| Method                     | Prescribes (source)                                                      | Evidence for and against                                                                                                                                                     | Preset?              |
| -------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Daniels                    | race-derived VDOT paces; quality days by mileage (book)                  | VDOT underestimated VO2max; its threshold pace matched lactate threshold in 9 recreational runners [Scudamore 2018, C]; no trial of the plans                                | no: paces stay C2    |
| Pfitzinger                 | 12- and 18-week plans in four mileage tiers (publisher page)             | none for the plans; volume and longest run go with faster marathons, observationally [doherty-2020-marathon-training-meta, B]                                                | no: volumes above D3 |
| Hansons                    | six run days, three key sessions, a 16-mile long run (author page)       | none for the plan; a longest run under 25 km went with slower marathons [fokkema-2020-half-marathon-volume-long-run, B]                                                      | as structure (P4)    |
| Lydiard                    | aerobic base, then hills, then track work (book)                         | none; reverse periodization no better than traditional [gonzalezrave-2022-reverse-periodization, B]; E1 already puts base first                                              | as structure (P5)    |
| Polarized or pyramidal     | about 80% of sessions easy, 20% hard, in elite athletes [Seiler 2010]    | no difference overall, polarized for competitive and pyramidal for recreational athletes in a subgroup [rosenblat-2025-tid-ipd-nma, A]; disputed [Burnley 2022; Foster 2022] | exists (P2)          |
| Norwegian double threshold | 3-4 lactate-guided threshold sessions a week in 150-180 km [Casado 2023] | descriptive, no controlled study (Casado 2023); double days went with injury in trail runners [viljoen-2022-trail-risk-factors, B]                                           | no                   |
| Hudson                     | assess, then build the programme for the runner (summaries)              | HRV-guided training: performance g = 0.079, not significant [duking-2021-hrv-guided-meta, A]; gap 10; J5 already adapts weekly                                               | no                   |
| Koop; Uphill Athlete       | time-based ultra volume; base at or below aerobic threshold (books)      | no ultra training trial (gap 1)                                                                                                                                              | no                   |
| Run-walk (Galloway)        | walk breaks set by pace (`galloway-2026-beginner-run-walk`)              | one RCT of 42 runners: similar marathon times, less muscle pain [hottenrott-2016-run-walk-marathon, C]                                                                       | no: the E6 ladder    |
| Three runs a week (FIRST)  | three key runs plus cross-training (Pierce, Murr, Moss 2007)             | no study of the plan found; frequency at equal monthly volume was not related to marathon time [yamaguchi-2023-volume-frequency-run-distance, C]                             | as structure (P3)    |
| Maffetone                  | 180 minus age as a heart-rate ceiling (book 1999)                        | no study of the formula found; C1 and C2 rank thresholds and proxies above fixed heart-rate rules; fixed %HRmax markers vary widely [Meixner 2025, C]                        | no                   |

Knopp's 92 plans (Daniels, Pfitzinger and Hansons among them) built 5-9% a week, peaked 3.6 to 4.4
weeks out, tapered 22-31% a week and 46-54% in the final week, and held 4.1 to 6.8 runs a week by
tier [knopp-2024-marathon-plans; the rest beyond the build-up read in full text PMC11065819].

### 4.2 Does a characteristic of the runner predict the better method?

- **Level and goal.** Subgroup only: competitive athletes polarized, recreational pyramidal
  [rosenblat-2025-tid-ipd-nma]; a VO2peak edge for polarized only under 12 weeks and in highly
  trained athletes, no time-trial difference [oliveira-2024-pol-meta, A]; marathoners lean pyramidal,
  1500 m runners polarized [casado-2022-elite-runners-review, descriptive]. E4 encodes it.
- **Injury history and days free.** Injury history raises risk
  [vanpoppel-2021-overuse-risk-factors-review, A], a reason for G-3, not a method. Three days a week
  injured fewer young men jogging hard than five [pollock-1977-frequency-duration-injury, C].
- **Response and adherence.** One block cannot label a responder (G4). Non-response was likelier
  with high-intensity and polarized mesocycles than low-intensity ones [Zinner 2018, C]; a
  TRIMP-matched trial found equal gains with 17% less time on a threshold focus [Festa 2019, C].
  29.5% of 774 novices stopped within 26 weeks, 48% of them through injury
  [fokkema-2019-discontinuation-start-to-run, B].
- **The one matching claim.** Qin 2025 (120 runners) reports experience predicting the better
  distribution (r = 0.72): one unreplicated trial whose abstract reports less volume in the polarized
  arm; the methods survey also found no registration number (not re-checked). No rule uses it.

Injury, free days and adherence matter and limits handle them; nothing shows a better-matched method
does better, and a review finds "no consensus on the best practice" [Boullosa 2020, D].

### 4.3 Design

Options: (A) relabel `tidModel` and `recoveryCycle` as styles, which adds little; (B, recommended) a
typed preset overlay; (C) a generator per method, rejected because it duplicates every guard.

- **Storage.** `EngineInput.options.method?`, absent meaning `default`; `Plan.options` is JSON, so no
  migration; `generateBody` and `parsePlanOptions` accept and validate it.
- **Values.** A preset is a record of overrides keyed only by whitelisted ids (4.4); each override is
  a grade D `Param` with a default note and a rule `P<n>` in a new section (p) of `engine-rules.md`
  (not `M-<key>`: `params.test.ts` exempts ids starting `m-` from the heading check).
- **Override points.** The whitelisted Params are read in eight files (`macro.ts`, `micro.ts`,
  `checklist.ts`, `explainInputs.ts`, `adapt.ts`, `index.ts`, `goal.ts`, `postRace.ts`). A resolver
  replaces `P.<id>.value` there, as `tidFor` already takes `polarized`; no global swap of `P`, which
  module-level snapshots such as `CYCLE_REASON_WORDS` would read stale.
- **Display.** Form and Why drawer show the preset's name and rule, "grade D: a choice, not a better
  plan", each override against the default (effective values, ADR 0010), the component Params with
  their grades and the method record's source status.
- **Selection.** The runner chooses; fit notes state facts (days available against days used,
  experience class, a recent-injury flag), never a score; nothing is inferred from logged data (G3,
  G4) and no model picks (ADR 0005). A later change is a plan action modelled on
  `commitLoadSetting`: one revision with an undo payload through `recordPlanWrite` (ADR 0007).

### 4.4 What a preset may vary, and what it may never touch

| Param or variant                                    | Rule, grade | A preset may                   | Bound                                                     |
| --------------------------------------------------- | ----------- | ------------------------------ | --------------------------------------------------------- |
| `macroDesign.buildWeeks`, `e2.specificWeeksMin/Max` | E2, D       | lengthen or shorten phases     | specific 6 to 8 weeks; taper untouched                    |
| `e3.defaultCycleWorkWeeks`                          | E3, D       | shorten to 2                   | never above 3 (a longer cycle is more load)               |
| `e3.recoveryWeekCutPct`                             | E3, D       | choose within the range        | 20 to 30                                                  |
| `e4.z1Prior`, `z2Prior`, `z3Prior`                  | E4, B/C     | move within ±5 pp              | Z1 at least 70; Z2 at most Z1; Z2+Z3 at most 25           |
| `f2.qualitySessionsPerWeek`, `f2.z2z3Share`         | F2, D       | choose 1 or 2; lower the share | share never above 20                                      |
| `macroDesign.longRunShareOfWeek`                    | design, D   | lower                          | never above 0.35 (0.40 failed the `tid` item)             |
| run days (`daysFor` in `macroPlan`)                 | F5, D       | cap lower, or ask for more     | start weeks keep F5's 3; at most `f5.mastersMaxRunDays` 6 |
| `QUALITY_BY_PHASE` (`micro.ts`)                     | F2, D       | choose another table of kinds  | session-library kinds only; becomes a typed Param         |
| `k2.threeWeekMultipliers`, `twoWeekMultipliers`     | K2, D       | choose other steps             | mean 0.40 to 0.59 (A); strictly decreasing (B)            |

Never overridable, by type and by a test: `g1.*`, `g2.rampCeilingTwoWeeks`, `g2.rampSoft` (lowered
only), G-3, G-5, G-6, G-8 and the load setting, `e4.z1Floor`, `f2.z2z3ShareMax`, `peakWeeklyMin.*`
and `peakLongRunMin.*` (lowered only), `k1.*`, `k3.*`, F1, the E6 start paths, J7, the H12 and J9
windows, the holds of section (n), F7 to F9 and the checklist. Because the checklist reads the same
Params (finding 4), each preset is also tested against literal bounds.

### 4.5 Coexistence with the load setting, the start paths and the options

- **Load setting.** Separate: it is how fast a plan rebuilds (G-8); a preset is the plan's shape.
- **Holds.** A preset is held at the default, with the reason shown, while a reason that holds the
  load setting applies (`loadPosition`), in the E6 start paths and on the injury-return ladder.
- **Explicit options.** A preset sets defaults for `recoveryCycle`, `tidModel`, `strengthSessions`;
  an option the runner sets wins, so the form must send only what the runner changed (decision 9).
- **Ceilings.** A preset carries a method's shape at the runner's volume, never its volume: a
  20-mile long run or 160 km weeks lie beyond `peakLongRunMin`, `peakWeeklyMin` and D3, and raising
  them would move toward more load on grade D evidence (G6).

### 4.6 Candidate presets

| Preset (rule)                   | Structure                                                                          | Inspired by | Honest note                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------- |
| Default (P1)                    | today's engine, byte for byte                                                      | the corpus  | the evidence default                                                 |
| Polarized specific phase (P2)   | today's `tidModel: 'polarized'`, 5 and 10 km goals                                 | Seiler; E4  | an edge, if any, for competitive athletes in short blocks            |
| Three run days (P3)             | run days capped at 3; quality and long run as the default                          | FIRST       | not its three hard runs; at equal minutes runs are longer, G-1 binds |
| Six days, shorter long run (P4) | long-run share 0.30; 5 or 6 run days where minutes allow; 2 quality, not 3         | Hansons     | the corpus links longer long runs to faster marathons                |
| Base first (P5)                 | build 4 weeks, so a longer base; base quality strides only; build hills, threshold | Lydiard     | E1 is already base first; this lengthens it, delays intervals        |

Not offered: the Norwegian model, 180 minus age, Pfitzinger and Lydiard volumes, Hudson, Daniels
paces. No preset was prototyped; 2.3 probed the values P3 to P5 use, not the run-day cap or table.

## 5. The evaluation harness

Report-only parts; the conformance asserts stay the only gate. By value for size: metrics,
scorecard and review, reference bands, simulation, back-test, outcome learning. No metric becomes a
target: no threshold without a rule, each figure labelled with its rule's grade, no injury
probability, "safe", "behind" or "missed" (G5), reports stratified by the sweep's axes, and a change
that improves a metric still enters through `research-update`. G-5 gains one sentence: a descriptive
figure in a report gates, caps and justifies nothing, so it is not the ratio band the rule forbids
(as ADR 0013 did for a ceiling in minutes).

### 5.1 Plan metrics

`describePlan(draft, input)` in `tests/unit/engine/plan-metrics.ts`, from the `PlanDraft` and Params
alone, never from the code that enforces a limit (as `history-properties.ts`): weekly series, steps
and headroom under G-2, plateau length (weeks within 5% of the peak, a preference), peak position,
long-run share, realised against declared distribution (`week.tid`), planned load (minutes × the
midpoint of `P.expectedRpe`, grade D, relative only), monotony and strain
[foster-1998-monotony-strain], cycle and taper descriptors, run days, churn between plans of a chain.
A polarization index, log10(Z1 / Z2 × Z3 × 100), polarized above 2.00 [Treff 2019], labels 80/12/8
at 1.73 and the polarized 80/5/15 at 2.38 (an empty zone 2 not checked). It stays in tests: in
`shared/engine/` every number must be a graded `Param`; it moves when a page shows it.

### 5.2 Reference bands

None is a verdict. (a) Knopp's peak position, build-up, taper steps and runs a week (4.1; CC BY
4.0), with provenance fields, unlinked to outcomes. (b) The corpus's 5 and 10 km programme pages and
the start ladder. (c) Daniels and Pfitzinger only from an edition the owner holds, as descriptors
(weekly totals, long run, quality count, taper) with edition, page, transcriber, date and a second
check, outside the repository until copyright is settled. Distance from a band, aligned on race
week, is reported and never minimised.

### 5.3 Scenario simulation

`SimAthlete(seed, level)` drives the real `replan` as an extension of `replanChain`: per-session
completion, skipped days, weeks above plan, illness and niggle windows through the real `Disruption`
path, availability changes. Per chain: weeks at 80% of target or more (`completion.partialBelow`)
and above 120% (`extendedAbove`), minutes moved per re-plan, hold-progress-hold flips, drift of the
peak, conformance at each step (`problemsOf`), minutes delivered against the first plan (target
reached alone rewards lower targets). No fitness model (G2). Feely 2022 supports the shape of a
"ragged" level (over half of marathoners had stops of up to 6 days in the last 16 weeks
[feely-2022-training-disruptions]), not its rates. Metamorphic relations [Segura 2016]: a closed day
never raises a week; a re-plan with no new data is a fixed point. Follow-up 27 (a recovery,
loading, recovery sequence after a cycle change, fixed in #570) is the fault class it targets.

### 5.4 Back-test, outcome learning and their limits

- **Back-test.** A generalised replay beside `data/validate-owner.ts`, outside the repository: each
  Monday with only the activities up to it; the 5.1 metrics, how far the next one to four weeks ran
  from the plan (the 0.8 and 1.2 lines), what the re-plan changed; counts only. The runner never ran
  these plans, so it measures plan against behaviour, not whether a plan works.
- **Concludable for one runner, descriptively:** adherence by session kind and week type, time to a
  completed week after a disruption, reported effort against the grade D `expectedRpe` defaults (G3:
  after 3 observations), calibration after 3 scored races. Two additions change L7: skill against a
  naive baseline from the same anchor (Riegel gave half of marathoners a time 10 minutes or more too
  fast [vickers-2016-race-times]) and an interval score [Gneiting 2007], since coverage rewards wide
  bands.
- **Not concludable:** that a plan or method worked. One race a season is confounded by weather,
  illness and life; n-of-1 response is mostly noise [hecksteden-2015-individual-response]; a causal
  answer needs many runners and a target-trial emulation [wang-2024-target-trial-load], a product
  and privacy decision (decision 13). Injury outcomes, if recorded, follow [Bahr 2020].

### 5.5 Scorecard and plan review

A one-page scorecard per plan from 5.1: conformance, shape, composition, load descriptors without
flags, distance from the bands; each row carries its rule's grade. No overall score: experts rated
model-written plans on 22 criteria [duking-2024-chatgpt-running-plans] and no outcome validates a
weighting. No acute:chronic ratio (G-5; associations point both ways, inverse in 435 runners
[nakaoka-2021-acwr-runners], a negative dose-response in 5,205 [frandsen-2025-session-spike]). A
project skill `plan-review` applies the close-review pattern of `docs/STATUS.md` (lenses, two
independent refuters per finding) to one plan and its why-text: rules re-derived apart from the
engine, evidence honesty (G5), a coach's week-by-week objections, fit to availability, a lost week.
Each finding cites a rule or metric row; output is a list for the owner, never a plan edit.

## 6. Arguments against, and what is not proposed

- **Presets sell choice without outcomes**, and a menu implies that one method is better for the
  runner. Mitigation: structural names, "a choice, not a better plan"; the alternative: no presets.
- **Brand names overstate fidelity** (a shape inside every guard is not "Hansons"; trademark
  unchecked), and each preset multiplies matrix, sweeps and oracle (five on 142 digests is 710).
- **A second record type** is more upkeep and can lend a popular plan authority the evidence does
  not give; option A or the rubric alone avoids both.
- **The harness can steer the engine**: a plateau metric invites tuning toward progression without
  evidence, a simulator tuning to itself, a review a coach's taste. Report-only status is the defence.
- **No book was read**; every book entry rests on publisher, catalogue or author pages.
- Not proposed: raising a ceiling or guard; lactate-guided or double-day training; inferring a
  method from logged data; a model ranking methods; pooled data; scraping; reproducing book tables.

## 7. Decisions for the owner

Each has a default that the tasks implement.

1. **Record type for methods.** Default: option C. Against: a second type; A costs nothing.
2. **Reading standard.** Default: a method enters only after its pages are read from a copy in hand.
   Does the owner hold any book of 3.2? Against: slow, and blocks the ultra method most needed.
3. **Rubric and corrections.** Default: R1 to R6 in the README and the skill, `updated-by` in
   `research:verify`, the Tyler and Mountjoy records annotated. Against: more steps per source.
4. **Daniels long-run share.** Default: relabel the citation "as reported by Running Magazine", R1
   failed until the book page is read; the value stays 0.35.
5. **Other classes.** Default: columns are finding aids; preprints and registrations on a watch list
   outside `research/papers/`; only peer-reviewed dataset analyses admitted; model-written text never
   a source. Against: a strong preprint waits for publication.
6. **Build the methods layer?** Default: yes, option B, after H0 and H1, at most five presets.
   Against: no matching evidence (4.2); the harness alone answers the testing request.
7. **Which presets.** Default: P1 to P5, structural names, "inspired by" credits. Against: P4 lowers
   the long run against the corpus's observational link to marathon time.
8. **Ceilings.** Default: never raised by a preset. Against: Pfitzinger's volume stays unavailable.
9. **Finding 5.** Default: `cycleShortReason` reads `'3:1'` as no choice; the form sends only what
   changed. Against: those runners' plans change at the next re-plan (toward less load: G6 allows).
10. **Report-only harness.** Default: yes, `npm run check` unchanged; ADR 0016 records it with the
    G-5 sentence of section 5. Against: a report nobody reads protects nothing.
11. **The plateau.** Default: show the shape table to the owner or a coach; no engine change (G6).
12. **Simulator.** Default: three stress levels (compliant, ragged, overshooting), by hand and at
    each `PARAMS_VERSION` bump. Against: chain time is unmeasured.
13. **Outcome learning.** Default: descriptive; the L7 baseline and interval score after 3 scored
    races; no pooled data. Against: "which method works" stays unanswerable for one runner.
14. **Qin 2025.** Default: watch list, not admitted. Alternative: admit as C, cited by no rule.

## 8. Task list

One task per engineer, own worktree from `origin/main`, test first, after its dependencies merge.
**Validation**: 142 oracle digests byte-identical; owner validation quotes counts only.

- **S0. Practice-record audit.** S. Decisions 3, 4. Skill `research-update`: R1 to R6 in the 19
  records' notes, the Daniels citation in its record and the note of `longRunShareOfWeek`, the Tyler
  and Mountjoy records. No value, grade or `PARAMS_VERSION` change; `npm run check` passes.
- **S1. Corrections check.** S. `scripts/research-verify.ts`; a pure function over a stored Crossref
  message, tested in `tests/unit/research/` without network; a run by hand reports the four notices.
- **S2. Rubric and method record.** M. Decisions 1, 5. `research/README.md`, the skill ("add a
  source outside the journals", "add a method"), `methodSchema` in `research-check.ts` with tests, a
  `params.test.ts` case that a Param citing only practice sources or methods is D, `PaperCard` (show
  `url`), `docs/adr/0015-sources-outside-the-journals.md`.
- **S3. First method records.** M each. Decision 2 first. From read pages only: Koop, Daniels,
  Pfitzinger, Uphill Athlete (corpus gaps first).
- **H0. Plan metrics.** S to M. `tests/unit/engine/plan-metrics.ts` with hand-computed cases; one
  running-kind set instead of three copies. No engine file changes.
- **H1. Report, bands, scorecard.** S. Depends H0. `scripts/plan-report.ts`, run with `tsx` and
  outside the check: the 5.1 table over matrix and sweep, stratified; Knopp's bands as a fixture with
  source id, table and read date; a Markdown scorecard per plan.
- **H2. Simulator.** M to L. Depends H0. Decision 12. `tests/unit/engine/sim-athlete.ts`, a scorer,
  one stress level, a measured chain time; metamorphic cases as Vitest tests.
- **H3 to H5.** S each. H3 plan-review skill (`.claude/skills/plan-review/SKILL.md`); H4 back-test
  in `data/`, run by the owner, counts only; H5 ADR 0016 and the G-5 sentence (decision 10).
- **H6. L7 baseline and interval score.** S. Decision 13, after 3 scored races; L7, `backtest.ts`.
- **M0. Finding 5.** S. Decision 9. `cycleShortReason`, `PlanPage.tsx`, `tests/web/plan.test.tsx`, a
  matrix case for novice-5k. **Validation**; a digest that moves is named in the pull request.
- **M1. Research update for methods.** M. Decision 6. Skill `research-update`: the candidates of 4.1
  and 4.2 looked up and read in that session (`research:verify`), section (p) with P1 to P5, the
  evidence gaps, README method entry 11.
- **M2. Preset type and override points.** M. Depends M0, M1, H1. `types.ts`, `params/p-methods.ts`,
  the resolver and the eight readers (4.3), `server/routes/plan.ts`, `server/serialize.ts`,
  `docs/adr/0017-method-presets.md`. Absent and `default` give today's plans byte for byte; a type
  and a test reject every guard id of 4.4. **Validation.**
- **M3. Presets and holds.** M. Depends M2. Decision 7. `p-methods.ts`, holds through
  `loadPosition`, `checklist.ts` on effective values, literal bounds in `methods.test.ts`.
- **M4. Form, Why drawer, copy.** M. Depends M3. `PlanPage.tsx`, `WhyDrawer.tsx`, `INPUT_BUILDERS`,
  `ruleTitles.ts`, templates in `shared/copy/` passing `lint.ts`; page tests by role and name.
- **M5. Matrix by preset.** M. Depends M3, H1. `matrix.test.ts` at every preset; fidelity re-derived
  from finished sessions (run days, quality count, long-run share, Z2+Z3 share); a preset column in
  the H1 report.

S0, S1, H0, H1, H3 and H4 need no decision; M0 to M5 wait for decisions 6, 7 and 9.

## Appendix A. Sources

Checked 2026-10-31. Candidate: DOI resolved on Crossref with matching title, first author and year;
"abstract": read on Europe PMC that day; "metadata": not read. Unverified: not confirmed here.

**In the corpus**

- Knopp M et al., Quantitative Analysis of 92 12-Week Sub-elite Marathon Training Plans, 2024, 10.1186/s40798-024-00717-5 (`knopp-2024-marathon-plans`; full text PMC11065819 read)
- Düking P et al., ChatGPT Generated Training Plans for Runners are not Rated Optimal by Coaching Experts, but Increase in Quality with Additional Input Information, 2024, 10.52082/jssm.2024.56 (`duking-2024-chatgpt-running-plans`)
- Montaruli G et al., Artificial intelligence-generated marathon training programs: reliable tools in exercise prescription for athletic performance?, 2026, 10.1093/bmb/ldag010 (`montaruli-2026-ai-marathon-programs`)
- Hecksteden A et al., Individual response to exercise training - a statistical perspective, 2015, 10.1152/japplphysiol.00714.2014 (`hecksteden-2015-individual-response`)
- Rosenblat MA et al., Which Training Intensity Distribution Intervention will Produce the Greatest Improvements in Maximal Oxygen Uptake and Time-Trial Performance in Endurance Athletes? A Systematic Review and Network Meta-analysis of Individual Participant Data, 2025, 10.1007/s40279-024-02149-3 (`rosenblat-2025-tid-ipd-nma`)
- Silva Oliveira P et al., Comparison of Polarized Versus Other Types of Endurance Training Intensity Distribution on Athletes' Endurance Performance: A Systematic Review with Meta-analysis, 2024, 10.1007/s40279-024-02034-z (`oliveira-2024-pol-meta`)
- Casado A et al., Training Periodization, Methods, Intensity Distribution, and Volume in Highly Trained and Elite Distance Runners: A Systematic Review, 2022, 10.1123/ijspp.2021-0435 (`casado-2022-elite-runners-review`)
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
- Vickers AJ, Vertosick EA, An empirical study of race times in recreational endurance runners, 2016, 10.1186/s13102-016-0052-y (`vickers-2016-race-times`)
- Wang C et al., Target trial framework for determining the effect of changes in training load on injury risk, 2024, 10.1136/bmjsem-2024-002037 (`wang-2024-target-trial-load`)
- Nakaoka G et al., The association between the acute:chronic workload ratio and running-related injuries in Dutch runners, 2021, 10.1007/s40279-021-01483-0 (`nakaoka-2021-acwr-runners`)
- Schuster Brandt Frandsen J et al., How much running is too much? Identifying high-risk running sessions in a 5200-person cohort study, 2025, 10.1136/bjsports-2024-109380 (`frandsen-2025-session-spike`)
- Muniz-Pumares D et al., The Training Intensity Distribution of Marathon Runners Across Performance Levels, 2025, 10.1007/s40279-024-02137-7 (`muniz-pumares-2025-marathon-tid`)
- Baldea JD et al., Training patterns, non-steroidal anti-inflammatory medication use, and effects on high-altitude ultramarathon performance, 2009, conference abstract, https://coachsci.sdsu.edu/csa/vol161/baldea.htm (`baldea-2009-leadville-training`)
- Baswick P, Is your long run too long?, Running Magazine, 2023, https://runningmagazine.ca/?p=99607 (`runningmagazine-2023-daniels-long-run-limit`)
- Roche D (interview by Skurka A), Training program for UTMB, andrewskurka.com, 2017, https://andrewskurka.com/utmb-100-ultra-training-program-david-roche/ (`skurka-2017-roche-100-recovery`)
- Galloway J, Getting Started Running Without Aches and Pains, jeffgalloway.com, https://www.jeffgalloway.com/01/getting-started-running-without-aches-and-pains/ (`galloway-2026-beginner-run-walk`)
- Tyler CJ et al., The Effects of Heat Adaptation on Physiology, Perception and Exercise Performance in the Heat: A Meta-Analysis, 2016, 10.1007/s40279-016-0538-5 (`tyler-2016-heat-adaptation-meta`; correction 10.1007/s40279-016-0572-3)
- Molina-Garcia P et al., Validity of Estimating the Maximal Oxygen Consumption by Consumer Wearables: A Systematic Review with Meta-analysis and Expert Statement of the INTERLIVE Network, 2022, 10.1007/s40279-021-01639-y (`molinagarcia-2022-wearable-vo2max`; correction 10.1007/s40279-026-02547-9)
- Mountjoy M et al., 2023 International Olympic Committee's (IOC) consensus statement on Relative Energy Deficiency in Sport (REDs), 2023, 10.1136/bjsports-2023-106994 (`mountjoy-2023-reds-consensus`; correction …106994corr1)
- Lu C et al., Validity of smartwatch-derived estimates of lactate threshold heart rate and pace compared to graded exercise testing, 2025, 10.3389/fphys.2025.1621996 (`lu-2025-smartwatch-lactate-threshold`; corrigendum 10.3389/fphys.2025.1661421)

**Candidates (not in the corpus)**

- Casado A, Foster C, Bakken M, Tjelta LI, Does Lactate-Guided Threshold Interval Training within a High-Volume Low-Intensity Approach Represent the "Next Step" in the Evolution of Distance Running Training?, 2023, 10.3390/ijerph20053782 (abstract)
- Seiler S, What is best practice for training intensity and duration distribution in endurance athletes?, 2010, 10.1123/ijspp.5.3.276 (abstract)
- Burnley M et al., Polarized Training Is Not Optimal for Endurance Athletes, 2022, 10.1249/mss.0000000000002869 (metadata)
- Foster C et al., Polarized Training Is Optimal for Endurance Athletes, 2022, 10.1249/mss.0000000000002871 (metadata)
- Zinner C et al., Mesocycles with Different Training Intensity Distribution in Recreational Runners, 2018, 10.1249/mss.0000000000001599 (abstract)
- Festa L et al., Effects of Different Training Intensity Distribution in Recreational Runners, 2019 (print 2020), 10.3389/fspor.2019.00070 (abstract)
- Qin G, Lee S, Kim S, Machine learning-based personalized training models for optimizing marathon performance through pyramidal and polarized training intensity distributions, 2025, 10.1038/s41598-025-25369-7 (abstract; the survey's full-text points unverified)
- Scudamore EM et al., An Evaluation of Time-Trial-Based Predictions of VO2max and Recommended Training Paces for Collegiate and Recreational Runners, 2018, 10.1519/jsc.0000000000001942 (abstract)
- Boullosa D et al., Factors Affecting Training and Physical Performance in Recreational Endurance Runners, 2020, 10.3390/sports8030035 (abstract)
- Meixner B et al., Zone 2 Intensity: A Critical Comparison of Individual Variability in Different Submaximal Exercise Intensity Boundaries, 2025, 10.1155/tsm2/2008291 (abstract)
- Treff G et al., The Polarization-Index: A Simple Calculation to Distinguish Polarized From Non-polarized Training Intensity Distributions, 2019, 10.3389/fphys.2019.00707 (abstract)
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
- Humphrey L, Hansons Marathon Method, VeloPress, 2012 and 2016 (Open Library); Humphrey L, Hanson's Marathon Method: The 16 Miler, 2011, https://lukehumphreyrunning.com/hansons-marathon-method-the-16-miler/ (read)
- Magness S, The Science of Running, Origin Press, 2014 (Open Library)
- Hudson B, Fitzgerald M, Run Faster from the 5K to the Marathon, Broadway Books, 2008 (Open Library)
- Lydiard A, Gilmour G, Running to the Top, Meyer & Meyer, 1997 (Open Library)
- Pierce B, Murr S, Moss R, Run Less, Run Faster, Rodale, 2007 (Open Library)
- Maffetone P, The Maffetone Method, Ragged Mountain Press, 1999 (Open Library)
- Boston Globe, Jack Daniels, Olympic medalist and 'world's best' running coach, dies at 92, 2025-09-28, https://www.bostonglobe.com/2025/09/28/metro/jack-daniels-olympic-medalist-worlds-best-running-coach-dies-92 (title and date read)
- RunRepeat, The State of Running 2019, https://runrepeat.com/state-of-running (read: 107.9 million race results; commercial publisher, funding not checked)

**Named by the surveys, checked, not used above (candidates unless stated)**

- Sandbakk Ø et al., Best-Practice Training Characteristics Within Olympic Endurance Sports as Described by Norwegian World-Class Coaches, 2025, 10.1186/s40798-025-00848-3 (abstract)
- Tønnessen E et al., Training Session Models in Endurance Sports: A Norwegian Perspective on Best Practice Recommendations, 2024, 10.1007/s40279-024-02067-4 (abstract)
- Kjøsen Talsnes R et al., Comparison of acute physiological responses between one long and two short sessions of moderate-intensity training in endurance athletes, 2024, 10.3389/fphys.2024.1428536 (abstract)
- Tjelta LI, Three Norwegian brothers all European 1500 m champions: What is the secret?, 2019, 10.1177/1747954119872321 (metadata; not in Europe PMC; carries a correction notice)
- Sitko S et al., What Is "Zone 2 Training"?: Experts' Viewpoint on Definition, Training Methods, and Expected Adaptations, 2025, 10.1123/ijspp.2024-0303 (abstract)
- Midgley AW et al., Is there an Optimal Training Intensity for Enhancing the Maximal Oxygen Uptake of Distance Runners?, 2006, 10.2165/00007256-200636020-00003 (metadata)
- Ekkekakis P et al., The Pleasure and Displeasure People Feel When they Exercise at Different Intensities, 2011, 10.2165/11590680-000000000-00000 (metadata)
- Garber CE et al., Quantity and Quality of Exercise for Developing and Maintaining Cardiorespiratory, Musculoskeletal, and Neuromotor Fitness in Apparently Healthy Adults, 2011, 10.1249/MSS.0b013e318213fefb (metadata)
- Mountjoy M et al., IOC consensus statement on relative energy deficiency in sport (RED-S): 2018 update, 2018, 10.1136/bjsports-2018-099193 (metadata; superseded by the 2023 record in the corpus)
- Hutchinson A, Endure: Mind, Body, and the Curiously Elastic Limits of Human Performance, William Morrow, 2018 (book; Open Library)

**Unverified**

- The page https://philmaffetone.com/180-formula/ and the Uphill Athlete page https://uphillathlete.com/aerobic-training/death-by-threshold/ (both refused a plain fetch; their content is as the methods survey reported it)
- SportRxiv, https://sportrxiv.org (named as a preprint server; launch date and screening not checked)
- Daniels J, Gilbert J, Oxygen Power: Performance Tables for Distance Runners, 1979 (not found in Open Library); Zheng L et al., Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena, 2023, arXiv 2306.05685 (not reached)
- Tucker R, Dugas J, The Science of Sport (blog, since 2007), and the World Athletics coach education page https://worldathletics.org/development/education/coaches (not read)
