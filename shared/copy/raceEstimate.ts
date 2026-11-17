// The one text of the goal-race estimate (PF1). Today, the Race plan, Goals and My paces word the
// same prediction through `describeEstimate`: a figure and a range at the precision an estimate
// deserves (`roundEstimateSec`), the A6 "at most" wording when the estimate rests on a critical
// speed found from training, and the basis in plain words. The method behind the figure stays in
// the Explain drawer (`METHOD_WORDS` there), and a raw method id is never shown.
import type { Quantity } from '../engine/types.ts'
import type { Units } from '../types.ts'
import { roundEstimateRangeSec, roundEstimateSec } from '../units.ts'
import { render, tpl, type Template } from './template.ts'

type DurationQuantity = Extract<Quantity, { kind: 'duration' }>

/** The methods of `Prediction.method` in plain words, for the Explain drawer. */
export const METHOD_WORDS: Readonly<Record<string, string>> = {
  'personal-exponent': 'a personal exponent fitted to your race times',
  riegel: 'a recent race scaled to this distance',
  'same-distance': 'a race at about this distance',
  'single-anchor': 'one shorter race',
  'critical-speed': 'your critical speed',
  'cs-durability': 'your critical speed, adjusted for how well you hold pace',
  'cs-fraction': 'a share of your critical speed for long events',
}

/** "a", "a and b", "a, b and c". */
function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]!}`
}

/**
 * The method of a prediction (`Prediction.method`, ids joined by "+") in plain words. An id with no
 * entry reads as "a method of the engine's", never as the id.
 */
export function methodWords(method: string): string {
  const words = method
    .split('+')
    .filter((id) => id !== '')
    .map((id) => METHOD_WORDS[id] ?? "a method of the engine's")
  return joinWords([...new Set(words)])
}

export const RACE_ESTIMATE_TEMPLATES = {
  'race-estimate.likely': tpl('Finish estimate {low} to {high}, most likely about {likely}.', {
    low: 'duration',
    high: 'duration',
    likely: 'duration',
  }),
  // A6: a critical speed found from training is a floor, so the time is at most this.
  'race-estimate.at-most': tpl('At most about {likely}. Finish estimate {low} to {high}.', {
    low: 'duration',
    high: 'duration',
    likely: 'duration',
  }),
  'race-estimate.figure': tpl('{duration}', { duration: 'duration' }, { shape: 'label' }),
  'race-estimate.span': tpl(
    '{low} to {high}',
    { low: 'duration', high: 'duration' },
    { shape: 'label' },
  ),
  'race-estimate.label.likely': tpl('Time', {}, { shape: 'label' }),
  'race-estimate.label.at-most': tpl('Time, at most', {}, { shape: 'label' }),
  'race-estimate.label.widened': tpl('Time, from training', {}, { shape: 'label' }),
  'race-estimate.basis.at-most': tpl(
    'It rests on your best efforts in training since {date}, not on races. A short test would likely show faster.',
    { date: 'date' },
  ),
  'race-estimate.basis.widened': tpl(
    'From your best efforts in training since {date}, some older than three months. Fitness may have changed since. A short test narrows it.',
    { date: 'date' },
  ),
} satisfies Record<string, Template>

/** The prediction fields the estimate text reads (`Prediction`, `TodayRace.prediction`). */
export interface EstimateInput {
  lowSec: number
  highSec: number
  predictedSec: number
  /** The day a critical speed from training starts; absent or null when it rests on races or a test. */
  trainingSince?: string | null | undefined
  /** The training window had to be widened, so the time is not an upper bound. */
  trainingWidened?: boolean | null | undefined
}

/** `at-most`: a floor from training (A6). `widened`: from training, older data. `likely`: the rest. */
export type EstimateBasis = 'likely' | 'at-most' | 'widened'

export function estimateBasis(input: EstimateInput): EstimateBasis {
  if (input.trainingSince == null) return 'likely'
  return input.trainingWidened === true ? 'widened' : 'at-most'
}

/**
 * The slots of the range sentences: the middle at the precision `roundEstimateSec` gives and the
 * range rounded outward at the same precision, as the race plan rounds it (R1), so a sentence and any table beside it read the same.
 */
export function raceEstimateSlots(prediction: {
  lowSec: number
  highSec: number
  predictedSec: number
}): { low: DurationQuantity; high: DurationQuantity; likely: DurationQuantity } {
  const duration = (sec: number): DurationQuantity => ({ kind: 'duration', sec })
  const [low, high] = roundEstimateRangeSec(prediction.lowSec, prediction.highSec)
  return {
    low: duration(low),
    high: duration(high),
    likely: duration(roundEstimateSec(prediction.predictedSec)),
  }
}

export interface EstimateText {
  basis: EstimateBasis
  /** The figure alone: "31 h 50 min". */
  figure: string
  /** The range alone: "27 h 40 min to 36 h 20 min". */
  span: string
  /** The label over a figure in a grid: "Time", "Time, at most", "Time, from training". */
  label: string
  /** The sentence with the range and the middle (the A6 form when the estimate is a floor). */
  summary: string
  /** Where the estimate rests when that is training; null when it rests on races or a test. */
  note: string | null
}

const LABELS = {
  likely: 'race-estimate.label.likely',
  'at-most': 'race-estimate.label.at-most',
  widened: 'race-estimate.label.widened',
} as const

/** The goal-race estimate as the four surfaces word it. */
export function describeEstimate(input: EstimateInput, units: Units): EstimateText {
  const T = RACE_ESTIMATE_TEMPLATES
  const basis = estimateBasis(input)
  const slots = raceEstimateSlots(input)
  return {
    basis,
    figure: render(T['race-estimate.figure'], { duration: slots.likely }, units),
    span: render(T['race-estimate.span'], { low: slots.low, high: slots.high }, units),
    label: render(T[LABELS[basis]], {}, units),
    summary: render(
      T[basis === 'at-most' ? 'race-estimate.at-most' : 'race-estimate.likely'],
      slots,
      units,
    ),
    note:
      input.trainingSince == null || basis === 'likely'
        ? null
        : render(
            T[basis === 'widened' ? 'race-estimate.basis.widened' : 'race-estimate.basis.at-most'],
            { date: { kind: 'date', iso: input.trainingSince, style: 'short' } },
            units,
          ),
  }
}

/**
 * The engine's own sentence for the training basis (a `Prediction.conditions` line, rule A6). The
 * estimate text says the same in `note`, so a page that shows both leaves the condition out.
 */
export function isTrainingBasisCondition(line: string): boolean {
  return line.startsWith('Critical speed comes from the best efforts in training since ')
}
