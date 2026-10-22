// Stub from the training-engine scaffold; Task E2 implements it.
import type { Activity, AthleteProfile } from '../types.ts'
import type { AthleteState, ZoneSet } from './types.ts'

export interface LoadContext {
  profile: AthleteProfile
  zones: ZoneSet
}

export type LoadMetric = AthleteState['load']['metric']

/** sRPE primary, TRIMP only on qualified HR, never mixed [rules B1-B4]. */
export function sessionLoad(
  _activity: Activity,
  _ctx: LoadContext,
): { srpe: number | null; trimp: number | null; metric: LoadMetric; hrQualified: boolean } {
  throw new Error('Task E2: sessionLoad is not implemented')
}

export function dailyLoad(
  _activities: Activity[],
  _ctx: LoadContext,
  _metric: LoadMetric,
): Array<{ date: string; load: number }> {
  throw new Error('Task E2: dailyLoad is not implemented')
}

/** Exponentially weighted moving average of a daily series, as of its last date [rules A2]. */
export function ewma(_series: Array<{ date: string; load: number }>, _days: number): number {
  throw new Error('Task E2: ewma is not implemented')
}

/** Linear distance-time fit over at least 3 efforts of 400-5000 m [rules A6]. */
export function criticalSpeed(
  _efforts: Array<{ distanceM: number; timeSec: number }>,
): { csMps: number; dPrimeM: number } | null {
  throw new Error('Task E2: criticalSpeed is not implemented')
}
