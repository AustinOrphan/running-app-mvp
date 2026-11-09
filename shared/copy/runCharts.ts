// The words of the run page's charts and of its bars against the plan. Plain functions, as
// `runMap.ts`: the figures vary with the runner's unit. Under G5 (no verdicts, no red, no
// "behind"): the plan is a sketch, and a figure past it is stated, not judged.
import type { Units } from '../types.ts'
import { formatQuantity } from './quantity.ts'

export const STREAM_PANEL_NAME = 'Pace, heart rate and elevation along the run'
export const STREAM_HINT = 'Touch or hover the charts, or use the arrow keys, to read a point.'

export const FASTER_IS_HIGHER = 'Faster is higher.'
export const PLANNED_PACE_NOTE = 'The dashed band is the pace the session planned.'
export const PLANNED_PACE_LABEL = 'Planned pace'

/** "Heart rate above the easy ceiling of 142 bpm is hatched." */
export function easyCeilingNote(ceilingBpm: number): string {
  return `Heart rate above the easy ceiling of ${String(Math.round(ceilingBpm))} bpm is hatched.`
}

/** The label drawn on the ceiling line. */
export function easyCeilingLabel(ceilingBpm: number): string {
  return `Easy ceiling ${String(Math.round(ceilingBpm))} bpm`
}

export const BARS_CAPTION = 'The outline is planned and the solid bar is what was run.'
export const BARS_OVERSHOOT_CAPTION = 'The hatched part is run past the planned figure.'

export type BarMeasure = 'time' | 'distance'

export const BAR_MEASURE_LABEL: Record<BarMeasure, string> = { time: 'Time', distance: 'Distance' }

/** The figure at the end of a bar: "3 h 20 min" or "19.52 mi". */
export function barFigure(measure: BarMeasure, value: number, units: Units): string {
  return measure === 'time'
    ? formatQuantity({ kind: 'duration', sec: value }, units)
    : formatQuantity({ kind: 'distance', m: value }, units)
}

/** The accessible name of one pair of bars: "Time: planned 3 h 20 min, ran 3 h 30 min." */
export function barPairName(
  measure: BarMeasure,
  planned: number,
  ran: number,
  units: Units,
): string {
  return `${BAR_MEASURE_LABEL[measure]}: planned ${barFigure(measure, planned, units)}, ran ${barFigure(measure, ran, units)}.`
}
