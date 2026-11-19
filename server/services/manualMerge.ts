import type { Deps } from '../app.ts'
import type { Activity as ActivityRow } from '../db.ts'
import { conflict, notFound } from '../errors.ts'
import { mergeRefusalText } from '../../shared/copy/manualMerge.ts'
import { toActivity } from '../serialize.ts'
import { comparableKind, pickDuplicate } from '../../shared/domain/duplicates.ts'
import {
  alreadyMerged,
  MERGE_MAX_DAYS,
  mergeRefusal,
  type MergeCandidate,
} from '../../shared/domain/manualMerge.ts'
import { addDays } from '../../shared/dates.ts'
import { assessSessionsQuietly } from './execution.ts'
import { carryRunnersData } from './activityStore.ts'
import { moveConfirmedLogs } from './duplicates.ts'

/** The activity types of each comparable kind (a race is a run). */
const TYPES_OF_KIND = { run: ['run', 'race'], strength: ['strength'] } as const

async function findOwned(deps: Deps, userId: string, id: string): Promise<ActivityRow> {
  const row = id ? await deps.prisma.activity.findFirst({ where: { id, userId } }) : null
  if (!row) throw notFound('Activity not found.')
  return row
}

/**
 * The entries `id` could be merged with by hand: the same comparable kind, dated within
 * `MERGE_MAX_DAYS`, and not a confirmed duplicate of anything. Only what the picker shows is read.
 * An activity that is itself a confirmed duplicate has none.
 */
export async function mergeCandidates(
  deps: Deps,
  userId: string,
  id: string,
): Promise<MergeCandidate[]> {
  const row = await findOwned(deps, userId, id)
  const kind = comparableKind(toActivity(row))
  if (kind === null || row.duplicateStatus === 'confirmed') return []
  const rows = await deps.prisma.activity.findMany({
    where: {
      userId,
      id: { not: id },
      type: { in: [...TYPES_OF_KIND[kind]] },
      date: { in: [-MERGE_MAX_DAYS, 0, MERGE_MAX_DAYS].map((d) => addDays(row.date, d)) },
      NOT: { duplicateStatus: 'confirmed' },
    },
    select: {
      id: true,
      date: true,
      startTime: true,
      type: true,
      durationSec: true,
      source: true,
      avgHr: true,
    },
    orderBy: [{ date: 'desc' }, { startTime: 'desc' }, { id: 'asc' }],
  })
  return rows.map((r) => ({ ...r, type: r.type as MergeCandidate['type'] }))
}

/**
 * Merges two entries of one session by the runner's say-so (MM1): `pickDuplicate` decides which is
 * the original (the richer source stays the record; on equal ranks the entry the runner started
 * from, `id`, is the duplicate). The duplicate is flagged `confirmed`, so it leaves the totals, and
 * what hangs on it goes to the original in one transaction: the plan session, the heat mark, the
 * fuel and strength logs (`moveConfirmedLogs`), and the runner's own data (`carryRunnersData`).
 * Confirmed copies of the duplicate are pointed at the original. A flag of the original as a
 * possible duplicate of a third entry is cleared, since the runner has now said what it is.
 *
 * Refused with a 409 unless `mergeRefusal` allows it. A pair that is already merged answers with
 * the stored duplicate and writes nothing. The sessions that moved are assessed against the
 * original after the transaction, as for a confirmed pair.
 */
export async function mergeActivities(
  deps: Deps,
  userId: string,
  id: string,
  withId: string,
  today: string,
): Promise<ActivityRow> {
  const moved: string[] = []
  // Both rows are read inside the transaction, so two merges at once see each other's flags.
  const merged = await deps.prisma.$transaction(async (tx) => {
    const own = async (rowId: string) => {
      const found = rowId ? await tx.activity.findFirst({ where: { id: rowId, userId } }) : null
      if (!found) throw notFound('Activity not found.')
      return found
    }
    const rowA = await own(id)
    const rowB = await own(withId)
    const a = toActivity(rowA)
    const b = toActivity(rowB)
    if (alreadyMerged(a, b)) return a.duplicateOfId === b.id ? rowA : rowB
    const refusal = mergeRefusal(a, b)
    if (refusal !== null) throw conflict(mergeRefusalText(refusal))

    const { duplicate, original } = pickDuplicate(a, b)
    // An activity holds one log of each kind: a second would stay on the entry that no longer counts.
    const [sets, fuel] = await Promise.all([
      Promise.all(
        [duplicate.id, original.id].map((activityId) =>
          tx.strengthLog.findUnique({ where: { activityId }, select: { id: true } }),
        ),
      ),
      Promise.all(
        [duplicate.id, original.id].map((activityId) =>
          tx.fuelLog.findUnique({ where: { activityId }, select: { id: true } }),
        ),
      ),
    ])
    if (sets.every((log) => log !== null)) throw conflict(mergeRefusalText('sets'))
    if (fuel.every((log) => log !== null)) throw conflict(mergeRefusalText('fuel'))

    await tx.activity.update({
      where: { id: duplicate.id, userId },
      data: { duplicateOfId: original.id, duplicateStatus: 'confirmed', mergedByHand: true },
    })
    await tx.activity.updateMany({
      where: { userId, duplicateOfId: duplicate.id, id: { not: original.id } },
      data: { duplicateOfId: original.id },
    })
    if (original.duplicateStatus === 'possible') {
      await tx.activity.update({
        where: { id: original.id, userId },
        data: { duplicateOfId: null, duplicateStatus: 'none' },
      })
    }
    await moveConfirmedLogs(tx, userId, original.id, moved)
    await carryRunnersData(tx, userId, duplicate.id, original.id)
    return tx.activity.findUniqueOrThrow({ where: { id: duplicate.id } })
  })
  await assessSessionsQuietly(deps, { userId, sessionIds: moved, today })
  return merged
}
