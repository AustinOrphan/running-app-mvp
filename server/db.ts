import { isAbsolute, resolve } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { Prisma, PrismaClient } from '../generated/prisma/client.ts'
import { withDataVersion } from './dataVersion.ts'

export { PrismaClient }

/**
 * The scalar columns of the two plan tables that a revision restores, in the order of the schema.
 * They come from the generated client's field enums, which Prisma builds from its data model
 * (DMMF), so a column added to the schema is in the list without anyone editing it.
 */
export const PLAN_SESSION_COLUMNS = Object.values(Prisma.PlanSessionScalarFieldEnum)
export const PLAN_WEEK_COLUMNS = Object.values(Prisma.PlanWeekScalarFieldEnum)
export type {
  Activity,
  ActivityFile,
  ActivityStream,
  AthleteProfile,
  Disruption,
  DeliveryChannel,
  FuelLog,
  FuelProduct,
  FuelSettings,
  Goal,
  ImportBatch,
  ImportedFile,
  Integration,
  Plan,
  PlanRevision,
  PlanSession,
  PlanWeek,
  PredictionLog,
  RaceResult,
  Screening,
  StrengthLift,
  StrengthLog,
  StrengthSet,
  StrengthSettings,
  SyncRun,
  WeeklyBrief,
  WeeklyReview,
  WellnessDay,
  WristPublication,
} from '../generated/prisma/client.ts'

/**
 * A relative `file:` URL resolves against `prisma/` under the working directory, as it did under
 * Prisma 6, so the CLI and the client open the same file. Keep this in step with prisma.config.ts.
 */
function resolveSqliteUrl(url: string): string {
  const path = url.replace(/^file:/, '').split('?')[0] ?? ''
  if (!url.startsWith('file:') || isAbsolute(path)) return url
  return `file:${resolve(process.cwd(), 'prisma', path)}`
}

/**
 * The client carries a data version (`server/dataVersion.ts`): every write to a state model, and
 * the end of every transaction, raises it. Callers never raise it themselves.
 */
export function createPrisma(databaseUrl: string): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: resolveSqliteUrl(databaseUrl) })
  return withDataVersion(new PrismaClient({ adapter }))
}

/** Write-ahead logging lets reads continue during a write; the timeout waits out a brief lock. */
export async function initSqlite(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL')
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000')
}
