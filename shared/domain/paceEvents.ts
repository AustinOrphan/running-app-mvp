// The courses My paces predicts without a goal (rule C9, ADR 0020): the standard road distances of
// the events runners race, flat. Distances are conventions of the events, not engine numbers; the
// half-marathon matches `shared/domain/stats.ts`. A custom course is the caller's own.
import type { EventKey, EventSpec } from '../engine/myPaces.ts'

export const PACE_EVENTS: readonly EventSpec[] = [
  { key: 'five-k', distanceM: 5000, gainM: 0 },
  { key: 'ten-k', distanceM: 10000, gainM: 0 },
  { key: 'half', distanceM: 21097.5, gainM: 0 },
  { key: 'marathon', distanceM: 42195, gainM: 0 },
  { key: 'fifty-k', distanceM: 50000, gainM: 0 },
]

/** The name of each event as the page writes it; distances are not translated by the unit. */
export const PACE_EVENT_LABELS: Record<EventKey, string> = {
  'five-k': '5 km',
  'ten-k': '10 km',
  half: 'Half marathon',
  marathon: 'Marathon',
  'fifty-k': '50 km',
  custom: 'Your distance',
}
