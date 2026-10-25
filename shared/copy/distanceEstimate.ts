// The words for the distance estimate beside a session's minutes (STATUS follow-up 17). The server
// derives the figure (`estimateDistance`, `weekDistanceEstimateM`); this module only words it, in
// the runner's units and through the shared quantity formatter. An estimate is a picture of the
// run, not a target: it reads "about", names the pace it rests on, and is never set against what
// was run.
//
// The figure is coarse on purpose. A distance worked out from minutes carries no tenth of a mile,
// so it reads to the half unit below `HALF_UNIT_BELOW` and to the whole unit from there.
import type { DistanceEstimate, Quantity } from '../engine/types.ts'
import type { Units } from '../types.ts'
import { milesToM } from '../units.ts'
import { render, tpl, type Template } from './template.ts'

/** Below this many miles or kilometres an estimate reads to the half unit. */
const HALF_UNIT_BELOW = 5
const HALF = 0.5

export const DISTANCE_ESTIMATE_TEMPLATES = {
  // A run led by heart rate or effort: its minutes at the runner's easy pace.
  'estimate.about-easy': tpl(
    'about {distance} at your easy pace',
    { distance: 'distance' },
    {
      shape: 'label',
    },
  ),
  // A run with a pace target of its own, and a week: the figure alone.
  'estimate.about': tpl('about {distance}', { distance: 'distance' }, { shape: 'label' }),
  // The caption under the week strip's meter.
  'estimate.week-strip': tpl("The week's planned runs come to about {distance}.", {
    distance: 'distance',
  }),
  // The next session on Today when it has an estimate.
  'estimate.next': tpl('Next: {date}, {title}, {duration}, about {distance}.', {
    date: 'date',
    title: 'text',
    duration: 'minutes',
    distance: 'distance',
  }),
} satisfies Record<string, Template>

/**
 * The estimate as a distance quantity at the precision an estimate deserves: the nearest half mile
 * or kilometre below five, the nearest whole one from there, never less than a half.
 */
export function estimateQuantity(
  distanceM: number,
  units: Units,
): Extract<Quantity, { kind: 'distance' }> {
  const unitM = units === 'mi' ? milesToM(1) : 1000
  const value = distanceM / unitM
  const step = value < HALF_UNIT_BELOW ? HALF : 1
  const rounded = Math.max(HALF, Math.round(value / step) * step)
  return { kind: 'distance', m: rounded * unitM }
}

/** "about 9 mi at your easy pace" for a run led by heart rate or effort, "about 9 mi" for a paced one. */
export function estimateText(estimate: DistanceEstimate, units: Units): string {
  const distance = estimateQuantity(estimate.distanceM, units)
  return estimate.basis === 'easy'
    ? render(DISTANCE_ESTIMATE_TEMPLATES['estimate.about-easy'], { distance }, units)
    : render(DISTANCE_ESTIMATE_TEMPLATES['estimate.about'], { distance }, units)
}

/** "about 19 mi": a week's runs, or a session where the pace need not be named. */
export function estimateAboutText(distanceM: number, units: Units): string {
  return render(
    DISTANCE_ESTIMATE_TEMPLATES['estimate.about'],
    { distance: estimateQuantity(distanceM, units) },
    units,
  )
}

/** The caption under the week strip's meter. */
export function weekStripEstimateText(distanceM: number, units: Units): string {
  return render(
    DISTANCE_ESTIMATE_TEMPLATES['estimate.week-strip'],
    { distance: estimateQuantity(distanceM, units) },
    units,
  )
}

/** "Next: Thu 22 Oct, Long run, 1 h 30 min, about 9 mi." */
export function nextWithEstimateText(
  next: { date: string; title: string; durationMin: number },
  distanceM: number,
  units: Units,
): string {
  return render(
    DISTANCE_ESTIMATE_TEMPLATES['estimate.next'],
    {
      date: { kind: 'date', iso: next.date, style: 'weekday' },
      title: next.title,
      duration: { kind: 'minutes', min: next.durationMin },
      distance: estimateQuantity(distanceM, units),
    },
    units,
  )
}
