import { describe, expect, test } from 'vitest'
import { addDays } from '../../shared/dates.ts'
import type { PlanPhase, PlanWeek } from '../../shared/types.ts'
import {
  actualRange,
  bracketSpans,
  hourAxis,
  monthMarks,
  isPostRace,
  isRaceWeek,
  planSpan,
  seasonBarSizes,
  seasonFigures,
  seasonMarks,
  seasonRuns,
} from '../../web/components/season.ts'
import { makeV2Week } from './plan-fixtures.ts'

const START = '2026-11-09'

function week(index: number, phase: PlanPhase, flags: string[] = [], over: Partial<PlanWeek> = {}) {
  return makeV2Week(index, { weekStart: addDays(START, 7 * index), phase, flags, ...over })
}

/** Three base weeks (the third a recovery week), two build, a taper, the race and two after it. */
const WEEKS: PlanWeek[] = [
  week(0, 'base'),
  week(1, 'base'),
  week(2, 'base', ['recovery']),
  week(3, 'build'),
  week(4, 'build'),
  week(5, 'taper'),
  week(6, 'race'),
  week(7, 'race', ['post-race']),
  week(8, 'race', ['post-race']),
]

describe('planSpan and actualRange', () => {
  const plan = { weeks: WEEKS, startDate: START }
  const first = '2026-11-09'
  const last = addDays(START, 56)

  test('the span is the Monday of the first and of the last week', () => {
    expect(planSpan(plan)).toEqual({ first, last })
    expect(planSpan({ weeks: [], startDate: '2026-11-02' })).toEqual({
      first: '2026-11-02',
      last: '2026-11-02',
    })
  })

  test('the minutes run are read from the first week to this Monday, held inside the plan', () => {
    expect(actualRange(plan, '2026-12-07')).toEqual({ from: first, to: '2026-12-07' })
    // a plan that today has not reached reads its first week only
    expect(actualRange(plan, '2026-10-26')).toEqual({ from: first, to: first })
    // one that today has left reads to its last week
    expect(actualRange(plan, '2027-06-07')).toEqual({ from: first, to: last })
  })
})

describe('the race week and the weeks after it', () => {
  test('a race-phase week is the race week unless it carries the post-race flag', () => {
    expect(isRaceWeek(WEEKS[6]!)).toBe(true)
    expect(isRaceWeek(WEEKS[7]!)).toBe(false)
    expect(isRaceWeek(WEEKS[5]!)).toBe(false)
    expect(isPostRace(WEEKS[7]!)).toBe(true)
    expect(isPostRace(WEEKS[6]!)).toBe(false)
  })
})

describe('seasonRuns', () => {
  test('groups consecutive weeks that read the same name, as the week table does', () => {
    expect(seasonRuns(WEEKS)).toEqual([
      { label: 'Base', kind: 'phase', firstWeek: '2026-11-09', lastWeek: '2026-11-23', weeks: 3 },
      { label: 'Build', kind: 'phase', firstWeek: '2026-11-30', lastWeek: '2026-12-07', weeks: 2 },
      { label: 'Taper', kind: 'phase', firstWeek: '2026-12-14', lastWeek: '2026-12-14', weeks: 1 },
      {
        label: 'Race week',
        kind: 'race',
        firstWeek: '2026-12-21',
        lastWeek: '2026-12-21',
        weeks: 1,
      },
      {
        label: 'After the race',
        kind: 'after',
        firstWeek: '2026-12-28',
        lastWeek: '2027-01-04',
        weeks: 2,
      },
    ])
  })

  test('a recovery week stays in its phase: it is shorter by its height, not by a bracket', () => {
    expect(seasonRuns(WEEKS).filter((r) => r.label === 'Base')).toHaveLength(1)
  })

  test('names a version-1 plan by the labels it prints', () => {
    const v1 = [week(0, 'restart'), week(1, 'base1'), week(2, 'base1'), week(3, 'peak')]
    expect(seasonRuns(v1).map((r) => [r.label, r.weeks])).toEqual([
      ['Restart', 1],
      ['Base 1', 2],
      ['Peak', 1],
    ])
  })

  test('is empty for no weeks', () => {
    expect(seasonRuns([])).toEqual([])
  })
})

describe('seasonMarks', () => {
  test('marks this week, the race week and each week after the race', () => {
    const marks = seasonMarks(WEEKS, '2026-11-23')
    expect(Object.keys(marks)).toHaveLength(WEEKS.length)
    expect(Object.entries(marks).filter(([, m]) => m.current === true)).toEqual([
      ['2026-11-23', { current: true, race: false, muted: false }],
    ])
    expect(
      Object.entries(marks)
        .filter(([, m]) => m.race === true)
        .map(([k]) => k),
    ).toEqual(['2026-12-21'])
    expect(
      Object.entries(marks)
        .filter(([, m]) => m.muted === true)
        .map(([k]) => k),
    ).toEqual(['2026-12-28', '2027-01-04'])
  })

  test('marks no week as current when today is outside the plan', () => {
    const marks = seasonMarks(WEEKS, '2027-06-07')
    expect(Object.values(marks).some((m) => m.current === true)).toBe(false)
  })
})

describe('seasonFigures', () => {
  test('draws every week at the plan figure and the minutes run where they were read, else none', () => {
    const figures = seasonFigures(
      [week(0, 'base', [], { targetRunMin: 300 }), week(1, 'base', [], { targetRunMin: 330 })],
      new Map([['2026-11-09', 280]]),
    )
    expect(figures.weeks).toEqual([
      { weekStart: '2026-11-09', runMin: 280 },
      { weekStart: '2026-11-16', runMin: 0 },
    ])
    expect(figures.planned).toEqual([
      { weekStart: '2026-11-09', targetRunMin: 300 },
      { weekStart: '2026-11-16', targetRunMin: 330 },
    ])
  })

  test('shows the plan of a week that was run past it, not the minutes the engine stored', () => {
    const over = week(0, 'base', ['overshoot', 'planned-200'], {
      targetRunMin: 320,
      plannedRunMin: 200,
      overshoot: true,
    })
    expect(seasonFigures([over], new Map()).planned).toEqual([
      { weekStart: '2026-11-09', targetRunMin: 200 },
    ])
  })
})

describe('seasonBarSizes', () => {
  test('gives the phone sizes of the compact chart at the width of a season of about 31 weeks', () => {
    // 358 px over 31 weeks
    expect(seasonBarSizes(358 / 31)).toEqual({ planned: 8, actual: 4 })
  })

  test('takes about three quarters of a column, up to 24 px, and half of that for the solid bar', () => {
    expect(seasonBarSizes(358 / 24)).toEqual({ planned: 11, actual: 6 })
    expect(seasonBarSizes(100)).toEqual({ planned: 24, actual: 12 })
  })

  test('keeps the outline a stroke narrower than its column, so outlines never touch, at any length', () => {
    // 40 weeks and 45 weeks still keep the 6 px floor; past that the floor gives way to the column
    expect(seasonBarSizes(358 / 40).planned).toBe(6)
    expect(seasonBarSizes(358 / 45).planned).toBe(6)
    for (const weeks of [46, 52, 60, 80, 120]) {
      const band = 358 / weeks
      const { planned, actual } = seasonBarSizes(band)
      expect(planned + 1.5, `${String(weeks)} weeks`).toBeLessThanOrEqual(band)
      expect(actual).toBeLessThanOrEqual(planned)
      expect(planned).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('hourAxis', () => {
  test('gives four round ticks whose top clears the tallest week by a tenth', () => {
    expect(hourAxis(1.6)).toEqual({ max: 3, ticks: [0, 1, 2, 3] })
    expect(hourAxis(7.3)).toEqual({ max: 9, ticks: [0, 3, 6, 9] })
    expect(hourAxis(12.4)).toEqual({ max: 15, ticks: [0, 5, 10, 15] })
  })

  test.each([0.2, 1, 3.4, 6.1, 9.9, 12.4, 33, 80, 140])(
    'peak %s h stays under the top tick',
    (peak) => {
      const { max, ticks } = hourAxis(peak)
      expect(max).toBeGreaterThanOrEqual(peak * 1.1)
      expect(ticks).toHaveLength(4)
      expect(ticks[0]).toBe(0)
      expect(ticks[3]).toBe(max)
      // the steps are equal and a multiple of half an hour
      const step = ticks[1] ?? 0
      expect(ticks.map((tick, i) => tick - i * step)).toEqual([0, 0, 0, 0])
      expect((step * 2) % 1).toBe(0)
    },
  )

  test('a plan with no hours still has an axis', () => {
    expect(hourAxis(0)).toEqual({ max: 1.5, ticks: [0, 0.5, 1, 1.5] })
  })
})

describe('monthMarks', () => {
  const weeks = (from: string, n: number) =>
    Array.from({ length: n }, (_, i) => addDays(from, 7 * i))

  test('labels the first week and each week where the month turns', () => {
    const marks = monthMarks(weeks('2026-11-02', 20), 600)
    expect(marks.map((m) => m.month)).toEqual([10, 11, 0, 1, 2].slice(0, marks.length))
    expect(marks[0]?.index).toBe(0)
  })

  test('at 360 px a 40-week plan keeps at most five labels, apart and inside the plot', () => {
    const plotWidth = 360 - 2 * 16 - 36
    const list = weeks('2026-11-02', 40)
    const marks = monthMarks(list, plotWidth)
    expect(marks.length).toBeGreaterThan(0)
    expect(marks.length).toBeLessThanOrEqual(5)
    const band = plotWidth / list.length
    marks.forEach((mark, i) => {
      // a label is about 25 px wide; it must end inside the plot
      expect(mark.index * band + 25).toBeLessThanOrEqual(plotWidth)
      if (i > 0) expect((mark.index - (marks[i - 1]?.index ?? 0)) * band).toBeGreaterThanOrEqual(33)
    })
  })

  test('a label that would run past the plot edge is dropped, not shifted', () => {
    // the last week turns a month, but two weeks of 5 px leave no room for a name
    const marks = monthMarks(['2026-11-23', '2026-11-30'], 10)
    expect(marks.map((m) => m.index)).toEqual([])
  })

  test('no weeks, no marks', () => {
    expect(monthMarks([], 300)).toEqual([])
  })
})

describe('bracketSpans', () => {
  test('starts each phase after the weeks of the ones before it', () => {
    expect(bracketSpans([{ weeks: 5 }, { weeks: 8 }, { weeks: 1 }])).toEqual([
      { start: 1, span: 5 },
      { start: 6, span: 8 },
      { start: 14, span: 1 },
    ])
  })
})
