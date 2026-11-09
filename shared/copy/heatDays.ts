// The sentences about heat days (rule I8, task HT1): the optional "Heat" mark on a run's rating, the
// Today note that says what counts toward the heat block before a warm race, and the dose and the
// safety lines behind "How to do it safely". An option, never a target: no count of days, none
// missing (G5).
//
// The sentence about what counts, the dose and the safety lines are written again for Explain in
// `explainTemplates.ts` (`explain.i8-*`); a test in `heatDays.test.ts` keeps the wording in step.
// Each line's source is in rule I8 of `research/engine-rules.md`: the passive-heating review
// (`heathcote-2018-passive-heating-review`) for some, general heat-illness guidance for the rest.
import type { HeatExposure } from '../types.ts'
import { tpl } from './template.ts'

export const HEAT_DAYS_TEMPLATES = {
  // The control on a rating: what the run's heat was besides the weather.
  'heat.mark.legend': tpl('Heat', {}, { shape: 'label' }),
  'heat.mark.none': tpl('None', {}, { shape: 'label' }),
  'heat.mark.warm-room': tpl(
    'Ran in a warm room ({temp} or more)',
    { temp: 'temp' },
    { shape: 'label' },
  ),
  'heat.mark.passive': tpl('Hot bath or sauna after', {}, { shape: 'label' }),
  'heat.mark.hint': tpl(
    'Optional. A hot bath or sauna counts after an easy run. Tap again to clear.',
  ),

  // Today: what counts, shown only when the race is expected warm and the block is open.
  'heat.note.heading': tpl('Heat days before a warm race', {}, { shape: 'label' }),
  'heat.note.counts': tpl(
    'Heat days count from runs at {temp} or more, outdoors or in a warm room, or a hot bath or sauna after an easy run.',
    { temp: 'temp' },
  ),
  'heat.note.option': tpl('This is an option, not a target.'),
  'heat.note.safely': tpl('How to do it safely', {}, { shape: 'label' }),
  // What the trials did, not a target.
  'heat.dose': tpl(
    'The trials used about 40 minutes in water at about 40 °C, or about 30 minutes in a sauna, straight after an easy run, on consecutive days.',
  ),
  'heat.safe.drink': tpl('Drink before and after.'),
  'heat.safe.shorter': tpl('Start shorter than that.'),
  'heat.safe.hotter': tpl('Do not go hotter than that.'),
  'heat.safe.not-after': tpl('Not after a hard or long run, or a run in the heat.'),
  'heat.safe.unwell': tpl('Not when you are unwell, feverish or dehydrated.'),
  'heat.safe.alcohol': tpl('No alcohol before or during.'),
  'heat.safe.alone': tpl('Do not do it alone at first.'),
  'heat.safe.stand': tpl('Stand up slowly afterwards.'),
  'heat.safe.stop': tpl('Get out if you feel dizzy, sick or confused.'),
  'heat.safe.clinician': tpl(
    'Skip it with a heart or blood-pressure condition, in pregnancy, or on medicines that change how you handle heat, and ask a clinician.',
  ),
} as const

/** The safety lines in the order they are shown. */
export const HEAT_SAFETY_LINES = [
  'heat.safe.drink',
  'heat.safe.shorter',
  'heat.safe.hotter',
  'heat.safe.not-after',
  'heat.safe.unwell',
  'heat.safe.alcohol',
  'heat.safe.alone',
  'heat.safe.stand',
  'heat.safe.stop',
  'heat.safe.clinician',
] as const

/** The options of the mark, in the order they are shown; `value` null is "None". */
export const HEAT_MARK_OPTIONS: ReadonlyArray<{
  value: HeatExposure | null
  label: 'heat.mark.none' | 'heat.mark.warm-room' | 'heat.mark.passive'
}> = [
  { value: null, label: 'heat.mark.none' },
  { value: 'warm-room', label: 'heat.mark.warm-room' },
  { value: 'passive', label: 'heat.mark.passive' },
]
