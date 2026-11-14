import type { PrismaClient } from '../db.ts'
import { conflict, notFound } from '../errors.ts'
import { isInstallOwner } from '../installOwner.ts'

/** The client, or the one of a transaction (cast where a transaction passes it). */
type Reader = PrismaClient

export interface RowCount {
  table: string
  count: number
}

/**
 * Every Prisma model that holds rows of one runner, with the count of that runner's rows. Each is
 * removed by `onDelete: Cascade` from `User` (directly, or through `Activity`, `Plan` or
 * `StrengthLog`), so deleting the `User` row removes them all in the one statement. A model that is
 * in neither this list nor `UNOWNED_MODELS` fails `tests/api/deleteUser.test.ts`.
 */
const OWNED: ReadonlyArray<readonly [string, (db: Reader, userId: string) => Promise<number>]> = [
  ['Activity', (db, userId) => db.activity.count({ where: { userId } })],
  ['ActivityStream', (db, userId) => db.activityStream.count({ where: { activity: { userId } } })],
  ['ActivityTrack', (db, userId) => db.activityTrack.count({ where: { activity: { userId } } })],
  ['ActivityFile', (db, userId) => db.activityFile.count({ where: { activity: { userId } } })],
  [
    'ActivityInsight',
    (db, userId) => db.activityInsight.count({ where: { activity: { userId } } }),
  ],
  ['ImportBatch', (db, userId) => db.importBatch.count({ where: { userId } })],
  ['ImportedFile', (db, userId) => db.importedFile.count({ where: { userId } })],
  ['Goal', (db, userId) => db.goal.count({ where: { userId } })],
  ['Plan', (db, userId) => db.plan.count({ where: { userId } })],
  ['PlanWeek', (db, userId) => db.planWeek.count({ where: { plan: { userId } } })],
  ['PlanSession', (db, userId) => db.planSession.count({ where: { plan: { userId } } })],
  ['PlanRevision', (db, userId) => db.planRevision.count({ where: { plan: { userId } } })],
  ['PredictionLog', (db, userId) => db.predictionLog.count({ where: { userId } })],
  ['RaceResult', (db, userId) => db.raceResult.count({ where: { userId } })],
  ['RaceCheckpoint', (db, userId) => db.raceCheckpoint.count({ where: { userId } })],
  ['Screening', (db, userId) => db.screening.count({ where: { userId } })],
  ['WeeklyReview', (db, userId) => db.weeklyReview.count({ where: { userId } })],
  ['WeeklyBrief', (db, userId) => db.weeklyBrief.count({ where: { userId } })],
  ['AthleteProfile', (db, userId) => db.athleteProfile.count({ where: { userId } })],
  ['WellnessDay', (db, userId) => db.wellnessDay.count({ where: { userId } })],
  ['Integration', (db, userId) => db.integration.count({ where: { userId } })],
  ['SyncRun', (db, userId) => db.syncRun.count({ where: { userId } })],
  ['DeliveryChannel', (db, userId) => db.deliveryChannel.count({ where: { userId } })],
  ['WristPublication', (db, userId) => db.wristPublication.count({ where: { userId } })],
  ['FuelProduct', (db, userId) => db.fuelProduct.count({ where: { userId } })],
  ['FuelLog', (db, userId) => db.fuelLog.count({ where: { userId } })],
  ['FuelSettings', (db, userId) => db.fuelSettings.count({ where: { userId } })],
  ['Disruption', (db, userId) => db.disruption.count({ where: { userId } })],
  ['StrengthSettings', (db, userId) => db.strengthSettings.count({ where: { userId } })],
  ['StrengthLift', (db, userId) => db.strengthLift.count({ where: { userId } })],
  ['StrengthLog', (db, userId) => db.strengthLog.count({ where: { userId } })],
  ['StrengthSet', (db, userId) => db.strengthSet.count({ where: { userId } })],
  ['MapArea', (db, userId) => db.mapArea.count({ where: { userId } })],
  ['MapWay', (db, userId) => db.mapWay.count({ where: { userId } })],
]

/**
 * Models with no row of a runner, and why nothing is removed from them. Both are shared caches
 * keyed by place (a 0.1 or 0.01 degree cell), with no user column; other runners may read the same
 * row, and a cell is a rounded area, not an address.
 */
export const UNOWNED_MODELS: Readonly<Record<string, string>> = {
  ForecastCache: 'shared cache keyed by a 0.1 degree cell; no user column',
  ClimateCache: 'shared cache keyed by a 0.01 degree race cell; no user column',
}

/** The names of the tables `countUserRows` reports, for the completeness test. */
export const OWNED_MODEL_NAMES: readonly string[] = ['User', ...OWNED.map(([name]) => name)]

/** Rows of one runner per table (the `User` row itself included), in the order of `OWNED`. */
export async function countUserRows(db: PrismaClient, userId: string): Promise<RowCount[]> {
  const rows: RowCount[] = [
    { table: 'User', count: await db.user.count({ where: { id: userId } }) },
  ]
  for (const [table, count] of OWNED) rows.push({ table, count: await count(db, userId) })
  return rows
}

export interface DeletePlan {
  userId: string
  email: string
  counts: RowCount[]
}

/**
 * Finds the account and its row counts. Throws a 404 `HttpError` for an unknown email and a 409 for
 * the install owner, whose account holds the Watched folder and is never removed from here.
 */
export async function planDeleteUser(prisma: PrismaClient, rawEmail: string): Promise<DeletePlan> {
  const email = rawEmail.trim().toLowerCase()
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } })
  if (!user) throw notFound(`No account found for ${email}.`)
  if (await isInstallOwner(prisma, user.id)) {
    throw conflict(
      `${user.email} is the install owner (the oldest account) and is not deleted from here.`,
    )
  }
  return { userId: user.id, email: user.email, counts: await countUserRows(prisma, user.id) }
}

/**
 * Deletes the account and every row that belongs to it in one transaction. The `User` delete
 * cascades through the schema's foreign keys, so no other table is written by name; the counts
 * taken in the same transaction are returned. The owner check runs again inside the transaction.
 * A session cookie of the account stops working at once: `requireAuth` finds no user.
 */
export async function deleteUser(prisma: PrismaClient, rawEmail: string): Promise<DeletePlan> {
  return prisma.$transaction(async (tx) => {
    const plan = await planDeleteUser(tx as unknown as PrismaClient, rawEmail)
    await tx.user.delete({ where: { id: plan.userId } })
    return plan
  })
}
