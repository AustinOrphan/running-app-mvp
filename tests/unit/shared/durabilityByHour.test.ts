import { describe, expect, test } from 'vitest'
import {
  DURABILITY_MIN_FIGURE_MIN,
  DURABILITY_PART_HOUR_MIN,
  durabilityByHour,
} from '../../../shared/domain/durabilityByHour.ts'
import { TERRAIN_BAND_COUNT } from '../../../shared/domain/terrainShape.ts'
import { defaultBandRatios } from '../../../shared/engine/gradeCurve.ts'
import { computeHrQuality } from '../../../shared/importers/files/hrQuality.ts'
import type { ActivityStreamData } from '../../../shared/types.ts'
import { SAMPLE_SEC, stream } from '../../fixtures/durabilityStream.ts'

const SAMPLE = SAMPLE_SEC
const ONES = Array.from({ length: TERRAIN_BAND_COUNT }, () => 1)

const passing = (s: ActivityStreamData) => computeHrQuality(s, SAMPLE, 'strap')

describe('durabilityByHour', () => {
  test('a flat four-hour run gives four whole hours of the same pace and heart rate', () => {
    const s = stream([{ minutes: 240, speed: 3, grade: 0.01, hr: 140 }])
    const read = durabilityByHour(s, SAMPLE, passing(s), ONES)!
    expect(read.hrGap).toBeNull()
    expect(read.hours.map((h) => h.hour)).toEqual([1, 2, 3, 4])
    for (const hour of read.hours) {
      expect(hour.partial).toBe(false)
      expect(hour.minutes).toBe(60)
      expect(hour.paceSecPerKm).toBeCloseTo(1000 / 3, 0)
      expect(hour.hrBpm).toBe(140)
    }
  })

  test('hours follow the stream: a slower, higher-heart-rate last hour reads as such', () => {
    const s = stream([
      { minutes: 120, speed: 3, grade: 0.01, hr: 140 },
      { minutes: 60, speed: 2.5, grade: 0.01, hr: 150 },
    ])
    const read = durabilityByHour(s, SAMPLE, passing(s), ONES)!
    expect(read.hours.map((h) => h.hrBpm)).toEqual([140, 140, 150])
    expect(read.hours[2]!.paceSecPerKm).toBeCloseTo(400, 0)
  })

  test('a climb is read on the grade curve, not as a slow hour', () => {
    // Hour 1 climbs at 8% and hour 2 is level (1%), the speed of each set by the same Minetti cost.
    const ratios = defaultBandRatios()
    const climbRatio = ratios[ratios.length - 1]
    expect(climbRatio).toBeDefined()
    const s = stream([
      { minutes: 60, speed: 2, grade: 0.08, hr: 150 },
      { minutes: 60, speed: 3, grade: 0.01, hr: 150 },
      { minutes: 60, speed: 3, grade: 0.01, hr: 150 },
    ])
    const [one, two] = durabilityByHour(s, SAMPLE, passing(s), ratios)!.hours
    const raw = 1000 / 2 / (1000 / 3)
    expect(one!.paceSecPerKm! / two!.paceSecPerKm!).toBeLessThan(raw)
    // The raw pace is 50% slower; adjusted for an 8% climb the gap is a small fraction of that.
    expect(one!.paceSecPerKm! / two!.paceSecPerKm!).toBeLessThan(1.25)
  })

  test('a stop in the middle leaves its time in the hour and out of the moving seconds', () => {
    const s = stream([
      { minutes: 80, speed: 3, grade: 0.01, hr: 140 },
      { minutes: 20, speed: 0, grade: 0, hr: 100 },
      { minutes: 80, speed: 3, grade: 0.01, hr: 140 },
    ])
    const read = durabilityByHour(s, SAMPLE, passing(s), ONES)!
    // 180 minutes of clock: three whole hours; the stop sits in hour 2 and changes no figure.
    expect(read.hours).toHaveLength(3)
    expect(read.hours[1]!.paceSecPerKm).toBeCloseTo(1000 / 3, 0)
    expect(read.hours[1]!.hrBpm).toBe(140)
  })

  test('an hour spent almost wholly stopped has no figure', () => {
    const s = stream([
      { minutes: 60, speed: 3, grade: 0.01, hr: 140 },
      { minutes: 55, speed: 0, grade: 0, hr: 100 },
      { minutes: 5, speed: 3, grade: 0.01, hr: 140 },
      { minutes: 60, speed: 3, grade: 0.01, hr: 140 },
    ])
    const read = durabilityByHour(s, SAMPLE, passing(s), ONES)!
    expect(5).toBeLessThan(DURABILITY_MIN_FIGURE_MIN)
    expect(read.hours[1]!.paceSecPerKm).toBeNull()
    expect(read.hours[1]!.hrBpm).toBeNull()
    expect(read.hours[2]!.paceSecPerKm).not.toBeNull()
  })

  test('a last part-hour under the limit is left out and one over it is read, with its minutes', () => {
    const under = stream([
      { minutes: 180 + DURABILITY_PART_HOUR_MIN - 1, speed: 3, grade: 0.01, hr: 140 },
    ])
    expect(durabilityByHour(under, SAMPLE, passing(under), ONES)!.hours).toHaveLength(3)

    const over = stream([
      { minutes: 180 + DURABILITY_PART_HOUR_MIN + 1, speed: 3, grade: 0.01, hr: 140 },
    ])
    const hours = durabilityByHour(over, SAMPLE, passing(over), ONES)!.hours
    expect(hours).toHaveLength(4)
    expect(hours[3]).toMatchObject({ hour: 4, partial: true, minutes: 31, hrBpm: 140 })
    expect(hours[2]!.partial).toBe(false)
  })

  test('a heart rate that fails the checks leaves it out and keeps the pace, with the reason', () => {
    // No heart rate at all: every moving second is a dropout, and a wrist source must pass on the checks.
    const s = stream([{ minutes: 200, speed: 3, grade: 0.01, hr: null }])
    const failed = { ...s, hr: null }
    const quality = computeHrQuality(failed, SAMPLE, 'wrist')
    const read = durabilityByHour(failed, SAMPLE, quality, ONES)!
    expect(read.hrGap).toBe('dropouts')
    expect(read.hours.every((h) => h.hrBpm === null)).toBe(true)
    expect(read.hours[0]!.paceSecPerKm).toBeCloseTo(1000 / 3, 0)
  })

  test('a run with no stored quality summary shows pace and says the checks have not run', () => {
    const s = stream([{ minutes: 200, speed: 3, grade: 0.01, hr: 140 }])
    const read = durabilityByHour(s, SAMPLE, null, ONES)!
    expect(read.hrGap).toBe('not-checked')
    expect(read.hours.every((h) => h.hrBpm === null && h.paceSecPerKm !== null)).toBe(true)
  })

  test('a strap that passes by its source shows heart rate on the clean seconds only', () => {
    const s = stream([{ minutes: 200, speed: 3, grade: 0.01, hr: 140 }])
    const read = durabilityByHour(s, SAMPLE, passing(s), ONES)!
    expect(read.hrGap).toBeNull()
    expect(read.hours[0]!.hrBpm).toBe(140)
  })

  test('a stream with no altitude profile, no distance or a short clock gives nothing', () => {
    const s = stream([{ minutes: 200, speed: 3, grade: 0.01, hr: 140 }])
    expect(durabilityByHour({ ...s, alt: null }, SAMPLE, passing(s), ONES)).toBeNull()
    expect(durabilityByHour({ ...s, d: null }, SAMPLE, passing(s), ONES)).toBeNull()
    const short = stream([
      { minutes: DURABILITY_PART_HOUR_MIN - 5, speed: 3, grade: 0.01, hr: 140 },
    ])
    expect(durabilityByHour(short, SAMPLE, passing(short), ONES)).toBeNull()
    expect(durabilityByHour(s, SAMPLE, passing(s), [1, 1])).toBeNull()
  })
})
