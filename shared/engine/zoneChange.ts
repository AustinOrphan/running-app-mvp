// How the owner's decision on a zone proposal is stored in the revision log [rules C8, ADR 0007].
// A decision is a `PlanChange` of the revision, so readers identify it by data and never by the
// summary text: `zones.<boundary>` when the proposal was accepted and
// `zones.<boundary>.declined` when it was declined, with the proposed values in `from` and `to`.
// Pure and light: the server and the web both import it.
import type { PlanChange, ZoneProposal } from './types.ts'

export type ZoneBoundary = ZoneProposal['boundary']
export type ZoneOutcome = 'accepted' | 'declined'

const BOUNDARIES: Record<ZoneBoundary, true> = {
  cs: true,
  lt1Pace: true,
  thresholdPace: true,
  lt1Hr: true,
  hrMax: true,
}

const FIELD = /^zones\.(\w+)(\.declined)?$/

/**
 * The text every zone change contains once stored as JSON (`JSON.stringify` writes no spaces), so a
 * query can leave the other revisions out before the changes are read.
 */
export const ZONE_CHANGE_MARK = '"field":"zones.'

/** The `PlanChange.field` for a decided proposal of a boundary. */
export function zoneChangeField(boundary: ZoneBoundary, outcome: ZoneOutcome): string {
  return outcome === 'accepted' ? `zones.${boundary}` : `zones.${boundary}.declined`
}

/** The boundary and outcome a change field names; null for any other field. */
export function zoneChangeOf(
  field: string,
): { boundary: ZoneBoundary; outcome: ZoneOutcome } | null {
  const match = FIELD.exec(field)
  const boundary = match?.[1]
  if (boundary === undefined || !Object.hasOwn(BOUNDARIES, boundary)) return null
  return {
    boundary: boundary as ZoneBoundary,
    outcome: match?.[2] === undefined ? 'accepted' : 'declined',
  }
}

/** The zone decisions among the changes of a stored revision, in the order they were written. */
export function zoneDecisionsOf(
  changesJson: string,
): Array<{ boundary: ZoneBoundary; outcome: ZoneOutcome; change: PlanChange }> {
  const decisions: Array<{ boundary: ZoneBoundary; outcome: ZoneOutcome; change: PlanChange }> = []
  for (const change of JSON.parse(changesJson) as PlanChange[]) {
    const zone = zoneChangeOf(change.field)
    if (zone !== null) decisions.push({ ...zone, change })
  }
  return decisions
}
