// The words of the My paces page (rule C9, ADR 0020): the easy pace, the zones and what the runner
// can run now. Every sentence is a template, so the shared G5 lint renders it; a pace or a time is a
// sketch to run by, never a promise or a target, and the page says so. `PACES_TEMPLATES` is spread
// into `TEMPLATES`. Figures arrive as quantities in the runner's units; the rule ids in the "how
// these are made" lines are the ones the engine cites.
import { render, tpl, type Template } from './template.ts'

export const PACES_TEMPLATES = {
  // The page
  'paces.title': tpl('My paces', {}, { shape: 'label' }),
  'paces.context': tpl(
    'Your easy pace, your zones and what you can run now, worked out from your own runs. Sketches to run by, not promises.',
  ),
  'paces.more-note': tpl('Easy pace, zones and what you can run now', {}, { shape: 'label' }),
  'paces.offline': tpl('My paces need a connection. Today works offline.'),
  'paces.error': tpl('My paces did not load. Reload the page to try again.'),
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
  'paces.easy.scenarios': tpl(
    'Heat lifts your heart rate at the same pace, and a climb costs more for the same speed, so both slow the pace that keeps you easy.',
  ),
  'paces.easy.hot-none': tpl(
    'Heat cannot be put in minutes without your own heart-rate line. On a hot day, go by effort.',
  ),
  'paces.easy.upgrade': tpl(
    'A pace from your own heart rate needs {need} steady, flat runs with heart rate in {weeks} weeks. {have} so far.',
    { need: 'count', weeks: 'count', have: 'count' },
  ),
  'paces.easy.line-unclear': tpl(
    'Your heart-rate line does not give an easy pace yet, because your runs cover a narrow range of speeds. Zone 1 stands in.',
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
  'paces.event.single': tpl('One source only, so the range is wider.'),
  'paces.event.climb': tpl(
    'Climb is counted as flat distance, and the range is widened for trail.',
  ),
  'paces.event.wide': tpl('The range is wide on purpose at this length.'),
  'paces.events.how-time': tpl(
    'A race gives the time by a personal exponent or Riegel; critical speed gives it by a fit (L1, L2).',
  ),
  'paces.events.how-range': tpl(
    'One source widens the range (L3), and no range is narrower than its minimum (L6).',
  ),
  'paces.events.how-climb': tpl('Climb counts as flat distance, and trail widens the range (L5).'),
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
  'paces.test.care': tpl('Keep a rest day between efforts, and stop if anything hurts.'),
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
