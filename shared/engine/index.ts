// Engine entry points. Pure and deterministic for a given input; `today` arrives in the input.
// Stub from the training-engine scaffold; Task E9 implements buildPlan and replan.
import type { EngineInput, PlanChange, PlanDraft } from './types.ts'

export { zoneProposals, weeklyDecision } from './adapt.ts'
export { assessExecution, matchSessions } from './execution.ts'
export { PARAMS_VERSION, P } from './params/index.ts'
export { predictRace } from './predict.ts'
export { todayAdvice } from './readiness.ts'

/** State, zones, goal, feasibility, macro, micro, guards, checklist and prediction. */
export function buildPlan(_input: EngineInput): PlanDraft {
  throw new Error('Task E9: buildPlan is not implemented')
}

/** Keeps the past and completed sessions, recomputes the future, lists the changes. */
export function replan(_input: EngineInput): { draft: PlanDraft; changes: PlanChange[] } {
  throw new Error('Task E9: replan is not implemented')
}
