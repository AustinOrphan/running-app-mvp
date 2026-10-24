// What the Done button logs for a session of each kind: the activity type, and the sub-type the
// matcher needs to link the entry to the session. The server links a manual entry to a planned
// session by `compatible` (`shared/engine/execution.ts`), so the two must agree for every kind; a
// unit test runs each kind through both, and an API test posts the entry and reads the link.
import type { SessionKind } from '../engine/types.ts'
import type { ActivityType } from '../types.ts'

export interface DoneEntry {
  type: ActivityType
  /** Only where the matcher reads it: a hike session takes a cross-training entry of sub-type `hike`. */
  subtype?: 'hike'
}

/**
 * The entry a session of this kind is logged as: the type the server links to it (a run, a race, a
 * strength session) or, for a hike, a walk or mobility work, a cross-training entry. A hike entry
 * says `hike`, because a cross-training entry with no sub-type fulfils no hike session.
 */
export function doneEntryFor(kind: SessionKind): DoneEntry {
  switch (kind) {
    case 'race':
      return { type: 'race' }
    case 'strength':
      return { type: 'strength' }
    case 'hike':
      return { type: 'cross', subtype: 'hike' }
    case 'mobility':
    case 'cross':
      return { type: 'cross' }
    default:
      return { type: 'run' }
  }
}
