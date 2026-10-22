import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { parseGpx } from '../../../shared/importers/files/gpx.ts'
import { parseTcx } from '../../../shared/importers/files/tcx.ts'
import { parseActivityFile } from '../../../shared/importers/files/index.ts'
import { localDateTime, summarize } from '../../../shared/importers/files/summarize.ts'

const gpxBytes = new Uint8Array(readFileSync('tests/fixtures/files/run-with-hr.gpx'))
const tcxBytes = new Uint8Array(readFileSync('tests/fixtures/files/two-laps.tcx'))

describe('parseGpx', () => {
  test('reads time, distance, elevation and TrackPointExtension heart rate and cadence', () => {
    const [a, ...rest] = parseGpx(gpxBytes, { timezone: 'UTC' })
    expect(rest).toEqual([])
    const hash = createHash('sha256').update(gpxBytes).digest('hex').slice(0, 16)
    expect(a).toMatchObject({
      providerKey: `sha:${hash}`,
      startUtc: '2026-01-05T20:00:00Z',
      utcOffsetMin: 0,
      type: 'run',
      elapsedSec: 40,
      movingSec: null,
      elevationGainM: 3,
      elevationLossM: 0,
      avgHr: 140,
      maxHr: 160,
      avgCadence: 168,
      avgPowerW: null,
      deviceName: 'Example Watch 100',
      startLat: 0,
      startLng: 0,
    })
    expect(a!.distanceM).toBe(44)
    expect(a!.samples.t).toEqual([0, 10, 20, 30, 40])
    expect(a!.samples.hr).toEqual([120, 130, 140, 150, 160])
    expect(a!.samples.cad).toEqual([160, 164, 168, 172, 176])
    expect(a!.samples.alt).toEqual([10, 11, 12.5, 12, 13])
    expect(a!.samples.pwr).toBeNull()
    expect(a!.samples.d![0]).toBe(0)
    expect(a!.samples.d![4]).toBeCloseTo(44.5, 0)
    expect(a!.laps).toEqual([])
  })

  test('a start at UTC+13 lands on the next local date', () => {
    const [a] = parseGpx(gpxBytes, { timezone: 'Pacific/Auckland' })
    expect(a!.utcOffsetMin).toBe(780)
    expect(localDateTime(a!.startUtc, a!.utcOffsetMin, 'Pacific/Auckland')).toEqual({
      date: '2026-01-06',
      startTime: '09:00',
    })
  })

  test('tolerates a byte order mark and CRLF line endings', () => {
    const text = new TextDecoder().decode(gpxBytes).replace(/\n/g, '\r\n')
    const bom = new Uint8Array([0xef, 0xbb, 0xbf])
    const body = new TextEncoder().encode(text)
    const bytes = new Uint8Array(bom.length + body.length)
    bytes.set(bom)
    bytes.set(body, bom.length)
    const [a] = parseGpx(bytes, { timezone: 'UTC' })
    expect(a!.samples.hr).toEqual([120, 130, 140, 150, 160])
    expect(a!.startUtc).toBe('2026-01-05T20:00:00Z')
  })

  test('maps the track type to an activity type and treats an untyped track as a run', () => {
    const text = new TextDecoder().decode(gpxBytes)
    const hike = parseGpx(new TextEncoder().encode(text.replace('running', 'hiking')), {
      timezone: 'UTC',
    })
    expect([hike[0]!.type, hike[0]!.subtype]).toEqual(['cross', 'hike'])
    const trail = parseGpx(new TextEncoder().encode(text.replace('running', 'trail_running')), {
      timezone: 'UTC',
    })
    expect([trail[0]!.type, trail[0]!.subtype]).toEqual(['run', 'trail'])
    const untyped = parseGpx(new TextEncoder().encode(text.replace('<type>running</type>', '')), {
      timezone: 'UTC',
    })
    expect([untyped[0]!.type, untyped[0]!.subtype]).toEqual(['run', null])
  })

  test('returns no activity for a track without timestamps', () => {
    const gpx =
      '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>' +
      '<trkpt lat="0" lon="0"><ele>1</ele></trkpt><trkpt lat="0.001" lon="0"><ele>2</ele></trkpt>' +
      '</trkseg></trk></gpx>'
    expect(parseGpx(new TextEncoder().encode(gpx), { timezone: 'UTC' })).toEqual([])
  })

  test('throws RangeError for malformed XML, a different document or empty input', () => {
    const enc = new TextEncoder()
    expect(() => parseGpx(enc.encode('<gpx><trk>'), { timezone: 'UTC' })).toThrow(RangeError)
    expect(() => parseGpx(enc.encode('<html></html>'), { timezone: 'UTC' })).toThrow(RangeError)
    expect(() => parseGpx(new Uint8Array(0), { timezone: 'UTC' })).toThrow(RangeError)
  })
})

describe('parseTcx', () => {
  test('reads laps, trackpoints, power and run cadence', () => {
    const [a, ...rest] = parseTcx(tcxBytes, { timezone: 'UTC' })
    expect(rest).toEqual([])
    expect(a).toMatchObject({
      startUtc: '2026-03-02T06:30:00Z',
      utcOffsetMin: 0,
      type: 'run',
      elapsedSec: 40,
      distanceM: 120,
      avgHr: 136,
      maxHr: 150,
      avgCadence: 174,
      avgPowerW: 226,
      deviceName: 'Example Watch 100',
      startLat: 0.01,
      startLng: 0.02,
    })
    expect(a!.providerKey).toMatch(/^sha:[0-9a-f]{16}$/)
    expect(a!.laps).toEqual([
      { startSec: 0, durationSec: 20, distanceM: 60, avgHr: 130, maxHr: 135, avgCadence: null },
      { startSec: 20, durationSec: 20, distanceM: 60, avgHr: 145, maxHr: 150, avgCadence: null },
    ])
    expect(a!.samples).toEqual({
      t: [0, 10, 20, 30, 40],
      d: [0, 30, 60, 90, 120],
      hr: [125, 130, 135, 140, 150],
      alt: [20, 21, 22, 21, 20],
      cad: [170, 172, 174, 176, 178],
      pwr: [210, 220, 230, 230, 240],
    })
  })

  test('summarize derives moving time from speed when the file has none', () => {
    const [a] = parseTcx(tcxBytes, { timezone: 'UTC' })
    expect(a!.movingSec).toBeNull()
    expect(summarize(a!).movingSec).toBe(40)
  })

  test('uses the profile timezone for the offset', () => {
    const [a] = parseTcx(tcxBytes, { timezone: 'America/Chicago' })
    expect(a!.utcOffsetMin).toBe(-360)
    expect(localDateTime(a!.startUtc, a!.utcOffsetMin, 'America/Chicago')).toEqual({
      date: '2026-03-02',
      startTime: '00:30',
    })
  })

  test('a Biking sport becomes a cross-training bike activity without doubled cadence', () => {
    const text = new TextDecoder().decode(tcxBytes).replace('Sport="Running"', 'Sport="Biking"')
    const [a] = parseTcx(new TextEncoder().encode(text), { timezone: 'UTC' })
    expect([a!.type, a!.subtype]).toEqual(['cross', 'bike'])
    expect(a!.samples.cad).toEqual([85, 86, 87, 88, 89])
  })

  test('throws RangeError for malformed XML or a different document', () => {
    const enc = new TextEncoder()
    expect(() => parseTcx(enc.encode('<TrainingCenterDatabase>'), { timezone: 'UTC' })).toThrow(
      RangeError,
    )
    expect(() => parseTcx(enc.encode('<gpx></gpx>'), { timezone: 'UTC' })).toThrow(RangeError)
  })
})

describe('parseActivityFile', () => {
  test('dispatches .gpx and .tcx by extension', () => {
    expect(parseActivityFile('a.gpx', gpxBytes, { timezone: 'UTC' })).toHaveLength(1)
    expect(parseActivityFile('dir/B.TCX', tcxBytes, { timezone: 'UTC' })).toHaveLength(1)
  })
})

describe('parseActivityFile with a corrupt timestamp', () => {
  const point = (time: string, lat: number) =>
    `<trkpt lat="${lat}" lon="0"><ele>10</ele><time>${time}</time></trkpt>`
  const gpx = (...times: string[]) =>
    `<?xml version="1.0"?><gpx version="1.1" creator="x" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>${times
      .map((t, i) => point(t, i / 10000))
      .join('')}</trkseg></trk></gpx>`
  const normal = [0, 10, 20, 30].map((s) => `2026-01-05T20:00:${String(s).padStart(2, '0')}Z`)

  test('rejects a file with a point dated far after the others', () => {
    const bytes = new TextEncoder().encode(gpx(...normal, '2099-01-05T20:00:40Z'))
    expect(() => parseActivityFile('stray.gpx', bytes, { timezone: 'UTC' })).toThrow(RangeError)
  })

  test('rejects a file with a point dated far before the others', () => {
    const bytes = new TextEncoder().encode(gpx('1970-01-01T00:00:00Z', ...normal))
    expect(() => parseActivityFile('stray.gpx', bytes, { timezone: 'UTC' })).toThrow(/48 hours/)
  })

  test('accepts a long but plausible activity', () => {
    const bytes = new TextEncoder().encode(gpx(normal[0]!, '2026-01-07T19:00:00Z'))
    expect(parseActivityFile('long.gpx', bytes, { timezone: 'UTC' })).toHaveLength(1)
  })
})
