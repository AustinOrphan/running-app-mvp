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
// (pounds to the nearest half, kilograms to the nearest quarter). The step helpers below read a
// load as the runner sees it, on that grid, and make each rung of a ladder by rounding once to the
// grid, so a load reached by five presses of a stepper and the same load typed by hand are the
// same integer, in whichever unit the equipment was entered.
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

/** The smallest step a ladder can have in `unit`: one display step, in grams. */
function smallestStep(unit: WeightUnit): number {
  return toGrams(DISPLAY_STEP[unit], unit)
}

/**
 * The ladder or list of `loads` as the equipment makes it, in the equipment's own grams, or null
 * when it makes no load at all. A list is sorted and holds each shown load once. A ladder needs a
 * first load that shows as more than nothing and a step of at least one display step of `unit`, so
 * that two neighbouring rungs never show the same load. Nothing is moved onto the grid here: the
 * rungs are rounded when they are made (`ladderOf`), because a step entered in the other unit
 * (a 5 lb jump shown in kilograms) is a physical size and not a value on this unit's grid.
 */
function usableSteps(loads: LoadSteps, unit: WeightUnit): LoadSteps | null {
  if ('loadsG' in loads) {
    const sorted = loads.loadsG
      .filter((g) => isPositive(g) && isPositive(onGrid(g, unit)))
      .sort((a, b) => a - b)
    // sorted grams give non-decreasing shown loads, so a load shown twice is next to its twin
    const list = sorted.filter(
      (g, index) => index === 0 || onGrid(g, unit) !== onGrid(sorted[index - 1] ?? g, unit),
    )
    return list.length === 0 ? null : { loadsG: list }
  }
  const { minG, stepG, maxG } = loads
  if (!isPositive(minG) || !isPositive(onGrid(minG, unit))) return null
  if (!(Number.isFinite(stepG) && stepG >= smallestStep(unit))) return null
  if (maxG !== null && !(Number.isFinite(maxG) && onGrid(maxG, unit) >= onGrid(minG, unit))) {
    return null
  }
  return { minG, stepG, maxG }
}

/**
 * The loads the saved equipment makes for `implement`, or null when the equipment has no such item
 * or the item makes no load (bands and a step carry none). A suggestion and a stepper use only
 * these, so no suggestion asks for a load the equipment cannot make.
 *
 * - A barbell moves from the bar in multiples of its smallest jump and has no top.
 * - Dumbbells and kettlebells move in the entered list or ladder.
 * - A machine moves from its first setting, one step, to the top of the stack.
 *
 * The result is in the equipment's own grams. `unit` is the unit the loads are shown in; it only
 * decides whether a ladder is usable (a step finer than one display step is refused). The step
 * helpers below turn the result into rungs on the display grid of `unit`.
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

/**
 * The rungs of a set of steps. `at(k)` is the k-th load, ascending, on the display grid of the
 * unit, so it is the gram count a person gets by typing the load that is shown. `top` is the last
 * index, or null without a top. `indexAtOrBelow` is the largest index at or below a load that is
 * already on the grid, and -1 below the lightest.
 */
interface Ladder {
  at: (index: number) => number
  top: number | null
  indexAtOrBelow: (grid: number) => number
}

function ladderOf(steps: LoadSteps, unit: WeightUnit): Ladder | null {
  const usable = usableSteps(steps, unit)
  if (usable === null) return null
  if ('loadsG' in usable) {
    const rungs = usable.loadsG.map((g) => onGrid(g, unit))
    return {
      at: (index) => rungs[index] ?? Number.NaN,
      top: rungs.length - 1,
      indexAtOrBelow: (grid) => rungs.findLastIndex((rung) => rung <= grid),
    }
  }
  // Uniform: the k-th rung is the equipment's own grams, `minG + k * stepG`, rounded once to the
  // display grid. The sum is the load the plates make, and it is off by a fraction of a gram per
  // rung, far less than the grid (a half pound, a quarter kilogram), so the rounded rung is the
  // load as it is shown and as it is typed. Adding rounded grams instead would drift by a gram
  // every few rungs, and rounding a step to the grid would ask for loads the plates cannot make.
  const { minG, stepG } = usable
  const at = (index: number): number => onGrid(minG + index * stepG, unit)
  // The largest index whose rung is at or below `limit`. A rung is within half a display step of
  // the sum and a step is at least one display step, so the estimate is never too low.
  const below = (limit: number): number => {
    let index = Math.floor((limit - minG) / stepG) + 1
    while (index >= 0 && at(index) > limit) index -= 1
    return Math.max(index, -1)
  }
  const top = usable.maxG === null ? null : below(onGrid(usable.maxG, unit))
  return {
    at,
    top,
    indexAtOrBelow: (grid) => {
      const index = below(grid)
      return top === null ? index : Math.min(index, top)
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
 * because no equipment makes less. `loadG` is read as the runner sees it, on the display grid of
 * `unit`, so a load logged in the other unit lands on its rung. Null when the steps make no load
 * or `loadG` is not a number.
 */
export function roundDownToStep(steps: LoadSteps, loadG: number, unit: WeightUnit): number | null {
  const ladder = Number.isFinite(loadG) ? ladderOf(steps, unit) : null
  return ladder === null ? null : ladder.at(Math.max(ladder.indexAtOrBelow(onGrid(loadG, unit)), 0))
}

/**
 * The load `count` steps above `loadG` (below when `count` is negative), or null when that is
 * past the lightest load or the top. A load that is not on the ladder (a typed 52 lb with steps of
 * 5 lb) sits between two rungs: one step up lands on the rung above it and one step down on the
 * rung below it. A count of zero rounds down, as `roundDownToStep` does. `loadG` is read as the
 * runner sees it, on the display grid of `unit`. Null as well for a load that is not a number and a
 * count that is not a whole number.
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
  // read the load as the runner sees it, so a load logged in the other unit is on its rung
  const shown = onGrid(loadG, unit)
  const below = ladder.indexAtOrBelow(shown)
  const onRung = below >= 0 && ladder.at(below) === shown
  const target = count > 0 || onRung ? below + count : below + count + 1
  if (target < 0 || (ladder.top !== null && target > ladder.top)) return null
  return ladder.at(target)
}
