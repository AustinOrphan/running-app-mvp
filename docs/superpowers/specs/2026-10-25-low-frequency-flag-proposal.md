# The A5 low-frequency flag — proposal

Status: Proposed 2026-10-25. This document changes no code, no Param and no rule text. It answers
follow-up 25 of `docs/STATUS.md` and asks the questions of section 6. Baseline: `main` at
`09fc3290` (`PARAMS_VERSION` `2026-10-25.3`). Every engine claim was read in the code on that
commit. Every measurement is on the synthetic fixtures of `tests/unit/engine/history-fixtures.ts`
and `history-oracle.ts`, run from scratch scripts in the git-ignored `data/` on a copy of `shared/`
with each option built as a switch (set to the shipped reading, the copy reproduces all 142
committed oracle digests). The only figures from a real history are the two counts in STATUS.

## 1. Summary

- **At Steady the flag changes one thing: the recovery cycle goes from 3:1 to 2:1.** The
  "time-based step with a minimum" cannot bind from a start level of 60 minutes (a 1 minute minimum
  against a 10% step): with the cycle fixed at 3:1, flagged and unflagged plans are identical on
  both fixtures tested (a new plan and a re-plan). At Standard and Upper band the flag also holds
  the position at steady, which switches off the zone, the response and the 3 × 30 lift.
- **Shape (a) is a race between two ramps.** The test applies once the start level reaches 60
  minutes and needs 8 runs in the last 28 days. A runner who rebuilds at 3 runs a week, with minutes
  that climb faster than the run count, passes 60 minutes at 7 runs and is flagged for one re-plan.
  That re-plan is 27% below the next one over 14 weeks and 39% below the plan the same input gives
  with no flag, and the chain stays 5 to 18% below for six more re-plans.
- **The hold is the smaller part of that cost:** about 80% of the 14-week gap is the 2:1 cycle at
  Steady, 20% the hold. A narrower effect (option 4) therefore repairs little of (a).
- **Shape (b) cannot be told apart from a real low frequency** with the data in the repository: on
  a replayed real history the flag held the position on 30 of 53 Mondays. Changing that is a
  decision of the owner (question 2); the corpus gives no reason either way above grade D.
- **A third shape (c) is new:** the re-plan on which the flag ends plans a recovery week, a loading
  week at the same minutes and a second recovery week. Cause untraced (section 2.3).
- **Recommendation:** for a continued plan, read the flag at the plan's first Monday and let it end
  but never begin there (option 2). No new Param, no evidence claim, 0 of 142 oracle plans move.
  Trace (c) first; keep the hold (question 2).

## 2. What the engine does now

### 2.1 The test

`lowFrequencyOf(runs, today, startLevel)` in `shared/engine/athlete.ts`, called from
`estimateState` with `startLevel = Math.max(typicalWeekMin, recentWeekMin)` (`startLevelMin`,
`limits.ts`):

- False when the start level is under `restartFloor.sessions × restartFloor.sessionMin` (3 × 20 = 60
  minutes): those runners have a start path (E6). The test applies from 60 minutes up.
- Otherwise true when `runs.length / a5.lowFrequencyWindowWeeks < a5.lowFrequencyRunsPerWeek`: fewer
  than 8 activities of type `run` or `race` in the 28 days ending today, duplicates and later days
  excluded (`countedActivities`; `athlete.test.ts` pins 8 runs as not low and 7 as low).
- It counts activities, not days (70 minutes split in two files is two runs), counts a race (the
  history block's `runSessions` does not), and uses a rolling 28 days, not four Monday weeks.
- Both Params are grade D, evidence `abrahamson-2025-self-reported-characteristics`: 2 runs a week
  ("a design default") and 4 weeks. Rule A5 (`research/engine-rules.md`) says the same.

### 2.2 What it switches

| Reader                                                          | Effect                                                                                                                          | At Steady        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `cycleShortReason`, `cycleWorkWeeks` (`macro.ts`), `planPhases` | 2 work weeks per cycle (`e3.flaggedCycleWorkWeeks`); `keepCadenceAcrossReplan`                                                  | yes              |
| `recoveryCadence` (`checklist.ts`)                              | the E3 checklist item expects the 2:1 cycle                                                                                     | yes              |
| `noviceRamp` → `rampStep`, `rebuildStep`, `responseBaseline`    | minimum step `g2.noviceMinStepMin` (1 minute)                                                                                   | yes, never binds |
| `holdOf` (`loadSetting.ts`), the last of eight reasons          | position read as steady: `rebuildZone`, `responseBasis` null, `blockLift` false                                                 | no               |
| `loadHoldReason` (`shared/copy/load.ts`)                        | Load panel: "recent weeks held fewer than two runs a week"                                                                      | no               |
| `explainInputs.ts`                                              | Why drawer: `explain.g3-low`, which says the plan treats the runner as new "for the ramp and the recovery cycle"; the E3 reason | yes (text)       |

Nothing in `server/` or `web/` branches on `lowFrequency` (the state view only carries it); they
read `LoadPosition.held`. G-1, the 30% ceiling, the other hold reasons and the response bounds are
not frequency-aware and the flag does not touch them. The `explain.g3-low` claim about the ramp is
without effect from 60 minutes.

### 2.3 Measured behaviour

**(a) The H3 chain** (`history-rebuild.test.ts`, "H3 inside a chain": `replanChain(at(h1(),
'standard'), { scale: 1.6, maxSteps: 4 })`, every week run at 1.6 times its plan). The test pins
`held = [null, null, 'low-frequency', null, null]`.

| Re-plan Monday | Runs in 28 days | Start level | Flag                 | Position |
| -------------- | --------------- | ----------- | -------------------- | -------- |
| 2026-10-26     | 5 (1.25 a week) | 48          | no (below the floor) | Standard |
| 2026-11-02     | 7 (1.75)        | 62          | yes                  | Steady   |
| 2026-11-09     | 9 (2.25)        | 120         | no                   | Standard |

Run exactly as planned (scale 1) the flag never arms in ten re-plans: the level reaches 75 with 9
runs. Minutes planned for the 14 weeks from 2026-11-02: the held re-plan 1,474; the next re-plan
2,033 (the held one is 27.5% below; 24% over 8 weeks, 719 against 942); the same input with the
flag off 2,404 (38.7% below; 33.5% over 8 weeks, 719 against 1,081). At Steady the same input
gives 1,474 flagged and 2,220 unflagged (34% below): the cycle alone is 746 of the 930 minutes, the
hold 184. The effect outlasts the flag: the eight-week sums of the next six re-plans are 17.5, 5.4,
5.4, 14.7, 15.3 and 12.5% below the chain with no flag.

**Lag.** `h10` (a block, then one 70 minute run a week for seven weeks), run as planned at 3 runs a
week, is flagged at the new plan and the next two weekly re-plans (3, 5 and 7 runs in the window)
although the plan has scheduled 3 runs a week from the first Monday; it ends at the third (9 runs).

**(b) Real history.** The owner replay (outside the repository) held the position at Steady on 30
of the 53 Mondays (STATUS). Whether each replayed Monday was a new plan or a re-plan is not
stated; options 2 and 3 do not touch a new plan.

**(c) The release.** Where the flag ends, the re-plan changes the cycle and plans (minutes by week,
`r` a recovery week): `h10` at Steady 82, 61r, 61, 45r, 67 where the unflagged chain plans 75, 82,
90, 67r, 99; the H3 chain 123, 92r, 112, 84r, 125. The 8-week sums are 18 to 27% below the
unflagged chain at that re-plan, and 20% below the flagged plan before it (`h10`, Steady). Of the
three releases printed week by week, the third (`h10` at Steady, delayed by hysteresis) does not
show it. The cause is not traced (`keepCadenceAcrossReplan` is the candidate); the pattern appears
at Steady too.

**The edge** (synthetic weekly patterns with a start level of 70 to 90 minutes; `today` swept over
56 or 63 days at Standard; the base pattern is two 35 minute runs, Tuesday and Wednesday):

| Shape                                         | Days flagged | Reason                                            |
| --------------------------------------------- | ------------ | ------------------------------------------------- |
| two runs every week                           | 0 of 56      | 8 runs on every day                               |
| the same, one run missed                      | 28 of 56     | 7 runs for the 28 days after it (4 Mondays)       |
| alternating 1 and 3 runs                      | 0 of 56      | 28 days hold two whole cycles                     |
| alternating, one 3-run week became 1          | 25 of 56     | 7 runs                                            |
| cycle of 3, 2, 1 runs (two a week on average) | 15 of 63     | 28 days never align with 3 weeks (3 of 9 Mondays) |

A pattern that repeats at 2.0 and divides 28 days is never flagged, one that does not divide it is
flagged on some days, and one missed run flags four weeks. Over the steady oracle the flag arms for
24 of 72 new-plan runners (mostly sweep runners built as a block followed by sparse weeks, so not a
rate for real runners) and for none of its 70 chain plans.

## 3. What the evidence says

From `research/papers/`, `research/topics/injury-load.md` and `beginners-return.md`.

| Paper (grade)                                                          | What it measured                                                                                | Bearing on frequency                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `abrahamson-2025-self-reported-characteristics` (B)                    | 7,391 watch-tracking runners, 18 months, self-reported baseline frequency, injuries at 1,000 km | under 2 runs a week: more new injuries; 7 a week: fewest; exposure may confound              |
| `kluitenberg-2016-nlstart2run-training-factors` (B)                    | 1,696 novices, 6 weeks, weekly diaries                                                          | frequency not significant; trend to 3 a week riskier than 2                                  |
| `pollock-1977-frequency-duration-injury` (C)                           | RCT, 157 young men jogging hard, 20 weeks                                                       | injury 0%, 12%, 39% at 1, 3, 5 days a week; direction only                                   |
| `mckean-2006-masters-injury` (C)                                       | 2,886 relay runners, one-year recall                                                            | more runs a week, more injury, both age groups; exposure confounds                           |
| `fredette-2022-training-parameters-injury-review` (A)                  | 36 prospective studies, 23,047 runners                                                          | association of frequency with injury is conflicting                                          |
| `nielsen-2012-training-errors` (C)                                     | systematic review                                                                               | conflicting; no frequency threshold established                                              |
| `damsted-2018-training-load-change` (B)                                | 4 studies                                                                                       | a recent change in velocity, distance or frequency (pooled) went with injury; "very limited" |
| `sewry-2022-safer-xxi-dnf` (B)                                         | 23,996 starters of one 56 km race                                                               | less training per week: a univariate DNF factor (race readiness, not injury)                 |
| `hickson-1981-reduced-frequency` (C), `spiering-2021-minimal-dose` (D) | 12 young adults; a narrative review                                                             | 2 sessions a week at kept intensity held VO2max for 15 weeks                                 |

The corpus supports one thing: below 2 runs a week is associated with more injury in one large
cohort (grade B, observational). The Params are grade D because the cut-off and the 4-week logged
window are design defaults. It does not support the rest. No study tests the cut-off, the logged
window, or a runner who ran regularly and now runs less (the trigger from 60 minutes). Nothing
compares 2:1 with 3:1 (rule E3 is grade D, `kiely-2018-periodization-critique`) or shows that the
cycle or the hold lowers injury. In novices (non-significant) and in relay runners more runs a week
went with more injury, the reverse of the cohort. As a readiness marker, frequency is linked to race
completion (`sewry-2022-safer-xxi-dnf`), while fitness was kept on 2 sessions a week at kept
intensity (`hickson-1981-reduced-frequency`). A change toward more load needs stronger evidence than
one toward less (`research-update`). No candidate paper is named: four Crossref searches and one
web search on 2026-10-25 found no study that holds weekly volume fixed and varies run frequency
against injury, and no DOI is invented. None is needed for option 2; one would be for moving the
cut-off.

## 4. Options

Measured on the fixtures with prototypes in the scratch copy. "Held re-plan" is the H3 chain's
re-plan of 2026-11-02, first 8 weeks, minutes; "lag" is the `h10` chain, the plans flagged
(the new plan and re-plans).

| Reading of the flag                              | H3 chain flag    | Held re-plan | Lag: flagged | Oracle plans changed (of 142) |
| ------------------------------------------------ | ---------------- | ------------ | ------------ | ----------------------------- |
| shipped                                          | armed, re-plan 2 | 719          | 3            | 0                             |
| no flag (reference)                              | never            | 1,081        | 0            | 24                            |
| 1 hysteresis, gate in the condition, N=2 M=2     | never            | 1,081        | 3            | 5                             |
| 1 the same, N=4 M=2 / N=4 M=4                    | never            | 1,081        | 3 / 5        | 15 / 19                       |
| 1 hysteresis on frequency alone, N=2 / N=4 (M=2) | armed, re-plan 2 | 719          | 3            | 0 / 7                         |
| 2 first-Monday reading, with or without latch    | never            | 1,081        | 3            | 0                             |
| 3 planned runs for the weeks a plan covers       | never            | 1,081        | 2            | 0                             |
| 4 flag kept, hold removed                        | armed, not held  | 770          | 3            | 0                             |

**1. Hysteresis.** Arm after N weekly readings under the threshold, disarm after M at or above,
replayed from the 365 days (no stored state). Params: `a5.lowFrequencyArmWeeks` and
`a5.lowFrequencyDisarmWeeks`, grade D (the cohort gives a risk marker, not a time course). It stops
(a) only with the floor gate inside the condition, since the chain runner was under 2 runs a week
throughout. It changes new plans (5, 15 or 19 of 72), so the baseline moves. For (b) the Mondays in
the first N weeks of each episode drop out (a count for the owner replay). A longer M lengthens the
lag (5 plans). Against: two Params with no evidence, a 2:1 cycle delayed by N weeks for a truly
low-frequency runner (toward more load), and a new baseline.

**2. A reading a re-plan chain cannot flap on.** A continued plan (`continuedSince`,
`loadSetting.ts`: the stored plan holds the current week and the break is under `j7.tier1Days`)
reads the flag at its first Monday, as `creditedBlock` reads the block (g-8, L3d). Armed there, the
flag ends at the first weekly reading where the test fails and does not return in that plan (the
latch); unarmed there, it never begins. A new plan, a plan after a break and a plan out of reach of
the 365 days read today. Params: none; the notes of the two `a5.lowFrequency*` Params and the A5,
G-3 and g-8 texts gain a sentence; grade D stays. At Steady 0 of 142 oracle plans change (a new
plan reads as today); a Steady re-plan that arms mid-plan would change, which is a change at Steady
for question 1, and no oracle chain plan does. (a): removed (1,081, flag false at all five
re-plans). Lag and (b) on a new plan: unchanged. In a plan opened flagged (`h10`, released at the
fourth Monday), four later weeks of one 75 minute run flag the shipped rule at three Mondays and
the latch at none. Against: a continued plan no longer notices a runner who drops to one run a
week mid-plan (G-2 and G-6 lower the plan after weeks under target and J7 handles a break, but the
2:1 cycle waits for the next plan); it moves a case toward more load; `athleteState.ts` builds the
memoised state with `existing: null` ("the same for every reader"), so the reading belongs beside
`loadPosition` or in the plan paths, and every reader must agree (an M task).

**3. Planned runs instead of runs logged**, for the days the stored plan covers. Params: none. At
Steady as option 2 (0 of 142). (a): removed. Lag: ends one plan earlier (2 flagged; the 8-week
sum at re-plan 2 is 739 against 658). Against: a plan asks for at least `f5.noviceRunDays` (3) run
days a week (availability can place fewer), so for covered days the test is vacuous and the flag
can arm only from the days before the plan. It reads the engine's intent, not the runner (a
skipped session must be excluded, and then it is the logged count again), and the cohort measured
runs done.

**4. Narrower effect: keep the cycle, drop the hold.** Done in #NNN (decided 2026-10-25). Delete the `low-frequency` line of `holdOf`.
Params: none; g-8, the zone paragraph, ADR 0013 and proposal 4.3 are amended. At Steady no change
by construction (`holdOf` runs only when a position other than steady is requested): 0 of 142.
(a): the re-plan plans 770 instead of 719 (1,081 unflagged), recovering 14% of the 8-week gap and
20% of the 14-week gap. (b): the zone, response and lift may act on those 30 Mondays, within the
ceiling, G-1 and the other holds. For: the block the zone is credited from already needs 2 runs in
each of 4 weeks, and the zone was built for "a strong block, sparse weeks since" (H1), which the
flag excludes once the start level passes 60 (H10). Against: it moves the group the cohort marks
as higher risk toward more load on grade D alone, and ADR 0013 lists low running frequency among
the reasons to hold.

**5. Leave it.** No change, baseline intact, evidence-aligned (conservative). Cost: shape (a) on any
rebuild whose minutes pass 60 before its run count reaches 8, one re-plan 24 to 39% lower and a
chain 5 to 18% lower for six more; shape (c) on every release; four weeks for one missed run; and
no effect of the setting on the Mondays it is held (the Load panel says why).

## 5. Recommendation

Option 2 with the latch, and the trace of (c) first. It removes (a) without a Param, a threshold or
an evidence claim, leaves every new plan and the oracle byte for byte, and follows a precedent (the
plan's own block). Hysteresis costs two ungraded Params and moves the baseline; planned runs is
option 2 with the plan's intent in place of the runner; narrowing recovers a fifth of (a).
Arguments against: (i) it leaves the lag, the edge inside a plan that opened flagged, and (b);
(ii) a mid-plan drop to one run a week is no longer flagged (question 3); (iii) it moves toward more
load, with grade D on both sides; (iv) a plan-aware reading is harder to explain than "the last 28
days" and is an M task; (v) if (c) is a defect of the cadence switch, a real release still dips, so
the trace may be worth more than the option.

## 6. Decisions for the owner

1. **Fix shape (a)?** Default: yes, by option 2. Alternatives: hysteresis (moves the baseline), or
   leave it.
2. **Keep the hold for low-frequency runners at Standard and Upper band (shape b)?** Default: keep.
   It moves a group the cohort marks as higher risk toward more load with no evidence above D. The
   alternative (option 4) is one small task; decide after the owner replay with option 2 built shows
   how many of the 30 Mondays are artifacts of re-planning.
3. **Latch: may a continued plan never begin the flag?** Default: yes (the flag describes how the
   plan opened, and G-2, G-6 and J7 cover a drop). Alternative: no latch, so a plan opened flagged
   can re-arm.
4. **Trace shape (c) as its own follow-up (27) before any option is built?** Default: yes.
5. **Reword `explain.g3-low` to the recovery cycle only?** Default: yes.

## 7. Task list

Each task starts from `origin/main` in its own worktree, test first. Sizes S and M.

### Task F25a: Trace the release re-plan

Size S. Depends on: question 4. Files: `shared/engine/macro.ts` (`planPhases`,
`keepCadenceAcrossReplan`), a new case in `tests/unit/engine/replan-chain.test.ts`.

- **Acceptance:** the cause of 82, 61r, 61, 45r (the `h10` chain at Steady, third re-plan) is named
  with the line that produces it; STATUS records it as follow-up 27; a fix is a separate task.
- **Tests:** a case that fails on the current engine if the cause is a defect, else documents it.

### Task F25b: The first-Monday reading

Size M. Depends on: questions 1 and 3; F25a first (same cadence code). Files:
`shared/engine/loadSetting.ts` (a reading beside `continuedSince`), `athlete.ts`, `limits.ts`
(`noviceRamp`), `macro.ts`, `checklist.ts`, `explainInputs.ts`, `server/services/planEngine.ts` and
`replan.ts` where they build the state.

- **Acceptance:** a new plan, a plan after a break and a plan out of reach read today; a continued
  plan arms only if armed at its first Monday, ends at the first failing weekly reading and does not
  return; `noviceRamp`, `holdOf`, `cycleShortReason`, the checklist and the Why drawer agree for one
  input; the H3 chain holds `[null, null, null, null, null]` and its re-plan equals the unflagged
  one; all 142 oracle digests unchanged.
- **Tests:** the H3 case rewritten; the latch case (`h10`, four one-run weeks); a break; a plan
  older than 365 days; an agreement test over the readers; `history-oracle.test.ts` unchanged.

### Task F25c: Rule text and Params (research-update)

Size S. Depends on: F25b. Skill: `research-update`. Files: `research/engine-rules.md` (A5, G-3, g-8
load setting and zone, table row), `research/topics/injury-load.md` (row
`injury-low-frequency-conservative`), notes of `a5.lowFrequencyRunsPerWeek` and
`a5.lowFrequencyWindowWeeks`, `PARAMS_VERSION`.

- **Acceptance:** the text says that a continued plan reads the flag at its first Monday; no value,
  grade or paper changes; `npm run research:check` and `npm run check` pass.

### Task F25d: Why drawer sentence

Size S. Depends on: question 5. Files: `shared/copy/explainTemplates.ts` (`explain.g3-low`),
`tests/unit/engine/explainInputs.test.ts`. Acceptance: the sentence names the recovery cycle only;
the copy lint passes.

### Task F25e: Validation

Size S. Depends on: F25b. Take a baseline with the owner validation (`data/validate-owner.ts`,
outside the repository) on the commit before the change, then after: 39 weeks, 210 sessions, 0 of
15 checklist failures, sessions identical apart from `externalId` (steady byte for byte). Rerun the
53-Monday replay and quote counts only.

If question 2 is answered "drop the hold" (done in #NNN): one S task in `holdOf`, `LoadHold`,
`load.hold.low-frequency` (`copyLoad.test.ts`), g-8, ADR 0013 "Amended", the H10 cases in
`start-paths.test.ts` and `history-rebuild.test.ts`; no new steady baseline. If hysteresis is
chosen: an M task (two Params, a replayed reading in `athlete.ts`, a research-update, and a new
steady baseline taken on the commit before the change).
