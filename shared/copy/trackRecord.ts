// The words of the prediction track record (rule L7, phase 3a design section 11.6): the lead, the
// summary across races, a race's headline, the result sheet and its toasts. Every sentence is a
// template, so the shared G5 lint covers it; the helpers below pick the template for a scored
// record and fill it. The record describes the prediction, not the runner: a difference has a
// direction and is never pass or fail, and nothing here says "behind", "missed" or "PB".
//
// `TRACK_RECORD_TEMPLATES` is the registry for this file. The copy test renders every entry and
// every helper over a grid of inputs; the entries can also be spread into `TEMPLATES`.
import type { RaceScore, RecordSummary, ScoredPrediction } from '../engine/backtest.ts'
import type { RaceResultView, Units } from '../types.ts'
import { render, tpl, type Template } from './template.ts'

export const TRACK_RECORD_TEMPLATES = {
  // Headings and buttons
  'track-record.heading': tpl('Prediction track record', {}, { shape: 'label' }),
  'track-record.record-result': tpl('Record result', {}, { shape: 'label' }),
  'track-record.edit-result': tpl('Edit result', {}, { shape: 'label' }),
  'track-record.record-result-for': tpl(
    'Record result for {goal}',
    { goal: 'text' },
    { shape: 'label', fallback: 'Record result' },
  ),
  'track-record.edit-result-for': tpl(
    'Edit result for {goal}',
    { goal: 'text' },
    { shape: 'label', fallback: 'Edit result' },
  ),
  'track-record.save-result': tpl('Save result', {}, { shape: 'label' }),
  'track-record.remove-result': tpl('Remove result', {}, { shape: 'label' }),

  // Goal outlook: predictions logged before the race
  'track-record.outlook': tpl(
    '{count} predictions logged so far, one a week. After the race, add the result to see how they compared.',
    { count: 'count' },
    { fallback: 'After the race, add the result to see how the predictions compared.' },
  ),
  'track-record.outlook-one': tpl(
    '1 prediction logged so far. After the race, add the result to see how it compared.',
  ),

  // The lead of the track record
  'track-record.lead.written': tpl('The app writes down its predicted finish time once a week.'),
  'track-record.lead.compared': tpl(
    'After a race, each prediction is compared with what happened.',
  ),
  'track-record.lead.describes': tpl('The comparison describes the prediction, not the race.'),

  // Summary across races: from the threshold of rule L7 on
  'track-record.summary.inside-once': tpl(
    'Across {races} races the result was inside the predicted range once.',
    { races: 'count' },
  ),
  'track-record.summary.inside-twice': tpl(
    'Across {races} races the result was inside the predicted range twice.',
    { races: 'count' },
  ),
  'track-record.summary.inside-times': tpl(
    'Across {races} races the result was inside the predicted range {inside} times.',
    { races: 'count', inside: 'count' },
  ),
  'track-record.summary.median-slower': tpl(
    'The median difference was {pct} slower than predicted.',
    {
      pct: 'percent',
    },
  ),
  'track-record.summary.median-faster': tpl(
    'The median difference was {pct} faster than predicted.',
    {
      pct: 'percent',
    },
  ),
  'track-record.summary.median-same': tpl(
    'The median result was within 0.1% of the predicted time.',
  ),

  // Summary before the threshold: each race stands on its own
  'track-record.summary.none-yet': tpl('No race compared so far.'),
  'track-record.summary.one-yet': tpl('One race compared so far.'),
  'track-record.summary.two-yet': tpl('Two races compared so far.'),
  'track-record.summary.some-yet': tpl('{races} races compared so far.', { races: 'count' }),
  'track-record.summary.needs-more': tpl(
    'A summary across races needs {needed} more; until then each race stands on its own.',
    { needed: 'count' },
  ),

  // One race: the last prediction, then the result against it
  'track-record.headline.last': tpl(
    'The last prediction, made {days} days before the race, was {predicted} ({low} to {high}).',
    { days: 'count', predicted: 'duration', low: 'duration', high: 'duration' },
  ),
  'track-record.headline.last-day-before': tpl(
    'The last prediction, made the day before the race, was {predicted} ({low} to {high}).',
    { predicted: 'duration', low: 'duration', high: 'duration' },
  ),
  'track-record.headline.slower-inside': tpl(
    'The result was {diff} slower than predicted ({pct}), inside the range.',
    { diff: 'duration', pct: 'percent' },
  ),
  'track-record.headline.slower-outside': tpl(
    'The result was {diff} slower than predicted ({pct}), outside the range.',
    { diff: 'duration', pct: 'percent' },
  ),
  'track-record.headline.faster-inside': tpl(
    'The result was {diff} faster than predicted ({pct}), inside the range.',
    { diff: 'duration', pct: 'percent' },
  ),
  'track-record.headline.faster-outside': tpl(
    'The result was {diff} faster than predicted ({pct}), outside the range.',
    { diff: 'duration', pct: 'percent' },
  ),
  'track-record.headline.same-inside': tpl('The result matched the prediction, inside the range.'),
  'track-record.headline.same-outside': tpl(
    'The result matched the prediction, outside the range.',
  ),

  // A race that was not finished
  'track-record.unscored.did-not-finish': tpl(
    'Did not finish. There is nothing to compare, so these {count} predictions are not scored.',
    { count: 'count' },
  ),
  'track-record.unscored.did-not-finish-one': tpl(
    'Did not finish. There is nothing to compare, so this prediction is not scored.',
  ),
  'track-record.unscored.did-not-finish-none': tpl('Did not finish. There is nothing to compare.'),

  // A finished race with predictions that were not scored, or none to score
  'track-record.unscored.other-course': tpl(
    '{count} predictions were made for a different course, so they are not scored.',
    { count: 'count' },
  ),
  'track-record.unscored.other-course-one': tpl(
    '1 prediction was made for a different course, so it is not scored.',
  ),
  'track-record.unscored.no-predictions': tpl(
    'No predictions were logged before this race, so there is nothing to compare.',
  ),

  // Chart and table
  'track-record.chart.name': tpl(
    'Weekly predicted finish times and ranges for {race}, against the result',
    { race: 'text' },
    { shape: 'label', fallback: 'Weekly predicted finish times and ranges against the result' },
  ),
  'track-record.chart.result-line': tpl('Result', {}, { shape: 'label' }),
  'track-record.table.caption': tpl(
    'Weekly predictions for {race} compared with the result.',
    { race: 'text' },
    { fallback: 'Weekly predictions compared with the result.' },
  ),
  'track-record.table.weeks-before': tpl('Weeks before', {}, { shape: 'label' }),
  'track-record.table.predicted': tpl('Predicted', {}, { shape: 'label' }),
  'track-record.table.range': tpl('Range', {}, { shape: 'label' }),
  'track-record.table.difference': tpl('Result against prediction', {}, { shape: 'label' }),
  'track-record.table.in-range': tpl('In range', {}, { shape: 'label' }),
  'track-record.table.range-cell': tpl(
    '{low} to {high}',
    { low: 'duration', high: 'duration' },
    { shape: 'label', fallback: 'No range' },
  ),
  'track-record.table.slower-cell': tpl(
    '{diff} slower ({pct})',
    { diff: 'duration', pct: 'percent' },
    { shape: 'label', fallback: 'No difference to show' },
  ),
  'track-record.table.faster-cell': tpl(
    '{diff} faster ({pct})',
    { diff: 'duration', pct: 'percent' },
    { shape: 'label', fallback: 'No difference to show' },
  ),
  'track-record.table.same-cell': tpl('Matched', {}, { shape: 'label' }),
  'track-record.table.inside-cell': tpl('Yes', {}, { shape: 'label' }),
  'track-record.table.outside-cell': tpl('No', {}, { shape: 'label' }),

  // The result sheet and its toasts
  'track-record.sheet.time-hint': tpl('Official time as h:mm:ss, like 3:52:10.'),
  'track-record.sheet.link-notice': tpl(
    'Linking marks this activity as a race, so later predictions can use it as an anchor, and zones and watch targets may change with it.',
  ),
  'track-record.sheet.remove-confirm': tpl(
    'Remove this result? The weekly predictions stay logged and are no longer compared.',
  ),
  'track-record.toast.saved': tpl('Result saved. {count} predictions compared.', {
    count: 'count',
  }),
  'track-record.toast.saved-one': tpl('Result saved. 1 prediction compared.'),
  'track-record.toast.saved-not-finished': tpl(
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
    render(t['track-record.lead.written'], {}, units),
    render(t['track-record.lead.compared'], {}, units),
    render(t['track-record.lead.describes'], {}, units),
  ]
}

/** The line on a goal about predictions logged so far; null when there are none yet. */
export function outlookLine(predictionCount: number, units: Units): string | null {
  const t = TRACK_RECORD_TEMPLATES
  if (predictionCount < 1) return null
  return predictionCount === 1
    ? render(t['track-record.outlook-one'], {}, units)
    : render(t['track-record.outlook'], { count: count(predictionCount) }, units)
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
        ? render(t['track-record.summary.inside-once'], { races }, units)
        : insideCount === 2
          ? render(t['track-record.summary.inside-twice'], { races }, units)
          : render(
              t['track-record.summary.inside-times'],
              { races, inside: count(insideCount) },
              units,
            )
    const pct = percent(medianSignedPct)
    const median =
      pct.pct === 0
        ? render(t['track-record.summary.median-same'], {}, units)
        : medianSignedPct > 0
          ? render(t['track-record.summary.median-slower'], { pct }, units)
          : render(t['track-record.summary.median-faster'], { pct }, units)
    return [inside, median]
  }
  const sofar =
    raceCount <= 0
      ? render(t['track-record.summary.none-yet'], {}, units)
      : raceCount === 1
        ? render(t['track-record.summary.one-yet'], {}, units)
        : raceCount === 2
          ? render(t['track-record.summary.two-yet'], {}, units)
          : render(t['track-record.summary.some-yet'], { races: count(raceCount) }, units)
  return summary.needed > 0
    ? [
        sofar,
        render(t['track-record.summary.needs-more'], { needed: count(summary.needed) }, units),
      ]
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
      ? render(t['track-record.headline.last-day-before'], range, units)
      : render(
          t['track-record.headline.last'],
          { days: count(headline.daysBefore), ...range },
          units,
        )
  const diff = { diff: duration(Math.abs(headline.errorSec)), pct: percent(headline.errorPct) }
  const inside = headline.inside
  let result: string
  if (headline.errorSec === 0) {
    result = render(
      t[inside ? 'track-record.headline.same-inside' : 'track-record.headline.same-outside'],
      {},
      units,
    )
  } else if (headline.errorSec > 0) {
    result = render(
      t[inside ? 'track-record.headline.slower-inside' : 'track-record.headline.slower-outside'],
      diff,
      units,
    )
  } else {
    result = render(
      t[inside ? 'track-record.headline.faster-inside' : 'track-record.headline.faster-outside'],
      diff,
      units,
    )
  }
  return [made, result]
}

/** The sentence for a race that was not finished, naming how many predictions stay unscored. */
export function didNotFinishSentence(unscoredCount: number, units: Units): string {
  const t = TRACK_RECORD_TEMPLATES
  if (unscoredCount < 1) return render(t['track-record.unscored.did-not-finish-none'], {}, units)
  return unscoredCount === 1
    ? render(t['track-record.unscored.did-not-finish-one'], {}, units)
    : render(t['track-record.unscored.did-not-finish'], { count: count(unscoredCount) }, units)
}

/**
 * The note under a race about the predictions that were not scored, or null when every prediction
 * was. A race not finished names how many stay unscored; a finished race names the predictions
 * made for a different course, or says that none were logged before the race.
 */
export function unscoredSentence(
  race: Pick<RaceScore, 'outcome' | 'points' | 'unscoredCount'>,
  units: Units,
): string | null {
  const t = TRACK_RECORD_TEMPLATES
  if (race.outcome !== 'finished') return didNotFinishSentence(race.unscoredCount, units)
  if (race.unscoredCount > 0) {
    return race.unscoredCount === 1
      ? render(t['track-record.unscored.other-course-one'], {}, units)
      : render(t['track-record.unscored.other-course'], { count: count(race.unscoredCount) }, units)
  }
  return race.points.length === 0
    ? render(t['track-record.unscored.no-predictions'], {}, units)
    : null
}

/** The "Range" cell of a weekly row. */
export function rangeCell(point: ScoredPrediction, units: Units): string {
  return render(
    TRACK_RECORD_TEMPLATES['track-record.table.range-cell'],
    { low: duration(point.lowSec), high: duration(point.highSec) },
    units,
  )
}

/** The "Result against prediction" cell of a weekly row. */
export function differenceCell(point: ScoredPrediction, units: Units): string {
  const t = TRACK_RECORD_TEMPLATES
  if (point.errorSec === 0) return render(t['track-record.table.same-cell'], {}, units)
  const slots = { diff: duration(Math.abs(point.errorSec)), pct: percent(point.errorPct) }
  return point.errorSec > 0
    ? render(t['track-record.table.slower-cell'], slots, units)
    : render(t['track-record.table.faster-cell'], slots, units)
}

/** The "In range" cell of a weekly row. */
export function inRangeCell(point: ScoredPrediction, units: Units): string {
  const t = TRACK_RECORD_TEMPLATES
  return render(
    t[point.inside ? 'track-record.table.inside-cell' : 'track-record.table.outside-cell'],
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
    return render(t['track-record.toast.saved-not-finished'], {}, units)
  return result.scoredPredictions === 1
    ? render(t['track-record.toast.saved-one'], {}, units)
    : render(t['track-record.toast.saved'], { count: count(result.scoredPredictions) }, units)
}
