// The weekly prediction log (phase 3a design 11.3 and 11.7). One row per goal and local week, the
// newest of the week, so the back-test can set each week's prediction against the race result.
//
// `recordPrediction` is the only writer of `PredictionLog`: a plan write calls it with mode
// `refresh` inside its transaction, and `ensureWeeklyPrediction` (the scheduler's job) calls it with
// mode `ensure`, so a week with no plan write still gets its row. `PredictionLog` is non-state
// (`server/dataVersion.ts`): nothing cached reads it, and a write here never bumps the data version.
import { mondayOf } from '../../shared/dates.ts'
import type { EngineInput, PlanDraft } from '../../shared/engine/types.ts'
import { predictRace } from '../../shared/engine/index.ts'
import { PARAMS_VERSION } from '../../shared/engine/params/index.ts'
import type { Deps } from '../app.ts'
import type { PrismaClient } from '../db.ts'
import { currentGoalFor } from './currentGoal.ts'
import { gatherEngineInput } from './engineInput.ts'

/**
 * `refresh` updates the week's newest row or creates one (a plan write, which has a new
 * prediction); `ensure` creates a row only when the week has none and never changes an existing one.
 */
export type PredictionMode = 'refresh' | 'ensure'

/** `skipped`: nothing is logged for this goal today (see `recordPrediction`). */
export type RecordOutcome = 'created' | 'updated' | 'kept' | 'skipped'

/** The part of a goal that decides whether and how a prediction is logged. */
export interface PredictionGoal {
  id: string
  targetDate: string
  distanceM: number | null
  gainM: number | null
  surface: string
}

type LogDb = Pick<PrismaClient, 'predictionLog' | 'raceResult'>

/** The course a prediction was made for, stored in `inputs.course` (design 11.3). */
export interface StoredCourse {
  distanceM: number
  gainM: number | null
  surface: string
  /** Race-day wet-bulb globe temperature, when the engine had a climate for the race. */
  wbgtC: number | null
}

/** Whether the goal takes a prediction today: a distance, race day not yet come, no result. */
async function takesPredictions(
  db: LogDb,
  goal: PredictionGoal,
  userId: string,
  today: string,
): Promise<boolean> {
  if (goal.distanceM === null) return false
  if (today >= goal.targetDate) return false
  return (await db.raceResult.count({ where: { userId, goalId: goal.id } })) === 0
}

/** One goal's local week: what a week's single row is looked up by. */
interface WeekKey {
  userId: string
  goalId: string
  weekStart: string
}

/** The newest row of one local week, or null. Pre-migration weeks can hold several rows. */
function newestOfWeek(db: Pick<PrismaClient, 'predictionLog'>, where: WeekKey) {
  return db.predictionLog.findFirst({
    where,
    orderBy: [{ loggedOn: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
}

/**
 * Writes the prediction of `today`'s local week for the goal.
 *
 * Nothing is logged without a prediction, for a goal without a distance, on or after race day, or
 * once the goal has a result: a prediction made then would be scored against a race that has
 * already happened. In `refresh` mode the week's newest row takes the new values (and the day they
 * were made on); `ensure` leaves an existing row alone. Returns what happened.
 *
 * Inside a plan write, pass the transaction client so the row commits with the plan.
 */
export async function recordPrediction(
  db: LogDb,
  args: {
    userId: string
    goal: PredictionGoal
    /** The plan draft being written, or the prediction alone when the week has no plan write. */
    draft: Pick<PlanDraft, 'prediction' | 'paramsVersion'>
    /** The engine input the draft was made from; its goal model has the race-day WBGT. */
    input: Pick<EngineInput, 'goal'>
    today: string
    mode: PredictionMode
  },
): Promise<RecordOutcome> {
  const { userId, goal, today } = args
  const { prediction, paramsVersion } = args.draft
  if (prediction === null || goal.distanceM === null) return 'skipped'
  if (!(await takesPredictions(db, goal, userId, today))) return 'skipped'

  const key: WeekKey = { userId, goalId: goal.id, weekStart: mondayOf(today) }
  const existing = await newestOfWeek(db, key)
  if (existing !== null && args.mode === 'ensure') return 'kept'

  const course: StoredCourse = {
    distanceM: goal.distanceM,
    gainM: goal.gainM,
    surface: goal.surface,
    wbgtC: args.input.goal.raceWbgtC,
  }
  const data = {
    method: prediction.method,
    predictedSec: Math.round(prediction.predictedSec),
    lowSec: Math.round(prediction.lowSec),
    highSec: Math.round(prediction.highSec),
    loggedOn: today,
    inputs: JSON.stringify({
      today,
      conditions: prediction.conditions,
      rules: prediction.rules,
      paramsVersion,
      course,
    }),
  }
  if (existing !== null) {
    await db.predictionLog.update({ where: { id: existing.id }, data })
    return 'updated'
  }
  await db.predictionLog.create({ data: { ...key, ...data } })
  return 'created'
}

/**
 * The scheduler's catch-up for one user: logs this week's prediction for the current goal when the
 * week has no row (a week without a plan write, or a goal without a plan). The checks that need no
 * engine come first, so a week that already has its row does no engine work at all.
 */
export async function ensureWeeklyPrediction(
  deps: Deps,
  userId: string,
  today: string,
): Promise<RecordOutcome> {
  const { prisma } = deps
  const goal = await currentGoalFor(prisma, userId)
  if (goal === null || !(await takesPredictions(prisma, goal, userId, today))) return 'skipped'
  if (
    (await newestOfWeek(prisma, { userId, goalId: goal.id, weekStart: mondayOf(today) })) !== null
  ) {
    return 'kept'
  }
  const input = await gatherEngineInput(deps, { userId, goalId: goal.id, today })
  const draft = { prediction: predictRace(input), paramsVersion: PARAMS_VERSION }
  return recordPrediction(prisma, { userId, goal, draft, input, today, mode: 'ensure' })
}

/** What `newestPerWeek` reads from a row. */
interface WeekRow {
  id: string
  goalId: string
  weekStart: string
  loggedOn: string
  createdAt: Date
}

/** Newest first: the later day, then the later write, then the later id. */
function newestFirst(a: WeekRow, b: WeekRow): number {
  if (a.loggedOn !== b.loggedOn) return a.loggedOn < b.loggedOn ? 1 : -1
  const byWrite = b.createdAt.getTime() - a.createdAt.getTime()
  if (byWrite !== 0) return byWrite
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

/**
 * Collapses the log to one row per goal and local week, the newest of the week, newest week first.
 * Weeks logged before the weekly log existed hold several rows; they are kept in the database and
 * collapsed here, on every read (design 11.3, question 14).
 */
export function newestPerWeek<T extends WeekRow>(rows: readonly T[]): T[] {
  const best = new Map<string, T>()
  for (const row of rows) {
    const key = `${row.goalId}\n${row.weekStart}`
    const held = best.get(key)
    if (held === undefined || newestFirst(row, held) < 0) best.set(key, row)
  }
  return [...best.values()].sort(
    (a, b) =>
      (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0) || newestFirst(a, b),
  )
}
