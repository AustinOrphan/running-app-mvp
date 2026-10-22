// Stub from the training-engine scaffold; Task E2 implements it.
import type { Activity, AthleteProfile, WeekRow } from '../types.ts'
import type { AthleteState, EngineInput } from './types.ts'

/** Athlete state from the input history [rules section a]. */
export function estimateState(_input: EngineInput): AthleteState {
  throw new Error('Task E2: estimateState is not implemented')
}

/** Pace at a fixed HR on steady flat runs, with its trend [rules A8]. */
export function efficiencyIndex(_activities: Activity[]): AthleteState['efficiency'] {
  throw new Error('Task E2: efficiencyIndex is not implemented')
}

/** Novice, returning, recreational or trained [rules A5]. */
export function experienceClass(_input: {
  profile: AthleteProfile
  weeks: WeekRow[]
  layoffDays: number
  yearsRunning: number | null
}): AthleteState['experience'] {
  throw new Error('Task E2: experienceClass is not implemented')
}
