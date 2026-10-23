// The owner's edits of one session, read and written (phase 3a design 9.4, 9.5). `planAdjust` gathers
// the plan around a session and asks `adjustCheck` (`shared/engine/adjust.ts`), which decides; it
// writes nothing. `applyAdjust` writes what that decided, in one transaction, with the revision.
// `computeAction` (`planActions.ts`) calls the first for the preview and the commit alike, so a
// preview and its commit cannot disagree.
//
// The older `PUT /api/plan/sessions/:id` ({ date }, { kind } or { skip }) maps onto an adjustment
// here (`adjustmentOfPatch`) and goes through the same checks.
import { addDays } from '../../shared/dates.ts'
import { diffPlans } from '../../shared/engine/diff.ts'
import { adjustCheck, type AdjustCheck, type SessionPatch } from '../../shared/engine/adjust.ts'
import { dayRulesIn, disruptionPlan } from '../../shared/engine/disruption.ts'
import { completedReference, injuryTight } from '../../shared/engine/limits.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { SessionKind } from '../../shared/engine/types.ts'
import type { PlanAdjustment, PlanDiff, PlanRevisionView, PlanSession } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { PlanSession as PlanSessionRow } from '../db.ts'
import { isTrimmed, toPlanSession } from '../serialize.ts'
import { loadAthleteContext, sessionSpec } from './athleteState.ts'
import { inputFromContext } from './engineInput.ts'
import { WRITE_TIMEOUT_MS, type SessionWriteSet } from './planEngine.ts'
import { recordPlanWrite, revisionParts, sessionHash } from './replan.ts'

/** The body of the older `PUT /api/plan/sessions/:id`: exactly one of the three. */
export interface PlanSessionPatch {
  date?: string
  kind?: SessionKind
  skip?: boolean
}

/** The adjustment the older edit asked for: a date moves, a kind swaps kinds, `skip` skips or restores. */
export function adjustmentOfPatch(patch: PlanSessionPatch): PlanAdjustment {
  if (patch.skip !== undefined) return { type: patch.skip ? 'skip' : 'restore' }
  if (patch.date !== undefined) return { type: 'move', date: patch.date }
  return { type: 'swap-kind', kind: patch.kind! }
}

/** The columns an edit sets on a row: the engine's patch as the stored text and flags. */
type SessionUpdate = Partial<
  Pick<
    PlanSessionRow,
    | 'date'
    | 'kind'
    | 'title'
    | 'durationMin'
    | 'distanceM'
    | 'gainM'
    | 'structure'
    | 'target'
    | 'purpose'
    | 'rules'
    | 'trimmed'
    | 'flags'
    | 'status'
    | 'original'
  >
>

function updateOf(patch: SessionPatch, before: PlanSessionRow, remember: boolean): SessionUpdate {
  const data: SessionUpdate = {}
  if (patch.date !== undefined) data.date = patch.date
  if (patch.kind !== undefined) data.kind = patch.kind
  if (patch.title !== undefined) data.title = patch.title
  if (patch.durationMin !== undefined) data.durationMin = patch.durationMin
  if (patch.distanceM !== undefined) data.distanceM = patch.distanceM
  if (patch.gainM !== undefined) data.gainM = patch.gainM
  if (patch.structure !== undefined) data.structure = JSON.stringify(patch.structure)
  if (patch.target !== undefined) data.target = JSON.stringify(patch.target)
  if (patch.purpose !== undefined) data.purpose = patch.purpose
  if (patch.rules !== undefined) {
    data.rules = JSON.stringify(patch.rules)
    data.trimmed = isTrimmed(patch.rules)
  }
  if (patch.flags !== undefined) data.flags = JSON.stringify(patch.flags)
  if (patch.status !== undefined) data.status = patch.status
  // The first plan is kept once: an edit of an edited session keeps what was planned first.
  if (remember) {
    data.original = before.original ?? JSON.stringify(sessionSpec(toPlanSession(before)))
  }
  return data
}

/** An edit decided and not written. */
export interface PlannedAdjust {
  userId: string
  planId: string
  /** The session asked about, as it is now. */
  session: PlanSessionRow
  check: AdjustCheck
  /** The rows the edit would write: each as it is, the update and the row as it would be. */
  writes: Array<{ before: PlanSessionRow; data: SessionUpdate; after: PlanSessionRow }>
  /** What writing it would change; empty when it is refused or changes nothing. */
  diff: PlanDiff
  /** The session asked about, as it would stand. */
  after: PlanSession
}

/**
 * Decides one edit of one session from the stored plan and writes nothing. `row` is the session
 * the caller already found for this user. The plan around the session (30 days before its week to
 * the day after it), the profile, the completed runs, the week's target and any rest windows are
 * read; a refusal is in `check.guards`, not thrown.
 */
export async function planAdjust(
  deps: Deps,
  args: { userId: string; row: PlanSessionRow; adjustment: PlanAdjustment; today: string },
): Promise<PlannedAdjust> {
  const { prisma } = deps
  const { userId, row, today } = args
  const [context, rows, week] = await Promise.all([
    loadAthleteContext(deps, { userId, today }),
    prisma.planSession.findMany({
      where: {
        planId: row.planId,
        date: {
          gte: addDays(row.weekStart, -(P.g1.windowDays.value + 1)),
          lte: addDays(row.weekStart, 7),
        },
      },
      orderBy: [{ date: 'asc' }, { order: 'asc' }],
    }),
    prisma.planWeek.findUnique({
      where: { planId_weekStart: { planId: row.planId, weekStart: row.weekStart } },
      select: { targetRunMin: true },
    }),
  ])
  const windows = inputFromContext(context).disruptions ?? []
  const check = adjustCheck(toPlanSession(row), args.adjustment, {
    today,
    availability: context.profile.availability,
    sessions: rows.map(toPlanSession),
    weekTargetMin: week?.targetRunMin ?? null,
    dayRules: dayRulesIn(disruptionPlan(windows)),
    completedRuns: completedReference(context.activities, context.state).runs,
    injuryTight: injuryTight(context.state),
  })

  const byId = new Map(rows.map((r) => [r.id, r]))
  const writes = check.edits.map(({ sessionId, patch, remember }) => {
    const before = byId.get(sessionId)
    if (before === undefined) throw new Error('An edit names a session that was not read.')
    const data = updateOf(patch, before, remember)
    return { before, data, after: { ...before, ...data } }
  })
  const diff = diffPlans({
    sessions: {
      created: [],
      deleted: [],
      updated: writes.map(({ before, after }) => ({ before, after })),
    },
    weeks: { created: [], deleted: [], updated: [] },
  })
  const target = writes.find((write) => write.before.id === row.id)
  return {
    userId,
    planId: row.planId,
    session: row,
    check,
    writes,
    diff,
    after: toPlanSession(target?.after ?? row),
  }
}

/** The rows an edit found changed while it was being written; the caller answers `stale-preview`. */
export class StaleAdjust extends Error {}

/**
 * Writes an edit in one transaction. The rows are read again inside it: a row that changed since
 * the preview (a run linked to it, another edit), or a diff that is no longer the one that was
 * previewed, writes nothing and throws `StaleAdjust`. Returns the revision and the session asked
 * about, as written.
 */
export async function applyAdjust(
  deps: Deps,
  planned: PlannedAdjust,
  isPreviewed: (diff: PlanDiff) => boolean,
): Promise<{ revision: PlanRevisionView; session: PlanSessionRow }> {
  const { check, writes, planId, userId } = planned
  return deps.prisma.$transaction(
    async (tx) => {
      const current = await tx.planSession.findMany({
        where: { planId, id: { in: writes.map((write) => write.before.id) } },
      })
      for (const { before } of writes) {
        const now = current.find((row) => row.id === before.id)
        if (
          now === undefined ||
          now.activityId !== before.activityId ||
          sessionHash(now) !== sessionHash(before)
        ) {
          throw new StaleAdjust()
        }
      }
      const updated: SessionWriteSet['updated'] = []
      for (const { before, data } of writes) {
        const after = await tx.planSession.update({ where: { id: before.id }, data })
        updated.push({ id: after.id, before, after })
      }
      const { diff, undo } = revisionParts({ sessions: { created: [], deleted: [], updated } })
      if (!isPreviewed(diff)) throw new StaleAdjust()
      const revision = await recordPlanWrite(tx, {
        planId,
        userId,
        reason: 'owner',
        summary: check.summary,
        changes: check.changes,
        diff,
        undo,
      })
      const session = updated.find((write) => write.id === planned.session.id)?.after
      return { revision, session: session ?? planned.session }
    },
    { timeout: WRITE_TIMEOUT_MS },
  )
}
