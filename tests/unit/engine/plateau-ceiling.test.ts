// The weekly plateau [rule E7]: the ceiling of a plan is the larger of the class peak and the start
// level read when the plan is generated or after a break. A re-plan carries on from the stored
// week, so weeks run above the plan do not lift the ceiling. Synthetic runner; no personal data.
import { describe, expect, it } from 'vitest'
import { P } from '../../../shared/engine/params/index.ts'
import { replanSteps } from './replan-steps.ts'

describe('the weekly plateau ceiling stays at the class peak across re-plans', () => {
  it('holds a marathon runner who runs 40% above every week at the class peak', () => {
    const peak = P.peakWeeklyMin.marathon.value
    const steps = replanSteps('marathon', { scale: 1.4, maxSteps: 8 })
    expect(steps.length).toBeGreaterThan(4)
    const first = steps[0]!.draft.weeks.filter((w) => !w.isRecovery && w.phase !== 'race')
    expect(Math.max(...first.map((w) => w.targetRunMin))).toBe(peak)
    for (const step of steps.slice(1)) {
      const ahead = step.draft.weeks.filter(
        (w) => w.weekStart >= step.input.today && !w.isRecovery && !w.isTaper && w.phase !== 'race',
      )
      expect(ahead.length).toBeGreaterThan(0)
      for (const week of ahead) expect(week.targetRunMin).toBeLessThanOrEqual(peak)
    }
  })
})
