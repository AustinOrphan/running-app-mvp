// What the plan can see (rule T2): the counts of the data the engine reads for one runner, taken
// from the same snapshot the engine reads and fed back to nothing. Pure: every figure is a count, a
// source or a window length, and the windows and the selections are the engine's own (the baseline
// of rule J4 is `baselineReadings`, the sleep window of rule J5 is `sleepNightsRecorded`, the
// heart-rate line's runs are `hrModelSample`, the pass of rule B2 is `hrQualityPasses`). It adds no
// number of its own, states no target and gives no verdict on the data.
import { hrModelSample, type HrModel } from '../engine/execution.ts'
import { hrQualityPasses } from '../engine/hrQuality.ts'
import { isDuplicate } from '../engine/load.ts'
import { P } from '../engine/params/index.ts'
import { baselineReadings, sleepNightsRecorded } from '../engine/readiness.ts'
import type { WatchRatingCheck } from '../engine/watchRatings.ts'
import type { Boundary, EngineInput, ZoneSet } from '../engine/types.ts'
import type { Activity } from '../types.ts'

/** The six zone boundaries, in the order the zone summary lists them. */
export const ZONE_BOUNDARY_KEYS = [
  'hrMax',
  'lt1Hr',
  'lt2Hr',
  'csMps',
  'lt1PaceSecPerKm',
  'thresholdPaceSecPerKm',
] as const
export type ZoneBoundaryKey = (typeof ZONE_BOUNDARY_KEYS)[number]

/** The kind of heart-rate-variability readings stored: rMSSD, SDNN, both or none. */
export type HrvKind = 'rmssd' | 'sdnn' | 'both' | 'none'

export interface PlanInputsView {
  asOf: string
  hrv: {
    kind: HrvKind
    /** Days with an rMSSD reading in the wellness window the snapshot holds. */
    rmssdDays: number
    /** Days with an SDNN reading in the same window; rule J4 never reads them. */
    sdnnDays: number
    /** rMSSD readings in the baseline of rule J4 for today (before today). */
    baselineReadings: number
    /** Days the baseline reads back (`j4.lookbackDays`, or the cycle window for the female profile). */
    lookbackDays: number
    /** The most readings the baseline keeps (`j4.windowDays`); the cycle window keeps them all. */
    baselineKeeps: number | null
    minReadings: number
  }
  restingHr: {
    /** Days with a resting heart rate in the wellness window the snapshot holds. */
    days: number
    baselineReadings: number
    lookbackDays: number
    baselineKeeps: number
    minReadings: number
  }
  sleep: {
    /** Nights with a recording among the last `windowNights`, today's included. */
    nights: number
    windowNights: number
    minNights: number
  }
  wellnessWindowDays: number
  runs: {
    windowDays: number
    /** Runs and races in the history, flagged duplicates left out. */
    count: number
    withStream: number
    /** Runs whose stored terrain bins hold metres: an altitude span of at least 2 m was read from the stream. */
    withAltitude: number
    /** Heart rate from an external sensor, a wrist sensor or a file with no device information. */
    strap: number
    wrist: number
    unknown: number
    /** Runs that pass the heart-rate checks of rule B2; only the Trends panels read the result. */
    passing: number
    /** Effort ratings the watch gave (WR1), and whether the engine reads them yet (rule B1). */
    watchRatings: {
      count: number
      distinct: number
      used: boolean
      minCount: number
      minDistinct: number
      maxModalShare: number
    }
    /** The runs on the heart-rate line of rule A8, the number it needs and its window. */
    hrLine: { runs: number; need: number; windowWeeks: number; fitted: boolean }
  }
  zones: Array<{
    key: ZoneBoundaryKey
    /** Null when the boundary is not estimated yet. */
    boundary: Pick<Boundary, 'source' | 'asOf' | 'fromTraining' | 'windowWidened'> | null
  }>
  sources: {
    /** The registry sources that fed the windows, in registry order. */
    named: Array<{ key: string; label: string; activities: number; wellnessDays: number }>
    /** Entered by hand or read from a file or an export, which name no connected source. */
    other: { activities: number; wellnessDays: number }
  }
}

export interface PlanInputsInput {
  today: string
  profile: { sex: 'female' | 'male' | 'unspecified' | null }
  wellness: EngineInput['wellness']
  /** Days the snapshot's wellness window reaches back (`StateInputs.wellness.windowDays`). */
  wellnessWindowDays: number
  activities: readonly Activity[]
  /** The spread check over the watch ratings (`AthleteContext.watchRatings`). */
  watchRatings: WatchRatingCheck
  /** Ids of the activities that have a stored stream. */
  streamIds: ReadonlySet<string>
  zones: ZoneSet
  /** The heart-rate line `hrModelOf` fitted, or null. */
  hrModel: HrModel | null
  /** Registry labels by provider key, in display order. */
  providerLabels: ReadonlyArray<{ key: string; label: string }>
}

function positive(value: number | null | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function hrvKind(rmssdDays: number, sdnnDays: number): HrvKind {
  if (rmssdDays > 0) return sdnnDays > 0 ? 'both' : 'rmssd'
  return sdnnDays > 0 ? 'sdnn' : 'none'
}

function sumOf(values: readonly number[] | undefined): number {
  return (values ?? []).reduce((total, v) => total + v, 0)
}

/** The data the plan reads for one runner as of `today`, counted from the snapshot. */
export function planInputs(input: PlanInputsInput): PlanInputsView {
  const { today, wellness, zones } = input
  const byDate = new Map(wellness.map((row) => [row.date, row]))
  const cyclic = input.profile.sex === 'female'
  const hrv = baselineReadings(byDate, today, 'hrv', cyclic)
  const rest = baselineReadings(byDate, today, 'resting-hr', false)
  const rmssdDays = wellness.filter((row) => positive(row.hrvRmssd)).length
  const sdnnDays = wellness.filter((row) => positive(row.hrvSdnn)).length

  const runs = input.activities.filter(
    (a) => (a.type === 'run' || a.type === 'race') && !isDuplicate(a),
  )
  const sample = hrModelSample(input.activities, today)
  const named = new Map(
    input.providerLabels.map(({ key, label }) => [
      key,
      { key, label, activities: 0, wellnessDays: 0 },
    ]),
  )
  const other = { activities: 0, wellnessDays: 0 }
  for (const a of input.activities) {
    if (isDuplicate(a)) continue
    const entry = named.get(a.source)
    if (entry) entry.activities += 1
    else other.activities += 1
  }
  for (const row of wellness) {
    const entry = named.get(row.source)
    if (entry) entry.wellnessDays += 1
    else other.wellnessDays += 1
  }

  return {
    asOf: today,
    hrv: {
      kind: hrvKind(rmssdDays, sdnnDays),
      rmssdDays,
      sdnnDays,
      baselineReadings: hrv.values.length,
      lookbackDays: hrv.lookback,
      baselineKeeps: cyclic ? null : P.j4.windowDays.value,
      minReadings: P.j4.minReadings.value,
    },
    restingHr: {
      days: wellness.filter((row) => positive(row.restingHr)).length,
      baselineReadings: rest.values.length,
      lookbackDays: rest.lookback,
      baselineKeeps: P.j4.windowDays.value,
      minReadings: P.j4.minReadings.value,
    },
    sleep: {
      nights: sleepNightsRecorded(wellness, today),
      windowNights: P.j5.sleepWarnNights.value,
      minNights: P.j5.sleepMinNights.value,
    },
    wellnessWindowDays: input.wellnessWindowDays,
    runs: {
      windowDays: P.a5.historyWindowDays.value,
      count: runs.length,
      withStream: runs.filter((a) => input.streamIds.has(a.id)).length,
      withAltitude: runs.filter((a) => a.terrainBins !== null && sumOf(a.terrainBins.m) > 0).length,
      strap: runs.filter((a) => a.hrQuality?.source === 'strap').length,
      wrist: runs.filter((a) => a.hrQuality?.source === 'wrist').length,
      unknown: runs.filter((a) => a.hrQuality?.source === 'unknown').length,
      passing: runs.filter((a) => hrQualityPasses(a.hrQuality)).length,
      watchRatings: {
        count: input.watchRatings.count,
        distinct: input.watchRatings.distinct,
        used: input.watchRatings.usable,
        minCount: P.b1.watchRpeMinCount.value,
        minDistinct: P.b1.watchRpeMinDistinct.value,
        maxModalShare: P.b1.watchRpeMaxModalShare.value,
      },
      hrLine: {
        runs: sample.runs,
        need: P.hrModel.minQualifyingRuns.value,
        windowWeeks: P.hrModel.windowWeeks.value,
        fitted: input.hrModel !== null,
      },
    },
    zones: ZONE_BOUNDARY_KEYS.map((key) => {
      const boundary = zones[key]
      return {
        key,
        boundary:
          boundary === null
            ? null
            : {
                source: boundary.source,
                asOf: boundary.asOf,
                ...(boundary.fromTraining === undefined
                  ? {}
                  : { fromTraining: boundary.fromTraining }),
                ...(boundary.windowWidened === undefined
                  ? {}
                  : { windowWidened: boundary.windowWidened }),
              },
      }
    }),
    sources: { named: [...named.values()].filter((s) => s.activities + s.wellnessDays > 0), other },
  }
}
