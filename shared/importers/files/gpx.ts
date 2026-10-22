import { XMLParser, XMLValidator } from 'fast-xml-parser'
import type { ParsedActivity } from '../../types.ts'
import {
  classifySport,
  elevationGainLoss,
  fillSamples,
  haversineM,
  isFootActivity,
  mean,
  msToUtcIso,
  offsetMinFor,
  roundCoord,
  shaProviderKey,
  toNumber,
  toUtcIso,
} from './summarize.ts'
import type { RawPoint } from './summarize.ts'

export type XmlNode = Record<string, unknown>

export function isNode(value: unknown): value is XmlNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A single value or a list as a list; nothing as an empty one. */
export function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** The text of an element, whether it has attributes or not. */
export function textOf(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim()
  if (typeof value === 'number') return String(value)
  if (isNode(value)) return textOf(value['#text'])
  return null
}

export function numberOf(value: unknown): number | null {
  return toNumber(textOf(value))
}

/**
 * Finds the first element called `names` (compared without case) anywhere under `node`, to the
 * given depth. Namespace prefixes are already removed, so `gpxtpx:hr` is `hr`.
 */
export function findDeep(node: unknown, names: readonly string[], depth = 4): unknown {
  if (!isNode(node) || depth < 0) return undefined
  for (const [key, value] of Object.entries(node)) {
    if (names.includes(key.toLowerCase())) return value
  }
  for (const value of Object.values(node)) {
    for (const item of asArray(value)) {
      const found = findDeep(item, names, depth - 1)
      if (found !== undefined) return found
    }
  }
  return undefined
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Entity definitions in a file chosen by the user are not needed to read coordinates.
  processEntities: false,
  isArray: (name) =>
    ['trk', 'trkseg', 'trkpt', 'Activity', 'Lap', 'Track', 'Trackpoint', 'NextSport'].includes(
      name,
    ),
})

/**
 * Parses XML bytes (a byte order mark and CRLF line endings are fine) into nested objects with
 * attributes prefixed `@_`. Throws `RangeError` for malformed XML. Shared with the TCX parser.
 */
export function parseXmlDocument(bytes: Uint8Array, label: string): XmlNode {
  if (bytes.length === 0) throw new RangeError(`Unreadable ${label} file: it is empty`)
  const xml = new TextDecoder('utf-8').decode(bytes)
  const valid = XMLValidator.validate(xml)
  if (valid !== true) {
    throw new RangeError(`Unreadable ${label} file: ${valid.err.msg} (line ${valid.err.line})`)
  }
  let doc: unknown
  try {
    doc = parser.parse(xml)
  } catch (e) {
    throw new RangeError(`Unreadable ${label} file: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!isNode(doc)) throw new RangeError(`Unreadable ${label} file: no content`)
  return doc
}

interface Point {
  ms: number
  lat: number | null
  lng: number | null
  alt: number | null
  hr: number | null
  cad: number | null
  pwr: number | null
}

function pointOf(node: unknown): Point | null {
  if (!isNode(node)) return null
  const iso = toUtcIso(textOf(node['time']))
  if (iso === null) return null
  const ext = node['extensions']
  return {
    ms: Date.parse(iso),
    lat: toNumber(node['@_lat']),
    lng: toNumber(node['@_lon']),
    alt: numberOf(node['ele']),
    hr: numberOf(findDeep(ext, ['hr', 'heartrate'])),
    cad: numberOf(findDeep(ext, ['cad', 'cadence'])),
    pwr: numberOf(findDeep(ext, ['power', 'watts', 'powerinwatts'])),
  }
}

/** Throws `RangeError` with a reason for an unreadable file. */
export function parseGpx(bytes: Uint8Array, opts: { timezone: string }): ParsedActivity[] {
  const doc = parseXmlDocument(bytes, 'GPX')
  const gpx = doc['gpx']
  if (!isNode(gpx)) throw new RangeError('Not a GPX file: there is no <gpx> element')
  const creator = textOf(gpx['@_creator'])

  const result: ParsedActivity[] = []
  let index = 0
  for (const trk of asArray(gpx['trk'])) {
    if (!isNode(trk)) continue
    const points = asArray(trk['trkseg'])
      .flatMap((seg) => (isNode(seg) ? asArray(seg['trkpt']) : []))
      .map(pointOf)
      .filter((p): p is Point => p !== null)
      .sort((a, b) => a.ms - b.ms)
    const first = points[0]
    const last = points[points.length - 1]
    if (!first || !last || points.length < 2) continue

    const typeText = textOf(trk['type'])
    const sport = typeText ? classifySport(typeText) : { type: 'run' as const, subtype: null }
    const foot = isFootActivity(sport.type, sport.subtype)
    const cadenceScale = foot ? 2 : 1

    let distance: number | null = null
    let previous: Point | null = null
    const raw: RawPoint[] = points.map((p) => {
      if (p.lat !== null && p.lng !== null) {
        if (previous?.lat != null && previous.lng != null) {
          distance = (distance ?? 0) + haversineM(previous.lat, previous.lng, p.lat, p.lng)
        } else if (distance === null) {
          distance = 0
        }
        previous = p
      }
      return {
        t: (p.ms - first.ms) / 1000,
        d: distance,
        hr: p.hr,
        alt: p.alt,
        cad: p.cad === null ? null : p.cad * cadenceScale,
        pwr: p.pwr,
      }
    })
    const samples = fillSamples(raw)
    const startUtc = msToUtcIso(first.ms)
    const change = samples.alt ? elevationGainLoss(samples.alt) : null
    const located = points.find((p) => p.lat !== null && p.lng !== null)
    const avgHr = mean(samples.hr ?? [])
    const avgCadence = mean(samples.cad ?? [])
    const avgPower = mean(samples.pwr ?? [])
    const finalDistance = samples.d ? samples.d[samples.d.length - 1]! : null

    result.push({
      providerKey: shaProviderKey(bytes, index),
      startUtc,
      utcOffsetMin: offsetMinFor(startUtc, opts.timezone),
      type: sport.type,
      subtype: sport.subtype,
      elapsedSec: Math.round((last.ms - first.ms) / 1000),
      movingSec: null,
      distanceM: finalDistance === null ? null : Math.round(finalDistance),
      elevationGainM: change?.gain ?? null,
      elevationLossM: change?.loss ?? null,
      avgHr: avgHr === null ? null : Math.round(avgHr),
      maxHr: samples.hr ? Math.round(samples.hr.reduce((m, v) => Math.max(m, v), 0)) : null,
      avgCadence: avgCadence === null ? null : Math.round(avgCadence),
      avgPowerW: avgPower === null ? null : Math.round(avgPower),
      deviceName: creator,
      startLat: located?.lat != null ? roundCoord(located.lat) : null,
      startLng: located?.lng != null ? roundCoord(located.lng) : null,
      samples,
      laps: [],
    })
    index++
  }
  return result
}
