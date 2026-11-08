import type { TrendRun } from '../../shared/domain/trendsRuns.ts'
import { gradeCurve } from '../../shared/engine/gradeCurve.ts'

/**
 * The speed of each terrain band relative to flat, as the runner's grade curve shows it on `today`
 * (rule I13): the personal ratio in a band where the leave-one-run-out test favours it, Minetti in
 * every other. The Trends drift panel divides the speed of a hilly run's bands by these (rules B2,
 * HQ1). It reads the terrain bins of the runs the panel loader already holds, so it adds no query;
 * the curve itself keeps the runs of the last `i13.windowWeeks` weeks.
 */
export function bandRatios(runs: readonly TrendRun[], today: string): number[] {
  const curve = gradeCurve(
    runs.map((run, index) => ({ id: String(index), date: run.date, bins: run.terrainBins })),
    today,
  )
  return curve.bands.map((band) => band.ratio)
}
