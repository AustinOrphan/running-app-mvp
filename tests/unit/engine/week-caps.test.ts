// weekCaps: the owner's or the weekly decision's lower number sizes the sessions of a week [rules g-2, J5].
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import type { EngineInput } from '../../../shared/engine/types.ts'
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
