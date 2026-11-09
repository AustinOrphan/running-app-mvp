// The sentences about heat days (rule I8, task HT1): the optional "Heat" mark on a run's rating, the
// Today note that says what counts toward the heat block before a warm race, and the safety lines
// behind "How to do it safely". An option, never a target: no count of days, none missing (G5).
//
// The sentence about what counts and the safety lines are written again for Explain in
// `explainTemplates.ts` (`explain.i8-counts`, `explain.i8-safety`, `explain.i8-safety-ask`); a test in
// `heatDays.test.ts` keeps the wording in step. The safety lines come from the passive-heating review the rule cites
// (`heathcote-2018-passive-heating-review`) and general caution, not from a trial of safety.
import type { HeatExposure } from '../types.ts'
import { tpl } from './template.ts'

export const HEAT_DAYS_TEMPLATES = {
  // The control on a rating: what the run's heat was besides the weather.
  'heat.mark.legend': tpl('Heat', {}, { shape: 'label' }),
  'heat.mark.none': tpl('None', {}, { shape: 'label' }),
  'heat.mark.overdressed': tpl('Ran overdressed or in a warm room', {}, { shape: 'label' }),
  'heat.mark.passive': tpl('Hot bath or sauna after', {}, { shape: 'label' }),
  'heat.mark.hint': tpl(
    'Optional. A hot bath or sauna counts after an easy run. Tap again to clear.',
  ),

  // Today: what counts, shown only when the race is expected warm and the block is open.
  'heat.note.heading': tpl('Heat days before a warm race', {}, { shape: 'label' }),
  'heat.note.counts': tpl(
    'Heat days count from runs at {temp} or more, runs in extra layers or a warm room, or a hot bath or sauna after an easy run.',
    { temp: 'temp' },
  ),
  'heat.note.option': tpl('This is an option, not a target. Mark a run on its rating to count it.'),
  'heat.note.safely': tpl('How to do it safely', {}, { shape: 'label' }),
  'heat.safe.drink': tpl('Drink before and after.'),
  'heat.safe.shorter': tpl('Start shorter than you think you need to.'),
  'heat.safe.alone': tpl('Do not do it alone at first.'),
  'heat.safe.stop': tpl('Get out if you feel dizzy, sick or confused.'),
  'heat.safe.clinician': tpl(
    'Skip it with a heart or blood-pressure condition, in pregnancy, or on medicines that change how you handle heat, and ask a clinician.',
  ),
} as const

/** The safety lines in the order they are shown. */
export const HEAT_SAFETY_LINES = [
  'heat.safe.drink',
  'heat.safe.shorter',
  'heat.safe.alone',
  'heat.safe.stop',
  'heat.safe.clinician',
] as const

/** The options of the mark, in the order they are shown; `value` null is "None". */
export const HEAT_MARK_OPTIONS: ReadonlyArray<{
  value: HeatExposure | null
  label: 'heat.mark.none' | 'heat.mark.overdressed' | 'heat.mark.passive'
}> = [
  { value: null, label: 'heat.mark.none' },
  { value: 'overdressed', label: 'heat.mark.overdressed' },
  { value: 'passive', label: 'heat.mark.passive' },
]
