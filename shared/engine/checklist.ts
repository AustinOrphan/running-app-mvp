// Stub from the training-engine scaffold; Task E9 implements it.
import type { ChecklistResult, EngineInput, PlanDraft } from './types.ts'

/** The plan quality checklist run before publishing [rules G1]. */
export function runChecklist(_draft: PlanDraft, _input: EngineInput): ChecklistResult[] {
  throw new Error('Task E9: runChecklist is not implemented')
}
