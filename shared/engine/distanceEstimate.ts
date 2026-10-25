// The distance estimate beside a session's minutes (STATUS follow-up 17). The plan's currency stays
// minutes (ADR 0003) and nothing is scored against distance: this is a figure to picture the run
// by, derived on the server from the paces the runner has now and carried in the payloads, never
// stored and never recomputed in the browser. Pure: the paces arrive as an argument.
//
// Where the easy pace comes from, in order:
// 1. the zones: the middle of the Z1 pace range (the same pace the engine turns minutes into
//    distance with when it builds a plan, `distanceFor` in `sessions.ts`). That range's slow edge
//    is the grade D `c2.z1PaceSlowFactor`.
// 2. the runner's recent logged runs (`recentPaceSecPerKm`), when the zones hold no pace, which is
//    a runner with no tested threshold pace and too little critical-speed data.
// 3. none: a missing pace is never replaced by a guess.
//
// Three bases, worded apart in `shared/copy/distanceEstimate.ts`:
// - `pace`: a session with a pace target of its own (a threshold session, intervals, race-pace
//   blocks) covers its work minutes at the middle of that pace band; the minutes around the work
//   (warm-up, cool-down, recoveries) are easy running.
// - `easy`: a run led by heart rate or effort covers its minutes at the easy pace of the zones.
// - `recent`: the same run, at the recent logged pace, because the zones hold none.
//
// No estimate (null) for a session that is not a run (a hike, strength, mobility, cross-training,
// rest), for the race (its distance is the goal's), and for a run-walk session (its minutes mix
// walking and running, so no single pace fits).
import { isDuplicate } from './load.ts'
import { median, recentWeeklyPace } from './goal.ts'
import { P } from './params/index.ts'
import { RUN_KINDS } from './sessions.ts'
import { resolveTargets } from './targets.ts'
import type { Activity } from '../types.ts'
import type { AthleteState, DistanceEstimate, SessionSpec, ZoneSet } from './types.ts'

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

/** The paces an estimate is worked out from: the zones, and the recent logged pace behind them. */
export interface EstimatePaces {
  zones: ZoneSet | null
  /** `recentPaceSecPerKm`; null when the runner has no logged run with a distance in the window. */
  recentPaceSecPerKm: number | null
}

const middle = (range: readonly [number, number]): number => (range[0] + range[1]) / 2

/** The runner's easy pace in seconds per km: the middle of the Z1 pace range; null without one. */
export function easyPaceSecPerKm(zones: ZoneSet | null): number | null {
  const z1 = zones?.pace?.z1 ?? null
  return z1 !== null && middle(z1) > 0 ? middle(z1) : null
}

/** The easy pace and where it came from: the zones first, then the recent logged runs. */
function easyPace(paces: EstimatePaces): { secPerKm: number; from: 'zones' | 'recent' } | null {
  const fromZones = easyPaceSecPerKm(paces.zones)
  if (fromZones !== null) return { secPerKm: fromZones, from: 'zones' }
  const recent = paces.recentPaceSecPerKm
  return recent !== null && recent > 0 ? { secPerKm: recent, from: 'recent' } : null
}

/**
 * The runner's recent pace in sec/km, for when the zones hold none; null when nothing logged can
 * say. It reads the same weeks as `trainingPace` (`macroDesign.trainingPaceWeeks`), and prefers the
 * easy runs among them: logged runs (not races, not flagged duplicates, with a distance) of at least
 * the shortest session the engine plans (`restartFloor.sessionMin`). Hard sessions are left out:
 * a run whose average heart rate is above the easy limit (the top of Z1) when the zones hold one,
 * and, among the runs with no heart rate to judge by, the fastest `macroDesign.recentPaceFastestShare`.
 * With at least `macroDesign.recentPaceMinRuns` runs left, the median of their paces; with fewer,
 * the median of the weekly paces of the window, as `trainingPace` takes it (`recentWeeklyPace`).
 */
export function recentPaceSecPerKm(args: {
  activities: readonly Activity[]
  state: Pick<AthleteState, 'weeks'>
  zones: ZoneSet | null
}): number | null {
  const window = args.state.weeks.slice(-P.macroDesign.trainingPaceWeeks.value)
  const from = window[0]?.weekStart
  if (from !== undefined) {
    const minSec = P.restartFloor.sessionMin.value * SEC_PER_MIN
    const ceiling = args.zones?.lt1Hr?.value ?? null
    const runs = args.activities
      .filter(
        (a) =>
          a.type === 'run' &&
          !isDuplicate(a) &&
          a.date >= from &&
          a.durationSec >= minSec &&
          (a.distanceM ?? 0) > 0,
      )
      .map((a) => ({ secPerKm: a.durationSec / ((a.distanceM ?? 0) / M_PER_KM), avgHr: a.avgHr }))
    // Heart rate judges the runs that have one, when there is a limit to judge by.
    const judged = (run: { avgHr: number | null }) => ceiling !== null && run.avgHr !== null
    const easyByHr = runs.filter((run) => judged(run) && run.avgHr! <= ceiling!)
    const unjudged = runs.filter((run) => !judged(run)).sort((a, b) => a.secPerKm - b.secPerKm)
    const keptUnjudged = unjudged.slice(
      Math.floor(unjudged.length * P.macroDesign.recentPaceFastestShare.value),
    )
    const easy = [...easyByHr, ...keptUnjudged]
    if (easy.length >= P.macroDesign.recentPaceMinRuns.value) {
      return median(easy.map((run) => run.secPerKm))
    }
  }
  return recentWeeklyPace(args.state)
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
  paces: EstimatePaces,
): DistanceEstimate | null {
  if (!RUN_KINDS.has(session.kind) || !(session.durationMin > 0)) return null
  if (session.flags.includes('run-walk')) return null
  // The estimate decorates every session of the plan on the way to a screen, so a stored target
  // that cannot be read costs that session its estimate and nothing more.
  if (!Array.isArray(session.target?.rpe)) return null

  const easy = easyPace(paces)
  const targets = resolveTargets(session, paces.zones, { hot: false })
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
    meters =
      (workSec / pace) * M_PER_KM + (easy === null ? 0 : (easySec / easy.secPerKm) * M_PER_KM)
    basis = 'pace'
  } else {
    if (easy === null) return null
    meters = (totalSec / easy.secPerKm) * M_PER_KM
    basis = easy.from === 'zones' ? 'easy' : 'recent'
  }
  const distanceM = Math.round(meters)
  return distanceM > 0 ? { distanceM, basis } : null
}

/** A session with its estimate attached, as a screen is served it. */
export function withDistanceEstimate<S extends EstimateSource>(
  session: S,
  paces: EstimatePaces,
): S & { distanceEstimate: DistanceEstimate | null } {
  return { ...session, distanceEstimate: estimateDistance(session, paces) }
}

/**
 * The distance of a week's runs: the sum of the estimates of the sessions that are still part of
 * the plan (a skipped session is not). Null when no session has one, and null when a run of the
 * week has none (the race, a run-walk session, a runner with no pace data), because a partial sum
 * would read as the whole week. Sessions that are not runs, and runs of no minutes, add nothing.
 * The sum takes each session's estimate as it is, so a week follows the paces its sessions did.
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
