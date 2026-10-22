// Stub from the training-engine scaffold; Task E5 implements it.
import type { SessionKind, SessionSpec, WeekDraft, ZoneKey, ZoneSet } from './types.ts'

export interface SessionTemplate {
  kind: SessionKind
  zone: ZoneKey
  purpose: string
  /** Rule ids that justify the session, resolved by explain.ts. */
  rules: string[]
  rpe: [number, number]
}

/** The library entry for a session kind [rules F, session library]. */
export function sessionLibrary(_kind: SessionKind): SessionTemplate {
  throw new Error('Task E5: sessionLibrary is not implemented')
}

/** A session for a week, not yet dated: structure, targets, purpose and rules. */
export function prescribe(
  _kind: SessionKind,
  _minutes: number,
  _zones: ZoneSet,
  _week: WeekDraft,
): SessionSpec {
  throw new Error('Task E5: prescribe is not implemented')
}
