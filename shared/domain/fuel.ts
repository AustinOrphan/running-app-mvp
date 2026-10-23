// Fuel log arithmetic (phase 3a design, section 10.3): totals, the carbohydrate rate and the
// multiple-source share, derived from the items of a log and the elapsed time of the run. Nothing
// here is stored. The fuel ladder in `shared/engine/fuel.ts` and the log form's live total both
// call these functions, so the form and the replay always agree on how many grams per hour a run
// was. The rule that ties the four fuel switches together (section 10.4) lives here too, so the
// settings form and the save route apply the same one.
//
// Pure: no clock, no I/O, no registry values. The conversions below are units, not rules.
import type { FuelItem } from '../engine/types.ts'
import type { FuelSettings } from '../types.ts'

export const SECONDS_PER_MINUTE = 60
export const SECONDS_PER_HOUR = 3600

/** What the log form and the ladder read from the items of a log. */
export type FuelItemAmounts = Pick<
  FuelItem,
  'carbsG' | 'sodiumMg' | 'kcal' | 'multiCarb' | 'servings'
>

export interface FuelTotals {
  carbsG: number
  /** Carbohydrate from products with more than one transportable carbohydrate. */
  multiCarbG: number
  sodiumMg: number
  kcal: number
}

/** A usable amount: a finite number of zero or more. Anything else counts as nothing eaten. */
function amount(value: number | null): number {
  return value !== null && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * The totals of a log's items. Each item is one product and the servings taken; a missing sodium
 * or energy figure on a product adds nothing.
 */
export function fuelTotals(items: readonly FuelItemAmounts[]): FuelTotals {
  const totals: FuelTotals = { carbsG: 0, multiCarbG: 0, sodiumMg: 0, kcal: 0 }
  for (const item of items) {
    const servings = amount(item.servings)
    const carbs = amount(item.carbsG) * servings
    totals.carbsG += carbs
    if (item.multiCarb) totals.multiCarbG += carbs
    totals.sodiumMg += amount(item.sodiumMg) * servings
    totals.kcal += amount(item.kcal) * servings
  }
  return totals
}

/** The share of the carbohydrate that came from multiple-source products, 0 to 1; 0 with none eaten. */
export function multiCarbShare(items: readonly FuelItemAmounts[]): number {
  const { carbsG, multiCarbG } = fuelTotals(items)
  return carbsG > 0 ? multiCarbG / carbsG : 0
}

/**
 * An amount per hour of elapsed time. Eating happens at stops, so the clock that counts is the
 * run's elapsed time and not its moving time. Null when the run has no elapsed time.
 */
export function ratePerHour(total: number, elapsedSec: number): number | null {
  if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) return null
  return amount(total) / (elapsedSec / SECONDS_PER_HOUR)
}

/** Grams of carbohydrate per hour of elapsed time; null with no elapsed time. */
export function carbRateGPerH(
  items: readonly FuelItemAmounts[],
  elapsedSec: number,
): number | null {
  return ratePerHour(fuelTotals(items).carbsG, elapsedSec)
}

/** Minutes in a number of seconds, not rounded. */
export function minutesOf(sec: number): number {
  return sec / SECONDS_PER_MINUTE
}

/**
 * The rules of the four fuel switches. A gut condition forces the others off, so it leaves the
 * floor and no gut-training block; opting out of the first higher tier clears the second, which
 * needs it. The settings form applies this as the runner ticks boxes and the save route applies it
 * to whatever it is sent, so a request never stores a combination the form could not show.
 */
export function normalisedFuelSettings(requested: FuelSettings): FuelSettings {
  if (requested.giDisease) {
    return { optIn90: false, optInAdvanced: false, giDisease: true, gutBlock: false }
  }
  return { ...requested, optInAdvanced: requested.optIn90 && requested.optInAdvanced }
}
