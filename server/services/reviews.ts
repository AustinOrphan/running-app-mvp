import type { PrismaClient } from '../db.ts'
import { addDays, mondayOf } from '../../shared/dates.ts'
import { aggregateWeeks } from '../../shared/domain/weeks.ts'
import { suggestAction, type Suggestion } from '../../shared/domain/review.ts'
import type { PlanWeek, WeekRow, WeeklyReview } from '../../shared/types.ts'
import { validationError } from '../errors.ts'
import { loadActivities, toPlanWeek, toWeeklyReview } from '../serialize.ts'

/** `undefined` keeps the stored value, `null` clears it. */
export type ReviewPatch = Partial<
  Pick<
    WeeklyReview,
    | 'dataStatus'
    | 'fatigue'
    | 'symptoms'
    | 'recoveryConstrained'
    | 'finalDecision'
    | 'finalNextMin'
    | 'notes'
  >
>

type ReviewFields = Pick<
  WeeklyReview,
  | 'dataStatus'
  | 'fatigue'
  | 'symptoms'
  | 'recoveryConstrained'
  | 'finalDecision'
  | 'finalNextMin'
  | 'notes'
>

/** A week is finished once its Sunday is before `today`. */
const isFinished = (weekStart: string, today: string): boolean => addDays(weekStart, 6) < today

interface WeekContext {
  planWeek: PlanWeek | null
  nextPlanWeek: PlanWeek | null
  row: WeekRow
  hasPossibleDuplicates: boolean
}

/** Everything `suggestAction` needs for each week, loaded in a fixed number of queries. */
async function loadContexts(
  prisma: PrismaClient,
  userId: string,
  weekStarts: string[],
): Promise<Map<string, WeekContext>> {
  const contexts = new Map<string, WeekContext>()
  const last = weekStarts[weekStarts.length - 1]
  if (last === undefined) return contexts

  const plan = await prisma.plan.findFirst({
    where: { userId, status: 'active' },
    include: { weeks: true },
  })
  const planWeeks = new Map<string, PlanWeek>()
  for (const week of plan?.weeks ?? []) planWeeks.set(week.weekStart, toPlanWeek(week))

  // Totals look back four weeks before the first row, so load everything up to the last week.
  const activities = await loadActivities(prisma, userId, { to: addDays(last, 6) })
  const rows = aggregateWeeks(activities, weekStarts)
  const flagged = new Set<string>()
  for (const activity of activities) {
    if (activity.duplicateStatus === 'possible') flagged.add(mondayOf(activity.date))
  }

  for (const row of rows) {
    contexts.set(row.weekStart, {
      planWeek: planWeeks.get(row.weekStart) ?? null,
      nextPlanWeek: planWeeks.get(addDays(row.weekStart, 7)) ?? null,
      row,
      hasPossibleDuplicates: flagged.has(row.weekStart),
    })
  }
  return contexts
}

function suggestFor(
  context: WeekContext,
  review: ReviewFields | null,
  weekStart: string,
  today: string,
): Suggestion | null {
  const { planWeek, nextPlanWeek } = context
  if (!planWeek) return null
  return suggestAction({
    today,
    weekStart,
    phase: planWeek.phase,
    targetRunMin: planWeek.targetRunMin,
    baselineRunMin: planWeek.baselineRunMin,
    plannedRunDays: planWeek.runDays,
    nextBaselineMin: nextPlanWeek ? nextPlanWeek.baselineRunMin : null,
    week: context.row,
    review,
    hasPossibleDuplicates: context.hasPossibleDuplicates,
  })
}

function synthetic(userId: string, weekStart: string, now: string): WeeklyReview {
  return {
    id: '',
    userId,
    weekStart,
    dataStatus: 'unconfirmed',
    fatigue: null,
    symptoms: null,
    recoveryConstrained: false,
    suggestedAction: null,
    suggestedReason: null,
    suggestedNextMin: null,
    finalDecision: null,
    finalNextMin: null,
    notes: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * One review per week, in order. A week without a stored row comes back synthetic. Until a week is
 * reviewed its suggestion follows the current data; after `reviewedAt` the stored snapshot wins.
 */
export async function listReviews(
  prisma: PrismaClient,
  userId: string,
  weekStarts: string[],
  today: string,
): Promise<WeeklyReview[]> {
  if (weekStarts.length === 0) return []
  const stored = await prisma.weeklyReview.findMany({
    where: { userId, weekStart: { in: weekStarts } },
  })
  const byWeek = new Map(stored.map((row) => [row.weekStart, toWeeklyReview(row)]))
  const contexts = await loadContexts(prisma, userId, weekStarts)
  const now = new Date().toISOString()

  return weekStarts.map((weekStart) => {
    const review = byWeek.get(weekStart) ?? synthetic(userId, weekStart, now)
    if (review.reviewedAt !== null) return review
    const context = contexts.get(weekStart)
    const suggestion = context ? suggestFor(context, review, weekStart, today) : null
    return {
      ...review,
      suggestedAction: suggestion?.action ?? null,
      suggestedReason: suggestion?.reason ?? null,
      suggestedNextMin: suggestion?.suggestedNextMin ?? null,
    }
  })
}

/**
 * Applies `patch`, stores the recomputed suggestion and, when the week qualifies as reviewed,
 * writes the decided minutes to the next plan week. All writes happen in one transaction.
 */
export async function saveReview(
  prisma: PrismaClient,
  userId: string,
  weekStart: string,
  patch: ReviewPatch,
  today: string,
): Promise<WeeklyReview> {
  const existing = await prisma.weeklyReview.findUnique({
    where: { userId_weekStart: { userId, weekStart } },
  })
  const current = existing ? toWeeklyReview(existing) : null
  const pick = <K extends keyof ReviewFields>(
    key: K,
    fallback: ReviewFields[K],
  ): ReviewFields[K] =>
    patch[key] === undefined ? (current ? current[key] : fallback) : patch[key]

  const fields: ReviewFields = {
    dataStatus: pick('dataStatus', 'unconfirmed'),
    fatigue: pick('fatigue', null),
    symptoms: pick('symptoms', null),
    recoveryConstrained: pick('recoveryConstrained', false),
    finalDecision: pick('finalDecision', null),
    finalNextMin: pick('finalNextMin', null),
    notes: pick('notes', null),
  }

  const finished = isFinished(weekStart, today)
  if (!finished && (patch.finalDecision != null || patch.finalNextMin != null)) {
    throw validationError('A decision can be recorded once the week has finished.', [
      {
        path: patch.finalDecision != null ? 'finalDecision' : 'finalNextMin',
        message: 'Week not finished.',
      },
    ])
  }

  const contexts = await loadContexts(prisma, userId, [weekStart])
  const context = contexts.get(weekStart)
  const suggestion = context ? suggestFor(context, fields, weekStart, today) : null

  const qualifies = fields.dataStatus === 'complete' && fields.finalDecision !== null && finished
  const reviewedAt = qualifies ? (existing?.reviewedAt ?? new Date()) : null
  const data = {
    ...fields,
    suggestedAction: suggestion?.action ?? null,
    suggestedReason: suggestion?.reason ?? null,
    suggestedNextMin: suggestion?.suggestedNextMin ?? null,
    reviewedAt,
  }

  const next = context?.nextPlanWeek ?? null
  const saved = await prisma.$transaction(async (tx) => {
    const row = await tx.weeklyReview.upsert({
      where: { userId_weekStart: { userId, weekStart } },
      create: { userId, weekStart, ...data },
      update: data,
    })
    if (next) {
      if (qualifies && fields.finalNextMin !== null) {
        if (next.targetSource !== 'override') {
          await tx.planWeek.update({
            where: { id: next.id },
            data: { targetRunMin: fields.finalNextMin, targetSource: 'review' },
          })
        }
      } else if (next.targetSource === 'review') {
        await tx.planWeek.update({
          where: { id: next.id },
          data: { targetRunMin: next.baselineRunMin, targetSource: 'baseline' },
        })
      }
    }
    return row
  })
  return toWeeklyReview(saved)
}
