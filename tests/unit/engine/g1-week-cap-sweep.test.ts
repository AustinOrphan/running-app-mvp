// The sweep of the long run's distance limit [rules g-1, D7]; the fast cases are in
// g1-week-cap.test.ts. About 10 s, so it runs in the sweep project (`SWEEP_FILES`).
// Synthetic runner: the summer block of appendix A, then a layoff of which only three short runs
// remain in the last 30 days.
import { expect, it } from 'vitest'
import { mondayOf } from '../../../shared/dates.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { at, scenario, summer, type Run } from './history-fixtures.ts'

const tail = (ref: number): Run[] => [
  ...summer(),
  { weeksBack: 6, dow: 2, min: 30 },
  { weeksBack: 3, dow: 3, min: Math.max(10, ref - 5) },
  { weeksBack: 2, dow: 1, min: ref },
  { weeksBack: 1, dow: 4, min: Math.max(10, ref - 4) },
]

it('leaves no loading week short by 2 minutes or more', () => {
  const short: string[] = []
  for (const position of ['standard', 'upper'] as const) {
    for (let ref = 13; ref <= 45; ref++) {
      const plan = buildPlan(at(scenario(tail(ref)), position))
      plan.weeks
        .slice(1, 12) // the first week is the part week the plan opens in
        .filter((w) => !w.isRecovery && !w.isTaper && w.targetRunMin > 0)
        .forEach((w) => {
          const placed = plan.sessions
            .filter(
              (s) => mondayOf(s.date) === w.weekStart && !['strength', 'race'].includes(s.kind),
            )
            .reduce((n, s) => n + s.durationMin, 0)
          if (placed < w.targetRunMin - 1) {
            short.push(`${position} ref ${ref} ${w.weekStart}: ${placed} of ${w.targetRunMin}`)
          }
        })
    }
  }
  expect(short).toEqual([])
})
