import type { PrismaClient } from '../db.ts'
import { toActivity } from '../serialize.ts'
import {
  duplicateStatusFor,
  findPossibleDuplicate,
  matchActivities,
  pickDuplicate,
} from '../../shared/domain/duplicates.ts'
import type { DuplicateStatus } from '../../shared/types.ts'

const COUNTED_TYPES = ['run', 'race']

/**
 * Hands the fuel log of a confirmed duplicate of `originalId` to the original, when the original
 * has none. A confirmed duplicate is the same run and the ladder counts a run once, so a log the
 * runner entered on the copy would otherwise drop out of the replay (design 10.7). When the
 * original already has a log, the copy's log stays where it is and the replay leaves it out. At
 * most one log moves, because an activity holds one. Returns whether a log moved.
 */
export async function moveConfirmedLogs(
  prisma: Pick<PrismaClient, 'activity' | 'fuelLog'>,
  userId: string,
  originalId: string,
): Promise<boolean> {
  const held = await prisma.fuelLog.findUnique({
    where: { activityId: originalId },
    select: { id: true },
  })
  if (held) return false
  const copies = await prisma.activity.findMany({
    where: { userId, duplicateOfId: originalId, duplicateStatus: 'confirmed' },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  for (const copy of copies) {
    const log = await prisma.fuelLog.findUnique({
      where: { activityId: copy.id },
      select: { id: true },
    })
    if (log) {
      await prisma.fuelLog.update({ where: { id: log.id }, data: { activityId: originalId } })
      return true
    }
  }
  return false
}

/** `date` (YYYY-MM-DD) moved by `days`; calendar arithmetic in UTC, so no DST effects. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The cross-source duplicate pass (spec 2.4). For each id (a run or race) the runs of the same
 * user that could match are compared with `findPossibleDuplicate`: the same date, or, when the
 * row has a start instant, the day before and after too. Of each pair the lower-ranked source
 * gets `duplicateOfId` pointing at the other, whichever row arrived first, and anything that
 * pointed at the demoted row is re-pointed at the survivor. The status is `confirmed` for two
 * automated sources matched on start instant, else `possible`. Rows already `confirmed` or
 * `dismissed` are left alone; a `possible` row against the same original is upgraded to
 * `confirmed` when it now qualifies. Returns how many rows were newly flagged.
 */
export async function markDuplicates(
  prisma: Pick<PrismaClient, 'activity' | 'fuelLog'>,
  userId: string,
  activityIds: string[],
): Promise<number> {
  let flagged = 0
  for (const id of new Set(activityIds)) {
    const row = await prisma.activity.findFirst({ where: { id, userId } })
    if (!row || !COUNTED_TYPES.includes(row.type)) continue

    const dates = row.startUtc
      ? [shiftDate(row.date, -1), row.date, shiftDate(row.date, 1)]
      : [row.date]
    const others = await prisma.activity.findMany({
      where: { userId, date: { in: dates }, id: { not: row.id }, type: { in: COUNTED_TYPES } },
    })
    const candidate = toActivity(row)
    let remaining = others.map(toActivity)

    for (;;) {
      const match = findPossibleDuplicate(candidate, remaining)
      if (!match) break
      remaining = remaining.filter((other) => other.id !== match.id)
      const kind = matchActivities(candidate, match)
      if (kind === null) continue

      const { duplicate, original } = pickDuplicate(candidate, match)
      if (duplicate.duplicateStatus === 'confirmed' || duplicate.duplicateStatus === 'dismissed') {
        continue
      }
      if (original.duplicateStatus === 'possible' || original.duplicateStatus === 'confirmed') {
        continue
      }
      const status = duplicateStatusFor(kind, duplicate, original)
      const wasFlagged = duplicate.duplicateStatus === 'possible'
      if (wasFlagged && duplicate.duplicateOfId === original.id && status === 'possible') {
        continue
      }
      await prisma.activity.update({
        where: { id: duplicate.id },
        data: { duplicateStatus: status, duplicateOfId: original.id },
      })
      await prisma.activity.updateMany({
        where: { userId, duplicateOfId: duplicate.id, id: { not: original.id } },
        data: { duplicateOfId: original.id },
      })
      if (status === 'confirmed') await moveConfirmedLogs(prisma, userId, original.id)
      if (!wasFlagged) flagged += 1
      // The candidate is now itself a duplicate; it cannot demote anything else.
      if (duplicate.id === candidate.id) break
    }
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
