// Stub from the training-engine scaffold; Task E8 implements it.
import type { TodayView } from '../types.ts'
import type { EngineInput, ReadinessSnapshot, SessionSpec } from './types.ts'

/** Check-in, HRV, resting HR, sleep, red flags and fatigue state for a date [rules J2-J4, J8, n]. */
export function readinessSnapshot(_input: EngineInput, _date: string): ReadinessSnapshot {
  throw new Error('Task E8: readinessSnapshot is not implemented')
}

/** Downgrade-only advice for today's sessions [rules J3]. */
export function todayAdvice(
  _input: EngineInput,
  _sessions: Array<SessionSpec & { id: string }>,
): TodayView['sessions'] {
  throw new Error('Task E8: todayAdvice is not implemented')
}
