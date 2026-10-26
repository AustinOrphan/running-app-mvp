// Strength loads: integer grams in storage, the runner's weight unit at the display edge
// (strength design 5.2, ADR 0014, ADR 0003). One module holds the conversion, the display rounding,
// the loads a piece of equipment can make and the step arithmetic over them, so a suggestion, a
// stepper and a typed value all land on the same gram.
//
// Why grams: a kilogram float would make "same as last time" and the equality tests of the
// progression rules depend on floating-point rounding. 45 lb is 20 411.66 g and is stored as
// 20 412 g.
//
// Every load the app makes is `toGrams` of a value on the display grid of the runner's unit
// (pounds to the nearest half, kilograms to the nearest quarter). The step helpers below do their
// arithmetic on that grid and convert once, so a load reached by five presses of a stepper and the
// same load typed by hand are the same integer.
import type { EquipmentConfig, EquipmentKind, LoadSteps, WeightUnit } from '../types.ts'
import { NO_VALUE } from '../units.ts'

/** The unit of a runner who has not chosen one: pounds (decided 2026-10-24, strength design section 18, question 3). */
export const DEFAULT_WEIGHT_UNIT: WeightUnit = 'lb'

/** Grams in one unit. The international pound is exactly 0.453 592 37 kg (agreement of 1959). */
const GRAMS_PER_UNIT: Readonly<Record<WeightUnit, number>> = { lb: 453.59237, kg: 1000 }

/** Display rounding (design 5.2): pounds to the nearest 0.5, kilograms to the nearest 0.25. */
const DISPLAY_STEP: Readonly<Record<WeightUnit, number>> = { lb: 0.5, kg: 0.25 }

/** Whether `value` is a unit the module knows; a stored string from a newer build may not be. */
export function isWeightUnit(value: unknown): value is WeightUnit {
  return typeof value === 'string' && Object.hasOwn(GRAMS_PER_UNIT, value)
}

/**
 * A value typed in `unit` as the nearest whole gram. A value that is not finite gives NaN, which
 * the callers (Zod on the server, the sheet's field) reject before it is stored.
 */
export function toGrams(value: number, unit: WeightUnit): number {
  return Math.round(value * GRAMS_PER_UNIT[unit])
}

/**
 * A load in `unit`, rounded to the display grid (0.5 lb, 0.25 kg), so a value typed on the grid
 * shows back as typed and the text never carries a decimal that the equipment cannot make.
 */
export function fromGrams(grams: number, unit: WeightUnit): number {
  const step = DISPLAY_STEP[unit]
  return Math.round(grams / GRAMS_PER_UNIT[unit] / step) * step
}

/** The number and the unit text of a load, kept apart so a range can share the unit. */
export interface LoadParts {
  /** "115", "47.5" or "52.25". */
  num: string
  /** " lb" or " kg". */
  suffix: string
}

/** A load as number and unit, or null when it cannot be shown (not finite, or below zero). */
export function loadParts(grams: number, unit: WeightUnit): LoadParts | null {
  if (!Number.isFinite(grams) || grams < 0) return null
  return { num: String(fromGrams(grams, unit)), suffix: ` ${unit}` }
}

/** "115 lb", "47.5 lb", "52.25 kg". A load that cannot be shown gives a dash. */
export function formatLoad(grams: number, unit: WeightUnit): string {
  const parts = loadParts(grams, unit)
  return parts === null ? NO_VALUE : `${parts.num}${parts.suffix}`
}

// ---- The loads a piece of equipment can make ---------------------------------------------------

/** `grams` moved onto the display grid of `unit`. */
function onGrid(grams: number, unit: WeightUnit): number {
  return toGrams(fromGrams(grams, unit), unit)
}

const isPositive = (value: number): boolean => Number.isFinite(value) && value > 0

/** The ladder or list of `loads`, on the grid of `unit`; null when it makes no load at all. */
function usableSteps(loads: LoadSteps, unit: WeightUnit): LoadSteps | null {
  if ('loadsG' in loads) {
    const list = [...new Set(loads.loadsG.filter(isPositive).map((g) => onGrid(g, unit)))].sort(
      (a, b) => a - b,
    )
    return list.length === 0 ? null : { loadsG: list }
  }
  const minG = onGrid(loads.minG, unit)
  const stepG = onGrid(loads.stepG, unit)
  const maxG = loads.maxG === null ? null : onGrid(loads.maxG, unit)
  if (!isPositive(minG) || !isPositive(stepG)) return null
  return maxG !== null && maxG < minG ? null : { minG, stepG, maxG }
}

/**
 * The loads the saved equipment makes for `implement`, in the grid of `unit`, or null when the
 * equipment has no such item or the item makes no load (bands and a step carry none). A suggestion
 * and a stepper use only these, so no suggestion asks for a load the equipment cannot make.
 *
 * - A barbell moves from the bar in multiples of its smallest jump and has no top.
 * - Dumbbells and kettlebells move in the entered list or ladder.
 * - A machine moves from its first setting, one step, to the top of the stack.
 */
export function stepsFor(
  equipment: readonly EquipmentConfig[],
  implement: EquipmentKind,
  unit: WeightUnit,
): LoadSteps | null {
  const item = equipment.find((entry) => entry.kind === implement)
  if (item === undefined) return null
  switch (item.kind) {
    case 'barbell':
      return usableSteps({ minG: item.barG, stepG: item.jumpG, maxG: null }, unit)
    case 'dumbbells':
    case 'kettlebells':
      return usableSteps(item.loads, unit)
    case 'leg-press':
    case 'calf-machine':
    case 'leg-curl':
      return usableSteps({ minG: item.stepG, stepG: item.stepG, maxG: item.maxG }, unit)
    case 'bands':
    case 'step':
      return null
  }
}

/** The rungs of a set of steps: `at(k)` is the k-th load, ascending; `top` the last index or null. */
interface Ladder {
  at: (index: number) => number
  top: number | null
  /** The largest index whose load is at or below `grams`; -1 below the lightest. */
  indexAtOrBelow: (grams: number) => number
}

function ladderOf(steps: LoadSteps, unit: WeightUnit): Ladder | null {
  const usable = usableSteps(steps, unit)
  if (usable === null) return null
  if ('loadsG' in usable) {
    const list = usable.loadsG
    return {
      at: (index) => list[index] ?? Number.NaN,
      top: list.length - 1,
      indexAtOrBelow: (grams) => list.findLastIndex((load) => load <= grams),
    }
  }
  // Uniform: the arithmetic is on the display grid, so the k-th load is `toGrams` of a value that
  // a person can type and not a sum of rounded grams, which would drift by a gram every few steps.
  const startUnits = fromGrams(usable.minG, unit)
  const stepUnits = fromGrams(usable.stepG, unit)
  const at = (index: number): number => toGrams(startUnits + index * stepUnits, unit)
  const below = (limit: number): number => {
    let index = Math.floor((limit - usable.minG) / usable.stepG) + 1
    while (index >= 0 && at(index) > limit) index -= 1
    return Math.max(index, -1)
  }
  return {
    at,
    top: usable.maxG === null ? null : below(usable.maxG),
    indexAtOrBelow: (grams) => {
      const index = below(grams)
      return usable.maxG === null ? index : Math.min(index, below(usable.maxG))
    },
  }
}

/** The lightest load of `steps` (the empty bar, the lightest dumbbell, the first stack setting). */
export function lightestLoad(steps: LoadSteps, unit: WeightUnit): number | null {
  const ladder = ladderOf(steps, unit)
  return ladder === null ? null : ladder.at(0)
}

/**
 * The heaviest load of `steps` at or below `loadG`; the lightest load when `loadG` is below it,
 * because no equipment makes less. Null when the steps make no load or `loadG` is not a number.
 */
export function roundDownToStep(steps: LoadSteps, loadG: number, unit: WeightUnit): number | null {
  const ladder = Number.isFinite(loadG) ? ladderOf(steps, unit) : null
  return ladder === null ? null : ladder.at(Math.max(ladder.indexAtOrBelow(loadG), 0))
}

/**
 * The load `count` steps above `loadG` (below when `count` is negative), or null when that is
 * past the lightest load or the top. A load that is not on the ladder (a typed 52 lb with steps of
 * 5 lb) sits between two rungs: one step up lands on the rung above it and one step down on the
 * rung below it. A count of zero rounds down, as `roundDownToStep` does. Null as well for a load
 * that is not a number and a count that is not a whole number.
 */
export function stepFrom(
  steps: LoadSteps,
  loadG: number,
  count: number,
  unit: WeightUnit,
): number | null {
  const ladder = Number.isFinite(loadG) && Number.isInteger(count) ? ladderOf(steps, unit) : null
  if (ladder === null) return null
  if (count === 0) return roundDownToStep(steps, loadG, unit)
  const below = ladder.indexAtOrBelow(loadG)
  const onRung = below >= 0 && ladder.at(below) === loadG
  const target = count > 0 || onRung ? below + count : below + count + 1
  if (target < 0 || (ladder.top !== null && target > ladder.top)) return null
  return ladder.at(target)
}
