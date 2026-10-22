// Bounds for one activity, shared by the manual form schema and the importers.

/**
 * Longest activity, in seconds: 150 hours. The Cocodona 250 cutoff is 125 hours and six-day races
 * last 144 hours, so this covers every event the app expects while still rejecting a file whose
 * timestamps are corrupt.
 */
export const MAX_DURATION_SEC = 540_000
export const MAX_DISTANCE_M = 1_000_000
export const MAX_ELEVATION_GAIN_M = 9000
export const MAX_NOTES = 2000
