# 0014. The strength prescription is derived on read from rules, a closed catalogue and the runner's own log

Status: Accepted 2026-10-31 (#598)

Builds on ADR 0003, ADR 0005, ADR 0007, ADR 0009, ADR 0010 and ADR 0011. Adds rules F7 to F9 to
`research/engine-rules.md` and amends E5, F4, F-lib, H5 and H10 there (dated 2026-10-25).

## Context

A strength session is a label today: the title "Strength", a fixed number of minutes, an empty
structure, the zone `strength` and one sentence (design section 1.2, checked on `main` at `bfb6c9f2`
on 2026-10-24). The runner asked on 2026-10-23 for named exercises with weight, repetitions,
recording, tracking and suggestions, with equipment and lifting history kept in the app, and on
2026-10-24 for a log and a history good enough to replace a dedicated lifting app (design sections
1.1, 1.4 and 18).

The design (`docs/superpowers/specs/2026-10-24-strength-phase3b-design.md`) turns that into a
workout of lifts with sets, a repetition range, a load and an effort target. Five choices need a
decision before the epic's tasks start (decisions 2, 4, 5, 7 and 12 of section 15 there):
where the prescription lives, how exercises are chosen, how a load is stored and shown, what
sets and regulates a load and what a maximum is, and whether the barbell is offered. The research
update of task E14-1 (twenty papers added on 2026-10-25, rules F7 to F9 and their Params) gives the
evidence for each; it gives no dose a grade above D.

## Decision

The workout of a strength session is one pure function of the plan, the runner's saved equipment and
the runner's logged sets, evaluated on every read. Nothing of it is stored on the planned session.

- **Derived on read (decision 2).** `workoutFor(context, session)` in `shared/engine/strength.ts`
  builds the lifts, sets, loads and efforts from the week's flags, the position in the strength block,
  the equipment, the exercises the runner left out and the logged sets. `PlanSession` keeps its kind,
  date, order, duration (the time budget), rules and flags; `purpose` is one sentence. `sessionRow()`,
  pairing, diffs and undo are untouched. The session's `rules` gain `F7` (and `H10` for an ultra
  goal); `F8` and `F9` appear on the reason of a lift. Every surface renders the one object.
- **A closed catalogue (decision 4).** `shared/domain/strengthLibrary.ts` holds 25 exercises with
  slot, implement, load basis, harder movement and rule tags. An id is never renamed or reused;
  an exercise that leaves the catalogue stays in it, marked retired. There is no free-text exercise
  in version 1 (owner decision of 2026-10-24, question 11), and no import of another lifting app
  (question 4).
- **Loads in grams (decision 5).** A load is an integer number of grams. `User.weightUnit` (`'lb'` or
  `'kg'`) is the display unit, a setting of its own beside `User.units`, backfilled from the distance
  unit and returned by `/api/settings`; pounds is the default the owner chose (question 3). A load
  rounds to the steps the saved equipment can make, and a stored fact holds grams and no unit.
- **Effort-based progression and an estimated maximum (decision 7).** Rule F8 sets the next load by
  double progression inside the repetition range, from the repetitions the runner left in reserve,
  with a step the equipment can make, a lower load after a set below the range and no increase on a
  missing count. The one-repetition maximum is an estimate from submaximal sets, labelled an
  estimate, used for a first load, a ceiling of 90% and a figure beside a load, shown in the
  history view and never on Today (question 10), and never tested.
- **The barbell after the ramp-in (decision 12).** A barbell exercise leads its ladder for any
  runner whose saved equipment has a bar, plates and a rack, once the ramp-in is over, whatever the
  lifting level (owner decision, question 7). The ramp-in and return templates use no barbell lift.
- **Boundaries the owner set.** A lift never displaces a run: when no legal day exists the week holds
  fewer lifts (question 5). The novice hip and core block and mobility sessions come later
  (question 12).

Every dose is a `Param` of the groups `f7`, `f8` and `f9`, grade D with a note that says it is a
default, except the planning figure for the benefit (grade A). The prescription is described in
`research/engine-rules.md` (F7 to F9) and the numbers in `shared/engine/params/f-micro.ts`.

Reasons:

- **Fact:** `PlanSession` has no column for an exercise, a set or a load (`prisma/schema.prisma`, read
  2026-10-25), and the workout depends on things that change without a re-plan: the equipment, which
  is editable at any time (design section 6.5, question 1), the exercises left out and the sets
  logged after each session.
- **Fact:** The fuel target is already a pure function replayed from the logs on every read, which
  left `PlanSession`, pairing, diffs and undo untouched (ADR 0011).
- **Fact:** A re-plan regenerates the strength flags from the current week. A probe on 2026-10-24 of
  `buildPlan` on the matrix athlete `first-100-mile`, with `today` moved forward 0, 7, 28, 56 and 84
  days, gave 12 flagged weeks at 0, 7 and 28 days, 11 at 56 days and none at 84 days (design
  section 1.2). Anything stored at plan time would be rewritten with it.
- **Fact:** `AthleteProfile.weightKg` is a `Float` (`prisma/schema.prisma`, read 2026-10-25), and 45 lb
  is 20 411.7 g, stored as 20 412 g. The tests of "same as last time" and the working-load rule
  compare loads, which would then depend on the rounding of a float.
- **Fact:** The corpus has no paper that compares progression schemes (linear, double, percentage) in
  runners or novices, validates a repetitions-to-maximum equation in runners or gives safety data for
  recreational runners starting barbell lifts. The gap pass of 2026-10-25 added the closest evidence, each paper checked on Crossref
  and its abstract read on Europe PMC that day: a consensus step of 2-10% for healthy adults
  (`acsm-2009-progression-models-resistance`), similar strength gains from effort-based and
  percentage-based prescription in resistance-trained lifters (`hickmott-2022-autoregulation-meta`),
  a count of repetitions in reserve that is imprecise by about one repetition
  (`halperin-2021-rir-prediction-accuracy`), and repetitions at a percentage of the maximum that vary
  between people and exercises (`nuzzo-2023-reps-at-percent-1rm`).
- **Fact:** Injury rates were 2.4-3.3 per 1000 hours of training in weightlifting and 1.0-4.4 in
  powerlifting, in the range of other non-contact sports, in a systematic review of nine mostly
  low-quality studies of competitive lifters (`aasa-2016-weightlifter-powerlifter-injuries`, abstract
  read 2026-10-25). It is not data for a recreational runner.
- **Fact:** The evidence for strength work in runners is about named movements: heavy lower-body lifts
  at 80% of the maximum or more (grade A), calf raises (one trial, grade C) and low-amplitude jumps
  (`research/topics/strength-plyometrics.md`, `llanoslagos-2024-economy-speeds`,
  `eihara-2024-middle-aged-pt-rt`). A lift typed as text carries no grade.
- **Rule:** ADR 0005 and ADR 0010: rule code chooses every session and every load, and every sentence
  is a template over facts. A language model never chooses a load or writes a reason.
- **Rule:** ADR 0007 lists as an anti-goal any change to a training target that the runner cannot see
  and reverse. A re-plan to refresh a stored prescription after a change of equipment would be one.
- **Rule:** ADR 0003 stores integers in base units and converts at the display edge.
- **Rule:** G6 in `research/engine-rules.md`: where rules collide the more conservative wins, and a
  change toward more load needs stronger evidence than a change toward less. Until the setup is saved
  the workout is bodyweight only; the barbell waits for the ramp-in; a missing count holds the load;
  the app never asks for a maximal attempt.
- **Rule:** `CLAUDE.md`, Conventions: every number in `shared/engine/` is a `Param` with a grade, a
  rule id and cited papers, and a grade D value carries a note that says it is a default.
- **Rule:** ADR 0009 and `CLAUDE.md`, Conventions: athlete data comes from the snapshot or a memo keyed
  to the data version, so the strength tables are read through one memo like the fuel tables, and a
  new Prisma model is classified in `STATE_MODELS` or `NON_STATE_MODELS` in the PR that adds it.
- **Opinion:** One derived object keeps one definition of the prescription. A stored copy is stale
  after each change of equipment or log, and a data write in the middle of the plan tables with a
  revision behind each log would put the plan's history in the lifting log's way. A cross-surface test
  can hold every surface to the one object.
- **Opinion:** A closed catalogue lets selection, stepping, substitution and explanation read
  metadata. An exercise typed as text could be logged but not progressed, swapped or explained, and
  the app would have nothing graded to say about it.
- **Opinion:** Integer grams make "same as last time" an equality test, and a unit setting separate
  from the distance unit suits the common mix of miles and kilograms.
- **Opinion:** Double progression is readable: a runner can predict the next load from the last
  session, it fits the 3-6 repetition range of the heavy template, and it never asks for a load the
  equipment cannot make. It is no better supported than the alternatives, which is why it is a
  default (grade D).
- **Opinion:** A maximum estimated from submaximal sets and a reps-in-reserve target avoid a maximal
  attempt, which is a risk for a runner lifting without a spotter.
- **Opinion:** The barbell squat and hinge are the best-supported lifts of the ladders, and the
  ramp-in on other lifts is the technique base that the topic rule asks for, so the barbell can lead
  once the ramp-in is over.
- **Preference:** Pounds as the default weight unit is the owner's choice, with no reason recorded
  (question 3).

Alternatives:

- **Store the prescription on `PlanSession`** (exercises, sets and loads written when the plan is
  built). For (**Opinion**): a future watch or calendar export could read the session with no
  engine call. Against (**Fact**): it is stale after each change of equipment, exclusion or log.
  Against (**Rule**): the anti-goal of ADR 0007, since a re-plan to refresh it would revise a plan
  the runner did not change. The workout function can serve an export when one is wanted.
- **Free-text exercises, logged but never progressed.** For (**Opinion**): a runner who lifts other
  things, or whose gym has a machine that is not in the list, would have a place for that history,
  and "specific exercises" is the owner's own word. Against (**Fact**): such a lift has no slot,
  implement, step or rule tag, so it cannot be selected, stepped, swapped or explained, and it has no
  grade. The owner decided on 2026-10-24 that it stays out of version 1 (question 11); a missing lift
  is a data change plus a catalogue test, and a session note records anything else.
- **A larger catalogue with upper-body lifts and body-part splits.** Against (**Rule**): the design
  is not a general-purpose gym app (section 2.2). Against (**Fact**): the corpus supports lower-body
  and trunk work for runners and nothing for the rest.
- **An importer for another lifting app.** For (**Opinion**): a runner could bring years of history.
  Against (**Fact**): the owner has no recent lifting data to bring (design section 18), and no
  export format is assumed in the design (section 16, question 4). The bar that replaces it is a log and a history good enough that a
  runner can leave a dedicated app (design section 1.4); whether it is met is judged after a month of
  use (task C2).
- **Kilograms as a float, like `AthleteProfile.weightKg`.** For (**Opinion**): no conversion layer
  and the smallest change. Against (**Fact**): the equality tests would depend on the rounding of
  converted pounds (above).
- **The weight unit in `StrengthSettings` instead of `User`.** For (**Opinion**): a smaller change.
  Against (**Fact**): `/api/settings` is one of the five reads the offline worker keeps (ADR 0012),
  so a unit on `User` is available to the offline shell, and both tables are state either way.
- **The weight unit derived from the distance unit.** Against (**Opinion**): miles with kilograms is
  common, and the owner wants pounds with a switch for any runner.
- **A tested one-repetition maximum with percentage waves.** For (**Opinion**): it is the textbook
  basis of percentage prescription. Against (**Rule**): G6 and the rule that the app never asks for a
  maximal attempt. Against (**Opinion**): a tested maximum is a risk without a spotter.
- **Percentage waves or a fixed 5 x 5 without a log-driven rule.** For (**Opinion**): simpler to write.
  Against (**Fact**): no better supported; effort-based and percentage-based prescription gave
  similar strength gains in trained lifters (`hickmott-2022-autoregulation-meta`, a difference in
  1RM of 2.07 kg with a 95% interval of -0.32 to 4.46 kg), and no paper compares schemes in runners.
- **No estimate of a maximum at all.** For (**Opinion**): no unvalidated equation in the app. Against
  (**Fact**): a first load and a ceiling need a reference, and the owner asked for the estimate in
  the history view (question 10); it is labelled an estimate and no paper validates the equation
  (rule F8).
- **The barbell only for a self-described experienced lifter** (the first version of the design).
  For (**Rule**): G6, because the corpus has no safety data for recreational runners starting
  barbell lifts. Against (**Opinion**): the ramp-in is the technique base and the barbell lifts are
  the best supported. The owner chose the wider rule on 2026-10-24 with no reason recorded
  (question 7); the controls are the safety line, no maximal attempt and at least the easy count of
  repetitions in reserve in the first session of an exercise.
- **No barbell at all.** For (**Rule**): G6 and no safety question. Against (**Fact**): the heavy
  method has its best support at 80% of the maximum or more, which dumbbells reach only briefly
  (a goblet squat moves to a split squat when the dumbbells run out).
- **A lift may displace an easy run in a low-volume week.** For (**Opinion**): adherence in a short
  week. Against (**Rule**): G-6 forbids making up volume and F6 asks for one lever at a time.
  Against (**Fact**): the runs carry the load that the rest of the evidence is about. A lift on the
  same day as an easy run, at least `f4.strengthSeparationHours` hours apart, is already the
  preferred placement of F4, so two sessions in a day stay normal (question 5).
- **Include the novice hip and core block and mobility sessions in this epic.** For (**Fact**): a
  supervised trial lowered injuries in novices with a hip and core programme before runs
  (`leppanen-2024-hip-core-novice`, grade B). Against (**Opinion**): it serves a different runner
  and a different session kind, and the dose is a default; question 12 puts it later.

## Consequences

- `PlanSession`, `sessionRow()`, pairing, diffs, undo and the stored plan do not change. A session
  that a future surface shows (a watch, a calendar feed) must call `workoutFor`; no stored copy
  exists.
- A workout shown "as of today" follows the saved equipment from the next read. A session already
  open in the logging sheet keeps the workout it was opened with.
- The four strength tables, `User.weightUnit` and the memo `strength.state` are added by tasks E14-5
  and E14-6, each classified as state in `server/dataVersion.ts` in its own PR.
- Every dose is grade D, apart from the 2-4% planning figure (grade A) and the 200-contact cap of
  the jump ladder (grade A). A change to a dose is a change through the research update process, a
  `PARAMS_VERSION` bump and a test; a replay over synthetic histories records how many sessions a
  light first load takes to reach the heavy range.
- The first loads are guesses. `f8.startFractionBodyweight` is light on purpose, and a real log will
  show where it is too cautious or too bold.
- Copy states that no study in runners or novices compares ways of choosing the next load (one synthesis in resistance-trained lifters found effort-based and percentage-based prescription similar), that the benefit is a small
  lowering of the oxygen cost of running that says nothing about race time, and that no injury
  figure is given (G5).
- F7 to F9 have titles in `web/components/ruleTitles.ts` and are policy-only entries in
  `POLICY_ONLY_RULES` until task E14-6 gives each an explanation builder (F7 over the block position,
  the template and the equipment; F8 over the sets of the exercise; F9 over the readiness read, the
  week's flags and the gap); the coverage test then forces the move.
- The 24 rows added to the numeric table, the twelve gaps S1 to S12 and the amended rules in
  `research/engine-rules.md` record what the evidence does and does not support.
