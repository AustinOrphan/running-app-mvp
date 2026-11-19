// Text to value and value to text for the goal and race-result forms: distances in the runner's
// units, whole metres, finish times and coordinates. Pure, so both sheets share one reading of
// what a runner types. The profile's home place reads its coordinates here too.
import type { Units } from '../../shared/types.ts'
import { kmToM, milesToM, mToKm, mToMiles } from '../../shared/units.ts'

/** A distance as the runner types it in their units: "13.11" for 21 098 m in miles. */
export function distanceInputText(distanceM: number, units: Units): string {
  const value = units === 'mi' ? mToMiles(distanceM) : mToKm(distanceM)
  return String(Number(value.toFixed(2)))
}

/** Metres from text typed in the user's units; null when it is not a positive number. */
export function parseDistance(text: string, units: Units): number | null {
  const value = Number(text.trim().replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(units === 'mi' ? milesToM(value) : kmToM(value))
}

/** Whole metres from text; blank is null, anything else that is not a whole number is undefined. */
export function parseMetres(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  return /^\d{1,5}$/.test(trimmed) ? Number(trimmed) : undefined
}

/** Seconds from `h:mm:ss` or `m:ss`; null when the text is not a time. */
export function parseTime(text: string): number | null {
  const match = /^(?:(\d{1,3}):)?([0-5]?\d):([0-5]\d)$/.exec(text.trim())
  if (!match) return null
  const seconds = (Number(match[1] ?? 0) * 60 + Number(match[2])) * 60 + Number(match[3])
  return seconds > 0 ? seconds : null
}

/** The refusals for a coordinate, shared by the goal sheet and the profile's home place. */
export const LATITUDE_REFUSAL = 'Enter a latitude from −90 to 90, like 41.88 or −33.87.'
export const LONGITUDE_REFUSAL = 'Enter a longitude from −180 to 180, like 8.23 or −87.63.'

/**
 * A coordinate kept to 0.01 degrees; null when the text is not a number in range. A leading
 * U+2212 minus (pasted, or from a keyboard that types it) reads as '-', and a comma as a point.
 */
export function parseCoordinate(text: string, limit: number): number | null {
  const trimmed = text.trim().replace(/^−/, '-')
  const value = Number(trimmed.replace(',', '.'))
  if (trimmed === '' || !Number.isFinite(value) || Math.abs(value) > limit) return null
  const rounded = Math.round(value * 100) / 100
  return rounded === 0 ? 0 : rounded
}

/** Trimmed text; blank becomes null. */
export function blankToNull(text: string): string | null {
  const trimmed = text.trim()
  return trimmed === '' ? null : trimmed
}
