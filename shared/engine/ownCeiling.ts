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

/** The cool runs that pass B2, after the last accepted change of the boundary (C8), oldest first. */
function ownCeilingRuns(
  activities: readonly HrFitRun[],
  today: string,
  changedOn: string | null,
): OwnCeilingRun[] {
  return coolRunPoints(activities, today, P.c8.ownLt1MaxWbgtC.value)
    .filter((p) => changedOn === null || p.date > changedOn)
    .map((p) => ({ date: p.date, speedMps: p.speedMps, avgHr: p.avgHr }))
}

/** The runs the three nested readings need before the line is read at all: the fewest of a direction. */
function runsToRead(): number {
  const fewest = Math.min(P.c8.ownLt1MinRunsLower.value, P.c8.ownLt1MinRunsRaise.value)
  return fewest + P.c8.minObservations.value - 1
}

/**
 * C8's observations: the line refit as each of the last `c8.minObservations` runs arrived, read at the
 * easy pace limit. Null when any of them cannot be read there.
 */
function nestedEstimates(runs: readonly OwnCeilingRun[], lt1SpeedMps: number): number[] | null {
  const estimates: number[] = []
  for (let k = P.c8.minObservations.value - 1; k >= 0; k -= 1) {
    const estimate = estimateAt(runs.slice(0, runs.length - k), lt1SpeedMps)
    if (estimate === null) return null
    estimates.push(estimate)
  }
  return estimates
}

/** What a reading stands on, whatever the runs say. */
export interface OwnCeilingSample {
  /** Cool, clean, flat, steady runs in the window now (after the last accepted change, when there is one). */
  runs: number
  /** Runs at which the line is read and a reading is shown. */
  need: number
  /** Runs at which an offer of a lower, and of a higher, ceiling can stand on Review (C8). */
  needLower: number
  needHigher: number
  windowWeeks: number
  maxWbgtC: number
  minDurationMin: number
  /** The day of the last accepted change: only runs after it count; null when there is none. */
  since: string | null
}

/**
 * What the runs say about the top of zone 1, to set beside the ceiling in use [rules C4, C8]. Never an
 * offer and never applied: an offer is `ownCeilingProposal`, on Review, and unchanged. `missing` says
 * what the zones lack (a maximum heart rate or a pace anchor), `too-few` that fewer runs qualify than
 * `need`, `unclear` that the line cannot be read at the easy pace limit, `ready` the reading.
 */
export type OwnCeilingReading =
  | (OwnCeilingSample & { status: 'missing'; missing: Array<'maximum' | 'pace'> })
  | (OwnCeilingSample & { status: 'too-few' })
  | (OwnCeilingSample & { status: 'unclear' })
  | (OwnCeilingSample & {
      status: 'ready'
      /** The lowest, middle and highest of the three nested readings, bpm. */
      low: number
      mid: number
      high: number
      /** The ceiling in use, the half-width of its band (rule C7), and where the range sits against it. */
      inUse: { bpm: number; bandBpm: number }
      relation: 'within' | 'below' | 'above'
      /** Beats between the ceiling in use and the nearest end of the range; 0 when within. */
      gapBpm: number
    })

/**
 * The reading of the runner's own easy ceiling as of `today`: the same runs, the same three nested
 * readings and the same line conditions as `ownCeilingProposal`, shown whether or not an offer stands.
 */
export function ownCeilingReading(
  activities: readonly HrFitRun[],
  today: string,
  zones: ZoneSet,
  changedOn: string | null = null,
): OwnCeilingReading {
  const runs = ownCeilingRuns(activities, today, changedOn)
  const observations = P.c8.minObservations.value
  const sample: OwnCeilingSample = {
    runs: runs.length,
    need: runsToRead(),
    needLower: P.c8.ownLt1MinRunsLower.value + observations - 1,
    needHigher: P.c8.ownLt1MinRunsRaise.value + observations - 1,
    windowWeeks: P.hrModel.windowWeeks.value,
    maxWbgtC: P.c8.ownLt1MaxWbgtC.value,
    minDurationMin: P.hrModel.minDurationMin.value,
    since: changedOn,
  }
  const { lt1Hr, lt2Hr, hrMax, lt1PaceSecPerKm, hr } = zones
  const missing: Array<'maximum' | 'pace'> = []
  if (lt1Hr === null || lt2Hr === null || hrMax === null || hr === null) missing.push('maximum')
  if (lt1PaceSecPerKm === null || !(lt1PaceSecPerKm.value > 0)) missing.push('pace')
  if (missing.length > 0 || lt1Hr === null || lt1PaceSecPerKm === null) {
    return { ...sample, status: 'missing', missing }
  }
  if (runs.length < sample.need) return { ...sample, status: 'too-few' }
  const estimates = nestedEstimates(runs, 1000 / lt1PaceSecPerKm.value)
  if (estimates === null) return { ...sample, status: 'unclear' }
  const sorted = [...estimates].sort((a, b) => a - b)
  const low = Math.round(sorted[0]!)
  const high = Math.round(sorted[sorted.length - 1]!)
  const mid = Math.round(sorted[Math.floor(sorted.length / 2)]!)
  const bpm = lt1Hr.value
  const relation = bpm > high ? 'above' : bpm < low ? 'below' : 'within'
  return {
    ...sample,
    status: 'ready',
    low,
    mid,
    high,
    inUse: { bpm, bandBpm: (lt1Hr.band[1] - lt1Hr.band[0]) / 2 },
    relation,
    gapBpm: relation === 'above' ? bpm - high : relation === 'below' ? low - bpm : 0,
  }
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
  const runs = ownCeilingRuns(activities, today, changedOn)
  const observations = P.c8.minObservations.value
  if (runs.length < runsToRead()) return null

  const lt1SpeedMps = 1000 / lt1PaceSecPerKm.value
  const estimates = nestedEstimates(runs, lt1SpeedMps)
  if (estimates === null) return null
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
