// The words of the "What the plan can see" page (rule T2): the data the engine reads for one runner
// and how much of it there is. Counts and sources only, no target and no verdict on the data (G5).
// Every sentence is a template, so the shared G5 lint renders it; `PLAN_INPUTS_TEMPLATES` is spread
// into `TEMPLATES`. The figures come from `planInputs` (`shared/domain/planInputs.ts`).
import { render, tpl, type SlotValues, type Template } from './template.ts'

export const PLAN_INPUTS_TEMPLATES = {
  // The page
  'plan-inputs.title': tpl('What the plan can see', {}, { shape: 'label' }),
  'plan-inputs.context': tpl(
    'The data the plan reads for you, and how much of it there is as of today. Counts, not a score.',
  ),
  'plan-inputs.more-note': tpl('The data the plan reads, and how much', {}, { shape: 'label' }),
  'plan-inputs.link.from-profile': tpl('What the plan can see', {}, { shape: 'label' }),
  'plan-inputs.value': tpl('{n}', { n: 'count' }, { shape: 'label' }),
  'plan-inputs.of': tpl('{n} of {need}', { n: 'count', need: 'count' }, { shape: 'label' }),

  // Heart-rate variability
  'plan-inputs.hrv.heading': tpl('Heart-rate variability', {}, { shape: 'label' }),
  'plan-inputs.hrv.window': tpl(
    'Days with a reading are counted over the last {days} days, the wellness window the plan reads.',
    { days: 'count' },
  ),
  'plan-inputs.hrv.rmssd-days': tpl('Days with an rMSSD reading', {}, { shape: 'label' }),
  'plan-inputs.hrv.sdnn-days': tpl('Days with an SDNN reading', {}, { shape: 'label' }),
  'plan-inputs.hrv.baseline': tpl(
    'rMSSD readings in the baseline for today',
    {},
    { shape: 'label' },
  ),
  'plan-inputs.hrv.none': tpl('No heart-rate variability readings are stored.'),
  'plan-inputs.hrv.used-rmssd': tpl(
    'The readiness check (rule J4) uses rMSSD readings, on a log scale, and these are rMSSD.',
  ),
  'plan-inputs.hrv.used-sdnn': tpl(
    'These are SDNN readings, which the plan does not use. The readiness check (rule J4) reads rMSSD only, so the plan works without heart-rate variability.',
  ),
  'plan-inputs.hrv.used-both': tpl(
    'The plan uses the rMSSD readings. It does not use the SDNN readings, which are not mixed with them.',
  ),
  'plan-inputs.hrv.keeps': tpl(
    'The baseline takes the newest {keeps} rMSSD readings from the last {lookback} days and needs {min} of them.',
    { keeps: 'count', lookback: 'count', min: 'count' },
  ),
  'plan-inputs.hrv.keeps-cycle': tpl(
    'The baseline takes every rMSSD reading from the last {lookback} days and needs {min} of them.',
    { lookback: 'count', min: 'count' },
  ),

  // Resting heart rate
  'plan-inputs.rest.heading': tpl('Resting heart rate', {}, { shape: 'label' }),
  'plan-inputs.rest.days': tpl('Days with a resting heart rate', {}, { shape: 'label' }),
  'plan-inputs.rest.baseline': tpl('Readings in the baseline for today', {}, { shape: 'label' }),
  'plan-inputs.rest.keeps': tpl(
    'The baseline takes the newest {keeps} readings from the last {lookback} days and needs {min} of them.',
    { keeps: 'count', lookback: 'count', min: 'count' },
  ),

  // Sleep
  'plan-inputs.sleep.heading': tpl('Sleep', {}, { shape: 'label' }),
  'plan-inputs.sleep.nights': tpl(
    'Recorded in the last {window}',
    { window: 'text' },
    { shape: 'label' },
  ),
  'plan-inputs.sleep.reads': tpl(
    'The weekly check (rule J5) reads the average of the last {window} nights and needs {min} of them recorded.',
    { window: 'count', min: 'count' },
  ),

  // Runs
  'plan-inputs.runs.heading': tpl('Runs', {}, { shape: 'label' }),
  'plan-inputs.runs.window': tpl(
    'Runs and races in the last {days} days, flagged duplicates left out.',
    { days: 'count' },
  ),
  'plan-inputs.runs.count': tpl('Runs and races', {}, { shape: 'label' }),
  'plan-inputs.runs.stream': tpl('With a stored stream', {}, { shape: 'label' }),
  'plan-inputs.runs.altitude': tpl(
    'With climb or descent read from altitude',
    {},
    { shape: 'label' },
  ),
  'plan-inputs.runs.strap': tpl('Heart rate from a chest strap or armband', {}, { shape: 'label' }),
  'plan-inputs.runs.wrist': tpl('Heart rate from the wrist', {}, { shape: 'label' }),
  'plan-inputs.runs.unknown': tpl('Heart-rate source unknown', {}, { shape: 'label' }),
  'plan-inputs.runs.passing': tpl('Passing the heart-rate checks', {}, { shape: 'label' }),
  'plan-inputs.runs.line': tpl(
    'On the heart-rate line, last {weeks} weeks',
    { weeks: 'count' },
    { shape: 'label' },
  ),
  'plan-inputs.runs.note-stream': tpl(
    'The stored stream is what the search for critical speed in training runs, the terrain read and the heart-rate checks use.',
  ),
  'plan-inputs.runs.note-checks': tpl(
    'Only the Trends panels read the heart-rate checks. The heart-rate line of the plan uses steady flat runs and does not.',
  ),
  'plan-inputs.runs.line-fitted': tpl('The heart-rate line is fitted.'),
  'plan-inputs.runs.line-open': tpl(
    'The heart-rate line needs {need} runs and is not fitted yet.',
    {
      need: 'count',
    },
  ),

  // Zones
  'plan-inputs.zones.heading': tpl('Zones', {}, { shape: 'label' }),
  'plan-inputs.zones.context': tpl('Where each zone boundary came from.'),
  'plan-inputs.zones.none': tpl('Not estimated yet.'),

  // Sources
  'plan-inputs.sources.heading': tpl('Sources', {}, { shape: 'label' }),
  'plan-inputs.sources.context': tpl('The connected sources that fed these counts.'),
  'plan-inputs.sources.line': tpl(
    '{label}: activities {activities}, wellness days {wellness}',
    { label: 'text', activities: 'count', wellness: 'count' },
    { shape: 'label' },
  ),
  'plan-inputs.sources.other': tpl(
    'Entered by hand or read from a file: activities {activities}, wellness days {wellness}',
    { activities: 'count', wellness: 'count' },
    { shape: 'label' },
  ),
  'plan-inputs.sources.none': tpl('No activities or wellness days yet.'),

  // How this is made
  'plan-inputs.how': tpl(
    'These counts are taken from the same data the plan reads, with the same windows. They feed nothing back: the page changes no plan and no zone.',
  ),
} satisfies Record<string, Template>

export type PlanInputsId = keyof typeof PLAN_INPUTS_TEMPLATES
type PlainId = {
  [K in PlanInputsId]: keyof (typeof PLAN_INPUTS_TEMPLATES)[K]['slots'] extends never ? K : never
}[PlanInputsId]

/** A sentence or label of the page that has no slot. */
export function planInputsText(id: PlainId): string {
  return render(PLAN_INPUTS_TEMPLATES[id], {}, 'km')
}

/** A sentence or label with slots; counts and dates read the same in either unit system. */
export function planInputsLine<K extends Exclude<PlanInputsId, PlainId>>(
  id: K,
  slots: SlotValues<(typeof PLAN_INPUTS_TEMPLATES)[K]['slots']>,
): string {
  const template: Template = PLAN_INPUTS_TEMPLATES[id]
  return render(template, slots as never, 'km')
}

export function planInputsCount(n: number): { readonly kind: 'count'; readonly n: number } {
  return { kind: 'count', n }
}
