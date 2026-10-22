import { describe, expect, it, vi } from 'vitest'
import type { Activity } from '../../../shared/types.ts'
import type { AthleteState, SessionSpec, ZoneSet } from '../../../shared/engine/types.ts'
import {
  assessExecution,
  fitHrModel,
  matchSessions,
  type ExecutionContext,
} from '../../../shared/engine/execution.ts'

// WBGT belongs to Task E3; the tests stand in a function that reads the air temperature as WBGT.
vi.mock('../../../shared/engine/heat.ts', () => ({
  liljegrenWbgt: (input: { tempC: number }) => input.tempC,
}))

const TODAY = '2026-06-30'

function activity(over: Partial<Activity> = {}): Activity {
  return {
    id: 'a1',
    userId: 'u1',
    date: TODAY,
    startTime: null,
    type: 'run',
    durationSec: 3600,
    distanceM: 10000,
    rpe: null,
    avgHr: null,
    maxHr: null,
    elevationGainM: null,
    notes: null,
    source: 'manual',
    providerKey: null,
    importBatchId: null,
    duplicateOfId: null,
    duplicateStatus: 'none',
    subtype: null,
    startUtc: null,
    utcOffsetMin: null,
    movingSec: null,
    elevationLossM: null,
    avgCadence: null,
    avgPowerW: null,
    deviceName: null,
    startLat: null,
    startLng: null,
    tempC: null,
    dewPointC: null,
    windKph: null,
    humidityPct: null,
    weatherSource: null,
    hrHistogram: null,
    decouplingPct: null,
    gapDistanceM: null,
    feel: null,
    pain: null,
    createdAt: '2026-06-30T00:00:00Z',
    updatedAt: '2026-06-30T00:00:00Z',
    ...over,
  }
}

function session(over: Partial<SessionSpec> = {}): SessionSpec {
  return {
    date: TODAY,
    order: 0,
    kind: 'easy',
    title: 'Easy run',
    durationMin: 60,
    distanceM: null,
    gainM: null,
    structure: [],
    target: { zone: 'z2', rpe: [2, 3], hr: [130, 145], paceSecPerKm: [390, 350], heatNote: null },
    purpose: 'Aerobic base',
    rules: [],
    flags: [],
    ...over,
  }
}

type Linked = SessionSpec & { id: string; activityId: string | null; linkSource: string | null }
function linked(id: string, over: Partial<Linked> = {}): Linked {
  return { ...session(), id, activityId: null, linkSource: null, ...over }
}

const ZONES = {
  hr: { z1: [110, 130], z2: [130, 145], z3: [145, 160] },
  pace: { z1: [420, 390], z2: [390, 350], z3: [350, 320] },
} as unknown as ZoneSet
const STATE = {
  longest30d: { distanceM: 0, durationSec: 0, gainM: 0, lossM: 0, twoDaySec: 0 },
} as AthleteState
const CTX: ExecutionContext = { zones: ZONES, state: STATE }

describe('matchSessions', () => {
  it('prefers a same-day run of similar length over a shorter run the day after', () => {
    const sessions = [linked('s1')]
    const activities = [
      activity({ id: 'next', date: '2026-07-01', durationSec: 30 * 60 }),
      activity({ id: 'same', date: TODAY, durationSec: 58 * 60 }),
    ]
    expect(matchSessions(sessions, activities)).toEqual([{ sessionId: 's1', activityId: 'same' }])
  })

  it('matches the next day when nothing ran on the day', () => {
    const activities = [activity({ id: 'late', date: '2026-07-01', durationSec: 55 * 60 })]
    expect(matchSessions([linked('s1')], activities)).toEqual([
      { sessionId: 's1', activityId: 'late' },
    ])
  })

  it('does not match an adjacent day to a session that is no longer planned', () => {
    const activities = [activity({ id: 'late', date: '2026-07-01' })]
    const done = { ...linked('s1'), status: 'skipped' }
    expect(matchSessions([done], activities)).toEqual([])
  })

  it('never matches a strength activity to a run session, nor a run to strength', () => {
    const strength = activity({ id: 'str', type: 'strength', durationSec: 3600 })
    expect(matchSessions([linked('s1')], [strength])).toEqual([])
    const run = activity({ id: 'run' })
    expect(matchSessions([linked('s2', { kind: 'strength' })], [run])).toEqual([])
    expect(matchSessions([linked('s3', { kind: 'strength' })], [strength])).toEqual([
      { sessionId: 's3', activityId: 'str' },
    ])
  })

  it('matches hikes to walk or hike cross activities and race activities to run kinds', () => {
    const hike = activity({ id: 'h', type: 'cross', subtype: 'hike' })
    const bike = activity({ id: 'b', type: 'cross', subtype: 'bike' })
    expect(matchSessions([linked('s1', { kind: 'hike' })], [bike, hike])).toEqual([
      { sessionId: 's1', activityId: 'h' },
    ])
    const race = activity({ id: 'r', type: 'race' })
    expect(matchSessions([linked('s2', { kind: 'long' })], [race])).toEqual([
      { sessionId: 's2', activityId: 'r' },
    ])
  })

  it('never changes owner links and never reuses a linked activity', () => {
    const owner = linked('own', { activityId: 'a1', linkSource: 'owner' })
    const unlinkedByOwner = linked('off', { linkSource: 'owner' })
    const open = linked('open', { order: 1 })
    const activities = [activity({ id: 'a1' }), activity({ id: 'a2', durationSec: 59 * 60 })]
    expect(matchSessions([owner, unlinkedByOwner, open], activities)).toEqual([
      { sessionId: 'open', activityId: 'a2' },
    ])
  })

  it('pairs the lowest scores first and gives ties to the earlier order', () => {
    const sessions = [
      linked('long', { order: 1, kind: 'long', durationMin: 120 }),
      linked('easy', { order: 0, durationMin: 45 }),
    ]
    const activities = [
      activity({ id: 'short', durationSec: 45 * 60 }),
      activity({ id: 'big', durationSec: 118 * 60 }),
    ]
    expect(matchSessions(sessions, activities)).toEqual(
      expect.arrayContaining([
        { sessionId: 'easy', activityId: 'short' },
        { sessionId: 'long', activityId: 'big' },
      ]),
    )
    const twins = [linked('first', { order: 0 }), linked('second', { order: 1 })]
    expect(matchSessions(twins, [activity({ id: 'only' })])).toEqual([
      { sessionId: 'first', activityId: 'only' },
    ])
  })

  it('skips possible and confirmed duplicates but matches dismissed ones', () => {
    const dup = activity({ id: 'dup', duplicateStatus: 'confirmed', duplicateOfId: 'a9' })
    expect(matchSessions([linked('s1')], [dup])).toEqual([])
    const maybe = activity({ id: 'maybe', duplicateStatus: 'possible', duplicateOfId: 'a9' })
    expect(matchSessions([linked('s1')], [maybe])).toEqual([])
    const kept = activity({ id: 'kept', duplicateStatus: 'dismissed', duplicateOfId: 'a9' })
    expect(matchSessions([linked('s1')], [kept])).toEqual([{ sessionId: 's1', activityId: 'kept' }])
  })
})

describe('assessExecution completion', () => {
  it('bands the duration ratio at 0.8 and 1.2', () => {
    const at = (min: number) =>
      assessExecution(session(), activity({ durationSec: min * 60 }), CTX).completion
    expect(at(58)).toBe('completed')
    expect(at(47)).toBe('partial')
    expect(at(48)).toBe('completed')
    expect(at(72)).toBe('completed')
    expect(at(73)).toBe('extended')
  })

  it('calls a different kind of activity modified', () => {
    const out = assessExecution(session(), activity({ type: 'strength' }), CTX)
    expect(out.completion).toBe('modified')
  })
})

describe('assessExecution effort', () => {
  it('scores RPE 7 on an easy run as harder than expected', () => {
    const out = assessExecution(session(), activity({ rpe: 7, distanceM: null }), CTX)
    expect(out.effort.score).toBeGreaterThanOrEqual(1)
    expect(out.effort.parts.rpeDelta).toBeGreaterThan(0)
    expect(out.effort.confidence).toBe('low')
  })

  it('scores feel -2 with RPE 2 on a threshold session as easier than expected', () => {
    const threshold = session({
      kind: 'threshold',
      target: { zone: 'z3', rpe: [5, 6], hr: [150, 160], paceSecPerKm: [340, 320], heatNote: null },
    })
    const out = assessExecution(threshold, activity({ rpe: 2, feel: -2, distanceM: null }), CTX)
    expect(out.effort.score).toBeLessThanOrEqual(-1)
    expect(out.effort.parts.feel).toBe(-2)
    expect(out.effort.confidence).toBe('moderate')
  })

  it('scores 0 when RPE sits in the expected range, and null with no parts', () => {
    expect(assessExecution(session(), activity({ rpe: 3 }), CTX).effort.score).toBe(0)
    const none = assessExecution(session(), activity({ distanceM: null }), CTX).effort
    expect(none.score).toBeNull()
    expect(none.confidence).toBe('low')
  })

  it('caps a score with no subjective part at plus or minus 1 and rates it low confidence', () => {
    // 10 km in 40 min = 240 s/km against a 350-390 band: far faster, which alone would be +2.
    const fast = activity({ durationSec: 2400, distanceM: 10000, gapDistanceM: 10000 })
    const guess = assessExecution(session(), fast, CTX).effort
    expect(guess.parts.paceResidualPct).toBeGreaterThan(20)
    expect(guess.parts.rpeDelta).toBeNull()
    expect(guess.parts.feel).toBeNull()
    expect(guess.score).toBe(1)
    expect(guess.confidence).toBe('low')

    const slow = activity({ durationSec: 6000, distanceM: 10000, gapDistanceM: 10000 })
    expect(assessExecution(session(), slow, CTX).effort.score).toBe(-1)

    // The same pace with a felt-effort rating keeps the full scale.
    const felt = assessExecution(session(), { ...fast, rpe: 9, feel: 2 }, CTX).effort
    expect(felt.score).toBe(2)
  })

  it('caps a heart-rate-only score the same way', () => {
    const runs = Array.from({ length: 8 }, (_, i) => steadyRun(i, 130 + i * 2, 2.5 + i * 0.1))
    const model = fitHrModel(runs, TODAY)
    const target = session({
      target: { zone: 'z2', rpe: [2, 3], hr: [130, 160], paceSecPerKm: null, heatNote: null },
    })
    const out = assessExecution(target, steadyRun(30, 190, 2.9, { date: TODAY }), {
      ...CTX,
      hrModel: model,
    })
    expect(out.effort.parts.hrResidualZ).toBeGreaterThan(3)
    expect(out.effort.score).toBe(1)
    expect(out.effort.confidence).toBe('low')
  })

  it('uses the pace residual against the target band on a grade-adjusted pace', () => {
    // 10 km in 55 min = 330 s/km against a 350-390 band: faster, so harder.
    const out = assessExecution(
      session(),
      activity({ durationSec: 3300, distanceM: 10000, gapDistanceM: 10000 }),
      CTX,
    )
    expect(out.effort.parts.paceResidualPct).toBeGreaterThan(0)
    expect(out.conditions.gradeAdjusted).toBe(true)
  })
})

function steadyRun(i: number, avgHr: number, speedMps: number, over: Partial<Activity> = {}) {
  const durationSec = 40 * 60
  return activity({
    id: `m${i}`,
    date: `2026-06-${String(10 + i).padStart(2, '0')}`,
    durationSec,
    distanceM: speedMps * durationSec,
    gapDistanceM: speedMps * durationSec,
    elevationGainM: 20,
    avgHr,
    hrHistogram: {
      start: 100,
      width: 5,
      sec: Array.from({ length: 20 }, (_, bin) =>
        bin === Math.floor((avgHr - 100) / 5) ? durationSec : 0,
      ),
    },
    ...over,
  })
}

describe('HR model', () => {
  it('returns null with fewer than 8 qualifying runs', () => {
    const runs = Array.from({ length: 7 }, (_, i) => steadyRun(i, 140 + i, 2.8 + i * 0.02))
    expect(fitHrModel(runs, TODAY)).toBeNull()
    // an unqualified run (hilly) does not count towards the eight
    const eight = [...runs, steadyRun(8, 150, 3, { elevationGainM: 900 })]
    expect(fitHrModel(eight, TODAY)).toBeNull()
  })

  it('fits HR against speed with eight qualifying runs and yields a residual', () => {
    const runs = Array.from({ length: 8 }, (_, i) => steadyRun(i, 130 + i * 2, 2.5 + i * 0.1))
    const model = fitHrModel(runs, TODAY)
    expect(model).not.toBeNull()
    expect(model!.runs).toBe(8)
    expect(model!.slopeBpmPerMps).toBeGreaterThan(0)

    // the same relationship at 2.9 m/s predicts about 138 bpm; 150 bpm is well above it
    const target = session({
      target: { zone: 'z2', rpe: [2, 3], hr: [130, 160], paceSecPerKm: null, heatNote: null },
    })
    const hard = steadyRun(20, 150, 2.9, { date: TODAY })
    const out = assessExecution(target, hard, { ...CTX, hrModel: model })
    expect(out.effort.parts.hrResidualZ).toBeGreaterThan(1)
    const easy = assessExecution(target, steadyRun(21, 126, 2.9, { date: TODAY }), {
      ...CTX,
      hrModel: model,
    })
    expect(easy.effort.parts.hrResidualZ).toBeLessThan(-1)
  })

  it('gives no HR residual without a model or when HR does not qualify', () => {
    const run = steadyRun(1, 150, 2.9, { date: TODAY })
    expect(assessExecution(session(), run, CTX).effort.parts.hrResidualZ).toBeNull()
    const runs = Array.from({ length: 8 }, (_, i) => steadyRun(i, 130 + i * 2, 2.5 + i * 0.1))
    const model = fitHrModel(runs, TODAY)
    const hilly = steadyRun(2, 150, 2.9, { date: TODAY, elevationGainM: 900 })
    const out = assessExecution(session(), hilly, { ...CTX, hrModel: model })
    expect(out.effort.parts.hrResidualZ).toBeNull()
    expect(out.flags).toContain('hr-unqualified')
  })

  it('ignores runs older than the window', () => {
    const old = Array.from({ length: 8 }, (_, i) =>
      steadyRun(i, 140, 2.8, { date: `2026-03-${String(10 + i).padStart(2, '0')}` }),
    )
    expect(fitHrModel(old, TODAY)).toBeNull()
  })
})

describe('assessExecution intensity', () => {
  const hist = (secByBin: number[]) => ({ start: 120, width: 10, sec: secByBin })

  it('reads time in the target HR band from the histogram when HR qualifies', () => {
    // bins: 120-130, 130-140, 140-150, 150-160; band 130-145
    const on = activity({ avgHr: 138, hrHistogram: hist([200, 1800, 1400, 200]) })
    expect(assessExecution(session(), on, CTX).intensity).toBe('on')
    const above = activity({ avgHr: 152, hrHistogram: hist([0, 300, 900, 2400]) })
    expect(assessExecution(session(), above, CTX).intensity).toBe('above')
    const below = activity({ avgHr: 124, hrHistogram: hist([2800, 500, 300, 0]) })
    expect(assessExecution(session(), below, CTX).intensity).toBe('below')
  })

  it('falls back to grade-adjusted pace when HR does not qualify', () => {
    // 10 km in 60 min = 360 s/km, inside 350-390
    const on = activity({ gapDistanceM: 10000 })
    expect(assessExecution(session(), on, CTX).intensity).toBe('on')
    const fast = activity({ durationSec: 3000, gapDistanceM: 10000 }) // 300 s/km
    expect(assessExecution(session(), fast, CTX).intensity).toBe('above')
    const slow = activity({ durationSec: 4500, gapDistanceM: 10000 }) // 450 s/km
    expect(assessExecution(session(), slow, CTX).intensity).toBe('below')
  })

  it('is unknown with neither qualified HR nor pace', () => {
    expect(assessExecution(session(), activity({ distanceM: null }), CTX).intensity).toBe('unknown')
  })

  it('does not judge a structured session from whole-run averages', () => {
    const intervals = session({
      kind: 'intervals',
      structure: [{ kind: 'work', reps: 5, durationSec: 180, distanceM: null, zone: 'z3' }],
    })
    expect(assessExecution(intervals, activity({ gapDistanceM: 10000 }), CTX).intensity).toBe(
      'unknown',
    )
  })

  it('flags HR that is present but unqualified', () => {
    const wrist = activity({ avgHr: 150 })
    expect(assessExecution(session(), wrist, CTX).flags).toContain('hr-unqualified')
  })
})

describe('assessExecution conditions and flags', () => {
  it('marks heat adjustment at WBGT 22 C and not at 12 C', () => {
    const hot = assessExecution(session(), activity({ tempC: 22, humidityPct: 60 }), CTX)
    expect(hot.conditions.wbgtC).toBe(22)
    expect(hot.conditions.heatAdjusted).toBe(true)
    expect(hot.flags).toContain('heat')
    const mild = assessExecution(session(), activity({ tempC: 12, humidityPct: 60 }), CTX)
    expect(mild.conditions.heatAdjusted).toBe(false)
    expect(mild.flags).not.toContain('heat')
    const unknown = assessExecution(session(), activity(), CTX)
    expect(unknown.conditions.wbgtC).toBeNull()
  })

  it('does not read a slow pace in the heat as an easy effort', () => {
    const slowHot = activity({
      tempC: 24,
      humidityPct: 60,
      durationSec: 4500,
      gapDistanceM: 10000,
    })
    const out = assessExecution(session(), slowHot, CTX)
    expect(out.effort.parts.paceResidualPct).toBeNull()
    expect(out.intensity).toBe('unknown')
  })

  it('flags pain of 4 or more from the activity and focal bone pain from the check-in', () => {
    expect(assessExecution(session(), activity({ pain: 5 }), CTX).flags).toContain('pain')
    expect(assessExecution(session(), activity({ pain: 3 }), CTX).flags).not.toContain('pain')
    const focal = assessExecution(session(), activity(), {
      ...CTX,
      checkin: { painScore: 2, painFocalBone: true },
    })
    expect(focal.flags).toContain('focal-bone-pain')
    expect(focal.lines.join(' ')).toMatch(/pain/i)
    const both = assessExecution(session(), activity({ pain: 6 }), {
      ...CTX,
      checkin: { painScore: 6, painFocalBone: true },
    })
    expect(both.flags).toEqual(expect.arrayContaining(['pain', 'focal-bone-pain']))
  })

  it('flags a run longer than the 30-day longest by more than the spike ratio', () => {
    const state = {
      longest30d: { distanceM: 10000, durationSec: 3600, gainM: 0, lossM: 0, twoDaySec: 3600 },
    } as AthleteState
    const ctx = { zones: ZONES, state }
    expect(
      assessExecution(session(), activity({ distanceM: 13000, durationSec: 3900 }), ctx).flags,
    ).toContain('spike')
    expect(
      assessExecution(session(), activity({ distanceM: 10500, durationSec: 3700 }), ctx).flags,
    ).not.toContain('spike')
    // gain against a flat month: the 100 m minimum step (H4) applies
    const climb = (gain: number) =>
      assessExecution(session(), activity({ distanceM: 10000, elevationGainM: gain }), ctx).flags
    expect(climb(90)).not.toContain('spike')
    expect(climb(150)).toContain('spike')
    // only runs are compared with the longest run
    const long = activity({ type: 'strength', distanceM: null, durationSec: 7200 })
    expect(assessExecution(session(), long, ctx).flags).not.toContain('spike')
  })

  it('writes plain lines without deficit wording', () => {
    const out = assessExecution(session(), activity({ rpe: 7, durationSec: 40 * 60, pain: 5 }), CTX)
    expect(out.lines.length).toBeGreaterThan(1)
    for (const line of out.lines) expect(line).not.toMatch(/\b(behind|missed|failed|red)\b/i)
  })
})
