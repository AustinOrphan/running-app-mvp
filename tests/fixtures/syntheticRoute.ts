// A made-up outdoor loop in open ocean (no real place), sampled once a second, for the track tests.
export interface SyntheticFix {
  t: number
  lat: number
  lng: number
  distanceM: number
}

export const SYNTHETIC_ORIGIN = { lat: 12.3456, lng: -45.6789 }

/**
 * A wobbly figure-eight-like loop of `seconds` samples at about 3 m/s. The wobble is a small
 * deterministic sine so that simplification has noise to remove.
 */
export function syntheticRun(seconds: number): SyntheticFix[] {
  const out: SyntheticFix[] = []
  const radiusM = 900
  const mPerDegLat = 111_320
  const mPerDegLng = 111_320 * Math.cos((SYNTHETIC_ORIGIN.lat * Math.PI) / 180)
  let distance = 0
  let prev: { x: number; y: number } | null = null
  for (let t = 0; t < seconds; t++) {
    const angle = (t * 3) / radiusM
    const x = radiusM * Math.sin(angle) + 2 * Math.sin(t / 7)
    const y = radiusM * Math.sin(angle) * Math.cos(angle) + 2 * Math.cos(t / 5)
    if (prev) distance += Math.hypot(x - prev.x, y - prev.y)
    prev = { x, y }
    out.push({
      t,
      lat: SYNTHETIC_ORIGIN.lat + y / mPerDegLat,
      lng: SYNTHETIC_ORIGIN.lng + x / mPerDegLng,
      distanceM: distance,
    })
  }
  return out
}
