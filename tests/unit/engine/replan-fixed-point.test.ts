// A re-plan with nothing new returns the plan it replaces: the direct cases behind the metamorphic
// relations of `sim-athlete.test.ts` (task RF1). Each case is a small input worked by hand, not a
// season: the race week of one athlete, one held week, and so on. The relations run the same
// questions over twelve athletes and three levels.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { replan } from '../../../shared/engine/index.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { replanSteps } from './replan-steps.ts'
import { withStoredPlan } from './sim-athlete.ts'

/** The running minutes of a draft in the week of `monday`, a race and a lift left out. */
function weekMin(draft: PlanDraft, monday: string): number {
  return draft.sessions
    .filter((s) => s.date >= monday && s.date < addDays(monday, 7))
    .filter((s) => !['strength', 'race', 'rest', 'mobility', 'hike'].includes(s.kind))
    .reduce((sum, s) => sum + s.durationMin, 0)
}

/** The same Monday again with the draft stored as the plan, and nothing new. */
function again(input: EngineInput, draft: PlanDraft): { input: EngineInput; draft: PlanDraft } {
  const stored = withStoredPlan({ settled: input, draft })
  return { input: stored, draft: replan(stored).draft }
}

describe('the race week, stored and re-planned with nothing new [rules g-6, K2]', () => {
  // The race week holds a run on the day of the race, which the race replaces. The plan sheds that
  // run once; it must not shed another run, or another share of the week, at every re-plan.
  it.each(['half', 'marathon', 'first-100-mile'])(
    'gives the plan of %s back, pass after pass',
    (id) => {
      const last = replanSteps(id).at(-1)!
      const monday = mondayOf(last.input.today)
      expect(monday).toBe(mondayOf(last.input.goal.date))
      let { input, draft } = { input: last.input, draft: last.draft }
      for (let pass = 2; pass <= 4; pass += 1) {
        const next = again(input, draft)
        expect(weekMin(next.draft, monday), `pass ${String(pass)}`).toBe(
          weekMin(last.draft, monday),
        )
        expect(next.draft, `pass ${String(pass)}`).toEqual(last.draft)
        ;({ input, draft } = next)
      }
    },
  )
})
