import type { PrismaClient } from '../db.ts'
import { toActivity } from '../serialize.ts'
import { findPossibleDuplicate, pickDuplicate } from '../../shared/domain/duplicates.ts'
import type { DuplicateStatus } from '../../shared/types.ts'

const COUNTED_TYPES = ['run', 'race']

/**
 * The near-duplicate pass. For each id (a run or race with a distance) the same-date runs of the
 * same user are compared with `findPossibleDuplicate`; the lower-ranked source of the pair gets
 * `duplicateStatus = 'possible'` and `duplicateOfId` pointing at the other. Rows already
 * `confirmed` or `dismissed` are left alone, and a row already `possible` against the same
 * original is not counted again. Returns how many rows were newly flagged.
 */
export async function markDuplicates(
  prisma: Pick<PrismaClient, 'activity'>,
  userId: string,
  activityIds: string[],
): Promise<number> {
  let flagged = 0
  for (const id of new Set(activityIds)) {
    const row = await prisma.activity.findFirst({ where: { id, userId } })
    if (!row || !COUNTED_TYPES.includes(row.type) || row.distanceM === null) continue

    const sameDay = await prisma.activity.findMany({
      where: {
        userId,
        date: row.date,
        id: { not: row.id },
        type: { in: COUNTED_TYPES },
        distanceM: { not: null },
      },
    })
    const candidate = toActivity(row)
    const match = findPossibleDuplicate(candidate, sameDay.map(toActivity))
    if (!match) continue

    const { duplicate, original } = pickDuplicate(candidate, match)
    if (duplicate.duplicateStatus === 'confirmed' || duplicate.duplicateStatus === 'dismissed') {
      continue
    }
    if (original.duplicateStatus === 'possible' || original.duplicateStatus === 'confirmed') {
      continue
    }
    if (duplicate.duplicateStatus === 'possible' && duplicate.duplicateOfId === original.id) {
      continue
    }
    const wasFlagged = duplicate.duplicateStatus === 'possible'
    await prisma.activity.update({
      where: { id: duplicate.id },
      data: { duplicateStatus: 'possible', duplicateOfId: original.id },
    })
    if (!wasFlagged) flagged += 1
  }
  return flagged
}

/**
 * Returns the rows flagged with one of `statuses` as duplicates of `activityId` to `none` with no
 * `duplicateOfId`, and gives back their ids.
 */
export async function releaseDuplicates(
  prisma: PrismaClient,
  userId: string,
  activityId: string,
  statuses: DuplicateStatus[],
): Promise<string[]> {
  const where = { userId, duplicateOfId: activityId, duplicateStatus: { in: statuses } }
  const rows = await prisma.activity.findMany({ where, select: { id: true } })
  if (rows.length === 0) return []
  await prisma.activity.updateMany({
    where,
    data: { duplicateStatus: 'none', duplicateOfId: null },
  })
  return rows.map((r) => r.id)
}

/**
 * Rows flagged `possible` or `confirmed` as duplicates of this activity go back to `none`, so
 * their totals recover when the original is deleted.
 */
export async function releaseDuplicatesOf(
  prisma: PrismaClient,
  userId: string,
  activityId: string,
): Promise<void> {
  await releaseDuplicates(prisma, userId, activityId, ['possible', 'confirmed'])
}
