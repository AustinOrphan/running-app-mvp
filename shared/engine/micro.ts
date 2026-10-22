// Stub from the training-engine scaffold; Task E6 implements it.
import type { AthleteProfile } from '../types.ts'
import type { AthleteState, SessionSpec, WeekDraft, ZoneSet } from './types.ts'

/** Week to days: availability, long-run day, quality sessions, spacing, strength [rules f, h3]. */
export function placeWeek(
  _week: WeekDraft,
  _ctx: {
    profile: AthleteProfile
    zones: ZoneSet
    state: AthleteState
    prevSessions: SessionSpec[]
  },
): SessionSpec[] {
  throw new Error('Task E6: placeWeek is not implemented')
}
