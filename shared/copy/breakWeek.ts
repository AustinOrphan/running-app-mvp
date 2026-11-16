// The words for a loading week that counts as the cycle's recovery week (rules E3, G-6, J7; owner
// decision 2026-11-15): the signal of the weekly decision and the focus of the week that repeats
// the loading week. A target is a sketch, so nothing here grades the week that was run; the
// sentence of the revision summary is `revision.break-repeat` (`revision.ts`).

/** The code of the weekly decision's signal. */
export const BREAK_SIGNAL = 'break-recovery'

export const BREAK_SIGNAL_DETAIL =
  'Last week was run at half its target or less, so it counts as this cycle’s recovery week. This week repeats the loading week it was planned as, and the loading weeks after it count from there.'

/** The reason the weekly review gives for the suggestion after such a week. */
export const BREAK_REVIEW_REASON =
  'Last week counts as the recovery week; the next week repeats the loading week.'

/** The focus of the week that repeats the loading week. */
export const BREAK_REPEAT_FOCUS = 'Loading week repeated: last week counted as the recovery week'
