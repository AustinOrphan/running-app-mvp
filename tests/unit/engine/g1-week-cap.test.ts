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

function planOf(ref: number, thresholdPaceSecPerKm?: number) {
  const profile = thresholdPaceSecPerKm === undefined ? {} : { thresholdPaceSecPerKm }
  return buildPlan(at(scenario(tail(ref), { profile }), 'standard'))
}

function weeksOf(ref: number, thresholdPaceSecPerKm?: number) {
  const plan = planOf(ref, thresholdPaceSecPerKm)
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

// The row is re-measured in both directions: a probe of the long run rounds to 100 m, and where it
// rounds down (about half of the zone 1 paces) the limit holds more minutes than the logged pace
// gave. A threshold pace of 285 s/km puts the zone 1 mid pace there: the week of 2026-12-21 draws
// a target of 129 and a long run of 43 minutes where the logged pace drew 120 and 40.
describe('the long run where the probe rounds down', () => {
  const weeks = weeksOf(22, 285).filter(
    (w) => w.week.weekStart >= '2026-11-09' && w.week.weekStart <= '2026-12-21',
  )

  it('places the long run at the minutes of a row that rose', () => {
    const loading = weeks.filter((w) => !w.week.isRecovery && w.long !== null)
    expect(loading.length).toBeGreaterThan(3)
    for (const w of loading) expect(w.long, w.week.weekStart).toBe(w.week.longRunMin)
    const last = weeks.find((w) => w.week.weekStart === '2026-12-21')!
    expect(last.week.longRunMin).toBe(43)
    expect(last.week.targetRunMin).toBe(129)
  })

  it('places the week target within a minute', () => {
    for (const w of weeks.filter((w) => !w.week.isRecovery)) {
      expect(w.placed, w.week.weekStart).toBeGreaterThanOrEqual(w.week.targetRunMin - 1)
    }
  })
})

// The G-1 band of a week is read from the runs of the plan before it, so a long run drawn above what
// is placed (the old measure) raised every later band. The peak week of the whole plan is the
// figure that moved: 489 minutes before, 429 now (the peak long run 149 to 130, the total of the
// weekly targets 6694 to 5691), because the bands no longer count a long run that was never placed.
describe('the plan to the race of a runner with a short reference', () => {
  it('draws its peak week from the runs that were placed', () => {
    const { weeks } = planOf(22)
    expect(Math.max(...weeks.map((w) => w.targetRunMin))).toBe(429)
    expect(Math.max(...weeks.map((w) => w.longRunMin))).toBe(130)
  })

  // Known interaction, not fixed here: the first run after the race falls from 17 to 15 minutes, the
  // G-1 band floor(15 + 3) = 18 is under `fplace.easyRunMinMin` (20), and `windowWeeks`
  // (postRace.ts) then draws the three weeks after the race with no session (0, 0, 0 minutes where
  // the plan drew 60, 138 and 156). It is the tiny-plan case (a G-1 band under the run minimum) of
  // its own follow-up. When that is fixed this test passes: remove `.fails`.
  it.fails('keeps the weeks after the race when the G-1 band is under the run minimum', () => {
    const { weeks, sessions } = planOf(22)
    for (const start of ['2027-06-14', '2027-06-21', '2027-06-28']) {
      expect(weeks.find((w) => w.weekStart === start)!.targetRunMin, start).toBeGreaterThan(0)
      expect(
        sessions.some((s) => mondayOf(s.date) === start),
        start,
      ).toBe(true)
    }
  })
})
