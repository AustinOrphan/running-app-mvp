// The next week's suggested minutes: whole minutes, and held to the profile's tightened ramp [rules G-6, G-3].
import { describe, expect, it } from 'vitest'
import { weeklyDecision } from '../../../shared/engine/adapt.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { weeklyRamp } from '../../../shared/engine/index.ts'
import type { EngineInput, WeekDraft } from '../../../shared/engine/types.ts'
import { activity, input, planned, profile } from './e8-fixtures.ts'

const WEEK = '2026-10-12'
const NEXT = '2026-10-19'
const STABLE = { current: 1, trendPct: 0, samples: 12 }
const DATES = ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-18']

function weekDraft(weekStart: string, targetRunMin: number): WeekDraft {
  return {
    weekStart,
    index: 0,
    phase: 'build',
    focus: '',
    targetRunMin,
    longRunMin: 0,
    longRunM: null,
    gainTargetM: null,
    runDays: 4,
    qualitySessions: 1,
    strengthSessions: 0,
    tid: { z1: 0.8, z2: 0.1, z3: 0.1 },
    flags: [],
    isRecovery: false,
    isTaper: false,
  }
}

/** A week run as `minutes`, planned as `plannedMin` over four easy sessions, then `nextMin` planned. */
function week(
  minutes: number[],
  plannedMin: number,
  nextMin: number,
  over: Partial<EngineInput> = {},
): EngineInput {
  return input({
    activities: minutes.map((m, n) => activity(DATES[n]!, { durationSec: m * 60, id: `act${n}` })),
    existing: {
      weeks: [weekDraft(WEEK, plannedMin), weekDraft(NEXT, nextMin)],
      sessions: DATES.map((date, n) =>
        planned(`p${n}`, date, 'easy', { durationMin: plannedMin / 4 }),
      ),
    },
    ...over,
  })
}

describe('nextWeekTargetMin', () => {
  it('is a whole number of minutes that never passes the cap', () => {
    // 161 min run: 161 x 1.1 = 177.1
    const d = weeklyDecision(week([40, 40, 40, 41], 160, 400), WEEK, { efficiency: STABLE })
    expect(d.decision).toBe('progress')
    expect(d.nextWeekTargetMin).toBe(177)
  })

  it('is whole for a hold too', () => {
    const d = weeklyDecision(week([40, 40, 41, 0], 240, 400), WEEK, { efficiency: STABLE })
    expect(d.decision).toBe('hold')
    expect(Number.isInteger(d.nextWeekTargetMin)).toBe(true)
  })
})

describe('the tightened ramp of a bone stress history', () => {
  const bsi = profile({
    sex: 'female',
    injuries: [
      { area: 'tibia', side: 'left', year: 2026, month: 4, kind: 'bone-stress', notes: null },
    ],
  })

  it('caps the next week at 5% over the week run, not 10%', () => {
    const i = week([25, 25, 25, 25], 105, 110, { profile: bsi })
    const ramp = weeklyRamp(estimateState(i))
    expect(ramp).toBeLessThanOrEqual(0.05)
    expect(weeklyDecision(i, WEEK, { efficiency: STABLE, ramp }).nextWeekTargetMin).toBe(105)
    // the default 10% would suggest more
    expect(weeklyDecision(i, WEEK, { efficiency: STABLE }).nextWeekTargetMin).toBe(110)
  })
})
