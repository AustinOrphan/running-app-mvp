# 0016. The evaluation harness is report-only

Status: Proposed 2026-10-31

Amends rule G-5 of `research/engine-rules.md` by one sentence. Builds on ADR 0005 and ADR 0013.

## Context

The sources, methods and evaluation proposal
(`docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md`, section 5) asked which
tools would test and evaluate plans. Two tasks of it are on `main`: the plan metrics (`describePlan`,
`tests/unit/engine/plan-metrics.ts`, #597) and the plan report with its reference bands, scorecard,
scan test and the `plan-review` skill (`npm run plan:report`, `tests/reports/`, #601). A simulator
(task H2) and a back-test (task H4) follow. The harness measures plans of the real generator: the
plateau, the steps and their headroom under G-2, the long-run share, the declared and the realised
zone distribution, the planned load, the monotony and the descriptors of cycles and taper.

The plans already have gates: the conformance asserts of the matrix, the sweeps and the chains, and
the 142 digests of the oracle (`tests/unit/engine/history-oracle.json`). The question is whether any
harness figure becomes a gate too. Decisions 9 and 11 of section 7 of the proposal, answered
2026-10-31, say no; this ADR records the decision, the alternatives and the reasons, and the wording
that keeps G-5 consistent with it.

## Decision

**The harness describes plans and gates none.**

1. **Report-only.** No harness figure is a threshold in `npm run check`, in CI or in a build step.
   The conformance asserts and the oracle stay the only gates on a plan. The harness adds to
   `npm run check` its scan test (item 4) and tests of its own arithmetic (hand-computed cases); none
   of them asserts a bound on a plan figure.
2. **Run by hand at every `PARAMS_VERSION` bump.** `npm run -s plan:report` runs before and after the
   change, and the diff of the two outputs goes into the pull request. `CLAUDE.md` (Commands) and the
   `research-update` skill (Checks before finishing) state the step. The report is not run in CI.
3. **The simulator follows the same rule.** The figures of the simulator (task H2; for example weeks
   at 80% of target or more, weeks above 120%, minutes moved per re-plan, hold-progress-hold flips,
   peak drift and minutes delivered against the first plan) are report-only, with the ragged level first, run by hand
   at each bump. Its two metamorphic relations, that a closed day never raises a week and that a
   re-plan with no new data is a fixed point, may enter `npm run check` as plain invariants if H2
   measures their chain time under one minute. They are rules the engine must hold for any input, not
   metrics of a plan.
4. **A scan keeps `tests/` out of the product.** No file under `shared/`, `server/`, `web/` or
   `scripts/` imports anything under `tests/` (`tests/unit/reports/harness-isolation.test.ts`). The
   scan names the harness files and also refuses every path under `tests/`, because the harness
   grows files (the simulator) that a list cannot name yet.
5. **No overall score, no acute:chronic ratio.** Each figure carries the grade and the rule id of
   what it rests on, and a figure with no rule says so. A band row from a published plan is labelled
   "D, practice source"; its distance from the band is reported and never minimised. No text names an
   injury probability or calls a plan "safe", "behind" or "missed" (G5). A change that improves a
   figure still enters through `research-update`.
6. **G-5 gains one sentence**, in `research/engine-rules.md`: a figure printed to describe a plan
   gates, caps and justifies nothing, so it is not the ratio band the rule forbids, as ADR 0013 found
   for a personal ceiling in minutes.

## Reasons

- **Fact:** The report is deterministic and cheap to run. Two full runs of `npm run -s plan:report` on
  2026-10-31 (518 lines, 15.5 s and 27.2 s) differed only in the one note edited between them; the
  text holds no clock, no randomness and no run time, which goes to stderr. Known by running it and
  diffing the outputs. A run costs under half a minute.
- **Fact:** A by-hand step at each bump stays affordable even at the pace of the build phase.
  Thirteen commits changed the `PARAMS_VERSION` line from 2026-10-22 to 2026-10-25, which at two
  runs of up to half a minute each is about ten minutes of waiting in all, and none changed it from
  2026-10-26 to 2026-10-31. Known by `git log -G"PARAMS_VERSION = "` on
  `shared/engine/params/index.ts`, 2026-10-31.
- **Fact:** No source read for the harness puts an outcome behind one of its figures. The reference
  bands come from 92 marathon plans with no outcome data, so effectiveness and injury safety are unknown
  [knopp-2024-marathon-plans]; Treff's 2.00 cut-off is called objective but not physiological by its
  authors, who add that values from 0 to 2.00 must not be read as degrees of polarization, and the
  paper tests it against no outcome [treff-2019-polarization-index]; the 5% plateau tolerance is a named preference
  of the code (`PLATEAU_TOLERANCE`, `tests/unit/engine/plan-metrics.ts`). Known by the corpus records
  and the source read on 2026-10-31.
- **Fact:** The one corpus study in which coaches rated plans validates no weighting of its
  criteria. It used 22 criteria, rated three plans from one chatbot version on a 1-5 scale, and
  measured no outcome and no injury [duking-2024-chatgpt-running-plans]. Known by the corpus record,
  read 2026-10-31.
- **Fact:** Acute:chronic ratios disagree on direction and on what they flag. In 435 runners the
  predicted injury probability was 9.6% below a ratio of 0.70 and 1.3% above 1.38
  [nakaoka-2021-acwr-runners]; in 5205 runners the 1:3-week ratio had a negative dose-response
  [frandsen-2025-session-spike]; in 735 runners training for one marathon each day at 1.5 or more
  carried an odds ratio of 1.06 for injury [toresdahl-2023-nyc-marathon-training-injury]; in 119
  runners of one 56 km race injury incidence was related to a ratio above 1.5
  [craddock-2020-acwr-two-oceans]; and one definition of a significant load increase flagged 16.2%
  to 33.4% of 22,839 sessions depending on the calculation method [cloosterman-2024-acwr-methods].
  Known by the corpus records, read 2026-10-31; ADR 0013 lists the critiques.
- **Fact:** The scan test is a model the repository already uses, and it was tested against the
  forms an import takes. `tests/unit/server/noRawWrites.test.ts` scans `server/` and `scripts/` for
  raw writes to a state table (ADR 0009); the isolation scan fails if it finds 200 files or fewer
  in the four directories or none in one of them, and has cases for a static import, a re-export, a side-effect import, a multi-line
  import, a dynamic `import()`, `import.meta.glob`, `require`, an extensionless path and a path from
  the root, and for comments that must pass. Known by reading both tests, 2026-10-31.
- **Rule:** G-5 (`research/engine-rules.md`): no acute-to-chronic ratio band blocks, caps or
  justifies progression, and a ratio "may still be shown as description" (ADR 0013, Decision). The
  new sentence of G-5 applies the same reading to every figure of the report.
- **Rule:** G3 (priors, not optima) and G6 (rules never move toward more load when the evidence is
  weak; the more conservative one wins) in `research/engine-rules.md`. A figure that is no prior and
  no rule cannot be a target, and a target on the plateau or the step would point toward more load.
- **Rule:** G5 (copy discipline) in `research/engine-rules.md`, enforced by `shared/copy/lint.ts`.
  The report imports the lint and its test fails on "safe" and the other G5 words.
- **Rule:** `CLAUDE.md`, Conventions: every number in `shared/engine/` is a `Param` with a grade, a
  rule id and cited papers; `CLAUDE.md`, Structure: `research/` and `engine-rules.md` change through
  the `research-update` skill. A threshold on a plan figure would be a number that steers the
  engine and has none of these.
- **Rule:** ADR 0005 and G1: rule code chooses every session. The `plan-review` skill ends in a
  list headed "Unvalidated", never in a plan edit.
- **Opinion:** A gated figure becomes a target. The cheapest way to turn a failing build green is to
  move the plan until the figure passes, and since no figure has an outcome behind it in the sources read (Fact
  above), a pass shows nothing about the plan. A description that nothing waits on can still be read
  wrongly, but it cannot be tuned against by accident.
- **Opinion:** The delta belongs in the pull request text. A reviewer reads the change beside the
  `PARAMS_VERSION` bump that caused it, with no job to open and no baseline to fetch from `main`.
- **Opinion:** The two metamorphic relations may gate because failing one is a bug whatever the
  plan, where a failing metric is only a difference. A relation holds for every input or the engine
  is wrong; a metric has no right answer.
- **Opinion:** A scan of all of `tests/` is better than a list of harness files because a list lags
  the harness: the simulator and any later file would pass the scan until a person added their name.
- **Preference:** The report is Markdown on standard output, read in a terminal or pasted into a pull
  request, and not a page or a dashboard.

## Alternatives

- **A gated metric** (a threshold on the plateau, the steps, the long-run share or the index in
  `npm run check`). For (**Opinion**): it would catch a regression that no one reads a report to
  find. Against (**Fact**): no figure has an outcome behind it (above), so a threshold would
  encode a taste; the oracle already fails on any change to one of its 142 pinned plans, which
  catches a regression without judging it. Against (**Rule**): G3, G6 and the `Param` convention above. Against
  (**Opinion**): a threshold at a number rewards moving the plan to the number.
- **A CI artefact** (upload the report on every pull request). For (**Opinion**): the figures would
  exist for every change without a by-hand run. Against (**Fact**): CI has one job and uploads one
  artefact, the Playwright report on failure (`.github/workflows/ci.yml`, read 2026-10-31), and the
  delta that matters needs a baseline from `main`, so the job would run the report twice and diff
  it. Against (**Opinion**): an artefact that no step reads protects nothing, and the by-hand step
  puts the delta where the review looks.
- **No harness.** For (**Opinion**): nothing to maintain and no figure to tune toward (proposal
  section 6). Against (**Fact**): before the metrics, the shape of the plateau (six of twelve matrix
  plans reach their class ceiling within nine weeks) was found with throwaway scripts in the
  git-ignored `data/` directory, which a clone of the repository does not hold (proposal, header
  and section 8, task RU2). Against (**Opinion**): a rule change should show what it did to the plans, and a repeatable
  report shows that where a one-off script does not.
- **An overall score or ranking of plans.** For (**Opinion**): one number is easy to compare.
  Against (**Fact**): the one study of rated plans validates no weighting (Duking, above), and a score would hide which
  figure moved.
- **An acute:chronic ratio in the report, as description.** For (**Rule**): G-5 allows a ratio shown
  as description. Against (**Fact**): the cohorts above disagree on direction. Against (**Opinion**):
  a printed ratio is read as a limit whatever the label, which is why G-5 exists, and the report has
  no use for one: the weekly step and the G-2 headroom already describe the progression.

## Consequences

- G-5 has three clauses: a ratio is never a gate, a personal ceiling in minutes is not a ratio
  (ADR 0013), and a descriptive figure in a report is not a band. A later gate on a harness figure
  contradicts this ADR; a later use of a ratio as a gate still contradicts G-5.
- `npm run check` stays the gate. The digest of the report's matrix section in
  `tests/unit/reports/plan-report.test.ts` moves with every change to a matrix plan and is
  regenerated after the by-hand delta is read. It is a change detector like the oracle, not a
  threshold.
- Each `PARAMS_VERSION` bump costs two runs and a pasted diff. Nothing in CI enforces it, so a bump
  without its delta is a finding for the review.
- The harness cannot stop a reader from tuning a plan toward a figure. The scan and `research-update`
  block code paths and numbers, not intentions (proposal section 6).
- The simulator (H2) and its two invariants are decided here by shape. Whether the invariants join
  `npm run check` waits for H2's measured chain time.
- The back-test (H4) stays outside the repository and reports counts only. It changes neither L7,
  `backtest.ts` nor `trackRecord.ts`; showing a baseline skill or an interval score in the app would
  be a rule change with `Param`s.
- Treff's index is in the corpus as a hypothesis paper at level D, cited by no rule, and the report
  prints it as a value with the order of the zones. In the case of an empty zone 2 the code leaves
  zone 3 as it is where the paper's Eq. 2 also takes 0.01 from it (3.20 against 3.18 for 80/0/20); a
  comment on `TREFF_EMPTY_ZONE_FLOOR` records the difference.
