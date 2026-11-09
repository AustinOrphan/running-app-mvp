// The numbers behind a stream chart, with no charting library: the points of one channel against the
// shared x-axis. The activity page reads them to decide whether there is anything to draw before it
// asks for the chart (`lazyCharts.tsx`), so this file must not import `recharts`.
import type { ActivityStreamData, Units } from '../../../shared/types.ts'

export type StreamData = ActivityStreamData & { sampleSec: number }
export type StreamChannel = 'pace' | 'hr' | 'alt'

export interface SeriesPoint {
  /** Kilometres or miles, or minutes when the stream has no distance. */
  x: number
  /** Seconds per unit for pace, bpm for heart rate, feet or metres for elevation; null is a gap. */
  y: number | null
}

const M_PER_MILE = 1609.344
const M_PER_FOOT = 0.3048
/** Pace is read over this much running, so 10-second buckets do not make it jitter. */
const PACE_WINDOW_SEC = 60
/** Below this speed the runner is treated as standing still and pace is a gap. */
const MIN_SPEED_MS = 0.5
const MAX_PACE_MIN_PER_UNIT = 30

export function metresPerUnit(units: Units): number {
  return units === 'mi' ? M_PER_MILE : 1000
}

/**
 * The tooltip's x value of a chart against distance (kilometres or miles, as the chart is drawn) as
 * metres from the start, or null when it is no finite number. The run map places its dot with it.
 */
export function distanceLabelToMetres(label: unknown, units: Units): number | null {
  const value =
    typeof label === 'number' || (typeof label === 'string' && label.trim() !== '')
      ? Number(label)
      : Number.NaN
  return Number.isFinite(value) ? value * metresPerUnit(units) : null
}

/** Empty buckets serialize as null even though the type says number. */
function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Distance when at least one bucket has it, otherwise time; every chart on a page shares the choice. */
export function streamXAxis(stream: StreamData): 'distance' | 'time' {
  const hasDistance = stream.d?.some((v) => (num(v) ?? 0) > 0) ?? false
  return hasDistance ? 'distance' : 'time'
}

/** Pace at bucket `i`, from the running done in the preceding window. */
function paceAt(stream: StreamData, i: number, units: Units): number | null {
  const d = stream.d
  if (d === null) return null
  const back = Math.max(1, Math.round(PACE_WINDOW_SEC / stream.sampleSec))
  // The start from standing has less than a window of running behind it: its pace is a spike at the
  // axis, not a reading. A stream shorter than one window keeps what it has.
  if (i + 1 < back && stream.t.length >= back) return null
  const endSec = (k: number): number | null => {
    if (k < 0) return 0
    const start = num(stream.t[k])
    return start === null ? null : start + stream.sampleSec
  }
  const distanceAt = (k: number): number | null => (k < 0 ? 0 : num(d[k]))
  const from = Math.max(i - back, -1)
  const t1 = endSec(i)
  const t0 = endSec(from)
  const d1 = distanceAt(i)
  const d0 = distanceAt(from)
  if (t1 === null || t0 === null || d1 === null || d0 === null) return null
  const metres = d1 - d0
  const seconds = t1 - t0
  if (seconds <= 0 || metres / seconds < MIN_SPEED_MS) return null
  const pace = seconds / (metres / metresPerUnit(units))
  return pace > MAX_PACE_MIN_PER_UNIT * 60 ? null : pace
}

/** The points of one channel against the shared x-axis. Points without an x position are dropped. */
export function buildSeries(
  stream: StreamData,
  channel: StreamChannel,
  units: Units,
): SeriesPoint[] {
  const source = channel === 'pace' ? stream.d : stream[channel]
  if (source === null) return []
  const axis = streamXAxis(stream)
  const points: SeriesPoint[] = []
  for (let i = 0; i < stream.t.length; i++) {
    let x: number | null
    if (axis === 'distance') {
      const metres = num(stream.d?.[i])
      x = metres === null ? null : metres / metresPerUnit(units)
    } else {
      const sec = num(stream.t[i])
      x = sec === null ? null : sec / 60
    }
    if (x === null) continue
    let y: number | null
    if (channel === 'pace') y = paceAt(stream, i, units)
    else {
      const raw = num(source[i])
      y = raw === null ? null : channel === 'alt' && units === 'mi' ? raw / M_PER_FOOT : raw
    }
    points.push({ x, y })
  }
  return points
}

/** A pause longer than this is a real break in the line; a shorter run of empty buckets is only sparse sampling. */
const MAX_BRIDGED_GAP_SEC = 300

/**
 * The points a chart draws: only the buckets that have a value, with one gap marker where more than
 * `MAX_BRIDGED_GAP_SEC` of the run has none. A channel sampled every few buckets (a value, then nulls)
 * therefore stays one line, while a real pause still breaks it.
 */
export function drawablePoints(points: SeriesPoint[], sampleSec: number): SeriesPoint[] {
  const maxBuckets = Math.max(1, Math.round(MAX_BRIDGED_GAP_SEC / sampleSec))
  const out: SeriesPoint[] = []
  let last = -1
  points.forEach((point, index) => {
    if (point.y === null) return
    const previous = out.at(-1)
    if (previous && index - last > maxBuckets) out.push({ x: previous.x, y: null })
    out.push(point)
    last = index
  })
  return out
}

/** One moment of the run with every channel's value, for the readout and the shared cursor. */
export interface AlignedRow {
  x: number
  pace: number | null
  hr: number | null
  alt: number | null
}

/**
 * The three channels on one x axis, a row per bucket that has an x position. Every channel drops
 * the same buckets (those without an x), so the rows line up by index; a channel the stream lacks
 * is null in every row.
 */
export function alignSeries(stream: StreamData, units: Units): AlignedRow[] {
  const pace = buildSeries(stream, 'pace', units)
  const hr = buildSeries(stream, 'hr', units)
  const alt = buildSeries(stream, 'alt', units)
  const lead = [pace, hr, alt].find((series) => series.length > 0)
  if (lead === undefined) return []
  return lead.map((point, i) => ({
    x: point.x,
    pace: pace[i]?.y ?? null,
    hr: hr[i]?.y ?? null,
    alt: alt[i]?.y ?? null,
  }))
}

/** The index of the row nearest to `x` (rows run in increasing x), or -1 for no rows. */
export function nearestRowIndex(rows: readonly AlignedRow[], x: number): number {
  if (rows.length === 0 || !Number.isFinite(x)) return -1
  let lo = 0
  let hi = rows.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((rows[mid]?.x ?? 0) < x) lo = mid + 1
    else hi = mid
  }
  const after = rows[lo]?.x ?? 0
  const before = rows[lo - 1]?.x
  return before !== undefined && x - before <= after - x ? lo - 1 : lo
}

/**
 * The planned pace band in the chart's own unit (seconds per mile or per km), fast end first. The
 * session stores the slow end first, in seconds per km. Null when the session has no pace target.
 */
export function plannedPaceBand(
  paceSecPerKm: readonly [number, number] | null | undefined,
  units: Units,
): { fast: number; slow: number } | null {
  if (!paceSecPerKm) return null
  const [a, b] = paceSecPerKm
  if (!(a > 0) || !(b > 0) || !Number.isFinite(a + b)) return null
  const scale = metresPerUnit(units) / 1000
  return { fast: Math.min(a, b) * scale, slow: Math.max(a, b) * scale }
}
