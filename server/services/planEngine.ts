// Stub from the training-engine scaffold; Task E10 implements it.
import type { EngineInput } from '../../shared/engine/types.ts'
import type { PlanRevision, PlanRevisionReason, PlanWithSessions } from '../../shared/types.ts'
import type { Deps } from '../app.ts'

/** Runs `buildPlan`, the checklist, persists plan, weeks, sessions and a 'generate' revision. */
export function generateEnginePlan(
  _deps: Deps,
  _args: { userId: string; goalId: string; today: string; options?: EngineInput['options'] },
): Promise<PlanWithSessions> {
  return Promise.reject(new Error('Task E10: generateEnginePlan is not implemented'))
}

/** Re-plans the active plan from the updated state and writes a `PlanRevision`. */
export function replanActivePlan(
  _deps: Deps,
  _args: { userId: string; reason: PlanRevisionReason; today: string },
): Promise<PlanRevision> {
  return Promise.reject(new Error('Task E10: replanActivePlan is not implemented'))
}

/** The active plan with weeks, sessions, feasibility, warnings, checklist and zones. */
export function loadPlanWithSessions(
  _deps: Deps,
  _userId: string,
): Promise<PlanWithSessions | null> {
  return Promise.reject(new Error('Task E10: loadPlanWithSessions is not implemented'))
}
