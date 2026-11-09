import type { PrismaClient } from '../db.ts'
import { toActivity } from '../serialize.ts'
import {
  duplicateStatusFor,
  findPossibleDuplicate,
  matchActivities,
  pickDuplicate,
} from '../../shared/domain/duplicates.ts'
import { compatible } from '../../shared/engine/execution.ts'
import type { SessionKind } from '../../shared/engine/types.ts'
import type { DuplicateStatus } from '../../shared/types.ts'

/** The activity types the pass compares, each only with its own kind (`findPossibleDuplicate`). */
const COUNTED_TYPES = ['run', 'race', 'strength']

type LogHandOverDb = Pick<PrismaClient, 'activity' | 'fuelLog' | 'strengthLog' | 'planSession'>

/**
 * Hands the logs of a confirmed duplicate of `originalId` to the original, for each kind of log the
 * original has none of. A confirmed duplicate is the same activity, so a log the runner entered on
 * the copy would otherwise be read as a second session: the fuel ladder counts a run once (design
 * 10.7) and the strength history counts a session once (strength design 9.4). When the original
 * already has a log of the kind, the copy's log stays where it is. At most one log of each kind
 * moves, because an activity holds one.
 *
 * A strength log moves only onto a strength activity (anything else is refused and nothing is
 * written), and takes the effort, the pain and the note of the copy along where the original has
 * none, because the sheet that saved the log entered them on the copy. Returns whether a log moved.
 *
 * The plan session a copy fulfils moves to the original too (`carrySessionLink`), so the session
 * opens the activity that counts. The id of a session that moved is pushed onto `movedSessions`: the
 * caller assesses it against the original (`assessSessionsQuietly`), because the findings and the
 * status stored with the session were drawn from the copy.
 */
export async function moveConfirmedLogs(
  prisma: LogHandOverDb,
  userId: string,
  originalId: string,
  movedSessions: string[] = [],
): Promise<boolean> {
  const copies = await prisma.activity.findMany({
    where: { userId, duplicateOfId: originalId, duplicateStatus: 'confirmed' },
    select: { id: true, heatExposure: true },
    orderBy: { id: 'asc' },
  })
  await carryHeatMark(prisma, originalId, copies)
  const moved = await carrySessionLink(prisma, userId, originalId, copies)
  if (moved !== null) movedSessions.push(moved)
  const fuel = await handOverLog(
    copies,
    originalId,
    (activityId) => prisma.fuelLog.findUnique({ where: { activityId }, select: { id: true } }),
    (id) => prisma.fuelLog.update({ where: { id }, data: { activityId: originalId } }),
  )
  const original = await prisma.activity.findFirst({
    where: { id: originalId, userId },
    select: { type: true },
  })
  const strength =
    original?.type === 'strength'
      ? await handOverLog(
          copies,
          originalId,
          (activityId) =>
            prisma.strengthLog.findUnique({ where: { activityId }, select: { id: true } }),
          async (id, copyId) => {
            await prisma.strengthLog.update({ where: { id }, data: { activityId: originalId } })
            await copyEffort(prisma, copyId, originalId)
          },
        )
      : false
  return fuel || strength
}

/**
 * The runner's heat mark (rule I8) is part of the rating of a run: when the original has none, the
 * first copy (by id) that carries one gives it to the original, so a mark made on a copy that was
 * later confirmed as a duplicate still counts for the day.
 */
async function carryHeatMark(
  prisma: Pick<PrismaClient, 'activity'>,
  originalId: string,
  copies: ReadonlyArray<{ heatExposure: string | null }>,
): Promise<void> {
  const mark = copies.find((copy) => copy.heatExposure !== null)?.heatExposure ?? null
  if (mark === null) return
  await prisma.activity.updateMany({
    where: { id: originalId, heatExposure: null },
    data: { heatExposure: mark },
  })
}

/**
 * The plan session a confirmed copy fulfils is handed to the original: a copy no longer counts
 * (`counts` in `shared/engine/execution.ts`), so a session left on it would open the copy, without
 * the time and the heart rate of the source that wins, and the original would fulfil nothing. The
 * row keeps its `linkSource` and its status; only `activityId` changes, as in a manual link no
 * revision is written (a link is not a change to the plan, ADR 0007). The findings stored with the
 * session still describe the copy until the caller assesses the returned session. When the original already fulfils a session (the link is unique
 * per activity), or its type no longer fits the session, both stay as they are. The first copy (by
 * id) that fulfils a session gives it up; its id is returned, or null when nothing moved. Releasing a copy later does not move the link back, as
 * it does not move a log back.
 */
async function carrySessionLink(
  prisma: Pick<PrismaClient, 'activity' | 'planSession'>,
  userId: string,
  originalId: string,
  copies: ReadonlyArray<{ id: string }>,
): Promise<string | null> {
  if (copies.length === 0) return null
  const held = await prisma.planSession.findFirst({
    where: { activityId: originalId, plan: { userId } },
    select: { id: true },
  })
  if (held) return null
  const original = await prisma.activity.findFirst({
    where: { id: originalId, userId },
    select: { type: true, subtype: true },
  })
  if (!original) return null
  for (const copy of copies) {
    const session = await prisma.planSession.findFirst({
      where: { activityId: copy.id, plan: { userId } },
      select: { id: true, kind: true },
    })
    if (!session) continue
    if (!compatible(session.kind as SessionKind, original)) return null
    await prisma.planSession.update({ where: { id: session.id }, data: { activityId: originalId } })
    return session.id
  }
  return null
}

/**
 * One kind of log: when the original holds none, the first copy (by id) that holds one gives it up
 * to the original. `move` gets the log and the activity it came from. Returns whether a log moved.
 */
async function handOverLog(
  copies: ReadonlyArray<{ id: string }>,
  originalId: string,
  find: (activityId: string) => Promise<{ id: string } | null>,
  move: (logId: string, copyId: string) => Promise<unknown>,
): Promise<boolean> {
  if (await find(originalId)) return false
  for (const copy of copies) {
    const log = await find(copy.id)
    if (log) {
      await move(log.id, copy.id)
      return true
    }
  }
  return false
}

/** The runner's own words about a session: what the copy has and the original lacks is copied. */
async function copyEffort(
  prisma: Pick<PrismaClient, 'activity'>,
  copyId: string,
  originalId: string,
): Promise<void> {
  const fields = { rpe: true, pain: true, notes: true } as const
  const [copy, original] = await Promise.all([
    prisma.activity.findUnique({ where: { id: copyId }, select: fields }),
    prisma.activity.findUnique({ where: { id: originalId }, select: fields }),
  ])
  if (!copy || !original) return
  const data = {
    ...(original.rpe === null && copy.rpe !== null ? { rpe: copy.rpe } : {}),
    ...(original.pain === null && copy.pain !== null ? { pain: copy.pain } : {}),
    ...(original.notes === null && copy.notes !== null ? { notes: copy.notes } : {}),
  }
  if (Object.keys(data).length > 0) {
    await prisma.activity.update({ where: { id: originalId }, data })
  }
}

/** `date` (YYYY-MM-DD) moved by `days`; calendar arithmetic in UTC, so no DST effects. */
function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The cross-source duplicate pass (spec 2.4). For each id (a run, a race or a strength session) the
 * activities of the same user and kind that could match are compared with `findPossibleDuplicate`
 * (a run never with a strength session): the same date, or, when the
 * row has a start instant, the day before and after too. Of each pair the lower-ranked source
 * gets `duplicateOfId` pointing at the other, whichever row arrived first, and anything that
 * pointed at the demoted row is re-pointed at the survivor. The status is `confirmed` for two
 * automated sources matched on start instant, else `possible`. Rows already `confirmed` or
 * `dismissed` are left alone; a `possible` row against the same original is upgraded to
 * `confirmed` when it now qualifies. Returns how many rows were newly flagged. `assess` gets the
 * sessions that moved from a confirmed copy to its original, once the pass is done; a caller inside
 * a transaction passes none and assesses them after it commits.
 */
export async function markDuplicates(
  prisma: Pick<PrismaClient, 'activity' | 'fuelLog' | 'strengthLog' | 'planSession'>,
  userId: string,
  activityIds: string[],
  assess?: (sessionIds: string[]) => Promise<void>,
): Promise<number> {
  let flagged = 0
  const movedSessions: string[] = []
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
      if (status === 'confirmed')
        await moveConfirmedLogs(prisma, userId, original.id, movedSessions)
      if (!wasFlagged) flagged += 1
      // The candidate is now itself a duplicate; it cannot demote anything else.
      if (duplicate.id === candidate.id) break
    }
  }
  if (movedSessions.length > 0) await assess?.(movedSessions)
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

/**
 * Confirmed rows pointing at an edited original stay confirmed while the pair still matches; the
 * others go back to `none`, so their totals recover. Returns the released ids.
 */
export async function releaseStaleConfirmed(
  prisma: PrismaClient,
  userId: string,
  originalId: string,
): Promise<string[]> {
  const row = await prisma.activity.findFirst({ where: { id: originalId, userId } })
  if (!row) return []
  const original = toActivity(row)
  const confirmed = await prisma.activity.findMany({
    where: { userId, duplicateOfId: originalId, duplicateStatus: 'confirmed' },
  })
  const stale = confirmed
    .filter((copy) => findPossibleDuplicate(toActivity(copy), [original]) === null)
    .map((copy) => copy.id)
  if (stale.length === 0) return []
  await prisma.activity.updateMany({
    where: { id: { in: stale } },
    data: { duplicateStatus: 'none', duplicateOfId: null },
  })
  return stale
}

/**
 * The pass again for an activity whose date, distance, duration or type was edited, after the
 * caller has cleared the activity's own flag: rows flagged `possible` against it go back to
 * `none`, so do `confirmed` rows that no longer match it, and the pass runs over the activity and
 * every row it released.
 */
export async function rematchDuplicates(
  prisma: PrismaClient,
  userId: string,
  activityId: string,
): Promise<void> {
  const released = await releaseDuplicates(prisma, userId, activityId, ['possible'])
  released.push(...(await releaseStaleConfirmed(prisma, userId, activityId)))
  await markDuplicates(prisma, userId, [activityId, ...released])
}
