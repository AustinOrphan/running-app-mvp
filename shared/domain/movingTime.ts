// Elapsed time and moving time of an activity. `durationSec` is the elapsed time for every source
// (intervals.icu `elapsed_time`, Strava `elapsed_time`, the total elapsed time of a FIT file), and
// `movingSec` is the moving time where the source gives one. Duration is the elapsed
// time everywhere (the plan credits elapsed minutes); the pace leads with the moving figure when the
// two times differ, and the elapsed pace is the second figure.
import type { Activity } from '../types.ts'

/** A moving time this many seconds from the elapsed time is a different time, not rounding. */
const MOVING_DIFFERS_SEC = 1

/**
 * Whether the activity has a moving time that stands apart from its elapsed time. The detail page
 * leads with the moving pace when it does, with the elapsed pace second and each named; the list
 * shows the moving pace and names it.
 */
export function movingTimeDiffers(activity: Pick<Activity, 'durationSec' | 'movingSec'>): boolean {
  return (
    activity.movingSec !== null &&
    Math.abs(activity.movingSec - activity.durationSec) >= MOVING_DIFFERS_SEC
  )
}
