// The words of trail and road (M1d): the Settings block that downloads the runner's map area, and the
// line on a run. `SURFACE_TEMPLATES` is spread into `TEMPLATES`, so the G5 lint renders each one.
// The figures are shares of the route matched to a mapped way: a description of where the run went,
// with no target and no good or bad kind of surface.
import { boxSizeM } from '../domain/mapArea.ts'
import type { SurfaceBins, Units } from '../types.ts'
import { tpl } from './template.ts'

/** The credit OpenStreetMap's licence (ODbL) asks for, wherever the data or what it produced is shown. */
export const SURFACE_CREDIT = 'Map data © OpenStreetMap contributors'
export const SURFACE_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'

/** The share of the route, in percent, that has to be unmatched before the run says so. */
export const NOT_MATCHED_NOTE_PCT = 20

export const SURFACE_TEMPLATES = {
  'surface.heading': tpl('Trail and road', {}, { shape: 'label' }),
  'surface.what': tpl(
    'Says how much of each run was on trail, paved path and road, from OpenStreetMap data for your area.',
  ),
  'surface.sent': tpl(
    'One request to OpenStreetMap with a box of up to 40 × 40 km around where you run. No run or route is sent.',
  ),
  'surface.when': tpl(
    'It is made when you press the button, and again only when you press it again. The runs are worked out here, from the stored routes.',
  ),
  'surface.download': tpl('Download map data', {}, { shape: 'label' }),
  'surface.again': tpl('Download again', {}, { shape: 'label' }),
  'surface.remove': tpl('Remove', {}, { shape: 'label' }),
  'surface.busy': tpl('Asking OpenStreetMap. This can take a few minutes.'),
  'surface.fetched': tpl(
    'Downloaded {date}: {ways} ways in an area of {size}, {runs} of your runs inside it.',
    { date: 'text', ways: 'text', size: 'text', runs: 'text' },
  ),
  'surface.loading': tpl('Reading the map area.'),
  'surface.unavailable': tpl('The map area could not be read. Try again in a moment.'),
  'surface.offline': tpl('You are offline. The download needs a connection.'),
  'surface.data-date': tpl('The OpenStreetMap data is from {date}.', { date: 'text' }),
  'surface.progress': tpl(
    '{done} of {runs} runs are worked out so far; the rest follow in the background.',
    { done: 'text', runs: 'text' },
  ),
  'surface.done': tpl('Every run inside the area has its shares.'),
  'surface.outdated': tpl(
    'The rules that sort ways changed since this download. Download again to use them.',
  ),
  'surface.removed-note': tpl(
    'Removing clears the shares on your runs. The map data can be downloaded again.',
  ),
  'surface.error': tpl('The download did not go through. Nothing was changed; try again later.'),
  'surface.not-matched': tpl('{share} of the route was not matched to a mapped way.', {
    share: 'text',
  }),
} as const

/** "23 × 31 km" (or miles): the size of a downloaded box, to the nearest whole unit. */
export function areaSizeText(
  box: { minLat: number; minLng: number; maxLat: number; maxLng: number },
  units: Units,
): string {
  const { heightM, widthM } = boxSizeM(box)
  const per = units === 'mi' ? 1609.344 : 1000
  const part = (m: number) => String(Math.max(1, Math.round(m / per)))
  return `${part(widthM)} × ${part(heightM)} ${units === 'mi' ? 'mi' : 'km'}`
}

/** Whole percents of `parts` that add up to 100 (largest remainder); all zero when the total is. */
function percents(parts: readonly number[]): number[] {
  const total = parts.reduce((a, b) => a + b, 0)
  if (total <= 0) return parts.map(() => 0)
  const raw = parts.map((p) => (p / total) * 100)
  const out = raw.map((r) => Math.floor(r))
  let missing = 100 - out.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, rest: r - Math.floor(r) }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (let k = 0; missing > 0; k = (k + 1) % order.length, missing--) out[order[k]!.i]! += 1
  return out
}

export interface SurfaceLine {
  /** "Trail 62 % · paved path 10 % · road 28 %": shares of the part of the route that was matched. */
  line: string
  /** The share of the whole route that was not matched, when it is over `NOT_MATCHED_NOTE_PCT` percent. */
  unmatchedPct: number | null
}

/**
 * The run page's line for a run's bins, or null when nothing was matched (the page then says
 * nothing). Unmatched metres are left out of the shares and counted in `unmatchedPct`. A kind with no
 * share is left out of the line.
 */
export function surfaceLine(bins: SurfaceBins): SurfaceLine | null {
  const matched = bins.trailM + bins.pavedM + bins.roadM
  const total = matched + bins.unknownM
  if (matched <= 0 || total <= 0) return null
  const [trail = 0, paved = 0, road = 0] = percents([bins.trailM, bins.pavedM, bins.roadM])
  const parts = [
    trail > 0 ? `Trail ${String(trail)} %` : null,
    paved > 0 ? `paved path ${String(paved)} %` : null,
    road > 0 ? `road ${String(road)} %` : null,
  ].filter((part) => part !== null)
  const line = parts.join(' · ')
  const unmatched = Math.round((bins.unknownM / total) * 100)
  return {
    // The lead of the line is a capital, whichever kind comes first.
    line: line.charAt(0).toUpperCase() + line.slice(1),
    unmatchedPct: unmatched > NOT_MATCHED_NOTE_PCT ? unmatched : null,
  }
}
