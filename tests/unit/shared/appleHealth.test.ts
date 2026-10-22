import { readFileSync } from 'node:fs'
import { SaxesParser } from 'saxes'
import { describe, expect, it, vi } from 'vitest'
import {
  attachRoute,
  createAppleExportReducer,
  parseAppleDate,
} from '../../../shared/importers/appleHealth.ts'
import type { AppleExportReducer } from '../../../shared/importers/appleHealth.ts'
import { parseGpx } from '../../../shared/importers/files/gpx.ts'
import type { ParsedActivity } from '../../../shared/types.ts'

vi.mock('../../../shared/importers/files/gpx.ts', () => ({ parseGpx: vi.fn() }))

const exportXml = readFileSync(new URL('../../fixtures/apple/export.xml', import.meta.url), 'utf8')

/** Feeds `xml` through saxes into the reducer, as the browser worker does. */
function feed(reducer: AppleExportReducer, xml: string): void {
  const parser = new SaxesParser()
  parser.on('opentag', (tag) => reducer.onOpenTag(tag.name, { ...tag.attributes }))
  parser.on('closetag', (tag) => reducer.onCloseTag(tag.name))
  parser.on('error', (error) => {
    throw error
  })
  parser.write(xml).close()
}

function runExport(xml = exportXml) {
  const reducer = createAppleExportReducer({ timezone: 'UTC' })
  feed(reducer, xml)
  const one = reducer.passOneResult()
  reducer.startPassTwo(one.workouts)
  feed(reducer, xml)
  return { one, activities: reducer.passTwoResult() }
}

describe('parseAppleDate', () => {
  it('reads an offset, an ISO form and a bare wall clock in a zone', () => {
    expect(parseAppleDate('2026-03-02 07:00:00 -0500', 'UTC')).toMatchObject({
      ms: Date.UTC(2026, 2, 2, 12),
      offsetMin: -300,
      date: '2026-03-02',
    })
    expect(parseAppleDate('2026-03-02T07:00:00+05:30', 'UTC')?.offsetMin).toBe(330)
    expect(parseAppleDate('2026-03-02T07:00:00Z', 'UTC')?.offsetMin).toBe(0)
    const bare = parseAppleDate('2026-07-01 12:00:00', 'America/New_York')
    expect(bare?.offsetMin).toBe(-240)
    expect(bare?.ms).toBe(Date.UTC(2026, 6, 1, 16))
    expect(parseAppleDate('yesterday', 'UTC')).toBeNull()
  })
})

describe('Apple Health export reducer, pass one', () => {
  const { one } = runExport()

  it('finds both workouts, oldest first, with UTC instants and the recorded offset', () => {
    expect(one.workouts.map((w) => [w.startUtc, w.endUtc])).toEqual([
      ['2026-03-02T12:00:00.000Z', '2026-03-02T12:30:00.000Z'],
      ['2026-03-03T23:00:00.000Z', '2026-03-03T23:20:00.000Z'],
    ])
    expect(one.workouts[0]?.providerKey).toBe('apple:export:2026-03-02T12:00:00.000Z')
    expect(one.workouts[0]?.base?.utcOffsetMin).toBe(-300)
  })

  it('reads distance, statistics, elevation and device from the first workout', () => {
    expect(one.workouts[0]?.base).toMatchObject({
      type: 'run',
      subtype: null,
      elapsedSec: 1800,
      movingSec: 1770,
      distanceM: 5020,
      avgHr: 149,
      maxHr: 171,
      elevationGainM: 50,
      deviceName: 'Synthetic Watch',
    })
  })

  it('marks an indoor run as a treadmill run and converts miles from the attributes', () => {
    expect(one.workouts[1]?.base).toMatchObject({
      type: 'run',
      subtype: 'treadmill',
      distanceM: 4828,
      avgHr: null,
    })
  })

  it('reduces the daily records to wellness days', () => {
    expect(one.wellness).toEqual([
      {
        date: '2026-03-02',
        restingHr: 52,
        hrvRmssd: null,
        hrvSdnn: 45,
        sleepSec: null,
        sleepScore: null,
        weightKg: 83.2,
        vo2max: 45.3,
      },
      {
        date: '2026-03-03',
        restingHr: 51,
        hrvRmssd: null,
        hrvSdnn: null,
        sleepSec: 27_000,
        sleepScore: null,
        weightKg: null,
        vo2max: null,
      },
    ])
  })

  it('sums asleep stages once per night, on the wake date, and skips in-bed and awake time', () => {
    const night = one.wellness.find((day) => day.date === '2026-03-03')
    // 23:00-06:30 asleep (an overlapping second source adds nothing); 22:45-07:00 in bed excluded.
    expect(night?.sleepSec).toBe(7.5 * 3600)
  })
})

describe('Apple Health export reducer, pass two', () => {
  const { activities } = runExport()

  it('keeps heart-rate records inside each workout window, boundaries included', () => {
    expect(activities[0]?.samples).toEqual({
      t: [0, 600, 1740],
      d: null,
      hr: [120, 150, 166],
      alt: null,
      cad: null,
      pwr: null,
    })
    expect(activities[1]?.samples.t).toEqual([300])
    expect(activities[1]?.samples.hr).toEqual([130])
  })

  it('fills average and maximum heart rate from the samples when the workout has none', () => {
    expect(activities[0]?.avgHr).toBe(149)
    expect(activities[1]).toMatchObject({ avgHr: 130, maxHr: 130 })
  })

  it('returns one activity per workout and none when there is no workout', () => {
    expect(activities).toHaveLength(2)
    expect(runExport('<HealthData/>').activities).toEqual([])
  })
})

describe('attachRoute', () => {
  const base: ParsedActivity = {
    providerKey: 'apple:export:2026-03-02T12:00:00.000Z',
    startUtc: '2026-03-02T12:00:00.000Z',
    utcOffsetMin: -300,
    type: 'run',
    subtype: null,
    elapsedSec: 600,
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
    samples: { t: [0, 100, 300], d: null, hr: [120, 140, 160], alt: null, cad: null, pwr: null },
    laps: [],
  }
  const route: ParsedActivity = {
    ...base,
    startUtc: '2026-03-02T11:59:50.000Z',
    distanceM: 1500,
    elevationGainM: 12,
    elevationLossM: 3,
    startLat: 0.0123,
    startLng: -0.0149,
    samples: {
      t: [0, 10, 110, 310, 700],
      d: [0, 20, 220, 600, 1500],
      hr: null,
      alt: [5, 6, 8, 9, 3],
      cad: null,
      pwr: null,
    },
  }

  it('shifts the route onto the workout clock, drops points outside it and rounds the start', () => {
    vi.mocked(parseGpx).mockReturnValue([route])
    const out = attachRoute(base, '<gpx/>')
    expect(out.samples.t).toEqual([0, 100, 300])
    expect(out.samples.d).toEqual([20, 220, 600])
    expect(out.samples.alt).toEqual([6, 8, 9])
    expect(out.samples.hr).toEqual([120, 140, 160])
    expect(out).toMatchObject({
      distanceM: 1500,
      elevationGainM: 12,
      elevationLossM: 3,
      startLat: 0.01,
      startLng: -0.01,
    })
  })

  it('keeps the distance the workout already has', () => {
    vi.mocked(parseGpx).mockReturnValue([route])
    expect(attachRoute({ ...base, distanceM: 1400 }, '<gpx/>').distanceM).toBe(1400)
  })

  it('returns the activity unchanged when the file is unreadable or empty', () => {
    vi.mocked(parseGpx).mockImplementation(() => {
      throw new RangeError('no track points')
    })
    expect(attachRoute(base, 'junk')).toBe(base)
    vi.mocked(parseGpx).mockReturnValue([])
    expect(attachRoute(base, '<gpx/>')).toBe(base)
  })
})
