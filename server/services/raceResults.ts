// Race results (phase 3a design 11.4): the runner records how a goal race went, optionally linked to
// the activity that ran it. Saving or removing a result re-scores or un-scores the goal's weekly
// predictions without touching the log's rows, and linking an activity marks it as a race so later
// predictions can use it as an anchor. `RaceResult` is state (it retypes an activity and will feed
// the engine), so a write here raises the data version through the client, never by hand.
import { daysBetween } from '../../shared/dates.ts'
import {
  daysBefore,
  isComparableCourse,
  scorePredictions,
  type RaceOutcome,
  type RaceResultInput,
} from '../../shared/engine/backtest.ts'
import { RESULT_ACTIVITY_WINDOW_DAYS } from '../../shared/limits.ts'
import type { RaceResultView, ValidationIssue } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { Goal, PrismaClient } from '../db.ts'
import { conflict, notFound, validationError } from '../errors.ts'
import { toLoggedPrediction, toRaceResultInput, toRaceResultView } from '../serialize.ts'
import { markActivityAsRace } from './activityStore.ts'
import { runExecutionQuietly } from './execution.ts'
import { newestPerWeek } from './predictionLog.ts'

type ResultDb = Pick<PrismaClient, 'activity' | 'predictionLog' | 'raceResult'>

/** A validated `PUT /api/goals/:id/result` body; the whole result is replaced by it. */
export interface RaceResultBody {
  outcome: RaceOutcome
  /** Official finish time. Required for a finished race; a did-not-finish stores none. */
  timeSec: number | null
  /** Race day, `YYYY-MM-DD`, not after today. */
  date: string
  /** The raced distance; when absent the linked activity's, then the goal's, is used. */
  distanceM: number | null
  gainM: number | null
  activityId: string | null
  note: string | null
}

/**
 * Clears the goal's `actualSec`, then sets the finish time on every row logged before race day for
 * a comparable course. All of the goal's rows take part, not only the newest of each week: the
 * log keeps them and collapses on read. A did-not-finish, a result without a time and a removed
 * result leave the column empty. Rows are only updated, never created or deleted.
 */
export async function syncActuals(
  db: Pick<PrismaClient, 'predictionLog'>,
  args: { userId: string; goalId: string; result: RaceResultInput | null },
): Promise<void> {
  const { userId, goalId, result } = args
  await db.predictionLog.updateMany({
    where: { userId, goalId, actualSec: { not: null } },
    data: { actualSec: null },
  })
  if (result === null || result.outcome !== 'finished' || result.timeSec === null) return
  const raced = { distanceM: result.distanceM, gainM: result.gainM }
  const rows = await db.predictionLog.findMany({ where: { userId, goalId } })
  const ids = rows
    .filter(
      (row) =>
        daysBefore(result.date, row.loggedOn) >= 1 &&
        isComparableCourse(toLoggedPrediction(row).course, raced),
    )
    .map((row) => row.id)
  if (ids.length === 0) return
  await db.predictionLog.updateMany({
    where: { id: { in: ids } },
    data: { actualSec: result.timeSec },
  })
}

/** How many weekly predictions (the newest row of each week) a result is compared with. */
async function countScored(
  db: Pick<PrismaClient, 'predictionLog'>,
  args: { userId: string; goalId: string; result: RaceResultInput },
): Promise<number> {
  const { userId, goalId, result } = args
  const rows = await db.predictionLog.findMany({ where: { userId, goalId } })
  return scorePredictions(newestPerWeek(rows).map(toLoggedPrediction), result).length
}

/** The first distance in the order the body, the linked activity, the goal, or null. */
function distanceFor(
  body: RaceResultBody,
  activity: { distanceM: number | null } | null,
  goal: Pick<Goal, 'distanceM'>,
): number | null {
  for (const candidate of [body.distanceM, activity?.distanceM, goal.distanceM]) {
    if (typeof candidate === 'number' && candidate > 0) return candidate
  }
  return null
}

/**
 * Records or replaces the result of a goal and returns it with the weeks it was compared with.
 *
 * One transaction: the upsert, the retype of the linked run to a race, and `syncActuals`. Then, with
 * the result committed, the linked activity is matched and assessed again (`runExecutionQuietly`),
 * because linking may have changed its type. Errors: 404 for an activity that is not the runner's; 400 with paths
 * for an activity that is not a run or a race within `RESULT_ACTIVITY_WINDOW_DAYS` of the date, or
 * for a result with no distance anywhere; 409 for an activity that is another goal's result.
 */
export async function saveRaceResult(
  deps: Deps,
  args: { userId: string; goal: Goal; body: RaceResultBody },
): Promise<{ result: RaceResultView; created: boolean }> {
  const { prisma } = deps
  const { userId, goal, body } = args

  const activity =
    body.activityId === null
      ? null
      : await prisma.activity.findFirst({ where: { id: body.activityId, userId } })
  if (body.activityId !== null && activity === null) throw notFound('Activity not found.')

  const issues: ValidationIssue[] = []
  if (activity !== null) {
    if (activity.type !== 'run' && activity.type !== 'race') {
      issues.push({ path: 'activityId', message: 'Choose a run or a race.' })
    } else if (Math.abs(daysBetween(activity.date, body.date)) > RESULT_ACTIVITY_WINDOW_DAYS) {
      issues.push({
        path: 'activityId',
        message: `Choose an activity within ${String(RESULT_ACTIVITY_WINDOW_DAYS)} days of the race date.`,
      })
    }
  }
  const distanceM = distanceFor(body, activity, goal)
  if (distanceM === null) {
    issues.push({ path: 'distanceM', message: 'Enter the distance that was raced.' })
  }
  if (issues.length > 0 || distanceM === null) {
    throw validationError('Some fields need attention.', issues)
  }

  const saved = await prisma.$transaction(async (tx: ResultDb) => {
    if (body.activityId !== null) {
      const taken = await tx.raceResult.findFirst({
        where: { activityId: body.activityId, goalId: { not: goal.id } },
        select: { id: true },
      })
      if (taken !== null) {
        throw conflict('That activity is already linked to the result of another race.')
      }
    }
    const existing = await tx.raceResult.findUnique({
      where: { goalId: goal.id },
      select: { id: true },
    })
    const data = {
      date: body.date,
      distanceM,
      gainM: body.gainM,
      outcome: body.outcome,
      timeSec: body.outcome === 'finished' ? body.timeSec : null,
      note: body.note,
      activityId: body.activityId,
    }
    const row = await tx.raceResult.upsert({
      where: { goalId: goal.id },
      create: { userId, goalId: goal.id, ...data },
      update: data,
    })
    const retyped =
      body.activityId === null ? false : await markActivityAsRace(tx, userId, body.activityId)
    const input = toRaceResultInput(row)
    await syncActuals(tx, { userId, goalId: goal.id, result: input })
    const scoredPredictions = await countScored(tx, { userId, goalId: goal.id, result: input })
    return { row, created: existing === null, retyped, scoredPredictions }
  })

  if (body.activityId !== null) {
    await runExecutionQuietly(deps, { userId, activityId: body.activityId })
  }
  return {
    result: toRaceResultView(saved.row, {
      scoredPredictions: saved.scoredPredictions,
      activityMarkedAsRace: saved.retyped,
    }),
    created: saved.created,
  }
}

/**
 * Removes the result of a goal and clears every `actualSec` of the goal; the log's rows stay. The
 * linked activity keeps its type (the runner may edit it): it was marked a race by the runner's own
 * choice. 404 when the goal has no result.
 */
export async function deleteRaceResult(
  deps: Deps,
  args: { userId: string; goalId: string },
): Promise<void> {
  const { userId, goalId } = args
  await deps.prisma.$transaction(async (tx: ResultDb) => {
    const { count } = await tx.raceResult.deleteMany({ where: { goalId, userId } })
    if (count === 0) throw notFound('No result is recorded for this goal.')
    await syncActuals(tx, { userId, goalId, result: null })
  })
}
