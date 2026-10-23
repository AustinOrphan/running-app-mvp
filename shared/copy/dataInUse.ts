// The sentence under "what the advice reads" on the Integrations page (phase 3a design, 5.7):
// how many activities and wellness days the training advice uses and how recent they are. The
// numbers are `StateView.inputs`; the words are the templates below, spread into `TEMPLATES`.
import type { StateInputs, Units } from '../types.ts'
import { render, tpl, type Template } from './template.ts'

export const DATA_IN_USE_TEMPLATES = {
  // Clauses: they sit inside a sentence below, so they carry no stop of their own.
  'data-in-use.activities': tpl(
    '{n} activities, the latest on {latest}',
    { n: 'count', latest: 'date' },
    { shape: 'label' },
  ),
  'data-in-use.activity-one': tpl(
    '1 activity, the latest on {latest}',
    { latest: 'date' },
    { shape: 'label' },
  ),
  'data-in-use.wellness': tpl(
    '{n} days of wellness, the latest on {latest}',
    { n: 'count', latest: 'date' },
    { shape: 'label' },
  ),
  'data-in-use.wellness-one': tpl(
    '1 day of wellness, the latest on {latest}',
    { latest: 'date' },
    { shape: 'label' },
  ),
  // Sentences
  'data-in-use.reads-both': tpl(
    'Training advice reads {activities}, and {wellness}.',
    { activities: 'text', wellness: 'text' },
    { fallback: 'Training advice reads the activities and wellness data on record.' },
  ),
  'data-in-use.reads-activities': tpl(
    'Training advice reads {activities}. No wellness data yet.',
    { activities: 'text' },
    { fallback: 'Training advice reads the activities on record. No wellness data yet.' },
  ),
  'data-in-use.reads-wellness': tpl(
    'Training advice reads {wellness}.',
    { wellness: 'text' },
    { fallback: 'Training advice reads the wellness data on record.' },
  ),
  'data-in-use.no-activities': tpl('No activities yet. Connect a source or import a file.'),
  'data-in-use.duplicate-one': tpl('1 flagged duplicate is left out.'),
  'data-in-use.duplicates': tpl(
    '{n} flagged duplicates are left out.',
    { n: 'count' },
    { fallback: 'Flagged duplicates are left out.' },
  ),
  'data-in-use.loading': tpl('Loading the data summary.'),
  'data-in-use.error': tpl('The data summary did not load.'),
} satisfies Record<string, Template>

const T = DATA_IN_USE_TEMPLATES

/** Counts and dates read the same in either unit system. */
const UNITS: Units = 'km'

function activitiesClause(inputs: StateInputs['activities']): string {
  const latest = { kind: 'date', iso: inputs.latest ?? '' } as const
  return inputs.count === 1
    ? render(T['data-in-use.activity-one'], { latest }, UNITS)
    : render(T['data-in-use.activities'], { n: { kind: 'count', n: inputs.count }, latest }, UNITS)
}

function wellnessClause(inputs: StateInputs['wellness']): string {
  const latest = { kind: 'date', iso: inputs.latest ?? '' } as const
  return inputs.count === 1
    ? render(T['data-in-use.wellness-one'], { latest }, UNITS)
    : render(T['data-in-use.wellness'], { n: { kind: 'count', n: inputs.count }, latest }, UNITS)
}

/**
 * What the advice reads, in sentences: the activities and wellness days in the windows, then the
 * flagged duplicates left out. A source with nothing in its window says so instead of "0".
 */
export function dataInUseText(inputs: StateInputs): string {
  const hasActivities = inputs.activities.count > 0 && inputs.activities.latest !== null
  const hasWellness = inputs.wellness.count > 0 && inputs.wellness.latest !== null
  const sentences: string[] = []

  if (hasActivities && hasWellness) {
    sentences.push(
      render(
        T['data-in-use.reads-both'],
        {
          activities: activitiesClause(inputs.activities),
          wellness: wellnessClause(inputs.wellness),
        },
        UNITS,
      ),
    )
  } else if (hasActivities) {
    sentences.push(
      render(
        T['data-in-use.reads-activities'],
        { activities: activitiesClause(inputs.activities) },
        UNITS,
      ),
    )
  } else {
    sentences.push(render(T['data-in-use.no-activities'], {}, UNITS))
    if (hasWellness) {
      sentences.push(
        render(
          T['data-in-use.reads-wellness'],
          { wellness: wellnessClause(inputs.wellness) },
          UNITS,
        ),
      )
    }
  }

  const duplicates = inputs.activities.flaggedDuplicates
  if (duplicates === 1) sentences.push(render(T['data-in-use.duplicate-one'], {}, UNITS))
  else if (duplicates > 1) {
    sentences.push(
      render(T['data-in-use.duplicates'], { n: { kind: 'count', n: duplicates } }, UNITS),
    )
  }
  return sentences.join(' ')
}

export const DATA_IN_USE_LOADING = render(T['data-in-use.loading'], {}, UNITS)
export const DATA_IN_USE_ERROR = render(T['data-in-use.error'], {}, UNITS)
