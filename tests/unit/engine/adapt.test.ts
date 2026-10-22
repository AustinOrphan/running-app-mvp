import { describe, expect, it, vi } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import {
  breakRestart,
  shouldTrimQuality,
  trimQuality,
  weekEvidence,
  weeklyDecision,
  zoneProposals,
  type ExecutionRecord,
} from '../../../shared/engine/adapt.ts'
import { readinessSnapshot } from '../../../shared/engine/readiness.ts'
import type {
  EngineInput,
  ExecutionAssessment,
  SessionKind,
  WeekDraft,
} from '../../../shared/engine/types.ts'
import type { Activity } from '../../../shared/types.ts'
import {
  activity,
  input,
  planned,
  profile,
  review,
  spec,
  TODAY,
  wellnessDay,
  type ExistingSession,
} from './e8-fixtures.ts'

// Task E6 owns nextWeekCap; the formula of rule G-6 stands in until that module lands.
vi.mock('../../../shared/engine/guards.ts', () => ({
  nextWeekCap: (plannedMin: number, actualLastWeekMin: number, ramp: number) =>
    Math.min(plannedMin, Math.round(actualLastWeekMin * (1 + ramp))),
}))

const WEEK = '2026-10-12' // the completed week under review
const NEXT = '2026-10-19'
const STABLE = { current: 1, trendPct: 0, samples: 12 }

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

/** Four sessions of 50 minutes in the week under review: 200 planned minutes. */
function weekSessions(): ExistingSession[] {
  return [
    planned('p1', '2026-10-12', 'easy', { durationMin: 50 }),
    planned('p2', '2026-10-14', 'threshold', { durationMin: 50 }),
    planned('p3', '2026-10-16', 'easy', { durationMin: 50 }),
    planned('p4', '2026-10-18', 'long', { durationMin: 50 }),
  ]
}

function runs(minutes: number[]) {
  const dates = ['2026-10-12', '2026-10-14', '2026-10-16', '2026-10-18']
  return minutes.map((m, n) => activity(dates[n]!, { durationSec: m * 60, id: `act${n}` }))
}

function base(over: Partial<EngineInput> = {}): EngineInput {
  return input({
    activities: runs([50, 50, 50, 50]),
    existing: {
      weeks: [weekDraft(WEEK, 200), weekDraft(NEXT, 210)],
      sessions: weekSessions(),
    },
    ...over,
  })
}

const codes = (d: ReturnType<typeof weeklyDecision>) => d.signals.map((s) => s.code)

describe('breakRestart (J7)', () => {
  it('restarts at 100% under 7 days', () => {
    expect(breakRestart(3, 300)).toEqual({ restartMin: 300, fraction: 1, runWalk: false })
    expect(breakRestart(6, 300).fraction).toBe(1)
  })

  it('restarts at 90% for 7-14 days, 75% for 15-28 and 50% beyond', () => {
    expect(breakRestart(7, 300)).toEqual({ restartMin: 270, fraction: 0.9, runWalk: false })
    expect(breakRestart(14, 300).fraction).toBe(0.9)
    expect(breakRestart(15, 300)).toEqual({ restartMin: 225, fraction: 0.75, runWalk: false })
    expect(breakRestart(28, 300).fraction).toBe(0.75)
    expect(breakRestart(29, 300)).toEqual({ restartMin: 150, fraction: 0.5, runWalk: false })
  })

  it('uses run-walk after over 28 days only with under 6 consistent months before', () => {
    expect(breakRestart(40, 200, 3).runWalk).toBe(true)
    expect(breakRestart(40, 200, 12).runWalk).toBe(false)
    expect(breakRestart(40, 200).runWalk).toBe(false)
    expect(breakRestart(20, 200, 3).runWalk).toBe(false)
  })
})

describe('trimQuality (design 4.3)', () => {
  const intervals = spec('2026-10-22', 'intervals', {
    durationMin: 60,
    distanceM: 10_000,
    structure: [
      { kind: 'warmup', reps: 1, durationSec: 900, distanceM: null, zone: 'z1' },
      { kind: 'work', reps: 6, durationSec: 240, distanceM: null, zone: 'z3' },
      { kind: 'recover', reps: 6, durationSec: 120, distanceM: null, zone: 'z1' },
      { kind: 'cooldown', reps: 1, durationSec: 600, distanceM: null, zone: 'z1' },
    ],
  })

  it('drops reps and shortens the session', () => {
    const out = trimQuality(intervals, 'Two hard efforts in a row.')
    expect(out.structure.find((s) => s.kind === 'work')!.reps).toBe(4)
    expect(out.structure.find((s) => s.kind === 'recover')!.reps).toBe(4)
    expect(out.durationMin).toBe(48)
    expect(out.distanceM).toBe(8000)
    expect(out.purpose).toContain('Two hard efforts in a row.')
    expect(out.rules).toContain('design-4.3')
  })

  it('shortens a single continuous block', () => {
    const threshold = spec('2026-10-22', 'threshold', {
      durationMin: 60,
      structure: [{ kind: 'work', reps: 1, durationSec: 1800, distanceM: null, zone: 'z3' }],
    })
    const out = trimQuality(threshold, 'reason')
    expect(out.structure[0]!.durationSec).toBe(1350)
    expect(out.durationMin).toBeLessThan(60)
  })

  it('scales a session with no structure', () => {
    const out = trimQuality(spec('2026-10-22', 'hills', { durationMin: 60 }), 'reason')
    expect(out.durationMin).toBe(45)
  })

  it('never changes an easy run and never mutates its input', () => {
    const easy = spec('2026-10-22', 'easy')
    expect(trimQuality(easy, 'reason')).toEqual(easy)
    const snapshot = structuredClone(intervals)
    trimQuality(intervals, 'reason')
    expect(intervals).toEqual(snapshot)
  })

  it('keeps at least one rep', () => {
    const one = spec('2026-10-22', 'intervals', {
      structure: [{ kind: 'work', reps: 2, durationSec: 240, distanceM: null, zone: 'z3' }],
    })
    expect(trimQuality(one, 'reason').structure[0]!.reps).toBeGreaterThanOrEqual(1)
  })
})

describe('shouldTrimQuality (design 4.3)', () => {
  it('trims after a +2, or after +1 twice in a row', () => {
    expect(shouldTrimQuality([0, 2])).toBe(true)
    expect(shouldTrimQuality([1, 1])).toBe(true)
    expect(shouldTrimQuality([1, 0, 1])).toBe(false)
    expect(shouldTrimQuality([2, 0])).toBe(false)
    expect(shouldTrimQuality([])).toBe(false)
  })
})

describe('weeklyDecision (J5, G-6)', () => {
  it('progresses when the week was completed with nothing flagged', () => {
    const d = weeklyDecision(base(), WEEK, { efficiency: STABLE })
    expect(d.decision).toBe('progress')
    expect(d.signals).toEqual([])
    // min(planned next week 210, 200 actual x 1.1 = 220)
    expect(d.nextWeekTargetMin).toBe(210)
  })

  it('holds at 75% completion and does not make up the missed minutes', () => {
    const d = weeklyDecision(base({ activities: runs([50, 50, 50, 0]).slice(0, 3) }), WEEK, {
      efficiency: STABLE,
    })
    expect(d.decision).toBe('hold')
    expect(codes(d)).toEqual(['completion-low'])
    // min(planned 200, actual 150 x 1.1 = 165)
    expect(d.nextWeekTargetMin).toBe(165)
  })

  it('caps the next week at last actual x (1 + ramp) even when the plan says more', () => {
    const lots = base({
      activities: runs([50, 50, 50, 50]),
      existing: { weeks: [weekDraft(WEEK, 200), weekDraft(NEXT, 400)], sessions: weekSessions() },
    })
    expect(weeklyDecision(lots, WEEK, { efficiency: STABLE }).nextWeekTargetMin).toBe(220)
  })

  it('judges only the sessions already due in a week still in progress', () => {
    const i = input({
      today: '2026-10-21',
      activities: [
        activity('2026-10-19', { durationSec: 3000 }),
        activity('2026-10-20', { durationSec: 3000 }),
      ],
      existing: {
        weeks: [weekDraft(NEXT, 200)],
        sessions: [
          planned('a', '2026-10-19', 'easy', { durationMin: 50 }),
          planned('b', '2026-10-20', 'easy', { durationMin: 50 }),
          planned('c', '2026-10-22', 'easy', { durationMin: 50 }),
          planned('d', '2026-10-24', 'long', { durationMin: 50 }),
        ],
      },
    })
    expect(weeklyDecision(i, NEXT, { efficiency: STABLE }).decision).toBe('progress')
  })

  it('holds on a sleep average under 7 hours', () => {
    const wellness = Array.from({ length: 7 }, (_, n) =>
      wellnessDay(addDays(TODAY, -n), { sleepSec: 6 * 3600 }),
    )
    const d = weeklyDecision(base({ wellness }), WEEK, { efficiency: STABLE })
    expect(d.decision).toBe('hold')
    expect(codes(d)).toEqual(['sleep-warning'])
  })

  it('holds on two or more REDs flags and on the first days of heat', () => {
    expect(codes(weeklyDecision(base(), WEEK, { efficiency: STABLE, redsFlags: 2 }))).toEqual([
      'reds',
    ])
    expect(weeklyDecision(base(), WEEK, { efficiency: STABLE, redsFlags: 1 }).decision).toBe(
      'progress',
    )
    const heat = weeklyDecision(base(), WEEK, { efficiency: STABLE, heatFirstDays: true })
    expect(heat.decision).toBe('hold')
    expect(codes(heat)).toEqual(['heat'])
  })

  const poorWeek = Array.from({ length: 5 }, (_, n) =>
    wellnessDay(addDays(WEEK, n), { fatigue: 5, soreness: 4, mood: 2 }),
  )

  it('holds on one sustained signal', () => {
    const d = weeklyDecision(base({ wellness: poorWeek }), WEEK, { efficiency: STABLE })
    expect(d.decision).toBe('hold')
    expect(codes(d)).toEqual(['subjective-decline'])
    const eff = weeklyDecision(base(), WEEK, {
      efficiency: { current: 1, trendPct: -4, samples: 12 },
    })
    expect(eff.decision).toBe('hold')
    expect(codes(eff)).toEqual(['efficiency-decline'])
  })

  it('reduces on two independent signals persisting through the week', () => {
    const d = weeklyDecision(base({ wellness: poorWeek }), WEEK, {
      efficiency: { current: 1, trendPct: -4, samples: 12 },
    })
    expect(d.decision).toBe('reduce')
    expect(codes(d)).toEqual(['subjective-decline', 'efficiency-decline'])
    // recovery week: min(200, 220) cut by 25%
    expect(d.nextWeekTargetMin).toBe(150)
  })

  it('treats a sleep-efficiency drop as the third independent signal', () => {
    const d = weeklyDecision(base(), WEEK, {
      efficiency: { current: 1, trendPct: -4, samples: 12 },
      sleepEfficiencyDropPp: 2.5,
    })
    expect(d.decision).toBe('reduce')
    expect(codes(d)).toEqual(['efficiency-decline', 'sleep-efficiency-drop'])
  })

  it('never lets HRV alone change the decision', () => {
    const hrv = [
      ...Array.from({ length: 10 }, (_, n) => wellnessDay(addDays(WEEK, n - 10), { hrvRmssd: 60 })),
      ...Array.from({ length: 5 }, (_, n) => wellnessDay(addDays(WEEK, n), { hrvRmssd: 30 })),
    ]
    const d = weeklyDecision(base({ wellness: hrv }), WEEK, { efficiency: STABLE })
    expect(d.decision).toBe('progress')
    expect(codes(d)).toEqual([])
  })

  it('never lets a suppression made of HRV alone insert a recovery week', () => {
    // A steady fall of 6% a day flags every day as a two-day decline, for 16 days to the week end.
    const end = addDays(WEEK, 6)
    const falling = Array.from({ length: 16 }, (_, n) =>
      wellnessDay(addDays(end, n - 15), { hrvRmssd: 60 * 0.94 ** (n + 1) }),
    )
    const steady = Array.from({ length: 10 }, (_, n) =>
      wellnessDay(addDays(end, n - 25), { hrvRmssd: 60 }),
    )
    const i = base({ wellness: [...steady, ...falling] })
    expect(readinessSnapshot(i, end).state).toBe('persistent-suppression')
    const d = weeklyDecision(i, WEEK, { efficiency: STABLE })
    expect(d.decision).toBe('progress')
    expect(codes(d)).toEqual([])
  })

  it('holds on mild pain below the red-flag score', () => {
    const d = weeklyDecision(
      base({ wellness: [wellnessDay('2026-10-15', { painScore: 2 })] }),
      WEEK,
      {
        efficiency: STABLE,
      },
    )
    expect(d.decision).toBe('hold')
    expect(codes(d)).toEqual(['pain-mild'])
  })

  it('holds while a readiness flag with a poor check-in is active at the week end', () => {
    const poor = { fatigue: 5, soreness: 4, mood: 2 }
    const wellness = [wellnessDay('2026-10-17', poor), wellnessDay('2026-10-18', poor)]
    const d = weeklyDecision(base({ wellness }), WEEK, { efficiency: STABLE })
    expect(d.decision).toBe('hold')
    expect(codes(d)).toEqual(['readiness-flag'])
  })

  it('reduces on reported illness or pain', () => {
    const ill = base({ wellness: [wellnessDay('2026-10-14', { illness: true })] })
    const a = weeklyDecision(ill, WEEK, { efficiency: STABLE })
    expect(a.decision).toBe('reduce')
    expect(codes(a)).toEqual(['illness'])
    const hurt = base({ wellness: [wellnessDay('2026-10-15', { painScore: 5 })] })
    const b = weeklyDecision(hurt, WEEK, { efficiency: STABLE })
    expect(b.decision).toBe('reduce')
    expect(codes(b)).toEqual(['pain'])
  })

  it('counts harder-than-expected effort on two sessions as a subjective decline', () => {
    const exec = (
      date: string,
      kind: SessionKind,
      score: -2 | -1 | 0 | 1 | 2,
    ): ExecutionRecord => ({
      date,
      kind,
      assessment: assessment(score),
    })
    const executions = [exec('2026-10-12', 'easy', 1), exec('2026-10-14', 'threshold', 2)]
    const d = weeklyDecision(base(), WEEK, { efficiency: STABLE, executions })
    expect(codes(d)).toEqual(['subjective-decline'])
    const once = weeklyDecision(base(), WEEK, { efficiency: STABLE, executions: [executions[0]!] })
    expect(once.decision).toBe('progress')
  })

  it('ignores harder-than-expected verdicts that rest on heart rate or pace alone', () => {
    // No RPE and no feel: the score is a low-confidence guess and never counts as a decline.
    const unrated = (date: string, kind: SessionKind): ExecutionRecord => ({
      date,
      kind,
      assessment: {
        ...assessment(1),
        effort: {
          ...assessment(1).effort,
          confidence: 'low',
          parts: { rpeDelta: null, feel: null, hrResidualZ: 2, paceResidualPct: null },
        },
      },
    })
    const executions = [unrated('2026-10-12', 'easy'), unrated('2026-10-14', 'threshold')]
    const d = weeklyDecision(base(), WEEK, { efficiency: STABLE, executions })
    expect(d.decision).toBe('progress')
    expect(codes(d)).toEqual([])
  })

  it('derives effort from RPE and the feel rating when no assessment is passed', () => {
    const sessions = weekSessions().map((s, n) => ({
      ...s,
      status: 'completed',
      activityId: `act${n}`,
    }))
    const hard = runs([50, 50, 50, 50]).map((a, n) =>
      n < 2 ? { ...a, rpe: 8, feel: 2 as const } : a,
    )
    const i = base({
      activities: hard,
      existing: { weeks: [weekDraft(WEEK, 200), weekDraft(NEXT, 210)], sessions },
    })
    expect(codes(weeklyDecision(i, WEEK, { efficiency: STABLE }))).toEqual(['subjective-decline'])
  })

  it('counts a high review fatigue rating or persistent symptoms', () => {
    const fatigued = base({ reviews: [review(WEEK, { fatigue: 7 })] })
    expect(codes(weeklyDecision(fatigued, WEEK, { efficiency: STABLE }))).toEqual([
      'subjective-decline',
    ])
    const symptoms = base({ reviews: [review(WEEK, { symptoms: 'persistent' })] })
    expect(codes(weeklyDecision(symptoms, WEEK, { efficiency: STABLE }))).toEqual([
      'subjective-decline',
    ])
  })

  it('uses copy without red states or blame', () => {
    const d = weeklyDecision(base({ wellness: poorWeek }), WEEK, {
      efficiency: { current: 1, trendPct: -4, samples: 12 },
    })
    const text = d.signals.map((s) => s.detail).join(' ')
    expect(text).not.toMatch(/behind|missed|streak|failed/i)
  })
})

function assessment(
  score: -2 | -1 | 0 | 1 | 2,
  flags: ExecutionAssessment['flags'] = [],
): ExecutionAssessment {
  return {
    completion: 'completed',
    intensity: 'on',
    effort: {
      score,
      confidence: 'high',
      parts: { rpeDelta: null, feel: score, hrResidualZ: null, paceResidualPct: null },
    },
    conditions: { wbgtC: null, heatAdjusted: false, gradeAdjusted: false },
    flags,
    lines: [],
  }
}

describe('zoneProposals (C8, design 4.3)', () => {
  /** Quality sessions on consecutive days ending yesterday, each linked to a rated activity. */
  function quality(feels: Array<-2 | -1 | 0 | 1 | 2>, over: Partial<ExistingSession> = {}) {
    const sessions: ExistingSession[] = []
    const activities: Activity[] = []
    feels.forEach((feel, n) => {
      const date = addDays(TODAY, -(feels.length - n) * 3)
      const id = `act-${n}`
      sessions.push(
        planned(`s${n}`, date, n % 2 ? 'intervals' : 'threshold', {
          status: 'completed',
          activityId: id,
          ...over,
        }),
      )
      activities.push(activity(date, { id, feel }))
    })
    return input({
      profile: profile({ thresholdPaceSecPerKm: 300 }),
      activities,
      existing: { weeks: [], sessions },
    })
  }

  it('proposes a faster threshold pace after three easier-than-expected sessions', () => {
    const out = zoneProposals(quality([-2, -1, -2]))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ boundary: 'thresholdPace', from: 300, to: 294, observations: 3 })
    expect(out[0]!.rules).toContain('C8')
    expect(out[0]!.reason).not.toMatch(/behind|missed/i)
  })

  it('proposes a slower pace after three harder-than-expected sessions', () => {
    const out = zoneProposals(quality([2, 1, 2]))
    expect(out[0]).toMatchObject({ boundary: 'thresholdPace', from: 300, to: 306 })
  })

  it('needs three concordant observations', () => {
    expect(zoneProposals(quality([-2, -2]))).toEqual([])
    expect(zoneProposals(quality([-2, 0, -2]))).toEqual([])
    expect(zoneProposals(quality([-2, 2, -2]))).toEqual([])
  })

  it('uses only the latest three observations', () => {
    expect(zoneProposals(quality([2, -2, -2, -2]))).toHaveLength(1)
  })

  it('ignores easy sessions, old sessions and sessions without a linked activity', () => {
    const i = quality([-2, -2, -2])
    const easyOnly = {
      ...i,
      existing: {
        weeks: [],
        sessions: i.existing!.sessions.map((s) => ({ ...s, kind: 'easy' as const })),
      },
    }
    expect(zoneProposals(easyOnly)).toEqual([])
    const unlinked = {
      ...i,
      existing: {
        weeks: [],
        sessions: i.existing!.sessions.map((s) => ({ ...s, activityId: null })),
      },
    }
    expect(zoneProposals(unlinked)).toEqual([])
    expect(zoneProposals({ ...i, today: addDays(TODAY, 120) })).toEqual([])
  })

  it('excludes heat-flagged sessions and sessions with pain', () => {
    expect(zoneProposals(quality([-2, -2, -2], { flags: ['heat'] }))).toEqual([])
    const i = quality([-2, -2, -2])
    const hurt = { ...i, activities: i.activities.map((a) => ({ ...a, pain: 5 })) }
    expect(zoneProposals(hurt)).toEqual([])
  })

  it('makes no proposal without a threshold pace to move', () => {
    const i = quality([-2, -2, -2])
    expect(zoneProposals({ ...i, profile: profile({ thresholdPaceSecPerKm: null }) })).toEqual([])
  })

  it('ignores observations that rest on heart rate or pace alone', () => {
    const i = quality([0, 0, 0])
    const guess = (score: -2 | -1 | 0 | 1 | 2): ExecutionAssessment => {
      const a = assessment(score)
      return {
        ...a,
        effort: {
          ...a.effort,
          parts: { rpeDelta: null, feel: null, hrResidualZ: -2, paceResidualPct: null },
        },
      }
    }
    const executions = (make: (n: number) => ExecutionAssessment): ExecutionRecord[] =>
      i.existing!.sessions.map((s, n) => ({ date: s.date, kind: s.kind, assessment: make(n) }))
    expect(
      zoneProposals(
        i,
        executions(() => guess(-1)),
      ),
    ).toEqual([])
    // One guess among three rated sessions leaves only two observations.
    const mixed = executions((n) => (n === 1 ? guess(-1) : assessment(-1)))
    expect(zoneProposals(i, mixed)).toEqual([])
    expect(
      zoneProposals(
        i,
        executions(() => assessment(-1)),
      ),
    ).toHaveLength(1)
  })

  it('ignores observations on or before the last accepted change of the boundary', () => {
    const i = quality([-2, -2, -2])
    const dates = i.existing!.sessions.map((s) => s.date).sort()
    expect(zoneProposals(i)).toHaveLength(1)
    // The change came after the second observation: only one is left.
    expect(zoneProposals({ ...i, zoneChanges: { thresholdPace: dates[1]! } })).toEqual([])
    expect(zoneProposals({ ...i, zoneChanges: { thresholdPace: TODAY } })).toEqual([])
    // A change before every observation, or of another boundary, leaves them all.
    expect(
      zoneProposals({ ...i, zoneChanges: { thresholdPace: addDays(dates[0]!, -1) } }),
    ).toHaveLength(1)
    expect(zoneProposals({ ...i, zoneChanges: { hrMax: TODAY } })).toHaveLength(1)
    // Three new observations after the change propose again.
    const later = quality([-2, -2, -2, -2, -2, -2])
    const laterDates = later.existing!.sessions.map((s) => s.date).sort()
    const out = zoneProposals({ ...later, zoneChanges: { thresholdPace: laterDates[2]! } })
    expect(out).toHaveLength(1)
    expect(out[0]!.observations).toBe(3)
  })

  it('prefers the execution assessments when they are passed', () => {
    const i = quality([0, 0, 0])
    const executions: ExecutionRecord[] = i.existing!.sessions.map((s) => ({
      date: s.date,
      kind: s.kind,
      assessment: assessment(-1),
    }))
    expect(zoneProposals(i, executions)).toHaveLength(1)
    const tainted = executions.map((e) => ({ ...e, assessment: assessment(-1, ['heat']) }))
    expect(zoneProposals(i, tainted)).toEqual([])
  })
})

describe('weekEvidence: what a finished week shows the start paths [rules E6, G-3]', () => {
  const weekRuns = (over: Partial<Activity> = {}) => [
    activity('2026-10-13', { id: 'w1', durationSec: 1200, ...over }),
    activity('2026-10-15', { id: 'w2', durationSec: 1200, ...over }),
    activity('2026-10-17', { id: 'w3', durationSec: 1200, ...over }),
  ]

  it('gives minutes run, minutes planned, the share and the number of runs', () => {
    const inp = input({
      activities: weekRuns(),
      existing: {
        weeks: [weekDraft(WEEK, 63)],
        sessions: [],
      },
    })
    const ev = weekEvidence(inp, WEEK)
    expect(ev.actualMin).toBe(60)
    expect(ev.plannedMin).toBe(63)
    expect(ev.share).toBeCloseTo(60 / 63, 9)
    expect(ev.runs).toBe(3)
    expect(ev.meanRpe).toBeNull()
    expect(ev.worstPain).toBe(0)
  })

  it('plans from the sessions of the week when it has them, and says nothing without a plan', () => {
    const sessions = [
      planned('s1', '2026-10-13', 'easy', { durationMin: 20 }),
      planned('s2', '2026-10-15', 'easy', { durationMin: 20 }),
    ]
    const inp = input({
      activities: weekRuns(),
      existing: { weeks: [weekDraft(WEEK, 99)], sessions },
    })
    expect(weekEvidence(inp, WEEK).plannedMin).toBe(40)
    const none = weekEvidence(input({ activities: weekRuns() }), WEEK)
    expect(none.plannedMin).toBeNull()
    expect(none.share).toBeNull()
  })

  it('takes the worst pain from an activity or a check-in, and the mean of the ratings given', () => {
    const rated = [
      activity('2026-10-13', { id: 'r1', rpe: 4, pain: 1 }),
      activity('2026-10-15', { id: 'r2', rpe: 6, pain: null }),
      activity('2026-10-17', { id: 'r3', rpe: null }),
    ]
    const ev = weekEvidence(input({ activities: rated }), WEEK)
    expect(ev.meanRpe).toBe(5)
    expect(ev.worstPain).toBe(1)
    const checkin = weekEvidence(
      input({ activities: rated, wellness: [wellnessDay('2026-10-16', { painScore: 3 })] }),
      WEEK,
    )
    expect(checkin.worstPain).toBe(3)
    // a pain report outside the week does not count
    const later = weekEvidence(
      input({ activities: rated, wellness: [wellnessDay('2026-10-20', { painScore: 7 })] }),
      WEEK,
    )
    expect(later.worstPain).toBe(1)
  })
})
