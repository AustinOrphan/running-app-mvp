// The oracle for "steady is today's engine byte for byte" [rules g-8, proposal section 5.1]: a short
// digest of the plan the engine built at steady for a set of runners, taken from the engine as it
// stood before the rebuild zone (82240355, the history block and the lift without the zone). The
// test compares the plans of this checkout with those digests, at steady and with the option absent.
// The chains with every week run above its plan (`OVERSHOT_CHAINS`, rule G-2: at steady a week run
// above its plan lifts nothing) come from the engine as it stood before the response to weeks run
// above plan (8d668404, the rebuild zone without the response).
//
// The digests change only when the plans of a runner who asked for nothing change. When that is
// intended, check the owner validation first (`data/validate-owner.ts`, same output as before), then
// regenerate the file:
//
//   npx tsx -e "import('./tests/unit/engine/history-oracle.ts').then((m) =>
//     console.log(JSON.stringify(m.steadyDigests(), null, 2)))" > tests/unit/engine/history-oracle.json
//
// The digests of the re-plan chains were regenerated on 2026-10-25 for the anchored strength block
// (task E14-3, rule E5): a re-plan continues the block and no longer starts a new one, so the
// `strength-block` flag of the weeks differs from the second plan of a chain on. The plans are
// otherwise the ones the digests held (checked by comparing the chains with the flag removed).
//
// Regenerated 2026-10-25 for the D4 count of weeks available (the plan's Monday weeks, rule D4):
// in every plan only `feasibility.weeksAvailable` and the tight and not-reachable notes (their text,
// or their presence where the label moved) differ from the digests before it; the sessions, the
// weeks and the other warnings are the same.
//
// Regenerated 2026-10-31 for the ordinal of the recovery cadence item: its detail read "every 3th
// week" for a 2:1 cycle and now reads "every 3rd week". In the 26 plans that carry the 2:1 cadence
// only that text differs (checked by restoring "3th" before the digest: all 142 digests matched),
// and the owner validation is byte for byte the same.
//
// Regenerated 2026-10-31 for the race week of a re-plan (task RF1): the re-plan of the race week
// held the week to the minutes the earlier plan had placed, and that plan had lost the run on the
// day of the race to the race, so each re-plan shortened the easy runs. A week the replaced plan has
// not started is now held to its figure. Two of the 142 digests move, the last plan of the `half`
// and the `first-100-mile` chains; only the easy runs of the race week differ (27 min in place of
// 21, 20 and 20 min for the half; 48 min in place of 38 and 39 for the first 100 miles), the weeks
// are the same.
//
// Regenerated 2026-10-31 for the weeks after a window (task RF2): the weeks after a rest window were
// drawn from the minutes the window left in the week it touched, and are now drawn from the last week
// run before it (J7), a part week counting beside another week and never alone. One of the 142
// digests moves, `h13 rest window` (an illness of 5 days, 6 days off, in the first week of a plan of
// about 60 minutes): the weeks after the window plan 66, 72 and 79 minutes in place of 50, 55 and 60,
// which is the plan of the same runner with no window; the weeks before it and the other 141 digests
// are the same.
//
// Regenerated 2026-10-31 for the runs of the race week (task RF2, finding 6 of RF1): the race week
// placed a run on the race day, which the race replaces, so a share of its minutes was never run.
// Its runs go on the days before the race. 139 of the 142 digests move: 69 of the 72 runners and all
// 70 plans of the chains; the three that do not (`matrix novice-5k`, `matrix post-marathon-short-run`
// and `reds hold`) place the same race week as before. Compared with the engine before, week by
// week, only the sessions of the race week differ in the moved plans; the weeks, the warnings and
// the checklist are the same. `h13 rest window` moves a second time, for its race week.
//
// Regenerated 2026-10-31 for the spacing across the Monday (task RF2): the first quality session of a
// week no longer falls on the day after a long run that follows a quality day, so the long run is not
// between two quality days (F3) when a plan starts on a Saturday. Three of the 142 digests move,
// `sweep #16`, `sweep #28` and `sweep #36` (half marathons whose plan starts on 2026-10-24): in each
// one session differs, the threshold run of Monday 2026-10-26 is an easy run of the same minutes; the
// weeks, the warnings and the other sessions are the same.
//
// Regenerated 2026-11-01 (task RF2, review) for the cut of the recovery week after a part week: the
// recovery week was cut from the loading week before it as placed, which is the part week a window
// leaves, and is now cut from the figure that week has without the window. One of the 142 digests
// moves, `h13 rest window` (an illness of 5 days from 2026-10-22, 6 days off, under the 7 days of
// the first J7 tier, so no restart share applies): the recovery week of 2026-11-02 plans 49 minutes
// in place of 34, which is its week in the plan of the same runner with no window, with its strides
// session (24 min on 2026-11-02) and a long run of 25 minutes on 2026-11-08 in place of 20; the other
// weeks and the other 141 digests are the same. The taper cut that follows the same reading (task
// RF2, second review) and the distance of the long run in the week in progress move no digest.
//
// Regenerated 2026-11-01 for the last two days before a long race (task RF3, rule K6): the day before
// a race of 90 minutes or more holds at most `k6.dayBeforeMaxMin` minutes (20) of easy running, and
// the `k6.easyDaysBefore` days before it (2) hold easy running only. 136 of the 142 digests move: 9
// of the 12 matrix runners, 17 of the 20 named runners, all 40 of the sweep and all 70 plans of the
// chains. The six that do not are `matrix novice-5k`, `matrix prior-bsi` and `matrix
// post-marathon-short-run` (races of 33, 50 and 52 minutes), `h15 short horizon` and `h15 short
// horizon three years` (5 km, 25 minutes) and `reds hold` (its one run of the race week falls five
// days before the race). Compared with the engine before (the rule off, by raising
// `k6.carbLoadMinRaceMin` out of reach), week by week: in all 136 the weeks, the warnings and the
// checklist are the same and only the race week differs, by one session each: the run of the day
// before the race is 20 minutes where it was 21 to 48 (1 to 28 minutes shorter, 17 at the median).
// No session moves to another day, and none is added or removed. The running of the race week of the
// 136 plans falls from 23,213 to 20,940 minutes.
//
// Regenerated 2026-11-01 (task RF3, review): the paragraph above said that one session differs in each
// of the 136 plans. In 77 of them the cut run's climbing was also shared out again over the other runs
// of the race week, so those runs' climbing changed: the 4 matrix runners with climbing in the race
// week, 16 sweep runners, 17 named runners and 40 chain plans. The climbing of the cut run now goes
// with its minutes (the run keeps its share in proportion to the minutes it keeps, the rest is left
// unplaced) and the other runs keep the climbing they had. 77 of the 142 digests move against that
// regeneration and the set that differs from the engine before the rule stays 136. Compared with the
// engine before, all 136 differ in exactly one session, the run of the day before, in every field. The
// bound of a week in progress and the baseline of a window (index.ts) move no digest.
//
// The close of the load-progression plan (task L7) may remove this file with its test: from there
// the owner validation is the oracle.
import { createHash } from 'node:crypto'
import { buildPlan } from '../../../shared/engine/index.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { athletes } from './matrix-fixtures.ts'
import {
  h1,
  h10,
  h13Race,
  h13Window,
  h15,
  h26,
  h3Back,
  h4,
  h5,
  h6,
  h7,
  h7Twice,
  s4Runs,
  s5Runs,
  s3Runs,
  scenario,
} from './history-fixtures.ts'
import { sweepCases } from './history-sweep.ts'
import { replanSteps } from './replan-steps.ts'

/** The seed and size of the sweep sample that enters the oracle. */
export const ORACLE_SWEEP = { seed: 20_261_025, count: 40 } as const

/** The weekly re-plan chains of the oracle: a half marathon and a first 100 miler. */
export const ORACLE_CHAINS = ['half', 'first-100-mile'] as const

/**
 * The same two chains for their first weeks with every session run half as long again as planned:
 * at steady the weeks run above plan lift nothing, so the plans must stay what they were.
 */
export const OVERSHOT_CHAINS = [
  { id: 'half', scale: 1.5, maxSteps: 10 },
  { id: 'first-100-mile', scale: 1.5, maxSteps: 10 },
] as const

/** The name of the digest of one plan of an overshot chain. */
export const overshotKey = (chain: (typeof OVERSHOT_CHAINS)[number], i: number): string =>
  `chain ${chain.id} x${String(chain.scale)} ${String(i)}`

/**
 * A short digest of a plan. The version of the Params is left out: it is stored with every plan
 * and moves with any Param, and the oracle is about what the plan holds.
 */
export const planDigest = (plan: PlanDraft): string =>
  createHash('sha256')
    .update(JSON.stringify({ ...plan, paramsVersion: '' }))
    .digest('hex')
    .slice(0, 16)

/** The runners of the oracle, each with a name. */
export function oracleInputs(): Array<{ name: string; input: EngineInput }> {
  const named: Array<[string, EngineInput]> = [
    ['h1 one year', h1()],
    ['h1 three years', h1(3)],
    ['s4 control', scenario(s4Runs(), { years: 3 })],
    ['s5 layoff', scenario(s5Runs())],
    ['h3 back', h3Back()],
    ['h4 no gap', h4()],
    ['h5 old block', h5()],
    ['h6 one big week', h6([30, 35, 35])],
    ['h6 modest', h6([20, 20, 20])],
    ['h7 single runs', h7()],
    ['h7 twice', h7Twice()],
    ['h10 low frequency', h10()],
    ['h13 race window', h13Race()],
    ['h13 rest window', h13Window()],
    ['h15 short horizon', h15()],
    ['h15 short horizon three years', h15(12, 3)],
    ['h26 modest 60', h26(60, 2)],
    ['h26 modest 100', h26(100, 2)],
    ['age 46', scenario(s3Runs(), { profile: { birthYear: 1980 } })],
    ['reds hold', scenario(s3Runs(), { screeningFlags: 2 })],
  ]
  return [
    ...athletes().map((a) => ({ name: `matrix ${a.id}`, input: a.input })),
    ...named.map(([name, input]) => ({ name, input })),
    ...sweepCases(ORACLE_SWEEP.seed, ORACLE_SWEEP.count).map((c) => ({
      name: `sweep ${c.name}`,
      input: c.input,
    })),
  ]
}

/** The digest of the plan of every runner, then of every plan of the re-plan chains. */
export function steadyDigests(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { name, input } of oracleInputs()) out[name] = planDigest(buildPlan(input))
  for (const id of ORACLE_CHAINS) {
    replanSteps(id).forEach((step, i) => {
      out[`chain ${id} ${String(i)}`] = planDigest(step.draft)
    })
  }
  for (const chain of OVERSHOT_CHAINS) {
    replanSteps(chain.id, chain).forEach((step, i) => {
      out[overshotKey(chain, i)] = planDigest(step.draft)
    })
  }
  return out
}
