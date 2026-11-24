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

/** A distance from which a two-part entry such as "1:45" reads as hours and minutes (21 km). */
const HOURS_MINUTES_FROM_M = 21_000
/** A speed no runner holds for a race; an `m:ss` reading above it is read as `h:mm` (faster than the 800 m record). */
const IMPLAUSIBLE_SPEED_MPS = 8

/**
 * Seconds from `h:mm:ss`, `m:ss` or `h:mm`; null when the text is not a time. A three-part entry
 * is always `h:mm:ss`. A two-part entry is `h:mm` for a goal of a half marathon or longer, and for
 * a shorter one when the `m:ss` reading would be faster than any runner holds (1:45 for 10 km);
 * otherwise, and with no distance, it is `m:ss`.
 */
export function parseTime(text: string, distanceM: number | null = null): number | null {
  const trimmed = text.trim()
  const three = /^(\d{1,3}):([0-5]?\d):([0-5]\d)$/.exec(trimmed)
  if (three) {
    const seconds = (Number(three[1]) * 60 + Number(three[2])) * 60 + Number(three[3])
    return seconds > 0 ? seconds : null
  }
  const two = /^(\d{1,3}):([0-5]\d)$/.exec(trimmed)
  if (!two) return null
  const first = Number(two[1])
  const second = Number(two[2])
  const asHours = (first * 60 + second) * 60
  const asMinutes = first * 60 + second
  const hours =
    distanceM !== null &&
    (distanceM >= HOURS_MINUTES_FROM_M ||
      (asMinutes > 0 && distanceM / asMinutes > IMPLAUSIBLE_SPEED_MPS))
  if (hours) return asHours > 0 ? asHours : null
  // As before, minutes stop at 59 here; a longer entry needs its hours.
  if (first > 59) return null
  return asMinutes > 0 ? asMinutes : null
}

/** "1 h 45 min" or "1 min 45 s": a time in words, so a runner can check how an entry was read. */
export function describeTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.round(seconds % 60)
  const parts: string[] = []
  if (h > 0) parts.push(`${h} h`)
  if (m > 0) parts.push(`${m} min`)
  if (s > 0) parts.push(`${s} s`)
  return parts.join(' ')
}

/**
 * The reading of a two-part entry ("Read as 1 h 45 min."), the one a runner cannot see from the
 * text; null for any other entry, which is `h:mm:ss` or not a time.
 */
export function twoPartReading(text: string, distanceM: number | null): string | null {
  if (!/^\s*\d{1,3}:[0-5]\d\s*$/.test(text)) return null
  const seconds = parseTime(text, distanceM)
  return seconds === null ? null : `Read as ${describeTime(seconds)}.`
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
