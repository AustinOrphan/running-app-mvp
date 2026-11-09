// The words of the run page's charts and of its bars against the plan. Plain functions, as
// `runMap.ts`: the figures vary with the runner's unit. Under G5 (no verdicts, no red, no
// "behind"): the plan is a sketch, and a figure past it is stated, not judged.
import type { Units } from '../types.ts'
import { formatQuantity } from './quantity.ts'

export const STREAM_PANEL_NAME = 'Pace, heart rate and elevation along the run'
export const STREAM_HINT = 'Hover or touch the charts, or use the arrow keys, to read a point.'

export const FASTER_IS_HIGHER = 'Faster is higher.'
export const PLANNED_PACE_NOTE = 'The dashed band is the planned pace.'
export const HOW_TO_READ = 'How to read this'
export const PINNED = 'Pinned.'

/** The closed explanation under the panel. */
export function howToRead(xName: string): string {
  return `Pace, heart rate and elevation share one axis, against ${xName}, and one cursor. ${STREAM_HINT} Press and hold on a touch screen to pin the reading; tap elsewhere or press Escape to release it.`
}
export const PLANNED_PACE_LABEL = 'Planned pace'

/** "Heart rate above the easy ceiling of 142 bpm is hatched." */
export function easyCeilingNote(ceilingBpm: number): string {
  return `Heart rate above the easy ceiling of ${String(Math.round(ceilingBpm))} bpm is hatched.`
}

/** The label drawn on the ceiling line. */
export function easyCeilingLabel(ceilingBpm: number): string {
  return `Easy ceiling ${String(Math.round(ceilingBpm))} bpm`
}

/** Time only: a planned distance is an estimate from the minutes, never set against what was run. */
export const BARS_CAPTION = 'The outline is planned and the solid bar is what was run.'
export const BARS_OVERSHOOT_CAPTION = 'The hatched part is run past the planned figure.'

/** The figure at the end of a bar: "3 h 20 min". */
export function barFigure(durationSec: number, units: Units): string {
  return formatQuantity({ kind: 'duration', sec: durationSec }, units)
}

/** The accessible name of the pair of bars: "Time: planned 3 h 20 min, ran 3 h 30 min." */
export function barPairName(plannedSec: number, ranSec: number, units: Units): string {
  return `Time: planned ${barFigure(plannedSec, units)}, ran ${barFigure(ranSec, units)}.`
}
