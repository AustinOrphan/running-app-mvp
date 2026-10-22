// Stub from the training-engine scaffold; Task E10 implements it.
import type { EngineInput } from '../../shared/engine/types.ts'
import type { Deps } from '../app.ts'

/**
 * Gathers the engine input from the database: profile, 365 days of activities, 60 days of
 * wellness and check-ins, 16 weeks of reviews, the goal model inputs, the forecast and the race
 * climate (Open-Meteo archive climatology for the race date and location).
 */
export function gatherEngineInput(
  _deps: Deps,
  _args: { userId: string; goalId: string; today: string; options?: EngineInput['options'] },
): Promise<EngineInput> {
  return Promise.reject(new Error('Task E10: gatherEngineInput is not implemented'))
}
