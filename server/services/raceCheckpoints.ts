// The runner's course points for the goal race (rule H14, ADR 0018; design 2026-11-07, step 4).
// The table is private: the names and distances are the runner's own. It is replaced as a whole
// (`saveRaceCheckpoints`, one transaction), so a row has no identity outside the table and the
// client sends no row id. The write goes through the data-versioned client and raises no version
// itself: `RaceCheckpoint` is a state model, so the memoised race plan drops with the save.
//
// Nothing here logs a value. A rejected row is named by its index and its field, never by what it
// held (`server/routes/race.ts` carries the schema; the checks that need the goal are here).
import type { RaceCheckpointRow, RaceCheckpointsView, ValidationIssue } from '../../shared/types.ts'
import type { PrismaClient } from '../db.ts'
import { conflict, validationError } from '../errors.ts'
import { currentGoalFor } from './currentGoal.ts'

/** The rows of one goal in distance order. The race plan's memo and the route read them here. */
export async function listRaceCheckpoints(
  db: Pick<PrismaClient, 'raceCheckpoint'>,
  args: { userId: string; goalId: string },
): Promise<RaceCheckpointRow[]> {
  const rows = await db.raceCheckpoint.findMany({
    where: { userId: args.userId, goalId: args.goalId },
    orderBy: { distanceM: 'asc' },
  })
  return rows.map((row) => ({
    name: row.name,
    distanceM: row.distanceM,
    gainM: row.gainM,
    lossM: row.lossM,
    cutoffSec: row.cutoffSec,
  }))
}

/** The rows of the runner's current goal, or none when there is no goal. */
export async function raceCheckpointsView(
  db: Pick<PrismaClient, 'plan' | 'goal' | 'raceCheckpoint'>,
  userId: string,
): Promise<RaceCheckpointsView> {
  const goal = await currentGoalFor(db, userId)
  if (goal === null) return { goalId: null, distanceM: null, checkpoints: [] }
  return {
    goalId: goal.id,
    distanceM: goal.distanceM,
    checkpoints: await listRaceCheckpoints(db, { userId, goalId: goal.id }),
  }
}

/** Fixed messages: a message never carries a name, a distance or any other value of a row. */
const MESSAGES = {
  noGoal: 'Add a goal race before adding checkpoints.',
  noDistance: 'The goal needs a distance before it can have checkpoints.',
  pastFinish: 'A checkpoint sits before the finish.',
} as const

/**
 * Replaces the current goal's table with `rows` (already shape-checked by the route's schema:
 * lengths, ranges, strictly increasing distances). The goal is read here because a row must lie
 * below the course distance, which only the goal knows. Returns the saved view.
 */
export async function saveRaceCheckpoints(
  prisma: PrismaClient,
  userId: string,
  rows: readonly RaceCheckpointRow[],
): Promise<RaceCheckpointsView> {
  const goal = await currentGoalFor(prisma, userId)
  if (goal === null) throw conflict(MESSAGES.noGoal)
  if (goal.distanceM === null) throw conflict(MESSAGES.noDistance)
  const distanceM = goal.distanceM

  const issues: ValidationIssue[] = []
  rows.forEach((row, index) => {
    if (row.distanceM >= distanceM) {
      issues.push({ path: `checkpoints.${String(index)}.distanceM`, message: MESSAGES.pastFinish })
    }
  })
  if (issues.length > 0) throw validationError('Some fields need attention.', issues)

  const goalId = goal.id
  await prisma.$transaction(async (tx) => {
    await tx.raceCheckpoint.deleteMany({ where: { userId, goalId } })
    if (rows.length > 0) {
      await tx.raceCheckpoint.createMany({
        data: rows.map((row) => ({
          userId,
          goalId,
          name: row.name,
          distanceM: row.distanceM,
          gainM: row.gainM,
          lossM: row.lossM,
          cutoffSec: row.cutoffSec,
        })),
      })
    }
  })
  return { goalId, distanceM, checkpoints: await listRaceCheckpoints(prisma, { userId, goalId }) }
}
