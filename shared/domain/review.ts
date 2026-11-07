import { addDays } from '../dates.ts'
import { P } from '../engine/params/index.ts'
import type { Phase, SuggestedAction, Symptoms, WeekRow, WeeklyReview } from '../types.ts'

export interface SuggestInput {
  today: string
  weekStart: string
  phase: Phase
  targetRunMin: number
  baselineRunMin: number
  /** Run days the plan week asks for; a cutback week may plan fewer than 3. */
  plannedRunDays: number
  nextBaselineMin: number | null
  week: WeekRow
  review: Pick<WeeklyReview, 'dataStatus' | 'fatigue' | 'symptoms' | 'recoveryConstrained'> | null
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
  if (week.runMin * 100 < 70 * targetRunMin || week.runDays < Math.min(3, input.plannedRunDays))
    return { action: 'repeat' }
  if (review.fatigue === null || review.symptoms === null) {
    return { action: 'needs_recovery_review' }
  }
  // Below the line the review holds the target; the run-time meter calls the week "near" from it.
  const nearTargetPct = P.weeklyReview.nearTargetPct.value
  if (
    review.symptoms === 'mild' ||
    review.fatigue >= 6 ||
    week.runMin * 100 < nearTargetPct * targetRunMin
  ) {
    return { action: 'hold' }
  }
  return { action: 'progress' }
}

/**
 * Next week's minutes if `action` is taken, from the same rules the suggestion uses. Only the four
 * adjusting actions carry minutes; the rest, and a plan without a next week, give null.
 */
export function nextMinutesFor(action: SuggestedAction, input: SuggestInput): number | null {
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
    suggestedNextMin: nextMinutesFor(action, input),
  }
}

// ---------------------------------------------------------------------------------------------
// The weekly form, prefilled from the week's check-ins
// ---------------------------------------------------------------------------------------------

/** Why the symptoms suggestion is what it is; the page words it through `shared/copy/reviewPrefill.ts`. */
export type SymptomsBasis = 'none' | 'soreness' | 'pain' | 'illness' | 'bone'

/**
 * What the week's check-ins say about the two answers the runner otherwise types by hand. The
 * runner confirms or changes it; nothing here is stored or reaches the engine until the review is
 * saved with the answers.
 */
export interface ReviewPrefill {
  /** Days of the week with at least one check-in answer. */
  checkinDays: number
  /** The suggested fatigue on the form's 1 to 10 scale; null with too few fatigue answers. */
  fatigue: number | null
  /** The average of the check-in fatigue answers (1 to 5, 3 is normal), one decimal; null as above. */
  fatigueAverage: number | null
  /** How many days gave a fatigue answer. */
  fatigueDays: number
  symptoms: Symptoms | null
  symptomsBasis: SymptomsBasis | null
}

/** The check-in answers of one day, as `WellnessDay` rows carry them. */
export interface CheckinDay {
  date: string
  fatigue?: number | null
  soreness?: number | null
  sleepQuality?: number | null
  mood?: number | null
  stress?: number | null
  illness?: boolean
  painScore?: number | null
  painFocalBone?: boolean
}

/**
 * Defaults, not findings: a suggestion needs this many days of answers before it is offered, and
 * the cut-offs below say what counts as mild or persistent. The runner confirms every answer.
 */
export const PREFILL = {
  minDays: 2,
  /** Soreness on the 1 to 5 check-in scale at or above this is a mild symptom (3 is normal). */
  mildSoreness: 4,
  /** A pain score (0 to 10) of at least this is a mild symptom. */
  mildPain: 1,
  /** A pain score of at least this, or illness, on this many days is persistent. */
  persistentPain: 4,
  persistentDays: 3,
} as const

const answered = (day: CheckinDay): boolean =>
  day.illness === true ||
  [day.fatigue, day.soreness, day.sleepQuality, day.mood, day.stress, day.painScore].some(
    (value) => value !== null && value !== undefined,
  )

/**
 * Suggests the fatigue (1 to 10) and the symptoms for the week starting `weekStart` from its
 * check-in days. Fatigue maps the 1 to 5 answers onto the odd numbers 1 to 9, so a normal 3 reads
 * as 5, below the band where the review holds the week. Returns null when no day of the week has a
 * check-in.
 */
export function prefillFromCheckins(weekStart: string, days: CheckinDay[]): ReviewPrefill | null {
  const end = addDays(weekStart, 6)
  const week = days.filter((day) => day.date >= weekStart && day.date <= end && answered(day))
  if (week.length === 0) return null

  const fatigueAnswers = week
    .map((day) => day.fatigue)
    .filter((value): value is number => value !== null && value !== undefined)
  const average =
    fatigueAnswers.length >= PREFILL.minDays
      ? fatigueAnswers.reduce((sum, value) => sum + value, 0) / fatigueAnswers.length
      : null

  let symptoms: Symptoms | null = null
  let basis: SymptomsBasis | null = null
  if (week.length >= PREFILL.minDays) {
    const hard = week.filter(
      (day) => day.illness === true || (day.painScore ?? 0) >= PREFILL.persistentPain,
    ).length
    const ill = week.some((day) => day.illness === true)
    if (week.some((day) => day.painFocalBone === true)) {
      symptoms = 'persistent'
      basis = 'bone'
    } else if (hard >= PREFILL.persistentDays) {
      symptoms = 'persistent'
      basis = ill ? 'illness' : 'pain'
    } else if (ill) {
      symptoms = 'mild'
      basis = 'illness'
    } else if (week.some((day) => (day.painScore ?? 0) >= PREFILL.mildPain)) {
      symptoms = 'mild'
      basis = 'pain'
    } else if (week.some((day) => (day.soreness ?? 0) >= PREFILL.mildSoreness)) {
      symptoms = 'mild'
      basis = 'soreness'
    } else {
      symptoms = 'none'
      basis = 'none'
    }
  }

  return {
    checkinDays: week.length,
    fatigue: average === null ? null : Math.min(10, Math.max(1, Math.round(2 * average - 1))),
    fatigueAverage: average === null ? null : Math.round(average * 10) / 10,
    fatigueDays: fatigueAnswers.length,
    symptoms,
    symptomsBasis: basis,
  }
}
