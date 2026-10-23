import type { Units } from './types.ts'

const M_PER_MILE = 1609.344
export const FEET_PER_METRE = 3.28084
/** What a formatter prints for a value it cannot show. Never "NaN" or "undefined". */
export const NO_VALUE = '—'

export function milesToM(mi: number): number {
  return mi * M_PER_MILE
}

export function mToMiles(m: number): number {
  return m / M_PER_MILE
}

export function kmToM(km: number): number {
  return km * 1000
}

export function mToKm(m: number): number {
  return m / 1000
}

function metresPerUnit(units: Units): number {
  return units === 'mi' ? M_PER_MILE : 1000
}

/** `m:ss`, or `h:mm:ss` from one hour up. Invalid input gives a dash. */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return NO_VALUE
  const total = Math.round(sec)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const ss = String(seconds).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`
  return `${minutes}:${ss}`
}

/** Pace such as `8:00 /mi`. A dash when distance or duration is not positive. */
export function formatPace(durationSec: number, distanceM: number, units: Units): string {
  if (!(durationSec > 0) || !(distanceM > 0) || !Number.isFinite(durationSec + distanceM)) {
    return NO_VALUE
  }
  const secPerUnit = durationSec / (distanceM / metresPerUnit(units))
  return `${formatDuration(secPerUnit)} /${units}`
}

export function formatDistance(distanceM: number, units: Units): string {
  if (!Number.isFinite(distanceM) || distanceM < 0) return NO_VALUE
  return `${(distanceM / metresPerUnit(units)).toFixed(2)} ${units}`
}

/** Minutes as hours with one decimal: 450 -> '7.5'. */
export function minutesToHours1(min: number): string {
  return (min / 60).toFixed(1)
}

/** Climb in the runner's unit: metres for km, feet for miles ("197 ft"). */
export function formatClimb(gainM: number, units: Units): string {
  if (!Number.isFinite(gainM)) return NO_VALUE
  return units === 'mi'
    ? `${String(Math.round(gainM * FEET_PER_METRE))} ft`
    : `${String(Math.round(gainM))} m`
}

/** A finish estimate from this length on is rounded to `COARSE_ESTIMATE_STEP_SEC`. */
const COARSE_ESTIMATE_FROM_SEC = 6 * 3600
const COARSE_ESTIMATE_STEP_SEC = 600
const FINE_ESTIMATE_STEP_SEC = 60

/**
 * A predicted time at the precision it deserves: whole minutes, and ten-minute steps from six
 * hours, where the range around it is wide enough that minutes would be noise. This is display
 * rounding; the engine's numbers are untouched. Not finite or negative gives NaN.
 */
export function roundEstimateSec(sec: number): number {
  if (!Number.isFinite(sec) || sec < 0) return Number.NaN
  const step = sec >= COARSE_ESTIMATE_FROM_SEC ? COARSE_ESTIMATE_STEP_SEC : FINE_ESTIMATE_STEP_SEC
  return Math.round(sec / step) * step
}

/**
 * A predicted time as a person says it: "48 min", "3 h 47 min", "31 h 50 min", "28 h". Rounded by
 * `roundEstimateSec`. Not finite or negative gives a dash. The copy system prints the same text
 * from a `duration` quantity whose seconds went through `roundEstimateSec`.
 */
export function formatEstimate(sec: number): string {
  const rounded = roundEstimateSec(sec)
  if (Number.isNaN(rounded)) return NO_VALUE
  const totalMin = rounded / 60
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  if (hours === 0) return `${String(minutes)} min`
  return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} min`
}
