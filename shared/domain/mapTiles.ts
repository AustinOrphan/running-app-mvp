// Slippy-map tile maths for the run map (M1b): Web Mercator, 256 px tiles, no map library. Pure, so
// the page and the tests share it. Longitudes may lie beyond +-180 (M1a unwraps a run across the
// antimeridian); a pixel position continues past the edge of the world and the tile column wraps.
import type { Units } from '../types.ts'

export const TILE_SIZE = 256
/** The latitude where the Web Mercator square ends. */
export const MAX_LATITUDE = 85.0511287798
/** The deepest zoom a fit asks for: a 50 m path still shows its streets at 17. */
export const MAX_FIT_ZOOM = 17
/** The deepest zoom the tile server serves. */
export const MAX_TILE_ZOOM = 19
const EARTH_CIRCUMFERENCE_M = 40_075_016.686

export interface Bbox {
  minLat: number
  minLng: number
  maxLat: number
  maxLng: number
}

export interface Pixel {
  x: number
  y: number
}

function clampLat(lat: number): number {
  return Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat))
}

/** The pixel of a position in the world at `zoom` (fractional zoom allowed): 256 * 2^zoom wide. */
export function project(lat: number, lng: number, zoom: number): Pixel {
  const size = TILE_SIZE * 2 ** zoom
  const sin = Math.sin((clampLat(lat) * Math.PI) / 180)
  return {
    x: ((lng + 180) / 360) * size,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
  }
}

/** The tile that holds a position at an integer zoom, without wrapping the column. */
export function tileOf(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const { x, y } = project(lat, lng, zoom)
  return { x: Math.floor(x / TILE_SIZE), y: Math.floor(y / TILE_SIZE) }
}

/** A tile column brought into `0..2^zoom - 1`, for a longitude past the antimeridian. */
export function wrapTileX(x: number, zoom: number): number {
  const n = 2 ** zoom
  return ((x % n) + n) % n
}

/** Space kept clear inside the box, in CSS pixels: one number for every side, or each side. */
export type Insets = number | { top: number; right: number; bottom: number; left: number }

function insetsOf(padding: Insets): { top: number; right: number; bottom: number; left: number } {
  return typeof padding === 'number'
    ? { top: padding, right: padding, bottom: padding, left: padding }
    : padding
}

/**
 * The largest zoom, fractional, at which the box fits in `width` x `height` pixels with `padding`
 * clear, capped at `maxZoom`. A box of no extent (one point) takes the cap.
 */
export function fitZoom(
  bbox: Bbox,
  width: number,
  height: number,
  padding: Insets = 0,
  maxZoom = MAX_FIT_ZOOM,
): number {
  const pad = insetsOf(padding)
  const availW = Math.max(1, width - pad.left - pad.right)
  const availH = Math.max(1, height - pad.top - pad.bottom)
  const a = project(bbox.maxLat, bbox.minLng, 0)
  const b = project(bbox.minLat, bbox.maxLng, 0)
  const spanX = Math.abs(b.x - a.x)
  const spanY = Math.abs(b.y - a.y)
  const ratio = Math.min(
    spanX === 0 ? Infinity : availW / spanX,
    spanY === 0 ? Infinity : availH / spanY,
  )
  if (!Number.isFinite(ratio)) return maxZoom
  return Math.max(0, Math.min(maxZoom, Math.log2(ratio)))
}

export interface MapView {
  width: number
  height: number
  /** The zoom of the layout, fractional. */
  zoom: number
  /** The integer zoom of the tiles fetched: `floor(zoom)`, one more on a high-density screen. */
  tileZoom: number
  /** A tile's side in CSS pixels at this layout: `256 * 2^(zoom - tileZoom)`. */
  tileCss: number
  /** The world pixel (at `zoom`) of the box's top-left corner. */
  originX: number
  originY: number
  /** The latitude of the box centre, for the scale. */
  centreLat: number
}

export interface ViewOptions {
  padding?: Insets
  /** `window.devicePixelRatio`; at 1.5 or more the tiles come one zoom level deeper. */
  density?: number
  maxZoom?: number
}

export const HIGH_DENSITY = 1.5

/** The view that centres the bbox in the box, less the padding, at the zoom that fits it. */
export function viewFor(
  bbox: Bbox,
  width: number,
  height: number,
  options: ViewOptions = {},
): MapView {
  const { padding = 0, density = 1, maxZoom = MAX_FIT_ZOOM } = options
  const zoom = fitZoom(bbox, width, height, padding, maxZoom)
  const pad = insetsOf(padding)
  const a = project(bbox.maxLat, bbox.minLng, zoom)
  const b = project(bbox.minLat, bbox.maxLng, zoom)
  const centreX = (a.x + b.x) / 2
  const centreY = (a.y + b.y) / 2
  const extra = density >= HIGH_DENSITY ? 1 : 0
  const tileZoom = Math.min(MAX_TILE_ZOOM, Math.floor(zoom) + extra)
  return {
    width,
    height,
    zoom,
    tileZoom,
    tileCss: TILE_SIZE * 2 ** (zoom - tileZoom),
    originX: centreX - (pad.left + (width - pad.left - pad.right) / 2),
    originY: centreY - (pad.top + (height - pad.top - pad.bottom) / 2),
    centreLat: (bbox.minLat + bbox.maxLat) / 2,
  }
}

/** A position in the box, in CSS pixels. */
export function toBox(view: MapView, lat: number, lng: number): Pixel {
  const p = project(lat, lng, view.zoom)
  return { x: p.x - view.originX, y: p.y - view.originY }
}

export interface TilePlacement {
  key: string
  x: number
  y: number
  z: number
  /** Position and extent in the box, whole pixels so neighbours meet without a seam. */
  left: number
  top: number
  width: number
  height: number
}

/** Every tile the box shows, with the column wrapped and rows off the world dropped. */
export function tilesFor(view: MapView): TilePlacement[] {
  const n = 2 ** view.tileZoom
  const s = view.tileCss
  const firstX = Math.floor(view.originX / s)
  const lastX = Math.floor((view.originX + view.width) / s)
  const firstY = Math.max(0, Math.floor(view.originY / s))
  const lastY = Math.min(n - 1, Math.floor((view.originY + view.height) / s))
  const out: TilePlacement[] = []
  for (let ty = firstY; ty <= lastY; ty++) {
    for (let tx = firstX; tx <= lastX; tx++) {
      const left = Math.floor(tx * s - view.originX)
      const top = Math.floor(ty * s - view.originY)
      const x = wrapTileX(tx, view.tileZoom)
      out.push({
        key: `${String(view.tileZoom)}/${String(x)}/${String(ty)}@${String(tx)}`,
        x,
        y: ty,
        z: view.tileZoom,
        left,
        top,
        width: Math.floor((tx + 1) * s - view.originX) - left,
        height: Math.floor((ty + 1) * s - view.originY) - top,
      })
    }
  }
  return out
}

/** The tile server's address for a tile. */
export function tileUrl(tile: Pick<TilePlacement, 'x' | 'y' | 'z'>): string {
  return `https://tile.openstreetmap.org/${String(tile.z)}/${String(tile.x)}/${String(tile.y)}.png`
}

/** Metres on the ground under one CSS pixel at the view's centre. */
export function metresPerPixel(view: MapView): number {
  return (
    (EARTH_CIRCUMFERENCE_M * Math.cos((clampLat(view.centreLat) * Math.PI) / 180)) /
    (TILE_SIZE * 2 ** view.zoom)
  )
}

interface ScaleStep {
  metres: number
  label: string
}

const M_PER_FOOT = 0.3048
const M_PER_MILE = 1609.344

const METRIC_STEPS: ScaleStep[] = [
  ...[10, 20, 50, 100, 200, 500].map((m) => ({ metres: m, label: `${String(m)} m` })),
  ...[1, 2, 5, 10, 20, 50, 100, 200, 500].map((km) => ({
    metres: km * 1000,
    label: `${String(km)} km`,
  })),
]

const IMPERIAL_STEPS: ScaleStep[] = [
  ...[50, 100, 200, 500].map((ft) => ({ metres: ft * M_PER_FOOT, label: `${String(ft)} ft` })),
  ...[0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].map((mi) => ({
    metres: mi * M_PER_MILE,
    label: `${String(mi)} mi`,
  })),
]

export interface ScaleBar {
  label: string
  /** Length in CSS pixels. */
  px: number
}

/** The longest round distance in the runner's unit that fits in `maxPx`, or null when none does. */
export function scaleBar(metresPerPx: number, units: Units, maxPx: number): ScaleBar | null {
  if (!(metresPerPx > 0)) return null
  const steps = units === 'mi' ? IMPERIAL_STEPS : METRIC_STEPS
  let best: ScaleBar | null = null
  for (const step of steps) {
    const px = step.metres / metresPerPx
    if (px <= maxPx) best = { label: step.label, px }
  }
  return best
}

/**
 * The position (in whatever space `points` are in) at `distM` along a path whose points carry the cumulative distances `dist`, found by
 * binary search and linear interpolation. Null for a distance outside the path (the hidden ends
 * included), a path of no points or distances that do not match it.
 */
export function pointAtDistance(
  points: readonly Pixel[],
  dist: readonly number[],
  distM: number,
): Pixel | null {
  const n = points.length
  if (n === 0 || dist.length !== n || !Number.isFinite(distM)) return null
  if (distM < dist[0]! || distM > dist[n - 1]!) return null
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (dist[mid]! <= distM) lo = mid
    else hi = mid
  }
  const d0 = dist[lo]!
  const d1 = dist[hi]!
  const f = d1 === d0 ? 0 : (distM - d0) / (d1 - d0)
  const a = points[lo]!
  const b = points[hi]!
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}
