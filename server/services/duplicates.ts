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
 * Hands the logs of a confirmed duplicate of `originalId` to the original, for each kind of log the
 * original has none of. A confirmed duplicate is the same activity, so a log the runner entered on
 * the copy would otherwise be read as a second session: the fuel ladder counts a run once (design
 * 10.7) and the strength history counts a session once (strength design 9.4). When the original
 * already has a log of the kind, the copy's log stays where it is. At most one log of each kind
 * moves, because an activity holds one. Returns whether a log moved.
 */
export async function moveConfirmedLogs(
  prisma: Pick<PrismaClient, 'activity' | 'fuelLog' | 'strengthLog'>,
  userId: string,
  originalId: string,
): Promise<boolean> {
  const copies = await prisma.activity.findMany({
    where: { userId, duplicateOfId: originalId, duplicateStatus: 'confirmed' },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  const fuel = await handOverLog(
    copies,
    originalId,
    (activityId) => prisma.fuelLog.findUnique({ where: { activityId }, select: { id: true } }),
    (id) => prisma.fuelLog.update({ where: { id }, data: { activityId: originalId } }),
  )
  const strength = await handOverLog(
    copies,
    originalId,
    (activityId) => prisma.strengthLog.findUnique({ where: { activityId }, select: { id: true } }),
    (id) => prisma.strengthLog.update({ where: { id }, data: { activityId: originalId } }),
  )
  return fuel || strength
}

/**
 * One kind of log: when the original holds none, the first copy (by id) that holds one gives it up
 * to the original. Returns whether a log moved.
 */
async function handOverLog(
  copies: ReadonlyArray<{ id: string }>,
  originalId: string,
  find: (activityId: string) => Promise<{ id: string } | null>,
  move: (logId: string) => Promise<unknown>,
): Promise<boolean> {
  if (await find(originalId)) return false
  for (const copy of copies) {
    const log = await find(copy.id)
    if (log) {
      await move(log.id)
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
  prisma: Pick<PrismaClient, 'activity' | 'fuelLog' | 'strengthLog'>,
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
