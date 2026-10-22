import { addDays, daysLeftInWeek } from '../dates.ts'

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
 */
export function remainingPlan(input: RemainingPlanInput): RemainingPlan {
  const remainingMin = Math.max(0, input.targetRunMin - input.runMinSoFar)
  const weekEnd = addDays(input.weekStart, 6)
  const inWeek = input.today >= input.weekStart && input.today <= weekEnd
  if (!inWeek) return { remainingMin, remainingDays: 0, perDayMin: null }
  const remainingDays = daysLeftInWeek(input.today)
  return { remainingMin, remainingDays, perDayMin: Math.round(remainingMin / remainingDays) }
}
