// Bounds for one activity, shared by the manual form schema and the importers, and the paging bounds
// of the activity list.

/**
 * Longest activity, in seconds: 150 hours. The Cocodona 250 cutoff is 125 hours and six-day races
 * last 144 hours, so this covers every event the app expects while still rejecting a file whose
 * timestamps are corrupt.
 */
export const MAX_DURATION_SEC = 540_000
export const MAX_DISTANCE_M = 1_000_000
export const MAX_ELEVATION_GAIN_M = 9000
export const MAX_NOTES = 2000

/** Rows in a page of `GET /api/activities` when the request names no `limit`. */
export const ACTIVITY_PAGE_DEFAULT = 100
/** The most rows one page of `GET /api/activities` may hold. */
export const ACTIVITY_PAGE_MAX = 500
/** The furthest `offset` a list request may name; far beyond any history, and inside SQLite's range. */
export const ACTIVITY_OFFSET_MAX = 1_000_000

/**
 * Days either side of a race result's date within which a run or race activity may be linked to
 * the result (phase 3a design 11.4). The server enforces it and the result sheet lists activities
 * inside it.
 */
export const RESULT_ACTIVITY_WINDOW_DAYS = 3
