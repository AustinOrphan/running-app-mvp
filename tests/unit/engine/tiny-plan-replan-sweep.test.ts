// Tiny plans under repeated holds, the slow part (owner decision 2026-11-20, "One run, growing
// ~10%/wk"): a re-plan chain over a 28-day niggle at three start dates. It runs for about six seconds,
// past the unit project's timeout under CI load, so it lives in the sweep project. The fast cases stay
// in tiny-plan.test.ts. Synthetic matrix athletes only.
import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { windowOf } from './disruption-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { replanChain } from './replan-steps.ts'

// A tiny week the guards leave with no running is no baseline: a zero in the guards' ramp sent the
// recovery week after it to the typical week (a limit of about 97 minutes), while the checklist, which
// counts the weeks that hold a session, held it to 1.3 x the last run week (14 minutes).
describe('a re-plan after a 28-day niggle that leaves weeks empty', () => {
  it('passes the checklist at the three re-plans of sparse-100-mile that failed its progression item', () => {
    const athlete = athletes().find((a) => a.id === 'sparse-100-mile')!
    const failures: string[] = []
    for (const start of ['2026-11-14', '2026-12-12', '2027-01-02']) {
      const window = windowOf({
        id: 'w',
        reason: 'niggle',
        startDate: start,
        endDate: addDays(start, 27),
        pain: 0,
      })
      for (const step of replanChain(athlete.input, { windows: [window] })) {
        for (const item of step.draft.checklist.filter((c) => !c.ok)) {
          failures.push(`${start} ${step.input.today}: ${item.id}: ${item.detail}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})
