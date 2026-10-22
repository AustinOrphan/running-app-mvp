import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { parseFit } from '../../../shared/importers/files/fit.ts'
import { localDateTime, summarize } from '../../../shared/importers/files/summarize.ts'
import { parseActivityFile } from '../../../shared/importers/files/index.ts'
import { buildFit } from '../../fixtures/fit/buildFit.ts'
import type { FitRecordInput } from '../../fixtures/fit/buildFit.ts'

const START = Date.UTC(2026, 0, 5, 7, 0, 0) / 1000
const OPTS = { timezone: 'UTC' }

/** One record per second at a constant speed; HR from `hrAt`, altitude from `altAt`. */
function steadyRecords(
  seconds: number,
  speed: number,
  hrAt: (t: number) => number,
  altAt: (distanceM: number) => number = () => 10,
): FitRecordInput[] {
  return Array.from({ length: seconds }, (_, t) => ({
    t,
    distanceM: speed * t,
    speedMps: speed,
    hr: hrAt(t),
    cadence: 85,
    altitudeM: altAt(speed * t),
  }))
}

function hourRun(altAt?: (distanceM: number) => number) {
  const bytes = buildFit({
    serial: 42,
    timeCreatedUnix: START,
    sessions: [
      {
        sport: 1,
        startUnix: START,
        durationSec: 3600,
        distanceM: 10800,
        records: steadyRecords(3600, 3, (t) => (t < 1800 ? 140 : 147), altAt),
      },
    ],
  })
  const [parsed] = parseFit(bytes, OPTS)
  if (!parsed) throw new Error('expected one activity')
  return parsed
}

describe('parseFit', () => {
  test('reads the session summary, device, location and offset', () => {
    const bytes = buildFit({
      serial: 42,
      timeCreatedUnix: START,
      utcOffsetMin: 780,
      productName: 'Example Watch 100',
      sessions: [
        {
          sport: 1,
          subSport: 3,
          startUnix: START,
          durationSec: 600,
          timerSec: 580,
          movingSec: 560,
          distanceM: 1800,
          ascentM: 12,
          descentM: 7,
          avgHr: 150,
          maxHr: 171,
          avgCadence: 84,
          avgPowerW: 230,
          lat: 0.0123456,
          lng: -0.0678901,
          records: [{ t: 0 }, { t: 600 }],
        },
      ],
    })
    const [a, ...rest] = parseFit(bytes, OPTS)
    expect(rest).toEqual([])
    expect(a).toMatchObject({
      providerKey: `fit:42-${START}`,
      startUtc: '2026-01-05T07:00:00Z',
      utcOffsetMin: 780,
      type: 'run',
      subtype: 'trail',
      elapsedSec: 600,
      movingSec: 560,
      distanceM: 1800,
      elevationGainM: 12,
      elevationLossM: 7,
      avgHr: 150,
      maxHr: 171,
      avgCadence: 168,
      avgPowerW: 230,
      deviceName: 'Example Watch 100',
      startLat: 0.01,
      startLng: -0.07,
    })
    expect(localDateTime(a!.startUtc, a!.utcOffsetMin, 'UTC')).toEqual({
      date: '2026-01-05',
      startTime: '20:00',
    })
  })

  test('copies records into aligned sample arrays, doubling per-leg running cadence', () => {
    const bytes = buildFit({
      sessions: [
        {
          sport: 1,
          startUnix: START,
          durationSec: 3,
          records: [
            { t: 0, distanceM: 0, hr: 120, cadence: 80, altitudeM: 10, powerW: 200 },
            { t: 1, distanceM: 3, hr: 122, cadence: 81, altitudeM: 11, powerW: 210 },
            { t: 3, distanceM: 9, hr: 124, cadence: 82, altitudeM: 12, powerW: 220 },
          ],
        },
      ],
    })
    const [a] = parseFit(bytes, OPTS)
    expect(a!.samples).toEqual({
      t: [0, 1, 3],
      d: [0, 3, 9],
      hr: [120, 122, 124],
      alt: [10, 11, 12],
      cad: [160, 162, 164],
      pwr: [200, 210, 220],
    })
  })

  test('leaves channels the file lacks as null', () => {
    const bytes = buildFit({
      sessions: [
        {
          sport: 1,
          startUnix: START,
          durationSec: 2,
          records: [
            { t: 0, hr: 120 },
            { t: 2, hr: 130 },
          ],
        },
      ],
    })
    const [a] = parseFit(bytes, OPTS)
    expect(a!.samples).toEqual({
      t: [0, 2],
      d: null,
      hr: [120, 130],
      alt: null,
      cad: null,
      pwr: null,
    })
    expect(a!.distanceM).toBeNull()
    expect(a!.utcOffsetMin).toBe(0)
  })

  test('maps sport and sub-sport to type and subtype', () => {
    const cases: Array<[number, number, string, string | null]> = [
      [1, 0, 'run', null],
      [1, 3, 'run', 'trail'],
      [1, 1, 'run', 'treadmill'],
      [1, 4, 'run', 'track'],
      [1, 2, 'run', 'road'],
      [11, 0, 'cross', 'walk'],
      [17, 0, 'cross', 'hike'],
      [2, 0, 'cross', 'bike'],
      [5, 0, 'cross', 'swim'],
      [10, 20, 'strength', null],
      [10, 0, 'strength', null],
    ]
    for (const [sport, subSport, type, subtype] of cases) {
      const bytes = buildFit({
        sessions: [
          { sport, subSport, startUnix: START, durationSec: 60, records: [{ t: 0 }, { t: 60 }] },
        ],
      })
      const [a] = parseFit(bytes, OPTS)
      expect([sport, subSport, a!.type, a!.subtype]).toEqual([sport, subSport, type, subtype])
    }
  })

  test('yields one activity per session and splits records and laps between them', () => {
    const second = START + 4000
    const bytes = buildFit({
      serial: 7,
      timeCreatedUnix: START,
      sessions: [
        {
          sport: 2,
          startUnix: START,
          durationSec: 1800,
          records: [
            { t: 0, hr: 100 },
            { t: 1800, hr: 110 },
          ],
          laps: [{ startSec: 0, durationSec: 1800, avgHr: 105 }],
        },
        {
          sport: 1,
          startUnix: second,
          durationSec: 1200,
          records: [
            { t: 0, hr: 130 },
            { t: 600, hr: 140 },
            { t: 1200, hr: 150 },
          ],
          laps: [
            { startSec: 0, durationSec: 600, avgHr: 135 },
            { startSec: 600, durationSec: 600, avgHr: 145 },
          ],
        },
      ],
    })
    const all = parseFit(bytes, OPTS)
    expect(all).toHaveLength(2)
    const [bike, run] = all
    expect([bike!.type, run!.type]).toEqual(['cross', 'run'])
    expect(bike!.providerKey).toBe(`fit:7-${START}`)
    expect(run!.providerKey).toBe(`fit:7-${START}#1`)
    expect(bike!.startUtc).toBe('2026-01-05T07:00:00Z')
    expect(run!.startUtc).toBe('2026-01-05T08:06:40Z')
    expect(bike!.samples.hr).toEqual([100, 110])
    expect(run!.samples.t).toEqual([0, 600, 1200])
    expect(run!.samples.hr).toEqual([130, 140, 150])
    expect(bike!.laps).toHaveLength(1)
    expect(run!.laps.map((l) => [l.startSec, l.durationSec, l.avgHr])).toEqual([
      [0, 600, 135],
      [600, 600, 145],
    ])
  })

  test('reads laps with distance, heart rate and doubled cadence', () => {
    const bytes = buildFit({
      sessions: [
        {
          sport: 1,
          startUnix: START,
          durationSec: 600,
          records: [{ t: 0 }, { t: 600 }],
          laps: [
            {
              startSec: 0,
              durationSec: 300,
              distanceM: 1000,
              avgHr: 140,
              maxHr: 150,
              avgCadence: 85,
            },
            { startSec: 300, durationSec: 300 },
          ],
        },
      ],
    })
    const [a] = parseFit(bytes, OPTS)
    expect(a!.laps).toEqual([
      { startSec: 0, durationSec: 300, distanceM: 1000, avgHr: 140, maxHr: 150, avgCadence: 170 },
      {
        startSec: 300,
        durationSec: 300,
        distanceM: null,
        avgHr: null,
        maxHr: null,
        avgCadence: null,
      },
    ])
  })

  test('falls back to a content hash when the file has no file_id', () => {
    const bytes = buildFit({
      omitFileId: true,
      sessions: [
        { sport: 1, startUnix: START, durationSec: 60, records: [{ t: 0 }, { t: 60 }] },
        { sport: 1, startUnix: START + 600, durationSec: 60, records: [{ t: 0 }, { t: 60 }] },
      ],
    })
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
    const [a, b] = parseFit(bytes, OPTS)
    expect(a!.providerKey).toBe(`sha:${hash}`)
    expect(b!.providerKey).toBe(`sha:${hash}#1`)
  })

  test('throws RangeError for a truncated or non-FIT file', () => {
    const bytes = buildFit({
      sessions: [
        { sport: 1, startUnix: START, durationSec: 60, records: [{ t: 0 }, { t: 30 }, { t: 60 }] },
      ],
    })
    expect(() => parseFit(bytes.slice(0, bytes.length - 3), OPTS)).toThrow(RangeError)
    expect(() => parseFit(bytes.slice(0, 40), OPTS)).toThrow(RangeError)
    expect(() => parseFit(new Uint8Array(0), OPTS)).toThrow(RangeError)
    expect(() => parseFit(new TextEncoder().encode('not a fit file at all'), OPTS)).toThrow(
      RangeError,
    )
  })
})

describe('summarize on a parsed FIT', () => {
  test('decoupling is the second-half HR per speed over the first half, minus 1', () => {
    const summary = summarize(hourRun())
    expect(summary.decouplingPct).toBeCloseTo(5.0, 1)
  })

  test('moving time comes from speed when the session records none', () => {
    const a = hourRun()
    expect(a.movingSec).toBeNull()
    expect(summarize(a).movingSec).toBe(3599)
  })

  test('HR histogram has 1 bpm bins from 40 and sums to the elapsed seconds', () => {
    const a = hourRun()
    const h = summarize(a).hrHistogram!
    expect(h.start).toBe(40)
    expect(h.width).toBe(1)
    expect(h.sec).toHaveLength(181)
    expect(h.sec.reduce((x, y) => x + y, 0)).toBe(a.elapsedSec)
    expect(h.sec[140 - 40]).toBe(1800)
    expect(h.sec[147 - 40]).toBe(1800)
  })

  test('grade-adjusted distance equals distance on the flat', () => {
    const a = hourRun(() => 10)
    expect(a.distanceM).toBe(10800)
    expect(summarize(a).gapDistanceM).toBe(10800)
  })

  test('grade-adjusted distance exceeds distance on a constant +8% grade', () => {
    const a = hourRun((d) => 10 + 0.08 * d)
    const gap = summarize(a).gapDistanceM!
    // Minetti (2002) cost of running at +8%: 5.435 J/kg/m against 3.6 on the flat.
    const expected = 10800 * (5.4349 / 3.6)
    expect(gap).toBeGreaterThan(10800 * 1.4)
    expect(Math.abs(gap - expected) / expected).toBeLessThan(0.01)
  })

  test('builds the 10-second stream from the recorded samples', () => {
    const a = hourRun()
    const { stream } = summarize(a)
    expect(stream.sampleSec).toBe(10)
    expect(stream.t).toHaveLength(360)
    expect(stream.t.slice(0, 3)).toEqual([0, 10, 20])
    expect(stream.hr!.slice(0, 2)).toEqual([140, 140])
    expect(stream.hr![359]).toBe(147)
    expect(stream.d![0]).toBe(27)
    expect(stream.cad![0]).toBe(170)
    expect(stream.pwr).toBeNull()
  })
})

describe('parseActivityFile', () => {
  test('chooses the parser by extension, ignoring case and directories', () => {
    const bytes = buildFit({
      sessions: [{ sport: 1, startUnix: START, durationSec: 60, records: [{ t: 0 }, { t: 60 }] }],
    })
    expect(parseActivityFile('2026/run.FIT', bytes, OPTS)).toHaveLength(1)
  })

  test('throws RangeError for an unsupported extension', () => {
    expect(() => parseActivityFile('notes.txt', new Uint8Array(4), OPTS)).toThrow(RangeError)
    expect(() => parseActivityFile('noextension', new Uint8Array(4), OPTS)).toThrow(RangeError)
  })
})
