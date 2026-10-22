// Stub from the training-engine scaffold; Task E7 implements it.
import type { Activity } from '../types.ts'
import type { AthleteState, ExecutionAssessment, SessionSpec, ZoneSet } from './types.ts'

/** Links unlinked activities to unlinked planned sessions; owner links are never touched. */
export function matchSessions(
  _sessions: Array<
    SessionSpec & { id: string; activityId: string | null; linkSource: string | null }
  >,
  _activities: Activity[],
): Array<{ sessionId: string; activityId: string }> {
  throw new Error('Task E7: matchSessions is not implemented')
}

/** Completion, intensity and effort of an activity against the session it fulfils. */
export function assessExecution(
  _session: SessionSpec,
  _activity: Activity,
  _ctx: { zones: ZoneSet; state: AthleteState },
): ExecutionAssessment {
  throw new Error('Task E7: assessExecution is not implemented')
}
