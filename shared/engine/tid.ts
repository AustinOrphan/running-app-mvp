// The intensity mix a set of sessions delivers, counted the one way [rules E4]: time in a zone, from
// the planned minutes. A step above zone 1 counts at its zone for its own time (work blocks and
// strides), and every other minute of a session (steps in zone 1 and any time the steps do not
// name) counts in zone 1. Pure and deterministic: no I/O, no clock, no randomness.
//
// Two readers share it so that what the Why drawer says and what the plan report measures are one
// count: `explainInputs.ts` (the E4 fact of a week) and `tests/unit/engine/plan-metrics.ts` (the
// realised distribution). The three-zone choices below are the report's own and are not stated by
// E4: strides count in zone 3, as the F2 cap counts them above zone 1, and race pace counts in
// zone 2 above 10 km (E4: "race pace moves into Z2") and in zone 3 at 5 and 10 km, where E4 says
// nothing.
import { RUN_KINDS } from './adjust.ts'
import type { GoalModel, SessionSpec, ZoneKey } from './types.ts'

/** The distance class of a goal, which decides where race-pace work counts. */
export type TidGoalClass = GoalModel['distanceClass']

/** Shares of the three intensity zones, in whatever unit the caller keeps (percent or minutes). */
export interface ZoneShares {
  z1: number
  z2: number
  z3: number
}

/**
 * Sessions that count toward a week's running minutes: the run kinds except a race (its minutes
 * are the race's, not training) and a hike.
 */
export function countsAsVolume(session: Pick<SessionSpec, 'kind'>): boolean {
  return RUN_KINDS.has(session.kind) && session.kind !== 'race' && session.kind !== 'hike'
}

/**
 * The zone of the three-zone distribution a step's time counts in. `strides` count in zone 3, as the
 * F2 cap counts them above zone 1. `race-pace` counts in zone 2 for goals above 10 km, where
 * "race pace moves into Z2" (E4); rule E4 says nothing of 5 and 10 km, so there it counts in zone 3,
 * a choice of this counting. Other zone keys (strength, rest) are no running time.
 */
export function tidZoneOf(zone: ZoneKey, goalClass: TidGoalClass): 1 | 2 | 3 | null {
  if (zone === 'z1') return 1
  if (zone === 'z2') return 2
  if (zone === 'z3' || zone === 'strides') return 3
  if (zone === 'race-pace') return goalClass === '5k' || goalClass === '10k' ? 3 : 2
  return null
}

/**
 * Minutes of a session in each zone: the time of every step above zone 1 in its zone, and the rest
 * of the session's minutes (steps in zone 1 and any time the steps do not name) in zone 1.
 */
export function zoneMinutes(
  session: Pick<SessionSpec, 'structure' | 'durationMin'>,
  goalClass: TidGoalClass,
): ZoneShares {
  let z2 = 0
  let z3 = 0
  for (const step of session.structure) {
    const zone = tidZoneOf(step.zone, goalClass)
    const minutes = ((step.durationSec ?? 0) * step.reps) / 60
    if (zone === 2) z2 += minutes
    else if (zone === 3) z3 += minutes
  }
  return { z1: Math.max(0, session.durationMin - z2 - z3), z2, z3 }
}

/** The minutes in each zone of the sessions that count toward running minutes (`countsAsVolume`). */
export function plannedZoneMinutes(
  sessions: readonly Pick<SessionSpec, 'kind' | 'structure' | 'durationMin'>[],
  goalClass: TidGoalClass,
): ZoneShares {
  const total: ZoneShares = { z1: 0, z2: 0, z3: 0 }
  for (const session of sessions) {
    if (!countsAsVolume(session)) continue
    const minutes = zoneMinutes(session, goalClass)
    total.z1 += minutes.z1
    total.z2 += minutes.z2
    total.z3 += minutes.z3
  }
  return total
}

/** Minutes as percent of their total; null when there are no minutes. */
export function percentOfMinutes(minutes: ZoneShares): ZoneShares | null {
  const total = minutes.z1 + minutes.z2 + minutes.z3
  if (!(total > 0)) return null
  return {
    z1: (minutes.z1 / total) * 100,
    z2: (minutes.z2 / total) * 100,
    z3: (minutes.z3 / total) * 100,
  }
}

/**
 * The shares of the sessions that count toward running minutes, in percent of their planned
 * minutes; null without any. The one function behind the E4 fact of the Why drawer and the plan
 * report's realised distribution.
 */
export function deliveredShares(
  sessions: readonly Pick<SessionSpec, 'kind' | 'structure' | 'durationMin'>[],
  goalClass: TidGoalClass,
): ZoneShares | null {
  return percentOfMinutes(plannedZoneMinutes(sessions, goalClass))
}

/**
 * Shares as whole percents that add up to 100 (largest remainder, the earlier zone on a tie), so a
 * sentence that says what a week holds never totals 99 or 101. The shares must add up to 100.
 */
export function wholePercents(shares: ZoneShares): ZoneShares {
  const raw = [shares.z1, shares.z2, shares.z3]
  const whole = raw.map((v) => Math.floor(v))
  const byRemainder = raw
    .map((v, i) => ({ i, remainder: v - whole[i]! }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i)
  let left = 100 - whole.reduce((sum, n) => sum + n, 0)
  for (const { i } of byRemainder) {
    if (left <= 0) break
    whole[i] = whole[i]! + 1
    left -= 1
  }
  return { z1: whole[0]!, z2: whole[1]!, z3: whole[2]! }
}
