// Session identity (phase 3a, spec 4.1). One definition of when a session in one list is the same
// session as one in another list, and of the id the publish channel gives a session. Nobody else
// pairs sessions: the re-plan write, a regenerate and the revision diff all call `pairSessions`.

/** What places a session in a plan. `order` is the session's position within its day. */
export interface SessionSlot {
  date: string
  kind: string
  order: number
}

export interface SessionPair<B, A> {
  before: B
  after: A
  /** Position of `before` in the list given to `pairSessions`. */
  beforeIndex: number
  /** Position of `after` in the list given to `pairSessions`. */
  afterIndex: number
}

export interface SessionPairing<B, A> {
  /** Sessions found in both lists, by (date, kind, occurrence). */
  paired: Array<SessionPair<B, A>>
  /** Sessions only in `before`: removed, or moved to another day or kind. */
  removed: B[]
  /** Sessions only in `after`: new, or arrived on another day or as another kind. */
  added: A[]
}

interface Group<B, A> {
  date: string
  kind: string
  before: Array<{ item: B; index: number }>
  after: Array<{ item: A; index: number }>
}

function byOrderThenIndex(
  a: { item: SessionSlot; index: number },
  b: { item: SessionSlot; index: number },
): number {
  return a.item.order - b.item.order || a.index - b.index
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Pairs two session lists by (date, kind, occurrence). Within one (date, kind) group both lists are
 * ordered by `order`, then by input index, and zipped; a group's surplus on either side is removed
 * or added. `order` only ranks the sessions of one group, because it shifts when a strength or
 * mobility session is added to a day: the run keeps its pair, as the new session is of another kind.
 * A session on another day or of another kind is never paired, so a change of day or kind is a
 * removal plus an addition (a "moved" line is presentation, never an identity rule).
 *
 * Each session appears in exactly one of `paired`, `removed` and `added`. Results come in
 * (date, kind, occurrence) order, so the input order does not change them unless two sessions of
 * one group share an `order`.
 */
export function pairSessions<B extends SessionSlot, A extends SessionSlot>(
  before: readonly B[],
  after: readonly A[],
): SessionPairing<B, A> {
  const groups = new Map<string, Group<B, A>>()
  const groupOf = (date: string, kind: string): Group<B, A> => {
    const key = JSON.stringify([date, kind])
    let group = groups.get(key)
    if (group === undefined) {
      group = { date, kind, before: [], after: [] }
      groups.set(key, group)
    }
    return group
  }
  before.forEach((item, index) => groupOf(item.date, item.kind).before.push({ item, index }))
  after.forEach((item, index) => groupOf(item.date, item.kind).after.push({ item, index }))

  const result: SessionPairing<B, A> = { paired: [], removed: [], added: [] }
  const ordered = [...groups.values()].sort(
    (a, b) => compareText(a.date, b.date) || compareText(a.kind, b.kind),
  )
  for (const group of ordered) {
    const left = [...group.before].sort(byOrderThenIndex)
    const right = [...group.after].sort(byOrderThenIndex)
    const shared = Math.min(left.length, right.length)
    for (let i = 0; i < shared; i += 1) {
      result.paired.push({
        before: left[i]!.item,
        after: right[i]!.item,
        beforeIndex: left[i]!.index,
        afterIndex: right[i]!.index,
      })
    }
    for (const entry of left.slice(shared)) result.removed.push(entry.item)
    for (const entry of right.slice(shared)) result.added.push(entry.item)
  }
  return result
}

/**
 * The `externalId` each session of `next` takes over from `previous`: the id of the session it is
 * paired with, or null when it has no counterpart and gets a fresh id. The result is aligned with
 * `next`, and every previous id is used at most once because pairing is one to one. The caller
 * chooses which previous sessions take part (a regenerate passes the archived plan's sessions
 * dated today or later).
 */
export function carryExternalIds<A extends SessionSlot>(
  previous: ReadonlyArray<SessionSlot & { externalId: string }>,
  next: readonly A[],
): Array<string | null> {
  const carried: Array<string | null> = next.map(() => null)
  for (const pair of pairSessions(previous, next).paired) {
    carried[pair.afterIndex] = pair.before.externalId
  }
  return carried
}

/**
 * The id of a session at the publish channel (intervals.icu event, FIT and calendar entry):
 * `rl-<userTag>-<externalId>`. `userTag` is the first 6 hex characters of the SHA-256 of the user
 * id, computed by the server (`server/services/publish.ts`) so that two installs writing to one
 * account cannot overwrite each other and `shared/` stays free of Node crypto. No part of the id is
 * derived from the date, the kind or the order.
 */
export function workoutExternalId(externalId: string, userTag: string): string {
  return `rl-${userTag}-${externalId}`
}
