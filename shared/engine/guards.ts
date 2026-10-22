// Stub from the training-engine scaffold; Task E6 implements it.
import type { Activity } from '../types.ts'
import type { AthleteState, EngineWarning, SessionSpec } from './types.ts'

/** Session spike guard, weekly ramp, tightened profiles and ultra caps [rules g, h2-h4]. */
export function applyGuards(
  _sessions: SessionSpec[],
  _state: AthleteState,
  _history: Activity[],
): { sessions: SessionSpec[]; warnings: EngineWarning[] } {
  throw new Error('Task E6: applyGuards is not implemented')
}

/** min(planned target, actual last week x (1 + ramp)); missed volume is never made up [rules G-6]. */
export function nextWeekCap(
  _plannedMin: number,
  _actualLastWeekMin: number,
  _ramp: number,
): number {
  throw new Error('Task E6: nextWeekCap is not implemented')
}
