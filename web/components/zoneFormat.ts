import type { Boundary, ZoneProposal } from '../../shared/engine/types.ts'
import type { ZoneBoundaryKey } from '../../shared/domain/planInputs.ts'
import type { Units } from '../../shared/types.ts'
import { formatDuration, formatPace, milesToM } from '../../shared/units.ts'

/** How each zone boundary was found, in words. Mirrors the anchor hierarchy [rules C2]. */
export const BOUNDARY_SOURCE_LABELS: Record<Boundary['source'], string> = {
  tested: 'From a test',
  cs: 'From critical speed',
  dfa: 'From DFA alpha1',
  rpe: 'From perceived effort',
  'hrmax-observed': 'From the highest heart rate seen',
  'hrmax-age': 'Estimated from age',
  hrr: 'From heart rate reserve',
  profile: 'From the profile',
}

/**
 * How a boundary was found, in words, with the training note of rule A6: the one wording the zone
 * summary and the page that says what the plan can see both use.
 */
export function boundarySourceText(
  boundary: Pick<Boundary, 'source' | 'fromTraining' | 'windowWidened'>,
): string {
  const training =
    boundary.fromTraining === true
      ? boundary.windowWidened === true
        ? ' (from training, some older than three months)'
        : ' (from training)'
      : ''
  return `${BOUNDARY_SOURCE_LABELS[boundary.source]}${training}`
}

/** The names of the six zone boundaries, by their key in the zone set. */
export const ZONE_BOUNDARY_LABELS: Record<ZoneBoundaryKey, string> = {
  hrMax: 'Maximum heart rate',
  lt1Hr: 'Easy heart rate limit',
  lt2Hr: 'Threshold heart rate',
  csMps: 'Critical speed',
  lt1PaceSecPerKm: 'Easy pace limit',
  thresholdPaceSecPerKm: 'Threshold pace',
}

/** Pace from seconds per kilometre, in the runner's unit: `5:30 /km`. */
export function paceText(secPerKm: number, units: Units): string {
  return formatPace(secPerKm, 1000, units)
}

/** `5:50 to 5:10 /km` for a slow-to-fast range in seconds per kilometre. */
export function paceRangeText(range: [number, number], units: Units): string {
  const perUnit = units === 'mi' ? milesToM(1) / 1000 : 1
  const [slow, fast] = range
  const times = [slow, fast].map((sec) => formatDuration(Math.round(sec * perUnit)))
  return `${times.join(' to ')} /${units}`
}

/** Heart rate in beats per minute: `162 bpm`. */
export function bpmText(bpm: number): string {
  return `${String(Math.round(bpm))} bpm`
}

export function bpmRangeText(range: [number, number]): string {
  return `${String(Math.round(range[0]))} to ${String(Math.round(range[1]))} bpm`
}

/** A zone-proposal value as text. Critical speed arrives in m/s and is shown as a pace. */
export function proposalValueText(
  boundary: ZoneProposal['boundary'],
  value: number,
  units: Units,
): string {
  switch (boundary) {
    case 'cs':
      return paceText(1000 / value, units)
    case 'lt1Pace':
    case 'thresholdPace':
      return paceText(value, units)
    case 'lt1Hr':
    case 'hrMax':
      return bpmText(value)
  }
}

export const PROPOSAL_LABELS: Record<ZoneProposal['boundary'], string> = {
  cs: 'Critical speed',
  lt1Pace: 'Easy pace limit',
  thresholdPace: 'Threshold pace',
  lt1Hr: 'Easy heart rate limit',
  hrMax: 'Maximum heart rate',
}
