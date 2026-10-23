import { addDays, mondayOf, weekStartsBetween } from '../../shared/dates.ts'
import { aggregateWeeks } from '../../shared/domain/weeks.ts'
import type { PrismaClient } from '../db.ts'
import { loadActivityCores } from '../serialize.ts'

const LOOKBACK_WEEKS = 26
const SAMPLE_WEEKS = 4

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] as number
  return Math.round(((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
}

/**
 * Weekly run minutes the plan starts from: the median of the most recent (up to) four completed
 * weeks that contain a run, looking back at most 26 weeks. Weeks without a run are skipped, the
 * current partial week is ignored and `dataStatus` plays no part. Null when no such week exists.
 */
export async function computeBaselineRunMin(
  prisma: PrismaClient,
  userId: string,
  today: string,
): Promise<number | null> {
  const lastWeek = addDays(mondayOf(today), -7)
  const firstWeek = addDays(mondayOf(today), -7 * LOOKBACK_WEEKS)
  // Only `runMin` is read, so the window starts at the first week with no 52-week lookback.
  const activities = await loadActivityCores(prisma, userId, {
    from: firstWeek,
    to: addDays(lastWeek, 6),
  })
  const rows = aggregateWeeks(activities, weekStartsBetween(firstWeek, lastWeek))
  const sample = rows
    .filter((row) => row.runSessions > 0)
    .slice(-SAMPLE_WEEKS)
    .map((row) => row.runMin)
  return sample.length === 0 ? null : median(sample)
}
