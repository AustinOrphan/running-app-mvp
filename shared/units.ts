import type { Units } from './types.ts'

const M_PER_MILE = 1609.344
const NO_VALUE = '—'

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
