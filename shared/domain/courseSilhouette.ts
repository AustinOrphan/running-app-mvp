// The goal course as a quiet silhouette under the race countdown on Today. The runner's course
// points (`RaceCheckpoint`) carry the climb and descent of each leg, not the track, so the profile
// is coarse: a relative elevation at each point, drawn as a smooth curve. Pure functions only; the
// words that go with the drawing are the countdown's own sentence.
import { spreadOverUnentered } from '../engine/legSpread.ts'
import type { CourseSilhouettePoint, RaceCheckpointRow } from '../types.ts'

/** The smallest vertical span the drawing is scaled to, in metres: a gentle course stays gentle. */
export const MIN_SPAN_M = 150

/**
 * The course as relative elevations, net per leg: the start at 0, and at each point the climb less
 * the descent of every leg up to it. A leg's climb and descent are the runner's where the row
 * names them; otherwise they are the course ascent and descent left after the entered rows, spread
 * over the legs without a figure by distance (`spreadOverUnentered`, the rule the arrival ranges
 * use), and 0 when the goal states no total. The finish is the end of the last leg, so a course
 * with gaps in its rows is not forced to a figure the rows do not reach. Null when no row carries a
 * climb or a descent, or the line is flat: there is nothing to draw, and the page then shows no
 * silhouette.
 */
export function courseSilhouettePoints(
  checkpoints: readonly RaceCheckpointRow[],
  course: { distanceM: number | null; gainM: number | null; lossM: number | null },
): CourseSilhouettePoint[] | null {
  const total = course.distanceM
  if (total === null || total <= 0) return null
  const rows = checkpoints
    .filter((row) => row.distanceM > 0 && row.distanceM < total)
    .sort((a, b) => a.distanceM - b.distanceM)
  if (!rows.some((row) => row.gainM !== null || row.lossM !== null)) return null
  const stops = [...rows.map((row) => row.distanceM), total]
  const legM = stops.map((distanceM, i) => distanceM - (stops[i - 1] ?? 0))
  const gains = spreadOverUnentered([...rows.map((row) => row.gainM), null], legM, course.gainM)
  const losses = spreadOverUnentered([...rows.map((row) => row.lossM), null], legM, course.lossM)
  const points: CourseSilhouettePoint[] = [{ distanceM: 0, relM: 0 }]
  let relM = 0
  stops.forEach((distanceM, i) => {
    relM += (gains[i] ?? 0) - (losses[i] ?? 0)
    points.push({ distanceM, relM })
  })
  const levels = points.map((p) => p.relM)
  return Math.max(...levels) - Math.min(...levels) > 0 ? points : null
}

const round = (n: number): string => String(Math.round(n * 100) / 100)

/** Fritsch-Carlson tangents: a curve through the points that never overshoots between them. */
function tangents(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length
  const slope = xs.slice(1).map((x, i) => (ys[i + 1]! - ys[i]!) / (x - xs[i]!))
  const m = xs.map((_x, i) => {
    if (i === 0) return slope[0]!
    if (i === n - 1) return slope[n - 2]!
    const a = slope[i - 1]!
    const b = slope[i]!
    return a * b <= 0 ? 0 : (a + b) / 2
  })
  slope.forEach((s, i) => {
    if (s === 0) {
      m[i] = 0
      m[i + 1] = 0
      return
    }
    const a = m[i]! / s
    const b = m[i + 1]! / s
    const h = Math.hypot(a, b)
    if (h > 3) {
      m[i] = (3 * a * s) / h
      m[i + 1] = (3 * b * s) / h
    }
  })
  return m
}

/**
 * The line and the closed area of the silhouette in a `width` by `height` box, y down. The x axis
 * runs the whole course, the y axis from the lowest to the highest point over at least `MIN_SPAN_M`
 * (centred when the span is the floor), with `pad` units left above and below the curve. Empty
 * strings for fewer than two points.
 */
export function silhouettePaths(
  points: readonly CourseSilhouettePoint[],
  box: { width: number; height: number; pad: number },
): { line: string; area: string } {
  if (points.length < 2) return { line: '', area: '' }
  const { width, height, pad } = box
  const last = points[points.length - 1]!.distanceM
  const levels = points.map((p) => p.relM)
  const low = Math.min(...levels)
  const high = Math.max(...levels)
  const span = Math.max(high - low, MIN_SPAN_M)
  const base = (low + high) / 2 - span / 2
  const xs = points.map((p) => (last <= 0 ? 0 : (p.distanceM / last) * width))
  const ys = points.map((p) => height - pad - ((p.relM - base) / span) * (height - 2 * pad))
  const m = tangents(xs, ys)
  let line = `M${round(xs[0]!)} ${round(ys[0]!)}`
  for (let i = 1; i < xs.length; i += 1) {
    const dx = (xs[i]! - xs[i - 1]!) / 3
    line +=
      `C${round(xs[i - 1]! + dx)} ${round(ys[i - 1]! + m[i - 1]! * dx)}` +
      ` ${round(xs[i]! - dx)} ${round(ys[i]! - m[i]! * dx)}` +
      ` ${round(xs[i]!)} ${round(ys[i]!)}`
  }
  const area = `${line}L${round(width)} ${round(height)}L0 ${round(height)}Z`
  return { line, area }
}
