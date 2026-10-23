// The one answer to "which goal is the runner working towards" (phase 3a design, 4.3). The state
// view, Today's race block, the prediction job and every other "which goal" lookup call it.
import type { Goal } from '../../shared/types.ts'
import type { PrismaClient } from '../db.ts'
import { toGoal } from '../serialize.ts'

/**
 * The goal of the active plan, else the goal marked active, else null. A plan decides because it
 * is what the runner is following; the `isActive` flag covers a goal that has no plan yet. If more
 * than one goal is marked active, the one written last wins. Both rows are read together, so the
 * snapshot build stays one round.
 */
export async function currentGoalFor(
  db: Pick<PrismaClient, 'plan' | 'goal'>,
  userId: string,
): Promise<Goal | null> {
  const [plan, active] = await Promise.all([
    db.plan.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: { goal: true },
    }),
    db.goal.findFirst({
      where: { userId, isActive: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    }),
  ])
  if (plan) return toGoal(plan.goal)
  return active ? toGoal(active) : null
}
