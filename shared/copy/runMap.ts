// The words of the run map (M1b). Plain functions: the figures vary with the runner's unit.
import type { Units } from '../types.ts'
import { formatDistance } from '../units.ts'

export const ROUTE_SECTION_NAME = 'Route of this run'
export const ROUTE_HEADING = 'Route'
export const OSM_CREDIT = '© OpenStreetMap contributors'
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright'

/** "The first and last 200 m are hidden." */
export function endsHiddenLine(endsHiddenM: number): string {
  return `The first and last ${String(endsHiddenM)} m are hidden.`
}

/** The legend of the cut-end markers. */
export const CUT_ENDS_LINE = 'Dashed rings mark where the route is cut.'

/** The legend of the start and finish markers. */
export const START_FINISH_LINE = 'The filled dot is the start, the open ring the finish.'

/** The text twin of the map: the distance, and whether the ends are hidden. */
export function routeSummary(distanceM: number | null, units: Units, endsHiddenM: number): string {
  const lead =
    distanceM === null ? 'Route of this run.' : `Route, ${formatDistance(distanceM, units)}.`
  return endsHiddenM > 0
    ? `${lead} ${endsHiddenLine(endsHiddenM)}`
    : `${lead} The whole route is shown.`
}

/** What the map says when it draws the route without a street map behind it. */
export const MAP_OFF_LINE = 'Map tiles are off.'
export const MAP_OFF_LINK = 'Turn them on in Settings.'
export function routeAloneLine(reason: 'offline' | 'failed'): string {
  if (reason === 'offline') return 'Offline: the route is drawn without a street map.'
  return 'The street map did not load. The route is drawn alone.'
}

/** The retry link after every tile failed. */
export const MAP_RETRY = 'Try again.'
