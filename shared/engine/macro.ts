// Stub from the training-engine scaffold; Task E5 implements it.
import type { AthleteState, EngineInput, Feasibility, GoalModel, WeekDraft } from './types.ts'

/** Phases built backwards from race day, weekly targets, TID and blocks [rules e, h, k]. */
export function macroPlan(
  _input: EngineInput,
  _state: AthleteState,
  _goal: GoalModel,
  _feasibility: Feasibility,
): WeekDraft[] {
  throw new Error('Task E5: macroPlan is not implemented')
}
