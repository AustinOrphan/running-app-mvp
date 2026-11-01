// The zone counting behind the E4 sentence of the Why drawer and the realised distribution of the
// plan report: time in zone, from the planned minutes. Hand-computed cases.
import { describe, expect, it } from 'vitest'
import {
  countsAsVolume,
  deliveredShares,
  isDrawnOutsideE4,
  percentOfMinutes,
  plannedZoneMinutes,
  tidZoneOf,
  wholePercents,
  zoneMinutes,
} from '../../../shared/engine/tid.ts'
import type { SessionKind, Step, ZoneKey } from '../../../shared/engine/types.ts'

const step = (kind: Step['kind'], reps: number, durationSec: number, zone: ZoneKey): Step => ({
  kind,
  reps,
  durationSec,
  distanceM: null,
  zone,
})

const run = (kind: SessionKind, durationMin: number, structure: Step[] = []) => ({
  kind,
  durationMin,
  structure,
})

describe('which sessions count', () => {
  it('counts the run kinds except a race and a hike', () => {
    for (const kind of ['easy', 'recovery', 'long', 'threshold', 'intervals', 'strides'] as const) {
      expect(countsAsVolume({ kind }), kind).toBe(true)
    }
    for (const kind of ['race', 'hike', 'strength', 'mobility', 'rest', 'cross'] as const) {
      expect(countsAsVolume({ kind }), kind).toBe(false)
    }
  })
})

describe('the zone of a step', () => {
  it('puts strides in zone 3 and race pace in zone 2 above 10 km, in zone 3 at 5 and 10 km', () => {
    expect(tidZoneOf('z1', 'marathon')).toBe(1)
    expect(tidZoneOf('z2', 'marathon')).toBe(2)
    expect(tidZoneOf('z3', 'marathon')).toBe(3)
    expect(tidZoneOf('strides', 'marathon')).toBe(3)
    expect(tidZoneOf('race-pace', 'half')).toBe(2)
    expect(tidZoneOf('race-pace', 'ultra50')).toBe(2)
    expect(tidZoneOf('race-pace', '10k')).toBe(3)
    expect(tidZoneOf('race-pace', '5k')).toBe(3)
    expect(tidZoneOf('strength', 'half')).toBeNull()
    expect(tidZoneOf('rest', 'half')).toBeNull()
  })
})

describe('the minutes of a session in each zone', () => {
  it('counts a work block at its zone and every other minute at zone 1', () => {
    // threshold 50: 10 min warm-up, 20 min zone 2, 10 min cool-down; 10 minutes the steps do not
    // name count in zone 1 too
    const threshold = run('threshold', 50, [
      step('warmup', 1, 600, 'z1'),
      step('work', 1, 1200, 'z2'),
      step('cooldown', 1, 600, 'z1'),
    ])
    expect(zoneMinutes(threshold, 'marathon')).toEqual({ z1: 30, z2: 20, z3: 0 })
    // intervals 45: 4 x 3 min in zone 3, the recoveries and the rest in zone 1
    const intervals = run('intervals', 45, [
      step('warmup', 1, 600, 'z1'),
      step('work', 4, 180, 'z3'),
      step('recover', 4, 180, 'z1'),
      step('cooldown', 1, 600, 'z1'),
    ])
    expect(zoneMinutes(intervals, 'marathon')).toEqual({ z1: 33, z2: 0, z3: 12 })
    expect(zoneMinutes(run('easy', 40), 'marathon')).toEqual({ z1: 40, z2: 0, z3: 0 })
  })

  it('never lets the steps push zone 1 below zero', () => {
    const over = run('threshold', 10, [step('work', 1, 1200, 'z2')])
    expect(zoneMinutes(over, 'half')).toEqual({ z1: 0, z2: 20, z3: 0 })
  })

  it('moves race-pace work between zones 2 and 3 with the goal class', () => {
    const racePace = run('race-pace', 40, [
      step('warmup', 1, 600, 'z1'),
      step('work', 1, 1200, 'race-pace'),
      step('cooldown', 1, 600, 'z1'),
    ])
    expect(zoneMinutes(racePace, 'marathon')).toEqual({ z1: 20, z2: 20, z3: 0 })
    expect(zoneMinutes(racePace, '10k')).toEqual({ z1: 20, z2: 0, z3: 20 })
  })
})

describe('the shares a set of sessions delivers', () => {
  const week = [
    run('easy', 40),
    run('threshold', 50, [
      step('warmup', 1, 600, 'z1'),
      step('work', 1, 1200, 'z2'),
      step('cooldown', 1, 600, 'z1'),
    ]),
    run('intervals', 45, [
      step('warmup', 1, 600, 'z1'),
      step('work', 4, 180, 'z3'),
      step('recover', 4, 180, 'z1'),
      step('cooldown', 1, 600, 'z1'),
    ]),
    run('long', 90),
  ]

  it('adds the zone minutes of the sessions and gives their share of the planned minutes', () => {
    // zone 1 40 + 30 + 33 + 90 = 193, zone 2 20, zone 3 12, of 225
    expect(plannedZoneMinutes(week, 'half')).toEqual({ z1: 193, z2: 20, z3: 12 })
    const shares = deliveredShares(week, 'half')!
    expect(shares.z1).toBeCloseTo((193 / 225) * 100, 9)
    expect(shares.z2).toBeCloseTo((20 / 225) * 100, 9)
    expect(shares.z3).toBeCloseTo((12 / 225) * 100, 9)
  })

  it('leaves a race, a hike and strength out of the minutes', () => {
    const more = [...week, run('race', 180), run('hike', 120), run('strength', 45)]
    expect(plannedZoneMinutes(more, 'half')).toEqual({ z1: 193, z2: 20, z3: 12 })
  })

  it('has no shares without planned minutes', () => {
    expect(deliveredShares([], 'half')).toBeNull()
    expect(deliveredShares([run('race', 180), run('strength', 45)], 'half')).toBeNull()
    expect(percentOfMinutes({ z1: 0, z2: 0, z3: 0 })).toBeNull()
  })
})

describe('whole percents', () => {
  it('rounds to whole numbers that add up to 100, the largest remainders taking the extra points', () => {
    // 85.78 / 8.89 / 5.33: the floors add to 98, the two largest remainders (.89 and .78) take 1 each
    expect(wholePercents({ z1: 85.78, z2: 8.89, z3: 5.33 })).toEqual({ z1: 86, z2: 9, z3: 5 })
    // 33.5 / 33.5 / 33: plain rounding gives 34 / 34 / 33 = 101; a tie goes to the earlier zone
    expect(wholePercents({ z1: 33.5, z2: 33.5, z3: 33 })).toEqual({ z1: 34, z2: 33, z3: 33 })
    // 98.6 / 1.2 / 0.2
    expect(wholePercents({ z1: 98.6, z2: 1.2, z3: 0.2 })).toEqual({ z1: 99, z2: 1, z3: 0 })
    expect(wholePercents({ z1: 100, z2: 0, z3: 0 })).toEqual({ z1: 100, z2: 0, z3: 0 })
  })
})

describe('the weeks rule E4 does not draw', () => {
  it('are the return steps after the race and the weeks of a start path', () => {
    for (const flags of [
      ['post-race'],
      ['ladder-1', 'run-walk'],
      ['ladder-4', 'restart-floor', 'run-walk'],
      ['injury-return', 'injury-level-2'],
      ['restart-floor', 'strength-block'],
    ]) {
      expect(isDrawnOutsideE4(flags), flags.join(',')).toBe(true)
    }
  })

  it('are not the loading, recovery, taper and race weeks', () => {
    for (const flags of [
      [],
      ['recovery'],
      ['strength-block'],
      ['taper'],
      ['race-week'],
      ['peak'],
    ]) {
      expect(isDrawnOutsideE4(flags), flags.join(',')).toBe(false)
    }
  })
})
