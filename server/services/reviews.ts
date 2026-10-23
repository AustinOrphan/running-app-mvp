import type { Deps } from '../app.ts'
import { addDays, mondayOf } from '../../shared/dates.ts'
import { toV1Phase } from '../../shared/domain/plan.ts'
import { activityLoadStart, aggregateWeeks } from '../../shared/domain/weeks.ts'
import { suggestAction, type Suggestion } from '../../shared/domain/review.ts'
import type { WeeklyDecision } from '../../shared/engine/types.ts'
import type {
  PlanWeek,
  ReviewSignals,
  ReviewView,
  SavedReview,
  WeekRow,
  WeeklyReview,
} from '../../shared/types.ts'
import { HttpError, validationError } from '../errors.ts'
import { createLogger } from '../logger.ts'
import { loadActivityCores, toPlanWeek, toWeeklyReview } from '../serialize.ts'
import { replanActivePlan, weeklyDecisions } from './planEngine.ts'

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
  deps: Deps,
  userId: string,
  weekStarts: string[],
): Promise<{ contexts: Map<string, WeekContext>; isV2: boolean }> {
  const { prisma } = deps
  const contexts = new Map<string, WeekContext>()
  const first = weekStarts[0]
  const last = weekStarts[weekStarts.length - 1]
  if (first === undefined || last === undefined) return { contexts, isV2: false }

  const plan = await prisma.plan.findFirst({
    where: { userId, status: 'active' },
    include: { weeks: true },
  })
  const planWeeks = new Map<string, PlanWeek>()
  for (const week of plan?.weeks ?? []) planWeeks.set(week.weekStart, toPlanWeek(week))

  // Totals look back before the first row (`activityLoadStart`), so load from there to the last week.
  const activities = await loadActivityCores(prisma, userId, {
    from: activityLoadStart(first),
    to: addDays(last, 6),
  })
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
  return { contexts, isV2: (plan?.generatorVersion ?? 1) >= 2 }
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
    phase: toV1Phase(planWeek.phase),
    targetRunMin: planWeek.targetRunMin,
    baselineRunMin: planWeek.baselineRunMin,
    plannedRunDays: planWeek.runDays,
    nextBaselineMin: nextPlanWeek ? nextPlanWeek.baselineRunMin : null,
    week: context.row,
    review,
    hasPossibleDuplicates: context.hasPossibleDuplicates,
  })
}

type V2Suggestion = Suggestion & { signals?: ReviewSignals }

const V2_REASONS: Record<WeeklyDecision['decision'], string> = {
  progress: 'Completion, effort and recovery support a small increase, inside every limit.',
  hold: 'Keep the target: the signals below call for a steady week.',
  reduce: 'The signals below point to a lighter next week.',
}

/**
 * The version-2 suggestion: the engine's weekly decision for a finished week. A week that has not
 * finished, one with possible duplicates and one the runner marked as missing data keep their
 * states from the version-1 rules, so the decision never rests on data that is still unsettled.
 */
function suggestV2(
  context: WeekContext,
  review: ReviewFields,
  weekStart: string,
  today: string,
  decision: WeeklyDecision | undefined,
): V2Suggestion | null {
  const { planWeek } = context
  if (!planWeek) return null
  const early = suggestFor(context, review, weekStart, today)
  if (early && (early.action === 'upcoming' || early.action === 'in_progress')) return early
  if (context.hasPossibleDuplicates) {
    return {
      action: 'review_duplicates',
      reason: 'Resolve the possible duplicate runs before deciding.',
      suggestedNextMin: null,
    }
  }
  if (review.dataStatus === 'missing') {
    return {
      action: 'await_data',
      reason: "Confirm that this week's data is complete before deciding.",
      suggestedNextMin: null,
    }
  }
  if (!decision) return null
  return {
    action: decision.decision,
    reason: V2_REASONS[decision.decision],
    suggestedNextMin: decision.nextWeekTargetMin,
    signals: decision.signals,
  }
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
  deps: Deps,
  userId: string,
  weekStarts: string[],
  today: string,
): Promise<ReviewView[]> {
  if (weekStarts.length === 0) return []
  const stored = await deps.prisma.weeklyReview.findMany({
    where: { userId, weekStart: { in: weekStarts } },
  })
  const byWeek = new Map(stored.map((row) => [row.weekStart, toWeeklyReview(row)]))
  const { contexts, isV2 } = await loadContexts(deps, userId, weekStarts)
  const now = new Date().toISOString()
  const open = weekStarts.filter(
    (weekStart) => isFinished(weekStart, today) && byWeek.get(weekStart)?.reviewedAt == null,
  )
  const decisions = isV2
    ? await weeklyDecisions(deps, { userId, today, weekStarts: open })
    : new Map<string, WeeklyDecision>()

  return weekStarts.map((weekStart): ReviewView => {
    const review = byWeek.get(weekStart) ?? synthetic(userId, weekStart, now)
    if (review.reviewedAt !== null) return review
    const context = contexts.get(weekStart)
    const v2 =
      context && isV2
        ? suggestV2(context, review, weekStart, today, decisions.get(weekStart))
        : null
    const suggestion: Suggestion | null = isV2
      ? v2
      : context
        ? suggestFor(context, review, weekStart, today)
        : null
    const view: ReviewView = {
      ...review,
      suggestedAction: suggestion?.action ?? null,
      suggestedReason: suggestion?.reason ?? null,
      suggestedNextMin: suggestion?.suggestedNextMin ?? null,
    }
    if (v2?.signals) view.signals = v2.signals
    return view
  })
}

/**
 * Applies `patch`, stores the recomputed suggestion and, when the week qualifies as reviewed,
 * writes the decided minutes to the next plan week. All writes happen in one transaction.
 */
export async function saveReview(
  deps: Deps,
  userId: string,
  weekStart: string,
  patch: ReviewPatch,
  today: string,
): Promise<SavedReview> {
  const { prisma } = deps
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

  const { contexts, isV2 } = await loadContexts(deps, userId, [weekStart])
  const context = contexts.get(weekStart)
  const decision = isV2
    ? (await weeklyDecisions(deps, { userId, today, weekStarts: finished ? [weekStart] : [] })).get(
        weekStart,
      )
    : undefined
  const v2 = context && isV2 ? suggestV2(context, fields, weekStart, today, decision) : null
  const suggestion: Suggestion | null = isV2
    ? v2
    : context
      ? suggestFor(context, fields, weekStart, today)
      : null

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
  const review = toWeeklyReview(saved)
  if (!isV2) return review

  // A decided review of a finished week re-plans from the updated state; the review stays saved
  // when the re-plan cannot run.
  const result: SavedReview = { ...review, revision: null }
  if (v2?.signals) result.signals = v2.signals
  if (qualifies) {
    try {
      result.revision = await replanActivePlan(deps, { userId, reason: 'review', today })
    } catch (error) {
      if (error instanceof HttpError) {
        result.replanError = error.message
      } else {
        createLogger(deps.config).warn({ err: error }, 're-planning after a review failed')
        result.replanError = 'The plan could not be re-planned. Try again from the Plan page.'
      }
    }
  }
  return result
}
