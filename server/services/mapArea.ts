// Trail and road (M1d), the download: the one request to the OpenStreetMap Overpass API for the ways
// inside the runner's area, stored as a class and a simplified geometry per way. Network only through
// the injected fetch (`Deps.fetch`). What leaves the server is the box and nothing else: no run, no
// route, no account detail.
import type { Deps } from '../app.ts'
import { HttpError, conflict, validationError } from '../errors.ts'
import { mapAreaBox, type GeoBox } from '../../shared/domain/mapArea.ts'
import {
  SURFACE_CLASS_VERSION,
  SURFACE_VERSION,
  WAY_CODES,
  classifyWay,
  type SurfaceTags,
} from '../../shared/domain/surface.ts'
import { encodePolyline, simplifyIndexes } from '../../shared/importers/files/track.ts'
import { loadProfile } from '../serialize.ts'
import type { MapAreaView } from '../../shared/types.ts'
import { clearSurfaceBins } from './surfaceBackfill.ts'
import { fetchOf } from './weatherCache.ts'

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
/** Names the app and nothing about the runner (the Overpass etiquette asks for an identifiable agent). */
export const OVERPASS_USER_AGENT = 'running-log/1 (self-hosted training log; one area download)'
/** The server-side limit written into the query, in seconds. */
export const OVERPASS_QUERY_TIMEOUT_S = 120
/** How long the app waits for the answer before it gives up, in milliseconds. */
export const OVERPASS_REQUEST_TIMEOUT_MS = 180_000
/** The most decoded bytes read from the answer; a denser area is refused rather than held in memory. */
export const OVERPASS_MAX_BYTES = 80 * 1024 * 1024
/** The most ways stored for one runner. */
export const MAX_WAYS = 250_000
/** A way's geometry is simplified to this many metres (the matcher looks 25 m either side). */
export const WAY_TOLERANCE_M = 3
/** Rows written per statement. */
const WAY_BATCH = 2000
/** Highways the query leaves out: nothing a runner uses. */
const EXCLUDED_HIGHWAYS =
  'motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway|bus_guideway|busway|platform|elevator|corridor|services|rest_area|abandoned|razed|via_ferrata|no'

/** Runners whose download is in flight; a second request for the same runner is refused. */
const downloading = new Set<string>()

/** The Overpass QL of the one query: ways with `highway` in the box, with their tags and geometry. */
export function overpassQuery(box: GeoBox): string {
  const bbox = [box.minLat, box.minLng, box.maxLat, box.maxLng].map((n) => n.toFixed(2)).join(',')
  return [
    `[out:json][timeout:${String(OVERPASS_QUERY_TIMEOUT_S)}][maxsize:${String(OVERPASS_MAX_BYTES)}];`,
    `way["highway"]["highway"!~"^(${EXCLUDED_HIGHWAYS})$"](${bbox});`,
    'out tags geom qt;',
  ].join('\n')
}

export interface StoredWay {
  cls: string
  polyline: string
}

export interface ParsedOverpass {
  ways: StoredWay[]
  dataTimestamp: string | null
}

interface OverpassElement {
  type?: unknown
  tags?: unknown
  geometry?: unknown
}

function tagsOf(raw: unknown): SurfaceTags {
  if (typeof raw !== 'object' || raw === null) return {}
  const record = raw as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const key of ['highway', 'surface', 'tracktype', 'footway', 'sac_scale', 'foot', 'access']) {
    const value = record[key]
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/** Whether an Overpass answer says it stopped early (a `remark` about a timeout or memory). */
function stoppedEarly(body: { remark?: unknown }): string | null {
  return typeof body.remark === 'string' &&
    /error|timed out|out of memory|too many/i.test(body.remark)
    ? body.remark
    : null
}

/**
 * Overpass JSON as stored ways: the class from the tags (`classifyWay`), the geometry simplified to
 * `WAY_TOLERANCE_M` and encoded as a precision-5 polyline. Ways that are not for runners, and ways
 * with fewer than two positions, are dropped. Throws an `HttpError` when the answer says the query
 * stopped early, so a partial area is never stored.
 */
export function parseOverpass(body: unknown): ParsedOverpass {
  if (typeof body !== 'object' || body === null) throw badAnswer()
  const record = body as { elements?: unknown; remark?: unknown; osm3s?: unknown }
  const remark = stoppedEarly(record)
  if (remark !== null) {
    throw new HttpError(
      502,
      'internal',
      'OpenStreetMap stopped before it finished the area. Try again later, when its servers are less busy. Nothing was changed.',
    )
  }
  if (!Array.isArray(record.elements)) throw badAnswer()
  const osm3s = record.osm3s as { timestamp_osm_base?: unknown } | undefined
  const stamp = osm3s?.timestamp_osm_base
  const ways: StoredWay[] = []
  for (const element of record.elements as OverpassElement[]) {
    if (element.type !== 'way' || !Array.isArray(element.geometry)) continue
    const cls = classifyWay(tagsOf(element.tags))
    if (cls === null) continue
    const points: Array<{ lat: number; lng: number }> = []
    for (const node of element.geometry as Array<{ lat?: unknown; lon?: unknown } | null>) {
      if (node && typeof node.lat === 'number' && typeof node.lon === 'number') {
        points.push({ lat: node.lat, lng: node.lon })
      }
    }
    if (points.length < 2) continue
    const kept = simplifyIndexes(points, WAY_TOLERANCE_M).map((i) => points[i]!)
    ways.push({
      cls: WAY_CODES[cls],
      polyline: encodePolyline(kept.map((p) => [p.lat, p.lng] as const)),
    })
  }
  return { ways, dataTimestamp: typeof stamp === 'string' ? stamp : null }
}

function tooMuch(): HttpError {
  return new HttpError(
    502,
    'internal',
    'The area holds more map data than the app can take in one download. Nothing was changed.',
  )
}

/**
 * The answer's text, read as a stream and counted in decoded bytes (the length header is absent on a
 * chunked answer and counts compressed bytes on a gzip one). Past `OVERPASS_MAX_BYTES` the body is
 * cancelled and the download refused.
 */
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > OVERPASS_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    throw tooMuch()
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > OVERPASS_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw tooMuch()
    }
    chunks.push(value)
  }
  const whole = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    whole.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder().decode(whole)
}

function badAnswer(): HttpError {
  return new HttpError(
    502,
    'internal',
    'OpenStreetMap answered in a form the app could not read. Nothing was changed.',
  )
}

/** The failure of a refused or timed-out request, in words. Nothing was stored. */
function unavailable(status: number | null, timedOut: boolean): HttpError {
  if (timedOut) {
    return new HttpError(
      504,
      'internal',
      'OpenStreetMap did not answer in time. Try again later; nothing was changed.',
    )
  }
  const why =
    status === null ? 'could not be reached' : `refused the request (status ${String(status)})`
  return new HttpError(
    502,
    'internal',
    `OpenStreetMap ${why}. Its servers may be busy; try again later. Nothing was changed.`,
  )
}

/** The boxes of the runner's stored tracks of runs and races. */
async function trackBoxes(prisma: Deps['prisma'], userId: string): Promise<GeoBox[]> {
  return prisma.activityTrack.findMany({
    where: { activity: { userId, type: { in: ['run', 'race'] } } },
    select: { minLat: true, minLng: true, maxLat: true, maxLng: true },
  })
}

/**
 * Downloads the area again from scratch: asks Overpass once, replaces the runner's ways and area in
 * one transaction, and clears every run's shares so the `surface` job computes them again. Refuses a
 * second download for the same runner while one runs (409), a runner with no stored route (400), an
 * answer that says it stopped early or holds no ways (502), and a timeout (504). Nothing is changed
 * on any refusal.
 */
export async function downloadMapArea(
  deps: Deps,
  userId: string,
  opts: { now?: Date; timeoutMs?: number } = {},
): Promise<MapAreaView> {
  if (downloading.has(userId))
    throw conflict('A download is already running. Wait for it to finish.')
  downloading.add(userId)
  try {
    const box = mapAreaBox(await trackBoxes(deps.prisma, userId))
    if (box === null) {
      throw validationError(
        'No route is stored yet, so there is no area to download. Import a run with a GPS track first.',
      )
    }
    const timeoutMs = opts.timeoutMs ?? OVERPASS_REQUEST_TIMEOUT_MS
    let response: Response
    try {
      response = await fetchOf(deps)(OVERPASS_URL, {
        method: 'POST',
        headers: {
          'User-Agent': OVERPASS_USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ data: overpassQuery(box) }).toString(),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const name = error instanceof Error ? error.name : ''
      throw unavailable(null, name === 'TimeoutError' || name === 'AbortError')
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw unavailable(response.status, false)
    }
    let parsed: ParsedOverpass
    try {
      parsed = parseOverpass(JSON.parse(await readCapped(response)) as unknown)
    } catch (error) {
      if (error instanceof HttpError) throw error
      const name = error instanceof Error ? error.name : ''
      throw name === 'TimeoutError' || name === 'AbortError' ? unavailable(null, true) : badAnswer()
    }
    if (parsed.ways.length > MAX_WAYS) throw tooMuch()
    if (parsed.ways.length === 0) {
      throw new HttpError(
        502,
        'internal',
        'OpenStreetMap returned no roads or paths for the area. Nothing was changed.',
      )
    }

    const fetchedAt = opts.now ?? new Date()
    const data = {
      minLat: box.minLat,
      minLng: box.minLng,
      maxLat: box.maxLat,
      maxLng: box.maxLng,
      fetchedAt,
      dataTimestamp: parsed.dataTimestamp,
      wayCount: parsed.ways.length,
      v: SURFACE_CLASS_VERSION,
      matchV: SURFACE_VERSION,
    }
    await deps.prisma.$transaction(
      async (tx) => {
        await tx.mapWay.deleteMany({ where: { userId } })
        for (let at = 0; at < parsed.ways.length; at += WAY_BATCH) {
          await tx.mapWay.createMany({
            data: parsed.ways
              .slice(at, at + WAY_BATCH)
              .map((way, i) => ({ userId, seq: at + i, cls: way.cls, polyline: way.polyline })),
          })
        }
        await tx.mapArea.upsert({
          where: { userId },
          create: { userId, ...data },
          update: data,
        })
        await clearSurfaceBins(tx, userId)
      },
      { timeout: 120_000, maxWait: 10_000 },
    )
  } finally {
    downloading.delete(userId)
  }
  return loadMapArea(deps.prisma, userId)
}

/** Removes the runner's ways and area and clears every run's shares. A no-op without an area. */
export async function removeMapArea(prisma: Deps['prisma'], userId: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.mapWay.deleteMany({ where: { userId } })
      await tx.mapArea.deleteMany({ where: { userId } })
      await clearSurfaceBins(tx, userId)
    },
    { timeout: 120_000, maxWait: 10_000 },
  )
}

/** The downloaded area for Settings: null before the first download, with the runs inside it. */
export async function loadMapArea(prisma: Deps['prisma'], userId: string): Promise<MapAreaView> {
  const row = await prisma.mapArea.findUnique({ where: { userId } })
  const busy = downloading.has(userId)
  const { timezone: tz } = await loadProfile(prisma, userId)
  if (!row) return { tz, area: null, busy }
  const inside = {
    activity: { userId, type: { in: ['run', 'race'] } },
    minLat: { lte: row.maxLat },
    maxLat: { gte: row.minLat },
    minLng: { lte: row.maxLng },
    maxLng: { gte: row.minLng },
  }
  const [runs, done] = await Promise.all([
    prisma.activityTrack.count({ where: inside }),
    prisma.activityTrack.count({
      where: { ...inside, activity: { ...inside.activity, surfaceBins: { not: null } } },
    }),
  ])
  return {
    tz,
    area: {
      minLat: row.minLat,
      minLng: row.minLng,
      maxLat: row.maxLat,
      maxLng: row.maxLng,
      fetchedAt: row.fetchedAt.toISOString(),
      dataTimestamp: row.dataTimestamp,
      wayCount: row.wayCount,
      outdated: row.v !== SURFACE_CLASS_VERSION,
      runs,
      done,
    },
    busy,
  }
}
