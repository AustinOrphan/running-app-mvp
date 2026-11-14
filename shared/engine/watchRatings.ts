// Ratings the watch gave (rule B1, amendment of 2026-11-14, owner decision D3): a watch rating
// fills an empty `Activity.rpe` and is shown at once, but the engine reads it only after the
// runner's watch ratings pass a spread check, because a prompt answered with the same tap every
// time says nothing about effort. Pure: the same activities give the same answer.
import { P } from './params/index.ts'
import type { Activity } from '../types.ts'
import { isDuplicate } from './load.ts'

/** What the spread check saw: the figures behind the verdict. */
export interface WatchRatingCheck {
  /** Watch ratings stored on runs and races in the window, flagged duplicates left out. */
  count: number
  /** Different values among them. */
  distinct: number
  /** The share of the most common value, 0 with no rating. */
  modalShare: number
  /** True when the engine reads the watch ratings like in-app ratings. */
  usable: boolean
}

/** True for a rating the watch gave: only `rpeSource === 'watch'` counts, null and 'app' do not. */
export function isWatchRating(activity: Pick<Activity, 'rpe' | 'rpeSource'>): boolean {
  return activity.rpe !== null && activity.rpeSource === 'watch'
}

/**
 * The spread check [rule B1]: enough watch ratings, enough different values, and no one value
 * taking more than the allowed share. All three numbers are defaults (grade D).
 */
export function checkWatchRatings(values: readonly number[]): WatchRatingCheck {
  const tally = new Map<number, number>()
  for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1)
  const count = values.length
  const top = Math.max(0, ...tally.values())
  const modalShare = count === 0 ? 0 : top / count
  const distinct = tally.size
  const usable =
    count >= P.b1.watchRpeMinCount.value &&
    distinct >= P.b1.watchRpeMinDistinct.value &&
    modalShare <= P.b1.watchRpeMaxModalShare.value
  return { count, distinct, modalShare, usable }
}

/** The spread check over the watch ratings of an activity list. */
export function watchRatingCheck(activities: readonly Activity[]): WatchRatingCheck {
  return checkWatchRatings(
    activities
      .filter((a) => (a.type === 'run' || a.type === 'race') && !isDuplicate(a) && isWatchRating(a))
      .map((a) => a.rpe as number),
  )
}

/**
 * The activities as the engine reads them: a watch rating is read as empty until the check
 * passes, an in-app rating (or one of unknown source) always as stored. Returns the same array
 * when nothing changes. The one place a reader of `Activity.rpe` is gated; the load, the
 * adaptation, the execution and standout reads and the heat read all take their input from here.
 */
export function withUsableRatings(activities: readonly Activity[]): {
  activities: Activity[]
  check: WatchRatingCheck
} {
  const check = watchRatingCheck(activities)
  if (check.usable || !activities.some(isWatchRating)) {
    return { activities: activities as Activity[], check }
  }
  return {
    activities: activities.map((a) => (isWatchRating(a) ? { ...a, rpe: null } : a)),
    check,
  }
}

/** One activity as the engine reads it, given the verdict of `watchRatingCheck` for the runner. */
export function readableActivity<T extends Pick<Activity, 'rpe' | 'rpeSource'>>(
  activity: T,
  check: Pick<WatchRatingCheck, 'usable'>,
): T {
  return !check.usable && isWatchRating(activity) ? { ...activity, rpe: null } : activity
}
