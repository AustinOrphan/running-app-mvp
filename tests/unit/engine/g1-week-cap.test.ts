// The distance limit of G-1 on the long run [rules g-1, D7]: the macro draws the long run of a week
// and the micro places it, and the two measured the limit differently (the macro at the logged
// pace, the micro at the prescribed pace rounded to 100 m). Where the limit bound, the long run was
// placed a minute under its row and the week's target was not placed. Synthetic runner: the summer
// block of appendix A, then a layoff of which only three short runs remain in the last 30 days.
import { describe, expect, it } from 'vitest'
import { mondayOf } from '../../../shared/dates.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { at, scenario, summer, type Run } from './history-fixtures.ts'

const tail = (ref: number): Run[] => [
  ...summer(),
  { weeksBack: 6, dow: 2, min: 30 },
  { weeksBack: 3, dow: 3, min: ref - 5 },
  { weeksBack: 2, dow: 1, min: ref },
  { weeksBack: 1, dow: 4, min: ref - 4 },
]

function weeksOf(ref: number) {
  const plan = buildPlan(at(scenario(tail(ref)), 'standard'))
  return plan.weeks.map((week) => {
    const runs = plan.sessions.filter(
      (s) => mondayOf(s.date) === week.weekStart && !['strength', 'race'].includes(s.kind),
    )
    return {
      week,
      long: runs.find((s) => s.kind === 'long')?.durationMin ?? null,
      placed: runs.reduce((n, s) => n + s.durationMin, 0),
    }
  })
}

describe('the long run under the distance limit of G-1', () => {
  const standard29 = weeksOf(29).filter(
    (w) => w.week.weekStart >= '2026-11-09' && w.week.weekStart <= '2026-12-21',
  )

  it('places the long run at the minutes of its row where the limit binds', () => {
    const loading = standard29.filter((w) => !w.week.isRecovery && w.long !== null)
    expect(loading.length).toBeGreaterThan(3)
    for (const w of loading) expect(w.long, w.week.weekStart).toBe(w.week.longRunMin)
  })

  it('places the week target within a minute where the limit binds', () => {
    const loading = standard29.filter((w) => !w.week.isRecovery)
    for (const w of loading) {
      expect(w.placed, w.week.weekStart).toBeGreaterThanOrEqual(w.week.targetRunMin - 1)
    }
  })
})
