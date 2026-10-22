import type { PrismaClient } from '@prisma/client'

/**
 * Stub until Task 8 implements the near-duplicate pass. Flags manual or csv runs that match an
 * imported run and returns how many activities were flagged.
 */
export function markDuplicates(
  _prisma: PrismaClient,
  _userId: string,
  _activityIds: string[],
): Promise<number> {
  return Promise.resolve(0)
}
