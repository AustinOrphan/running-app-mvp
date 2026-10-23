// Today's sentences (phase 3a design, section 7.6): the readiness verdict, the signals behind it,
// the race countdown and the names of the week strip's days. They are spread into `TEMPLATES`, so
// the copy-lint test renders every one of them. The engine hands over a template id and its slots
// (`readinessVerdict`, `readinessSignals`); `renderFact` writes the words in the runner's units.
//
// Ids are `today.<group>.<name>`. Each id below is built in `shared/engine/readiness.ts`, where a
// `TemplateId` type keeps the two in step.
import type { Quantity } from '../engine/types.ts'
import { roundEstimateSec } from '../units.ts'
import { tpl, type Template } from './template.ts'

export const TODAY_TEMPLATES = {
  // The verdict: one line on what readiness means for today.
  'today.verdict.ready': tpl('Ready as planned.'),
  'today.verdict.low-stays': tpl(
    "Signals are a little low. Today's session is already easy, so it stays.",
  ),
  'today.verdict.easy': tpl('An easy run is the better choice today.'),
  'today.verdict.rest': tpl('A rest day is the better choice today.'),
  'today.verdict.lighter-week': tpl(
    'Recent signals have stayed low for several days. A lighter week may help.',
  ),
  'today.verdict.no-signals': tpl('No readiness signals yet. One tap below adds the first.'),

  // The signals: the two or three readings behind the verdict.
  'today.signal.illness-rest': tpl(
    'Illness was reported: rest until a symptom-free day has passed.',
  ),
  'today.signal.illness-easy': tpl('Returning from illness: easy running only for now.'),
  'today.signal.pain': tpl('Pain of {score} out of 10 was reported.', { score: 'count' }),
  'today.signal.pain-bone': tpl('Focal bone pain was reported.'),
  'today.signal.hrv': tpl('HRV is {latest} ms. Your usual range is {low} to {high} ms.', {
    latest: 'count',
    low: 'count',
    high: 'count',
  }),
  'today.signal.hrv-low': tpl(
    'HRV has dropped to {latest} ms. Your usual range is {low} to {high} ms.',
    { latest: 'count', low: 'count', high: 'count' },
  ),
  'today.signal.hrv-building': tpl(
    'Building your usual HRV range ({readings} of {needed} readings).',
    { readings: 'count', needed: 'count' },
  ),
  'today.signal.resting-hr': tpl('Resting heart rate is {latest}. Your usual is about {usual}.', {
    latest: 'bpm',
    usual: 'bpm',
  }),
  'today.signal.resting-hr-high': tpl(
    'Resting heart rate is {latest}, {above} above your usual {usual}.',
    { latest: 'bpm', above: 'bpm', usual: 'bpm' },
  ),
  'today.signal.resting-hr-only': tpl('Resting heart rate is {latest}.', { latest: 'bpm' }),
  'today.signal.sleep': tpl('Sleep averaged {hours} across {nights} recent nights.', {
    hours: 'duration',
    nights: 'count',
  }),
  'today.signal.sleep-low': tpl(
    'Sleep averaged {hours} across {nights} recent nights, under {floor}.',
    { hours: 'duration', nights: 'count', floor: 'duration' },
  ),
  // One template per answer of the fatigue row (Fresh, Good, Normal, Tired, Drained), so no word
  // is picked in code.
  'today.signal.checkin-fresh': tpl('Check-in: feeling fresh.'),
  'today.signal.checkin-good': tpl('Check-in: feeling good.'),
  'today.signal.checkin-normal': tpl('Check-in: feeling normal.'),
  'today.signal.checkin-tired': tpl('Check-in: feeling tired.'),
  'today.signal.checkin-drained': tpl('Check-in: feeling drained.'),
  'today.signal.checkin-items': tpl('Check-in recorded today.'),
  'today.signal.checkin-items-low': tpl('Some check-in answers are away from normal today.'),

  // The race countdown.
  'today.race.estimate': tpl('Finish estimate {low} to {high}, most likely about {likely}.', {
    low: 'duration',
    high: 'duration',
    likely: 'duration',
  }),
  'today.race.wide': tpl(
    'The range is wide on purpose. Predictions for {distance} rest on thin evidence (grade {grade}).',
    { distance: 'distance', grade: 'text' },
  ),

  // The days of the week strip, as their accessible names.
  'today.week.done': tpl('Done', {}, { shape: 'label' }),
  'today.week.partial': tpl('Partly done', {}, { shape: 'label' }),
  'today.week.skipped': tpl('Skipped', {}, { shape: 'label' }),
  'today.week.planned': tpl('Planned', {}, { shape: 'label' }),
  'today.week.unlogged': tpl('Planned, no run logged', {}, { shape: 'label' }),
  'today.week.free': tpl('No run planned', {}, { shape: 'label' }),
} satisfies Record<string, Template>

/**
 * The slots of `today.race.estimate`: the range and its middle at the precision `formatEstimate`
 * uses, so the sentence and any table beside it read the same.
 */
export function raceEstimateSlots(prediction: {
  lowSec: number
  highSec: number
  predictedSec: number
}): { low: Quantity; high: Quantity; likely: Quantity } {
  const duration = (sec: number): Quantity => ({ kind: 'duration', sec: roundEstimateSec(sec) })
  return {
    low: duration(prediction.lowSec),
    high: duration(prediction.highSec),
    likely: duration(prediction.predictedSec),
  }
}
