// Stub from the data-foundation scaffold; Task D2 implements it.
import type { ActivityStreamData, HrHistogram, ParsedActivity } from '../../types.ts'

export interface ActivitySummary {
  movingSec: number | null
  hrHistogram: HrHistogram | null
  decouplingPct: number | null
  gapDistanceM: number | null
  stream: ActivityStreamData & { sampleSec: 10 }
}

/** Derived fields and the 10-second stream for a parsed activity. */
export function summarize(parsed: ParsedActivity): ActivitySummary {
  void parsed
  throw new Error('not implemented')
}

/** The runner's local calendar date and start time (`YYYY-MM-DD`, `HH:MM`). */
export function localDateTime(
  startUtc: string,
  utcOffsetMin: number | null,
  timezone: string,
): { date: string; startTime: string } {
  void startUtc
  void utcOffsetMin
  void timezone
  throw new Error('not implemented')
}
