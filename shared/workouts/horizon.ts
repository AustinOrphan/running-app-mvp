// How far ahead the two channels that need no file reach (phase 3a design 6.4). The server builds
// both windows and the Integrations page names them in one sentence, so the numbers live here and
// neither side types its own.

/** Days of run sessions kept in the runner's intervals.icu calendar, today included. */
export const PUBLISH_HORIZON_DAYS = 14

/** Days the private calendar feed lists, today included: a month, where the watch gets two weeks. */
export const CALENDAR_DAYS = 28

/** The most days one status request may span (design 6.4); the 400 sentence names the same number. */
export const STATUS_MAX_DAYS = 60
