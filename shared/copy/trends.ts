// The words of the Trends page (rule T1, ADR 0019): a heading, a caption for each picture and the
// states of the page. The page describes what was run and logged: no sentence here sets a target,
// calls a week good or poor, or says a reading is inside or outside a range. The recent range is
// named "your recent range" and never "the one Today uses". Every sentence is a template, so the
// shared G5 lint renders it; `TRENDS_TEMPLATES` is spread into `TEMPLATES`.
import { P } from '../engine/params/index.ts'
import type { Units } from '../types.ts'
import { formatAirTemperature } from './quantity.ts'
import { render, tpl } from './template.ts'

export const TRENDS_TEMPLATES = {
  // The page
  'trends.title': tpl('Trends', {}, { shape: 'label' }),
  'trends.context': tpl(
    'Weeks and months of what was run and logged, against your own recent ranges. Nothing here is a target.',
  ),
  'trends.more-note': tpl('Months of running and recovery readings', {}, { shape: 'label' }),
  'trends.offline': tpl('Trends need a connection. Today works offline.'),
  'trends.error': tpl('Trends did not load. Reload the page to try again.'),
  'trends.recovery.error': tpl('The recovery readings did not load. Reload the page to try again.'),
  'trends.runs.heading': tpl('Long runs and heart rate', {}, { shape: 'label' }),
  'trends.runs.subject': tpl('The run data', {}, { shape: 'label' }),

  // Body weight: drawn only on the runner's choice and without a verdict. The slots are structural
  // (a test requires them): the weekly mean, the unit, a count of weigh-ins and the months of the
  // range, so a difference between weeks or a direction cannot be rendered.
  'trends.weight.heading': tpl('Body weight', {}, { shape: 'label' }),
  'trends.weight.caption': tpl(
    "Mean of each week's weigh-ins, for weeks with at least {count} weigh-ins. A scale varies within a day, so read the line, not a point.",
    { count: 'count' },
  ),
  'trends.weight.none': tpl('No weigh-ins yet.'),
  'trends.weight.aria': tpl(
    'Body weight, weekly mean, last {months} months. Latest week with enough weigh-ins: {mean}.',
    { months: 'count', mean: 'text' },
    { fallback: 'Body weight, weekly mean.' },
  ),
  'trends.weight.aria-none': tpl(
    'Body weight, weekly mean, last {months} months. No week has enough weigh-ins yet.',
    { months: 'count' },
    { fallback: 'Body weight, weekly mean.' },
  ),
  'trends.weight.footnote': tpl(
    'If your weight has changed without you meaning it to, say so in',
    {},
    { shape: 'label' },
  ),
  'trends.weight.footnote-link': tpl('the energy screen on Profile', {}, { shape: 'label' }),
  'trends.weight.gated': tpl('Body weight is not shown while the screening has open items.'),
  'trends.weight.gated-link': tpl('The screening and where to find care are on Profile.'),

  // Settings: the one switch that lets the page draw body weight (off by default, ADR 0019)
  'trends.settings.heading': tpl('Trends', {}, { shape: 'label' }),
  'trends.settings.show-weight': tpl('Show body weight on Trends', {}, { shape: 'label' }),
  'trends.settings.hiding-note': tpl('Hiding the chart deletes nothing. Every weigh-in stays.'),

  // Running per week
  'trends.run.heading': tpl('Running per week', {}, { shape: 'label' }),
  'trends.run.empty': tpl('No runs in this range yet.'),
  'trends.run.empty-body': tpl('Log a run or import a file and the weeks show up here.'),
  'trends.run.caption-time': tpl(
    'Bars are run hours per week. The line is the mean of that week and the three before it.',
  ),
  'trends.run.caption-distance': tpl(
    'Bars are run distance per week, in {unit}.',
    { unit: 'text' },
    { fallback: 'Bars are run distance per week.' },
  ),
  'trends.run.marks': tpl('A flag marks a race week. Squares are strength sessions.'),
  'trends.records-start': tpl('Records start the week of {date}.', { date: 'date' }),
  'trends.span.months': tpl('last {months} months', { months: 'count' }, { shape: 'label' }),
  'trends.span.since': tpl('since the week of {date}', { date: 'date' }, { shape: 'label' }),
  'trends.run.this-week': tpl('The outlined bar is this week so far.'),
  'trends.run.strength-link': tpl('Lifts and loads are on Strength', {}, { shape: 'label' }),
  'trends.run.aria-time': tpl(
    'Run hours per week, {span}. Latest complete week {time}.',
    { span: 'text', time: 'weekMinutes' },
    { fallback: 'Run hours per week.' },
  ),
  'trends.run.aria-distance': tpl(
    'Run distance per week, {span}. Latest complete week {distance}.',
    { span: 'text', distance: 'distance' },
    { fallback: 'Run distance per week.' },
  ),
  'trends.run.aria-none': tpl(
    'Run time per week, {span}.',
    { span: 'text' },
    { fallback: 'Run time per week.' },
  ),

  // Recovery readings
  'trends.recovery.heading': tpl('Recovery readings', {}, { shape: 'label' }),
  'trends.recovery.aria': tpl(
    '{name}, weekly mean, {span}. Latest week with enough nights: {value}.',
    { name: 'text', span: 'text', value: 'text' },
    { fallback: 'Weekly mean of a recovery reading.' },
  ),
  'trends.recovery.aria-none': tpl(
    '{name}, weekly mean, {span}. No week has enough nights yet.',
    { name: 'text', span: 'text' },
    { fallback: 'Weekly mean of a recovery reading.' },
  ),
  'trends.recovery.note': tpl('Heart-rate variability alone never changes a plan.'),
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

  // Heart-rate drift on long runs (rule A7, shown under T1). The stored drift figure is described,
  // never judged: no band, no aim, no word for better or worse.
  'trends.drift.heading': tpl('Heart-rate drift on long runs', {}, { shape: 'label' }),
  'trends.drift.caption': tpl(
    'Each mark is one run with a heart-rate stream. Height is the rise in heart rate per unit of speed from the first half to the second.',
  ),
  'trends.drift.size': tpl(
    "Dot area follows run length, up to {cap}. One run's figure moves with the day, so read the dots together.",
    { cap: 'minutes' },
  ),
  'trends.drift.hills': tpl(
    'A run that climbs more than {gain} per {unit} is drawn only when its heart rate passes the checks. A climbing second half reads as drift.',
    { gain: 'climb', unit: 'text' },
    { fallback: 'A hilly run is drawn only when its heart rate passes the checks.' },
  ),
  'trends.drift.hilly': tpl(
    'Diamonds are hilly runs whose heart rate passed the checks. Their drift is on grade-adjusted pace, over the clean part of the stream.',
  ),
  'trends.drift.curve': tpl(
    "A diamond is read against today's grade curve, so it can move a little when the curve changes.",
  ),
  'trends.drift.checks': tpl(
    'The checks look for heart rate that follows cadence, jumps, gaps, flat lines, and a fall while effort rises. Diamonds are not part of the median.',
  ),
  'trends.drift.filled': tpl(
    'Filled dots are the largest set of comparable runs, which the median is read from. Hollow dots are every other run.',
  ),
  'trends.drift.hollow-only': tpl(
    'All dots are rings until {needed} comparable runs make a median.',
    { needed: 'count' },
  ),
  'trends.drift.median': tpl(
    'Median {pct} over {count} comparable runs of about {duration} on cool days.',
    { pct: 'percent', count: 'count', duration: 'minutes' },
    { fallback: 'The median of the comparable runs.' },
  ),
  'trends.drift.comparable': tpl(
    'Comparable runs last {from} to {to} in air under {heat}, within {tol} in length and {temp} in temperature of each other.',
    { from: 'minutes', to: 'minutes', heat: 'text', tol: 'percent', temp: 'text' },
  ),
  'trends.drift.building': tpl(
    'No median yet: the largest set of comparable runs holds {count} of {needed}.',
    { count: 'count', needed: 'count' },
  ),
  'trends.drift.no-group': tpl(
    'No median yet. It needs {needed} comparable runs of {from} to {to} in air under {heat}.',
    { needed: 'count', from: 'minutes', to: 'minutes', heat: 'text' },
  ),
  'trends.drift.empty': tpl('No long-run readings in this range yet.'),
  'trends.drift.empty-body': tpl(
    'A reading needs a run long enough to split in two, with a heart-rate stream from a watch file or synced account. A spreadsheet import has none.',
  ),
  'trends.drift.aria': tpl(
    'Heart-rate drift of {count} runs, {span}. Latest {pct} on {date}.',
    { count: 'count', span: 'text', pct: 'percent', date: 'date' },
    { fallback: 'Heart-rate drift of long runs.' },
  ),
  'trends.drift.aria-none': tpl(
    'Heart-rate drift of long runs, {span}. No run has a reading yet.',
    { span: 'text' },
    { fallback: 'Heart-rate drift of long runs.' },
  ),

  // Heart rate at one speed (rule A11, shown under T1). One reference pace, read from the runner's
  // own line in each window; no point is compared with another and none is called a gain or a loss.
  'trends.hr.heading': tpl('Heart rate at one speed', {}, { shape: 'label' }),
  'trends.hr.caption': tpl(
    'Each point is the heart rate your own line gives at {pace} on a cool day, from the steady runs of the {weeks} weeks to that date.',
    { pace: 'pace', weeks: 'count' },
  ),
  'trends.hr.heat': tpl(
    'Hot runs are corrected for heat; a run with no weather recorded counts as cool.',
  ),
  'trends.hr.reference': tpl(
    'The pace is the middle of the paces your lines were fitted on, in the months shown.',
  ),
  'trends.hr.overlap': tpl(
    'A point comes every {step} weeks, so neighbouring points share runs. A gap means too few runs, or a window that did not run this pace.',
    { step: 'count' },
  ),
  'trends.hr.needs': tpl(
    'A point needs {runs} steady runs with heart rate in {weeks} weeks, and {pace} within {margin} of the paces they covered.',
    { runs: 'count', weeks: 'count', pace: 'pace', margin: 'percent' },
  ),
  'trends.hr.hilly': tpl(
    'Includes {count} hilly runs whose heart rate passed the checks, on grade-adjusted pace.',
    { count: 'count' },
  ),
  'trends.hr.hilly-scope': tpl(
    'The count covers the windows drawn, and a run that sits in two windows counts once.',
  ),
  'trends.hr.hilly-one': tpl(
    'Includes 1 hilly run whose heart rate passed the checks, on grade-adjusted pace.',
  ),
  'trends.hr.moves': tpl(
    'Sleep, caffeine, heat, tiredness and wrist-sensor error also move heart rate at a given speed. This page does not say how much change counts.',
  ),
  'trends.hr.empty': tpl('No heart-rate line in this range yet.'),
  'trends.hr.empty-body': tpl(
    'A line needs {runs} steady runs with heart rate within {weeks} weeks. The latest {weeks} weeks have {have}.',
    { runs: 'count', weeks: 'count', have: 'count' },
  ),
  'trends.hr.empty-pace': tpl('No point can be read at one pace in this range.'),
  'trends.hr.empty-pace-body': tpl(
    'No window of this range ran {pace} or a pace near it, so no point can be read at one pace.',
    { pace: 'pace' },
  ),
  'trends.hr.aria': tpl(
    'Heart rate at {pace}, one point per {weeks}-week window, {span}. Latest point: {bpm}.',
    { pace: 'pace', weeks: 'count', span: 'text', bpm: 'bpm' },
    { fallback: 'Heart rate at one speed, by window.' },
  ),
  'trends.hr.aria-none': tpl(
    'Heart rate at one speed, {span}. No window has a point yet.',
    { span: 'text' },
    { fallback: 'Heart rate at one speed, by window.' },
  ),
  'trends.hr.gap-runs': tpl('Too few runs', {}, { shape: 'label' }),
  'trends.hr.gap-pace': tpl('Pace not run in this window', {}, { shape: 'label' }),

  'trends.load.heading': tpl('Climbing and intensity', {}, { shape: 'label' }),
  'trends.load.subject': tpl('The climbing and intensity data', {}, { shape: 'label' }),

  // Climbing per week (rule A12, shown under T1). The gain recorded on each run, summed by week and
  // described: no aim, no ratio of recent to earlier weeks. A run with no gain is counted and named.
  'trends.climb.heading': tpl('Climbing per week', {}, { shape: 'label' }),
  'trends.climb.caption': tpl(
    'Bars are the elevation gain recorded on your runs each week, in {unit}. The line is the mean of that week and the three before it.',
    { unit: 'text' },
    { fallback: 'Bars are the elevation gain recorded on your runs each week.' },
  ),
  'trends.climb.line': tpl(
    'The line counts a week with no runs as no climbing and leaves out a week whose runs have no elevation. It stops at the last complete week.',
  ),
  'trends.climb.coverage': tpl(
    '{have} of {runs} runs have elevation. A run with none is left out, not read as flat.',
    { have: 'count', runs: 'count' },
  ),
  'trends.climb.rough': tpl(
    "Elevation from a watch's barometer or GPS is rough, so read the shape of the weeks, not the exact figure.",
  ),
  'trends.climb.empty': tpl('No elevation recorded in this range yet.'),
  'trends.climb.empty-body': tpl(
    'Elevation comes with a watch file or a synced account. A spreadsheet import has none.',
  ),
  'trends.climb.aria': tpl(
    'Climbing per week, {span}. Latest complete week with elevation: {climb}.',
    { span: 'text', climb: 'climb' },
    { fallback: 'Climbing per week.' },
  ),
  'trends.climb.aria-none': tpl(
    'Climbing per week, {span}. No complete week has elevation yet.',
    { span: 'text' },
    { fallback: 'Climbing per week.' },
  ),

  // Intensity per week (rule A12). Run time by heart-rate zone as the zones stand today; time with no
  // usable heart rate is its own neutral part and is never spread over the zones. No line, no
  // comparison with the plan: a split here is a picture of what was run, not a target.
  'trends.intensity.heading': tpl('Intensity per week', {}, { shape: 'label' }),
  'trends.intensity.caption': tpl(
    "Bars are run hours per week, split by heart rate into the three zones as they stand today. Past weeks are read against today's zones.",
  ),
  'trends.intensity.limits': tpl(
    'Zone 1 is up to {lt1}, Zone 2 is up to {lt2} and Zone 3 is above, by the heart rate of the zone table on Profile.',
    { lt1: 'bpm', lt2: 'bpm' },
  ),
  'trends.intensity.neutral': tpl(
    'The neutral part is time with no usable heart rate: no stream, a stream that did not pass the checks, or a stretch the stream does not cover.',
  ),
  'trends.intensity.coverage': tpl('{have} of {runs} runs have usable heart rate.', {
    have: 'count',
    runs: 'count',
  }),
  'trends.intensity.legend-1': tpl('Zone 1', {}, { shape: 'label' }),
  'trends.intensity.legend-2': tpl('Zone 2', {}, { shape: 'label' }),
  'trends.intensity.legend-3': tpl('Zone 3', {}, { shape: 'label' }),
  'trends.intensity.legend-none': tpl('No usable heart rate', {}, { shape: 'label' }),
  'trends.intensity.no-zones': tpl('No heart-rate zones are set yet.'),
  'trends.intensity.no-zones-body': tpl(
    'The zones need a maximum heart rate. Add one on Profile and the weeks are split here.',
  ),
  'trends.intensity.aria': tpl(
    'Run hours per week by zone, {span}. Latest complete week: Zone 1 {z1}, Zone 2 {z2}, Zone 3 {z3}, no usable heart rate {none}.',
    { span: 'text', z1: 'minutes', z2: 'minutes', z3: 'minutes', none: 'minutes' },
    { fallback: 'Run hours per week by heart-rate zone.' },
  ),
  'trends.intensity.aria-none': tpl(
    'Run hours per week by heart-rate zone, {span}. No complete week has runs yet.',
    { span: 'text' },
    { fallback: 'Run hours per week by heart-rate zone.' },
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

/** The line under a chart that was cropped to the first week with a record. */
export function recordsStart(weekStart: string): string {
  return render(
    TRENDS_TEMPLATES['trends.records-start'],
    { date: { kind: 'date', iso: weekStart, style: 'short' } },
    'km',
  )
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

/**
 * The span a chart's name gives: "last 12 months", or "since the week of 24 Aug" when the plot was
 * cut to the first record (`since` is that Monday).
 */
export function spanText(months: number, since: string | null): string {
  return since === null
    ? render(TRENDS_TEMPLATES['trends.span.months'], { months: count(months) }, 'km')
    : render(
        TRENDS_TEMPLATES['trends.span.since'],
        { date: { kind: 'date', iso: since, style: 'short' } },
        'km',
      )
}

/** The accessible name of a recovery chart: what it shows and its latest weekly mean, if any. */
export function recoveryAria(name: string, span: string, latest: string | null): string {
  return latest === null
    ? render(TRENDS_TEMPLATES['trends.recovery.aria-none'], { name, span }, 'km')
    : render(TRENDS_TEMPLATES['trends.recovery.aria'], { name, span, value: latest }, 'km')
}

/** The weigh-ins a weekly mean of body weight needs, for its caption. */
export function weightCaption(weighIns: number): string {
  return render(TRENDS_TEMPLATES['trends.weight.caption'], { count: count(weighIns) }, 'km')
}

/** The accessible name of the weight chart: what it shows and its latest weekly mean, if any. */
export function weightAria(months: number, latest: string | null): string {
  return latest === null
    ? render(TRENDS_TEMPLATES['trends.weight.aria-none'], { months: count(months) }, 'km')
    : render(TRENDS_TEMPLATES['trends.weight.aria'], { months: count(months), mean: latest }, 'km')
}

/** The line under the metric switch: what the bars are, with the unit the axis leaves out. */
export function runCaption(metric: 'time' | 'distance', units: 'km' | 'mi'): string {
  return metric === 'time'
    ? trendsText('trends.run.caption-time')
    : render(TRENDS_TEMPLATES['trends.run.caption-distance'], { unit: units }, units)
}

const PER_KM = 1000
const M_PER_MILE = 1609.344

/**
 * The climb limit of the drift panel in the runner's unit: `hrModel.maxGainPerKm` metres per
 * kilometre, or the same climb over a mile in feet per mile.
 */
export function driftHillsLine(units: Units): string {
  const perKm = P.hrModel.maxGainPerKm.value
  const miles = units === 'mi'
  return render(
    TRENDS_TEMPLATES['trends.drift.hills'],
    {
      gain: { kind: 'climb', m: miles ? (perKm * M_PER_MILE) / PER_KM : perKm },
      unit: miles ? 'mile' : 'km',
    },
    units,
  )
}

/** An air temperature in the runner's unit: the one rule for the air (`formatAirTemperature`). */
const airText = (c: number, units: Units): string => formatAirTemperature(c, units)

/** A difference of air temperature: 5 degrees Celsius is 9 degrees Fahrenheit, with no 32 added. */
const airDifferenceText = (c: number, units: Units): string =>
  units === 'mi' ? `${String(Math.round((c * 9) / 5))} °F` : `${String(Math.round(c))} °C`

const minutes = (min: number) => ({ kind: 'minutes' as const, min })

/** The length of a long run and the air it needs to be a candidate of rule A7. */
const durabilityBounds = (units: Units) => ({
  from: minutes(P.a7.thresholdDropAfterMin.value),
  to: minutes(P.a7.driftInferenceLimitMin.value),
  heat: airText(P.a7.heatExcludeC.value, units),
})

/** Which dots are filled: the largest set of comparable runs, once it makes a median. */
export function driftFilledLine(): string {
  return render(TRENDS_TEMPLATES['trends.drift.filled'], {}, 'km')
}

/** Why no dot is filled yet. */
export function driftHollowOnlyLine(): string {
  return render(
    TRENDS_TEMPLATES['trends.drift.hollow-only'],
    { needed: count(P.a7.minComparableRuns.value) },
    'km',
  )
}

/** The longest run whose dot grows with its length: the drift inference limit of rule A7. */
export function driftSizeLine(): string {
  return render(
    TRENDS_TEMPLATES['trends.drift.size'],
    { cap: minutes(P.a7.driftInferenceLimitMin.value) },
    'km',
  )
}

/** Which runs are candidates and when two are comparable (rule A7). */
export function driftComparableLine(units: Units): string {
  return render(
    TRENDS_TEMPLATES['trends.drift.comparable'],
    {
      ...durabilityBounds(units),
      tol: { kind: 'percent', pct: Math.round(P.a7.comparableDurationTolerance.value * 100) },
      temp: airDifferenceText(P.a7.comparableTempToleranceC.value, units),
    },
    units,
  )
}

/** "Median 4.1% over 5 comparable runs of about 2 h on cool days." The length rounds to 10 minutes. */
export function driftMedianLine(pct: number, runs: number, medianMin: number): string {
  return render(
    TRENDS_TEMPLATES['trends.drift.median'],
    {
      pct: { kind: 'percent', pct },
      count: count(runs),
      duration: { kind: 'minutes', min: Math.round(medianMin / 10) * 10 },
    },
    'km',
  )
}

/** Why there is no median line: a set too small to read, or no set at all. */
export function driftNoMedianLine(runs: number, units: Units): string {
  return runs === 0
    ? render(
        TRENDS_TEMPLATES['trends.drift.no-group'],
        { needed: count(P.a7.minComparableRuns.value), ...durabilityBounds(units) },
        units,
      )
    : render(
        TRENDS_TEMPLATES['trends.drift.building'],
        { count: count(runs), needed: count(P.a7.minComparableRuns.value) },
        'km',
      )
}

/** The accessible name of the drift chart: what it shows and its latest dot, if any. */
export function driftAria(
  span: string,
  latest: { count: number; pct: number; date: string } | null,
): string {
  return latest === null
    ? render(TRENDS_TEMPLATES['trends.drift.aria-none'], { span }, 'km')
    : render(
        TRENDS_TEMPLATES['trends.drift.aria'],
        {
          count: count(latest.count),
          span,
          pct: { kind: 'percent', pct: latest.pct },
          date: { kind: 'date', iso: latest.date, style: 'short' },
        },
        'km',
      )
}

const paceOf = (mps: number) => ({ kind: 'pace' as const, secPerKm: PER_KM / mps })

/** What a point of the heart-rate panel is, at the reference pace. */
export function hrCaption(referenceMps: number, units: Units): string {
  return render(
    TRENDS_TEMPLATES['trends.hr.caption'],
    { pace: paceOf(referenceMps), weeks: count(P.hrModel.windowWeeks.value) },
    units,
  )
}

/** How many hilly runs the drawn points include; null when there are none to name. */
export function hrHillyLine(hillyRuns: number): string | null {
  if (hillyRuns <= 0) return null
  return hillyRuns === 1
    ? render(TRENDS_TEMPLATES['trends.hr.hilly-one'], {}, 'km')
    : render(TRENDS_TEMPLATES['trends.hr.hilly'], { count: count(hillyRuns) }, 'km')
}

/** The weeks between two points, and what a gap means. */
export function hrOverlapLine(stepWeeks: number): string {
  return render(TRENDS_TEMPLATES['trends.hr.overlap'], { step: count(stepWeeks) }, 'km')
}

/** What a point needs, for a panel with a reference pace. */
export function hrNeedsLine(referenceMps: number, units: Units): string {
  return render(
    TRENDS_TEMPLATES['trends.hr.needs'],
    {
      runs: count(P.hrModel.minQualifyingRuns.value),
      weeks: count(P.hrModel.windowWeeks.value),
      pace: paceOf(referenceMps),
      margin: { kind: 'percent', pct: Math.round(P.c9.lineSpeedMargin.value * 100) },
    },
    units,
  )
}

/** What would fill the panel, with the runs the latest window has. */
export function hrEmptyBody(have: number): string {
  return render(
    TRENDS_TEMPLATES['trends.hr.empty-body'],
    {
      runs: count(P.hrModel.minQualifyingRuns.value),
      weeks: count(P.hrModel.windowWeeks.value),
      have: count(have),
    },
    'km',
  )
}

/** The accessible name of the heart-rate chart: the pace, the span and the latest point, if any. */
export function hrAria(
  span: string,
  reference: { mps: number; latestBpm: number | null },
  units: Units,
): string {
  return reference.latestBpm === null
    ? render(TRENDS_TEMPLATES['trends.hr.aria-none'], { span }, units)
    : render(
        TRENDS_TEMPLATES['trends.hr.aria'],
        {
          pace: paceOf(reference.mps),
          weeks: count(P.hrModel.windowWeeks.value),
          span,
          bpm: { kind: 'bpm', bpm: reference.latestBpm },
        },
        units,
      )
}

/** Why no point can be read at one pace, though some window has a line. */
export function hrEmptyPaceBody(referenceMps: number, units: Units): string {
  return render(
    TRENDS_TEMPLATES['trends.hr.empty-pace-body'],
    { pace: paceOf(referenceMps) },
    units,
  )
}

/** The unit of the climbing bars, in words: metres for km, feet for miles. */
export function climbUnitWord(units: Units): string {
  return units === 'mi' ? 'feet' : 'metres'
}

/** The line under the climbing panel's heading: what the bars are, in the runner's unit. */
export function climbCaption(units: Units): string {
  return render(TRENDS_TEMPLATES['trends.climb.caption'], { unit: climbUnitWord(units) }, units)
}

/** "31 of 36 runs have elevation." The count of runs in view and how many carry a gain. */
export function climbCoverageLine(have: number, runs: number): string {
  return render(
    TRENDS_TEMPLATES['trends.climb.coverage'],
    { have: count(have), runs: count(runs) },
    'km',
  )
}

/** The accessible name of the climbing chart: the span and the latest complete week with a gain, if any. */
export function climbAria(span: string, latestM: number | null, units: Units): string {
  return latestM === null
    ? render(TRENDS_TEMPLATES['trends.climb.aria-none'], { span }, units)
    : render(
        TRENDS_TEMPLATES['trends.climb.aria'],
        { span, climb: { kind: 'climb', m: latestM } },
        units,
      )
}

/** "20 of 36 runs have usable heart rate." */
export function intensityCoverageLine(have: number, runs: number): string {
  return render(
    TRENDS_TEMPLATES['trends.intensity.coverage'],
    { have: count(have), runs: count(runs) },
    'km',
  )
}

/** The two heart rates the zones are cut at, as the zone table on Profile gives them. */
export function intensityLimitsLine(lt1Hr: number, lt2Hr: number): string {
  return render(
    TRENDS_TEMPLATES['trends.intensity.limits'],
    { lt1: { kind: 'bpm', bpm: lt1Hr }, lt2: { kind: 'bpm', bpm: lt2Hr } },
    'km',
  )
}

/** The accessible name of the intensity chart: the latest complete week's minutes in each part, if any. */
export function intensityAria(
  span: string,
  latest: { z1: number; z2: number; z3: number; none: number } | null,
): string {
  return latest === null
    ? render(TRENDS_TEMPLATES['trends.intensity.aria-none'], { span }, 'km')
    : render(
        TRENDS_TEMPLATES['trends.intensity.aria'],
        {
          span,
          z1: minutes(latest.z1),
          z2: minutes(latest.z2),
          z3: minutes(latest.z3),
          none: minutes(latest.none),
        },
        'km',
      )
}
