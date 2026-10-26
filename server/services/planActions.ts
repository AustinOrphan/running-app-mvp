// The one builder of a plan action's preview and commit (phase 3a design 4.2, ADR 0007).
//
// `computeAction` reads and decides, and writes nothing. A preview is that result as information;
// a commit runs that result's write. Because both start from the same call, a preview and its
// commit cannot disagree: the preview of an undo has the diff the undo revision is written with.
// `hash` covers the diff, the newest revision of the plan and the day, so a commit that sends the
// hash back (`expectHash`) is refused with `stale-preview` when new data, another write or
// midnight has changed what it would do; the answer carries the new preview.
//
// Only this module, `adjust.ts` and `replan.ts` write a revision (`recordPlanWrite`). An undo is
// itself a revision, with reason `undo` and no undo of its own. A rest window is a revision too:
// creating, changing and removing one are actions, with a preview and a commit built by the same
// code (`disruptions.ts`). An owner edit of one session (move, swap, shorten, skip, restore) is an
// `adjust` action: its guards are part of the preview and a blocking one refuses the commit.
import { createHash } from 'node:crypto'
import { changesSummary, stalePreviewMessage } from '../../shared/copy/revision.ts'
import { diffPlans } from '../../shared/engine/diff.ts'
import type { EngineWarning, LoadAppetite } from '../../shared/engine/types.ts'
import type {
  AdjustResult,
  DisruptionResult,
  LoadSettingResult,
  PlanAction,
  PlanAdjustment,
  PlanDiff,
  PlanGuardView,
  PlanPreview,
  PlanRevisionView,
  PlanSession,
  RunMinutes,
  UndoReason,
  UndoResult,
} from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { PlanSession as PlanSessionRow, PlanWeek as PlanWeekRow } from '../db.ts'
import { conflict, HttpError } from '../errors.ts'
import { parsePlanOptions, toPlanSession } from '../serialize.ts'
import { applyAdjust, planAdjust, StaleAdjust, type PlannedAdjust } from './adjust.ts'
import {
  isDisruptionAction,
  planWindowAction,
  viewDisruption,
  windowRunner,
  type DisruptionAction,
  type WindowPlanned,
} from './disruptions.ts'
import { failedChecklist, ownedSession, WRITE_TIMEOUT_MS } from './planEngine.ts'
import {
  applyReplan,
  computeReplan,
  headRevisionOf,
  recordPlanWrite,
  StaleWrite,
  type ReplanResult,
} from './replan.ts'
import {
  indexRows,
  optionsWithSetting,
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
  /** The running time of the next 28 days before and after the diff; null where it is not stated. */
  runMin: RunMinutes | null
  warnings: EngineWarning[]
  /** Why a commit would be refused; empty when it would go through. */
  reasons: UndoReason[]
  /** The guards of an adjust action, the ones that refuse it first; empty for the others. */
  guards: PlanGuardView[]
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
export interface ComputedAdjust extends ComputedBase {
  action: { type: 'adjust'; sessionId: string; adjustment: PlanAdjustment }
  work: { type: 'adjust'; planned: PlannedAdjust }
}
export interface ComputedDisruption extends ComputedBase {
  action: DisruptionAction
  work: { type: 'disruption'; planned: WindowPlanned }
}
export type ComputedAction = ComputedReplan | ComputedUndo | ComputedAdjust | ComputedDisruption

/** True when a guard refuses the action. */
const blocks = (guards: readonly PlanGuardView[]): boolean =>
  guards.some((guard) => guard.effect === 'blocks')

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
  args: {
    userId: string
    action: { type: 'adjust'; sessionId: string; adjustment: PlanAdjustment }
    today: string
  },
): Promise<ComputedAdjust>
export async function computeAction(
  deps: Deps,
  args: { userId: string; action: DisruptionAction; today: string },
): Promise<ComputedDisruption>
export async function computeAction(
  deps: Deps,
  args: { userId: string; action: PlanAction; today: string },
): Promise<ComputedAction>
export async function computeAction(
  deps: Deps,
  args: { userId: string; action: PlanAction; today: string },
): Promise<ComputedAction> {
  const { userId, today, action } = args
  if (action.type === 'adjust') {
    // 404 for a session that is not the user's. The newest revision is read before the plan
    // around the session, as for a re-plan.
    const { plan: _plan, ...row } = await ownedSession(deps, userId, action.sessionId)
    const headRevisionId = await headRevisionOf(deps.prisma, row.planId)
    const planned = await planAdjust(deps, { userId, row, adjustment: action.adjustment, today })
    const refusal = planned.check.guards.find((guard) => guard.effect === 'blocks')
    return {
      action,
      userId,
      planId: planned.planId,
      today,
      headRevisionId,
      // A refusal says why; an edit that changes nothing says so.
      summary:
        refusal?.message ?? (planned.check.noop ? changesSummary(0, 0) : planned.check.summary),
      diff: planned.diff,
      runMin: null,
      warnings: [],
      reasons: [],
      guards: planned.check.guards,
      hash: previewHash({ diff: planned.diff, headRevisionId, today }),
      work: { type: 'adjust', planned },
    }
  }
  if (action.type === 'replan') {
    // The newest revision is read first (`computeReplan` does): a revision that lands during the
    // compute makes the commit's hash differ, never silently match.
    const result = await computeReplan(deps, { userId, reason: 'owner', today })
    const { headRevisionId } = result
    const blocked = failedChecklist(result.draft.checklist)
    return {
      action,
      userId,
      planId: result.planId,
      today,
      headRevisionId,
      summary: result.summary,
      diff: result.diff,
      runMin: result.runMin,
      warnings: result.draft.warnings,
      reasons: blocked ? [{ code: 'checklist', message: blocked.message }] : [],
      guards: [],
      hash: previewHash({ diff: result.diff, headRevisionId, today }),
      work: { type: 'replan', result },
    }
  }
  if (isDisruptionAction(action)) {
    const planned = await planWindowAction(deps, { userId, action, today })
    const { result } = planned
    const blocked = failedChecklist(result.draft.checklist)
    return {
      action,
      userId,
      planId: planned.planId,
      today,
      headRevisionId: result.headRevisionId,
      summary: result.summary,
      diff: result.diff,
      runMin: result.runMin,
      warnings: result.draft.warnings,
      reasons: blocked ? [{ code: 'checklist', message: blocked.message }] : [],
      guards: [],
      hash: previewHash({ diff: result.diff, headRevisionId: result.headRevisionId, today }),
      work: { type: 'disruption', planned },
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
    runMin: null,
    warnings: plan.warnings,
    reasons: plan.reasons,
    guards: [],
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
    runMin: computed.runMin,
    summary: computed.summary,
    warnings: computed.warnings,
    blocked: computed.reasons.length > 0 || blocks(computed.guards),
    guards: computed.guards,
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
  let written: PlanRevisionView
  try {
    written = await applyReplan(deps, computed.work.result, { checkHead: true })
  } catch (error) {
    if (!(error instanceof StaleWrite)) throw error
    throw stalePreview(
      await computeAction(deps, {
        userId: args.userId,
        action: computed.action,
        today: args.today,
      }),
    )
  }
  return viewRevision(deps, { userId: args.userId, revisionId: written.id })
}

/**
 * Changes the load setting of the active plan and draws the weeks ahead again with it, as one
 * revision whose undo puts the old position back (task L4b). The newest revision is read first and
 * the write refuses (`StaleWrite`) when another has landed since; the change is then decided once
 * more, and a second collision is a 409. A plan that already holds the position writes nothing and
 * answers with no revision. 404 without an active plan, 422 with the checklist when the plan the
 * setting gives does not pass it (nothing is written).
 */
export async function commitLoadSetting(
  deps: Deps,
  args: { userId: string; loadAppetite: LoadAppetite; today: string },
): Promise<LoadSettingResult> {
  const { userId, loadAppetite, today } = args
  const plan = await deps.prisma.plan.findFirst({
    where: { userId, status: 'active' },
    orderBy: { createdAt: 'desc' },
    select: { options: true },
  })
  // Absent options read as steady, so a plan that stores none already holds Steady.
  if (plan !== null && (parsePlanOptions(plan.options).loadAppetite ?? 'steady') === loadAppetite) {
    return { loadAppetite, revision: null }
  }
  for (let attempt = 1; ; attempt += 1) {
    const result = await computeReplan(deps, { userId, reason: 'owner', today, loadAppetite })
    try {
      const written = await applyReplan(deps, result, { checkHead: true })
      return {
        loadAppetite,
        revision: await viewRevision(deps, { userId, revisionId: written.id }),
      }
    } catch (error) {
      if (!(error instanceof StaleWrite)) throw error
      if (attempt >= 2) throw conflict(stalePreviewMessage())
    }
  }
}

/**
 * Creates, changes or removes a rest window: the window row, the past sessions it skips and the
 * re-plan it causes are one transaction and one revision with `disruptionId`. 409 `stale-preview`
 * when `expectHash` no longer matches or the plan or the window moved while it was written; 422
 * with the checklist when the plan the window leaves does not pass it; nothing is written then.
 */
export async function commitDisruption(
  deps: Deps,
  args: { userId: string; action: DisruptionAction; today: string; expectHash?: string },
): Promise<DisruptionResult> {
  const { userId, action, today } = args
  const computed = await computeAction(deps, { userId, action, today })
  assertCurrent(computed, args.expectHash)
  const { planned } = computed.work
  let written: PlanRevisionView
  try {
    written = await applyReplan(deps, planned.result, {
      window: windowRunner(planned.step),
      checkHead: true,
    })
  } catch (error) {
    if (!(error instanceof StaleWrite)) throw error
    throw stalePreview(await computeAction(deps, { userId, action, today }))
  }
  const revision = await viewRevision(deps, { userId, revisionId: written.id })
  const disruption = await viewDisruption(deps, {
    userId,
    id: revision.disruptionId!,
    today,
  })
  return { disruption, revision }
}

/** The answer of the adjust route: the preview's guards and diff, and the session and revision. */
function adjustResult(
  computed: ComputedAdjust,
  written: { revision: PlanRevisionView | null; session: PlanSession },
): AdjustResult {
  return {
    allowed: !blocks(computed.guards),
    guards: computed.guards,
    diff: computed.diff,
    session: written.session,
    revision: written.revision,
    hash: computed.hash,
  }
}

/**
 * What an owner edit of one session would do (`dryRun`), from the code that commits it: the guards,
 * the diff and the session as it would stand. A refusal is information (`allowed: false`), not an
 * error. Writes nothing.
 */
export async function previewAdjust(
  deps: Deps,
  args: { userId: string; sessionId: string; adjustment: PlanAdjustment; today: string },
): Promise<AdjustResult> {
  const computed = await computeAction(deps, {
    userId: args.userId,
    action: { type: 'adjust', sessionId: args.sessionId, adjustment: args.adjustment },
    today: args.today,
  })
  return adjustResult(computed, { revision: null, session: computed.work.planned.after })
}

/**
 * Applies an owner edit of one session and records it as a revision with a diff and an undo
 * payload. 409 with `details.guards` and the first guard's message when a guard refuses it; 409
 * `stale-preview` when `expectHash` no longer matches or the session changed meanwhile. An edit
 * that changes nothing writes nothing and answers with `revision: null`.
 */
export async function commitAdjust(
  deps: Deps,
  args: {
    userId: string
    sessionId: string
    adjustment: PlanAdjustment
    today: string
    expectHash?: string
  },
): Promise<AdjustResult> {
  const { userId, today } = args
  const action = { type: 'adjust', sessionId: args.sessionId, adjustment: args.adjustment } as const
  const computed = await computeAction(deps, { userId, action, today })
  assertCurrent(computed, args.expectHash)
  const { planned } = computed.work
  const refusal = computed.guards.find((guard) => guard.effect === 'blocks')
  if (refusal) throw conflict(refusal.message, { guards: computed.guards })
  if (planned.writes.length === 0) {
    return adjustResult(computed, { revision: null, session: planned.after })
  }
  let written: Awaited<ReturnType<typeof applyAdjust>>
  try {
    written = await applyAdjust(
      deps,
      planned,
      (diff) => canonicalJson(diff) === canonicalJson(computed.diff),
    )
  } catch (error) {
    if (!(error instanceof StaleAdjust)) throw error
    throw stalePreview(await computeAction(deps, { userId, action, today }))
  }
  const revision = await viewRevision(deps, { userId, revisionId: written.revision.id })
  return adjustResult(computed, { revision, session: toPlanSession(written.session) })
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
      const windowIds = [
        ...restore.payload.disruptions.created,
        ...restore.payload.disruptions.updated,
      ]
      const [sessionRows, weekRows, windowRows, planRow] = await Promise.all([
        tx.planSession.findMany({ where: { planId } }),
        tx.planWeek.findMany({ where: { planId } }),
        windowIds.length === 0
          ? Promise.resolve([])
          : tx.disruption.findMany({ where: { id: { in: windowIds.map((w) => w.id) }, userId } }),
        tx.plan.findUniqueOrThrow({ where: { id: planId }, select: { options: true } }),
      ])
      const scoped = scopeUndo(
        restore.payload,
        indexRows(sessionRows, weekRows, windowRows, new Map([[planId, planRow.options]])),
        { today: args.today, diff: null, planId },
      )
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

      // Windows: the one the revision created is withdrawn, the columns it changed come back.
      for (const { id, data } of writes.windows) {
        await tx.disruption.updateMany({ where: { id, userId }, data })
      }

      // The load setting goes back with the rows, from the options as they stand in this transaction.
      await tx.plan.update({
        where: { id: planId },
        data: {
          ...restore.plan,
          ...(scoped.payload.setting === undefined
            ? {}
            : {
                options: optionsWithSetting(planRow.options, scoped.payload.setting.loadAppetite),
              }),
        },
      })
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
        disruptionId: target.disruptionId,
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
