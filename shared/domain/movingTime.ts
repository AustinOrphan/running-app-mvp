// Elapsed time and moving time of an activity. `durationSec` is the elapsed time for every source
// (intervals.icu `elapsed_time`, Strava `elapsed_time`, the total elapsed time of a FIT file), and
// `movingSec` is the moving time where the source gives one. The pace the app leads with is the
// elapsed one; the moving pace is a second figure beside it, shown when the two times differ.
import type { Activity } from '../types.ts'

/** A moving time this many seconds from the elapsed time is a different time, not rounding. */
const MOVING_DIFFERS_SEC = 1

/**
 * Whether the activity has a moving time that stands apart from its elapsed time. The detail page
 * shows a second, moving, pace when it does, and says which pace is which; the list qualifies the
 * pace it shows as the elapsed one.
 */
export function movingTimeDiffers(activity: Pick<Activity, 'durationSec' | 'movingSec'>): boolean {
  return (
    activity.movingSec !== null &&
    Math.abs(activity.movingSec - activity.durationSec) >= MOVING_DIFFERS_SEC
  )
}
