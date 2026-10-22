import { addDays } from '../dates.ts'
import type { Phase, SuggestedAction, WeekRow, WeeklyReview } from '../types.ts'

export interface SuggestInput {
  today: string
  weekStart: string
  phase: Phase
  targetRunMin: number
  baselineRunMin: number
  nextBaselineMin: number | null
  week: WeekRow
  review: Pick<
    WeeklyReview,
    'dataStatus' | 'fatigue' | 'symptoms' | 'recoveryConstrained'
  > | null
  hasPossibleDuplicates: boolean
}

export interface Suggestion {
  action: SuggestedAction
  reason: string
  suggestedNextMin: number | null
}

const REASONS: Record<SuggestedAction, string> = {
  upcoming: 'This week has not started.',
  in_progress: 'This week is in progress.',
  await_data: "Confirm that this week's data is complete before deciding.",
  review_duplicates: 'Resolve the possible duplicate runs before deciding.',
  reduce: 'Fatigue, symptoms or recovery point to a lighter next week.',
  repeat: 'Volume or run days fell short of the plan, so repeat the target.',
  needs_recovery_review: 'Record fatigue and symptoms to complete the review.',
  hold: 'Keep the target: volume, fatigue or symptoms are in the middle band.',
  progress: 'Volume, fatigue and symptoms support a small increase.',
}

const TAPER_REASON = 'Taper week: hold the plan as written.'

function chooseAction(input: SuggestInput): { action: SuggestedAction; reason?: string } {
  const { today, weekStart, week, review, targetRunMin } = input
  if (weekStart > today) return { action: 'upcoming' }
  if (today <= addDays(weekStart, 6)) return { action: 'in_progress' }
  if (review?.dataStatus !== 'complete') return { action: 'await_data' }
  if (input.hasPossibleDuplicates) return { action: 'review_duplicates' }
  if (
    (review.fatigue !== null && review.fatigue >= 8) ||
    review.symptoms === 'persistent' ||
    review.recoveryConstrained
  ) {
    return { action: 'reduce' }
  }
  if (input.phase === 'taper' || input.phase === 'race') {
    return { action: 'hold', reason: TAPER_REASON }
  }
  if (week.runMin * 100 < 70 * targetRunMin || week.runDays < 3) return { action: 'repeat' }
  if (review.fatigue === null || review.symptoms === null) {
    return { action: 'needs_recovery_review' }
  }
  if (
    review.symptoms === 'mild' ||
    review.fatigue >= 6 ||
    week.runMin * 100 < 85 * targetRunMin
  ) {
    return { action: 'hold' }
  }
  return { action: 'progress' }
}

function nextMinutes(action: SuggestedAction, input: SuggestInput): number | null {
  const { nextBaselineMin, targetRunMin, baselineRunMin } = input
  if (nextBaselineMin === null) return null
  switch (action) {
    case 'progress':
      return Math.round(Math.min(nextBaselineMin, 1.1 * targetRunMin))
    case 'hold':
      return Math.round(Math.min(nextBaselineMin, targetRunMin))
    case 'repeat':
      return Math.round(Math.min(nextBaselineMin, Math.max(targetRunMin, 0.5 * baselineRunMin)))
    case 'reduce':
      return Math.round(Math.min(nextBaselineMin, 0.7 * targetRunMin))
    default:
      return null
  }
}

export function suggestAction(input: SuggestInput): Suggestion {
  const { action, reason } = chooseAction(input)
  return {
    action,
    reason: reason ?? REASONS[action],
    suggestedNextMin: nextMinutes(action, input),
  }
}
