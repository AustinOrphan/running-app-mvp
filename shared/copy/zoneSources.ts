// The words about where a zone boundary comes from and when (rules C2, C3, C8): the source label
// under each boundary, the day it stands from, the line that says why heart-rate zones are missing,
// and the Profile's note on when zones change. `ZONE_SOURCE_TEMPLATES` is spread into `TEMPLATES`.
//
// A label says what the figure rests on and nothing more: a typed value is "typed", an age estimate
// names its formula, an accepted offer says it was accepted. The day beside it is the one the data
// holds: the day the profile was last saved, the day an offer was accepted, or, for a boundary that
// is worked out again on every read, the day it was worked out. No day is shown that the data lacks.
import type { Boundary } from '../engine/types.ts'
import { P } from '../engine/params/index.ts'
import type { Units } from '../types.ts'
import { render, tpl } from './template.ts'

export const ZONE_SOURCE_TEMPLATES = {
  'zones.source.tested': tpl('From a test', {}, { shape: 'label' }),
  'zones.source.cs': tpl('From critical speed', {}, { shape: 'label' }),
  'zones.source.dfa': tpl('From DFA alpha1', {}, { shape: 'label' }),
  'zones.source.rpe': tpl('From perceived effort', {}, { shape: 'label' }),
  'zones.source.hrr': tpl('From heart rate reserve', {}, { shape: 'label' }),
  // A maximum typed on the Profile and marked as measured in a test or race. The app has not seen
  // a heart rate of its own: this is the runner's figure.
  'zones.source.hrmax-observed': tpl(
    'Typed on your profile, as measured in a test or race',
    {},
    { shape: 'label' },
  ),
  // The band is the row's own "Range" line, so it is not repeated here; the formula is the
  // maximum's, which every heart-rate boundary of an age-only runner is a share of.
  'zones.source.hrmax-age': tpl(
    'Estimated from your age (maximum = {formula})',
    { formula: 'text' },
    { shape: 'label' },
  ),
  // A typed maximum marked as estimated, a typed threshold heart rate or threshold pace, or one an
  // accepted pace offer moved: the profile holds the figure.
  'zones.source.profile': tpl('Set on your profile', {}, { shape: 'label' }),
  'zones.source.own-line': tpl(
    'From an offer you accepted, your own heart-rate line on cool runs',
    {},
    { shape: 'label' },
  ),

  'zones.source.from-training': tpl(' (from training)', {}, { shape: 'label' }),
  'zones.source.from-training-widened': tpl(
    ' (from training, some older than three months)',
    {},
    { shape: 'label' },
  ),

  // The day, when the data has one.
  'zones.when.saved': tpl('profile last saved {date}', { date: 'date' }, { shape: 'label' }),
  'zones.when.accepted': tpl('offer accepted {date}', { date: 'date' }, { shape: 'label' }),
  'zones.when.worked-out': tpl('as of {date}', { date: 'date' }, { shape: 'label' }),

  // Why a heart-rate zone table can be missing: a threshold heart rate on its own gives no zones.
  'zones.hr.needs-max': tpl(
    'Heart-rate zones need a maximum heart rate or a birth year. Add one on the Profile.',
  ),

  // The Profile's note on when zones change.
  'zones.note.ranges': tpl('Zones are ranges, not single points.'),
  'zones.note.pace': tpl(
    'Pace boundaries follow your recent runs and are worked out again whenever your data changes.',
  ),
  'zones.note.hr': tpl(
    'Heart-rate boundaries change when you type a new value here, when a new year moves the age estimate, or when you accept an offer.',
  ),
} as const

/** The age formula as written: `208 - 0.7 x age`, from the Params. */
export function ageFormulaText(): string {
  return `${String(P.c3.hrMaxIntercept.value)} - ${String(P.c3.hrMaxAgeSlope.value)} x age`
}

const SOURCE_IDS = {
  tested: 'zones.source.tested',
  cs: 'zones.source.cs',
  dfa: 'zones.source.dfa',
  rpe: 'zones.source.rpe',
  hrr: 'zones.source.hrr',
  'hrmax-observed': 'zones.source.hrmax-observed',
  profile: 'zones.source.profile',
  'own-line': 'zones.source.own-line',
} as const satisfies Partial<Record<Boundary['source'], keyof typeof ZONE_SOURCE_TEMPLATES>>

/**
 * How a boundary was found, in words, with the training note of rule A6: the one wording the zone
 * summary and the page that says what the plan can see both use.
 */
export function boundarySourceText(
  boundary: Pick<Boundary, 'source' | 'fromTraining' | 'windowWidened'>,
  units: Units = 'km',
): string {
  const T = ZONE_SOURCE_TEMPLATES
  const label =
    boundary.source === 'hrmax-age'
      ? render(T['zones.source.hrmax-age'], { formula: ageFormulaText() }, units)
      : render(T[SOURCE_IDS[boundary.source]], {}, units)
  if (boundary.fromTraining !== true) return label
  const training =
    boundary.windowWidened === true
      ? T['zones.source.from-training-widened']
      : T['zones.source.from-training']
  return `${label}${render(training, {}, units)}`
}

/**
 * The label and the day: the day the runner's own anchor was set when the data has it, the day a
 * computed boundary was worked out, and no day for an own anchor with none known.
 */
export function boundaryOriginText(
  boundary: Pick<Boundary, 'source' | 'fromTraining' | 'windowWidened' | 'asOf' | 'since'>,
  units: Units = 'km',
): string {
  const T = ZONE_SOURCE_TEMPLATES
  const label = boundarySourceText(boundary, units)
  const date = (iso: string) => ({ kind: 'date', iso, style: 'long' }) as const
  if (boundary.source === 'own-line') {
    return boundary.since === undefined
      ? label
      : `${label}, ${render(T['zones.when.accepted'], { date: date(boundary.since) }, units)}`
  }
  if (boundary.source === 'profile' || boundary.source === 'hrmax-observed') {
    return boundary.since === undefined
      ? label
      : `${label}, ${render(T['zones.when.saved'], { date: date(boundary.since) }, units)}`
  }
  return `${label}, ${render(T['zones.when.worked-out'], { date: date(boundary.asOf) }, units)}`
}
