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
