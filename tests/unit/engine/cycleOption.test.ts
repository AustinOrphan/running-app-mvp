// The recovery cycle option [rules E3, A5]: an absent option leaves the cycle to the plan (2:1 for a
// new or low-frequency runner), an explicit one is a choice. The generator (macro.ts) and the
// checklist's cadence item both read it through `cycleShortReason`, so a plan and its check cannot
// disagree about what an absent, a '2:1' or a '3:1' option means.
import { describe, expect, it } from 'vitest'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { buildPlan, runChecklist } from '../../../shared/engine/index.ts'
import { cycleShortReason, cycleWorkWeeks } from '../../../shared/engine/macro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { EngineInput, PlanDraft, WeekDraft } from '../../../shared/engine/types.ts'
import { athletes } from './matrix-fixtures.ts'

type Options = EngineInput['options']

const USUAL = P.e3.defaultCycleWorkWeeks.value
const FLAGGED = P.e3.flaggedCycleWorkWeeks.value

const athlete = (id: string) => athletes().find((a) => a.id === id)!
const withOptions = (input: EngineInput, options: Options): EngineInput => ({ ...input, options })

/** What the cadence item says its cycle is: "A recovery week at least every 3rd week" is 2:1. */
function checkedCycle(plan: PlanDraft): number {
  const item = plan.checklist.find((c) => c.id === 'recovery-cadence')!
  const match = /every (\d+)\w* week/.exec(item.detail)
  return Number(match?.[1]) - 1
}

/** The distance in weeks between one recovery week and the next, before the taper begins. */
function recoveryGaps(weeks: WeekDraft[]): number[] {
  const taper = weeks.findIndex((w) => w.isTaper)
  const indexes = weeks
    .slice(0, taper === -1 ? weeks.length : taper)
    .filter((w) => w.isRecovery)
    .map((w) => w.index)
  return indexes.slice(1).map((index, i) => index - indexes[i]!)
}

describe('the recovery cycle option', () => {
  // A novice (the 5 km athlete) and a runner returning after six weeks off, whose logged frequency
  // is low: both are the new-runner cases that the Generate form used to give 3:1 by sending it.
  const CASES: Array<[string, Options, ReturnType<typeof cycleShortReason>, number]> = [
    ['novice-5k', {}, 'new-runner', FLAGGED],
    ['novice-5k', { recoveryCycle: '2:1' }, 'chosen', FLAGGED],
    ['novice-5k', { recoveryCycle: '3:1' }, null, USUAL],
    ['returning', {}, 'new-runner', FLAGGED],
    ['returning', { recoveryCycle: '2:1' }, 'chosen', FLAGGED],
    ['returning', { recoveryCycle: '3:1' }, null, USUAL],
  ]

  it.each(CASES)(
    '%s with %j: the generator and the checklist use the same cycle',
    (id, options, reason, workWeeks) => {
      const input = withOptions(athlete(id).input, options)
      const state = estimateState(input)
      expect(cycleShortReason(input, state)).toBe(reason)
      expect(cycleWorkWeeks(input, state)).toBe(workWeeks)

      const plan = buildPlan(input)
      const item = plan.checklist.find((c) => c.id === 'recovery-cadence')!
      expect(item.ok, item.detail).toBe(true)
      expect(checkedCycle(plan)).toBe(workWeeks)
      // the weeks the generator drew keep the cycle the check names (the novice's weeks are a
      // start path, which carries no recovery weeks of its own)
      if (id === 'returning') {
        const gaps = recoveryGaps(plan.weeks)
        expect(gaps.length).toBeGreaterThan(0)
        expect(gaps.every((gap) => gap === workWeeks + 1)).toBe(true)
      }
    },
  )

  it('keeps an explicit 3:1 a choice: the plan drawn for it fails the check where the option is absent', () => {
    const base = athlete('returning').input
    const usual = buildPlan(withOptions(base, { recoveryCycle: '3:1' }))
    const decided = buildPlan(withOptions(base, {}))
    const failed = (plan: PlanDraft, options: Options) =>
      runChecklist(plan, withOptions(base, options))
        .filter((c) => !c.ok)
        .map((c) => c.id)

    expect(failed(usual, { recoveryCycle: '3:1' })).toEqual([])
    expect(failed(usual, {})).toContain('recovery-cadence')
    expect(failed(decided, {})).toEqual([])
    // a plan with a recovery week every 3rd week also keeps the longer cycle
    expect(failed(decided, { recoveryCycle: '3:1' })).toEqual([])
  })
})
