// The rehearsal count of the race plan (rules H6 and H5, shown under H14): how many of the runs of
// the last `r1.rehearsalWindowWeeks` weeks were night runs, and how much time they spent on steep
// descent. Pure: the runs arrive as data (the athlete snapshot), the sun comes from
// `shared/domain/sun.ts`, and every number from `P`. It counts what was done and compares it with
// nothing (the climb part sets the long runs beside the course's own figure and no more): the plan's own ask sits beside it and the words never call the gap a shortfall (G5).
import { addDays } from '../dates.ts'
import { darkMinutesOf } from '../domain/sun.ts'
import type { Activity } from '../types.ts'
import { isDuplicate } from './load.ts'
import { P } from './params/index.ts'

const SEC_PER_MIN = 60
const DAYS_PER_WEEK = 7
const METRES_PER_KM = 1000

export interface RehearsalInput {
  /** The snapshot's activities (flagged duplicates included; they are left out here). */
  activities: readonly Activity[]
  /** The profile's home place, used for a run with no start coordinates of its own. */
  homeLat: number | null
  homeLng: number | null
  today: string
  /** The plan asks for headlamp runs (the race crosses darkness). */
  night: boolean
  /** The plan asks for downhill preparation (the course descends at least `h12.hillyDescentMPerKm`). */
  downhill: boolean
  /**
   * The course's climb and descent per kilometre when the goal holds climbing (gain above zero and a
   * distance); absent or null gives no climb part.
   */
  course?: { gainPerKm: number; lossPerKm: number } | null
}

export interface RehearsalNight {
  /** `h6.headlampRehearsalRuns`: what the plan asks for, low to high. */
  asked: [number, number]
  runs: number
  /** Moving minutes in the dark, summed over the night runs. */
  darkMin: number
  /** Runs of the window that cannot be placed in the day (no start instant, or no place). */
  unplaced: number
  /** Placed runs by where the sun was read: the run's own start point, or the home place. */
  byRunStart: number
  byHome: number
}

export interface RehearsalDownhill {
  /** The grade the downhill bands end at, in percent (negative): minutes at this grade or steeper. */
  bandMaxPct: number
  /** Moving minutes on the downhill bands, summed over the runs with bins. */
  minutes: number
  /** Long runs (`r1.longRunMin`) with `r1.sustainedDescentMin` minutes or more on those bands. */
  longRuns: number
  /** Runs of the window whose bins hold time (altitude was recorded). */
  runsWithBins: number
  /** Runs of the window without bins: no altitude, or the bins are not computed yet. */
  runsWithoutBins: number
}

export interface RehearsalClimb {
  /** The course's own figures, metres per kilometre. */
  courseGainPerKm: number
  courseLossPerKm: number
  /** Long runs of the window (`r1.longRunMin`): the ones the figures below read. */
  longRuns: number
  /** Medians over the long runs that carry a distance and the figure; null when none does. */
  medianGainPerKm: number | null
  medianLossPerKm: number | null
  /** Long runs whose climb per kilometre reaches the course's. */
  atOrAboveCourse: number
  /** The grade (percent) the climbing bands start at: minutes at this grade or steeper. */
  bandMinPct: number
  /** Moving minutes on the climbing bands, summed over the long runs with bins. */
  minutes: number
  /** The part of those minutes spent walking, 0 to 1; null when the long runs hold no band time. */
  walkedShare: number | null
  /** Long runs whose bins hold time, and those without (no altitude, or not computed yet). */
  runsWithBins: number
  runsWithoutBins: number
}

export interface RaceRehearsal {
  /** The first and last day counted. */
  from: string
  to: string
  weeks: number
  /** Runs and races in the window, flagged duplicates and treadmill runs left out. */
  runs: number
  night: RehearsalNight | null
  downhill: RehearsalDownhill | null
  /** Null when the goal holds no climbing. */
  climb: RehearsalClimb | null
  rules: string[]
}

function isCounted(a: Activity, from: string, to: string): boolean {
  return (
    (a.type === 'run' || a.type === 'race') &&
    a.subtype !== 'treadmill' &&
    !isDuplicate(a) &&
    a.date >= from &&
    a.date <= to
  )
}

function nightOf(runs: readonly Activity[], input: RehearsalInput): RehearsalNight {
  const below = P.r1.darkSunAltitudeDeg.value
  const minDark = P.r1.nightRunMinDarkMin.value
  const home =
    input.homeLat !== null && input.homeLng !== null
      ? { lat: input.homeLat, lng: input.homeLng }
      : null
  let count = 0
  let darkTotal = 0
  let unplaced = 0
  let byRunStart = 0
  let byHome = 0
  for (const run of runs) {
    const start = run.startUtc === null ? Number.NaN : Date.parse(run.startUtc)
    // The run's own start point first: a run away from home belongs under its own sun.
    const own =
      run.startLat !== null && run.startLng !== null
        ? { lat: run.startLat, lng: run.startLng }
        : null
    const place = own ?? home
    if (!Number.isFinite(start) || place === null) {
      unplaced++
      continue
    }
    if (own === null) byHome++
    else byRunStart++
    // The sun is sampled over the elapsed span, so the dark tail of an evening run with stops is
    // seen; the dark minutes are then scaled by moving over elapsed time, so pauses do not count.
    const elapsed = run.durationSec
    const moving =
      run.movingSec !== null && run.movingSec > 0 ? Math.min(run.movingSec, elapsed) : elapsed
    const darkElapsed = darkMinutesOf(start, elapsed, place.lat, place.lng, below)
    const dark = elapsed > 0 ? Math.round((darkElapsed * moving) / elapsed) : 0
    if (dark >= minDark) {
      count++
      darkTotal += dark
    }
  }
  return {
    asked: [...P.h6.headlampRehearsalRuns.value],
    runs: count,
    darkMin: darkTotal,
    unplaced,
    byRunStart,
    byHome,
  }
}

/** Seconds on the bands of one run's bins that end at `r1.descentBandMaxPct` or steeper. */
function descentSeconds(a: Activity): number {
  const bins = a.terrainBins
  if (bins === null) return 0
  const limit = P.r1.descentBandMaxPct.value
  let sec = 0
  for (let i = 0; i < bins.edgesPct.length; i++) {
    if (bins.edgesPct[i]! <= limit) sec += bins.sec[i] ?? 0
  }
  return sec
}

function hasBinTime(a: Activity): boolean {
  return a.terrainBins !== null && a.terrainBins.sec.some((s) => s > 0)
}

function downhillOf(runs: readonly Activity[]): RehearsalDownhill {
  const sustainedSec = P.r1.sustainedDescentMin.value * SEC_PER_MIN
  const longSec = P.r1.longRunMin.value * SEC_PER_MIN
  let sec = 0
  let longRuns = 0
  let withBins = 0
  for (const run of runs) {
    if (!hasBinTime(run)) continue
    withBins++
    const down = descentSeconds(run)
    sec += down
    if (run.durationSec >= longSec && down >= sustainedSec) longRuns++
  }
  return {
    bandMaxPct: P.r1.descentBandMaxPct.value,
    minutes: Math.round(sec / SEC_PER_MIN),
    longRuns,
    runsWithBins: withBins,
    runsWithoutBins: runs.length - withBins,
  }
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Seconds and walked seconds on the bands that start at `r1.climbBandMinPct` or steeper. */
function climbSeconds(a: Activity): { sec: number; walkSec: number } {
  const bins = a.terrainBins
  if (bins === null) return { sec: 0, walkSec: 0 }
  const min = P.r1.climbBandMinPct.value
  let sec = 0
  let walkSec = 0
  for (let i = 0; i < bins.sec.length; i++) {
    const lower = i === 0 ? Number.NEGATIVE_INFINITY : (bins.edgesPct[i - 1] ?? Number.NaN)
    if (lower >= min) {
      sec += bins.sec[i] ?? 0
      walkSec += bins.walkSec[i] ?? 0
    }
  }
  return { sec, walkSec }
}

function climbOf(
  runs: readonly Activity[],
  course: { gainPerKm: number; lossPerKm: number },
): RehearsalClimb {
  const longSec = P.r1.longRunMin.value * SEC_PER_MIN
  const long = runs.filter((a) => a.durationSec >= longSec)
  const gains: number[] = []
  const losses: number[] = []
  for (const run of long) {
    if (run.distanceM === null || run.distanceM <= 0) continue
    const km = run.distanceM / METRES_PER_KM
    if (run.elevationGainM !== null) gains.push(run.elevationGainM / km)
    if (run.elevationLossM !== null) losses.push(run.elevationLossM / km)
  }
  let sec = 0
  let walkSec = 0
  let withBins = 0
  for (const run of long) {
    if (!hasBinTime(run)) continue
    withBins++
    const c = climbSeconds(run)
    sec += c.sec
    walkSec += c.walkSec
  }
  return {
    courseGainPerKm: course.gainPerKm,
    courseLossPerKm: course.lossPerKm,
    longRuns: long.length,
    medianGainPerKm: medianOf(gains),
    medianLossPerKm: medianOf(losses),
    atOrAboveCourse: gains.filter((g) => g >= course.gainPerKm).length,
    bandMinPct: P.r1.climbBandMinPct.value,
    minutes: Math.round(sec / SEC_PER_MIN),
    walkedShare: sec > 0 ? Math.min(1, walkSec / sec) : null,
    runsWithBins: withBins,
    runsWithoutBins: long.length - withBins,
  }
}

/** The rehearsal of the window up to `today`; null when the plan asks for none of the kinds. */
export function rehearsalFor(input: RehearsalInput): RaceRehearsal | null {
  const course = input.course ?? null
  if (!input.night && !input.downhill && course === null) return null
  const weeks = P.r1.rehearsalWindowWeeks.value
  const from = addDays(input.today, -weeks * DAYS_PER_WEEK + 1)
  const runs = input.activities.filter((a) => isCounted(a, from, input.today))
  return {
    from,
    to: input.today,
    weeks,
    runs: runs.length,
    night: input.night ? nightOf(runs, input) : null,
    downhill: input.downhill ? downhillOf(runs) : null,
    climb: course === null ? null : climbOf(runs, course),
    rules: [
      ...(input.night ? ['H6'] : []),
      ...(input.downhill ? ['H5'] : []),
      ...(course === null ? [] : ['H1']),
    ],
  }
}
