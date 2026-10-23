// The words of the prediction track record (rule L7, phase 3a design section 11.6): the lead, the
// summary across races, a race's headline, the result sheet and its toasts. Every sentence is a
// template, so the shared G5 lint covers it; the helpers below pick the template for a scored
// record and fill it. The record describes the prediction, not the runner: a difference has a
// direction and is never pass or fail, and nothing here says "behind", "missed" or "PB".
//
// `TRACK_RECORD_TEMPLATES` is the registry for this file. The copy test renders every entry and
// every helper over a grid of inputs; the entries can also be spread into `TEMPLATES`.
import type { RecordSummary, ScoredPrediction } from '../engine/backtest.ts'
import type { RaceResultView, Units } from '../types.ts'
import { render, tpl, type Template } from './template.ts'

export const TRACK_RECORD_TEMPLATES = {
  // Headings and buttons
  'trackRecord.heading': tpl('Prediction track record', {}, { shape: 'label' }),
  'trackRecord.recordResult': tpl('Record result', {}, { shape: 'label' }),
  'trackRecord.editResult': tpl('Edit result', {}, { shape: 'label' }),
  'trackRecord.recordResultFor': tpl(
    'Record result for {goal}',
    { goal: 'text' },
    { shape: 'label', fallback: 'Record result' },
  ),
  'trackRecord.editResultFor': tpl(
    'Edit result for {goal}',
    { goal: 'text' },
    { shape: 'label', fallback: 'Edit result' },
  ),
  'trackRecord.saveResult': tpl('Save result', {}, { shape: 'label' }),
  'trackRecord.removeResult': tpl('Remove result', {}, { shape: 'label' }),

  // Goal outlook: predictions logged before the race
  'trackRecord.outlook': tpl(
    '{count} predictions logged so far, one a week. After the race, add the result to see how they compared.',
    { count: 'count' },
    { fallback: 'After the race, add the result to see how the predictions compared.' },
  ),
  'trackRecord.outlookOne': tpl(
    '1 prediction logged so far. After the race, add the result to see how it compared.',
  ),

  // The lead of the track record
  'trackRecord.lead.written': tpl('The app writes down its predicted finish time once a week.'),
  'trackRecord.lead.compared': tpl('After a race, each prediction is compared with what happened.'),
  'trackRecord.lead.describes': tpl('The comparison describes the prediction, not the race.'),

  // Summary across races: from the threshold of rule L7 on
  'trackRecord.summary.insideOnce': tpl(
    'Across {races} races the result was inside the predicted range once.',
    { races: 'count' },
  ),
  'trackRecord.summary.insideTwice': tpl(
    'Across {races} races the result was inside the predicted range twice.',
    { races: 'count' },
  ),
  'trackRecord.summary.insideTimes': tpl(
    'Across {races} races the result was inside the predicted range {inside} times.',
    { races: 'count', inside: 'count' },
  ),
  'trackRecord.summary.medianSlower': tpl(
    'The median difference was {pct} slower than predicted.',
    {
      pct: 'percent',
    },
  ),
  'trackRecord.summary.medianFaster': tpl(
    'The median difference was {pct} faster than predicted.',
    {
      pct: 'percent',
    },
  ),
  'trackRecord.summary.medianSame': tpl('The median result was within 0.1% of the predicted time.'),

  // Summary before the threshold: each race stands on its own
  'trackRecord.summary.noneYet': tpl('No race compared so far.'),
  'trackRecord.summary.oneYet': tpl('One race compared so far.'),
  'trackRecord.summary.twoYet': tpl('Two races compared so far.'),
  'trackRecord.summary.someYet': tpl('{races} races compared so far.', { races: 'count' }),
  'trackRecord.summary.needsMore': tpl(
    'A summary across races needs {needed} more; until then each race stands on its own.',
    { needed: 'count' },
  ),

  // One race: the last prediction, then the result against it
  'trackRecord.headline.last': tpl(
    'The last prediction, made {days} days before the race, was {predicted} ({low} to {high}).',
    { days: 'count', predicted: 'duration', low: 'duration', high: 'duration' },
  ),
  'trackRecord.headline.lastDayBefore': tpl(
    'The last prediction, made the day before the race, was {predicted} ({low} to {high}).',
    { predicted: 'duration', low: 'duration', high: 'duration' },
  ),
  'trackRecord.headline.slowerInside': tpl(
    'The result was {diff} slower than predicted ({pct}), inside the range.',
    { diff: 'duration', pct: 'percent' },
  ),
  'trackRecord.headline.slowerOutside': tpl(
    'The result was {diff} slower than predicted ({pct}), outside the range.',
    { diff: 'duration', pct: 'percent' },
  ),
  'trackRecord.headline.fasterInside': tpl(
    'The result was {diff} faster than predicted ({pct}), inside the range.',
    { diff: 'duration', pct: 'percent' },
  ),
  'trackRecord.headline.fasterOutside': tpl(
    'The result was {diff} faster than predicted ({pct}), outside the range.',
    { diff: 'duration', pct: 'percent' },
  ),
  'trackRecord.headline.sameInside': tpl('The result matched the prediction, inside the range.'),
  'trackRecord.headline.sameOutside': tpl('The result matched the prediction, outside the range.'),

  // A race that was not finished
  'trackRecord.unscored.didNotFinish': tpl(
    'Did not finish. There is nothing to compare, so these {count} predictions are not scored.',
    { count: 'count' },
  ),
  'trackRecord.unscored.didNotFinishOne': tpl(
    'Did not finish. There is nothing to compare, so this prediction is not scored.',
  ),
  'trackRecord.unscored.didNotFinishNone': tpl('Did not finish. There is nothing to compare.'),

  // Chart and table
  'trackRecord.chart.name': tpl(
    'Weekly predicted finish times and ranges for {race}, against the result',
    { race: 'text' },
    { shape: 'label', fallback: 'Weekly predicted finish times and ranges against the result' },
  ),
  'trackRecord.chart.resultLine': tpl('Result', {}, { shape: 'label' }),
  'trackRecord.table.caption': tpl(
    'Weekly predictions for {race} compared with the result.',
    { race: 'text' },
    { fallback: 'Weekly predictions compared with the result.' },
  ),
  'trackRecord.table.weeksBefore': tpl('Weeks before', {}, { shape: 'label' }),
  'trackRecord.table.predicted': tpl('Predicted', {}, { shape: 'label' }),
  'trackRecord.table.range': tpl('Range', {}, { shape: 'label' }),
  'trackRecord.table.difference': tpl('Result against prediction', {}, { shape: 'label' }),
  'trackRecord.table.inRange': tpl('In range', {}, { shape: 'label' }),
  'trackRecord.table.rangeCell': tpl(
    '{low} to {high}',
    { low: 'duration', high: 'duration' },
    { shape: 'label', fallback: 'No range' },
  ),
  'trackRecord.table.slowerCell': tpl(
    '{diff} slower ({pct})',
    { diff: 'duration', pct: 'percent' },
    { shape: 'label', fallback: 'No difference to show' },
  ),
  'trackRecord.table.fasterCell': tpl(
    '{diff} faster ({pct})',
    { diff: 'duration', pct: 'percent' },
    { shape: 'label', fallback: 'No difference to show' },
  ),
  'trackRecord.table.sameCell': tpl('Matched', {}, { shape: 'label' }),
  'trackRecord.table.insideCell': tpl('Yes', {}, { shape: 'label' }),
  'trackRecord.table.outsideCell': tpl('No', {}, { shape: 'label' }),

  // The result sheet and its toasts
  'trackRecord.sheet.timeHint': tpl('Official time as h:mm:ss, like 3:52:10.'),
  'trackRecord.sheet.linkNotice': tpl(
    'Linking marks this activity as a race, so later predictions can use it as an anchor, and zones and watch targets may change with it.',
  ),
  'trackRecord.sheet.removeConfirm': tpl(
    'Remove this result? The weekly predictions stay logged and are no longer compared.',
  ),
  'trackRecord.toast.saved': tpl('Result saved. {count} predictions compared.', {
    count: 'count',
  }),
  'trackRecord.toast.savedOne': tpl('Result saved. 1 prediction compared.'),
  'trackRecord.toast.savedNotFinished': tpl(
    'Result saved. Nothing to compare for a race not finished.',
  ),
} satisfies Record<string, Template>

export type TrackRecordTemplateId = keyof typeof TRACK_RECORD_TEMPLATES

/** A percentage to one decimal, always positive: the direction is in the words. */
function shownPct(pct: number): number {
  return Math.round(Math.abs(pct) * 10) / 10
}

const count = (n: number) => ({ kind: 'count', n }) as const
const duration = (sec: number) => ({ kind: 'duration', sec }) as const
const percent = (pct: number) => ({ kind: 'percent', pct: shownPct(pct) }) as const

/** The three sentences above the track record. */
export function trackRecordLead(units: Units): string[] {
  const t = TRACK_RECORD_TEMPLATES
  return [
    render(t['trackRecord.lead.written'], {}, units),
    render(t['trackRecord.lead.compared'], {}, units),
    render(t['trackRecord.lead.describes'], {}, units),
  ]
}

/** The line on a goal about predictions logged so far; null when there are none yet. */
export function outlookLine(predictionCount: number, units: Units): string | null {
  const t = TRACK_RECORD_TEMPLATES
  if (predictionCount < 1) return null
  return predictionCount === 1
    ? render(t['trackRecord.outlookOne'], {}, units)
    : render(t['trackRecord.outlook'], { count: count(predictionCount) }, units)
}

/**
 * The summary across races. From the threshold of rule L7 it names how often the result was inside
 * the range and the median difference; before it, the races compared so far and how many more the
 * summary needs.
 */
export function summarySentences(summary: RecordSummary, units: Units): string[] {
  const t = TRACK_RECORD_TEMPLATES
  const { raceCount, insideCount, medianSignedPct } = summary
  if (summary.enough && insideCount !== null && medianSignedPct !== null) {
    const races = count(raceCount)
    const inside =
      insideCount === 1
        ? render(t['trackRecord.summary.insideOnce'], { races }, units)
        : insideCount === 2
          ? render(t['trackRecord.summary.insideTwice'], { races }, units)
          : render(
              t['trackRecord.summary.insideTimes'],
              { races, inside: count(insideCount) },
              units,
            )
    const pct = percent(medianSignedPct)
    const median =
      pct.pct === 0
        ? render(t['trackRecord.summary.medianSame'], {}, units)
        : medianSignedPct > 0
          ? render(t['trackRecord.summary.medianSlower'], { pct }, units)
          : render(t['trackRecord.summary.medianFaster'], { pct }, units)
    return [inside, median]
  }
  const sofar =
    raceCount <= 0
      ? render(t['trackRecord.summary.noneYet'], {}, units)
      : raceCount === 1
        ? render(t['trackRecord.summary.oneYet'], {}, units)
        : raceCount === 2
          ? render(t['trackRecord.summary.twoYet'], {}, units)
          : render(t['trackRecord.summary.someYet'], { races: count(raceCount) }, units)
  return summary.needed > 0
    ? [sofar, render(t['trackRecord.summary.needsMore'], { needed: count(summary.needed) }, units)]
    : [sofar]
}

/** The last prediction before the race and the result against it: two sentences. */
export function headlineSentences(headline: ScoredPrediction, units: Units): string[] {
  const t = TRACK_RECORD_TEMPLATES
  const range = {
    predicted: duration(headline.predictedSec),
    low: duration(headline.lowSec),
    high: duration(headline.highSec),
  }
  const made =
    headline.daysBefore === 1
      ? render(t['trackRecord.headline.lastDayBefore'], range, units)
      : render(
          t['trackRecord.headline.last'],
          { days: count(headline.daysBefore), ...range },
          units,
        )
  const diff = { diff: duration(Math.abs(headline.errorSec)), pct: percent(headline.errorPct) }
  const inside = headline.inside
  let result: string
  if (headline.errorSec === 0) {
    result = render(
      t[inside ? 'trackRecord.headline.sameInside' : 'trackRecord.headline.sameOutside'],
      {},
      units,
    )
  } else if (headline.errorSec > 0) {
    result = render(
      t[inside ? 'trackRecord.headline.slowerInside' : 'trackRecord.headline.slowerOutside'],
      diff,
      units,
    )
  } else {
    result = render(
      t[inside ? 'trackRecord.headline.fasterInside' : 'trackRecord.headline.fasterOutside'],
      diff,
      units,
    )
  }
  return [made, result]
}

/** The sentence for a race that was not finished, naming how many predictions stay unscored. */
export function didNotFinishSentence(unscoredCount: number, units: Units): string {
  const t = TRACK_RECORD_TEMPLATES
  if (unscoredCount < 1) return render(t['trackRecord.unscored.didNotFinishNone'], {}, units)
  return unscoredCount === 1
    ? render(t['trackRecord.unscored.didNotFinishOne'], {}, units)
    : render(t['trackRecord.unscored.didNotFinish'], { count: count(unscoredCount) }, units)
}

/** The "Range" cell of a weekly row. */
export function rangeCell(point: ScoredPrediction, units: Units): string {
  return render(
    TRACK_RECORD_TEMPLATES['trackRecord.table.rangeCell'],
    { low: duration(point.lowSec), high: duration(point.highSec) },
    units,
  )
}

/** The "Result against prediction" cell of a weekly row. */
export function differenceCell(point: ScoredPrediction, units: Units): string {
  const t = TRACK_RECORD_TEMPLATES
  if (point.errorSec === 0) return render(t['trackRecord.table.sameCell'], {}, units)
  const slots = { diff: duration(Math.abs(point.errorSec)), pct: percent(point.errorPct) }
  return point.errorSec > 0
    ? render(t['trackRecord.table.slowerCell'], slots, units)
    : render(t['trackRecord.table.fasterCell'], slots, units)
}

/** The "In range" cell of a weekly row. */
export function inRangeCell(point: ScoredPrediction, units: Units): string {
  const t = TRACK_RECORD_TEMPLATES
  return render(
    t[point.inside ? 'trackRecord.table.insideCell' : 'trackRecord.table.outsideCell'],
    {},
    units,
  )
}

/** The toast after a result is saved: how many weekly predictions were compared, or why none. */
export function savedToast(
  result: Pick<RaceResultView, 'outcome' | 'scoredPredictions'>,
  units: Units,
): string {
  const t = TRACK_RECORD_TEMPLATES
  if (result.outcome !== 'finished')
    return render(t['trackRecord.toast.savedNotFinished'], {}, units)
  return result.scoredPredictions === 1
    ? render(t['trackRecord.toast.savedOne'], {}, units)
    : render(t['trackRecord.toast.saved'], { count: count(result.scoredPredictions) }, units)
}
