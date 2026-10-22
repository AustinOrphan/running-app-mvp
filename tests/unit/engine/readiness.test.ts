import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { readinessSnapshot, todayAdvice } from '../../../shared/engine/readiness.ts'
import type { EngineInput } from '../../../shared/engine/types.ts'
import {
  activity,
  hrvSeries,
  input,
  planned,
  profile,
  spec,
  STEADY_HRV,
  TODAY,
  wellnessDay,
} from './e8-fixtures.ts'

const YESTERDAY = addDays(TODAY, -1)
const NORMAL = { fatigue: 3, soreness: 3, sleepQuality: 3, mood: 3, stress: 3 }
const POOR = { fatigue: 5, soreness: 4, sleepQuality: 2, mood: 2, stress: 4 }

/** Ten steady readings ending two days before today, so today and yesterday can be set freely. */
function baseline() {
  return hrvSeries(addDays(TODAY, -1), STEADY_HRV)
}

function adviceFor(i: EngineInput, ...kinds: Array<'threshold' | 'easy' | 'long' | 'race'>) {
  return todayAdvice(
    i,
    kinds.map((kind, n) => ({ ...spec(TODAY, kind, { order: n }), id: `s${n}` })),
  ).map((r) => r.advice)
}

describe('HRV flag (J4)', () => {
  it('flags a fall below the baseline band that exceeds the noise floor', () => {
    const i = input({ wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 40 })] })
    const snap = readinessSnapshot(i, TODAY)
    expect(snap.hrv.flag).toBe(true)
    expect(snap.hrv.readings).toBe(11)
  })

  it('does not flag a high reading', () => {
    const i = input({ wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 90 })] })
    expect(readinessSnapshot(i, TODAY).hrv.flag).toBe(false)
  })

  it('does not flag a small fall inside the noise floor', () => {
    const i = input({ wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 56 })] })
    expect(readinessSnapshot(i, TODAY).hrv.flag).toBe(false)
  })

  it('needs at least 10 baseline readings', () => {
    const wellness = [
      ...hrvSeries(TODAY, STEADY_HRV.slice(0, 8)),
      wellnessDay(TODAY, { hrvRmssd: 30 }),
    ]
    const snap = readinessSnapshot(input({ wellness }), TODAY)
    expect(snap.hrv.flag).toBe(false)
    expect(snap.hrv.baselineMean).toBeNull()
  })

  it('ignores SDNN, which is never mixed with rMSSD', () => {
    const wellness = [
      ...hrvSeries(TODAY, STEADY_HRV).map((w) => ({ ...w, hrvRmssd: null, hrvSdnn: w.hrvRmssd })),
      wellnessDay(TODAY, { hrvSdnn: 10 }),
    ]
    const snap = readinessSnapshot(input({ wellness }), TODAY)
    expect(snap.hrv.flag).toBe(false)
    expect(snap.hrv.readings).toBe(0)
  })

  it('flags a two-day decline that passes the noise floor', () => {
    const steady = hrvSeries(addDays(TODAY, -2), STEADY_HRV)
    const i = input({
      wellness: [
        ...steady,
        wellnessDay(YESTERDAY, { hrvRmssd: 57 }),
        wellnessDay(TODAY, { hrvRmssd: 52 }),
      ],
    })
    // 52 is above mean - 1 SD? It is below 60 by 13%, and the series 62 > 57 > 52 falls 16%.
    expect(readinessSnapshot(i, TODAY).hrv.flag).toBe(true)
  })

  it('widens the band for a female profile (cycle proxy)', () => {
    const wellness = [...baseline(), wellnessDay(TODAY, { hrvRmssd: 52 })]
    expect(readinessSnapshot(input({ wellness }), TODAY).hrv.flag).toBe(true)
    const cyclic = input({ wellness, profile: profile({ sex: 'female' }) })
    expect(readinessSnapshot(cyclic, TODAY).hrv.flag).toBe(false)
  })
})

describe('resting HR and sleep', () => {
  it('flags a resting HR well above its rolling mean', () => {
    const base = Array.from({ length: 10 }, (_, n) =>
      wellnessDay(addDays(TODAY, -(10 - n)), { restingHr: 50 }),
    )
    const i = input({ wellness: [...base, wellnessDay(TODAY, { restingHr: 58 })] })
    expect(readinessSnapshot(i, TODAY).restingHrFlag).toBe(true)
    const calm = input({ wellness: [...base, wellnessDay(TODAY, { restingHr: 51 })] })
    expect(readinessSnapshot(calm, TODAY).restingHrFlag).toBe(false)
  })

  it('warns when the 7-night average is under 7 hours', () => {
    const nights = (hours: number) =>
      Array.from({ length: 7 }, (_, n) =>
        wellnessDay(addDays(TODAY, -n), { sleepSec: hours * 3600 }),
      )
    const short = readinessSnapshot(input({ wellness: nights(6) }), TODAY)
    expect(short.sleepAvgH).toBe(6)
    expect(short.sleepFlag).toBe(true)
    const enough = readinessSnapshot(input({ wellness: nights(7.5) }), TODAY)
    expect(enough.sleepFlag).toBe(false)
  })

  it('gives no sleep average with too few nights', () => {
    const wellness = [wellnessDay(TODAY, { sleepSec: 5 * 3600 })]
    const snap = readinessSnapshot(input({ wellness }), TODAY)
    expect(snap.sleepAvgH).toBeNull()
    expect(snap.sleepFlag).toBe(false)
  })
})

describe('daily advice downgrades only (J3)', () => {
  it('never adds load: a high HRV leaves every session as planned', () => {
    const i = input({ wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 95, ...NORMAL })] })
    expect(adviceFor(i, 'threshold', 'easy', 'long', 'race')).toEqual([
      'as-planned',
      'as-planned',
      'as-planned',
      'as-planned',
    ])
  })

  it('one flagged day without a poor subjective score stays as planned', () => {
    const i = input({ wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 40, ...NORMAL })] })
    expect(readinessSnapshot(i, TODAY).hrv.flag).toBe(true)
    expect(adviceFor(i, 'threshold')).toEqual(['as-planned'])
    expect(readinessSnapshot(i, TODAY).state).toBe('normal')
  })

  it('two flagged days downgrade a quality session and leave easy runs alone', () => {
    const i = input({
      wellness: [
        ...hrvSeries(addDays(TODAY, -2), STEADY_HRV),
        wellnessDay(YESTERDAY, { hrvRmssd: 40, ...NORMAL }),
        wellnessDay(TODAY, { hrvRmssd: 38, ...NORMAL }),
      ],
    })
    const rows = todayAdvice(i, [
      { ...spec(TODAY, 'threshold'), id: 'q' },
      { ...spec(TODAY, 'easy', { order: 1 }), id: 'e' },
    ])
    expect(rows.map((r) => r.advice)).toEqual(['downgrade-easy', 'as-planned'])
    expect(rows[0]!.reasons.length).toBeGreaterThan(0)
    expect(rows[1]!.reasons).toEqual([])
    expect(readinessSnapshot(i, TODAY).state).toBe('possible-fatigue')
  })

  it('one flagged day with a poor subjective score downgrades', () => {
    const i = input({ wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 40, ...POOR })] })
    expect(adviceFor(i, 'threshold')).toEqual(['downgrade-easy'])
  })

  it('a poor subjective score alone counts only on a second day', () => {
    const one = input({ wellness: [wellnessDay(TODAY, POOR)] })
    expect(adviceFor(one, 'threshold')).toEqual(['as-planned'])
    const two = input({ wellness: [wellnessDay(YESTERDAY, POOR), wellnessDay(TODAY, POOR)] })
    expect(adviceFor(two, 'threshold')).toEqual(['downgrade-easy'])
  })

  it('a rest day stays a rest day', () => {
    const i = input({ wellness: [wellnessDay(YESTERDAY, POOR), wellnessDay(TODAY, POOR)] })
    expect(adviceFor(i, 'threshold')).toEqual(['downgrade-easy'])
    const rows = todayAdvice(i, [{ ...spec(TODAY, 'rest'), id: 'r' }])
    expect(rows[0]!.advice).toBe('as-planned')
  })

  it('returns the session as a plan session with its id and prescription', () => {
    const rows = todayAdvice(input(), [{ ...spec(TODAY, 'long', { durationMin: 95 }), id: 'abc' }])
    expect(rows[0]!.session).toMatchObject({ id: 'abc', kind: 'long', durationMin: 95 })
    expect(rows[0]!.session.weekStart).toBe('2026-10-19')
  })
})

describe('illness gate (n-3)', () => {
  const ill = (daysAgo: number) =>
    input({ wellness: [wellnessDay(addDays(TODAY, -daysAgo), { illness: true })] })

  it('rests every session on the illness day and the symptom-free day', () => {
    expect(adviceFor(ill(0), 'threshold', 'easy')).toEqual(['rest', 'rest'])
    expect(adviceFor(ill(1), 'threshold', 'easy')).toEqual(['rest', 'rest'])
  })

  it('allows only easy running for three days after, then intensity', () => {
    for (const daysAgo of [2, 3, 4]) {
      expect(adviceFor(ill(daysAgo), 'threshold', 'easy')).toEqual(['downgrade-easy', 'as-planned'])
    }
    expect(adviceFor(ill(5), 'threshold', 'easy')).toEqual(['as-planned', 'as-planned'])
  })

  it('raises an illness red flag while the gate is closed', () => {
    expect(readinessSnapshot(ill(0), TODAY).redFlags.map((f) => f.code)).toContain('illness')
    expect(readinessSnapshot(ill(5), TODAY).redFlags).toEqual([])
  })

  it('does not infer illness from low HRV and resting HR', () => {
    const i = input({
      wellness: [...baseline(), wellnessDay(TODAY, { hrvRmssd: 30, restingHr: 80, ...NORMAL })],
    })
    expect(readinessSnapshot(i, TODAY).redFlags).toEqual([])
  })
})

describe('pain red flags (n-1, n-2)', () => {
  it('rests running on focal bone pain, whatever the score', () => {
    const i = input({ wellness: [wellnessDay(TODAY, { painScore: 2, painFocalBone: true })] })
    expect(adviceFor(i, 'threshold', 'easy')).toEqual(['rest', 'rest'])
    expect(readinessSnapshot(i, TODAY).redFlags.map((f) => f.code)).toContain('focal-bone-pain')
  })

  it('does not rest strength work for bone pain', () => {
    const i = input({ wellness: [wellnessDay(TODAY, { painScore: 2, painFocalBone: true })] })
    const rows = todayAdvice(i, [{ ...spec(TODAY, 'strength'), id: 's' }])
    expect(rows[0]!.advice).toBe('as-planned')
  })

  it('downgrades quality at pain 4 or more and raises the pain flag', () => {
    const i = input({ wellness: [wellnessDay(TODAY, { painScore: 5 })] })
    expect(adviceFor(i, 'threshold', 'easy')).toEqual(['downgrade-easy', 'as-planned'])
    expect(readinessSnapshot(i, TODAY).redFlags.map((f) => f.code)).toEqual(['pain'])
  })

  it('reads pain from yesterday activity feedback too', () => {
    const i = input({ activities: [activity(YESTERDAY, { pain: 6 })] })
    expect(readinessSnapshot(i, TODAY).redFlags.map((f) => f.code)).toEqual(['pain'])
    const mild = input({ activities: [activity(YESTERDAY, { pain: 2 })] })
    expect(readinessSnapshot(mild, TODAY).redFlags).toEqual([])
  })
})

describe('masters recovery gate (J6)', () => {
  function masters(birthYear: number, todayFatigue: number) {
    const history = Array.from({ length: 14 }, (_, n) =>
      wellnessDay(addDays(TODAY, -(n + 1)), { ...NORMAL }),
    )
    return input({
      profile: profile({ birthYear }),
      wellness: [...history, wellnessDay(TODAY, { ...NORMAL, fatigue: todayFatigue })],
      existing: {
        weeks: [],
        sessions: [planned('hard', addDays(TODAY, -2), 'threshold', { status: 'completed' })],
      },
    })
  }

  it('converts the next quality session when fatigue is above the own median 48 h after', () => {
    expect(adviceFor(masters(1975, 4), 'threshold', 'easy')).toEqual([
      'downgrade-easy',
      'as-planned',
    ])
  })

  it('leaves the session when recovery is at the own median', () => {
    expect(adviceFor(masters(1975, 3), 'threshold')).toEqual(['as-planned'])
  })

  it('does not apply below the masters age', () => {
    expect(adviceFor(masters(1995, 4), 'threshold')).toEqual(['as-planned'])
  })

  it('needs enough check-ins for an own median', () => {
    const i = input({
      profile: profile({ birthYear: 1975 }),
      wellness: [wellnessDay(TODAY, { ...NORMAL, fatigue: 4 })],
      existing: {
        weeks: [],
        sessions: [planned('hard', addDays(TODAY, -2), 'threshold', { status: 'completed' })],
      },
    })
    expect(adviceFor(i, 'threshold')).toEqual(['as-planned'])
  })
})

describe('fatigue states (J8)', () => {
  const run = (days: number) =>
    input({
      wellness: Array.from({ length: days }, (_, n) => wellnessDay(addDays(TODAY, -n), POOR)),
    })

  it('stays normal or possible-fatigue before 14 days', () => {
    expect(readinessSnapshot(run(1), TODAY).state).toBe('normal')
    expect(readinessSnapshot(run(5), TODAY).state).toBe('possible-fatigue')
  })

  it('suggests a deload with a clinician checklist at 14 days', () => {
    const snap = readinessSnapshot(run(14), TODAY)
    expect(snap.state).toBe('persistent-suppression')
    const flag = snap.redFlags.find((f) => f.code === 'suppression-deload')
    expect(flag?.message).toMatch(/energy intake, iron, illness and sleep/)
    expect(flag?.message).not.toMatch(/overtrain/i)
  })

  it('shows the stronger medical-review prompt at 28 days', () => {
    const codes = readinessSnapshot(run(28), TODAY).redFlags.map((f) => f.code)
    expect(codes).toContain('suppression-medical-review')
    expect(codes).not.toContain('suppression-deload')
  })

  it('a normal day ends the run', () => {
    const wellness = [
      ...Array.from({ length: 13 }, (_, n) => wellnessDay(addDays(TODAY, -n - 1), POOR)),
      wellnessDay(TODAY, NORMAL),
    ]
    expect(readinessSnapshot(input({ wellness }), TODAY).state).toBe('normal')
  })

  it('reported illness explains the decline and ends the run', () => {
    const wellness = Array.from({ length: 14 }, (_, n) =>
      wellnessDay(addDays(TODAY, -n), n === 6 ? { ...POOR, illness: true } : POOR),
    )
    expect(readinessSnapshot(input({ wellness }), TODAY).state).not.toBe('persistent-suppression')
  })
})
