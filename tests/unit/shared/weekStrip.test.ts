import { describe, expect, test } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { remainingPlan } from '../../../shared/domain/adaptation.ts'
import { isToRun } from '../../../shared/domain/sessionStatus.ts'
import { weekStrip } from '../../../shared/domain/weekStrip.ts'
import { aggregateWeeks } from '../../../shared/domain/weeks.ts'
import type { SessionKind } from '../../../shared/engine/types.ts'
import type { PlanSession, PlanSessionStatus, WeekStripMark } from '../../../shared/types.ts'
import { makeActivityCore } from '../../factories.ts'
import { makeSession } from '../../web/today-fixtures.ts'

const WEEK = '2026-10-19' // Monday
const TODAY = '2026-10-21' // Wednesday
const MON = WEEK
const TUE = '2026-10-20'
const THU = '2026-10-22'
const SUN = '2026-10-25'

let counter = 0
function session(
  date: string,
  kind: SessionKind = 'easy',
  status: PlanSessionStatus = 'planned',
  over: Partial<PlanSession> = {},
): PlanSession {
  counter += 1
  return makeSession({ id: `s${String(counter)}`, date, kind, status, weekStart: WEEK, ...over })
}

const run = (date: string, minutes: number, over = {}) =>
  makeActivityCore({ date, type: 'run', durationSec: minutes * 60, ...over })

function strip(
  sessions: PlanSession[] = [],
  activities: ReturnType<typeof run>[] = [],
  over: { today?: string; targetRunMin?: number | null } = {},
) {
  return weekStrip({
    today: over.today ?? TODAY,
    sessions,
    activities,
    targetRunMin: null,
    ...over,
  })
}

const markOf = (s: ReturnType<typeof strip>, date: string): WeekStripMark =>
  s.days.find((d) => d.date === date)!.mark

describe('weekStrip: the week', () => {
  test('is seven days from Monday, and marks only today', () => {
    const s = strip()
    expect(s.weekStart).toBe(WEEK)
    expect(s.days.map((d) => d.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(WEEK, i)))
    expect(s.days.filter((d) => d.isToday).map((d) => d.date)).toEqual([TODAY])
  })

  test('starts on the same Monday from any day of the week, Sunday included', () => {
    for (let i = 0; i < 7; i++) {
      const s = strip([], [], { today: addDays(WEEK, i) })
      expect(s.weekStart).toBe(WEEK)
      expect(s.days.findIndex((d) => d.isToday)).toBe(i)
    }
    expect(strip([], [], { today: addDays(WEEK, 7) }).weekStart).toBe(addDays(WEEK, 7))
  })

  test('throws for a malformed today', () => {
    expect(() => strip([], [], { today: '2026-13-01' })).toThrow(RangeError)
  })

  test('shows a day with no session as free', () => {
    const s = strip()
    expect(
      s.days.every((d) => d.mark === 'free' && d.sessions.length === 0 && d.runMin === 0),
    ).toBe(true)
  })

  test('ignores sessions dated outside the week and sorts a day by order', () => {
    const second = session(THU, 'strength', 'planned', { order: 1 })
    const first = session(THU, 'easy', 'planned', { order: 0 })
    const s = strip([second, first, session(addDays(WEEK, -1)), session(addDays(WEEK, 7))])
    expect(s.days.flatMap((d) => d.sessions)).toHaveLength(2)
    expect(s.days.find((d) => d.date === THU)!.sessions.map((x) => x.id)).toEqual([
      first.id,
      second.id,
    ])
  })
})

describe('weekStrip: marks', () => {
  // A full record, so a status added to PlanSessionStatus fails to compile here until the strip
  // says what it means on a past day, today and a day to come.
  type Reading = { past: WeekStripMark; today: WeekStripMark; ahead: WeekStripMark }
  const toRun: Reading = { past: 'unlogged', today: 'planned', ahead: 'planned' }
  const READINGS: Record<PlanSessionStatus, Reading> = {
    planned: toRun,
    moved: toRun,
    downgraded: toRun,
    adjusted: toRun,
    completed: { past: 'done', today: 'done', ahead: 'done' },
    partial: { past: 'partial', today: 'partial', ahead: 'partial' },
    skipped: { past: 'skipped', today: 'skipped', ahead: 'skipped' },
  }
  const statuses = Object.keys(READINGS) as PlanSessionStatus[]

  test.each(statuses)('reads %s on a past day, today and a day to come', (status) => {
    const s = strip([
      session(MON, 'easy', status),
      session(TODAY, 'easy', status),
      session(THU, 'easy', status),
    ])
    expect({ past: markOf(s, MON), today: markOf(s, TODAY), ahead: markOf(s, THU) }).toEqual(
      READINGS[status],
    )
  })

  test('a past planned day reads "planned, no run logged", not a miss', () => {
    expect(markOf(strip([session(MON)]), MON)).toBe('unlogged')
  })

  test('a past day with a run still to be matched reads done once a run is logged that day', () => {
    const s = strip([session(MON)], [run(MON, 40)])
    expect(markOf(s, MON)).toBe('done')
  })

  test('a settled session keeps its mark whatever was logged', () => {
    expect(markOf(strip([session(MON, 'easy', 'skipped')], [run(MON, 40)]), MON)).toBe('skipped')
  })

  test('follows isToRun: only a session still to run changes with the date', () => {
    for (const status of statuses) {
      const past = markOf(strip([session(MON, 'easy', status)]), MON)
      const ahead = markOf(strip([session(THU, 'easy', status)]), THU)
      if (isToRun(status)) expect(past, status).not.toBe(ahead)
      else expect(past, status).toBe(ahead)
    }
  })

  test.each(['strength', 'mobility', 'rest', 'cross'] as const)(
    'a %s session alone leaves the day free',
    (kind) => {
      expect(markOf(strip([session(TUE, kind, 'completed')]), TUE)).toBe('free')
    },
  )

  test("a strength session beside a run does not change the run's mark", () => {
    const s = strip([session(THU, 'strength'), session(THU, 'long', 'planned', { order: 1 })])
    expect(markOf(s, THU)).toBe('planned')
    expect(s.days.find((d) => d.date === THU)!.sessions).toHaveLength(2)
  })

  test('a day with two runs reads by the one still to come, then by what is settled', () => {
    expect(
      markOf(strip([session(TUE, 'easy', 'completed'), session(TUE, 'easy', 'planned')]), TUE),
    ).toBe('unlogged')
    expect(
      markOf(strip([session(THU, 'easy', 'completed'), session(THU, 'easy', 'planned')]), THU),
    ).toBe('planned')
    expect(
      markOf(strip([session(MON, 'easy', 'completed'), session(MON, 'easy', 'skipped')]), MON),
    ).toBe('partial')
    expect(
      markOf(strip([session(MON, 'easy', 'completed'), session(MON, 'easy', 'partial')]), MON),
    ).toBe('partial')
    expect(
      markOf(strip([session(MON, 'easy', 'skipped'), session(MON, 'easy', 'skipped')]), MON),
    ).toBe('skipped')
  })

  test('uses neutral marks only', () => {
    const all = new Set<WeekStripMark>()
    for (const status of statuses) {
      for (const date of [MON, TODAY, THU])
        all.add(markOf(strip([session(date, 'easy', status)]), date))
    }
    expect([...all].sort()).toEqual(['done', 'partial', 'planned', 'skipped', 'unlogged'])
  })
})

describe('weekStrip: run time', () => {
  test('sums the run minutes of each day and of the week', () => {
    const s = strip([], [run(MON, 45), run(MON, 20), run(TUE, 30), run(SUN, 90)])
    expect(s.days.map((d) => d.runMin)).toEqual([65, 30, 0, 0, 0, 0, 90])
    expect(s.runMin).toBe(185)
  })

  test('counts runs only, leaves out flagged duplicates and other weeks', () => {
    const s = strip(
      [],
      [
        run(MON, 30),
        run(MON, 30, { duplicateStatus: 'possible' }),
        run(MON, 30, { duplicateStatus: 'confirmed' }),
        run(MON, 30, { duplicateStatus: 'dismissed' }),
        makeActivityCore({ date: MON, type: 'strength', durationSec: 3600 }),
        makeActivityCore({ date: MON, type: 'cross', durationSec: 3600 }),
        makeActivityCore({ date: MON, type: 'race', durationSec: 3600 }),
        run(addDays(WEEK, -1), 50),
        run(addDays(WEEK, 7), 50),
      ],
    )
    expect(s.days[0]!.runMin).toBe(60)
    expect(s.runMin).toBe(60)
  })

  test('agrees with the week rows on the total', () => {
    const activities = [
      run(MON, 41, { durationSec: 41 * 60 + 29 }),
      run(TUE, 41, { durationSec: 41 * 60 + 29 }),
      run(THU, 12),
      run(MON, 10, { duplicateStatus: 'possible' }),
      makeActivityCore({ date: TUE, type: 'strength', durationSec: 1800 }),
    ]
    expect(strip([], activities).runMin).toBe(aggregateWeeks(activities, [WEEK])[0]!.runMin)
  })

  test('gives the advisory split of what is left through Sunday when the plan has a target', () => {
    const s = strip([], [run(MON, 70), run(TUE, 50)], { targetRunMin: 360 })
    expect(s.targetRunMin).toBe(360)
    expect(s.runMin).toBe(120)
    expect(s.remaining).toEqual(
      remainingPlan({ today: TODAY, weekStart: WEEK, targetRunMin: 360, runMinSoFar: 120 }),
    )
    expect(s.remaining).toEqual({ remainingMin: 240, remainingDays: 5, perDayMin: 48 })
  })

  test('has no advisory split without a target, and none left once the target is met', () => {
    expect(strip([], [run(MON, 30)]).remaining).toBeNull()
    const done = strip([], [run(MON, 200)], { targetRunMin: 180 })
    expect(done.remaining).toEqual({ remainingMin: 0, remainingDays: 5, perDayMin: 0 })
  })
})

describe('weekStrip: purity', () => {
  test('is deterministic and leaves its input alone', () => {
    const sessions = [session(MON, 'easy', 'completed'), session(THU, 'long')]
    const activities = [run(MON, 45)]
    const before = JSON.stringify({ sessions, activities })
    const input = { today: TODAY, sessions, activities, targetRunMin: 300 }
    expect(weekStrip(input)).toEqual(weekStrip(input))
    expect(JSON.stringify({ sessions, activities })).toBe(before)
  })
})
