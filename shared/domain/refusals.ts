/**
 * The activities the runner unlinked from a planned session (`PlanSession.refusedActivityIds`, a
 * JSON array of ids): the matcher never offers one of them to that session again.
 */

/**
 * The most ids one session remembers; the oldest is dropped past it. Bookkeeping, not an engine
 * value: a session is unlinked by hand a handful of times at most, and a bound keeps the column
 * small if a link and an unlink repeat.
 */
export const MAX_REFUSED = 20

/** The ids in a stored value; anything unreadable (null, bad JSON, a non-array) is none. */
export function parseRefusedIds(stored: string | null): string[] {
  if (stored === null || stored === '') return []
  try {
    const value: unknown = JSON.parse(stored)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

/** The stored value after `id` joins the set: no duplicates, newest last, at most `MAX_REFUSED`. */
export function withRefusal(stored: string | null, id: string): string {
  const ids = [...parseRefusedIds(stored).filter((known) => known !== id), id]
  return JSON.stringify(ids.slice(-MAX_REFUSED))
}
