// Regression tests for the defects the plan matrix and the re-plan exposed in earlier modules (Task E9).
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { applyGuards } from '../../../shared/engine/guards.ts'
import { intensityMinutes, placeWeek } from '../../../shared/engine/micro.ts'
import type { SessionSpec } from '../../../shared/engine/types.ts'
import type { WeekRow } from '../../../shared/types.ts'
import { ZONES, profile, session, state, week } from './e6-fixtures.ts'

const row = (weekStart: string, runMin: number): WeekRow => ({
  weekStart,
  runMin,
  runM: 0,
  runSessions: 4,
  runDays: 4,
  strengthSessions: 0,
  crossMin: 0,
  raceMin: 0,
  longestRunMin: 0,
  longRunShare: null,
  avg4wRunMin: runMin,
  streak3Plus: 0,
})

describe('applyGuards: running already done this week counts toward its ramp [rules g-2]', () => {
  // Wednesday 2026-11-04; 120 min were run on Monday and Tuesday.
  const st = state({
    asOf: '2026-11-04',
    weeks: [row('2026-10-19', 200), row('2026-10-26', 200), row('2026-11-02', 120)],
  })
  const remaining = (): SessionSpec[] =>
    [1, 2, 3, 4].map((d) => session({ date: addDays('2026-11-02', d + 1), durationMin: 50 }))
  const planned = (sessions: SessionSpec[]) =>
    sessions.filter((s) => mondayOf(s.date) === '2026-11-02').reduce((n, s) => n + s.durationMin, 0)

  it('cuts the rest of the week so that done plus planned stays under the ceiling', () => {
    const result = applyGuards(remaining(), st, [])
    // ceiling: 200 x 1.3 = 260 min for the week, of which 120 are done
    expect(planned(result.sessions)).toBeLessThanOrEqual(140)
    expect(planned(result.sessions)).toBeGreaterThan(120)
    expect(result.warnings.some((w) => w.code === 'ramp-ceiling')).toBe(true)
  })

  it('leaves the rest of the week alone when done plus planned fits', () => {
    const fits = [1, 2].map((d) => session({ date: addDays('2026-11-02', d + 1), durationMin: 50 }))
    const result = applyGuards(fits, st, [])
    expect(planned(result.sessions)).toBe(100)
    expect(result.warnings.filter((w) => w.code.startsWith('ramp'))).toEqual([])
  })

  it('measures the next week against the whole of this one, not the part still planned', () => {
    const next = [0, 1, 3, 5].map((d) =>
      session({ date: addDays('2026-11-09', d), durationMin: 60 }),
    )
    const result = applyGuards([...remaining().slice(0, 2), ...next], st, [])
    // base = highest of the two previous weeks = 220 (120 done + 100 planned); soft limit 242
    const nextMin = result.sessions
      .filter((s) => mondayOf(s.date) === '2026-11-09')
      .reduce((n, s) => n + s.durationMin, 0)
    expect(nextMin).toBe(240)
    expect(result.warnings.filter((w) => w.code.startsWith('ramp'))).toEqual([])
  })
})

describe('placeWeek: zone 2 and 3 together stay under the 25% cap [rules F2]', () => {
  const specific = week({
    phase: 'specific',
    targetRunMin: 270,
    longRunMin: 94,
    runDays: 4,
    qualitySessions: 2,
    tid: { z1: 80, z2: 15, z3: 5 },
  })
  const ctx = { profile: profile(), zones: ZONES, state: state({ age: 36 }), prevSessions: [] }

  it('turns the quality session with the most work into an easy run when two pass the cap', () => {
    const sessions = placeWeek(specific, ctx)
    const runs = sessions.filter((s) => s.kind !== 'strength')
    const total = runs.reduce((n, s) => n + s.durationMin, 0)
    const hard = runs.reduce((n, s) => n + intensityMinutes(s), 0)
    expect(hard / total).toBeLessThanOrEqual(0.25)
    // one quality session is left, not none
    expect(runs.filter((s) => ['race-pace', 'threshold'].includes(s.kind))).toHaveLength(1)
  })

  it('leaves a week alone that is already under the cap', () => {
    const easy = week({ ...specific, targetRunMin: 400, longRunMin: 120, runDays: 5 })
    const sessions = placeWeek(easy, ctx)
    const kinds = ['race-pace', 'threshold', 'long-fast-finish']
    expect(sessions.filter((s) => kinds.includes(s.kind))).toHaveLength(2)
  })
})
