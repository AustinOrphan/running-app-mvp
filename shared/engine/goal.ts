// Stub from the training-engine scaffold; Task E4 implements it.
import type { Goal } from '../types.ts'
import type { AthleteState, Feasibility, GoalModel } from './types.ts'

/** Goal descriptors, distance class, expected duration and darkness [rules section d]. */
export function goalModel(
  _goal: Goal,
  _state: AthleteState,
  _climate: { wbgtC: number; source: 'forecast' | 'climatology' } | null,
): GoalModel {
  throw new Error('Task E4: goalModel is not implemented')
}

/** comfortable, tight or not reachable within default limits; never refuses [rules D3-D5]. */
export function feasibility(_goal: GoalModel, _state: AthleteState, _today: string): Feasibility {
  throw new Error('Task E4: feasibility is not implemented')
}
