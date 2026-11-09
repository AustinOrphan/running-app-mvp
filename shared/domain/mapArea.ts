// The area of the one OpenStreetMap download (M1d): a box around the middle of where a runner runs,
// from the boxes of their stored tracks. It is the only thing the download sends, so it is rounded
// outward to 0.01 degrees (about 1 km) and capped.

export interface GeoBox {
  minLat: number
  minLng: number
  maxLat: number
  maxLng: number
}

/** The side of the largest box, in metres; the box is centred on the median centre of the runs. */
export const MAP_AREA_MAX_M = 40_000
/** The side of the smallest box, so a few runs near home still leave room for the next ones. */
export const MAP_AREA_MIN_M = 10_000
/** The share of runs, nearest the median centre, whose boxes decide the area. */
export const MAP_AREA_KEEP = 0.95
/** Degrees the box edges are rounded outward to. */
export const MAP_AREA_GRID_DEG = 0.01

const M_PER_DEG_LAT = 111_320

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function roundDown(value: number): number {
  return Math.round(Math.floor(value / MAP_AREA_GRID_DEG + 1e-9) * MAP_AREA_GRID_DEG * 100) / 100
}
function roundUp(value: number): number {
  return Math.round(Math.ceil(value / MAP_AREA_GRID_DEG - 1e-9) * MAP_AREA_GRID_DEG * 100) / 100
}

/**
 * The box to download for a runner whose tracks have these boxes, or null when there are none.
 *
 * 1. Each track is its centre (the middle of its box). The median centre is the median latitude and
 *    the median longitude of the centres.
 * 2. The `MAP_AREA_KEEP` share of tracks whose centres lie nearest the median centre (at least one)
 *    are kept; a race abroad or a trip does not stretch the box.
 * 3. The box is the union of the kept tracks' boxes, cut to `MAP_AREA_MAX_M` on a side centred on the
 *    median centre, and widened to at least `MAP_AREA_MIN_M` on a side around it.
 * 4. The edges are rounded outward to 0.01 degrees and kept within 85 degrees of the equator.
 */
export function mapAreaBox(tracks: ReadonlyArray<GeoBox>): GeoBox | null {
  if (tracks.length === 0) return null
  const centres = tracks.map((t) => ({
    lat: (t.minLat + t.maxLat) / 2,
    lng: (t.minLng + t.maxLng) / 2,
  }))
  const centre = { lat: median(centres.map((c) => c.lat)), lng: median(centres.map((c) => c.lng)) }
  const mPerDegLng = M_PER_DEG_LAT * Math.max(0.05, Math.cos((centre.lat * Math.PI) / 180))
  const ranked = tracks
    .map((box, i) => ({
      box,
      d: Math.hypot(
        (centres[i]!.lat - centre.lat) * M_PER_DEG_LAT,
        (centres[i]!.lng - centre.lng) * mPerDegLng,
      ),
    }))
    .sort((a, b) => a.d - b.d)
  const kept = ranked.slice(0, Math.max(1, Math.ceil(ranked.length * MAP_AREA_KEEP)))

  const halfLat = MAP_AREA_MAX_M / 2 / M_PER_DEG_LAT
  const halfLng = MAP_AREA_MAX_M / 2 / mPerDegLng
  const minHalfLat = MAP_AREA_MIN_M / 2 / M_PER_DEG_LAT
  const minHalfLng = MAP_AREA_MIN_M / 2 / mPerDegLng
  const union = kept.reduce<GeoBox>(
    (acc, { box }) => ({
      minLat: Math.min(acc.minLat, box.minLat),
      minLng: Math.min(acc.minLng, box.minLng),
      maxLat: Math.max(acc.maxLat, box.maxLat),
      maxLng: Math.max(acc.maxLng, box.maxLng),
    }),
    { minLat: 90, minLng: 180, maxLat: -90, maxLng: -180 },
  )
  const low = (value: number, mid: number, half: number, min: number) =>
    Math.min(Math.max(value, mid - half), mid - min)
  const high = (value: number, mid: number, half: number, min: number) =>
    Math.max(Math.min(value, mid + half), mid + min)
  return {
    minLat: Math.max(-85, roundDown(low(union.minLat, centre.lat, halfLat, minHalfLat))),
    minLng: Math.max(-180, roundDown(low(union.minLng, centre.lng, halfLng, minHalfLng))),
    maxLat: Math.min(85, roundUp(high(union.maxLat, centre.lat, halfLat, minHalfLat))),
    maxLng: Math.min(180, roundUp(high(union.maxLng, centre.lng, halfLng, minHalfLng))),
  }
}

/** Whether two boxes overlap. */
export function boxesOverlap(a: GeoBox, b: GeoBox): boolean {
  return (
    a.minLat <= b.maxLat && a.maxLat >= b.minLat && a.minLng <= b.maxLng && a.maxLng >= b.minLng
  )
}

/** The side lengths of a box in metres, at its middle latitude. */
export function boxSizeM(box: GeoBox): { heightM: number; widthM: number } {
  const midLat = (box.minLat + box.maxLat) / 2
  return {
    heightM: (box.maxLat - box.minLat) * M_PER_DEG_LAT,
    widthM: (box.maxLng - box.minLng) * M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180),
  }
}
