// Numbers in the runner's units. One formatter for every sentence the app writes: a stored record
// keeps a `Quantity` (metric base units, ISO dates) and this module decides how it reads.
import {
  formatLongDate,
  formatShortDate,
  formatWeekday,
  formatWeekdayDate,
  formatWeekdayName,
  isIsoDate,
} from '../dates.ts'
import { DEFAULT_WEIGHT_UNIT, isWeightUnit, loadParts } from '../domain/weight.ts'
import type { Quantity } from '../engine/types.ts'
import type { Units, WeightUnit } from '../types.ts'
import { FEET_PER_METRE, formatDuration, milesToM, NO_VALUE } from '../units.ts'

export type { Quantity }

const METRES_PER_KM = 1000

/** A formatted number and the unit text after it, kept apart so a range can share the unit. */
export interface QuantityParts {
  num: string
  /** " km", "%", " /mi" or "". */
  suffix: string
}

/** `toFixed` without trailing zeros and without "-0". */
function trimmed(value: number, decimals: number): string {
  const text = value
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '')
  return text === '-0' ? '0' : text
}

/**
 * A plain number: up to three decimals below 10 and two from there, no trailing zeros (0.823,
 * 12.35, 1013.25, 5). A value that is not finite gives a dash.
 */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return NO_VALUE
  return trimmed(n, Math.abs(n) < 10 ? 3 : 2)
}

/** One decimal, or two below one: 5.59, 0.25, 26.2. Used for distances and speeds. */
function scaled(value: number): string {
  return trimmed(value, value < 1 ? 2 : 1)
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** The numeric field of each kind, and whether a negative value makes sense. */
const NUMERIC_FIELDS = {
  pace: { key: 'secPerKm', min: 'positive' },
  speed: { key: 'kmh', min: 'zero' },
  distance: { key: 'm', min: 'zero' },
  climb: { key: 'm', min: 'any' },
  duration: { key: 'sec', min: 'zero' },
  minutes: { key: 'min', min: 'zero' },
  bpm: { key: 'bpm', min: 'any' },
  percent: { key: 'pct', min: 'any' },
  share: { key: 'fraction', min: 'any' },
  count: { key: 'n', min: 'any' },
  temp: { key: 'c', min: 'any' },
  load: { key: 'g', min: 'zero' },
} as const satisfies Partial<Record<Quantity['kind'], { key: string; min: string }>>

type NumericKind = keyof typeof NUMERIC_FIELDS

function isNumericKind(kind: unknown): kind is NumericKind {
  return typeof kind === 'string' && Object.hasOwn(NUMERIC_FIELDS, kind)
}

/** Why a value cannot be shown as a quantity, or null when it can. */
export function quantityIssue(q: unknown): string | null {
  if (typeof q !== 'object' || q === null) return 'not a quantity'
  const record = q as Record<string, unknown>
  const kind = record['kind']
  if (kind === 'date' || kind === 'weekday') {
    const iso = record['iso']
    return typeof iso === 'string' && isIsoDate(iso) ? null : `${kind} needs a YYYY-MM-DD date`
  }
  if (!isNumericKind(kind)) return `unknown kind ${JSON.stringify(kind)}`
  const { key, min } = NUMERIC_FIELDS[kind]
  const value = record[key]
  if (!isFiniteNumber(value)) return `${kind} needs a finite number in "${key}"`
  if (min === 'positive' && value <= 0) return `${kind} needs a positive "${key}"`
  if (min === 'zero' && value < 0) return `${kind} needs a "${key}" of zero or more`
  return null
}

function distanceParts(m: number, units: Units): QuantityParts {
  if (units === 'mi') return { num: scaled(m / milesToM(1)), suffix: ' mi' }
  if (Math.round(m) < METRES_PER_KM) return { num: trimmed(m, 0), suffix: ' m' }
  return { num: scaled(m / METRES_PER_KM), suffix: ' km' }
}

function durationParts(sec: number): QuantityParts {
  const total = Math.round(sec)
  if (total < 60) return { num: `${String(total)} s`, suffix: '' }
  if (total < 600) {
    const minutes = Math.floor(total / 60)
    const seconds = total % 60
    const text =
      seconds === 0 ? `${String(minutes)} min` : `${String(minutes)} min ${String(seconds)} s`
    return { num: text, suffix: '' }
  }
  const all = Math.round(total / 60)
  const hours = Math.floor(all / 60)
  const minutes = all % 60
  const text =
    hours === 0
      ? `${String(minutes)} min`
      : minutes === 0
        ? `${String(hours)} h`
        : `${String(hours)} h ${String(minutes)} min`
  return { num: text, suffix: '' }
}

function dateParts(q: Extract<Quantity, { kind: 'date' }>): QuantityParts {
  switch (q.style) {
    case 'weekday':
      return { num: formatWeekdayDate(q.iso), suffix: '' }
    case 'long':
      return { num: formatLongDate(q.iso), suffix: '' }
    default:
      return { num: formatShortDate(q.iso), suffix: '' }
  }
}

/**
 * A quantity as a number and its unit text, or null when it cannot be shown. A range joins the
 * numbers and prints the unit once ("28 to 32 km"). `weightUnit` is read by a `load` only and
 * defaults to pounds, the default of the setting.
 */
export function quantityParts(
  q: Quantity,
  units: Units,
  weightUnit: WeightUnit = DEFAULT_WEIGHT_UNIT,
): QuantityParts | null {
  if (quantityIssue(q) !== null) return null
  switch (q.kind) {
    case 'pace': {
      const perUnit = units === 'mi' ? q.secPerKm * (milesToM(1) / METRES_PER_KM) : q.secPerKm
      return { num: formatDuration(perUnit), suffix: ` /${units}` }
    }
    case 'speed':
      return units === 'mi'
        ? { num: scaled(q.kmh / (milesToM(1) / METRES_PER_KM)), suffix: ' mph' }
        : { num: scaled(q.kmh), suffix: ' km/h' }
    case 'distance':
      return distanceParts(q.m, units)
    case 'climb':
      return units === 'mi'
        ? { num: trimmed(q.m * FEET_PER_METRE, 0), suffix: ' ft' }
        : { num: trimmed(q.m, 0), suffix: ' m' }
    case 'duration':
      return durationParts(q.sec)
    case 'minutes':
      return { num: trimmed(q.min, 1), suffix: ' min' }
    case 'bpm':
      return { num: trimmed(q.bpm, 1), suffix: ' bpm' }
    case 'percent':
      return { num: formatNumber(q.pct), suffix: '%' }
    case 'share':
      return { num: formatNumber(q.fraction * 100), suffix: '%' }
    case 'count':
      return { num: formatNumber(q.n), suffix: '' }
    case 'temp':
      // A WBGT reading or a heat threshold: the heat rules (section I) state both in °C, so they
      // read °C with miles too. An air temperature follows the units (`formatAirTemperature`).
      return { num: formatNumber(q.c), suffix: ' °C' }
    case 'load':
      // A strength load is stored in grams; the weight unit is a setting of its own, not derived
      // from the distance units (miles with kilograms is common).
      return loadParts(q.g, isWeightUnit(weightUnit) ? weightUnit : DEFAULT_WEIGHT_UNIT)
    case 'date':
      return dateParts(q)
    case 'weekday':
      return {
        num: q.style === 'long' ? formatWeekdayName(q.iso) : formatWeekday(q.iso),
        suffix: '',
      }
  }
}

/**
 * A quantity in the runner's units: "8:51 /mi", "13.1 mi", "197 ft", "1 h 45 min", "20%",
 * "Mon 19 Oct", a strength load "115 lb" or "52.25 kg" (by `weightUnit`, which only a `load`
 * reads). A value that cannot be shown (not finite, a malformed date, an unknown kind) gives a
 * dash, never "NaN", "undefined" or a raw ISO date; `quantityIssue` says why.
 */
export function formatQuantity(
  q: Quantity,
  units: Units,
  weightUnit: WeightUnit = DEFAULT_WEIGHT_UNIT,
): string {
  const parts = quantityParts(q, units, weightUnit)
  return parts === null ? NO_VALUE : `${parts.num}${parts.suffix}`
}

/**
 * An air temperature in the runner's units, to whole degrees: "50 °F" with miles, "10 °C" with
 * kilometres. The one rule for the air: the activity page's weather and Today's cooler start both
 * word it here. A `temp` quantity is the other kind of temperature, a WBGT reading or a heat
 * threshold, and reads °C in either unit system (see `quantityParts`).
 */
export function formatAirTemperature(c: number, units: Units): string {
  if (!Number.isFinite(c)) return NO_VALUE
  return units === 'mi'
    ? `${String(Math.round((c * 9) / 5 + 32))} °F`
    : `${String(Math.round(c))} °C`
}

/**
 * Two quantities of one kind as a range that prints the unit once: "4:10 to 4:00 /km", "140 to 150
 * bpm". A pair that cannot be shown as parts reads in full, with a dash for what cannot be shown.
 */
export function formatRange(
  first: Quantity,
  second: Quantity,
  units: Units,
  weightUnit: WeightUnit = DEFAULT_WEIGHT_UNIT,
): string {
  const from = quantityParts(first, units, weightUnit)
  const to = quantityParts(second, units, weightUnit)
  if (from === null || to === null) {
    return `${formatQuantity(first, units, weightUnit)} to ${formatQuantity(second, units, weightUnit)}`
  }
  return `${from.num} to ${to.num}${to.suffix}`
}

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
]

/**
 * "one symptom-free day", "3 easy days": a count in words up to ten, then in digits, with the noun
 * in the plural unless the count is one. For a sentence that states a rule number from the Params.
 */
export function countPhrase(n: number, noun: string): string {
  const word =
    Number.isInteger(n) && n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n]! : String(n)
  return `${word} ${noun}${n === 1 ? '' : 's'}`
}
