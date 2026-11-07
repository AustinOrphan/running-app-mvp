// The words of the Trends page (rule T1, ADR 0019): a heading, a caption for each picture and the
// states of the page. The page describes what was run and logged: no sentence here sets a target,
// calls a week good or poor, or says a reading is inside or outside a range. The recent range is
// named "your recent range" and never "the one Today uses". Every sentence is a template, so the
// shared G5 lint renders it; `TRENDS_TEMPLATES` is spread into `TEMPLATES`.
import { P } from '../engine/params/index.ts'
import { render, tpl } from './template.ts'

export const TRENDS_TEMPLATES = {
  // The page
  'trends.title': tpl('Trends', {}, { shape: 'label' }),
  'trends.context': tpl(
    'Weeks and months of what was run and logged, against your own recent ranges. Nothing here is a target.',
  ),
  'trends.more-note': tpl('Months of running and recovery readings', {}, { shape: 'label' }),
  'trends.offline': tpl('Trends need a connection. Today, the plan and the log work offline.'),
  'trends.error': tpl('Trends did not load. Reload the page to try again.'),
  'trends.recovery.error': tpl('The recovery readings did not load. Reload the page to try again.'),

  // Running per week
  'trends.run.heading': tpl('Running per week', {}, { shape: 'label' }),
  'trends.run.empty': tpl('No runs in this range yet.'),
  'trends.run.empty-body': tpl('Log a run or import a file and the weeks show up here.'),
  'trends.run.caption-time': tpl(
    'Bars are run time per week. The line is the mean of that week and the three before it.',
  ),
  'trends.run.caption-distance': tpl('Bars are run distance per week.'),
  'trends.run.marks': tpl('A flag marks a race week. Squares are strength sessions.'),
  'trends.run.this-week': tpl('The outlined bar is this week so far.'),
  'trends.run.strength-link': tpl('Lifts and loads are on Strength', {}, { shape: 'label' }),
  'trends.run.aria-time': tpl(
    'Run hours per week, last {months} months. Latest complete week {time}.',
    { months: 'count', time: 'weekMinutes' },
    { fallback: 'Run hours per week.' },
  ),
  'trends.run.aria-distance': tpl(
    'Run distance per week, last {months} months. Latest complete week {distance}.',
    { months: 'count', distance: 'distance' },
    { fallback: 'Run distance per week.' },
  ),
  'trends.run.aria-none': tpl(
    'Run time per week, last {months} months.',
    { months: 'count' },
    { fallback: 'Run time per week.' },
  ),

  // Recovery readings
  'trends.recovery.heading': tpl('Recovery readings', {}, { shape: 'label' }),
  'trends.recovery.aria': tpl(
    '{name}, weekly mean, last {months} months. Latest week with enough nights: {value}.',
    { name: 'text', months: 'count', value: 'text' },
    { fallback: 'Weekly mean of a recovery reading.' },
  ),
  'trends.recovery.aria-none': tpl(
    '{name}, weekly mean, last {months} months. No week has enough nights yet.',
    { name: 'text', months: 'count' },
    { fallback: 'Weekly mean of a recovery reading.' },
  ),
  'trends.recovery.note': tpl('These readings never change a plan by themselves.'),
  'trends.hrv.heading': tpl('Overnight HRV', {}, { shape: 'label' }),
  'trends.hrv.caption': tpl(
    'Weekly mean of overnight rMSSD in ms, for weeks with at least {nights} nights recorded.',
    { nights: 'count' },
  ),
  'trends.hrv.none': tpl('No rMSSD readings yet.'),
  'trends.rhr.heading': tpl('Resting heart rate', {}, { shape: 'label' }),
  'trends.rhr.caption': tpl(
    'Weekly mean of resting heart rate in bpm, for weeks with at least {nights} nights recorded.',
    { nights: 'count' },
  ),
  'trends.rhr.none': tpl('No resting heart rate readings yet.'),
  'trends.sleep.heading': tpl('Sleep', {}, { shape: 'label' }),
  'trends.sleep.caption': tpl(
    'Weekly mean of recorded sleep in hours, for weeks with at least {nights} nights recorded. No range is drawn.',
    { nights: 'count' },
  ),
  'trends.sleep.none': tpl('No sleep readings yet.'),
  // The band: how the recent range is built, in the words of the baseline it reads.
  'trends.band.latest': tpl(
    'The band is your recent range: the mean of the latest {readings} readings within the {days} days before the week, plus or minus {sd} SD.',
    { readings: 'count', days: 'count', sd: 'count' },
  ),
  'trends.band.cycle': tpl(
    'The band is your recent range: the mean of the readings within the {days} days before the week, plus or minus {sd} SD.',
    { days: 'count', sd: 'count' },
  ),
  'trends.band.building': tpl(
    'The recent range is still being built: {readings} of {needed} readings.',
    {
      readings: 'count',
      needed: 'count',
    },
  ),
} as const

/** The ids of the templates that take no slot. */
export type PlainTrendsId = {
  [K in keyof typeof TRENDS_TEMPLATES]: keyof (typeof TRENDS_TEMPLATES)[K]['slots'] extends never
    ? K
    : never
}[keyof typeof TRENDS_TEMPLATES]

/** A sentence or label of the page that has no slot. */
export function trendsText(id: PlainTrendsId): string {
  return render(TRENDS_TEMPLATES[id], {}, 'km')
}

const count = (n: number) => ({ kind: 'count' as const, n })

/** The nights a weekly mean needs, for the caption of a signal. */
export function nightsCaption(
  id: 'trends.hrv.caption' | 'trends.rhr.caption' | 'trends.sleep.caption',
  nights: number,
): string {
  return render(TRENDS_TEMPLATES[id], { nights: count(nights) }, 'km')
}

/**
 * How the band of a signal is built. Heart-rate variability on the cycle-aware (female) profile
 * reads every reading of the longer window; resting heart rate has no cycle handling, as Today's.
 */
export function bandCaption(signal: 'hrv' | 'resting-hr', cyclic: boolean): string {
  const sd = count(P.j4.sdBelowMean.value)
  if (signal === 'hrv' && cyclic) {
    return render(
      TRENDS_TEMPLATES['trends.band.cycle'],
      { days: count(P.j4.cycleBaselineDays.value), sd },
      'km',
    )
  }
  return render(
    TRENDS_TEMPLATES['trends.band.latest'],
    { readings: count(P.j4.windowDays.value), days: count(P.j4.lookbackDays.value), sd },
    'km',
  )
}

/** "The recent range is still being built: 6 of 10 readings." */
export function bandBuilding(readings: number): string {
  return render(
    TRENDS_TEMPLATES['trends.band.building'],
    { readings: count(readings), needed: count(P.j4.minReadings.value) },
    'km',
  )
}

/** The accessible name of a recovery chart: what it shows and its latest weekly mean, if any. */
export function recoveryAria(name: string, months: number, latest: string | null): string {
  return latest === null
    ? render(TRENDS_TEMPLATES['trends.recovery.aria-none'], { name, months: count(months) }, 'km')
    : render(
        TRENDS_TEMPLATES['trends.recovery.aria'],
        { name, months: count(months), value: latest },
        'km',
      )
}
