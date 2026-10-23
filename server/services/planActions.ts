// The one builder of a plan action's preview and commit (phase 3a design 4.2, ADR 0007).
//
// `computeAction` reads and decides, and writes nothing. A preview is that result as information;
// a commit runs that result's write. Because both start from the same call, a preview and its
// commit cannot disagree: the preview of an undo has the diff the undo revision is written with.
// `hash` covers the diff, the newest revision of the plan and the day, so a commit that sends the
// hash back (`expectHash`) is refused with `stale-preview` when new data, another write or
// midnight has changed what it would do; the answer carries the new preview.
//
// Only this module and `replan.ts` write a revision (`recordPlanWrite`). An undo is itself a
// revision, with reason `undo` and no undo of its own.
import { createHash } from 'node:crypto'
import { stalePreviewMessage } from '../../shared/copy/revision.ts'
import { diffPlans } from '../../shared/engine/diff.ts'
import type { EngineWarning } from '../../shared/engine/types.ts'
import type {
  PlanAction,
  PlanDiff,
  PlanPreview,
  PlanRevisionView,
  UndoReason,
  UndoResult,
} from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { PlanSession as PlanSessionRow, PlanWeek as PlanWeekRow, PrismaClient } from '../db.ts'
import { conflict, HttpError } from '../errors.ts'
import { failedChecklist, WRITE_TIMEOUT_MS } from './planEngine.ts'
import { applyReplan, computeReplan, recordPlanWrite, type ReplanResult } from './replan.ts'
import {
  indexRows,
  planUndo,
  restoreDiff,
  restoreWrites,
  scopeUndo,
  viewRevision,
  type UndoPlan,
} from './revisions.ts'

// ---------------------------------------------------------------------------------------------
// Computing an action
// ---------------------------------------------------------------------------------------------

interface ComputedBase {
  action: PlanAction
  userId: string
  planId: string
  today: string
  /** The newest revision of the plan when the action was computed. */
  headRevisionId: string | null
  summary: string
  diff: PlanDiff
  warnings: EngineWarning[]
  /** Why a commit would be refused; empty when it would go through. */
  reasons: UndoReason[]
  hash: string
}
export interface ComputedReplan extends ComputedBase {
  action: { type: 'replan' }
  work: { type: 'replan'; result: ReplanResult }
}
export interface ComputedUndo extends ComputedBase {
  action: { type: 'undo'; revisionId: string }
  work: { type: 'undo'; plan: UndoPlan }
}
export type ComputedAction = ComputedReplan | ComputedUndo

/** The JSON of a value with object keys in order, so equal values hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  })
}

function previewHash(parts: {
  diff: PlanDiff
  headRevisionId: string | null
  today: string
}): string {
  return createHash('sha256').update(canonicalJson(parts)).digest('hex')
}

async function headRevisionOf(prisma: PrismaClient, planId: string): Promise<string | null> {
  const head = await prisma.planRevision.findFirst({
    where: { planId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  return head?.id ?? null
}

/**
 * Decides an action from the data as it is and writes nothing: no row, no revision, no prediction,
 * no data version. A refusal (an undo with a reason, a draft that fails the checklist) is part of
 * the result, not thrown; a missing plan or revision is.
 */
export async function computeAction(
  deps: Deps,
  args: { userId: string; action: { type: 'replan' }; today: string },
): Promise<ComputedReplan>
export async function computeAction(
  deps: Deps,
  args: { userId: string; action: { type: 'undo'; revisionId: string }; today: string },
): Promise<ComputedUndo>
export async function computeAction(
  deps: Deps,
  args: { userId: string; action: PlanAction; today: string },
): Promise<ComputedAction>
export async function computeAction(
  deps: Deps,
  args: { userId: string; action: PlanAction; today: string },
): Promise<ComputedAction> {
  const { userId, today, action } = args
  if (action.type === 'replan') {
    // The newest revision is read first: a revision that lands during the compute makes the
    // commit's hash differ, never silently match.
    const result = await computeReplan(deps, { userId, reason: 'owner', today })
    const headRevisionId = await headRevisionOf(deps.prisma, result.planId)
    const blocked = failedChecklist(result.draft.checklist)
    return {
      action,
      userId,
      planId: result.planId,
      today,
      headRevisionId,
      summary: result.summary,
      diff: result.diff,
      warnings: result.draft.warnings,
      reasons: blocked ? [{ code: 'checklist', message: blocked.message }] : [],
      hash: previewHash({ diff: result.diff, headRevisionId, today }),
      work: { type: 'replan', result },
    }
  }
  const plan = await planUndo(deps, { userId, revisionId: action.revisionId, today })
  const headRevisionId = await headRevisionOf(deps.prisma, plan.planId)
  return {
    action,
    userId,
    planId: plan.planId,
    today,
    headRevisionId,
    summary: plan.summary,
    diff: plan.diff,
    warnings: plan.warnings,
    reasons: plan.reasons,
    hash: previewHash({ diff: plan.diff, headRevisionId, today }),
    work: { type: 'undo', plan },
  }
}

// ---------------------------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------------------------

export function toPreview(computed: ComputedAction): PlanPreview {
  return {
    action: computed.action,
    diff: computed.diff,
    summary: computed.summary,
    warnings: computed.warnings,
    blocked: computed.reasons.length > 0,
    guards: [],
    reasons: computed.reasons,
    hash: computed.hash,
    today: computed.today,
  }
}

/** What an action would do, as information. Writes nothing. */
export async function previewAction(
  deps: Deps,
  args: { userId: string; action: PlanAction; today: string },
): Promise<PlanPreview> {
  return toPreview(await computeAction(deps, args))
}

// ---------------------------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------------------------

function stalePreview(computed: ComputedAction): HttpError {
  return conflict(stalePreviewMessage(), { code: 'stale-preview', preview: toPreview(computed) })
}

/** A commit that sends the hash of its preview is refused when the action now computes differently. */
function assertCurrent(computed: ComputedAction, expectHash: string | undefined): void {
  if (expectHash !== undefined && expectHash !== computed.hash) throw stalePreview(computed)
}

/** Re-plans the active plan on request. 409 `stale-preview` when `expectHash` no longer matches. */
export async function commitReplan(
  deps: Deps,
  args: { userId: string; today: string; expectHash?: string },
): Promise<PlanRevisionView> {
  const computed = await computeAction(deps, {
    userId: args.userId,
    action: { type: 'replan' },
    today: args.today,
  })
  assertCurrent(computed, args.expectHash)
  // A draft that fails the checklist is refused (422) by `applyReplan`, with nothing written.
  const written = await applyReplan(deps, computed.work.result)
  return viewRevision(deps, { userId: args.userId, revisionId: written.id })
}

/** The rows an undo found changed while it was being written; the caller answers `stale-preview`. */
class StaleUndo extends Error {}

/**
 * Writes an undo in one transaction. The rows are read again inside it and the restore is decided
 * again: if a row was edited meanwhile, or the diff is no longer the one that was previewed,
 * nothing is written. Returns the id of the `undo` revision.
 */
async function applyUndo(
  deps: Deps,
  plan: UndoPlan,
  args: { today: string; diff: PlanDiff },
): Promise<string> {
  const { restore, target, planId, userId } = plan
  if (restore === null) throw new Error('An undo that is refused has nothing to apply.')
  return deps.prisma.$transaction(
    async (tx) => {
      const [sessionRows, weekRows] = await Promise.all([
        tx.planSession.findMany({ where: { planId } }),
        tx.planWeek.findMany({ where: { planId } }),
      ])
      const scoped = scopeUndo(restore.payload, indexRows(sessionRows, weekRows), {
        today: args.today,
        diff: null,
      })
      if (scoped.rows.some((row) => row.standing !== 'as-left')) throw new StaleUndo()
      const writes = restoreWrites({ sessions: sessionRows, weeks: weekRows }, scoped.payload)
      if (canonicalJson(restoreDiff(writes)) !== canonicalJson(args.diff)) throw new StaleUndo()

      // Sessions: delete what the revision created, put back the columns it changed, then recreate
      // what it deleted, with the same id and `externalId`. Weeks the same way.
      const sessions = writes.sessions
      if (sessions.deleted.length > 0) {
        await tx.planSession.deleteMany({
          where: { id: { in: sessions.deleted.map((r) => r.id) } },
        })
      }
      const sessionsUpdated: Array<{ before: PlanSessionRow; after: PlanSessionRow }> = []
      for (const { before, data } of sessions.updated) {
        sessionsUpdated.push({
          before,
          after: await tx.planSession.update({ where: { id: before.id }, data }),
        })
      }
      // A run linked to a session that came back may have been deleted since; the link is dropped
      // then, as unlinking does, rather than failing the whole undo on the foreign key.
      const linked = sessions.created.flatMap((row) =>
        row.activityId === null ? [] : [row.activityId],
      )
      const live = new Set(
        linked.length === 0
          ? []
          : (
              await tx.activity.findMany({ where: { id: { in: linked } }, select: { id: true } })
            ).map((activity) => activity.id),
      )
      const sessionsCreated =
        sessions.created.length === 0
          ? []
          : await tx.planSession.createManyAndReturn({
              data: sessions.created.map((row) =>
                row.activityId === null || live.has(row.activityId)
                  ? row
                  : {
                      ...row,
                      activityId: null,
                      linkSource: null,
                      execution: null,
                      status:
                        row.status === 'completed' || row.status === 'partial'
                          ? 'planned'
                          : row.status,
                    },
              ),
            })

      const weeks = writes.weeks
      if (weeks.deleted.length > 0) {
        await tx.planWeek.deleteMany({ where: { id: { in: weeks.deleted.map((r) => r.id) } } })
      }
      const weeksUpdated: Array<{ before: PlanWeekRow; after: PlanWeekRow }> = []
      for (const { before, data } of weeks.updated) {
        weeksUpdated.push({
          before,
          after: await tx.planWeek.update({ where: { id: before.id }, data }),
        })
      }
      const weeksCreated =
        weeks.created.length === 0
          ? []
          : await tx.planWeek.createManyAndReturn({ data: weeks.created })

      await tx.plan.update({ where: { id: planId }, data: restore.plan })
      const diff = diffPlans({
        sessions: { created: sessionsCreated, deleted: sessions.deleted, updated: sessionsUpdated },
        weeks: { created: weeksCreated, deleted: weeks.deleted, updated: weeksUpdated },
      })
      const revision = await recordPlanWrite(tx, {
        planId,
        userId,
        reason: 'undo',
        summary: plan.summary,
        changes: [],
        diff,
        undo: null,
        undoOf: target.id,
      })
      // The runner chose to undo this revision from a surface that showed it, so it counts as seen.
      const now = new Date()
      await tx.planRevision.update({
        where: { id: target.id },
        data: { undoneAt: now, undoneById: revision.id, seenAt: target.seenAt ?? now },
      })
      return revision.id
    },
    { timeout: WRITE_TIMEOUT_MS },
  )
}

/**
 * Undoes a revision. 409 with `details.reasons` for a structural reason (the first reason is the
 * message), 409 `stale-preview` when `expectHash` no longer matches or a row changed meanwhile,
 * 422 with the checklist when the restored plan does not pass it. Nothing is written on a refusal.
 */
export async function commitUndo(
  deps: Deps,
  args: { userId: string; revisionId: string; today: string; expectHash?: string },
): Promise<UndoResult> {
  const { userId, revisionId, today } = args
  const action = { type: 'undo', revisionId } as const
  const computed = await computeAction(deps, { userId, action, today })
  assertCurrent(computed, args.expectHash)
  const { plan } = computed.work
  if (plan.restore === null) {
    const first = plan.reasons[0]!
    if (plan.reasons.every((reason) => reason.code === 'checklist')) {
      throw new HttpError(422, 'validation', first.message, { checklist: plan.checklist })
    }
    throw conflict(first.message, { reasons: plan.reasons })
  }
  let undoRevisionId: string
  try {
    undoRevisionId = await applyUndo(deps, plan, { today, diff: computed.diff })
  } catch (error) {
    if (!(error instanceof StaleUndo)) throw error
    throw stalePreview(await computeAction(deps, { userId, action, today }))
  }
  const [revision, target] = await Promise.all([
    viewRevision(deps, { userId, revisionId: undoRevisionId }),
    viewRevision(deps, { userId, revisionId }),
  ])
  return { revision, target }
}
