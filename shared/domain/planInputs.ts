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
import {
  baselineReadings,
  mastersCheckinHistory,
  mastersWindow,
  sleepEfficiencyEval,
  sleepNightsRecorded,
} from '../engine/readiness.ts'
import { isWatchRating, type WatchRatingCheck } from '../engine/watchRatings.ts'
import {
  mostReportsOfOneArea,
  painReports,
  repeatPainPattern,
  repeatPainWindow,
  type PainWindow,
} from './painArea.ts'
import type { Boundary, EngineInput, ZoneSet } from '../engine/types.ts'
import type { Activity } from '../types.ts'
import type { RaceHeatPlaces } from './raceHeat.ts'

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
    /** Sleep efficiency (rule J5): only Apple Health supplies the time in bed it needs. */
    efficiency: {
      /** Nights with sleep and time in bed among the last `windowNights`, today's included. */
      nights: number
      windowNights: number
      minNights: number
      /** Nights with both before that window, in the baseline the drop is measured against. */
      baselineNights: number
      baselineMinNights: number
      /** True when both counts are met, so the weekly check reads the signal. */
      read: boolean
    }
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
  /**
   * The places the race heat is read for (rule I8, RH1): null with no goal, a race that is past or a
   * goal class the race plan does not cover.
   */
  raceHeat: RaceHeatPlaces | null
  /** The runner's own answers in the windows of rules J6 and J11; absent from an older server. */
  ownAnswers?: OwnAnswers
}

/** Run ratings in one window: in-app (or of unknown source) RPE, the watch's RPE, feel and pain. */
export interface RatingCounts {
  inApp: number
  watch: number
  feel: number
  pain: number
}

/** The answers rules J6 and J11 can read, counted over the windows those rules read. */
export interface OwnAnswers {
  /** The masters recovery check (rule J6): reads check-ins only. */
  j6: {
    /** The days before today the own median is taken over (`j6.medianDays`). */
    windowDays: number
    /** The age from which the check applies (`j6.mastersAgeYears`). */
    mastersAge: number
    /** 'on' from that age, 'under' below it, 'no-birth-year' when the profile has none. */
    applies: 'on' | 'under' | 'no-birth-year'
    /** Check-ins in the window, today's left out. */
    checkins: number
    /** Check-ins in the window that answer each item the median is taken over. */
    items: { fatigue: number; soreness: number; mood: number }
    /** The check-ins the median needs (`j6.medianMinCheckins`). */
    minCheckins: number
    /** True when the window holds enough check-ins and the check applies. */
    reading: boolean
    ratings: RatingCounts
  }
  /** The repeated pain offer (rule J11). */
  j11: {
    /** The look-back in days, today included (`pain.repeatDays`). */
    windowDays: number
    /** Check-ins in the look-back that hold a pain score. */
    painCheckins: number
    /** Check-ins that report an area: a score from `minScore` and an area named. */
    reports: number
    /** The most reports naming one area. */
    mostOfOneArea: number
    minReports: number
    minScore: number
    /** The score at which a run's pain rating can open the offer on a long day (`pain.flagScore`). */
    flagScore: number
    /** True when `repeatPainPattern` finds a pattern now: the reports are there and no quiet days hold them. */
    reading: boolean
    /** True when the reports are there but the quiet days after a window for that area hold the offer (`pain.repeatQuietDays`). */
    quiet: boolean
    /** The quiet days after a niggle window. */
    quietDays: number
    ratings: RatingCounts
  }
}

export interface PlanInputsInput {
  today: string
  profile: { sex: 'female' | 'male' | 'unspecified' | null; birthYear?: number | null }
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
  /** `raceHeatPlaces` for the current goal, or null. */
  raceHeat: RaceHeatPlaces | null
  /** The stored windows (`AthleteContext.disruptions`), which the quiet days of rule J11 read. */
  windows?: readonly PainWindow[]
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

/**
 * The ratings on runs and races from `from` to `to`, flagged duplicates left out, as the engine
 * reads them: `activities` is the snapshot, in which a watch rating stays empty until it passes
 * the spread check (rule B1), so `watch` counts the ones the plan reads.
 */
function ratingCounts(
  activities: readonly Activity[],
  range: { from: string; to: string },
): RatingCounts {
  const runs = activities.filter(
    (a) =>
      (a.type === 'run' || a.type === 'race') &&
      !isDuplicate(a) &&
      a.date >= range.from &&
      a.date <= range.to,
  )
  return {
    inApp: runs.filter((a) => a.rpe !== null && !isWatchRating(a)).length,
    watch: runs.filter(isWatchRating).length,
    feel: runs.filter((a) => a.feel !== null).length,
    pain: runs.filter((a) => a.pain !== null).length,
  }
}

/** The answers of rules J6 and J11, counted over the windows and with the filters those rules use. */
function ownAnswers(input: PlanInputsInput): OwnAnswers {
  const { today, wellness, profile } = input
  const byDate = new Map(wellness.map((row) => [row.date, row]))
  const history = mastersCheckinHistory(byDate, today)
  const j6Window = mastersWindow(today)
  const minCheckins = P.j6.medianMinCheckins.value
  const age =
    typeof profile.birthYear === 'number' ? Number(today.slice(0, 4)) - profile.birthYear : null
  const applies =
    age === null ? 'no-birth-year' : age >= P.j6.mastersAgeYears.value ? 'on' : 'under'

  const j11Window = repeatPainWindow(today)
  const inLookback = wellness.filter(
    (row) => row.date >= j11Window.from && row.date <= j11Window.to,
  )
  const reports = painReports(wellness, j11Window)
  const mostOfOneArea = mostReportsOfOneArea(reports)
  const pattern = repeatPainPattern({ wellness, windows: input.windows ?? [], date: today })
  const enough = mostOfOneArea >= P.pain.repeatReports.value
  return {
    j6: {
      windowDays: P.j6.medianDays.value,
      mastersAge: P.j6.mastersAgeYears.value,
      applies,
      checkins: history.length,
      items: {
        fatigue: history.filter((c) => c.fatigue !== null).length,
        soreness: history.filter((c) => c.soreness !== null).length,
        mood: history.filter((c) => c.mood !== null).length,
      },
      minCheckins,
      reading: applies === 'on' && history.length >= minCheckins,
      ratings: ratingCounts(input.activities, j6Window),
    },
    j11: {
      windowDays: P.pain.repeatDays.value,
      painCheckins: inLookback.filter((row) => row.painScore != null).length,
      reports: reports.length,
      mostOfOneArea,
      minReports: P.pain.repeatReports.value,
      minScore: P.pain.repeatMinScore.value,
      flagScore: P.pain.flagScore.value,
      reading: pattern !== null,
      quiet: enough && pattern === null,
      quietDays: P.pain.repeatQuietDays.value,
      ratings: ratingCounts(input.activities, j11Window),
    },
  }
}

/** The data the plan reads for one runner as of `today`, counted from the snapshot. */
export function planInputs(input: PlanInputsInput): PlanInputsView {
  const { today, wellness, zones } = input
  const byDate = new Map(wellness.map((row) => [row.date, row]))
  const cyclic = input.profile.sex === 'female'
  const hrv = baselineReadings(byDate, today, 'hrv', cyclic)
  const rest = baselineReadings(byDate, today, 'resting-hr', false)
  const efficiency = sleepEfficiencyEval(wellness, today)
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
      efficiency: {
        nights: efficiency.windowNights,
        windowNights: P.j5.reducePersistDays.value,
        minNights: P.j5.sleepEffMinNights.value,
        baselineNights: efficiency.baselineNights,
        baselineMinNights: P.j5.sleepEffMinBaselineNights.value,
        read: efficiency.dropPp !== null,
      },
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
    raceHeat: input.raceHeat,
    ownAnswers: ownAnswers(input),
  }
}
