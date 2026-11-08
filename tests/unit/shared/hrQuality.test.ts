import { describe, expect, it } from 'vitest'
import { P } from '../../../shared/engine/params/index.ts'
import { defaultBandRatios } from '../../../shared/engine/gradeCurve.ts'
import {
  computeHrQuality,
  gaDecouplingPct,
  hrQualityFailure,
  hrQualityPasses,
} from '../../../shared/importers/files/hrQuality.ts'
import { hrSourceOfDeviceInfos } from '../../../shared/importers/files/hrSource.ts'
import type { ActivityStreamData, HrQuality } from '../../../shared/types.ts'

/** A stream of `buckets` 10 s buckets run at `speed` m/s; hr, cadence and altitude come from functions of the bucket. */
function stream(
  buckets: number,
  opts: {
    hr?: (i: number) => number | null
    cad?: (i: number) => number | null
    speed?: (i: number) => number
    alt?: (i: number, distance: number) => number
  } = {},
): ActivityStreamData {
  const t: number[] = []
  const d: number[] = []
  const hr: Array<number | null> = []
  const cad: Array<number | null> = []
  const alt: number[] = []
  let distance = 0
  for (let i = 0; i < buckets; i++) {
    t.push(i * 10)
    d.push(distance)
    // Deterministic wobble, so no run of buckets repeats a value by accident.
    hr.push(opts.hr ? opts.hr(i) : 150 + ((i * 7) % 5))
    cad.push(opts.cad ? opts.cad(i) : 172)
    alt.push(opts.alt ? opts.alt(i, distance) : 100)
    distance += (opts.speed ? opts.speed(i) : 3) * 10
  }
  return {
    t,
    d,
    hr: hr as number[],
    alt,
    cad: cad as number[],
    pwr: null,
  }
}

const TWENTY_FIVE_MIN = 150

describe('computeHrQuality', () => {
  it('counts a clean steady run as all clean', () => {
    const q = computeHrQuality(stream(TWENTY_FIVE_MIN), 10, 'wrist')
    expect(q.movingSec).toBe(1490)
    expect(q.cleanSec).toBe(1490)
    expect([q.lockSec, q.spikeSec, q.dropSec, q.flatSec, q.mismatchSec]).toEqual([0, 0, 0, 0, 0])
    expect(hrQualityPasses(q)).toBe(true)
    expect(hrQualityFailure(q)).toBeNull()
  })

  it('flags a sustained cadence lock and ignores a short coincidence', () => {
    const locked = computeHrQuality(
      stream(TWENTY_FIVE_MIN, {
        hr: (i) => (i >= 40 && i < 90 ? 171 + (i % 3) : 150 + ((i * 7) % 5)),
        cad: () => 172,
      }),
      10,
      'wrist',
    )
    expect(locked.lockSec).toBe(500)
    expect(locked.cleanSec).toBe(990)
    expect(hrQualityPasses(locked)).toBe(false)
    expect(hrQualityFailure(locked)).toBe('cadence-lock')

    // Six buckets (a minute) within the band is under b2.qLockMinSec.
    const brief = computeHrQuality(
      stream(TWENTY_FIVE_MIN, { hr: (i) => (i >= 40 && i < 46 ? 172 : 150 + ((i * 7) % 5)) }),
      10,
      'wrist',
    )
    expect(brief.lockSec).toBe(0)
  })

  it('compares with twice a cadence stored for one foot, and not with a walking cadence', () => {
    const oneFoot = computeHrQuality(
      stream(TWENTY_FIVE_MIN, {
        hr: (i) => (i < 60 ? 171 + (i % 2) : 140 + (i % 4)),
        cad: () => 86,
      }),
      10,
      'wrist',
    )
    expect(oneFoot.lockSec).toBe(600)
    const walking = computeHrQuality(
      stream(TWENTY_FIVE_MIN, { hr: (i) => 50 + (i % 3), cad: () => 50 }),
      10,
      'wrist',
    )
    expect(walking.lockSec).toBe(0)
  })

  it('flags both neighbours of a jump faster than a heart changes', () => {
    const q = computeHrQuality(
      stream(TWENTY_FIVE_MIN, { hr: (i) => (i === 60 ? 190 : 150 + ((i * 7) % 5)) }),
      10,
      'wrist',
    )
    // The spike bucket and the bucket before it; the step after the spike also jumps back.
    expect(q.spikeSec).toBe(30)
    expect(q.cleanSec).toBe(1460)
  })

  it('counts missing heart rate as a dropout', () => {
    const q = computeHrQuality(
      stream(TWENTY_FIVE_MIN, { hr: (i) => (i >= 20 && i < 50 ? null : 150 + ((i * 7) % 5)) }),
      10,
      'wrist',
    )
    expect(q.dropSec).toBe(300)
    expect(q.cleanSec).toBeLessThan(q.movingSec - 290)
    const none = computeHrQuality(stream(TWENTY_FIVE_MIN, { hr: () => null }), 10, 'wrist')
    expect(none.dropSec).toBe(none.movingSec)
    expect(hrQualityFailure(none)).toBe('dropouts')
  })

  it('flags a minute of one exact value and not five buckets of it', () => {
    const six = computeHrQuality(
      stream(TWENTY_FIVE_MIN, { hr: (i) => (i >= 30 && i < 36 ? 140 : 150 + ((i * 7) % 5)) }),
      10,
      'wrist',
    )
    // 6 buckets of 10 s is exactly b2.qFlatLineSec.
    expect(P.b2.qFlatLineSec.value).toBe(60)
    expect(six.flatSec).toBe(60)
    const five = computeHrQuality(
      stream(TWENTY_FIVE_MIN, { hr: (i) => (i >= 30 && i < 35 ? 140 : 150 + ((i * 7) % 5)) }),
      10,
      'wrist',
    )
    expect(five.flatSec).toBe(0)
  })

  it('flags heart rate that falls while the grade-adjusted speed rises', () => {
    const q = computeHrQuality(
      stream(TWENTY_FIVE_MIN, {
        speed: (i) => (i >= 70 ? 3.9 : 3),
        hr: (i) => (i >= 70 ? 138 + (i % 3) : 152 + (i % 3)),
      }),
      10,
      'wrist',
    )
    expect(q.mismatchSec).toBeGreaterThan(0)
    expect(q.mismatchSec).toBeLessThanOrEqual(60)
    // The same fall at a constant speed is not a mismatch.
    const calm = computeHrQuality(
      stream(TWENTY_FIVE_MIN, { hr: (i) => (i >= 70 ? 138 + (i % 3) : 152 + (i % 3)) }),
      10,
      'wrist',
    )
    expect(calm.mismatchSec).toBe(0)
  })

  it('passes a strap by its source whatever the checks find, and needs the minimum time', () => {
    const noisy = stream(TWENTY_FIVE_MIN, { hr: (i) => (i % 2 === 0 ? 120 : 175) })
    const wrist = computeHrQuality(noisy, 10, 'wrist')
    const strap = computeHrQuality(noisy, 10, 'strap')
    expect(hrQualityPasses(wrist)).toBe(false)
    expect(hrQualityPasses(strap)).toBe(true)
    expect(hrQualityPasses(computeHrQuality(noisy, 10, 'unknown'))).toBe(false)
    const short = computeHrQuality(stream(60), 10, 'strap')
    expect(hrQualityPasses(short)).toBe(false)
    expect(hrQualityFailure(short)).toBe('short')
    expect(hrQualityPasses(null)).toBe(false)
  })

  it('gives a stream with no distance an all-zero summary', () => {
    const q = computeHrQuality(
      { t: [], d: null, hr: null, alt: null, cad: null, pwr: null },
      10,
      'unknown',
    )
    expect(q).toMatchObject({ movingSec: 0, cleanSec: 0, halves: null, gapDecouplingPct: null })
    expect(hrQualityPasses(q)).toBe(false)
  })
})

describe('grade-adjusted drift', () => {
  /** 50 minutes of rolling hills at constant effort: heart rate follows the grade-adjusted speed. */
  function hilly(drift: number): ActivityStreamData {
    const buckets = 300
    // A sine of altitude along the distance, 12 m high every 300 m: grades up to about 4%.
    const alt = (_i: number, distance: number) => 100 + 6 * Math.sin((distance / 300) * 2 * Math.PI)
    return stream(buckets, {
      alt,
      speed: (i) => 3 + 0.4 * Math.cos(((i * 30) / 300) * 2 * Math.PI),
      hr: (i) => (150 + ((i * 7) % 5)) * (i >= buckets / 2 ? 1 + drift : 1),
    })
  }

  it('keeps the clean time by band and half, and reads a figure on the Minetti curve', () => {
    const q = computeHrQuality(hilly(0.05), 10, 'strap')
    expect(q.halves).not.toBeNull()
    expect(q.gapDecouplingPct).not.toBeNull()
    const totalSec = q.halves!.sec.flat().reduce((sum, v) => sum + v, 0)
    expect(totalSec).toBeGreaterThan(2800)
    expect(totalSec).toBeLessThanOrEqual(q.cleanSec)
    // Same terrain in both halves and 5% more heart rate in the second: the figure sits near 5.
    expect(q.gapDecouplingPct!).toBeGreaterThan(3)
    expect(q.gapDecouplingPct!).toBeLessThan(7)
    expect(gaDecouplingPct(q, defaultBandRatios())).toBe(q.gapDecouplingPct)
  })

  it('moves with the ratios it is given, and needs the clean minutes in each half', () => {
    const q = computeHrQuality(hilly(0), 10, 'strap')
    const faster = defaultBandRatios().map((r) => r * 1.1)
    // A uniform scale of every ratio leaves a ratio of costs unchanged.
    expect(gaDecouplingPct(q, faster)).toBe(gaDecouplingPct(q, defaultBandRatios()))
    expect(gaDecouplingPct(q, [1, 1])).toBeNull()
    const thin: HrQuality = {
      ...q,
      halves: { ...q.halves!, sec: [q.halves!.sec[0].map(() => 1), q.halves!.sec[1]] },
    }
    expect(gaDecouplingPct(thin, defaultBandRatios())).toBeNull()
  })

  it('keeps no halves for a short run or one with no altitude profile', () => {
    expect(
      computeHrQuality(stream(150, { alt: (i) => 100 + (i % 7) }), 10, 'wrist').halves,
    ).toBeNull()
    expect(computeHrQuality(stream(300), 10, 'wrist').halves).toBeNull()
  })
})

describe('hrSourceOfDeviceInfos', () => {
  const creator = { device_index: 'creator', manufacturer: 'garmin', source_type: 'local' }
  it('reads an ANT+ or Bluetooth heart-rate device as a strap', () => {
    expect(
      hrSourceOfDeviceInfos([
        creator,
        { device_index: 1, device_type: 120, source_type: 'antplus' },
      ]),
    ).toBe('strap')
    expect(
      hrSourceOfDeviceInfos([
        creator,
        { device_index: 1, device_type: 1, source_type: 'bluetooth_low_energy' },
      ]),
    ).toBe('strap')
    expect(hrSourceOfDeviceInfos([{ device_type: 'heart_rate', source_type: 'antplus' }])).toBe(
      'strap',
    )
  })
  it('reads a file that lists no heart-rate device as wrist, and no device list as unknown', () => {
    expect(hrSourceOfDeviceInfos([creator])).toBe('wrist')
    // A bike sensor, a foot pod and the watch's own local device are not heart-rate sensors.
    expect(
      hrSourceOfDeviceInfos([
        creator,
        { device_type: 121, source_type: 'antplus' },
        { device_type: 1, source_type: 'antplus' },
        { device_type: 120, source_type: 'local' },
      ]),
    ).toBe('wrist')
    expect(hrSourceOfDeviceInfos([])).toBe('unknown')
  })
})
