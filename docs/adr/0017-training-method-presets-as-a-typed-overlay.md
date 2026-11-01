# 0017. Training-method presets as a typed overlay

Status: Proposed 2026-10-31

Builds on ADR 0005, ADR 0007 and ADR 0013. Adds the resolver of rules P1 to P4 and the two `Param`s of
P2 and P4 (`research/engine-rules.md`, section (p)). The reasoning is section 4 of
`docs/superpowers/specs/2026-10-31-sources-methods-evaluation-proposal.md`; decisions 5, 6 and 8 of its
section 7 were answered on 2026-10-31. This is task M2; the form, the Why drawer and the copy (M4), the
matrix and chains at every preset (M5) and the change action (M6) follow.

## Context

A plan has four options a runner chooses: `recoveryCycle`, `tidModel`, `strengthSessions` and
`loadAppetite`. Published training methods differ in four other structural values: the run-day cap
(F5), the long run's share of the week (design-macro), the length of the build phase (E2) and the
table of quality kinds by phase (F2). In the engine these were constants, read at nine places in five
files (`macro.ts`, `micro.ts`, `goal.ts`, `postRace.ts`, `explainInputs.ts`).

Decisions answered on 2026-10-31 build a methods layer, as a typed preset overlay, with at most four
presets including the default (decision 5), P2 for goals from 5 km to the half marathon and P3 not
offered (decision 6), and a change action in place later (decision 8). The evidence does not support a
better method. No study compares the plans these methods describe, and none shows that matching a
method to a characteristic of the runner gives better races (`research/topics/training-methods.md`,
section (p) of `engine-rules.md`). A preset is therefore a choice, and the default plan must not move:
the history oracle pins it.

## Decision

A method preset is a named choice, made when a plan is generated, among four values. It overrides no
guard, no ceiling and no option.

- **The type.** `PresetId` is `default`, `three-run-days` (rule P2) or `longer-base` (rule P4). The id
  of rule P3, `shorter-long-run`, is not a member. `EngineInput.options.method` holds it and, absent,
  means `default`. It is stored in `Plan.options` (JSON), so there is no migration, and `generateBody`
  and `parsePlanOptions` validate it: an unknown id is a 400 with the path `options.method`, and a
  stored value that is not a preset is dropped, which reads as the default.
- **What a preset may vary** (a test asserts these bounds over the static record, and nothing clamps
  at run time):

  | Value                                                    | Rule | A preset may                  | Bound                                    |
  | -------------------------------------------------------- | ---- | ----------------------------- | ---------------------------------------- |
  | `f5.mastersMaxRunDays` (run-day cap)                     | F5   | lower                         | 3 to 6; novices keep 3                   |
  | `macroDesign.longRunShareOfWeek`                         | -    | lower                         | 0.30 to 0.35                             |
  | `macroDesign.buildWeeks`                                 | E2   | shorten, lengthening the base | 4 to 6                                   |
  | table of quality kinds (`QUALITY_BY_PRESET`, `micro.ts`) | F2   | choose another table          | existing kinds; taper and race rows kept |

  `three-run-days` sets the run-day cap to 3 (`p2.runDays`). `longer-base` sets the build length to 4
  (`p4.buildWeeks`) and uses a table with strides only in the base and threshold, then hills, in the
  build (section (p) records the order of the build row, decided 2026-10-31 in task M5). No
  preset lowers the long-run share (P3 is not offered), so that id has readers and no override. Every
  other rule and `Param` is never overridable.

- **The record.** `PRESET_OVERRIDES` (`params/p-methods.ts`) maps each preset to what it overrides and
  admits only the four ids. Each numeric override is a grade D `Param` with a default note, under rule
  P2 or P4. The table of quality kinds holds kinds, not numbers, so it is a code table in `micro.ts`,
  flagged in the record by `qualityByPhase`.
- **The resolver.** `resolveMethod(input, state, weeks?)` (`methods.ts`) gives a `MethodPosition`: the
  preset requested, the one that applies and a reason. `effective(method, id)` gives the value of one
  overridable id under the preset that applies. The readers take the preset as `tidFor` takes
  `polarized`; `P` is never swapped. The five files call `effective` where they read `P.<id>.value`;
  `checklist.ts` reads none of the four ids. A test scans the source for a direct read.
- **When a preset reads as the default**, in this order, with the reason: the goal class is not one
  the preset names (`not-applicable`; P2 names 5 km, 10 km and half-marathon goals), a persistent hold
  of the load setting applies (`held:recent-injury`, `held:bone-stress`, `held:bsi-factors`,
  `held:reds-hold`, `held:bone-pain`), the preset only lowers the run-day cap and the runner is a
  novice who already runs the novice days (`novice`), or the plan has no base week to lengthen
  (`no-base`). The transient holds of the load setting (`rest-window`, `post-race`) do not hold a
  preset: they open and close between weekly re-plans, and a preset that followed them would switch
  run days in the middle of a plan (follow-up 27, #570). The E6 start paths plan their own weeks first.
  `holds.ts` holds the persistent conditions, which `loadSetting.ts` read inline, so `methods.ts`
  imports no post-race code.
- **On the plan.** `PlanWithSessions.method` serves `{ requested, effective, reason }`, worked out on
  read from the plan's goal, options and stored weeks and the runner's state, as `load` is. A preset
  that does not apply is stored as chosen and served as the default with its reason. Every re-plan and
  a goal switch read the stored options, so the preset follows the plan; no revision is written for
  it. A change in place is M6.
- **No more load than the default.** A preset that applies is generated beside the default plan of
  the same input (`generate` runs both, and the default run draws its phases anew, so it does not
  inherit the preset's). Each week of the preset is held to the default's target (the long run and
  the climbing shrink with it) and to the minutes the default places in that week (the long run
  keeps its length and the other runs share what is left). No week target, no week's planned
  minutes and no peak week of a preset's plan is above the default's, which makes the claim of rule
  P4, that the preset keeps the weekly minutes, true as a limit: a week may be lower. The cost is a
  second generation for a plan whose preset applies; a default plan runs once and is unchanged.
- **The run-day cap, at any age and after a race.** `three-run-days` caps the run days of every
  runner, where the cap of the default is the masters' (`micro.ts`), and of the weeks after a past
  race, which take their run days from the reference week (`windowWeeks`, `runDayCap`).
- **Grade D throughout.** Every preset is "a choice, not a better plan". It moves no ceiling and no
  ramp and adds no load (G6), and sets none of `recoveryCycle`, `tidModel`, `strengthSessions` and
  `loadAppetite`.

Reasons:

- **Fact:** The four values were read at nine places in five files at `916e0406` (`git grep` for
  `P.f5.mastersMaxRunDays`, `P.macroDesign.buildWeeks`, `P.macroDesign.longRunShareOfWeek` and
  `QUALITY_BY_PHASE[`, 2026-10-31); `checklist.ts` reads none.
- **Fact:** With `options.method` set to `default`, the 142 digests of the history oracle and the two
  weekly re-plan chains are unchanged (`history-oracle.test.ts`, run 2026-10-31). `PlanDraft.checklist`
  is part of each digest, so a new checklist item would move all 142; none is added.
- **Fact:** On the twelve matrix athletes (`methods.test.ts`, 2026-10-31), `three-run-days` applies to
  three (half, returning, post-marathon-short-run) and reads as the default for nine (seven goals of a
  marathon or longer, one novice, one held by a recent injury). `longer-base` applies to eight
  (first-100-mile, half, hot-race, marathon, masters, returning, sparse-100-mile, trail-50k) and
  reads as the default for four (the novice 5 km plan with no base week, `post-marathon-short-run`
  whose ladder of 11 weeks covers its base, and the two held plans; before the start-path weeks kept
  the default's phase it applied to nine, task M5, 2026-10-31). Both presets fail no checklist item
  that the default plan passes, and `three-run-days` holds every week to three run days where it
  applies.
- **Fact:** The default plan places short of its target where a session cannot hold its share (a
  threshold session in the build), and `generate` reads the minutes placed for the weekly ramp
  (`index.ts`, read 2026-10-31). With the hold disabled, a throwaway probe over
  `sweepCases(20261025, 150)` on 2026-10-31 found `longer-base` planning a higher week target in 36 of
  the 150 first plans (372 weeks, up to 16 minutes above the default's), more minutes in a week in 47
  plans (429 weeks) and a higher peak week in 11 plans (up to 5.3%), and `three-run-days` none of the
  three. With the hold, none of the three for either preset: `methods.test.ts` asserts it over the
  150, over the 72 runners of the oracle, over the weekly chains of the twelve matrix athletes
  (249 steps, each preset's chain against the default's) and at every step of the default chains.
- **Fact:** With the hold disabled, on the 72 runners of the oracle, `longer-base` planned more minutes
  in a week in 12 plans and a higher week target in 8 (the same probe), so at least four plans plan
  more minutes with no week target above the default's.
- **Fact:** A `Param` value is a number, a list of numbers or a record of numbers
  (`params.test.ts`, "has finite numeric values"), so the table of quality kinds cannot be one.
- **Fact:** `CYCLE_REASON_WORDS` in `explainInputs.ts` is a module-level snapshot built from the
  `Param`s when the module loads (read 2026-10-31), so a global swap of `P` during a build would leave
  it stale.
- **Fact:** `holdOf` in `loadSetting.ts` listed the five persistent holds before the two transient
  ones, and imports `postRace.ts`, which imports `goal.ts` (read 2026-10-31). A resolver that imported
  `holdOf` would put `goal.ts` and `postRace.ts` in an import cycle.
- **Rule:** ADR 0005 and `CLAUDE.md`: every number in `shared/engine/` is a `Param` with a grade, a rule
  id and cited paper ids that exist, a grade D value carries a note that says it is a default, and a
  language model never chooses a session. Section (p) of `research/engine-rules.md` writes P1 to P4
  and the constraints this record follows.
- **Rule:** G6 in `research/engine-rules.md`: rules never move toward more load when the evidence is
  weak, so a preset may lower a value and never raise one, and a test checks the bounds.
- **Rule:** `CLAUDE.md`, Testing: a migration adds a case to `migrations.test.ts`. No schema changes
  here (`Plan.options` is JSON), so there is none.
- **Rule:** Decisions 5, 6 and 8 of section 7 of the proposal, answered 2026-10-31: option B, at most
  four presets with the default, P1, P2 for 5 km to the half marathon and P4, P3 out, and a change
  action in place in M6.
- **Opinion:** A static record of `Param`s, with the readers passing the preset, keeps every guard, ramp
  and hold in one generator and puts what a method changes in one file the heading check and
  `research:check` already read. A reader that forgets the resolver reads the default, which is the safe
  failure.
- **Opinion:** Asserting the bounds over the static record in a test, and not clamping at run time,
  keeps a wrong table visible in `npm run check`; a clamp would hide it in a plan.
- **Opinion:** Reading a preset as the default under a persistent hold is the conservative course (G6):
  an injured runner gets the plan the load setting already holds at steady.
- **Opinion:** Deriving `PlanWithSessions.method` on read, as `load` is, keeps a goal switch, a profile
  change and a new injury visible at once, and stores nothing that could go stale.
- **Opinion:** Against this decision: the long-run-share id has three readers and no preset, so that
  seam is unused until a preset needs it; the cost is a default argument at each reader. The three-run
  cap lowers the cap that applies to every non-novice runner in `macro.ts` but only masters in
  `micro.ts` (the existing structure), so the Why text must name the cap and not the age.
- **Preference:** `options.method` beside the other options, over a top-level request field, follows the
  pattern of `loadAppetite` and `tidModel`. No constraint forces it.

Alternatives:

- **A. Relabel the existing options as styles** (proposal 4.3, option A). For (**Opinion**): no new
  code. Against (**Fact**): `tidModel` and `recoveryCycle` set neither run days, nor the long-run
  share, nor the build length, nor quality kinds (read 2026-10-31), so a label would change no plan.
- **C. A generator per method.** For (**Opinion**): each method could be written as it is published.
  Against (**Opinion**): every generator repeats the guards, ramps, holds, start paths and post-race
  windows that `macro.ts` and `micro.ts` (about 2,900 lines) apply, and the oracle pins one generator
  only. Against (**Rule**): G6 puts the more conservative rule first, which a copy of each guard per
  method cannot promise.
- **A global swap of `P` while a plan is built.** For (**Opinion**): no reader changes. Against
  (**Fact**): the snapshot above reads stale. Against (**Opinion**): a swap that a thrown error left
  unrestored would leave a preset's value in `P` for the next plan, and every later plan would carry
  it without a request asking.
- **Clamp the values at run time.** For (**Opinion**): a bad table cannot produce a plan outside the
  bounds. Against (**Opinion**): a clamp makes a wrong table look right, and the bounds belong where
  the table is reviewed.
- **A preset that changes the long-run share (P3).** Against (**Fact**): it moves the long run
  further below the D3 floor of 25 km for the marathon (grade B), from 115 to 99 minutes (about 19
  km) on the matrix marathon plan (proposal 4.6). Against (**Rule**): decision 6 puts P3 out.
- **A checklist item for the run-day cap.** For (**Opinion**): the cap would be checked at publish.
  Against (**Fact**): the item would change `PlanDraft.checklist` and so every oracle digest. Against
  (**Opinion**): a re-plan keeps the sessions already run, so a week with four finished runs would
  fail an item for three, and a failed item blocks publishing. The cap is asserted in
  `methods.test.ts` instead.
- **Hold the week targets only.** For (**Opinion**): one line at the ramp, and the placement is
  untouched. Against (**Fact**): on the 72 oracle runners the minutes planned in a week rose in four
  more plans than the targets did (above), so a hold on targets leaves them.
- **Hold a preset under the transient holds as well.** Against (**Fact**): follow-up 27 (#570) names the
  mechanism, run days switching in the middle of a plan as a window opens and closes.

## Consequences

- No plan changes for a runner who asks for nothing. `PARAMS_VERSION` is `2026-10-31.1`;
  `npm run plan:report` differs from the report before it in the version line only.
- Rules P1 to P4 are policy-only in Explain (`POLICY_ONLY_RULES`) and have titles. The form, the fit
  notes, the Why drawer rows (each override against the default, the grade, the reason a preset reads
  as the default) and the copy are M4; the page does not show `method` yet.
- M6 adds the change in place through `computeReplan` with the current week held. A preset that is
  held or inapplicable changes run days when the hold starts or ends; M6 guards a run-day switch in
  the middle of a plan as the transient holds are guarded.
- Whether P2 reaches marathon goals, with a weekly-minutes cap or a cross-training session kind, is
  undecided (decision 6). It needs a new grade D `Param` on the whitelist and an applicability change
  in `methods.ts`.
- The build row of `longer-base` holds threshold first and hills second (decided 2026-10-31, task M5,
  section (p)): a build week with one quality session (a goal of 100 km or more, a week with few open
  days) keeps the default's threshold, and hills take the second session. With hills first those weeks
  held hills alone.
- A week of a start path (a ladder, an injury-return level or the restart floor) is filed under the
  phase the default files it under, whatever the preset's own draw of the phases says (decided
  2026-10-31, task M5, section (p)). A plan whose only base weeks are start-path weeks reads the
  default with the reason `no-base`; of the twelve matrix athletes that is `post-marathon-short-run`.
- A preset's week target is the default's where the default places short, and the minutes it places
  are the default's: a preset plan can read a week below its own drawn target, as the default does in
  those weeks. Four runners of the sweep (#16, #28, #36 and #48) fail the checklist's spacing item at
  the default (the long run between two quality days in the first week of a plan that starts on a
  Saturday; #48 at steady and standard only, the others at all three positions of the load setting;
  `history-sweep.test.ts` pins the list), so `methods.test.ts` compares a preset with the failures of
  the default plan and not with none; the item is not a preset's.
- A new overridable value needs an id in `OVERRIDE_IDS`, a reader that calls `effective`, a bound in
  `methods.test.ts`, a `Param` under its rule and the section (p) text; the source scan fails on a
  direct read.
