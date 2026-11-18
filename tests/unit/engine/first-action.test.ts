// The first step with no plan (FH1a): `firstActionFor` reads the engine's start path (rules E6, G-3),
// so the reason is the one `generate` starts from. Synthetic runners; no personal data.
import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { afterBreak } from '../../../shared/engine/adapt.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { firstActionFor } from '../../../shared/engine/firstAction.ts'
import { startLevelMin } from '../../../shared/engine/limits.ts'
import { startPath } from '../../../shared/engine/macro.ts'
import type { Activity, AthleteProfile } from '../../../shared/types.ts'
import { activity, input, profile, TODAY } from './e8-fixtures.ts'

const runOf = (daysBack: number, minutes: number): Activity =>
  activity(addDays(TODAY, -daysBack), {
    id: `run-${String(daysBack)}`,
    durationSec: minutes * 60,
    movingSec: minutes * 60,
    distanceM: Math.round(minutes * 160),
  })

function firstOf(activities: Activity[], over: Partial<AthleteProfile> = {}) {
  const inp = input({ activities, profile: profile(over) })
  return { inp, state: estimateState(inp), action: firstActionFor(inp, estimateState(inp)) }
}

describe('firstActionFor', () => {
  it('asks for runs when there are none', () => {
    const { action } = firstOf([], { runningSinceYear: null })
    expect(action).toEqual({ reason: 'runs', levelMin: 0, floorMin: 60 })
  })

  it('asks for runs when the start level sits under 3 x 20 minutes', () => {
    const { action, inp, state } = firstOf([runOf(3, 15), runOf(6, 15)], { runningSinceYear: null })
    expect(action.reason).toBe('runs')
    expect(action.levelMin).toBeLessThan(action.floorMin)
    expect(startPath(inp, state)).not.toBeNull()
  })

  it('asks for a goal when four weeks of 3 x 30 minutes are on file', () => {
    const week = (back: number) => [0, 2, 4].map((d) => runOf(back * 7 + d + 4, 30))
    const runs = [1, 2, 3, 4].flatMap(week)
    const { action, inp, state } = firstOf(runs)
    expect(action.reason).toBe('goal')
    // the level is read as the plan reads it, after a break
    expect(action.levelMin).toBe(startLevelMin(afterBreak(state)))
    expect(action.levelMin).toBeGreaterThanOrEqual(action.floorMin)
    expect(startPath(inp, state)).toBeNull()
  })

  it('leaves an injury-return start to the goal: more runs would not change it', () => {
    const injured = {
      runningSinceYear: 2023,
      injuries: [
        {
          area: 'knee',
          side: 'left' as const,
          year: 2026,
          month: 6,
          kind: 'joint' as const,
          notes: null,
        },
      ],
    }
    const { action, inp, state } = firstOf([], injured)
    expect(startPath(inp, state)?.kind).toBe('injury-return')
    expect(action.reason).toBe('goal')
  })
})
