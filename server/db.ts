import { isAbsolute, resolve } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/prisma/client.ts'

export { PrismaClient }
export type {
  Activity,
  ActivityFile,
  ActivityStream,
  AthleteProfile,
  Goal,
  ImportBatch,
  ImportedFile,
  Integration,
  Plan,
  PlanRevision,
  PlanSession,
  PlanWeek,
  PredictionLog,
  Screening,
  WeeklyReview,
  WellnessDay,
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

export function createPrisma(databaseUrl: string): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: resolveSqliteUrl(databaseUrl) })
  return new PrismaClient({ adapter })
}

/** Write-ahead logging lets reads continue during a write; the timeout waits out a brief lock. */
export async function initSqlite(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL')
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000')
}
