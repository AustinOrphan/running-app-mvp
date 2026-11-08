// The rehearsal count of the race plan (rules H6 and H5, shown under H14): how many of the runs of
// the last `r1.rehearsalWindowWeeks` weeks were night runs, and how much time they spent on steep
// descent. Pure: the runs arrive as data (the athlete snapshot), the sun comes from
// `shared/domain/sun.ts`, and every number from `P`. It counts what was done and compares it with
// nothing: the plan's own ask sits beside it and the words never call the gap a shortfall (G5).
import { addDays } from '../dates.ts'
import { darkMinutesOf } from '../domain/sun.ts'
import type { Activity } from '../types.ts'
import { isDuplicate } from './load.ts'
import { P } from './params/index.ts'

const SEC_PER_MIN = 60
const DAYS_PER_WEEK = 7

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

export interface RaceRehearsal {
  /** The first and last day counted. */
  from: string
  to: string
  weeks: number
  /** Runs and races in the window, flagged duplicates and treadmill runs left out. */
  runs: number
  night: RehearsalNight | null
  downhill: RehearsalDownhill | null
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

/** The rehearsal of the window up to `today`; null when the plan asks for neither kind. */
export function rehearsalFor(input: RehearsalInput): RaceRehearsal | null {
  if (!input.night && !input.downhill) return null
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
    rules: [...(input.night ? ['H6'] : []), ...(input.downhill ? ['H5'] : [])],
  }
}
