import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import { SaxesParser } from 'saxes'
import {
  attachRoute,
  createAppleExportReducer,
  type AppleExportReducer,
  type AppleWorkout,
} from '../../shared/importers/appleHealth.ts'
import type { ParsedActivity, WellnessInput } from '../../shared/types.ts'
import { READ_CHUNK_BYTES, readSourceChunk } from './blobs.ts'

export interface AppleExportProgress {
  phase: 'workouts' | 'heart-rate'
  /** Share of the whole job done, 0 to 1, over both passes. */
  fraction: number
}

export interface AppleExportResult {
  activities: ParsedActivity[]
  wellness: WellnessInput[]
  routesMatched: number
}

export interface AppleExportOptions {
  /** Reads dates that carry no offset. */
  timezone: string
  onProgress?: (progress: AppleExportProgress) => void
  signal?: AbortSignal
}

/** A route starts within this long of its workout. */
const ROUTE_MATCH_MS = 5 * 60_000

type Handler = (chunk: Uint8Array, final: boolean) => void

const isExportXml = (name: string) => /(^|\/)export\.xml$/i.test(name)
const isRoute = (name: string) => /(^|\/)workout-routes\/[^/]+\.gpx$/i.test(name)

/** Streams a ZIP (or a bare `export.xml`) and hands each wanted entry's chunks to its handler. */
async function walk(
  file: Blob,
  want: (name: string) => Handler | null,
  onBytes: (read: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (!/\.zip$/i.test((file as File).name ?? '')) {
    const handler = want('export.xml')
    if (!handler) return
    let offset = 0
    do {
      if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError')
      const end = Math.min(file.size, offset + READ_CHUNK_BYTES)
      handler(await readSourceChunk(file, offset, end), end >= file.size)
      offset = end
      onBytes(offset)
    } while (offset < file.size)
    return
  }

  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough)
  unzip.onfile = (entry) => {
    const handler = want(entry.name)
    if (!handler) return
    entry.ondata = (err, data, final) => {
      if (err) throw err
      handler(data, final)
    }
    entry.start()
  }
  let offset = 0
  do {
    if (signal?.aborted) throw new DOMException('Import cancelled.', 'AbortError')
    const end = Math.min(file.size, offset + READ_CHUNK_BYTES)
    unzip.push(await readSourceChunk(file, offset, end), end >= file.size)
    offset = end
    onBytes(offset)
  } while (offset < file.size)
}

/** Feeds the text of an XML entry to `reducer`, a chunk at a time. */
function xmlHandler(reducer: AppleExportReducer, seen: { xml: boolean }): Handler {
  const decoder = new TextDecoder()
  const parser = new SaxesParser()
  parser.on('opentag', (tag) => reducer.onOpenTag(tag.name, { ...tag.attributes }))
  parser.on('closetag', (tag) => reducer.onCloseTag(tag.name))
  parser.on('error', (error) => {
    throw new Error(`export.xml is not valid XML (${error.message}).`)
  })
  seen.xml = true
  return (chunk, final) => {
    parser.write(decoder.decode(chunk, { stream: !final }))
    if (final) parser.close()
  }
}

/** The instant of the first track point of a route file, or `null`. */
function routeStartMs(gpx: string): number | null {
  const from = gpx.search(/<trkpt[\s>]/)
  if (from < 0) return null
  const time = /<time>\s*([^<\s]+)\s*<\/time>/.exec(gpx.slice(from, from + 4096))
  const ms = time?.[1] === undefined ? NaN : Date.parse(time[1])
  return Number.isNaN(ms) ? null : ms
}

function nearestWorkout(workouts: AppleWorkout[], ms: number): AppleWorkout | null {
  let best: AppleWorkout | null = null
  let bestGap = ROUTE_MATCH_MS + 1
  for (const workout of workouts) {
    const gap = Math.abs(Date.parse(workout.startUtc) - ms)
    if (gap < bestGap) {
      best = workout
      bestGap = gap
    }
  }
  return best
}

/**
 * Reads an Apple Health `export.zip` (or a bare `export.xml`) in two streaming passes. Pass one
 * collects workouts and daily wellness values; pass two collects the heart rate inside each
 * workout window and matches `workout-routes/*.gpx` files to workouts by their first point.
 * Runs in a Web Worker in the app and on the main thread where there is no Worker.
 */
export async function processAppleExport(
  file: Blob,
  opts: AppleExportOptions,
): Promise<AppleExportResult> {
  const reducer = createAppleExportReducer({ timezone: opts.timezone })
  const notify = (phase: AppleExportProgress['phase'], pass: 0 | 1, read: number) => {
    const share = file.size === 0 ? 1 : Math.min(1, read / file.size)
    opts.onProgress?.({ phase, fraction: (pass + share) / 2 })
  }
  const missing = () =>
    new Error(
      'No export.xml found. Choose the export.zip from the Health app (Export All Health Data).',
    )

  // Pass one: workouts and daily values.
  const first = { xml: false }
  await walk(
    file,
    (name) => (isExportXml(name) ? xmlHandler(reducer, first) : null),
    (read) => notify('workouts', 0, read),
    opts.signal,
  )
  if (!first.xml) throw missing()
  const { workouts, wellness } = reducer.passOneResult()
  reducer.startPassTwo(workouts)

  // Pass two: heart rate inside the workout windows, and routes.
  const routes = new Map<string, string>()
  const second = { xml: false }
  await walk(
    file,
    (name) => {
      if (isExportXml(name)) return xmlHandler(reducer, second)
      if (!isRoute(name) || workouts.length === 0) return null
      const decoder = new TextDecoder()
      let text = ''
      return (chunk, final) => {
        text += decoder.decode(chunk, { stream: !final })
        if (!final) return
        const startMs = routeStartMs(text)
        const workout = startMs === null ? null : nearestWorkout(workouts, startMs)
        if (workout && !routes.has(workout.providerKey)) routes.set(workout.providerKey, text)
      }
    },
    (read) => notify('heart-rate', 1, read),
    opts.signal,
  )

  let routesMatched = 0
  const activities = reducer.passTwoResult().map((activity) => {
    const gpx = routes.get(activity.providerKey)
    const withRoute = gpx === undefined ? activity : attachRoute(activity, gpx)
    if (withRoute !== activity) routesMatched++
    return withRoute
  })
  opts.onProgress?.({ phase: 'heart-rate', fraction: 1 })
  return { activities, wellness, routesMatched }
}
