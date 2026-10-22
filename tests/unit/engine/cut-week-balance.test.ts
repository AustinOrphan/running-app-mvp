// A week cut to its ramp limit keeps its balance: the share above zone 1 stays under the F2 cap [rules F2, g-2].
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { intensityMinutes } from '../../../shared/engine/micro.ts'
import type { SessionKind } from '../../../shared/engine/types.ts'
import { athletes, TODAY } from './matrix-fixtures.ts'

const VOLUME: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'easy',
  'recovery',
  'long',
  'strides',
  'threshold',
  'intervals',
  'hills',
  'race-pace',
  'long-fast-finish',
])

describe('a plan cut by the ramp keeps the balance of its weeks', () => {
  const half = athletes().find((a) => a.id === 'half')!
  // The last 14 days are empty and an injury is recent, so every early week is cut to the ramp.
  const plan = buildPlan({
    ...half.input,
    activities: half.input.activities.filter((a) => a.date < addDays(TODAY, -14)),
    profile: {
      ...half.input.profile,
      injuries: [{ area: 'knee', side: 'left', year: 2026, month: 8, kind: 'tendon', notes: null }],
    },
  })

  it('passes every checklist item', () => {
    expect(plan.checklist.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)).toEqual([])
  })

  it('cuts weeks, so the test covers the cut path', () => {
    expect(plan.warnings.some((w) => w.code === 'ramp-tightened')).toBe(true)
    expect(plan.warnings.some((w) => w.code === 'ramp-run-dropped')).toBe(true)
  })

  it('keeps the share above zone 1 at or under 25% in every week', () => {
    const bad: string[] = []
    for (const w of plan.weeks) {
      const runs = plan.sessions.filter(
        (s) => mondayOf(s.date) === w.weekStart && VOLUME.has(s.kind),
      )
      const total = runs.reduce((n, s) => n + s.durationMin, 0)
      const hard = runs.reduce((n, s) => n + intensityMinutes(s), 0)
      if (total > 0 && (hard / total) * 100 > 25 + 1e-6) {
        bad.push(`${w.weekStart}: ${hard.toFixed(1)} of ${total} min`)
      }
    }
    expect(bad).toEqual([])
  })
})
