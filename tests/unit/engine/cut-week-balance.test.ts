// A week cut to its ramp limit keeps its balance: the share above zone 1 stays under the F2 cap [rules F2, g-2].
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { applyGuards } from '../../../shared/engine/guards.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { intensityMinutes } from '../../../shared/engine/micro.ts'
import type { EngineInput, SessionKind, SessionSpec } from '../../../shared/engine/types.ts'
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

function overCap(sessions: SessionSpec[]): string[] {
  const bad: string[] = []
  for (const weekStart of new Set(sessions.map((s) => mondayOf(s.date)))) {
    const runs = sessions.filter((s) => mondayOf(s.date) === weekStart && VOLUME.has(s.kind))
    const total = runs.reduce((n, s) => n + s.durationMin, 0)
    const hard = runs.reduce((n, s) => n + intensityMinutes(s), 0)
    if (total > 0 && (hard / total) * 100 > 25 + 1e-6) {
      bad.push(`${weekStart}: ${hard.toFixed(1)} of ${total} min`)
    }
  }
  return bad
}

describe('a plan cut by the ramp keeps the balance of its weeks', () => {
  const half = athletes().find((a) => a.id === 'half')!
  // The last 14 days are empty and an injury is recent: the tightened ramp holds every early week.
  const injured: EngineInput = {
    ...half.input,
    activities: half.input.activities.filter((a) => a.date < addDays(TODAY, -14)),
    profile: {
      ...half.input.profile,
      injuries: [{ area: 'knee', side: 'left', year: 2026, month: 8, kind: 'tendon', notes: null }],
    },
  }
  const plan = buildPlan(injured)

  it('passes every checklist item', () => {
    expect(plan.checklist.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)).toEqual([])
  })

  // Task E21: the generator plans inside the tightened ramp, so its own plan is never cut. The cut
  // path is driven here with the plan the same athlete would get without the injury.
  const open = buildPlan({ ...injured, profile: half.input.profile })
  const cut = applyGuards(
    open.sessions.filter((s) => s.kind !== 'race'),
    estimateState(injured),
    injured.activities,
    {
      neverOverride: true,
      lowWeeks: open.weeks.filter((w) => w.isRecovery || w.isTaper).map((w) => w.weekStart),
    },
  )

  it('is planned inside the tightened ramp, so the guards cut nothing', () => {
    expect(plan.warnings.filter((w) => w.code.startsWith('ramp-'))).toEqual([])
  })

  it('cuts weeks, so the test covers the cut path', () => {
    expect(cut.warnings.some((w) => w.code === 'ramp-tightened')).toBe(true)
    expect(cut.warnings.some((w) => w.code === 'ramp-run-dropped')).toBe(true)
  })

  it('keeps the share above zone 1 at or under 25% in every week', () => {
    expect(overCap(plan.sessions)).toEqual([])
    expect(overCap(cut.sessions)).toEqual([])
  })
})
