import { PrismaClient } from '@prisma/client'

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: databaseUrl })
}

/** Write-ahead logging lets reads continue during a write; the timeout waits out a brief lock. */
export async function initSqlite(prisma: PrismaClient): Promise<void> {
  await prisma.$queryRawUnsafe('PRAGMA journal_mode=WAL')
  await prisma.$queryRawUnsafe('PRAGMA busy_timeout=5000')
}
