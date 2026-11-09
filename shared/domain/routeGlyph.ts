import {
  MAP_END_TRIM_M,
  decodePolyline,
  simplifyIndexes,
  trimTrackEnds,
  type Track,
} from '../importers/files/track.ts'
import type { RouteGlyph } from '../types.ts'

/**
 * Route glyphs: the shape of a run's route as a few dozen points in a square box, for the list
 * rows. A drawing and nothing else: it carries no start or finish, no scale and no place.
 */

/** Side of the box the path is fitted into; the longer side of the route spans all of it. */
export const GLYPH_BOX = 100
/** Most points a glyph keeps (a few dozen: enough for a bend, small enough to read as a line). */
export const GLYPH_MAX_POINTS = 48
/** First tolerance, as a share of the route's longer side; it widens until the path fits. */
const GLYPH_TOLERANCE_SHARE = 0.01
/** Near a pole the longitude scale tends to 0; the floor keeps the projection finite. */
const MIN_COS_LAT = 0.01
const M_PER_DEG = 111_320
/** A route whose longer side is under this many metres (a remnant after the cut) is not a shape. */
export const GLYPH_MIN_SPAN_M = 100

/**
 * The glyph of a stored track, or null when there is nothing to draw: the route has fewer than two
 * points, hiding the ends leaves nothing, or what is left spans under `GLYPH_MIN_SPAN_M`.
 *
 * Privacy: with `hideEnds` (the default for a runner, `User.hideMapEnds`) the route is cut with
 * `trimTrackEnds` first, exactly as the map is served, and the glyph is built from what is left;
 * the untrimmed points are not read past that call. The route is fitted with one scale on both
 * axes (a straight out-and-back stays a line), centred on the shorter axis, and never rotated:
 * north is up. Longitudes in a stored track are unwrapped, so the antimeridian needs no case.
 */
export function routeGlyph(track: Track, hideEnds: boolean): RouteGlyph | null {
  const shown = hideEnds ? trimTrackEnds(track, MAP_END_TRIM_M) : track
  if (!shown) return null
  const path = decodePolyline(shown.polyline)
  if (path.length < 2) return null

  const meanLat = path.reduce((sum, [lat]) => sum + lat, 0) / path.length
  const kx = M_PER_DEG * Math.max(MIN_COS_LAT, Math.cos((meanLat * Math.PI) / 180))
  const xs = path.map(([, lng]) => lng * kx)
  const ys = path.map(([lat]) => lat * M_PER_DEG)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const span = Math.max(maxX - minX, maxY - minY)
  if (!(span >= GLYPH_MIN_SPAN_M) || !Number.isFinite(span)) return null

  // Douglas-Peucker on the stored path; the tolerance widens until the count fits.
  const points = path.map(([lat, lng]) => ({ lat, lng }))
  let tolerance = span * GLYPH_TOLERANCE_SHARE
  let kept = simplifyIndexes(points, tolerance)
  while (kept.length > GLYPH_MAX_POINTS) {
    tolerance *= 1.3
    kept = simplifyIndexes(points, tolerance)
  }

  const scale = GLYPH_BOX / span
  const offX = (GLYPH_BOX - (maxX - minX) * scale) / 2
  const offY = (GLYPH_BOX - (maxY - minY) * scale) / 2
  const num = (v: number) => String(Math.round(v * 10) / 10)
  const d = kept
    .map((i, k) => {
      const x = offX + (xs[i]! - minX) * scale
      const y = offY + (maxY - ys[i]!) * scale
      return `${k === 0 ? 'M' : 'L'}${num(x)} ${num(y)}`
    })
    .join('')
  return { d }
}
