// Which ask a run still needs on Today and under the hero (FP1). A rating from the watch
// (`rpeSource: 'watch'`, rule B1) fills `rpe` without the runner answering anything, so it does not
// close the ask for feel and pain: those two are the runner's own words, and J2, session-RPE load
// and C8 read them. Pure.
import type { Activity } from '../types.ts'

/**
 * `full`: effort, feel and pain are all open. `short`: the watch gave the effort, so only feel and
 * pain are asked. `null`: answered, nothing to ask.
 */
export type RatingAsk = 'full' | 'short' | null

type Answers = Pick<Activity, 'rpe' | 'rpeSource' | 'feel' | 'pain'>

/**
 * A run is answered when the runner rated it (an `rpe` whose source is not the watch, `null`
 * reading as the runner's) or gave a feel. A watch rating alone leaves it open as a `short` ask
 * until a feel or a pain is set. A run with no rating and no feel is a `full` ask; a pain alone
 * does not close that one, as before.
 */
export function ratingAsk(run: Answers): RatingAsk {
  if (run.feel !== null) return null
  // The watch is read from the source, not from `rpe`: the snapshot reads a watch rating as an
  // empty `rpe` until the spread check passes (`withUsableRatings`), and the source stays.
  if (run.rpeSource === 'watch') return run.pain === null ? 'short' : null
  return run.rpe === null ? 'full' : null
}
