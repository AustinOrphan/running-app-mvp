import { buildTrack, type RoutePoint, type Track } from '../../shared/importers/files/track.ts'

// Made-up route shapes in open ocean (no real place) for the route glyph specs and shots. A shape
// is a polyline in metres east and north of the origin; `trackOf` turns it into a stored track.

const ORIGIN = { lat: 12.3456, lng: -45.6789 }

export type Metres = Array<[number, number]>

export const SHAPES = {
  loop: (radius = 900): Metres =>
    Array.from({ length: 121 }, (_, i) => {
      const a = (i / 120) * 2 * Math.PI
      return [radius * Math.cos(a) + 0.12 * radius * Math.sin(3 * a), radius * Math.sin(a)]
    }),
  outAndBack: (length = 4200): Metres => [
    [0, 0],
    [length * 0.45, length * 0.04],
    [length, length * 0.12],
    [length * 0.45, length * 0.04],
    [0, 0],
  ],
  figureEight: (radius = 700): Metres =>
    Array.from({ length: 161 }, (_, i) => {
      const a = (i / 160) * 2 * Math.PI
      return [radius * 1.4 * Math.sin(a), radius * Math.sin(a) * Math.cos(a) * 1.6]
    }),
  pointToPoint: (length = 6000): Metres =>
    Array.from({ length: 61 }, (_, i) => {
      const f = i / 60
      return [length * f, 500 * Math.sin(f * 5) + length * 0.22 * f * f]
    }),
} satisfies Record<string, (size?: number) => Metres>

/** The fixes of a path, one every 8 m, so the track builder has something to simplify. */
export function fixesOf(path: Metres): RoutePoint[] {
  const mLat = 111_320
  const mLng = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180)
  const out: RoutePoint[] = []
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1]!
    const [x1, y1] = path[i]!
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8))
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      const f = s / steps
      out.push({
        lat: ORIGIN.lat + (y0 + (y1 - y0) * f) / mLat,
        lng: ORIGIN.lng + (x0 + (x1 - x0) * f) / mLng,
        d: null,
      })
    }
  }
  return out
}

export function trackOf(path: Metres): Track {
  const track = buildTrack(fixesOf(path))
  if (!track) throw new Error('The shape has no track.')
  return track
}
