# 0013. A history-informed load ceiling in minutes and a bounded load setting, never an acute-to-chronic ratio

Status: Accepted 2026-10-24 (#TBD)

The pull request number replaces `#TBD` when the pull request is opened.

Amends rule G-5 of `research/engine-rules.md`. Builds on ADR 0005, ADR 0007 and ADR 0009.

## Context

A runner with about a year of running, a strong recent block and sparse recent weeks gets a plan that
starts low and ramps slowly, although the runner can carry more than the plan prescribes (report of
2026-10-24). The request was for an answer from the literature and the runner's own history, "not
necessarily start from scratch". The load-progression proposal
(`docs/superpowers/specs/2026-10-24-load-progression-proposal.md`) measured the behaviour on a
synthetic runner, because the repository holds no personal data, and found two separate limits: the
weekly total is held by the start level, the E6 floor and the soft 10% step (grade D), and the long
run is held by the session guard G-1 (grade B), which reads the longest run of the last 30 days.

G-5 said "No ratio band blocks, caps or justifies progression". A credit for the runner's own earlier
weeks does justify a faster step, so the rule needed to say what it forbids: a ratio of recent to
earlier load, not a number of minutes read from the runner's history. Decisions 4 and 11 of section 6
of the proposal, taken on 2026-10-24, approve the amendment, this ADR and the six tissue papers added
to the corpus with it.

## Decision

**G-5 forbids a ratio and allows a personal ceiling in minutes.** No acute-to-chronic ratio (any
window, rolling or EWMA) gates, caps or justifies progression; it may still be shown as description.
A personal ceiling is a fixed number of minutes of weekly running taken from the runner's own steady
weeks. It divides no recent load by an earlier one, defines no band of values, flags no week and is
never called safe or unsafe. It may set how far a faster weekly step runs while a plan rebuilds
toward a level the runner held recently, and nothing else. `research/engine-rules.md` carries the
amended wording (G-5).

**The ceiling and the load setting are the shape of the engine change.** The later tasks of the
load-progression plan (L2 to L7) write them as rule g-8 with its Params, every one grade D with a
default note, and bump `PARAMS_VERSION` with them. This ADR fixes the shape, not the numbers:

- The ceiling is computed from a block of steady recent weeks that one big week cannot set, from the
  weeks the athlete state already holds (ADR 0009, no new query).
- A load setting with three positions, Steady, Standard and Upper band, is a plan option chosen on
  the Generate form (later also a plan action with a preview and an undo, ADR 0007; decision 6). It
  sets only the weekly step below the ceiling. The largest step is derived from the hard ceiling of
  G-2 (30% over two weeks), so the setting cannot pass it. Above the ceiling the soft 10% resumes.
- The default is Steady, which gives today's plan byte for byte (decision 2). A position is forced to
  Steady, with a stated reason, under a recent injury on file, a prior bone stress injury or two bone
  stress factors, a REDs hold or focal bone pain, a rest window or an injury report, a post-race
  window and low running frequency. At age 45 or over the soft flag caps the position at Standard
  and does not block the 3 x 30 route below (decision 12).
- Session length is not credited: G-1 stays as it is (decision 10).

**Guards that stay.** G-1 (1.10 warn, 2.00 override, 30-day window, hard in the start paths), the 30%
two-week ceiling of G-2, the tightened profiles of G-3, the progression hold and reduce signals (J5),
G-6, the J7 table, the post-race window (H12), the disruption windows (J9), the recovery cadence and
cut, the 15-item checklist, ADR 0005 (rule code chooses every session; text comes from templates)
and ADR 0007 (every change is a visible, undoable revision).

**Other decisions of 2026-10-24 on section 6 of the proposal**, recorded here because the engine
tasks implement them:

- A 3 x 30 start from a demonstrated block (a year of running and a 90-minute week block in the last
  12 weeks) is allowed at Standard and Upper, with the same exclusions as the existing route
  (decision 1). G-1 still bounds every session.
- The values of the positions (12% with 0.70 of the block and 14.0% with 0.85 in the proposal) are not
  fixed; the replay on real history decides (decision 3).
- The next week's baseline is the higher of the planned minutes and the trailing four-week mean of the
  minutes actually run, then the position's step applies; race weeks and rest-window weeks are
  ignored (decision 5). A raised week target survives a re-plan within the step limit and shows in the
  revision (decision 9).
- The credit window is built both ways behind a Param, 12 weeks at full credit and 16 weeks with the
  credit tapering to half after 12, and the replay decides (decision 7).
- The J7 pre-break proxy is left alone (decision 8).

Reasons:

- **Fact:** The corpus holds no running study of the injury rate when a runner returns to an earlier
  weekly level or long run after two to eight weeks of reduced running, none of retraining speed in
  recreational or masters runners, and none of a tissue-capacity time course in runners. Known by a
  corpus read and a web search on 2026-10-24 (proposal sections 3.6 and 3.7) and by the research update of
  2026-10-25 that added six tissue papers, none of which answers these. Every Param of this change is
  therefore grade D.
- **Fact:** Under complete unloading in young non-runners, patellar tendon stiffness fell 9.8% by day
  14 and 29.3% by day 23 of leg suspension in 9 men [deboer-2007-ulls-tendon-time-course], and an
  Achilles stiffness gain of 50.3% from 3 months of isometric training was back at its pre-training
  level after 1 month of detraining in 9 men [kubo-2012-achilles-training-detraining]. VO2max fell
  7% by day 21 and 16% by day 56 after endurance athletes stopped training
  [coyle-1984-detraining-time-course], and a meta-analysis found no significant further fall beyond 30
  days on average [zheng-2022-detraining-vo2max]. The tendon papers were read on Crossref and Europe
  PMC on 2026-10-25; they are small, complete-unloading studies with no running outcome and no
  retraining phase.
- **Fact:** Tendon stiffness adapts mainly to loading magnitude across 37 interventions of 8 weeks or
  more in 264 healthy adults [bohm-2015-tendon-adaptation-meta]. A review of bone stress injury states
  that cortical resorption takes about 4 weeks and replacement 3 months to a year, that injuries began
  3-4 weeks after a large workload change in military recruits, and that tolerance of load changes
  varies between individuals and sites [warden-2021-bsi-optimal-workload] (a review's summaries of
  other sources, level D); a second review frames bone stress injury as microdamage against its
  removal, load against the bone's ability to resist it [warden-2014-bsi-long-distance-runners]. A
  conceptual framework sets the capacity of one structure against the load of a session
  [bertelsen-2017-rri-etiology-framework]. None gives a rate for a rebuild.
- **Fact:** Running cohorts disagree on the ratio. In 435 runners the predicted injury probability was
  9.6% below a ratio of 0.70 and 1.3% above 1.38, an inverse association [nakaoka-2021-acwr-runners];
  in 5205 runners the 1:3-week ratio had a negative dose-response and the week-to-week ratio none
  [frandsen-2025-session-spike]; in 461 runners a duration ratio gave HR 1.33, gone once runners
  injured at baseline were excluded [cloosterman-2026-gps-load-injury]. The same cutoffs flagged 16 to
  33% of sessions depending on the calculation method [cloosterman-2024-acwr-methods]. Critiques find
  that no study estimates a causal effect of the ratio and that it fails to normalise
  [impellizzeri-2020-acwr-pitfalls], and that an EWMA ratio has an initial-load problem
  [wang-2020-acwr-lessons].
- **Fact:** Weekly steps. In 874 novices injury rates did not differ between progressions under 10%,
  10 to 30% and over 30%, with a non-significant signal for distance-related injuries above 30% (HR
  1.59, 0.96 to 2.66) [nielsen-2014-weekly-progression]. A review of four studies found no difference
  between a 10% and a 24% average weekly increase (HR 0.8, 0.6 to 1.3)
  [damsted-2018-training-load-change]. In 261 runners more were injured after a 20 to 60% weekly
  increase than under 20% at day 21 and not at days 56 or 98 [damsted-2019-weekly-distance-change].
  All are observational and mostly in novices, and none follows a return after a break.
- **Fact:** A session more than 10% above the 30-day longest run carried HRR 1.52 to 2.28 against the
  reference in 5205 runners [frandsen-2025-session-spike]; the cohort did not separate returns after
  reduced running. G-1 is the engine's best-supported guard (grade B).
- **Fact:** `Plan.options` is a JSON text column on the `Plan` row (`prisma/schema.prisma`, read
  2026-10-25), so a plan option needs no migration, no new model and no `STATE_MODELS` change.
- **Rule:** The corpus principle (`research/README.md`, rule G6): a change toward more load needs
  stronger evidence than a change toward less, and the more conservative rule wins. Nothing here is
  above grade D, so the default is Steady, every guard stays and every Param says it is a default.
- **Rule:** Copy discipline G5: no sentence says that a limit prevents injury or that passing one
  causes it, and none shows a personal injury probability. The setting's hint states that the effect
  of a faster step on a return after a break is not known.
- **Rule:** ADR 0005 and rule G1: rule code chooses every session; the ceiling and the setting are
  rule code, and their explanations are templates over Param values.
- **Rule:** ADR 0009: athlete data comes from the snapshot, so the block is computed from the weeks
  the state holds and nothing queries the 365-day history again.
- **Rule:** `CLAUDE.md`, Conventions: every number in `shared/engine/` is a `Param` with a grade, a
  rule id and cited paper ids, and a grade D value carries a note that says it is a default.
- **Opinion:** A ceiling in minutes from steady weeks can be read on a calendar and stated in one
  sentence in the Why drawer. A ratio hides the level in a quotient whose value depends on the window
  and the method, and an EWMA version misreads the first weeks after a break.
- **Opinion:** The history credits the weekly total and not the session. The fitness evidence speaks
  to totals, the tissue papers suggest that capacity can fall faster than fitness and is built
  slowly, and the session guard is the better-supported rule; a faster weekly step that leaves G-1
  intact costs the least evidence.
- **Opinion:** Deriving the largest step from the Param of the hard ceiling keeps "the most the
  literature tolerates" equal to the engine's own grade C ceiling and moves it if that Param moves.
- **Opinion:** A default of Steady with an explicit choice shown with its trade-off suits a change
  that has no evidence above grade D: the runner who wants a faster rebuild can ask for it, and the
  owner validation of the default plan stays unchanged.

Alternatives:

- **An acute-to-chronic ratio as the ceiling or the gate (EWMA chronic load).** Against (**Rule**):
  G-5. Against (**Fact**): the running cohorts disagree, one finds an inverse association, one loses
  its association once baseline-injured runners are left out, and the critiques cited above. For
  (**Opinion**): it adapts to any history without a block definition; the ceiling achieves the same
  with a number a runner can check.
- **A longer or history-lifted G-1 reference (a session-level credit from a year of history).**
  Against (**Fact**): the guard rests on 5205 runners and its cohort never separated returns; the
  tissue papers give no support to crediting past training to a single session. For (**Opinion**): it
  would remove most of the early wait for a long run (on the synthetic runner, 20 weeks to a
  150-minute long run from a 45-minute reference, proposal section 4.7). Decision 10 leaves G-1 as it
  is.
- **An age or experience credit.** Against (**Fact**): runners with under 1 year or over 40 years of
  running had the most injuries [abrahamson-2025-self-reported-characteristics], and competitive
  runners had the highest pooled incidence [fredette-2022-training-parameters-injury-review]; the
  corpus rule `injury-no-experience-loosening` (grade C) rules out loosening by experience.
- **Amending E6 for everyone, with no setting.** For (**Opinion**): it is the simplest change. Against
  (**Opinion**): every default plan changes and the validation baseline moves, a default toward more
  load without evidence above grade D (G6).
- **A runner-level setting instead of a plan option.** For (**Opinion**): it would apply to every
  plan. Against (**Fact**): it needs a migration and a state classification, where `Plan.options`
  needs neither. Decision 6 chose the plan option.

## Consequences

- G-5 has two clauses: the ratio is never a gate, and a personal ceiling in minutes from the runner's
  own steady weeks is allowed and is not a ratio. A later use of a ratio as a gate still contradicts
  the rule.
- This change adds no `Param`, changes no number and does not touch `PARAMS_VERSION`. Rule g-8, its
  Params, the history block, the 3 x 30 route, the rebuild zone, the setting, the copy and the
  fixtures follow in tasks L2 to L7 of the proposal, each with the owner validation, and Steady must
  equal today's engine.
- Decision 5 qualifies the G-2 and G-6 statement that a week run above the plan lifts nothing after
  it. The task that implements it amends that text with the rule.
- Every number of the ceiling stays grade D until a running study of retraining speed or of the
  injury rate on a return exists (`research/engine-rules.md`, gaps 11 and 12). No copy or Param note
  may claim more, or say that a limit prevents an injury.
- The corpus holds 376 papers. The six new ones are the first timing evidence for tendon and bone in
  it; they support caution after a reduction in running and no value. The J7 fractions stay a
  convention.
- A runner who chooses Standard or Upper accepts a faster rebuild whose effect on a return after a
  break is not known. The app says so beside the choice, and Steady stays available.
- The 3 x 30 route overturns the "2 years" detail of the engine design's first owner decision and
  sits against `injury-no-experience-loosening`. It keys on a demonstrated block, not on experience,
  and still moves toward more load for one class of runners; decision 1 accepts that.
- The values of the positions and the credit window wait for the replay on real history.
