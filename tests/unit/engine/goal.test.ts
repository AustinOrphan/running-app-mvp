import { beforeEach, describe, expect, it, vi } from 'vitest'

const heat = vi.hoisted(() => ({ heatPenaltyPct: vi.fn() }))
vi.mock('../../../shared/engine/heat.ts', () => heat)

import { addDays } from '../../../shared/dates.ts'
import { distanceClassOf, feasibility, goalModel } from '../../../shared/engine/goal.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { predictFromState } from '../../../shared/engine/predict.ts'
import type { Goal } from '../../../shared/types.ts'
import type { AthleteState, GoalModel } from '../../../shared/engine/types.ts'

const TODAY = '2026-01-05' // a Monday
const MARATHON = 42195

function makeState(
  over: {
    longestM?: number
    longestSec?: number
    weeklyKm?: number
    yearsRunning?: number | null
    races?: AthleteState['fitness']['races']
    csMps?: number | null
  } = {},
): AthleteState {
  // 16 completed weeks before TODAY, oldest first, plus the current partial week.
  const weeks = Array.from({ length: 16 }, (_, i) => ({
    weekStart: addDays(TODAY, -7 * (16 - i)),
    runMin: 200,
    runM: (over.weeklyKm ?? 30) * 1000,
    runSessions: 4,
    runDays: 4,
    strengthSessions: 0,
    crossMin: 0,
    raceMin: 0,
    longestRunMin: 60,
    longRunShare: 0.3,
    avg4wRunMin: 200,
    streak3Plus: 0,
  }))
  weeks.push({ ...weeks[15]!, weekStart: TODAY, runM: 0 })
  return {
    asOf: TODAY,
    age: 40,
    sex: 'unspecified',
    experience: 'recreational',
    yearsRunning: over.yearsRunning === undefined ? 6 : over.yearsRunning,
    load: { metric: 'minutes', acute: 0, chronic: 0, daily: [] },
    weeks,
    typicalWeekMin: 200,
    longest30d: {
      distanceM: over.longestM ?? 10000,
      durationSec: over.longestSec ?? 3600,
      gainM: 0,
      lossM: 0,
      twoDaySec: 0,
    },
    gaps16w: 0,
    layoffDays: 0,
    lastRunDate: null,
    fitness: {
      csMps: over.csMps ?? null,
      dPrimeM: null,
      csEfforts: 0,
      exponent: null,
      races: over.races ?? [],
      vo2maxTrend: null,
    },
    efficiency: { current: null, trendPct: null, samples: 0 },
    durability: { decouplingMedianPct: null, samples: 0 },
    risk: { recentInjury: false, priorBsi: false, bsiFactors: 0, redsFlags: 0, noviceFlags: [] },
    heatAcclimation: 0,
  }
}

function makeGoal(over: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    userId: 'u1',
    name: 'Synthetic race',
    priority: 'A',
    status: 'target',
    targetDate: addDays(TODAY, 140),
    dateProvisional: false,
    distanceM: MARATHON,
    location: null,
    successCriteria: null,
    notes: null,
    url: null,
    isActive: true,
    gainM: null,
    lossM: null,
    surface: 'road',
    goalType: 'time',
    targetTimeSec: 12600,
    startTime: null,
    raceLat: null,
    raceLng: null,
    supportLevel: 'aided',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function makeModel(over: Partial<GoalModel> = {}): GoalModel {
  return {
    goalId: 'g1',
    name: 'Synthetic race',
    date: addDays(TODAY, 140),
    distanceM: MARATHON,
    gainM: 0,
    lossM: 0,
    surface: 'road',
    goalType: 'time',
    targetTimeSec: 12600,
    startTime: null,
    isUltra: false,
    distanceClass: 'marathon',
    expectedDurationSec: 12600,
    crossesDarkness: false,
    raceWbgtC: null,
    ...over,
  }
}

/** The weeks of D4: ceil(ln(Lt / L0) / ln(1.10)) x 4/3 plus the taper, rounded up. */
function d4Weeks(l0: number, lt: number, taperWeeks: number, growth = 1.1): number {
  const steps = Math.ceil(Math.log(lt / l0) / Math.log(growth) - 1e-9)
  return Math.ceil(steps * (4 / 3) + taperWeeks - 1e-9)
}

beforeEach(() => {
  heat.heatPenaltyPct.mockReset()
})

describe('distanceClassOf [D1]', () => {
  it('classes the usual race distances', () => {
    expect(distanceClassOf(5000)).toBe('5k')
    expect(distanceClassOf(10000)).toBe('10k')
    expect(distanceClassOf(21097)).toBe('half')
    expect(distanceClassOf(MARATHON)).toBe('marathon')
    expect(distanceClassOf(50000)).toBe('ultra50')
    expect(distanceClassOf(80467)).toBe('ultra50')
    expect(distanceClassOf(100000)).toBe('ultra100k')
    expect(distanceClassOf(160934)).toBe('ultra100mi')
    expect(distanceClassOf(200000)).toBe('beyond')
  })
})

describe('goalModel', () => {
  it('copies the descriptors and fills gain and loss', () => {
    const m = goalModel(
      makeGoal({ gainM: 800, lossM: 900, surface: 'trail', startTime: '06:30' }),
      makeState(),
      null,
    )
    expect(m).toMatchObject({
      goalId: 'g1',
      name: 'Synthetic race',
      distanceM: MARATHON,
      gainM: 800,
      lossM: 900,
      surface: 'trail',
      startTime: '06:30',
      isUltra: false,
      distanceClass: 'marathon',
      raceWbgtC: null,
    })
    expect(goalModel(makeGoal(), makeState(), null)).toMatchObject({ gainM: 0, lossM: 0 })
  })

  it('flags an ultra above 42.2 km only', () => {
    expect(goalModel(makeGoal({ distanceM: 42200 }), makeState(), null).isUltra).toBe(false)
    expect(goalModel(makeGoal({ distanceM: 50000 }), makeState(), null).isUltra).toBe(true)
  })

  it('defaults a 100-mile goal without a target time to finish-first', () => {
    const noTarget = makeGoal({ distanceM: 160934, goalType: 'time', targetTimeSec: null })
    expect(goalModel(noTarget, makeState(), null).goalType).toBe('finish')
    const withTarget = makeGoal({ distanceM: 160934, goalType: 'time', targetTimeSec: 36 * 3600 })
    expect(goalModel(withTarget, makeState(), null).goalType).toBe('time')
    const marathon = makeGoal({ goalType: 'time', targetTimeSec: null })
    expect(goalModel(marathon, makeState(), null).goalType).toBe('time')
  })

  it('keeps an explicit finish goal', () => {
    expect(goalModel(makeGoal({ goalType: 'finish' }), makeState(), null).goalType).toBe('finish')
  })

  it('takes race-day WBGT from the climate', () => {
    heat.heatPenaltyPct.mockReturnValue(0)
    const m = goalModel(makeGoal(), makeState(), { wbgtC: 21.5, source: 'climatology' })
    expect(m.raceWbgtC).toBe(21.5)
  })

  it('refuses a goal without a distance', () => {
    expect(() => goalModel(makeGoal({ distanceM: null }), makeState(), null)).toThrow(RangeError)
  })

  describe('expected duration', () => {
    it('uses the prediction when the state supports one', () => {
      const state = makeState({ races: [{ date: '2025-11-01', distanceM: 10000, timeSec: 3000 }] })
      const m = goalModel(makeGoal({ distanceM: 21097, targetTimeSec: null }), state, null)
      const p = predictFromState(state, {
        distanceM: 21097,
        gainM: 0,
        surface: 'road',
        wbgtC: null,
      })
      expect(m.expectedDurationSec).toBe(p?.predictedSec)
    })

    it('falls back to the target time, then to the pace prior', () => {
      const withTarget = goalModel(
        makeGoal({ distanceM: 10000, targetTimeSec: 3300 }),
        makeState(),
        null,
      )
      expect(withTarget.expectedDurationSec).toBe(3300)
      const prior = goalModel(
        makeGoal({ distanceM: 10000, targetTimeSec: null }),
        makeState(),
        null,
      )
      expect(prior.expectedDurationSec).toBe(10 * P.d1Prior.paceSecPerKm.value)
    })

    it('uses the slower ultra prior and counts gain as flat distance', () => {
      const m = goalModel(
        makeGoal({ distanceM: 100000, gainM: 3000, goalType: 'finish', targetTimeSec: null }),
        makeState(),
        null,
      )
      expect(m.expectedDurationSec).toBe(
        Math.round(
          ((100000 + 3000 * P.l5.gainEquivalentM.value) / 1000) * P.d1Prior.ultraPaceSecPerKm.value,
        ),
      )
    })

    it('applies the heat penalty through the prediction', () => {
      heat.heatPenaltyPct.mockReturnValue(5)
      const state = makeState({ races: [{ date: '2025-11-01', distanceM: 10000, timeSec: 3000 }] })
      const cool = goalModel(makeGoal({ distanceM: 21097, targetTimeSec: null }), state, null)
      const hot = goalModel(makeGoal({ distanceM: 21097, targetTimeSec: null }), state, {
        wbgtC: 24,
        source: 'forecast',
      })
      expect(hot.expectedDurationSec).toBe(Math.round(cool.expectedDurationSec * 1.05))
    })
  })

  describe('darkness [H6]', () => {
    const base = { goalType: 'finish' as const, distanceM: 21097 }
    const dark = (startTime: string | null, targetTimeSec: number) =>
      goalModel(makeGoal({ ...base, startTime, targetTimeSec }), makeState(), null).crossesDarkness

    it('is true when the race starts before dawn', () => {
      expect(dark('05:00', 3600)).toBe(true)
    })
    it('is false for a daytime race', () => {
      expect(dark('08:00', 3 * 3600)).toBe(false)
    })
    it('is true when the race runs past dusk', () => {
      expect(dark('17:00', 4 * 3600)).toBe(true)
    })
    it('treats an unknown start as dark only for a race longer than the daylight window', () => {
      expect(dark(null, 3 * 3600)).toBe(false)
      expect(dark(null, 15 * 3600)).toBe(true)
    })
    it('ignores a malformed start time', () => {
      const m = goalModel(
        makeGoal({ ...base, startTime: '7am', targetTimeSec: 3600 }),
        makeState(),
        null,
      )
      expect(m.startTime).toBeNull()
      expect(m.crossesDarkness).toBe(false)
    })
  })
})

describe('feasibility: D4 weeks formula with cutbacks', () => {
  it('computes ceil(ln(Lt/L0)/ln 1.10) x 4/3 plus the taper for a marathon time goal', () => {
    // Long run: 10 km to 25 km; weekly: 36 km to 40 km; marathon taper 21 days = 3 weeks.
    const state = makeState({ longestM: 10000, weeklyKm: 36 })
    const needed = d4Weeks(10000, 25000, 3)
    expect(needed).toBe(17)
    const at = (weeks: number) =>
      feasibility(makeModel({ date: addDays(TODAY, weeks * 7) }), state, TODAY)
    expect(at(17)).toMatchObject({ weeksNeeded: 17, weeksAvailable: 17, label: 'tight' })
    expect(at(16).label).toBe('not-reachable')
    expect(at(22).label).toBe('comfortable')
    expect(at(21).label).toBe('tight')
  })

  it('lets the weekly floor govern a time goal when it takes longer', () => {
    // Long run is nearly there (24 of 25 km); weekly 20 km to 40 km takes 8 growth weeks.
    const state = makeState({ longestM: 24000, weeklyKm: 20 })
    const time = feasibility(makeModel({ goalType: 'time' }), state, TODAY)
    expect(time.weeksNeeded).toBe(d4Weeks(20, 40, 3))
    expect(time.weeksNeeded).toBe(14)
    expect(time.notes.map((n) => n.code)).toContain('weekly-floor')
    // Volume floors apply only to time goals.
    const finish = feasibility(makeModel({ goalType: 'finish' }), state, TODAY)
    expect(finish.weeksNeeded).toBe(d4Weeks(24000, 25000, 3))
    expect(finish.weeksNeeded).toBe(5)
    expect(finish.notes.map((n) => n.code)).not.toContain('weekly-floor')
  })

  it('uses the half-marathon floors: 32 km per week and a long run above 21 km', () => {
    const state = makeState({ longestM: 21000, weeklyKm: 20 })
    const half = makeModel({ distanceClass: 'half', distanceM: 21097 })
    const f = feasibility(half, state, TODAY)
    expect(f.weeksNeeded).toBe(d4Weeks(20, 32, 2))
    expect(f.weeksNeeded).toBe(9)
  })

  it('has no volume floor for 5 km and 10 km, and caps the long run at the race or 10 km', () => {
    const state = makeState({ longestM: 3000, weeklyKm: 10 })
    const five = makeModel({ distanceClass: '5k', distanceM: 5000, goalType: 'time' })
    expect(feasibility(five, state, TODAY).weeksNeeded).toBe(d4Weeks(3000, 5000, 1))
    expect(feasibility(five, state, TODAY).weeksNeeded).toBe(9)
    const ten = makeModel({ distanceClass: '10k', distanceM: 10000, goalType: 'time' })
    expect(feasibility(ten, state, TODAY).weeksNeeded).toBe(d4Weeks(3000, 10000, 2))
  })

  it('floors a missing long run at the minimum step', () => {
    const state = makeState({ longestM: 0, weeklyKm: 0 })
    const five = makeModel({ distanceClass: '5k', distanceM: 5000, goalType: 'finish' })
    expect(feasibility(five, state, TODAY).weeksNeeded).toBe(
      d4Weeks(P.g1.minStepDistanceM.value, 5000, 1),
    )
  })

  it('needs no growth weeks when the long run already reaches the target', () => {
    const state = makeState({ longestM: 30000, weeklyKm: 60 })
    expect(feasibility(makeModel(), state, TODAY).weeksNeeded).toBe(3)
  })

  it('counts time on feet for an ultra: the class target, capped by 6 h or 60% of the expected duration', () => {
    const state = makeState({ longestM: 15000, longestSec: 7200 })
    const ultra = makeModel({
      distanceClass: 'ultra50',
      distanceM: 50000,
      isUltra: true,
      goalType: 'finish',
      expectedDurationSec: 18000,
    })
    // The 50 km target (3 h) equals 60% of 5 h and sits below the 6 h cap.
    expect(feasibility(ultra, state, TODAY).weeksNeeded).toBe(
      d4Weeks(7200, P.d4LongRun.ultra50.value * 60, 2),
    )
    const long = { ...ultra, distanceClass: 'ultra100mi' as const, expectedDurationSec: 36 * 3600 }
    // The 100-mile target (4 h) sits below both caps (6 h; 60% of 36 h); taper is 14 days.
    expect(feasibility(long, state, TODAY).weeksNeeded).toBe(
      d4Weeks(7200, P.d4LongRun.ultra100mi.value * 60, 2),
    )
  })

  it('leaves the current partial week out of the weekly average', () => {
    const state = makeState({ longestM: 24000, weeklyKm: 20 })
    // The fixture's current week has 0 km; counting it would lower the average to 15 km.
    expect(feasibility(makeModel(), state, TODAY).weeksNeeded).toBe(d4Weeks(20, 40, 3))
  })

  it('never refuses: a date already past gives zero weeks and a not-reachable label', () => {
    const f = feasibility(makeModel({ date: addDays(TODAY, -3) }), makeState(), TODAY)
    expect(f.weeksAvailable).toBe(0)
    expect(f.label).toBe('not-reachable')
  })
})

describe('feasibility: notes [D4-D6]', () => {
  const codes = (f: { notes: Array<{ code: string }> }) => f.notes.map((n) => n.code)

  it('offers a later race, a shorter distance or a finish goal when not reachable', () => {
    const f = feasibility(makeModel({ date: addDays(TODAY, 21) }), makeState(), TODAY)
    expect(f.label).toBe('not-reachable')
    const note = f.notes.find((n) => n.code === 'not-reachable')
    expect(note?.severity).toBe('warn')
    expect(note?.message).toMatch(/later race/)
    expect(note?.message).toMatch(/shorter distance/)
    expect(note?.message).toMatch(/finish-first/)
    expect(note?.rules).toContain('D4')
    expect(note?.message).not.toMatch(/behind|missed/i)
  })

  it('notes a low weekly distance and few years of running before a first ultra', () => {
    const ultra = makeModel({
      distanceClass: 'ultra50',
      distanceM: 50000,
      isUltra: true,
      goalType: 'finish',
    })
    const f = feasibility(ultra, makeState({ weeklyKm: 20, yearsRunning: 2 }), TODAY)
    expect(codes(f)).toEqual(
      expect.arrayContaining(['ultra-low-weekly-distance', 'ultra-few-years-running']),
    )
    const quiet = feasibility(ultra, makeState({ weeklyKm: 45, yearsRunning: 8 }), TODAY)
    expect(codes(quiet)).not.toContain('ultra-low-weekly-distance')
    expect(codes(quiet)).not.toContain('ultra-few-years-running')
  })

  it('does not flag first-timer status when years are unknown or an ultra is on record', () => {
    const ultra = makeModel({
      distanceClass: 'ultra50',
      distanceM: 50000,
      isUltra: true,
      goalType: 'finish',
    })
    expect(codes(feasibility(ultra, makeState({ yearsRunning: null }), TODAY))).not.toContain(
      'ultra-few-years-running',
    )
    const veteran = makeState({
      yearsRunning: 2,
      races: [{ date: '2025-06-01', distanceM: 50000, timeSec: 25000 }],
    })
    expect(codes(feasibility(ultra, veteran, TODAY))).not.toContain('ultra-few-years-running')
  })

  it('gives no ultra notes to a marathon', () => {
    const f = feasibility(makeModel(), makeState({ weeklyKm: 20, yearsRunning: 1 }), TODAY)
    expect(codes(f)).not.toContain('ultra-low-weekly-distance')
    expect(codes(f)).not.toContain('ultra-few-years-running')
  })

  it('notes a heat acclimation block from race WBGT 18 C', () => {
    expect(codes(feasibility(makeModel({ raceWbgtC: 18 }), makeState(), TODAY))).toContain(
      'heat-acclimation',
    )
    expect(codes(feasibility(makeModel({ raceWbgtC: 17.9 }), makeState(), TODAY))).not.toContain(
      'heat-acclimation',
    )
  })
})
