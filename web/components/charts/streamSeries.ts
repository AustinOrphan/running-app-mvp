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

function metresPerUnit(units: Units): number {
  return units === 'mi' ? M_PER_MILE : 1000
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
  const endSec = (k: number): number | null => {
    if (k < 0) return 0
    const start = num(stream.t[k])
    return start === null ? null : start + stream.sampleSec
  }
  const distanceAt = (k: number): number | null => (k < 0 ? 0 : num(d[k]))
  const back = Math.max(1, Math.round(PACE_WINDOW_SEC / stream.sampleSec))
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
