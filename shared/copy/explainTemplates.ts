// The sentences of "From your numbers" (phase 3a design 8.4 and 8.6): one fact per figure a rule
// read, rendered from a template id and its slots by `renderFact`. They are spread into `TEMPLATES`,
// so the copy-lint test renders every one. The builders are in `shared/engine/explainInputs.ts`.
//
// Ids are `explain.<rule or topic>-<name>` and never change meaning once a record may hold them. A
// gap sentence says what the rule needs and what was found; the drawer puts "Not enough data yet:"
// in front of it. Plurals that vary are avoided by wording ("Days since then: 12"), not by logic.
import { tpl, type Template } from './template.ts'

export const EXPLAIN_TEMPLATES = {
  // A3 and g-1: the longest recent run
  'explain.longest-distance': tpl(
    'Your longest run in the last {days} days was {distance} on {date}.',
    { days: 'count', distance: 'distance', date: 'date' },
  ),
  'explain.longest-duration': tpl(
    'Your longest run by time in the last {days} days was {duration} on {date}.',
    { days: 'count', duration: 'duration', date: 'date' },
  ),
  'explain.longest-gap': tpl(
    'No completed run in the last {days} days, so there is no longest run to compare a new run with.',
    { days: 'count' },
  ),
  'explain.g1-session': tpl('This session is {share} of that distance.', { share: 'share' }),
  'explain.g1-warn': tpl('Runs longer than {limit} get a warning.', { limit: 'distance' }),
  'explain.g1-override': tpl('Runs longer than {limit} are not planned unless you ask.', {
    limit: 'distance',
  }),

  // g-2: the weekly ramp
  'explain.g2-last-week': tpl('Running time in the week of {week} was {minutes}.', {
    week: 'date',
    minutes: 'minutes',
  }),
  'explain.g2-ramp': tpl('The plan adds at most {pct} to a week of running.', { pct: 'percent' }),
  'explain.g2-plan-week': tpl('The plan sets the week of {week} at up to {minutes}.', {
    week: 'date',
    minutes: 'minutes',
  }),
  'explain.g2-gap': tpl(
    'The ramp needs a week of running in the last {weeks} weeks; none found. The plan starts from a default week.',
    { weeks: 'count' },
  ),

  // g-6: lost volume is never made up
  'explain.g6-completion': tpl('In the week of {week} you ran {actual} of {planned} planned.', {
    week: 'date',
    actual: 'minutes',
    planned: 'minutes',
  }),
  'explain.g6-cap': tpl(
    'The week of {week} is capped at {minutes}: the lower of the plan and the week before plus {pct}.',
    { week: 'date', minutes: 'minutes', pct: 'percent' },
  ),
  'explain.g6-gap': tpl(
    'No planned minutes are on file for the week of {week}, so there is nothing to compare your running with.',
    { week: 'date' },
  ),

  // A2: chronic and acute load
  'explain.a2-load': tpl(
    'Load over the last {acuteDays} days is {acute} and over the last {chronicDays} days {chronic}, counted in {metric}.',
    {
      acuteDays: 'count',
      acute: 'count',
      chronicDays: 'count',
      chronic: 'count',
      metric: 'text',
    },
  ),
  'explain.a2-gap': tpl('No activity in the last {days} days, so there is no load to describe.', {
    days: 'count',
  }),

  // A5 and J7: the last run
  'explain.last-run': tpl('Your last run was on {date}. Days since then: {days}.', {
    date: 'date',
    days: 'count',
  }),

  // A5: experience class
  'explain.a5-class': tpl('The plan treats you as a {experience} runner.', { experience: 'text' }),
  'explain.a5-weeks': tpl('You ran in {n} of the last {weeks} weeks.', {
    n: 'count',
    weeks: 'count',
  }),
  'explain.a5-years': tpl('Your profile says you have been running since {year}.', {
    year: 'text',
  }),
  'explain.a5-gap': tpl(
    'No run found in the last {days} days and no start year in your profile, so you count as a novice until runs are logged.',
    { days: 'count' },
  ),

  // A6, C4 and C5: critical speed
  'explain.a6-cs': tpl(
    'Your critical speed is {speed}, a pace of {pace}, from {n} efforts in the last {days} days.',
    { speed: 'speed', pace: 'pace', n: 'count', days: 'count' },
  ),
  'explain.cs-gap': tpl(
    'Critical speed needs {need} efforts between {from} and {to} in the last {days} days; {found} found. Zones use heart rate and effort until then.',
    { need: 'count', from: 'distance', to: 'distance', days: 'count', found: 'count' },
  ),
  'explain.cs-spread-gap': tpl(
    'The {found} efforts found are too close in length to fit critical speed; they need to differ by a factor of {ratio}.',
    { found: 'count', ratio: 'count' },
  ),

  'explain.c-break-gap': tpl(
    'Pace anchors are cleared after a break of {days} days or more and return with fresh efforts. Zones use heart rate and effort until then.',
    { days: 'count' },
  ),

  // A7: durability
  'explain.a7-drift': tpl(
    'On {n} comparable long runs, pace and heart rate drifted apart by {pct} (median).',
    { n: 'count', pct: 'percent' },
  ),
  'explain.a7-gap': tpl(
    'Durability needs {need} comparable long runs in the cool, under {temp}; {found} found. The default is used until then.',
    { need: 'count', temp: 'temp', found: 'count' },
  ),

  // A8: efficiency
  'explain.a8-up': tpl(
    'On steady flat runs you cover {pct} more ground per heartbeat than in the weeks before.',
    { pct: 'percent' },
  ),
  'explain.a8-down': tpl(
    'On steady flat runs you cover {pct} less ground per heartbeat than in the weeks before.',
    { pct: 'percent' },
  ),
  'explain.a8-hr-model': tpl(
    'At {pace}, the top of easy pace, your heart rate tends to sit near {bpm}, from {n} steady runs.',
    { pace: 'pace', bpm: 'bpm', n: 'count' },
  ),
  'explain.a8-gap': tpl(
    'Efficiency needs {need} steady flat runs of {from} to {to} in each of two windows; {recent} found in the latest and {prior} in the one before.',
    { need: 'count', from: 'minutes', to: 'minutes', recent: 'count', prior: 'count' },
  ),

  // C1: zones and the session's target
  'explain.c1-target-ceiling': tpl(
    'This session keeps your heart rate under {bpm}, the top of your zone 1.',
    { bpm: 'bpm' },
  ),
  'explain.c1-target-band': tpl(
    'This session targets a heart rate of {low} to {high}, your zone {zone}.',
    { low: 'bpm', high: 'bpm', zone: 'count' },
  ),
  'explain.c1-target-pace': tpl('This session targets a pace of {slow} to {fast}.', {
    slow: 'pace',
    fast: 'pace',
  }),
  'explain.c1-target-effort': tpl('This session goes by effort, {low} to {high} out of 10.', {
    low: 'count',
    high: 'count',
  }),
  'explain.c1-target-rpe': tpl('The effort should feel like {low} to {high} out of 10.', {
    low: 'count',
    high: 'count',
  }),
  'explain.c1-pace-guide': tpl('Pace is a guide here: {slow} to {fast}.', {
    slow: 'pace',
    fast: 'pace',
  }),
  'explain.c1-zones-hr': tpl('Your zone 1 tops out at {z1}, zone 2 at {z2} and zone 3 at {z3}.', {
    z1: 'bpm',
    z2: 'bpm',
    z3: 'bpm',
  }),
  'explain.c1-gap': tpl(
    'Zones need a maximum heart rate or your age, and a threshold; none found. Targets go by effort until then.',
  ),

  // C2: anchors and their sources
  'explain.c2-anchor': tpl('Your {anchor} comes from {source}, as of {date}.', {
    anchor: 'text',
    source: 'text',
    date: 'date',
  }),
  'explain.c2-cs': tpl('Your critical speed is fitted from your recent efforts, as of {date}.', {
    date: 'date',
  }),
  'explain.c2-gap': tpl(
    'No anchor is on file yet. Add a maximum heart rate or your age to your profile, or log a few hard efforts.',
  ),

  // C3: maximum heart rate
  'explain.c3-measured': tpl(
    'Your maximum heart rate is {bpm}, a measured value from your profile.',
    {
      bpm: 'bpm',
    },
  ),
  'explain.c3-profile': tpl('Your maximum heart rate is {bpm}, as entered in your profile.', {
    bpm: 'bpm',
  }),
  'explain.c3-age': tpl(
    'Your maximum heart rate is estimated at {bpm} from your age, give or take {band}.',
    { bpm: 'bpm', band: 'bpm' },
  ),
  'explain.c3-gap': tpl(
    'No maximum heart rate or age is on file, so heart-rate zones cannot be set. Add either in your profile.',
  ),

  // C4: the line between zones 1 and 2
  'explain.c4-cs': tpl(
    'The line between zones 1 and 2 sits at {share} of your critical speed, a pace of {pace}.',
    { share: 'share', pace: 'pace' },
  ),
  'explain.c4-profile': tpl(
    'The line between zones 1 and 2 is a pace of {pace}, worked out from the threshold pace in your profile.',
    { pace: 'pace' },
  ),
  'explain.c4-hr': tpl('By heart rate, the line between zones 1 and 2 sits at {bpm}.', {
    bpm: 'bpm',
  }),

  // C5: threshold pace
  'explain.c5-cs': tpl('Threshold pace is {pace}, {margin} slower than your critical speed.', {
    pace: 'pace',
    margin: 'speed',
  }),
  'explain.c5-profile': tpl('Threshold pace is {pace}, the threshold pace in your profile.', {
    pace: 'pace',
  }),
  'explain.c5-gap': tpl(
    'Threshold pace needs critical speed or a tested threshold; none found. Threshold work goes by effort until then.',
  ),

  // J2: the check-in comes first
  'explain.j2-checkins': tpl('You checked in on {n} of the last {days} days.', {
    n: 'count',
    days: 'count',
  }),
  'explain.j2-low': tpl('Check-ins on the low side: {n}.', { n: 'count' }),
  'explain.j2-gap': tpl(
    'No check-in in the last {days} days. Readiness leans on other signals until one is added.',
    { days: 'count' },
  ),

  // J3: readiness only makes a session easier
  'explain.j3-normal': tpl('Readiness on {date} reads normal: no signal is flagged.', {
    date: 'date',
  }),
  'explain.j3-fatigue': tpl(
    'Readiness on {date} shows possible fatigue, so a session can be made easier but never harder.',
    { date: 'date' },
  ),
  'explain.j3-suppression': tpl(
    'Readiness has stayed low for at least {days} days as of {date}, so a lighter week may help.',
    { days: 'count', date: 'date' },
  ),
  'explain.j3-gap': tpl(
    'No check-in or wearable reading for {date}, so readiness reads normal by default.',
    { date: 'date' },
  ),

  // J4: heart-rate variability (the readings themselves reuse the today.signal.hrv sentences)
  'explain.j4-gap': tpl(
    'HRV needs {need} readings in the last {days} days; {found} found. Readiness leans on your check-in until then.',
    { need: 'count', days: 'count', found: 'count' },
  ),

  'explain.j4-today-gap': tpl(
    'No HRV reading for {date}, so your check-in carries readiness today.',
    { date: 'date' },
  ),

  // J5: the weekly decision
  'explain.j5-progress': tpl(
    'For the week of {week} the plan reads progress, so the next week is up to {minutes}.',
    { week: 'date', minutes: 'minutes' },
  ),
  'explain.j5-hold': tpl(
    'For the week of {week} the plan holds the volume, so the next week is up to {minutes}.',
    { week: 'date', minutes: 'minutes' },
  ),
  'explain.j5-reduce': tpl(
    'For the week of {week} the plan eases the volume, so the next week is up to {minutes}.',
    { week: 'date', minutes: 'minutes' },
  ),
  'explain.j5-completion': tpl(
    '{actual} of {planned} planned were run, under the {share} the plan looks for.',
    { actual: 'minutes', planned: 'minutes', share: 'share' },
  ),
  'explain.j5-reds': tpl('The energy-availability screen showed {n} signs, so progression holds.', {
    n: 'count',
  }),
  'explain.j5-signal': tpl('The week also showed {sign}, which the plan acts on.', {
    sign: 'text',
  }),
  'explain.j5-post-race': tpl(
    'The week of {week} falls in the window after your race, so the return schedule governs it.',
    { week: 'date' },
  ),
  'explain.j5-gap': tpl(
    'No plan covers the week of {week}, so there is no weekly decision to explain.',
    { week: 'date' },
  ),

  // J7: breaks
  'explain.j7-restart': tpl(
    'After a break this long, the first week back is {share} of the week before the break.',
    { share: 'share' },
  ),
  'explain.j7-gap': tpl(
    'No run is on file, so no break can be measured. The first week follows your start path.',
  ),

  // L1 to L6: the prediction
  'explain.l1-basis': tpl('The prediction rests on {basis}.', { basis: 'text' }),
  'explain.l1-anchor': tpl(
    'Your closest race to this distance is {distance} in {duration} on {date}.',
    { distance: 'distance', duration: 'duration', date: 'date' },
  ),
  'explain.l-gap': tpl(
    'A prediction needs a race result or critical speed from {need} efforts; none found. Add a race result to see one.',
    { need: 'count' },
  ),
  'explain.l2-gap': tpl(
    'A marathon prediction needs a race result or critical speed to start from; none found.',
  ),
  'explain.l2-single': tpl(
    'One race of {distance} or shorter adds {pct} for the longer distance.',
    {
      distance: 'distance',
      pct: 'percent',
    },
  ),
  'explain.l2-drift': tpl(
    'Pace and heart rate drift apart by {pct} on your long runs, which sets the share of critical speed you hold.',
    { pct: 'percent' },
  ),
  'explain.l3-sources': tpl(
    'Sources used for this prediction: {n}; the rule asks for at least {min}.',
    {
      n: 'count',
      min: 'count',
    },
  ),
  'explain.l3-gap': tpl(
    'A prediction needs at least {min} sources, such as a race and critical speed; none can be used yet.',
    {
      min: 'count',
    },
  ),
  'explain.l3-widened': tpl('With fewer sources the range is {pct} wider.', { pct: 'percent' }),
  'explain.l4-band': tpl(
    'For a distance this long the range is at least {pct} either side of the time.',
    { pct: 'percent' },
  ),
  'explain.l4-gap': tpl(
    'An ultra prediction starts from a marathon or ultra result and your long runs; none found.',
  ),
  'explain.l5-climb': tpl('{gain} of climb counts as {distance} of flat distance.', {
    gain: 'climb',
    distance: 'distance',
  }),
  'explain.l5-trail': tpl('On a trail course the range is widened by {pct}.', { pct: 'percent' }),
  'explain.l5-gap': tpl(
    'A trail prediction starts from a road estimate, which needs a race result or critical speed; none found.',
  ),
  'explain.l6-gap': tpl(
    'The minimum range applies once there is a prediction; none can be made yet.',
  ),
  'explain.l6-range': tpl('The predicted time is {predicted}, with a range of {low} to {high}.', {
    predicted: 'duration',
    low: 'duration',
    high: 'duration',
  }),
  'explain.l6-floor': tpl(
    'The range is never narrower than {pct} either side of the predicted time.',
    {
      pct: 'percent',
    },
  ),
} satisfies Record<string, Template>
