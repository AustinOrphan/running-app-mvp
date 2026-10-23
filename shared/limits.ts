// Bounds for one activity, shared by the manual form schema and the importers, the paging bounds
// of the activity list and the bounds of the fuel lab's products and logs.

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

// The fuel lab (phase 3a design 10.3 and 10.4). These are sanity bounds on what a form can send,
// not training guidance: no fluid or carbohydrate target comes from here.

/** Live products one runner may hold; archived products do not count. */
export const FUEL_PRODUCTS_MAX = 100
/** Steps of the replayed ladder that an answer carries: the latest ones. */
export const FUEL_LADDER_STEPS_SHOWN = 40
/** Logs the lab view lists in its history, newest first. */
export const FUEL_HISTORY_SHOWN = 30
/** The most days between `from` and `to` of one `GET /api/fuel/targets` request. */
export const FUEL_TARGETS_MAX_DAYS = 62
/** How far back an unlogged run still gets a prompt, and how many prompts show at once. */
export const FUEL_PROMPT_DAYS = 7
export const FUEL_PROMPTS_MAX = 3
export const FUEL_NAME_MAX = 60
export const FUEL_SERVING_LABEL_MAX = 40
/** Most items in one log. */
export const FUEL_ITEMS_MAX = 40
/** Most servings of one item in one log. */
export const FUEL_SERVINGS_MAX = 50
/** Largest amounts in one serving of a product. */
export const FUEL_SERVING_CARBS_MAX_G = 300
export const FUEL_SERVING_SODIUM_MAX_MG = 5000
export const FUEL_SERVING_KCAL_MAX = 1500
/** Largest fluid and sodium totals a log may record (a 150-hour event is the longest activity). */
export const FUEL_FLUID_MAX_ML = 100_000
export const FUEL_SODIUM_MAX_MG = 200_000

/**
 * Days either side of a race result's date within which a run or race activity may be linked to
 * the result (phase 3a design 11.4). The server enforces it and the result sheet lists activities
 * inside it.
 */
export const RESULT_ACTIVITY_WINDOW_DAYS = 3
