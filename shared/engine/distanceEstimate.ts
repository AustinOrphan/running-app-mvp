// The distance estimate beside a session's minutes (STATUS follow-up 17). The plan's currency stays
// minutes (ADR 0003) and nothing is scored against distance: this is a figure to picture the run
// by, derived on the server from the zones as they are now and carried in the payloads, never
// stored and never recomputed in the browser. Pure: zones arrive as an argument.
//
// Two bases, worded apart in `shared/copy/distanceEstimate.ts`:
// - `pace`: a session with a pace target of its own (a threshold session, intervals, race-pace
//   blocks) covers its work minutes at the middle of that pace band; the minutes around the work
//   (warm-up, cool-down, recoveries) are easy running.
// - `easy`: a run led by heart rate or effort covers its minutes at the runner's easy pace, the
//   middle of the Z1 pace range of the zones (the same pace the engine turns minutes into distance
//   with when it builds a plan, `distanceFor` in `sessions.ts`). That range's slow edge is the
//   grade D `c2.z1PaceSlowFactor`; the estimate adds no number of its own.
//
// No estimate (null) for a session that is not a run (a hike, strength, mobility, cross-training,
// rest), for the race (its distance is the goal's), for a run-walk session (its minutes mix
// walking and running, so no single pace fits), and for a runner with no pace data: a missing pace
// is never replaced by a guess.
import { RUN_KINDS } from './sessions.ts'
import { resolveTargets } from './targets.ts'
import type { DistanceEstimate, SessionSpec, ZoneSet } from './types.ts'

const SEC_PER_MIN = 60
const M_PER_KM = 1000

/** The part of a session the estimate reads. */
export type EstimateSource = Pick<
  SessionSpec,
  'kind' | 'durationMin' | 'structure' | 'target' | 'flags'
>

/** The part of a planned session a week's estimate reads. */
export interface WeekEstimateSource {
  kind: SessionSpec['kind']
  durationMin: number
  status: string
  distanceEstimate: DistanceEstimate | null
}

const middle = (range: readonly [number, number]): number => (range[0] + range[1]) / 2

/** The runner's easy pace in seconds per km: the middle of the Z1 pace range; null without one. */
export function easyPaceSecPerKm(zones: ZoneSet | null): number | null {
  const z1 = zones?.pace?.z1 ?? null
  return z1 !== null && middle(z1) > 0 ? middle(z1) : null
}

/** Seconds of the steps of the work kind, at most the session's own seconds; zero without steps. */
function workSeconds(session: EstimateSource, totalSec: number): number {
  let sec = 0
  for (const step of session.structure) {
    if (step.kind === 'work' && step.durationSec !== null) sec += step.reps * step.durationSec
  }
  return Math.min(sec, totalSec)
}

/**
 * The distance a run covers in its planned minutes, or null when none can be said. Reads the
 * targets as `resolveTargets` resolves them on a day that is not hot, so heat (which makes effort
 * lead) does not change the figure: it is the same on every day the session could be run.
 */
export function estimateDistance(
  session: EstimateSource,
  zones: ZoneSet | null,
): DistanceEstimate | null {
  if (!RUN_KINDS.has(session.kind) || !(session.durationMin > 0)) return null
  if (session.flags.includes('run-walk')) return null
  // The estimate decorates every session of the plan on the way to a screen, so a stored target
  // that cannot be read costs that session its estimate and nothing more.
  if (!Array.isArray(session.target?.rpe)) return null

  const easy = easyPaceSecPerKm(zones)
  const targets = resolveTargets(session, zones, { hot: false })
  const totalSec = session.durationMin * SEC_PER_MIN

  let meters: number
  let basis: DistanceEstimate['basis']
  if (targets.mode === 'pace' && targets.paceSecPerKm !== null) {
    const pace = middle(targets.paceSecPerKm)
    if (!(pace > 0)) return null
    // A session with no steps (too short to hold them) is run wholly at its pace.
    const workSec = session.structure.length === 0 ? totalSec : workSeconds(session, totalSec)
    const easySec = totalSec - workSec
    // The minutes around the work are easy running, and need the easy pace to be counted.
    if (easySec > 0 && easy === null) return null
    meters = (workSec / pace) * M_PER_KM + (easy === null ? 0 : (easySec / easy) * M_PER_KM)
    basis = 'pace'
  } else {
    if (easy === null) return null
    meters = (totalSec / easy) * M_PER_KM
    basis = 'easy'
  }
  const distanceM = Math.round(meters)
  return distanceM > 0 ? { distanceM, basis } : null
}

/** A session with its estimate attached, as a screen is served it. */
export function withDistanceEstimate<S extends EstimateSource>(
  session: S,
  zones: ZoneSet | null,
): S & { distanceEstimate: DistanceEstimate | null } {
  return { ...session, distanceEstimate: estimateDistance(session, zones) }
}

/**
 * The distance of a week's runs: the sum of the estimates of the sessions that are still part of
 * the plan (a skipped session is not). Null when no session has one, and null when a run of the
 * week has none (the race, a run-walk session, a runner with no pace data), because a partial sum
 * would read as the whole week. Sessions that are not runs, and runs of no minutes, add nothing.
 */
export function weekDistanceEstimateM(sessions: readonly WeekEstimateSource[]): number | null {
  let total = 0
  let counted = false
  for (const session of sessions) {
    if (session.status === 'skipped' || !(session.durationMin > 0)) continue
    if (!RUN_KINDS.has(session.kind) && session.kind !== 'race') continue
    if (session.distanceEstimate === null) return null
    total += session.distanceEstimate.distanceM
    counted = true
  }
  return counted ? total : null
}
