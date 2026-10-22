import { daysLeftInWeek, mondayOf } from '../dates.ts'

export interface RemainingPlanInput {
  today: string
  weekStart: string
  targetRunMin: number
  runMinSoFar: number
}

export interface RemainingPlan {
  remainingMin: number
  remainingDays: number
  perDayMin: number | null
}

/**
 * Advisory split of the minutes still open this week over the days left.
 * Remaining days run through Sunday and include today, whether or not today
 * already has a run. A date outside the week gives no per-day advice.
 * Throws RangeError for a malformed date or a `weekStart` that is not a Monday.
 */
export function remainingPlan(input: RemainingPlanInput): RemainingPlan {
  const remainingMin = Math.max(0, input.targetRunMin - input.runMinSoFar)
  if (mondayOf(input.weekStart) !== input.weekStart) {
    throw new RangeError(`weekStart is not a Monday: ${JSON.stringify(input.weekStart)}`)
  }
  const inWeek = mondayOf(input.today) === input.weekStart
  if (!inWeek) return { remainingMin, remainingDays: 0, perDayMin: null }
  const remainingDays = daysLeftInWeek(input.today)
  return { remainingMin, remainingDays, perDayMin: Math.round(remainingMin / remainingDays) }
}
