import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  MAX_STREAM_BUCKETS,
  elevationGainLoss,
  fillSamples,
  localDateTime,
  sha256Hex,
  summarize,
} from '../../../shared/importers/files/summarize.ts'
import type { ParsedActivity } from '../../../shared/types.ts'

function parsed(over: Partial<ParsedActivity> = {}): ParsedActivity {
  return {
    providerKey: 'sha:0000000000000000',
    startUtc: '2026-01-05T07:00:00Z',
    utcOffsetMin: 0,
    type: 'run',
    subtype: null,
    elapsedSec: 0,
    movingSec: null,
    distanceM: null,
    elevationGainM: null,
    elevationLossM: null,
    avgHr: null,
    maxHr: null,
    avgCadence: null,
    avgPowerW: null,
    deviceName: null,
    startLat: null,
    startLng: null,
    samples: { t: [], d: null, hr: null, alt: null, cad: null, pwr: null },
    laps: [],
    ...over,
  }
}

describe('heart rate gaps', () => {
  const point = (t: number, hr: number | null) => ({ t, d: t * 3, hr })

  test('a heart rate is carried for at most 10 seconds, other channels for as long as needed', () => {
    const samples = fillSamples([
      point(0, 140),
      point(5, null),
      point(10, null),
      point(11, null),
      point(60, 150),
      point(65, null),
    ])
    expect(samples.hr).toEqual([140, 140, 140, 0, 150, 150])
    expect(samples.d).toEqual([0, 15, 30, 33, 180, 195])
  })

  test('a gap at the start is back-filled for 10 seconds only', () => {
    const samples = fillSamples([point(0, null), point(8, null), point(20, 130), point(21, null)])
    expect(samples.hr).toEqual([0, 0, 130, 130])
  })

  test('the stream and histogram leave gap samples out', () => {
    const t = Array.from({ length: 40 }, (_, i) => i)
    const hr = t.map((x) => (x < 10 || x >= 30 ? 150 : null))
    const samples = fillSamples(t.map((x, i) => ({ t: x, d: x * 3, hr: hr[i] })))
    const a = parsed({ elapsedSec: 39, distanceM: 117, samples })
    const { stream, hrHistogram } = summarize(a)
    expect(JSON.parse(JSON.stringify(stream.hr))).toEqual([150, 150, null, 150])
    const seconds = hrHistogram?.sec.reduce((sum, v) => sum + v, 0) ?? 0
    // 10 s of readings plus the 10 s carried, then 10 s after the strap came back; not 40 s.
    expect(seconds).toBeCloseTo(30, 0)
  })
})

describe('summarize stream', () => {
  test('averages each 10-second bucket and takes cumulative distance at the bucket end', () => {
    const t = Array.from({ length: 25 }, (_, i) => i)
    const a = parsed({
      elapsedSec: 24,
      distanceM: 48,
      samples: {
        t,
        d: t.map((x) => x * 2),
        hr: t.map((x) => 100 + x),
        alt: t.map(() => 5),
        cad: null,
        pwr: null,
      },
    })
    const { stream } = summarize(a)
    expect(stream.sampleSec).toBe(10)
    expect(stream.t).toEqual([0, 10, 20])
    expect(stream.d).toEqual([18, 38, 48])
    expect(stream.hr).toEqual([104.5, 114.5, 122])
    expect(stream.alt).toEqual([5, 5, 5])
    expect(stream.cad).toBeNull()
    expect(stream.pwr).toBeNull()
  })

  test('leaves empty buckets null in the means and flat in the distance', () => {
    const t = [0, 5, 9, 30, 34]
    const a = parsed({
      samples: {
        t,
        d: [0, 10, 20, 20, 30],
        hr: [100, 110, 120, 130, 140],
        alt: null,
        cad: null,
        pwr: null,
      },
    })
    const { stream } = summarize(a)
    expect(stream.t).toEqual([0, 10, 20, 30])
    expect(stream.d).toEqual([20, 20, 20, 30])
    expect(JSON.parse(JSON.stringify(stream.hr))).toEqual([110, null, null, 135])
  })

  test('a sample with a corrupt time neither sizes the stream nor lands in it', () => {
    const t = [0, 10, 20, 30, 100_000_000]
    const a = parsed({
      samples: {
        t,
        d: [0, 10, 20, 30, 40],
        hr: [100, 110, 120, 130, 140],
        alt: null,
        cad: null,
        pwr: null,
      },
    })
    const { stream } = summarize(a)
    expect(stream.t).toEqual([0, 10, 20, 30])
    expect(stream.d).toEqual([0, 10, 20, 30])
    expect(stream.hr).toEqual([100, 110, 120, 130])
  })

  test('a multi-day activity widens the buckets so the stream stays bounded', () => {
    const hours = 100
    const t = Array.from({ length: 101 }, (_, i) => i * hours * 36)
    const a = parsed({
      elapsedSec: hours * 3600,
      samples: {
        t,
        d: t.map((x) => x * 3),
        hr: t.map(() => 140),
        alt: null,
        cad: null,
        pwr: null,
      },
    })
    const { stream } = summarize(a)
    expect(stream.sampleSec).toBeGreaterThan(10)
    expect(stream.sampleSec % 10).toBe(0)
    expect(stream.t.length).toBeLessThanOrEqual(MAX_STREAM_BUCKETS)
    expect(stream.t[1]).toBe(stream.sampleSec)
    expect(stream.t.length).toBe(Math.floor((hours * 3600) / stream.sampleSec) + 1)
    expect(stream.d?.at(-1)).toBe(hours * 3600 * 3)
  })

  test('an activity with no samples has an empty stream', () => {
    const { stream, hrHistogram, decouplingPct, gapDistanceM } = summarize(parsed())
    expect(stream).toEqual({
      sampleSec: 10,
      t: [],
      d: null,
      hr: null,
      alt: null,
      cad: null,
      pwr: null,
    })
    expect(hrHistogram).toBeNull()
    expect(decouplingPct).toBeNull()
    expect(gapDistanceM).toBeNull()
  })
})

describe('summarize derived fields', () => {
  const t = Array.from({ length: 101 }, (_, i) => i)

  test('movingSec keeps the file value and otherwise counts samples above 0.5 m/s', () => {
    const base = {
      elapsedSec: 100,
      samples: {
        t,
        // Moves for 40 s, stands for 20 s, moves for 40 s at 3 m/s.
        d: t.map((x) => (x <= 40 ? 3 * x : x <= 60 ? 120 : 120 + 3 * (x - 60))),
        hr: null,
        alt: null,
        cad: null,
        pwr: null,
      },
    }
    expect(summarize(parsed({ ...base, movingSec: 90 })).movingSec).toBe(90)
    expect(summarize(parsed(base)).movingSec).toBe(80)
    expect(
      summarize(parsed({ samples: { ...base.samples, d: null }, elapsedSec: 100 })).movingSec,
    ).toBeNull()
  })

  test('a pause longer than 30 seconds adds nothing to the HR histogram', () => {
    const a = parsed({
      elapsedSec: 300,
      samples: {
        t: [0, 10, 20, 280, 290],
        d: null,
        hr: [150, 150, 150, 150, 150],
        alt: null,
        cad: null,
        pwr: null,
      },
    })
    const h = summarize(a).hrHistogram!
    // 0-10, 10-20 and 280-290 count; 20-280 is a pause; the last sample repeats the 10 s step.
    expect(h.sec[110]).toBe(40)
    expect(h.sec.reduce((x, y) => x + y, 0)).toBe(40)
  })

  test('decoupling needs a run of at least 40 minutes with HR and distance', () => {
    const make = (type: ParsedActivity['type'], seconds: number, withDistance = true) => {
      const tt = Array.from({ length: seconds }, (_, i) => i)
      return parsed({
        type,
        elapsedSec: seconds,
        samples: {
          t: tt,
          d: withDistance ? tt.map((x) => 3 * x) : null,
          hr: tt.map((x) => (x < seconds / 2 ? 140 : 147)),
          alt: null,
          cad: null,
          pwr: null,
        },
      })
    }
    expect(summarize(make('run', 2401)).decouplingPct).toBeCloseTo(5, 1)
    expect(summarize(make('race', 3000)).decouplingPct).toBeCloseTo(5, 1)
    expect(summarize(make('run', 2399)).decouplingPct).toBeNull()
    expect(summarize(make('cross', 3000)).decouplingPct).toBeNull()
    expect(summarize(make('run', 3000, false)).decouplingPct).toBeNull()
  })

  test('grade-adjusted distance is null without altitude or distance, and for non-runs', () => {
    const tt = Array.from({ length: 200 }, (_, i) => i)
    const make = (type: ParsedActivity['type'], alt: boolean) =>
      parsed({
        type,
        elapsedSec: 200,
        distanceM: 600,
        samples: {
          t: tt,
          d: tt.map((x) => 3 * x),
          hr: null,
          alt: alt ? tt.map(() => 0) : null,
          cad: null,
          pwr: null,
        },
      })
    expect(summarize(make('run', true)).gapDistanceM).toBe(600)
    expect(summarize(make('run', false)).gapDistanceM).toBeNull()
    expect(summarize(make('cross', true)).gapDistanceM).toBeNull()
  })

  test('grade-adjusted distance clamps the grade at 45%', () => {
    const tt = Array.from({ length: 200 }, (_, i) => i)
    const steep = parsed({
      elapsedSec: 200,
      distanceM: 600,
      samples: {
        t: tt,
        d: tt.map((x) => 3 * x),
        hr: null,
        alt: tt.map((x) => 3 * x * 2),
        cad: null,
        pwr: null,
      },
    })
    const clamped = parsed({
      elapsedSec: 200,
      distanceM: 600,
      samples: { ...steep.samples, alt: tt.map((x) => 3 * x * 0.45) },
    })
    expect(summarize(steep).gapDistanceM).toBe(summarize(clamped).gapDistanceM)
  })
})

describe('localDateTime', () => {
  test('uses the file offset when there is one', () => {
    expect(localDateTime('2026-01-05T20:00:00Z', 780, 'UTC')).toEqual({
      date: '2026-01-06',
      startTime: '09:00',
    })
    expect(localDateTime('2026-01-05T02:30:00Z', -330, 'Pacific/Auckland')).toEqual({
      date: '2026-01-04',
      startTime: '21:00',
    })
  })

  test('falls back to the timezone, including across a DST change', () => {
    expect(localDateTime('2026-07-01T04:30:00Z', null, 'America/New_York')).toEqual({
      date: '2026-07-01',
      startTime: '00:30',
    })
    expect(localDateTime('2026-01-01T04:30:00Z', null, 'America/New_York')).toEqual({
      date: '2025-12-31',
      startTime: '23:30',
    })
  })

  test('falls back to UTC for an unknown timezone', () => {
    expect(localDateTime('2026-01-05T20:00:00Z', null, 'Not/AZone')).toEqual({
      date: '2026-01-05',
      startTime: '20:00',
    })
  })
})

describe('helpers', () => {
  test('sha256Hex matches node:crypto for several lengths', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 200, 1000]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256)
      expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'))
    }
  })

  test('elevationGainLoss ignores wobble under the 1 m threshold', () => {
    expect(elevationGainLoss([10, 11, 12.5, 12, 13])).toEqual({ gain: 3, loss: 0 })
    expect(elevationGainLoss([10, 10.4, 9.8, 10.3])).toEqual({ gain: 0, loss: 0 })
    expect(elevationGainLoss([10, 14, 8])).toEqual({ gain: 4, loss: 6 })
    expect(elevationGainLoss([])).toEqual({ gain: 0, loss: 0 })
  })
})
