// weekCaps: the owner's or the weekly decision's lower number sizes the sessions of a week [rules g-2, J5].
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import type { EngineInput } from '../../../shared/engine/types.ts'
import { windowOf } from './disruption-fixtures.ts'
import { athletes, TODAY } from './matrix-fixtures.ts'

const half = athletes().find((a) => a.id === 'half')!

describe('replan with week caps', () => {
  const plan = buildPlan(half.input)
  const existing: NonNullable<EngineInput['existing']> = {
    weeks: plan.weeks,
    sessions: plan.sessions.map((s, i) => ({
      ...s,
      id: `s${i}`,
      status: 'planned',
      activityId: null,
    })),
  }
  const target = mondayOf(addDays(TODAY, 14))
  const minutes = (sessions: typeof plan.sessions) =>
    sessions
      .filter((s) => mondayOf(s.date) === target && !['strength', 'race'].includes(s.kind))
      .reduce((n, s) => n + s.durationMin, 0)

  it('places the sessions of a capped week against the lower target', () => {
    const open = replan({ ...half.input, existing })
    const capped = replan({ ...half.input, existing, weekCaps: { [target]: 120 } })
    expect(minutes(open.draft.sessions)).toBeGreaterThan(120)
    expect(minutes(capped.draft.sessions)).toBeLessThanOrEqual(120)
    expect(minutes(capped.draft.sessions)).toBeGreaterThan(0)
    expect(capped.draft.weeks.find((w) => w.weekStart === target)!.targetRunMin).toBe(120)
  })

  it('ignores a cap above the target', () => {
    const open = replan({ ...half.input, existing })
    const capped = replan({ ...half.input, existing, weekCaps: { [target]: 10_000 } })
    expect(capped.draft).toEqual(open.draft)
  })
})

describe('replan with week caps and a rest window', () => {
  // Ill from Thu 22 to Sat 24 October: Thursday to Sunday are held, three easy days follow.
  const plan = buildPlan(half.input)
  const existing: NonNullable<EngineInput['existing']> = {
    weeks: plan.weeks,
    sessions: plan.sessions.map((s, i) => ({
      ...s,
      id: `s${i}`,
      status: 'planned',
      activityId: null,
    })),
  }
  const window = windowOf({
    reason: 'illness-above-neck',
    startDate: addDays(TODAY, 1),
    endDate: addDays(TODAY, 3),
  })
  const windowed = { ...half.input, existing, disruptions: [window] }
  const week = mondayOf(TODAY)
  const next = addDays(week, 7)
  const minutesOf = (sessions: typeof plan.sessions, monday: string) =>
    sessions
      .filter((s) => mondayOf(s.date) === monday && !['strength', 'race', 'rest'].includes(s.kind))
      .reduce((n, s) => n + s.durationMin, 0)

  it('takes the lower of the cap of the owner or the decision and what the window leaves', () => {
    const open = replan(windowed)
    expect(minutesOf(open.draft.sessions, next)).toBeGreaterThan(100)
    const capped = replan({ ...windowed, weekCaps: { [next]: 100 } })
    expect(minutesOf(capped.draft.sessions, next)).toBeLessThanOrEqual(100)
    expect(minutesOf(capped.draft.sessions, next)).toBeGreaterThan(0)
    // the week the window holds: a cap under what it leaves lowers it further
    const left = minutesOf(open.draft.sessions, week)
    expect(left).toBeGreaterThan(20)
    const tight = replan({ ...windowed, weekCaps: { [week]: left - 20 } })
    expect(minutesOf(tight.draft.sessions, week)).toBeLessThanOrEqual(left - 20)
  })

  it('ignores a cap above what the window leaves, as it ignores one above the target', () => {
    const open = replan(windowed)
    expect(replan({ ...windowed, weekCaps: { [next]: 10_000 } }).draft).toEqual(open.draft)
    expect(replan({ ...windowed, weekCaps: { [week]: 10_000 } }).draft).toEqual(open.draft)
  })
})
