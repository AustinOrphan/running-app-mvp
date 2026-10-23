// Display caps for copy and explanation surfaces. They shape what the page shows and make no claim
// about the runner, so they are constants and not Params (phase 3a design, section 3). A threshold
// on the runner's data belongs in `shared/engine/params/`.

/** Sources listed under one figure before "and {n} more". */
export const EXPLAIN_MAX_SOURCES = 5

/** Rule ids one Explain request may carry. */
export const EXPLAIN_MAX_RULES = 12

/** Days of check-ins the readiness explanation counts. */
export const EXPLAIN_CHECKIN_DAYS = 7

/** Sentences on the "What stood out" card of a run. */
export const STANDOUT_MAX_CARDS = 3

/** Facts the weekly brief names under "What the plan noticed". */
export const BRIEF_MAX_NOTICED = 4

/** Days ahead the brief looks for the next key session. */
export const KEY_LOOKAHEAD_DAYS = 7

/** Lines of a revision's diff shown before "Show all {n} changes". */
export const DIFF_LINES_SHOWN = 5

/** The longest rendered template: one sentence a reader takes in at a glance. */
export const COPY_MAX_CHARS = 160

/** Readiness signals Today names under the verdict, noted ones first. */
export const SIGNAL_LIMIT = 3
