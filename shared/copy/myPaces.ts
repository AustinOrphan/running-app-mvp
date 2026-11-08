// The words of the My paces page (rule C9, ADR 0020): the easy pace, the zones and what the runner
// can run now. Every sentence is a template, so the shared G5 lint renders it; a pace or a time is a
// sketch to run by, never a promise or a target, and the page says so. `PACES_TEMPLATES` is spread
// into `TEMPLATES`. Figures arrive as quantities in the runner's units; the rule ids in the "how
// these are made" lines are the ones the engine cites.
import type { BandReason, GradeBand } from '../engine/gradeCurve.ts'
import type { LineIssue } from '../engine/myPaces.ts'
import { P } from '../engine/params/index.ts'
import type { Units } from '../types.ts'
import { render, tpl, type Template } from './template.ts'

export const PACES_TEMPLATES = {
  // The page
  'paces.title': tpl('My paces', {}, { shape: 'label' }),
  'paces.context': tpl(
    'Your easy pace, your zones and what you can run now, worked out from your own runs. Sketches to run by, not promises.',
  ),
  'paces.more-note': tpl('Easy pace, zones and what you can run now', {}, { shape: 'label' }),
  'paces.how': tpl('How this is made', {}, { shape: 'label' }),
  'paces.link.profile': tpl('Open Profile', {}, { shape: 'label' }),
  'paces.link.review': tpl('Open the review page', {}, { shape: 'label' }),
  'paces.link.from-profile': tpl('Your easy pace and what you can run now', {}, { shape: 'label' }),
  'paces.link.from-goal': tpl('See your paces at other distances', {}, { shape: 'label' }),

  // Easy pace
  'paces.easy.heading': tpl('Easy pace', {}, { shape: 'label' }),
  'paces.easy.lead-hr': tpl(
    'Easy running keeps your heart rate at or under {ceiling}, on the flat in cool air.',
    { ceiling: 'bpm' },
  ),
  'paces.easy.lead-zones': tpl('Easy running is zone 1, on the flat in cool air.'),
  'paces.easy.basis-hr': tpl(
    'From {runs} steady runs since {since}, where your own heart rate meets the top of zone 1.',
    { runs: 'count', since: 'date' },
  ),
  'paces.easy.basis-threshold': tpl(
    'From the threshold pace on your profile, which sets the end of zone 1.',
  ),
  'paces.easy.basis-cs': tpl(
    'From your critical speed, which sets the end of zone 1 at a share of it.',
  ),
  'paces.easy.confidence-moderate': tpl('Confidence is moderate.'),
  'paces.easy.confidence-low-age': tpl(
    'Confidence is low: your top heart rate is estimated from your age, so the ceiling could be off by about {band}.',
    { band: 'bpm' },
  ),
  'paces.easy.confidence-low-cs': tpl(
    'Confidence is low: the range is a share of critical speed, not your own heart rate.',
  ),
  'paces.easy.row-cool': tpl('Cool and flat', {}, { shape: 'label' }),
  'paces.easy.row-hot': tpl('Hot day, WBGT {wbgt}', { wbgt: 'temp' }, { shape: 'label' }),
  'paces.easy.row-hot-default': tpl(
    'Hot day, WBGT {wbgt}, default heat rise',
    { wbgt: 'temp' },
    { shape: 'label' },
  ),
  'paces.easy.row-climb': tpl('Climb of {grade}', { grade: 'percent' }, { shape: 'label' }),
  'paces.easy.row-climb-own': tpl(
    'Climb of {grade}, from your own runs on this grade',
    { grade: 'percent' },
    { shape: 'label' },
  ),
  'paces.easy.climb-own': tpl(
    'The climb row uses the speed you kept on this grade in your own runs, not the default cost of a grade.',
  ),
  'paces.easy.climb-few-minutes': tpl(
    'The climb row uses the default cost of a grade: too few minutes on this grade in your runs so far.',
  ),
  'paces.easy.climb-few-runs': tpl(
    'The climb row uses the default cost of a grade: too few runs on this grade so far.',
  ),
  'paces.easy.climb-untested': tpl(
    'The climb row uses the default cost of a grade: your own speed on it is not tested against your later runs yet.',
  ),
  'paces.easy.climb-no-gain': tpl(
    'The climb row uses the default cost of a grade: your own speed on it did not come closer to your later runs than the default.',
  ),
  'paces.easy.climb-inconsistent': tpl(
    'The climb row uses the default cost of a grade: your runs on it do not agree enough yet.',
  ),
  'paces.easy.climb-default': tpl('The climb row uses the default cost of a grade.'),
  'paces.easy.scenarios': tpl(
    'Heat lifts your heart rate at the same pace, and a climb costs more for the same speed, so both slow the pace that keeps you easy.',
  ),
  'paces.easy.hot-none-zones': tpl(
    'Heat cannot be put in minutes without your own heart-rate line. On a hot day, go by effort.',
  ),
  'paces.easy.hot-none': tpl(
    'Heat cannot be put in minutes from this line. On a hot day, go by effort.',
  ),
  'paces.easy.upgrade': tpl(
    'A pace from your own heart rate needs {need} steady, flat runs with heart rate in {weeks} weeks. {have} so far.',
    { need: 'count', weeks: 'count', have: 'count' },
  ),
  'paces.easy.line-flat': tpl(
    'Your heart-rate line is too flat to say which speed meets your zone 1 ceiling yet. Zone 1 stands in.',
  ),
  'paces.easy.line-outside': tpl(
    'Your zone 1 ceiling sits outside the speeds of your steady runs, so the line cannot be read there yet. Zone 1 stands in.',
  ),
  'paces.easy.line-fast': tpl(
    'The line puts your easy pace faster than easy running can be, so it is not used yet. Zone 1 stands in.',
  ),
  'paces.easy.line-slow': tpl(
    'The line puts your easy pace slower than a brisk walk, so it is not used yet. Zone 1 stands in.',
  ),
  'paces.easy.none-heading': tpl('No easy pace yet', {}, { shape: 'label' }),
  'paces.easy.none-hr': tpl(
    'Wear a heart-rate monitor on {need} steady, flat runs of at least {min}, inside {weeks} weeks. {have} so far.',
    { need: 'count', min: 'minutes', weeks: 'count', have: 'count' },
  ),
  'paces.easy.none-ceiling': tpl(
    'Your zones hold no heart-rate ceiling yet. Add your age or your maximum heart rate on Profile.',
  ),
  'paces.easy.none-test': tpl(
    'Or run the short test below: a critical speed gives a pace range without a heart-rate monitor.',
  ),
  'paces.easy.how-hr': tpl(
    'Your runs give a line of heart rate against speed (A8). The easy pace is where it meets the top of zone 1 (C2, C4); the slow end is the zone edge.',
  ),
  'paces.easy.how-zones': tpl(
    'The range is zone 1 of your zones (C2, C4): a share of critical speed, or the threshold pace on your profile.',
  ),
  'paces.easy.how-heat-own': tpl(
    'The hot day moves the line by your own heat term (A8, I7) at the heat limit of the plan (I9).',
  ),
  'paces.easy.how-heat-default': tpl(
    'The hot day uses a default rise of heart rate with heat (I7, I9) until you have {n} hot runs of your own.',
    { n: 'count' },
  ),
  'paces.easy.how-climb': tpl('The climb uses the cost of running on a grade (I11).'),
  'paces.easy.how-climb-own': tpl(
    'The climb uses your own speed on that grade (I13), which passed a test against the cost of a grade (I11).',
  ),
  'paces.easy.how-grade': tpl(
    'This is a grade D default (C9): a working range to run by, not a measured threshold.',
  ),

  // Zones
  'paces.zones.heading': tpl('Zones', {}, { shape: 'label' }),
  'paces.zones.context': tpl(
    'The ranges you train by, each with where it came from and when. They change only when a proposal is accepted on the review page.',
  ),
  'paces.zones.error': tpl('The zones did not load. Reload the page to try again.'),
  'paces.zones.how-thresholds': tpl(
    'Zone 1 ends at the first threshold and zone 3 starts at the second (C1).',
  ),
  'paces.zones.how-proxy': tpl(
    'Where nothing was tested, a share of critical speed or of maximum heart rate stands in (C2, C4).',
  ),
  'paces.zones.how-range': tpl('Each boundary keeps its range and its source (C7).'),

  // What you can run now
  'paces.events.heading': tpl('What you can run now', {}, { shape: 'label' }),
  'paces.events.context': tpl(
    'Worked out from your races and your critical speed, with no goal and no weather. Each is a range and a sketch.',
  ),
  'paces.events.training': tpl(
    'Rows marked at most rest on your best efforts in training since {date}, not on races. A race or a short test would likely show faster.',
    { date: 'date' },
  ),
  'paces.events.none': tpl('Not enough to say yet for this distance.'),
  'paces.event.basis-both': tpl('From your {distance} on {date} and your critical speed.', {
    distance: 'distance',
    date: 'date',
  }),
  'paces.event.basis-race': tpl('From your {distance} on {date}.', {
    distance: 'distance',
    date: 'date',
  }),
  'paces.event.basis-cs': tpl('From your critical speed, found from {efforts} efforts.', {
    efforts: 'count',
  }),
  'paces.event.time-at-most': tpl('Time, at most', {}, { shape: 'label' }),
  'paces.event.single': tpl('One source only, so the range is wider.'),
  'paces.event.climb': tpl(
    'Climb is counted as flat distance, and the range is widened for trail.',
  ),
  'paces.event.climb-own': tpl(
    'Includes your own speed on climbs from {runs} runs, moving this by {shift}.',
    { runs: 'count', shift: 'text' },
  ),
  'paces.event.wide': tpl('The range is wide on purpose at this length.'),
  'paces.events.how-time': tpl(
    'A race gives the time by a personal exponent or Riegel; critical speed gives it by a fit (L1, L2).',
  ),
  'paces.events.how-range': tpl(
    'One source widens the range (L3), a critical speed found from training widens it again (A6), and no range is narrower than its minimum (L6).',
  ),
  'paces.events.how-climb': tpl('Climb counts as flat distance, and trail widens the range (L5).'),
  'paces.events.how-climb-own': tpl(
    'Your own speed on climbs (I13) moves a time a little, and only on grades where its test passed. Climbs whose test did not pass stay on the default.',
  ),
  'paces.events.how-climb-weights': tpl(
    'Your climbing counts {faster} of the gap to the default when it is faster, {slower} when slower, and moves the time by at most {max} (L5).',
    { faster: 'percent', slower: 'percent', max: 'percent' },
  ),
  'paces.events.how-grade': tpl('The grade is the lowest among the Params the figure reads.'),
  'paces.events.no-weather': tpl('No weather is applied: heat on the day would slow these.'),

  // A course of your own
  'paces.custom.heading': tpl('A distance of your own', {}, { shape: 'label' }),
  'paces.custom.distance': tpl('Distance ({unit})', { unit: 'text' }, { shape: 'label' }),
  'paces.custom.climb': tpl('Climb (m), optional', {}, { shape: 'label' }),
  'paces.custom.submit': tpl('Show paces', {}, { shape: 'label' }),
  'paces.custom.clear': tpl('Clear', {}, { shape: 'label' }),
  'paces.custom.distance-error': tpl('Enter a distance, like 12.5.'),
  'paces.custom.climb-error': tpl('Enter whole metres, like 400.'),
  'paces.custom.load-error': tpl('That distance did not load. Try it again, or clear it.'),
  'paces.custom.range-error': tpl('That distance is out of range.'),

  // Climbs and descents: the runner's own speed by grade next to the default (rule I13)
  'paces.terrain.heading': tpl('Climbs and descents', {}, { shape: 'label' }),
  'paces.terrain.lead': tpl(
    'Your speed on each grade as a share of your flat speed. The default is the cost of the grade at equal effort; yours is the speed you kept.',
  ),
  'paces.terrain.basis': tpl(
    'From {runs} steady runs in the last {weeks} weeks, with {minutes} on the flat between them.',
    { runs: 'count', weeks: 'count', minutes: 'minutes' },
  ),
  'paces.terrain.none': tpl(
    'No steady run has grade data yet, so every grade shows the default. A run counts with {min} or more on the flat at a steady pace, from a file with altitude.',
    { min: 'minutes' },
  ),
  'paces.terrain.sparse': tpl(
    'No grade shows your own speed yet. A grade shows it after {minutes} on it in {runs} runs and a test on {tested} runs.',
    { minutes: 'minutes', runs: 'count', tested: 'count' },
  ),
  'paces.terrain.table': tpl('Speed on each grade', {}, { shape: 'label' }),
  'paces.terrain.col-grade': tpl('Grade', {}, { shape: 'label' }),
  'paces.terrain.col-speed': tpl('Share of flat speed', {}, { shape: 'label' }),
  'paces.terrain.col-source': tpl('Source', {}, { shape: 'label' }),
  'paces.terrain.col-minutes': tpl('Time running', {}, { shape: 'label' }),
  'paces.terrain.band-range': tpl(
    '{from} to {to}',
    { from: 'percent', to: 'percent' },
    { shape: 'label' },
  ),
  'paces.terrain.band-flat': tpl(
    'Flat, {from} to {to}',
    { from: 'percent', to: 'percent' },
    { shape: 'label' },
  ),
  'paces.terrain.band-over': tpl('Over {from}', { from: 'percent' }, { shape: 'label' }),
  'paces.terrain.band-under': tpl('Under {to}', { to: 'percent' }, { shape: 'label' }),
  'paces.terrain.share': tpl('{share}', { share: 'share' }, { shape: 'label' }),
  'paces.terrain.minutes': tpl('{minutes}', { minutes: 'minutes' }, { shape: 'label' }),
  'paces.terrain.src-personal': tpl('Yours', {}, { shape: 'label' }),
  'paces.terrain.src-default': tpl('Default', {}, { shape: 'label' }),
  'paces.terrain.why-flat': tpl('The reference', {}, { shape: 'label' }),
  'paces.terrain.why-personal': tpl('From your own runs', {}, { shape: 'label' }),
  'paces.terrain.why-few-minutes': tpl('Too few minutes', {}, { shape: 'label' }),
  'paces.terrain.why-few-runs': tpl('Too few runs', {}, { shape: 'label' }),
  'paces.terrain.why-steep-end': tpl('Always the default', {}, { shape: 'label' }),
  'paces.terrain.why-untested': tpl('Not tested yet', {}, { shape: 'label' }),
  'paces.terrain.why-no-gain': tpl('Not closer in the test', {}, { shape: 'label' }),
  'paces.terrain.why-inconsistent': tpl('Not consistent', {}, { shape: 'label' }),
  'paces.terrain.walk-heading': tpl('Walking', {}, { shape: 'label' }),
  'paces.terrain.walk-from': tpl('Walking passes half the time from {grade}.', {
    grade: 'percent',
  }),
  'paces.terrain.walk-below': tpl(
    'Walking is half the time or less on every climbing grade that has enough runs to say.',
  ),
  'paces.terrain.walk-row': tpl(
    '{share} of the time walking',
    { share: 'share' },
    { shape: 'label' },
  ),
  'paces.terrain.walk-none': tpl(
    'No climbing grade has enough runs to say how much you walk. A grade does with {minutes} on it in {runs} runs.',
    { minutes: 'minutes', runs: 'count' },
  ),
  'paces.terrain.walk-floor': tpl('Walking here means slower than {pace}.', { pace: 'pace' }),
  'paces.terrain.how-curve': tpl(
    'Each run gives its speed on a grade as a share of its own flat speed, which takes out the effort of the day (I13).',
  ),
  'paces.terrain.how-default': tpl('The default is the cost of the grade at equal effort (I11).'),
  'paces.terrain.how-gate': tpl(
    'A grade shows your speed only if, leaving each run out in turn, your speed from the others is closer to it than the default by {gain} of the default error (I13).',
    { gain: 'percent' },
  ),
  'paces.terrain.how-gate-runs': tpl(
    'It must also be closer in more runs than chance gives (a sign test at {level}), on at least {runs} tested runs.',
    { level: 'percent', runs: 'count' },
  ),
  'paces.terrain.how-steep': tpl(
    'Steeper than {grade}, up or down, the default is always used, because the data is thin there (I13).',
    { grade: 'percent' },
  ),
  'paces.terrain.how-walk': tpl(
    'Walking is time slower than {pace}, the walking floor (C9), and the grade is where it passes half the time.',
    { pace: 'pace' },
  ),
  'paces.terrain.descent-note': tpl(
    'On a descent the default is the most speed equal effort allows (I13, I11), so your own figure can sit under it.',
  ),
  'paces.terrain.how-display': tpl(
    'Predictions read this a little (L5), on grades whose test passed. Neither the training plan nor the zones read it; the race plan’s times follow the prediction.',
  ),
  'paces.terrain.how-grade': tpl(
    'This is a grade D default (I13): a way to look at your runs, not a measured threshold.',
  ),

  // The test the engine supports
  'paces.test.heading': tpl('A short test', {}, { shape: 'label' }),
  'paces.test.steps': tpl('The steps', {}, { shape: 'label' }),
  'paces.test.intro': tpl(
    'Critical speed turns a few hard efforts into a pace and a time at every distance, with or without a race.',
  ),
  'paces.test.step-efforts': tpl(
    'Run {need} hard, flat efforts of {min} to {max}, on separate days and at different distances, after an easy warm-up.',
    { need: 'count', min: 'distance', max: 'distance' },
  ),
  'paces.test.step-spread': tpl(
    'Make the longest last at least {ratio} times as long as the shortest. Efforts of {from} to {to} fit best.',
    { ratio: 'count', from: 'minutes', to: 'minutes' },
  ),
  'paces.test.step-log': tpl('Log each as a run or a race. They count for {days} days.', {
    days: 'count',
  }),
  'paces.test.progress': tpl('{have} of {need} efforts found so far.', {
    have: 'count',
    need: 'count',
  }),
  'paces.test.done': tpl('Critical speed is in place. Further hard efforts keep it current.'),
  'paces.test.training': tpl(
    'Critical speed is estimated from your training runs, which are rarely all-out, so the ranges are wide. The steps narrow it.',
  ),
  'paces.test.care': tpl('Keep a rest day between efforts, and stop if anything hurts.'),
  'paces.test.how-stretch': tpl(
    'A run of {min} to {max} is one effort; a longer run gives its fastest stretches (A6).',
    { min: 'distance', max: 'distance' },
  ),
  'paces.test.how-own': tpl(
    'When test runs and races give a fit on their own, the stretches of training runs are left out.',
  ),
  'paces.test.how': tpl(
    'The fit is a straight line of distance against time over the best effort of each distance band (A6, L1). It needs the efforts to differ in length.',
  ),
} satisfies Record<string, Template>

/** The ids of the templates that have no slot, rendered with `pacesText`. */
export type PlainPacesId = {
  [K in keyof typeof PACES_TEMPLATES]: keyof (typeof PACES_TEMPLATES)[K]['slots'] extends never
    ? K
    : never
}[keyof typeof PACES_TEMPLATES]

/** A sentence or label of the page that has no slot. */
export function pacesText(id: PlainPacesId): string {
  return render(PACES_TEMPLATES[id], {}, 'km')
}

const LINE_ISSUE_IDS = {
  flat: 'paces.easy.line-flat',
  'outside-runs': 'paces.easy.line-outside',
  'too-fast': 'paces.easy.line-fast',
  'too-slow': 'paces.easy.line-slow',
} as const satisfies Record<LineIssue, PlainPacesId>

/** Why the heart-rate line gave no easy pace, in plain words and with no blame. */
export function lineIssueText(issue: LineIssue): string {
  return pacesText(LINE_ISSUE_IDS[issue])
}

const CLIMB_NOTE_IDS = {
  personal: 'paces.easy.climb-own',
  'few-minutes': 'paces.easy.climb-few-minutes',
  'few-runs': 'paces.easy.climb-few-runs',
  untested: 'paces.easy.climb-untested',
  'no-gain': 'paces.easy.climb-no-gain',
  inconsistent: 'paces.easy.climb-inconsistent',
  // The example grade sits in a steep end or the flat band only if its Param is moved there.
  'steep-end': 'paces.easy.climb-default',
  flat: 'paces.easy.climb-default',
} as const satisfies Record<BandReason, PlainPacesId>

/** The line under the climb row: whose speed it uses, and when it is the default, why. */
export function climbNoteText(reason: BandReason): string {
  return pacesText(CLIMB_NOTE_IDS[reason])
}

const BAND_WHY_IDS = {
  flat: 'paces.terrain.why-flat',
  personal: 'paces.terrain.why-personal',
  'few-minutes': 'paces.terrain.why-few-minutes',
  'few-runs': 'paces.terrain.why-few-runs',
  'steep-end': 'paces.terrain.why-steep-end',
  untested: 'paces.terrain.why-untested',
  'no-gain': 'paces.terrain.why-no-gain',
  inconsistent: 'paces.terrain.why-inconsistent',
} as const satisfies Record<BandReason, PlainPacesId>

/** Why a band shows what it shows, in a few words for the table. */
export function bandWhyText(reason: BandReason): string {
  return pacesText(BAND_WHY_IDS[reason])
}

/** A band's grades as a label: "3% to 6%", "Over 15%", "Under -15%", "Flat, -3% to 3%". */
export function bandLabelText(
  band: Pick<GradeBand, 'fromPct' | 'toPct' | 'reason'>,
  units: Units,
): string {
  const { fromPct, toPct } = band
  const from = fromPct === null ? null : ({ kind: 'percent', pct: fromPct } as const)
  const to = toPct === null ? null : ({ kind: 'percent', pct: toPct } as const)
  if (from !== null && to !== null) {
    const id = band.reason === 'flat' ? 'paces.terrain.band-flat' : 'paces.terrain.band-range'
    return render(PACES_TEMPLATES[id], { from, to }, units)
  }
  if (from !== null) return render(PACES_TEMPLATES['paces.terrain.band-over'], { from }, units)
  if (to !== null) return render(PACES_TEMPLATES['paces.terrain.band-under'], { to }, units)
  return ''
}

/** The weights of the blend of the runner's own climbing into a prediction (rule L5), from the Params. */
export function climbWeightsLine(units: Units): string {
  return render(
    PACES_TEMPLATES['paces.events.how-climb-weights'],
    {
      faster: { kind: 'percent', pct: P.l5.personalBlendFaster.value * 100 },
      slower: { kind: 'percent', pct: P.l5.personalBlendSlower.value * 100 },
      max: { kind: 'percent', pct: P.l5.personalBlendMaxShiftPct.value },
    },
    units,
  )
}
