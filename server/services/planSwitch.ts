// Changing which goal the plan follows, and getting an archived plan back (phase 3a design 5.4).
// "Make active" on a goal other than the plan's goal builds the plan for it, and the plan it
// replaces is archived, not deleted; `restoreArchivedPlan` is the way back. The engine decides the
// sessions: this module only chooses when to generate, archive or restore.
import {
  activateFollowsText,
  restoreBlockText,
  type RestoreBlock,
} from '../../shared/copy/goals.ts'
import { planRestoredSummary } from '../../shared/copy/revision.ts'
import type { EngineInput } from '../../shared/engine/types.ts'
import type {
  ActivateRequiresPlan,
  ArchivedPlanView,
  Goal,
  RestorePlanResult,
} from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { conflict, HttpError, notFound } from '../errors.ts'
import { toGoal } from '../serialize.ts'
import { generateEnginePlan } from './planEngine.ts'
import { recordPlanWrite, replanActivePlan } from './replan.ts'

/** How many archived plans `GET /api/plan/archived` lists. */
export const ARCHIVED_PLANS_LISTED = 5

/**
 * The engine options of a stored plan. They are the runner's preferences (recovery cycle, strength
 * sessions, intensity model), so a plan built for another goal keeps them. Text that is not an
 * object gives none.
 */
function storedOptions(text: string): EngineInput['options'] {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/**
 * Makes one goal the active goal, and returns it.
 *
 * - No version-2 plan, or the plan is already on this goal: only the flag moves.
 * - The plan follows another goal: 409 with `{ requires: 'replacePlan', planGoalId, planGoalName }`
 *   unless `replacePlan`, which builds the plan for this goal (the old plan is archived and its
 *   session ids are carried; the revision reads `goal-switch`). If the plan cannot be built, an
 *   error is thrown before anything is written, so the goals and the plan stay as they were.
 * - A finished or dropped goal is always refused.
 */
export async function activateGoal(
  deps: Deps,
  args: { userId: string; goalId: string; replacePlan: boolean; today: string },
): Promise<Goal> {
  const { prisma } = deps
  const { userId } = args
  const goal = await prisma.goal.findFirst({ where: { id: args.goalId, userId } })
  if (!goal) throw notFound('Goal not found.')
  if (goal.status === 'done' || goal.status === 'dropped') {
    throw conflict('A finished or dropped goal cannot be the active goal.')
  }

  const plan = await prisma.plan.findFirst({
    where: { userId, status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: { goal: { select: { name: true } } },
  })
  if (plan !== null && plan.generatorVersion >= 2 && plan.goalId !== goal.id) {
    if (!args.replacePlan) {
      const requires: ActivateRequiresPlan = {
        requires: 'replacePlan',
        planGoalId: plan.goalId,
        planGoalName: plan.goal.name,
      }
      throw conflict(activateFollowsText(plan.goal.name, goal.name), requires)
    }
    await generateEnginePlan(deps, {
      userId,
      goalId: goal.id,
      today: args.today,
      options: storedOptions(plan.options),
      reason: 'goal-switch',
    })
  } else {
    await prisma.$transaction(async (tx) => {
      await tx.goal.updateMany({ where: { userId }, data: { isActive: false } })
      await tx.goal.update({ where: { id: goal.id }, data: { isActive: true } })
    })
  }
  return toGoal(await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } }))
}

/** Why an archived plan cannot come back, or null when it can. */
function restoreBlock(
  plan: { generatorVersion: number },
  goal: { status: string; targetDate: string },
  today: string,
): RestoreBlock | null {
  if (goal.status === 'done' || goal.status === 'dropped') return 'goal-closed'
  if (goal.targetDate < today) return 'date-passed'
  if (plan.generatorVersion < 2) return 'old-plan'
  return null
}

/**
 * The newest archived plans (up to `ARCHIVED_PLANS_LISTED`) with whether each can be restored. A
 * plan is archived when a newer one replaces it, and nothing writes to it afterwards, so its
 * `updatedAt` is the day it was archived.
 */
export async function listArchivedPlans(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<ArchivedPlanView[]> {
  const rows = await deps.prisma.plan.findMany({
    where: { userId: args.userId, status: 'archived' },
    include: { goal: { select: { name: true, status: true, targetDate: true } } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: ARCHIVED_PLANS_LISTED,
  })
  return rows.map((row) => {
    const block = restoreBlock(row, row.goal, args.today)
    return {
      id: row.id,
      goalId: row.goalId,
      goalName: row.goal.name,
      raceWeekStart: row.raceWeekStart,
      archivedAt: row.updatedAt.toISOString(),
      restorable: block === null,
      reason: block === null ? null : restoreBlockText(block),
    }
  })
}

/**
 * Brings an archived plan back as the active plan. In one transaction the current plan is
 * archived, the restored plan and its goal are made active and an `owner` revision "Plan restored."
 * is written; the rows of the restored plan are not touched, so every id and `externalId` is kept.
 * Then the plan is re-planned once from today (sessions are paired by `pairSessions`, so the ids
 * stay). A re-plan that the quality checklist blocks leaves the plan restored as it was and says so
 * in `replanned: false` and `message`. A plan whose goal is finished or dropped, whose race date
 * has passed or that an older generator made is refused with 409.
 */
export async function restoreArchivedPlan(
  deps: Deps,
  args: { userId: string; planId: string; today: string },
): Promise<RestorePlanResult> {
  const { prisma } = deps
  const { userId, today } = args
  const plan = await prisma.plan.findFirst({
    where: { id: args.planId, userId },
    include: { goal: { select: { status: true, targetDate: true } } },
  })
  if (!plan) throw notFound('Plan not found.')
  if (plan.status === 'active') throw conflict(restoreBlockText('already-active'))
  const block = restoreBlock(plan, plan.goal, today)
  if (block !== null) throw conflict(restoreBlockText(block))

  await prisma.$transaction(async (tx) => {
    await tx.plan.updateMany({ where: { userId, status: 'active' }, data: { status: 'archived' } })
    await tx.plan.update({ where: { id: plan.id }, data: { status: 'active' } })
    // The restored plan's goal drives the countdown, so exactly that goal is active.
    await tx.goal.updateMany({ where: { userId }, data: { isActive: false } })
    await tx.goal.update({ where: { id: plan.goalId }, data: { isActive: true } })
    await recordPlanWrite(tx, {
      planId: plan.id,
      userId,
      reason: 'owner',
      summary: planRestoredSummary(),
      changes: [],
      diff: null,
      undo: null,
    })
  })

  const restored = { planId: plan.id, goalId: plan.goalId }
  try {
    await replanActivePlan(deps, { userId, reason: 'owner', today })
    return { ...restored, replanned: true, message: null }
  } catch (error) {
    // A plan that fails the checklist stays as it was archived; any other failure is a real error.
    if (error instanceof HttpError) return { ...restored, replanned: false, message: error.message }
    throw error
  }
}
