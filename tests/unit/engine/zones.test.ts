import { describe, expect, it } from 'vitest'
import { P } from '../../../shared/engine/params/index.ts'
import type { AthleteProfile } from '../../../shared/types.ts'
import type { AthleteState } from '../../../shared/engine/types.ts'
import { buildZones } from '../../../shared/engine/zones.ts'

const TODAY = '2026-10-22'

function profile(over: Partial<AthleteProfile> = {}): AthleteProfile {
  const day = { available: true, maxMin: null }
  return {
    birthYear: null,
    sex: 'unspecified',
    heightCm: null,
    weightKg: null,
    hrMax: null,
    hrMaxSource: null,
    hrRest: null,
    lthr: null,
    thresholdPaceSecPerKm: null,
    runningSinceYear: null,
    injuries: [],
    availability: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day },
    longRunDay: 'sun',
    terrain: { trail: false, hills: false, treadmill: false, track: false },
    strengthPreference: 0,
    timezone: 'UTC',
    homeLat: null,
    homeLng: null,
    useHomeWeather: false,
    ...over,
  }
}

function state(over: Partial<AthleteState> = {}): AthleteState {
  return {
    asOf: TODAY,
    age: null,
    sex: 'unspecified',
    experience: 'recreational',
    yearsRunning: null,
    load: { metric: 'minutes', acute: 0, chronic: 0, daily: [] },
    weeks: [],
    typicalWeekMin: 0,
    recentWeekMin: 0,
    longest30d: { distanceM: 0, durationSec: 0, gainM: 0, lossM: 0, twoDaySec: 0 },
    gaps16w: 0,
    layoffDays: 0,
    lastRunDate: null,
    fitness: {
      csMps: null,
      dPrimeM: null,
      csEfforts: 0,
      exponent: null,
      races: [],
      vo2maxTrend: null,
    },
    efficiency: { current: null, trendPct: null, samples: 0 },
    durability: { decouplingMedianPct: null, samples: 0 },
    risk: { recentInjury: false, priorBsi: false, bsiFactors: 0, redsFlags: 0, noviceFlags: [] },
    lowFrequency: false,
    history: null,
    heatAcclimation: 0,
    ...over,
  }
}

function withCs(csMps: number, over: Partial<AthleteState> = {}): AthleteState {
  const base = state(over)
  return { ...base, fitness: { ...base.fitness, csMps, csEfforts: 4 } }
}

describe('buildZones HRmax (rules C3)', () => {
  it('uses 208 - 0.7 x age with a +-10.8 band when nothing was observed', () => {
    const z = buildZones(profile(), state({ age: 40 }), TODAY)
    expect(z.hrMax).toEqual({
      value: 180,
      band: [169, 191],
      source: 'hrmax-age',
      asOf: TODAY,
    })
  })

  it('never uses 220 - age', () => {
    // 220 - 60 would be 160; the Tanaka-type prior gives 166.
    expect(buildZones(profile(), state({ age: 60 }), TODAY).hrMax!.value).toBe(166)
  })

  it('falls back to the profile birth year when the state has no age', () => {
    const z = buildZones(profile({ birthYear: 1986 }), state(), TODAY)
    expect(z.hrMax!.value).toBe(Math.round(208 - 0.7 * 40))
    expect(z.hrMax!.source).toBe('hrmax-age')
  })

  it('has no HRmax and no HR zones without an age or a value', () => {
    const z = buildZones(profile(), state(), TODAY)
    expect(z.hrMax).toBeNull()
    expect(z.hr).toBeNull()
    expect(z.lt1Hr).toBeNull()
  })

  it('takes a measured maximum as observed, never capped to the equation', () => {
    const z = buildZones(
      profile({ hrMax: 199, hrMaxSource: 'measured' }),
      state({ age: 50 }),
      TODAY,
    )
    expect(z.hrMax!.value).toBe(199)
    expect(z.hrMax!.source).toBe('hrmax-observed')
    expect(z.hrMax!.band).toEqual([194, 204])
  })

  it('labels a profile value without a measurement as the profile', () => {
    const z = buildZones(
      profile({ hrMax: 185, hrMaxSource: 'estimated' }),
      state({ age: 50 }),
      TODAY,
    )
    expect(z.hrMax!.source).toBe('profile')
    // Not measured, so it keeps the +-10.8 bpm band of a predicted HRmax (rules C7).
    expect(z.hrMax!.band).toEqual([174, 196])
  })
})

describe('buildZones heart-rate zones (rules C2, C4, C7)', () => {
  it('derives grade D shares of HRmax with the HRmax source and a widened band', () => {
    const z = buildZones(profile(), state({ age: 40 }), TODAY)
    expect(z.lt1Hr!.value).toBe(Math.round(180 * P.c2.lt1FractionOfHrMax.value))
    expect(z.lt2Hr!.value).toBe(Math.round(180 * P.c2.lt2FractionOfHrMax.value))
    expect(z.lt1Hr!.source).toBe('hrmax-age')
    expect(z.lt2Hr!.source).toBe('hrmax-age')
    const [lo, hi] = z.lt1Hr!.band
    expect(hi - lo).toBeGreaterThan(10)
    expect(lo).toBeLessThan(z.lt1Hr!.value)
    expect(hi).toBeGreaterThan(z.lt1Hr!.value)
  })

  it('takes the profile lactate-threshold HR as the Z2/Z3 anchor with the default band', () => {
    const z = buildZones(
      profile({ lthr: 170, hrMax: 190, hrMaxSource: 'measured' }),
      state(),
      TODAY,
    )
    expect(z.lt2Hr).toEqual({ value: 170, band: [165, 175], source: 'profile', asOf: TODAY })
    expect(z.lt1Hr!.source).toBe('profile')
    expect(z.lt1Hr!.value).toBeLessThan(170)
  })

  it('orders the zones: floor < LT1 < LT2 < HRmax, each zone a [low, high] range', () => {
    const z = buildZones(profile({ hrRest: 50 }), state({ age: 35 }), TODAY)
    const hr = z.hr!
    expect(hr.z1[0]).toBe(50)
    expect(hr.z1[1]).toBe(hr.z2[0])
    expect(hr.z2[1]).toBe(hr.z3[0])
    expect(hr.z3[1]).toBe(z.hrMax!.value)
    expect(hr.z1[0]).toBeLessThan(hr.z1[1])
    expect(hr.z2[0]).toBeLessThan(hr.z2[1])
    expect(hr.z3[0]).toBeLessThan(hr.z3[1])
    expect(z.hrRest).toBe(50)
  })

  it('does not use the resting HR as the Z1 floor when it is implausible', () => {
    const z = buildZones(profile({ hrRest: 150 }), state({ age: 35 }), TODAY)
    expect(z.hr!.z1[0]).toBe(Math.round(z.hrMax!.value * P.c2.z1FloorFractionOfHrMax.value))
  })

  it('gives CR-10 ranges for the three zones', () => {
    const z = buildZones(profile(), state(), TODAY)
    expect(z.rpe.z1).toEqual(P.c4.rpeZ1.value)
    expect(z.rpe.z2).toEqual(P.c4.rpeZ2.value)
    expect(z.rpe.z3).toEqual(P.c4.rpeZ3.value)
    expect(z.rpe.z1[1]).toBeLessThanOrEqual(z.rpe.z2[0])
    expect(z.rpe.z2[1]).toBeLessThanOrEqual(z.rpe.z3[0])
  })
})

describe('buildZones pace (rules C4, C5, C7)', () => {
  it('has no pace anchors without critical speed or a threshold pace', () => {
    const z = buildZones(profile(), state({ age: 40 }), TODAY)
    expect(z.csMps).toBeNull()
    expect(z.pace).toBeNull()
    expect(z.thresholdPaceSecPerKm).toBeNull()
    expect(z.lt1PaceSecPerKm).toBeNull()
  })

  it('puts LT1 at 82.3% of CS and threshold at CS minus 1.0 km/h for most athletes', () => {
    const cs = 3.5
    const z = buildZones(profile(), withCs(cs), TODAY)
    expect(z.csMps!.source).toBe('cs')
    expect(z.csMps!.value).toBeCloseTo(cs, 3)
    expect(z.lt1PaceSecPerKm!.value).toBe(Math.round(1000 / (cs * 0.823)))
    expect(z.thresholdPaceSecPerKm!.value).toBe(Math.round(1000 / (cs - 1.0 / 3.6)))
    expect(z.lt1PaceSecPerKm!.source).toBe('cs')
    expect(z.thresholdPaceSecPerKm!.source).toBe('cs')
  })

  it('uses the CS - 0.5 km/h margin for the well-trained', () => {
    const cs = 4.2
    const z = buildZones(profile(), withCs(cs, { experience: 'trained' }), TODAY)
    expect(z.thresholdPaceSecPerKm!.value).toBe(Math.round(1000 / (cs - 0.5 / 3.6)))
  })

  it('gives each boundary a 5% pace band', () => {
    const z = buildZones(profile(), withCs(3.5), TODAY)
    const t = z.thresholdPaceSecPerKm!
    expect(t.band[0]).toBe(Math.round(t.value * 0.95))
    expect(t.band[1]).toBe(Math.round(t.value * 1.05))
  })

  it('orders the pace zones slow to fast: z1 slower than LT1 slower than threshold slower than CS', () => {
    const z = buildZones(profile(), withCs(3.5), TODAY)
    const pace = z.pace!
    expect(pace.z1[0]).toBeGreaterThan(pace.z1[1])
    expect(pace.z1[1]).toBe(pace.z2[0])
    expect(pace.z2[0]).toBeGreaterThan(pace.z2[1])
    expect(pace.z2[1]).toBe(pace.z3[0])
    expect(pace.z3[0]).toBeGreaterThan(pace.z3[1])
    expect(pace.z3[1]).toBe(Math.round(1000 / 3.5))
  })

  it('prefers a tested threshold pace from the profile over CS, and records it', () => {
    const z = buildZones(profile({ thresholdPaceSecPerKm: 300 }), withCs(4.5), TODAY)
    expect(z.thresholdPaceSecPerKm).toMatchObject({ value: 300, source: 'profile' })
    expect(z.lt1PaceSecPerKm!.source).toBe('profile')
    expect(z.pace!.z2[1]).toBe(300)
    // The profile CS-equivalent is threshold speed plus the margin, so LT1 sits near 82.3% of it.
    const csEquivalent = 1000 / 300 + 1.0 / 3.6
    expect(z.lt1PaceSecPerKm!.value).toBe(Math.round(1000 / (csEquivalent * 0.823)))
  })

  it('works from a profile threshold alone, with no CS boundary', () => {
    const z = buildZones(profile({ thresholdPaceSecPerKm: 300 }), state(), TODAY)
    expect(z.csMps).toBeNull()
    expect(z.pace).not.toBeNull()
  })

  it('drops pace anchors after a break of two weeks or more (rules C8) but keeps HR', () => {
    const rested = buildZones(profile(), withCs(3.5, { age: 40, layoffDays: 14 }), TODAY)
    expect(rested.csMps).toBeNull()
    expect(rested.pace).toBeNull()
    expect(rested.hr).not.toBeNull()
    const recent = buildZones(profile(), withCs(3.5, { age: 40, layoffDays: 13 }), TODAY)
    expect(recent.pace).not.toBeNull()
  })

  it('is deterministic and does not mutate its inputs', () => {
    const p = profile({ hrRest: 52 })
    const s = withCs(3.5, { age: 38 })
    const before = JSON.stringify([p, s])
    expect(buildZones(p, s, TODAY)).toEqual(buildZones(p, s, TODAY))
    expect(JSON.stringify([p, s])).toBe(before)
  })
})
