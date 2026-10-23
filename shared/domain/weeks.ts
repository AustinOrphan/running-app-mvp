import type { Activity, WeekRow } from '../types.ts'
import { addDays, mondayOf } from '../dates.ts'

/**
 * How many weeks `streak3Plus` counts at most, and how far before the first requested week the
 * activities that feed a range are loaded. No screen reads a longer streak, so a longer history is
 * neither loaded nor counted.
 */
export const STREAK_LOOKBACK_WEEKS = 52

/** The five columns of an activity that the week rows read. */
export type WeekCore = Pick<
  Activity,
  'date' | 'type' | 'durationSec' | 'distanceM' | 'duplicateStatus'
>

/**
 * The first date of the activities that a range of weeks needs, given its first Monday. The row of
 * that week reads back 3 weeks for `avg4wRunMin` and `STREAK_LOOKBACK_WEEKS - 1` for the streak, so
 * a start a whole `STREAK_LOOKBACK_WEEKS` earlier covers both.
 */
export function activityLoadStart(firstWeek: string): string {
  return addDays(firstWeek, -7 * STREAK_LOOKBACK_WEEKS)
}

interface WeekTotals {
  runSec: number
  runM: number
  runSessions: number
  runDates: Set<string>
  strengthSessions: number
  crossSec: number
  raceSec: number
  longestRunSec: number
}

function emptyTotals(): WeekTotals {
  return {
    runSec: 0,
    runM: 0,
    runSessions: 0,
    runDates: new Set(),
    strengthSessions: 0,
    crossSec: 0,
    raceSec: 0,
    longestRunSec: 0,
  }
}

const toMinutes = (sec: number) => Math.round(sec / 60)

/**
 * Builds one WeekRow per entry of `weekStarts`, in the same order.
 *
 * Pass every activity from `activityLoadStart(first week)` to the last requested week, not only
 * the requested range: `avg4wRunMin` and `streak3Plus` look back before the first row.
 * `streak3Plus` counts at most `STREAK_LOOKBACK_WEEKS` weeks.
 * Activities flagged as `possible` or `confirmed` duplicates are excluded.
 * Throws RangeError for a malformed date or a week start that is not a Monday.
 */
export function aggregateWeeks(activities: WeekCore[], weekStarts: string[]): WeekRow[] {
  const buckets = new Map<string, WeekTotals>()
  let earliestWeek: string | null = null

  for (const activity of activities) {
    if (activity.duplicateStatus === 'possible' || activity.duplicateStatus === 'confirmed')
      continue
    const week = mondayOf(activity.date)
    if (earliestWeek === null || week < earliestWeek) earliestWeek = week
    let totals = buckets.get(week)
    if (!totals) {
      totals = emptyTotals()
      buckets.set(week, totals)
    }
    switch (activity.type) {
      case 'run':
        totals.runSec += activity.durationSec
        totals.runM += activity.distanceM ?? 0
        totals.runSessions += 1
        totals.runDates.add(activity.date)
        totals.longestRunSec = Math.max(totals.longestRunSec, activity.durationSec)
        break
      case 'race':
        totals.raceSec += activity.durationSec
        break
      case 'strength':
        totals.strengthSessions += 1
        break
      case 'cross':
        totals.crossSec += activity.durationSec
        break
    }
  }

  const runMinOf = (week: string) => toMinutes(buckets.get(week)?.runSec ?? 0)
  const sessionsOf = (week: string) => buckets.get(week)?.runSessions ?? 0

  return weekStarts.map((weekStart) => {
    if (mondayOf(weekStart) !== weekStart) {
      throw new RangeError(`weekStart is not a Monday: ${JSON.stringify(weekStart)}`)
    }
    const totals = buckets.get(weekStart) ?? emptyTotals()
    const runMin = toMinutes(totals.runSec)
    const longestRunMin = toMinutes(totals.longestRunSec)

    let sum4w = 0
    for (let back = 0; back < 4; back += 1) sum4w += runMinOf(addDays(weekStart, -7 * back))

    let streak3Plus = 0
    if (earliestWeek !== null) {
      for (
        let week = weekStart;
        week >= earliestWeek && streak3Plus < STREAK_LOOKBACK_WEEKS && sessionsOf(week) >= 3;
        week = addDays(week, -7)
      ) {
        streak3Plus += 1
      }
    }

    return {
      weekStart,
      runMin,
      runM: totals.runM,
      runSessions: totals.runSessions,
      runDays: totals.runDates.size,
      strengthSessions: totals.strengthSessions,
      crossMin: toMinutes(totals.crossSec),
      raceMin: toMinutes(totals.raceSec),
      longestRunMin,
      longRunShare: runMin > 0 ? longestRunMin / runMin : null,
      avg4wRunMin: Math.round(sum4w / 4),
      streak3Plus,
    }
  })
}
