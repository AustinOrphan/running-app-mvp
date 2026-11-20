// The cap of the week a hold covers when the reviewed week was run above its plan [rules G-6, owner decision 2026-11-20].
import { describe, expect, it } from 'vitest'
import { weeklyDecision } from '../../../shared/engine/adapt.ts'
import type { EngineInput, WeekDraft } from '../../../shared/engine/types.ts'
import { activity, input, planned, wellnessDay } from './e8-fixtures.ts'

const WEEK = '2026-10-12'
const NEXT = '2026-10-19'
const STABLE = { current: 1, trendPct: 0, samples: 12 }
const DATES = ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-18']
const DAYS = [
  '2026-10-12',
  '2026-10-13',
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
  '2026-10-17',
  '2026-10-18',
]
const HELD = { efficiency: STABLE }
/** Five-hour nights over the reviewed week: a short-night hold (J5), whatever the run share. */
const SHORT_NIGHTS = DAYS.map((date) => wellnessDay(date, { sleepSec: 5 * 3600 }))

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

/** A week run as `minutes`, planned as `plannedMin` over four sessions, then `nextMin` planned. */
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
    wellness: SHORT_NIGHTS,
    ...over,
  })
}

describe('a hold after a week run above its plan', () => {
  it('steps from the minutes run when the week was planned at 0', () => {
    // 28 min run of 0 planned: 28 x 1.1 = 30.8, whole minutes 30; it was 0, and 0 again at the next Monday
    const d = weeklyDecision(week([28], 0, 60), WEEK, HELD)
    expect(d.decision).toBe('hold')
    expect(d.nextWeekTargetMin).toBe(30)
  })

  it('steps from the minutes run for a week run above a plan that was not 0', () => {
    // 100 min run of 60 planned, 120 planned next: the cap was 60, and is now 100 x 1.1 = 110
    const d = weeklyDecision(week([25, 25, 25, 25], 60, 120), WEEK, HELD)
    expect(d.decision).toBe('hold')
    expect(d.nextWeekTargetMin).toBe(110)
  })

  it('never passes the plan for the week it covers', () => {
    // the step would be 110, and the plan holds 90 for that week
    const d = weeklyDecision(week([25, 25, 25, 25], 60, 90), WEEK, HELD)
    expect(d.nextWeekTargetMin).toBe(90)
  })

  it('never falls under the minutes the reviewed week was planned at', () => {
    // the next week is planned lower than this one (a recovery week), and the run was above this one
    const d = weeklyDecision(week([25, 25, 25, 25], 60, 40), WEEK, HELD)
    expect(d.nextWeekTargetMin).toBe(60)
  })

  it('takes the step of the rebuild zone where the plan is in it', () => {
    // 100 min run: 100 x 1.12 = 112 in a zone of 12%
    const d = weeklyDecision(week([25, 25, 25, 25], 60, 120), WEEK, {
      ...HELD,
      rebuild: { ceilingMin: 300, step: 0.12 },
    })
    expect(d.nextWeekTargetMin).toBe(112)
  })

  it('caps a week run at or under its plan as before', () => {
    // 160 of 160 planned: the cap is the plan, 160, not the step of 176
    expect(weeklyDecision(week([40, 40, 40, 40], 160, 400), WEEK, HELD).nextWeekTargetMin).toBe(160)
    // 120 of 160 planned: 120 x 1.1 = 132
    expect(weeklyDecision(week([30, 30, 30, 30], 160, 400), WEEK, HELD).nextWeekTargetMin).toBe(132)
  })

  it('leaves a week with no running to the restart of RF1', () => {
    // nothing run of 0 planned: no step to take, and the plan under the 60 min floor sets no first week
    expect(weeklyDecision(week([], 0, 60), WEEK, HELD).nextWeekTargetMin).toBe(0)
  })

  it('does not apply to a reduce, which keeps the planned figure and its recovery cut', () => {
    const sick = week([25, 25, 25, 25], 60, 120, {
      wellness: [
        ...SHORT_NIGHTS.slice(0, -1),
        wellnessDay('2026-10-18', { sleepSec: 5 * 3600, illness: true }),
      ],
    })
    const d = weeklyDecision(sick, WEEK, { efficiency: STABLE })
    expect(d.decision).toBe('reduce')
    // min(60, 110) = 60, less the recovery week cut
    expect(d.nextWeekTargetMin).toBeLessThan(60)
  })

  it('keeps the planned figure under a hold of the energy-availability screen', () => {
    const d = weeklyDecision(week([25, 25, 25, 25], 60, 120), WEEK, { ...HELD, redsFlags: 2 })
    expect(d.decision).toBe('hold')
    expect(d.nextWeekTargetMin).toBe(60)
  })

  it('keeps the planned figure under a mild pain', () => {
    const sore = week([25, 25, 25, 25], 60, 120, {
      wellness: [
        ...SHORT_NIGHTS.slice(0, -1),
        wellnessDay('2026-10-18', { sleepSec: 5 * 3600, painScore: 2 }),
      ],
    })
    const d = weeklyDecision(sore, WEEK, HELD)
    expect(d.decision).toBe('hold')
    expect(d.signals.map((s) => s.code)).toContain('pain-mild')
    expect(d.nextWeekTargetMin).toBe(60)
  })
})
