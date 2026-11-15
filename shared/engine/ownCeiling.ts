// The runner's own easy ceiling (rules C4, C8, A8; owner decision D4, 2026-11-14): the top of Z1, the
// first-threshold heart rate, read from the runner's heart-rate-at-pace line at the pace of the
// first threshold and offered in both directions through the zone-proposal flow of C8. Pure and
// deterministic; it never applies anything. A proposal moves a boundary only when the owner accepts it.
import { coolRunPoints, fitLine, type HrFitRun } from './execution.ts'
import { P } from './params/index.ts'
import type { OwnCeilingEvidence, OwnCeilingRun, ZoneProposal, ZoneSet } from './types.ts'

/**
 * One estimate of the first-threshold heart rate: the line through `points` read at `lt1SpeedMps`.
 * Null when the line does not speak there: flatter than `c9.lineMinSlopeBpmPerMps`, or the speed
 * lies outside the fitted speeds widened by `c9.lineSpeedMargin` (an extrapolation), the same
 * conditions My paces reads its line under (rule C9).
 */
function estimateAt(points: readonly OwnCeilingRun[], lt1SpeedMps: number): number | null {
  const line = fitLine(points)
  if (line === null || line.slopeBpmPerMps < P.c9.lineMinSlopeBpmPerMps.value) return null
  const speeds = points.map((p) => p.speedMps)
  const margin = P.c9.lineSpeedMargin.value
  if (
    lt1SpeedMps < Math.min(...speeds) * (1 - margin) ||
    lt1SpeedMps > Math.max(...speeds) * (1 + margin)
  ) {
    return null
  }
  return line.interceptBpm + line.slopeBpmPerMps * lt1SpeedMps
}

/**
 * An offer to move the easy heart-rate ceiling to the runner's own, or null [rules C4, C8]. It reads
 * the cool runs that pass B2 (`coolRunPoints`) and takes C8's three observations as the line refit as
 * each of the last `c8.minObservations` runs arrived, each standing on at least the minimum runs of
 * its direction. The three agree when all sit the same side of the current ceiling by the minimum
 * difference and within the spread of that direction. A higher ceiling allows more intensity on every
 * easy step, so it needs more runs, a larger difference and a closer agreement than a lower one, moves
 * by at most `c8.ownLt1MaxRaiseBpm`, and stays under `c8.ownLt1MaxFractionOfHrMax` of the maximum and
 * under the threshold heart rate (G6). A lower one moves to the median in one step.
 */
export function ownCeilingProposal(
  activities: readonly HrFitRun[],
  today: string,
  zones: ZoneSet,
  /** The day of the last accepted change of this boundary: only runs after it count (C8). */
  changedOn: string | null = null,
): ZoneProposal | null {
  const { lt1Hr, lt2Hr, hrMax, lt1PaceSecPerKm, hr } = zones
  if (lt1Hr === null || lt2Hr === null || hrMax === null || lt1PaceSecPerKm === null) return null
  if (hr === null || !(lt1PaceSecPerKm.value > 0)) return null

  const maxWbgtC = P.c8.ownLt1MaxWbgtC.value
  const runs: OwnCeilingRun[] = coolRunPoints(activities, today, maxWbgtC)
    .filter((p) => changedOn === null || p.date > changedOn)
    .map((p) => ({
      date: p.date,
      speedMps: p.speedMps,
      avgHr: p.avgHr,
    }))
  const observations = P.c8.minObservations.value
  const fewest = Math.min(P.c8.ownLt1MinRunsLower.value, P.c8.ownLt1MinRunsRaise.value)
  if (runs.length < fewest + observations - 1) return null

  const lt1SpeedMps = 1000 / lt1PaceSecPerKm.value
  const estimates: number[] = []
  for (let k = observations - 1; k >= 0; k -= 1) {
    const estimate = estimateAt(runs.slice(0, runs.length - k), lt1SpeedMps)
    if (estimate === null) return null
    estimates.push(estimate)
  }
  const from = lt1Hr.value
  const spread = Math.max(...estimates) - Math.min(...estimates)
  // Runs behind the weakest of the three estimates.
  const behind = runs.length - (observations - 1)

  let to: number
  let direction: OwnCeilingEvidence['direction']
  if (estimates.every((e) => e - from <= -P.c8.ownLt1MinDeltaLowerBpm.value)) {
    if (spread > P.c8.ownLt1MaxSpreadLowerBpm.value || behind < P.c8.ownLt1MinRunsLower.value) {
      return null
    }
    direction = 'lower'
    const sorted = [...estimates].sort((a, b) => a - b)
    to = Math.round(sorted[Math.floor(sorted.length / 2)]!)
    if (to <= hr.z1[0]) return null
  } else if (estimates.every((e) => e - from >= P.c8.ownLt1MinDeltaRaiseBpm.value)) {
    if (spread > P.c8.ownLt1MaxSpreadRaiseBpm.value || behind < P.c8.ownLt1MinRunsRaise.value) {
      return null
    }
    direction = 'higher'
    to = Math.min(
      Math.round(Math.min(...estimates)),
      from + P.c8.ownLt1MaxRaiseBpm.value,
      Math.floor(hrMax.value * P.c8.ownLt1MaxFractionOfHrMax.value),
      lt2Hr.value - 1,
    )
    if (to <= from) return null
  } else {
    return null
  }

  const evidence: OwnCeilingEvidence = {
    direction,
    lt1SpeedMps,
    estimates: estimates.map(Math.round),
    runs,
    maxWbgtC,
  }
  const sortedReadings = [...estimates].sort((a, b) => a - b)
  const shown = Math.round(direction === 'lower' ? sortedReadings[1]! : sortedReadings[0]!)
  const which =
    direction === 'lower' ? 'the middle of the three readings' : 'the lowest of the three readings'
  const lead = `On ${String(runs.length)} cool runs with clean heart-rate data, the line of heart rate against pace gives ${String(shown)} bpm at the easy pace limit (${which}), against the current ${String(from)} bpm.`
  const tail =
    direction === 'lower'
      ? ` Moving the easy heart-rate limit down to ${String(to)} bpm would match the line; confirm or decline.`
      : ` A higher limit allows more intensity on every easy step, so this offer needed more runs and a closer agreement than a lower one, and moves the limit by at most ${String(P.c8.ownLt1MaxRaiseBpm.value)} bpm. Moving it to ${String(to)} bpm would match the line as far as that allows; confirm or decline.`
  const effects = ` Accepting sets the top of zone 1, which also sets the heart-rate alerts on the watch, the heart-rate cap of an ultra race day and the easy pace on My paces.`
  return {
    boundary: 'lt1Hr',
    from,
    to,
    observations,
    reason: lead + tail + effects,
    rules: ['C8', 'C4', 'A8'],
    evidence,
  }
}
