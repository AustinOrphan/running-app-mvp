import { beforeEach, describe, expect, it, vi } from 'vitest'

const heat = vi.hoisted(() => ({ heatPenaltyPct: vi.fn() }))
const athlete = vi.hoisted(() => ({ estimateState: vi.fn() }))
vi.mock('../../../shared/engine/heat.ts', () => heat)
vi.mock('../../../shared/engine/athlete.ts', () => athlete)

import {
  csFractionAtMin,
  predictFromState,
  predictRace,
  rangeLabel,
  type PredictTarget,
} from '../../../shared/engine/predict.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { AthleteState, EngineInput } from '../../../shared/engine/types.ts'

type Races = AthleteState['fitness']['races']

/** A synthetic athlete state; only the fields prediction reads matter. */
function makeState(
  fitness: Partial<AthleteState['fitness']> = {},
  decouplingMedianPct: number | null = null,
): AthleteState {
  return {
    asOf: '2026-10-22',
    age: 40,
    sex: 'unspecified',
    experience: 'recreational',
    yearsRunning: 6,
    load: { metric: 'minutes', acute: 0, chronic: 0, daily: [] },
    weeks: [],
    typicalWeekMin: 240,
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
      ...fitness,
    },
    efficiency: { current: null, trendPct: null, samples: 0 },
    durability: { decouplingMedianPct, samples: decouplingMedianPct === null ? 0 : 5 },
    risk: { recentInjury: false, priorBsi: false, bsiFactors: 0, redsFlags: 0, noviceFlags: [] },
    lowFrequency: false,
    heatAcclimation: 0,
  }
}

function race(date: string, distanceM: number, timeSec: number): Races[number] {
  return { date, distanceM, timeSec }
}

function road(distanceM: number, extra: Partial<PredictTarget> = {}): PredictTarget {
  return { distanceM, gainM: 0, surface: 'road', wbgtC: null, ...extra }
}

const RIEGEL = P.l1.riegelExponent.value
const HALF = 21097
const MARATHON = 42195

function halfWidthPct(p: { predictedSec: number; lowSec: number; highSec: number }): number {
  return ((p.highSec - p.lowSec) / 2 / p.predictedSec) * 100
}

beforeEach(() => {
  heat.heatPenaltyPct.mockReset()
  athlete.estimateState.mockReset()
})

describe('predictFromState: model hierarchy [L1]', () => {
  it('uses Riegel with 1.06 for a target up to 21.1 km', () => {
    const state = makeState({ races: [race('2026-09-01', 10000, 3000)] })
    const p = predictFromState(state, road(HALF))
    expect(p?.method).toBe('riegel')
    expect(p?.predictedSec).toBe(Math.round(3000 * Math.pow(HALF / 10000, RIEGEL)))
    expect(p?.rules).toContain('L1')
  })

  it('does not use Riegel above 21.1 km: a marathon from one half takes the 3% placeholder', () => {
    const state = makeState({ races: [race('2026-09-01', HALF, 5400)] })
    const p = predictFromState(state, road(MARATHON))
    expect(p?.method).toBe('single-anchor')
    expect(p?.predictedSec).toBe(
      Math.round(
        5400 * Math.pow(MARATHON / HALF, RIEGEL) * (1 + P.l2.singleAnchorSlowdownPct.value / 100),
      ),
    )
    expect(p?.rules).toEqual(expect.arrayContaining(['L1', 'L2']))
  })

  it('gives no race-based ultra prediction from a single anchor', () => {
    const state = makeState({ races: [race('2026-09-01', HALF, 5400)] })
    expect(predictFromState(state, road(50000))).toBeNull()
  })

  it('anchors a marathon or an ultra on a single race at about the same distance [L4]', () => {
    const marathon = predictFromState(
      makeState({ races: [race('2026-09-01', 42400, 13000)] }),
      road(MARATHON),
    )
    expect(marathon?.method).toBe('same-distance')
    expect(marathon?.predictedSec).toBe(Math.round(13000 * Math.pow(MARATHON / 42400, RIEGEL)))
    expect(marathon?.rules).toEqual(expect.arrayContaining(['L1', 'L2']))
    const ultra = predictFromState(
      makeState({ races: [race('2026-06-01', 50000, 18000)] }),
      road(50000),
    )
    expect(ultra?.method).toBe('same-distance')
    expect(ultra?.predictedSec).toBe(18000)
    expect(ultra?.rules).toContain('L4')
    // Outside the tolerance the single anchor still gives no ultra prediction.
    expect(
      predictFromState(makeState({ races: [race('2026-06-01', MARATHON, 13000)] }), road(50000)),
    ).toBeNull()
  })

  it('prefers the personal exponent when two or more race distances exist', () => {
    const state = makeState({
      exponent: 1.07,
      races: [race('2026-05-01', 5000, 1200), race('2026-09-01', HALF, 5400)],
    })
    const p = predictFromState(state, road(10000))
    expect(p?.method).toBe('personal-exponent')
    // The 5 km race is nearest to 10 km on a log scale.
    expect(p?.predictedSec).toBe(Math.round(1200 * Math.pow(2, 1.07)))
  })

  it('ignores the exponent when the races share one distance', () => {
    const state = makeState({
      exponent: 1.07,
      races: [race('2026-05-01', 10000, 3100), race('2026-09-01', 10000, 3000)],
    })
    expect(predictFromState(state, road(HALF))?.method).toBe('riegel')
  })

  it('anchors on the later race when two are equally near', () => {
    const state = makeState({
      races: [race('2026-05-01', 10000, 3100), race('2026-09-01', 10000, 3000)],
    })
    expect(predictFromState(state, road(HALF))?.predictedSec).toBe(
      Math.round(3000 * Math.pow(HALF / 10000, RIEGEL)),
    )
  })

  it('fits critical speed up to a 60 minute extrapolation', () => {
    const state = makeState({ csMps: 4, dPrimeM: 200, csEfforts: 4 })
    const p = predictFromState(state, road(10000))
    expect(p?.method).toBe('critical-speed')
    expect(p?.predictedSec).toBe(2450)
  })

  it('uses the CS-fraction prior beyond 60 minutes and solves it consistently', () => {
    const state = makeState({ csMps: 3.5, dPrimeM: 200, csEfforts: 4 })
    const p = predictFromState(state, road(HALF * 2 + 1))
    expect(p?.method).toBe('cs-fraction')
    const minutes = (p?.predictedSec ?? 0) / 60
    // Seconds are rounded, so allow the distance covered in half a second.
    expect(Math.abs(minutes * 60 * 3.5 * csFractionAtMin(minutes) - MARATHON)).toBeLessThan(3.5)
  })

  it('uses the durability fraction for a marathon', () => {
    const cs = 3.6
    const low = predictFromState(makeState({ csMps: cs }, 5), road(MARATHON))
    const high = predictFromState(makeState({ csMps: cs }, 25), road(MARATHON))
    const mid = predictFromState(makeState({ csMps: cs }, 15), road(MARATHON))
    expect(low?.method).toBe('cs-durability')
    expect(low?.predictedSec).toBe(Math.round(MARATHON / (cs * P.l2.csFractionLowDecoupling.value)))
    expect(high?.predictedSec).toBe(
      Math.round(MARATHON / (cs * P.l2.csFractionHighDecoupling.value)),
    )
    expect(mid?.predictedSec).toBe(Math.round(MARATHON / (cs * 0.85)))
  })

  it('averages a race source and a CS source and records both methods', () => {
    const raceSec = 1200 * Math.pow(2, RIEGEL)
    const state = makeState({
      races: [race('2026-09-01', 5000, 1200)],
      csMps: 10000 / raceSec,
      dPrimeM: 0,
      csEfforts: 4,
    })
    const p = predictFromState(state, road(10000))
    expect(p?.method).toBe('riegel+critical-speed')
    expect(p?.predictedSec).toBe(Math.round(raceSec))
  })

  it('returns null with no source, or with no distance', () => {
    expect(predictFromState(makeState(), road(10000))).toBeNull()
    expect(predictFromState(makeState({ csMps: 4 }), road(0))).toBeNull()
  })
})

describe('csFractionAtMin [L2, L4]', () => {
  it('passes through the published points and falls to a floor', () => {
    expect(csFractionAtMin(30)).toBe(P.l2.csFractionAt60Min.value)
    expect(csFractionAtMin(150)).toBeCloseTo(0.93, 10)
    expect(csFractionAtMin(360)).toBeCloseTo(0.79, 10)
    expect(csFractionAtMin(105)).toBeCloseTo((1.0 + 0.93) / 2, 10)
    expect(csFractionAtMin(100000)).toBe(P.l4.csFractionFloor.value)
  })

  it('never rises with duration', () => {
    let last = Infinity
    for (let m = 10; m < 3000; m += 17) {
      const f = csFractionAtMin(m)
      expect(f).toBeLessThanOrEqual(last)
      last = f
    }
  })
})

describe('predictFromState: interval [L2, L5, L6]', () => {
  // Two sources that agree, so the spread between them adds nothing.
  function agreeing(targetM: number, exponentSources: 'half' | 'ten' = 'ten'): AthleteState {
    if (exponentSources === 'ten') {
      const sec = 1500 * Math.pow(targetM / 5000, RIEGEL)
      return makeState({
        races: [race('2026-09-01', 5000, 1500)],
        csMps: targetM / sec,
        dPrimeM: 0,
      })
    }
    const sec =
      5400 * Math.pow(targetM / HALF, RIEGEL) * (1 + P.l2.singleAnchorSlowdownPct.value / 100)
    return makeState({ races: [race('2026-09-01', HALF, 5400)], csMps: targetM / (0.88 * sec) }, 5)
  }

  it('is at least +/-3% for a model forecast up to a half-marathon', () => {
    const p = predictFromState(agreeing(10000), road(10000))
    expect(halfWidthPct(p!)).toBeCloseTo(P.l6.minBandPct.value, 1)
    expect(p!.lowSec).toBeLessThan(p!.predictedSec)
    expect(p!.highSec).toBeGreaterThan(p!.predictedSec)
  })

  it('is at least +/-6% for a marathon', () => {
    const p = predictFromState(agreeing(MARATHON, 'half'), road(MARATHON))
    expect(p?.method).toBe('single-anchor+cs-durability')
    expect(halfWidthPct(p!)).toBeCloseTo(P.l2.marathonMinHalfWidthPct.value, 1)
  })

  it('widens by the spread when two sources disagree', () => {
    const raceSec = 1200 * Math.pow(2, RIEGEL)
    const state = makeState({
      races: [race('2026-09-01', 5000, 1200)],
      csMps: 10000 / (raceSec * 1.2),
      dPrimeM: 0,
    })
    const p = predictFromState(state, road(10000))
    const expected = (Math.abs(raceSec - raceSec * 1.2) / (raceSec + raceSec * 1.2)) * 100
    expect(halfWidthPct(p!)).toBeCloseTo(expected, 1)
    expect(expected).toBeGreaterThan(P.l6.minBandPct.value)
  })

  it('widens a one-source prediction and says so', () => {
    const state = makeState({ races: [race('2026-09-01', 10000, 3000)] })
    const p = predictFromState(state, road(HALF))
    expect(halfWidthPct(p!)).toBeCloseTo(
      P.l6.minBandPct.value * (1 + P.l3.singleSourceWideningPct.value / 100),
      1,
    )
    expect(p?.conditions.join(' ')).toMatch(/one source/i)
    expect(p?.rules).toContain('L3')
  })

  it('widens a trail interval by 50% on top', () => {
    const state = agreeing(10000)
    const roadP = predictFromState(state, road(10000))!
    const trailP = predictFromState(state, road(10000, { surface: 'trail' }))!
    expect(halfWidthPct(trailP) / halfWidthPct(roadP)).toBeCloseTo(
      1 + P.l5.trailIntervalWideningPct.value / 100,
      2,
    )
    expect(trailP.rules).toContain('L5')
  })

  it('lets the trail widening grow with gain per km, and counts gain as flat distance', () => {
    const state = agreeing(10000)
    const flat = predictFromState(state, road(10000, { surface: 'trail' }))!
    const hilly = predictFromState(state, road(10000, { surface: 'trail', gainM: 500 }))!
    expect(halfWidthPct(hilly)).toBeGreaterThan(halfWidthPct(flat))
    expect(hilly.predictedSec).toBeGreaterThan(flat.predictedSec)
    // The same gain on a road course lengthens the time but widens the interval less.
    const roadHilly = predictFromState(state, road(10000, { gainM: 500 }))!
    expect(roadHilly.predictedSec).toBeGreaterThan(
      predictFromState(state, road(10000))!.predictedSec,
    )
    expect(halfWidthPct(roadHilly)).toBeLessThan(halfWidthPct(hilly))
  })

  it('shows a wide range for an ultra', () => {
    const state = makeState({ csMps: 3.5, dPrimeM: 150 })
    const p = predictFromState(state, road(100000))!
    expect(p.method).toBe('cs-fraction')
    expect(halfWidthPct(p)).toBeGreaterThanOrEqual(P.l4.ultraMinHalfWidthPct.value)
    expect(p.rules).toContain('L4')
  })

  it('predicts a 100-mile effort that is slower than the marathon pace prior', () => {
    const state = makeState({ csMps: 3.5 })
    const p = predictFromState(state, road(160934))!
    const marathon = predictFromState(state, road(MARATHON))!
    expect(p.predictedSec / 160934).toBeGreaterThan(marathon.predictedSec / MARATHON)
    expect(p.predictedSec).toBeGreaterThan(20 * 3600)
  })
})

describe('rangeLabel [L2, L4, L6]', () => {
  const HUNDRED_MILES = 160934

  it('reuses the floor of each distance band, with the rules that set it and its grade', () => {
    const cases: Array<[string, number, number, string[], string]> = [
      ['5 km', 5000, P.l6.minBandPct.value, ['L6'], P.l6.minBandPct.grade],
      ['the Riegel limit', P.l1.riegelMaxTargetM.value, P.l6.minBandPct.value, ['L6'], 'C'],
      ['a half marathon', HALF, P.l6.minBandPct.value, ['L6'], 'C'],
      ['a marathon', MARATHON, P.l2.marathonMinHalfWidthPct.value, ['L2', 'L6'], 'C'],
      [
        'the ultra limit',
        P.d1.ultraAboveM.value,
        P.l2.marathonMinHalfWidthPct.value,
        ['L2', 'L6'],
        'C',
      ],
      ['50 km', 50000, P.l4.ultraMinHalfWidthPct.value, ['L4', 'L6'], 'D'],
      ['100 miles', HUNDRED_MILES, P.l4.ultraMinHalfWidthPct.value, ['L4', 'L6'], 'D'],
    ]
    for (const [name, distanceM, pct, rules, grade] of cases) {
      const label = rangeLabel(road(distanceM))
      expect(label.minHalfWidthPct, name).toBe(pct)
      expect(label.rules, name).toEqual(rules)
      expect(label.grade, name).toBe(grade)
    }
  })

  it('is wide on purpose only for an ultra', () => {
    expect(rangeLabel(road(5000)).wide).toBe(false)
    expect(rangeLabel(road(MARATHON)).wide).toBe(false)
    expect(rangeLabel(road(P.d1.ultraAboveM.value)).wide).toBe(false)
    expect(rangeLabel(road(P.d1.ultraAboveM.value + 1)).wide).toBe(true)
    expect(rangeLabel(road(HUNDRED_MILES)).wide).toBe(true)
  })

  it('names the evidence the ultra range rests on: a grade D default', () => {
    expect(P.l4.ultraMinHalfWidthPct.grade).toBe('D')
    expect(rangeLabel(road(HUNDRED_MILES)).grade).toBe('D')
  })

  it('states the floor the interval really has', () => {
    const marathon = predictFromState(
      makeState({ races: [race('2026-09-01', HALF, 5400)], csMps: MARATHON / (0.88 * 12300) }, 5),
      road(MARATHON),
    )!
    expect(halfWidthPct(marathon)).toBeGreaterThanOrEqual(
      rangeLabel(road(MARATHON)).minHalfWidthPct,
    )
    const ultra = predictFromState(makeState({ csMps: 3.5, dPrimeM: 150 }), road(HUNDRED_MILES))!
    expect(halfWidthPct(ultra)).toBeGreaterThanOrEqual(
      rangeLabel(road(HUNDRED_MILES)).minHalfWidthPct,
    )
    const ten = predictFromState(
      makeState({
        races: [race('2026-09-01', 5000, 1500)],
        csMps: 10000 / (1500 * 2 ** RIEGEL),
        dPrimeM: 0,
      }),
      road(10000),
    )!
    expect(halfWidthPct(ten)).toBeGreaterThanOrEqual(rangeLabel(road(10000)).minHalfWidthPct - 0.05)
  })

  it('accepts a prediction target and takes nothing from the course but its distance', () => {
    const trail = road(HUNDRED_MILES, { surface: 'trail', gainM: 5000, wbgtC: 28 })
    expect(rangeLabel(trail)).toEqual(rangeLabel({ distanceM: HUNDRED_MILES }))
  })
})

describe('predictFromState: heat [I2-I4 via heat.ts]', () => {
  it('scales the time by the penalty for the marathon-equivalent ability', () => {
    heat.heatPenaltyPct.mockReturnValue(4)
    const state = makeState({ races: [race('2026-09-01', 10000, 3000)] })
    const cool = predictFromState(state, road(HALF))!
    const hot = predictFromState(state, road(HALF, { wbgtC: 24 }))!
    expect(hot.predictedSec).toBe(Math.round(cool.predictedSec * 1.04))
    expect(hot.lowSec).toBeGreaterThan(cool.lowSec)
    expect(hot.conditions.join(' ')).toMatch(/WBGT 24\.0 C/)
    const [wbgt, ability] = heat.heatPenaltyPct.mock.calls[0] as [number, number]
    expect(wbgt).toBe(24)
    // Marathon-equivalent of the 10 km race through the single-anchor placeholder.
    expect(ability).toBeCloseTo(
      3000 * Math.pow(MARATHON / 10000, RIEGEL) * (1 + P.l2.singleAnchorSlowdownPct.value / 100),
      3,
    )
  })

  it('never calls the heat model without a race-day WBGT', () => {
    const state = makeState({ races: [race('2026-09-01', 10000, 3000)] })
    predictFromState(state, road(HALF))
    expect(heat.heatPenaltyPct).not.toHaveBeenCalled()
  })

  it('skips the penalty and says so when no marathon-equivalent ability exists', () => {
    // A 30 km race scales to 10 km by Riegel, but not on to a marathon (single anchor above 21.1 km).
    const state = makeState({ races: [race('2026-09-01', 30000, 9000)] })
    const p = predictFromState(state, road(10000, { wbgtC: 24 }))!
    expect(p.method).toBe('riegel')
    expect(heat.heatPenaltyPct).not.toHaveBeenCalled()
    expect(p.conditions.join(' ')).toMatch(/heat is not applied/i)
  })
})

describe('predictRace', () => {
  it('predicts from the estimated state and the goal', () => {
    athlete.estimateState.mockReturnValue(makeState({ races: [race('2026-09-01', 10000, 3000)] }))
    const input = {
      goal: { distanceM: HALF, gainM: 0, surface: 'road', raceWbgtC: null },
    } as unknown as EngineInput
    const p = predictRace(input)
    expect(athlete.estimateState).toHaveBeenCalledWith(input)
    expect(p?.method).toBe('riegel')
  })

  it('returns null when the state supports no source', () => {
    athlete.estimateState.mockReturnValue(makeState())
    const input = {
      goal: { distanceM: HALF, gainM: 0, surface: 'road', raceWbgtC: null },
    } as unknown as EngineInput
    expect(predictRace(input)).toBeNull()
  })

  it('is deterministic', () => {
    athlete.estimateState.mockReturnValue(makeState({ csMps: 3.4, dPrimeM: 180 }))
    const input = {
      goal: { distanceM: 100000, gainM: 2000, surface: 'trail', raceWbgtC: null },
    } as unknown as EngineInput
    expect(predictRace(input)).toEqual(predictRace(input))
  })
})
