// Stub from the training-engine scaffold; Task E8 implements it.
import type { EngineInput, SessionSpec, WeeklyDecision, ZoneProposal } from './types.ts'

/** Progress, hold or reduce from execution, check-ins, efficiency, sleep and HRV [rules J5, G-6]. */
export function weeklyDecision(_input: EngineInput, _weekStart: string): WeeklyDecision {
  throw new Error('Task E8: weeklyDecision is not implemented')
}

/** Proposed zone updates after three concordant observations [rules C8]. */
export function zoneProposals(_input: EngineInput): ZoneProposal[] {
  throw new Error('Task E8: zoneProposals is not implemented')
}

/** Restart volume after a break of 7 days or more [rules J7]. */
export function breakRestart(
  _layoffDays: number,
  _preBreakWeekMin: number,
  _consistentMonthsBefore?: number,
): { restartMin: number; fraction: number; runWalk: boolean } {
  throw new Error('Task E8: breakRestart is not implemented')
}

/** Fewer reps or a shorter session after a harder-than-expected quality session [design 4.3]. */
export function trimQuality(_session: SessionSpec, _reason: string): SessionSpec {
  throw new Error('Task E8: trimQuality is not implemented')
}
