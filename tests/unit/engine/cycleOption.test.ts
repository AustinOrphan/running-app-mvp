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
  // The last column is the cycle as the cadence item words it: 2:1 is a recovery week every 3rd week.
  const CASES: Array<[string, Options, ReturnType<typeof cycleShortReason>, number, string]> = [
    ['novice-5k', {}, 'new-runner', FLAGGED, '3rd'],
    ['novice-5k', { recoveryCycle: '2:1' }, 'chosen', FLAGGED, '3rd'],
    ['novice-5k', { recoveryCycle: '3:1' }, null, USUAL, '4th'],
    ['returning', {}, 'new-runner', FLAGGED, '3rd'],
    ['returning', { recoveryCycle: '2:1' }, 'chosen', FLAGGED, '3rd'],
    ['returning', { recoveryCycle: '3:1' }, null, USUAL, '4th'],
  ]

  it.each(CASES)(
    '%s with %j: the generator and the checklist use the same cycle',
    (id, options, reason, workWeeks, every) => {
      const input = withOptions(athlete(id).input, options)
      const state = estimateState(input)
      expect(cycleShortReason(input, state)).toBe(reason)
      expect(cycleWorkWeeks(input, state)).toBe(workWeeks)

      const plan = buildPlan(input)
      const item = plan.checklist.find((c) => c.id === 'recovery-cadence')!
      expect(item.ok, item.detail).toBe(true)
      expect(item.detail).toBe(`A recovery week at least every ${every} week.`)
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

describe('the restart floor week in the cadence item [rule E3]', () => {
  // The checklist counts a restart floor week as the start of a block (an exemption from E3, a
  // Preference recorded under E3 in the rules): the generator draws the weeks of a floor start path
  // with no recovery week and does not count the floor week as a block of its own. The item is
  // asked of hand-made drafts, from the weeks of a real plan whose flags and recovery weeks are set.
  const input = athlete('half').input
  const plan = buildPlan(input)
  const cadence = (pattern: string): { ok: boolean; detail: string } => {
    // L a loading week, R a recovery week (under the week before it), F a restart floor week
    const weeks = plan.weeks.slice(0, pattern.length).map((w, i): WeekDraft => {
      const kind = pattern[i]!
      const recovery = kind === 'R'
      return {
        ...w,
        isRecovery: recovery,
        isTaper: false,
        phase: 'base',
        targetRunMin: recovery ? 70 : 100,
        flags: kind === 'F' ? ['restart-floor'] : recovery ? ['recovery'] : [],
      }
    })
    const item = runChecklist({ ...plan, weeks }, input).find((c) => c.id === 'recovery-cadence')!
    return { ok: item.ok, detail: item.detail }
  }

  it('counts the cycle of three from a recovery week', () => {
    expect(cadence('LLLRLLLR').ok).toBe(true)
    // the first block of a plan may run a week longer; a later one may not
    expect(cadence('LLLLRLLL').ok).toBe(true)
    expect(cadence('LLRLLLLR').ok).toBe(false)
  })

  it('lets three loading weeks and a recovery week follow a floor week', () => {
    expect(cadence('LLRFLLLR').ok).toBe(true)
    expect(cadence('LLRFLLRL').ok).toBe(true)
    // a plan that opens on its floor week (the normal case: the flag is on week 0) too
    expect(cadence('FLLLR').ok).toBe(true)
  })

  it('refuses a fourth loading week after a floor week, in a plan that opens on it as in any other', () => {
    for (const pattern of ['LLRFLLLLR', 'FLLLLR']) {
      const item = cadence(pattern)
      expect(item.ok, pattern).toBe(false)
      expect(item.detail, pattern).toMatch(/4 loading weeks in a row/)
    }
  })

  it('counts the loading weeks before a floor week apart from those after it', () => {
    expect(cadence('LLLFLLLR').ok).toBe(true)
  })
})
