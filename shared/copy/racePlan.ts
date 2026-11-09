// The words of the race plan (rule H14, ADR 0018, ADR 0010): every sentence a template over the
// facts of `racePlanFor`, so the shared G5 lint renders each one in both unit systems. The Race
// page, the Today card and the race-day block of the session sheet all call `describeRacePlan`
// or `describeRaceSummary`, so none can say something the others do not.
//
// Rules of the copy, beyond the lint:
// - A plan is a sketch. Ranges, "about", and no sentence that sets a pace, a split or a push. The
//   parts of the race are a reading aid: the effort is the same in every one.
// - A figure that restates a Param is a slot filled from the plan, which reads `P`; a copy test
//   renders the sentence next to the Param.
// - A figure that belongs to a study (the 65 km race, the 220 km race) is written as that study's
//   own, with its population, as the H11 line of Explain does.
// - No sentence compares a cutoff with the range, asks for a finish time or says "behind". The
//   cutoff and the arrival range of a checkpoint are two plain facts in two separate lines.
//
// Pure. The sentences that fuel, fluid and the safety card already have (`fuelCopy.ts`) are
// reused, not written again.
import { signedMinutes } from '../engine/predict.ts'
import {
  eahText,
  FUEL_TEMPLATES,
  fluidLine,
  gutConditionLock,
  lowCertaintyLine,
  nauseaPlan,
  rateText,
} from '../engine/fuelCopy.ts'
import type {
  RaceClock,
  RaceNotice,
  RacePlan,
  RacePlanSummary,
  RaceThird,
  RaceWeek,
} from '../engine/racePlan.ts'
import type { SplitRow } from '../engine/raceSplits.ts'
import { P } from '../engine/params/index.ts'
import type { RacePlanReason, Units } from '../types.ts'
import { RACE_CARB_ROUND_G } from './limits.ts'
import { render, tpl, type SlotSpec, type SlotValues, type Template } from './template.ts'
import { TODAY_TEMPLATES } from './today.ts'

export const RACE_PLAN_TEMPLATES = {
  // ---- The page and the empty states ------------------------------------------------------------
  'race.plan.title': tpl('Race plan', {}, { shape: 'label' }),
  'race.plan.more-note': tpl(
    'Effort, fuel, heat and the expected time for the goal race',
    {},
    { shape: 'label' },
  ),
  'race.plan.empty.no-goal': tpl('Add a goal race to see its plan.'),
  'race.plan.empty.no-distance': tpl('The goal needs a distance before it can have a race plan.'),
  'race.plan.empty.not-ultra': tpl(
    'The race plan is for ultra distances. A shorter race keeps its session as planned.',
  ),
  'race.plan.empty.race-over': tpl('This race is over, so there is no plan to show.'),
  // The note under the title while the page shows the phone's saved copy (ADR 0012, addendum): the
  // browser says offline, or the service worker answered from its cache.
  'race.plan.offline.saved': tpl(
    'Offline. Showing the race plan saved at {time}.',
    { time: 'text' },
    { fallback: 'Offline. Showing the race plan saved on this phone.' },
  ),
  'race.plan.offline.saved-earlier': tpl(
    'Offline. Showing the race plan saved on {date} at {time}.',
    { date: 'date', time: 'text' },
    { fallback: 'Offline. Showing the race plan saved earlier on this phone.' },
  ),
  'race.plan.offline.saved-phone': tpl('Offline. Showing the race plan saved on this phone.'),
  'race.plan.days-to-go': tpl('{n} days to go', { n: 'count' }, { shape: 'label' }),
  'race.plan.days-to-go-one': tpl('1 day to go', {}, { shape: 'label' }),
  'race.plan.race-day': tpl('Race day', {}, { shape: 'label' }),
  'race.plan.open': tpl('Open the race plan', {}, { shape: 'label' }),
  'race.plan.sketch': tpl(
    'Every line is a sketch from rules and your own runs. Ranges are wide on purpose.',
  ),

  // ---- Expected time (the range comes from `today.race.estimate` and `today.race.wide`) --------
  'race.plan.expected.heading': tpl('Expected time', {}, { shape: 'label' }),
  'race.plan.expected.figure': tpl('{duration}', { duration: 'duration' }, { shape: 'label' }),
  'race.plan.expected.source-range': tpl('Most likely time. Finish estimate {low} to {high}.', {
    low: 'duration',
    high: 'duration',
  }),
  'race.plan.expected.source-goal': tpl(
    'From the goal. A recent race or a few long runs would give a range.',
  ),
  'race.plan.firm.heading': tpl('How firm is this', {}, { shape: 'label' }),
  'race.plan.firm.link-prediction': tpl('Add a race result', {}, { shape: 'label' }),
  'race.plan.firm.link-start-time': tpl('Add a start time', {}, { shape: 'label' }),
  'race.plan.firm.link-heart-rate': tpl('Set your heart rate', {}, { shape: 'label' }),
  'race.plan.firm.link-climate': tpl('Save the climate', {}, { shape: 'label' }),
  'race.plan.firm.about': tpl('About these ranges', {}, { shape: 'label' }),
  'race.plan.expected.source-floor': tpl(
    'At most about this long. Finish estimate {low} to {high}.',
    {
      low: 'duration',
      high: 'duration',
    },
  ),
  'race.plan.expected.training': tpl(
    'The time rests on your best efforts in training since {date}, not on races. A race or a short test would likely show faster.',
    { date: 'date' },
  ),
  'race.plan.expected.clock': tpl('Start {start}. Finish about {range}.', {
    start: 'text',
    range: 'text',
  }),
  'race.plan.expected.climb': tpl(
    'Includes your own speed on climbs from {runs} runs, moving this by {shift}.',
    { runs: 'count', shift: 'text' },
  ),
  'race.plan.expected.climb-how': tpl(
    'Your climbing counts {faster} of the gap to the default when it is faster, {slower} when slower, and moves the time by at most {max} (L5).',
    { faster: 'percent', slower: 'percent', max: 'percent' },
  ),
  'race.plan.expected.round': tpl('Times are rounded to {step}, and the range outward.', {
    step: 'minutes',
  }),

  // ---- Notices: what is missing, in a line each --------------------------------------------------
  'race.plan.notice.no-prediction': tpl(
    'There is no prediction yet, so the expected time is the goal’s own.',
  ),
  'race.plan.notice.no-start-time': tpl(
    'Add a start time to the goal to see clock times and the hours outside daylight.',
  ),
  'race.plan.notice.no-heart-rate': tpl(
    'Your zones hold no heart rate yet, so the effort is the whole target.',
  ),
  'race.plan.notice.no-climate': tpl(
    'The race climate is not saved yet, so the plan says nothing about heat.',
  ),

  // ---- Effort ------------------------------------------------------------------------------------
  'race.plan.effort.heading': tpl('Effort', {}, { shape: 'label' }),
  'race.plan.effort.ceiling': tpl(
    'Keep heart rate at or below {bpm}, and the effort at {low} to {high} out of 10.',
    { bpm: 'bpm', low: 'count', high: 'count' },
  ),
  'race.plan.effort.effort-only': tpl('Go by effort: {low} to {high} out of 10.', {
    low: 'count',
    high: 'count',
  }),
  'race.plan.effort.hot': tpl(
    'The race is likely hot, so effort leads: {low} to {high} out of 10. Heart rate runs high in heat.',
    { low: 'count', high: 'count' },
  ),
  'race.plan.effort.study': tpl(
    'Amateur runners in a 65 km mountain race spent about {share} of the time at or below the first threshold.',
    { share: 'percent' },
  ),
  'race.plan.effort.reading-aid': tpl(
    'The parts are a reading aid, not a pacing script. The effort is the same in each.',
  ),
  'race.plan.part': tpl('Part {n} of {total}', { n: 'count', total: 'count' }, { shape: 'label' }),
  'race.plan.part.window': tpl(
    '{from} to {to} into the race',
    {
      from: 'duration',
      to: 'duration',
    },
    { shape: 'label' },
  ),
  'race.plan.part.clock': tpl('{range} on the clock', { range: 'text' }, { shape: 'label' }),
  'race.plan.part.dark': tpl('About {time} of this part falls outside daylight.', {
    time: 'minutes',
  }),
  'race.plan.part.fuel': tpl('About {low} to {high} g of carbohydrate over this part.', {
    low: 'count',
    high: 'count',
  }),
  'race.plan.part.late-climb': tpl(
    'In a study of 27 runners over 10 passes of a 220 km race, climbing speed changed with distance. The authors read the loss as muscle fatigue, from correlations.',
  ),
  'race.plan.part.late-descent': tpl(
    'After a mountain ultra, the energy cost of running downhill rose by about {share}.',
    { share: 'share' },
  ),
  'race.plan.part.late-expect': tpl(
    'Expect slower speed at the same effort. The plan does not ask for it to be made up.',
  ),

  // ---- Heat --------------------------------------------------------------------------------------
  'race.plan.heat.heading': tpl('Heat', {}, { shape: 'label' }),
  'race.plan.heat.climate': tpl(
    'Race heat is a WBGT of {temp}, typical for the date and not a forecast.',
    { temp: 'temp' },
  ),
  'race.plan.heat.daytime': tpl('This part starts in daytime heat, which slows the daytime hours.'),
  'race.plan.heat.confidence': tpl('Over {hours} hours, every heat adjustment is low confidence.', {
    hours: 'count',
  }),
  'race.plan.heat.prediction': tpl(
    'The prediction already allows for heat across the whole race; this line does not change it.',
  ),
  'race.plan.heat.start-time': tpl('Add a start time to see which parts fall in daytime heat.'),

  // ---- Climbing ----------------------------------------------------------------------------------
  'race.plan.climb.heading': tpl('Climbing', {}, { shape: 'label' }),
  'race.plan.climb.effort': tpl('Climb by effort, not by speed, and hike the steep parts.'),
  'race.plan.climb.hike': tpl(
    'From about {hike} grade, hiking is the cheaper gait. From {walk} to {hike}, the faster gait depends on how fast you climb.',
    { hike: 'percent', walk: 'percent' },
  ),
  'race.plan.climb.reference': tpl(
    'About {climb} of climbing an hour is a reference for sustained ultra climbing, not a target.',
    { climb: 'climb' },
  ),

  // ---- Fuel and fluid ----------------------------------------------------------------------------
  'race.plan.fuel.heading': tpl('Fuel and fluid', {}, { shape: 'label' }),
  'race.plan.fuel.rate': tpl('Carbohydrate: {rate}.', { rate: 'text' }),
  'race.plan.fuel.tolerated': tpl('This is the highest rate your own runs tolerated.'),
  'race.plan.fuel.floor': tpl(
    'Training has not tolerated a higher rate, so the floor is the rate.',
  ),
  'race.plan.fuel.few-hours': tpl(
    'That tolerance came from runs of a few hours. A race is much longer.',
  ),
  'race.plan.fuel.hot': tpl(
    'Tolerated on cooler days. A run without weather counts as cool, so no run known to be at race heat counted.',
  ),
  'race.plan.fuel.total': tpl('About {low} to {high} g over the expected time.', {
    low: 'count',
    high: 'count',
  }),
  'race.plan.fuel.carry': tpl(
    'You carry everything, so that total is what to carry for the expected time.',
  ),
  'race.plan.fuel.aid': tpl('At aid stations, drink to thirst and no more.'),
  'race.plan.fuel.link': tpl('Open the fuel lab', {}, { shape: 'label' }),

  // ---- Race week ---------------------------------------------------------------------------------
  'race.plan.week.heading': tpl('Race week', {}, { shape: 'label' }),
  'race.plan.week.carb': tpl(
    'In the last {fromH} to {toH} hours before the start, eat {low} to {high} g of carbohydrate per kg of body mass a day, with little running.',
    { fromH: 'count', toH: 'count', low: 'count', high: 'count' },
  ),
  'race.plan.week.carb-mass': tpl('For {kg} kg of body mass that is {low} to {high} g a day.', {
    kg: 'count',
    low: 'count',
    high: 'count',
  }),
  'race.plan.week.days': tpl('That covers {from} to {to}.', { from: 'date', to: 'date' }),
  'race.plan.week.evidence': tpl(
    'The trial fed eight endurance-trained men 10 g per kg a day for 3 days at rest, and measured muscle glycogen, not race results.',
  ),
  'race.plan.week.engine': tpl(
    'The lower end of the range and the length of the window are engine choices.',
  ),
  'race.plan.week.shake': tpl(
    'The plan keeps the day before to at most {min} of easy running, and easy running only from {date}.',
    { min: 'minutes', date: 'date' },
  ),
  'race.plan.week.heat': tpl(
    'The race is expected to be hot. Heat adaptation from your recent runs stands at {credit} of a full block.',
    { credit: 'share' },
  ),
  'race.plan.week.heat-top-up': tpl(
    'A few easy sessions in the heat in the final days can top it up.',
  ),
  'race.plan.week.no-weight': tpl('Add your weight to the profile to see the grams.'),

  // ---- Dark hours --------------------------------------------------------------------------------
  'race.plan.dark.heading': tpl('Dark hours', {}, { shape: 'label' }),
  'race.plan.dark.hours': tpl(
    'About {low} to {high} hours of the expected time fall outside daylight.',
    { low: 'count', high: 'count' },
  ),
  'race.plan.dark.whole': tpl('The race is expected to cross darkness.'),
  'race.plan.dark.clock': tpl(
    'Daylight here is {dawn} to {dusk}, a default. Season and place are not modelled.',
    { dawn: 'text', dusk: 'text' },
  ),
  'race.plan.dark.lamp': tpl('The plan asks for {low} to {high} headlamp runs before the race.', {
    low: 'count',
    high: 'count',
  }),

  // ---- Rehearsal: what the runner's recent runs hold of the night and downhill ask (H6, H5) ----
  // Descriptive: the ask sits in the dark block and the climbing line, these lines say what was done
  // and compare nothing (G5).
  'race.plan.rehearsal.heading': tpl('Rehearsal', {}, { shape: 'label' }),
  'race.plan.rehearsal.night': tpl('Night runs: {n} since {date}, {time} in the dark.', {
    n: 'count',
    date: 'date',
    time: 'minutes',
  }),
  'race.plan.rehearsal.night-none': tpl('Night runs: none since {date}.', { date: 'date' }),
  'race.plan.rehearsal.unplaced-one': tpl(
    '1 run has no start time or home place, so the sun cannot place it.',
  ),
  'race.plan.rehearsal.unplaced': tpl(
    '{n} runs have no start time or home place, so the sun cannot place them.',
    { n: 'count' },
  ),
  'race.plan.rehearsal.dark-note': tpl(
    'Dark here means the sun is more than {deg} degrees below the horizon at your home place.',
    { deg: 'count' },
  ),
  'race.plan.rehearsal.dark-note-runs': tpl(
    'Dark here means the sun is more than {deg} degrees below the horizon at the place of each run.',
    { deg: 'count' },
  ),
  'race.plan.rehearsal.downhill': tpl('Downhill: {time} on grades of {pct} or steeper.', {
    time: 'minutes',
    pct: 'percent',
  }),
  'race.plan.rehearsal.downhill-none': tpl('Downhill: none on grades of {pct} or steeper.', {
    pct: 'percent',
  }),
  'race.plan.rehearsal.long': tpl('Long runs with {time} or more of it: {n}.', {
    time: 'minutes',
    n: 'count',
  }),
  'race.plan.rehearsal.no-altitude-one': tpl(
    '1 run has no altitude, so it adds nothing to the downhill figure.',
  ),
  'race.plan.rehearsal.no-altitude': tpl(
    '{n} runs have no altitude, so they add nothing to the downhill figure.',
    { n: 'count' },
  ),
  'race.plan.rehearsal.no-altitude-all': tpl(
    'No run since {date} recorded altitude, so downhill time cannot be counted.',
    { date: 'date' },
  ),
  'race.plan.rehearsal.no-runs': tpl('No runs since {date}.', { date: 'date' }),

  // ---- Checkpoints (step 4): the runner's own course points, "course points" when self-supported --
  'race.plan.points.heading': tpl('Checkpoints', {}, { shape: 'label' }),
  'race.plan.points.heading-self': tpl('Course points', {}, { shape: 'label' }),
  'race.plan.points.empty': tpl(
    'Add the checkpoints of the course to see about when you reach each one. The plan works without them.',
  ),
  'race.plan.points.empty-self': tpl(
    'Add course points to see about when you reach each one. The plan works without them.',
  ),
  'race.plan.points.edit': tpl('Edit checkpoints', {}, { shape: 'label' }),
  'race.plan.points.edit-self': tpl('Edit course points', {}, { shape: 'label' }),
  'race.plan.points.finish': tpl('Finish', {}, { shape: 'label' }),
  'race.plan.points.list': tpl('Arrival times by point', {}, { shape: 'label' }),
  'race.plan.points.at': tpl(
    '{distance} from the start',
    { distance: 'distance' },
    { shape: 'label' },
  ),
  'race.plan.points.arrival-clock-at': tpl('About {at}', { at: 'text' }, { shape: 'label' }),
  'race.plan.points.arrival-elapsed-at': tpl(
    'About {at} into the race',
    { at: 'duration' },
    { shape: 'label' },
  ),
  'race.plan.points.arrival-clock': tpl('About {range}', { range: 'text' }, { shape: 'label' }),
  'race.plan.points.arrival-elapsed': tpl(
    'About {from} to {to} into the race',
    { from: 'duration', to: 'duration' },
    { shape: 'label' },
  ),
  'race.plan.points.segment': tpl('{distance} since the previous point.', { distance: 'distance' }),
  'race.plan.points.climb-entered': tpl('{climb} of climb, as entered.', { climb: 'climb' }),
  'race.plan.points.climb-shared': tpl(
    'About {climb} of climb, shared out from the course total.',
    {
      climb: 'climb',
    },
  ),
  'race.plan.points.descent': tpl('{climb} of descent, shown and not counted.', { climb: 'climb' }),
  'race.plan.points.day': tpl('Day', {}, { shape: 'label' }),
  'race.plan.points.night': tpl('Night', {}, { shape: 'label' }),
  'race.plan.points.climb-tag': tpl('Climb by effort', {}, { shape: 'label' }),
  'race.plan.points.carry': tpl('Carry about {low} to {high} g of carbohydrate.', {
    low: 'count',
    high: 'count',
  }),
  'race.plan.points.cutoff-clock': tpl('Cutoff {clock}', { clock: 'text' }, { shape: 'label' }),
  'race.plan.points.cutoff-elapsed': tpl(
    'Cutoff {elapsed} into the race',
    { elapsed: 'duration' },
    { shape: 'label' },
  ),
  'race.plan.points.weights': tpl(
    'The course is shared out by distance, counting each unit of climb as {n} units of flat. Climb left out is spread over the segments without one.',
    { n: 'count' },
  ),
  'race.plan.points.weights-own': tpl(
    'Your own speed on climbs from {runs} runs is blended in, so here each unit of climb counts as {n} units of flat, not {standard}.',
    { runs: 'count', n: 'text', standard: 'count' },
  ),
  'race.plan.points.late': tpl(
    'Speed tends to fall late in a long race, so the later end of each range is the likelier one.',
  ),
  'race.plan.points.defaults': tpl('These weights are defaults, not a model of your course.'),
  'race.plan.points.carry-note': tpl(
    'Grams to carry are an estimate: the carbohydrate rate above, over the time of each segment.',
  ),
  'race.plan.points.ignored': tpl('Points at or past the finish are left out: {n}.', {
    n: 'count',
  }),
  'race.plan.points.climb-over': tpl(
    'The climb you entered adds up to more than the climb on the goal, so the rest counts as flat.',
  ),
  'race.plan.points.climb-unknown': tpl(
    'The goal holds no course climb, so segments without a climb of their own count as flat.',
  ),

  // ---- The editor of the table ---------------------------------------------------------------------
  'race.plan.points.sheet': tpl('Edit checkpoints', {}, { shape: 'label' }),
  'race.plan.points.sheet-self': tpl('Edit course points', {}, { shape: 'label' }),
  'race.plan.points.sheet-hint': tpl(
    'Add the points in any order. Only the name and the distance are needed; the rest sharpens the times.',
  ),
  'race.plan.points.add': tpl('Add a checkpoint', {}, { shape: 'label' }),
  'race.plan.points.add-self': tpl('Add a course point', {}, { shape: 'label' }),
  'race.plan.points.remove': tpl('Remove', {}, { shape: 'label' }),
  'race.plan.points.save': tpl('Save', {}, { shape: 'label' }),
  'race.plan.points.saved': tpl('Saved', {}, { shape: 'label' }),
  'race.plan.points.save-failed': tpl('Not saved. Try again when you are back online.'),
  'race.plan.points.field-name': tpl('Name', {}, { shape: 'label' }),
  'race.plan.points.field-distance': tpl(
    'Distance from the start ({unit})',
    { unit: 'text' },
    { shape: 'label' },
  ),
  'race.plan.points.field-gain': tpl('Climb ({unit})', { unit: 'text' }, { shape: 'label' }),
  'race.plan.points.field-loss': tpl('Descent ({unit})', { unit: 'text' }, { shape: 'label' }),
  'race.plan.points.field-climb-hint': tpl('Since the previous point, in {unit}.', {
    unit: 'text',
  }),
  'race.plan.points.field-cutoff': tpl(
    'Cutoff, hours and minutes into the race',
    {},
    { shape: 'label' },
  ),
  'race.plan.points.field-cutoff-clock': tpl('Cutoff, time of day', {}, { shape: 'label' }),
  'race.plan.points.field-cutoff-day': tpl('Cutoff, day', {}, { shape: 'label' }),
  'race.plan.points.cutoff-as': tpl('Cutoff entered as', {}, { shape: 'label' }),
  'race.plan.points.cutoff-as-elapsed': tpl('Time into the race', {}, { shape: 'label' }),
  'race.plan.points.cutoff-as-clock': tpl('Time of day', {}, { shape: 'label' }),
  'race.plan.points.day-0': tpl('Race day', {}, { shape: 'label' }),
  'race.plan.points.day-n': tpl('Day {n}', { n: 'count' }, { shape: 'label' }),
  'race.plan.points.point-n': tpl('Point {n}', { n: 'count' }, { shape: 'label' }),
  'race.plan.points.err-name': tpl('Give the point a name of up to 60 characters.'),
  'race.plan.points.err-distance': tpl(
    'Enter a distance past the start and before the finish, like 42.5.',
  ),
  'race.plan.points.err-duplicate': tpl('Each point needs its own distance.'),
  'race.plan.points.err-metres': tpl('Enter whole {unit}, like {example}.', {
    unit: 'text',
    example: 'text',
  }),
  'race.plan.points.err-cutoff': tpl('Enter hours and minutes, like 9:30.'),
  'race.plan.points.err-clock': tpl('Enter a time of day that falls after the start.'),
  'race.plan.points.err-count': tpl('There is room for {n} points.', { n: 'count' }),

  // ---- The race card -------------------------------------------------------------------------------
  'race.plan.card.title': tpl('Race card', {}, { shape: 'label' }),
  'race.plan.card.view': tpl('View', {}, { shape: 'label' }),
  'race.plan.card.view-plan': tpl('Plan', {}, { shape: 'label' }),
  'race.plan.card.print': tpl('Print the card', {}, { shape: 'label' }),
  'race.plan.card.list': tpl('Race card, one block for each stop', {}, { shape: 'label' }),
  'race.plan.card.intro': tpl(
    'A table of every stop, then one block for each, to read at a glance or to print. The times are ranges from the plan: a sketch, not a promise.',
  ),
  'race.plan.card.empty': tpl(
    'The race card has one block for each checkpoint. Add checkpoints, or import the course, to build it.',
  ),
  'race.plan.card.start': tpl('Start', {}, { shape: 'label' }),
  'race.plan.card.window-label': tpl('Expected arrival', {}, { shape: 'label' }),
  'race.plan.card.window-label-elapsed': tpl(
    'Expected arrival, into the race',
    {},
    { shape: 'label' },
  ),
  'race.plan.card.window-elapsed': tpl(
    '{from} to {to}',
    { from: 'duration', to: 'duration' },
    { shape: 'label' },
  ),
  'race.plan.card.window-elapsed-at': tpl('{at}', { at: 'duration' }, { shape: 'label' }),
  'race.plan.card.start-label': tpl('Start time', {}, { shape: 'label' }),
  'race.plan.card.fact-climb': tpl('Climb', {}, { shape: 'label' }),
  'race.plan.card.fact-descent': tpl('Descent', {}, { shape: 'label' }),
  'race.plan.card.fact-fuel': tpl('Fuel', {}, { shape: 'label' }),
  'race.plan.card.value-climb': tpl('{climb}', { climb: 'climb' }, { shape: 'label' }),
  'race.plan.card.value-climb-about': tpl('About {climb}', { climb: 'climb' }, { shape: 'label' }),
  'race.plan.card.value-fuel-at': tpl('About {g} g', { g: 'count' }, { shape: 'label' }),
  'race.plan.card.value-fuel': tpl(
    'About {low} to {high} g',
    { low: 'count', high: 'count' },
    { shape: 'label' },
  ),
  'race.plan.card.note-entered': tpl('as entered', {}, { shape: 'label' }),
  'race.plan.card.note-shared': tpl('shared out from the course total', {}, { shape: 'label' }),
  'race.plan.card.note-descent': tpl('not used for the times', {}, { shape: 'label' }),
  'race.plan.card.note-carb': tpl('of carbohydrate for this leg', {}, { shape: 'label' }),
  'race.plan.card.sheet-caption': tpl(
    'Each stop with its distance and expected arrival',
    {},
    { shape: 'label' },
  ),
  'race.plan.card.sheet-caption-cutoff': tpl(
    'Each stop with its distance, expected arrival and cutoff',
    {},
    { shape: 'label' },
  ),
  'race.plan.card.sheet-caption-fuel': tpl(
    'Each stop with its distance, expected arrival and the fuel for the leg after it',
    {},
    { shape: 'label' },
  ),
  'race.plan.card.sheet-caption-both': tpl(
    'Each stop with its distance, expected arrival, cutoff and the fuel for the leg after it',
    {},
    { shape: 'label' },
  ),
  'race.plan.card.sheet-stop': tpl('Stop', {}, { shape: 'label' }),
  'race.plan.card.sheet-distance': tpl('Distance', {}, { shape: 'label' }),
  'race.plan.card.sheet-arrival': tpl('Expected arrival', {}, { shape: 'label' }),
  'race.plan.card.sheet-arrival-elapsed': tpl(
    'Expected arrival, into the race',
    {},
    { shape: 'label' },
  ),
  'race.plan.card.sheet-start': tpl('Start', {}, { shape: 'label' }),
  'race.plan.card.sheet-cutoff': tpl('Cutoff', {}, { shape: 'label' }),
  'race.plan.card.sheet-fuel': tpl('Fuel, next leg', {}, { shape: 'label' }),
  'race.plan.card.sheet-distance-at': tpl(
    '{distance}',
    { distance: 'distance' },
    { shape: 'label' },
  ),
  'race.plan.card.sheet-cutoff-elapsed': tpl(
    '{elapsed} into the race',
    { elapsed: 'duration' },
    { shape: 'label' },
  ),
  'race.plan.card.sheet-at-start': tpl('At the start', {}, { shape: 'label' }),
  'race.plan.card.sheet-no-cutoff': tpl('No cutoff', {}, { shape: 'label' }),
  'race.plan.card.sheet-no-fuel': tpl('No fuel', {}, { shape: 'label' }),
  'race.plan.card.next': tpl('Next: {name}, {distance} on.', {
    name: 'text',
    distance: 'distance',
  }),
  'race.plan.card.next-finish': tpl('Next: the finish, {distance} on.', { distance: 'distance' }),
  'race.plan.card.headlamp': tpl(
    'Headlamp: this arrival is outside daylight. Dusk is {dusk} and dawn {dawn}.',
    { dusk: 'text', dawn: 'text' },
  ),
  'race.plan.card.note-label': tpl('Crew note for {name}', { name: 'text' }, { shape: 'label' }),
  'race.plan.card.note-hint': tpl('Notes stay on this phone and are cleared when you sign out.'),
  'race.plan.card.note-unsaved': tpl('This browser would not keep the note.'),
  'race.plan.card.note-print': tpl('Crew note', {}, { shape: 'label' }),
  'race.plan.card.estimate-note': tpl(
    'Grams of carbohydrate are an estimate: the rate from the plan, over the time of each leg.',
  ),
  'race.plan.card.self-note': tpl(
    'You carry everything on this course, so no fuel is listed for each leg.',
  ),

  // ---- Checkpoints from a course file --------------------------------------------------------------
  'race.plan.course.import': tpl('Import course GPX', {}, { shape: 'label' }),
  'race.plan.course.file-label': tpl('Course GPX file', {}, { shape: 'label' }),
  'race.plan.course.reading': tpl('Reading the course file.'),
  'race.plan.course.err-unreadable': tpl(
    'That file could not be read as a course. Choose a GPX file that holds a track.',
  ),
  'race.plan.course.err-large': tpl('That file is over {n} MB. Choose a smaller GPX file.', {
    n: 'count',
  }),
  'race.plan.course.sheet': tpl('Checkpoints from the course', {}, { shape: 'label' }),
  'race.plan.course.summary': tpl(
    'Course in the file: {distance}, {gain} of climb and {loss} of descent.',
    { distance: 'distance', gain: 'climb', loss: 'climb' },
  ),
  'race.plan.course.summary-flat': tpl(
    'Course in the file: {distance}. The file holds no elevation, so the climb is left blank.',
    { distance: 'distance' },
  ),
  'race.plan.course.from-waypoints': tpl(
    'Proposed from the waypoints in the file: {n}. Rename, drop or add points, then type the cutoffs.',
    { n: 'count' },
  ),
  'race.plan.course.spaced': tpl(
    'The file holds no waypoints, so the points below are spaced evenly, about one in every {spacing}. Rename them and move each to its real place.',
    { spacing: 'distance' },
  ),
  'race.plan.course.off-track': tpl(
    'Waypoints more than {distance} from the track are left out: {n}.',
    { distance: 'distance', n: 'count' },
  ),
  'race.plan.course.merged': tpl(
    'Waypoints within {distance} of an earlier one are merged into it: {n}.',
    { distance: 'distance', n: 'count' },
  ),
  'race.plan.course.edge': tpl('Waypoints at the start or the finish are left out: {n}.', {
    n: 'count',
  }),
  'race.plan.course.length-differs': tpl(
    'The track is {track} long and the goal {goal}. The distances below follow the track.',
    { track: 'distance', goal: 'distance' },
  ),
  'race.plan.course.replaces': tpl('Saving replaces the checkpoints you have now.'),
  'race.plan.course.notes': tpl(
    'A crew note stays with a stop while the stop keeps its name and its place.',
  ),
  'race.plan.course.beyond-goal': tpl(
    'Waypoints at or past the goal distance of {goal} are left out: {n}.',
    { goal: 'distance', n: 'count' },
  ),
  'race.plan.course.capped': tpl(
    'There is room for {max} points, so the first {max} are kept and {n} are left out.',
    { max: 'count', n: 'count' },
  ),
  'race.plan.course.pass-name': tpl(
    '{name} ({ordinal} pass)',
    { name: 'text', ordinal: 'text' },
    { shape: 'label' },
  ),
  'race.plan.course.point-name': tpl('Point {n}', { n: 'count' }, { shape: 'label' }),
  'race.plan.course.profile-label': tpl(
    'Elevation profile, from {low} to {high}',
    { low: 'climb', high: 'climb' },
    { shape: 'label' },
  ),
  'race.plan.course.profile-caption': tpl(
    'Elevation in {unit} against distance in {distanceUnit}. Dots mark the checkpoints.',
    { unit: 'text', distanceUnit: 'text' },
  ),
  'race.plan.course.table-profile': tpl('Elevation along the course', {}, { shape: 'label' }),
  'race.plan.course.table-points': tpl('Checkpoints on the course', {}, { shape: 'label' }),
  'race.plan.course.col-distance': tpl('Distance ({unit})', { unit: 'text' }, { shape: 'label' }),
  'race.plan.course.col-elevation': tpl('Elevation ({unit})', { unit: 'text' }, { shape: 'label' }),
  'race.plan.course.col-name': tpl('Name', {}, { shape: 'label' }),
  // ---- The profile that leads the page ------------------------------------------------------
  'race.plan.profile.heading': tpl('Course', {}, { shape: 'label' }),
  'race.plan.profile.label': tpl(
    'Course profile over {distance}, net height from {low} to {high} against the start',
    { distance: 'distance', low: 'climb', high: 'climb' },
    { shape: 'label' },
  ),
  'race.plan.profile.caption': tpl(
    'Net height by leg in {unit}, a smooth line between the points entered.',
    { unit: 'text' },
  ),
  'race.plan.profile.caption-dark': tpl(
    'Band: the dark hours; the lighter part is dark at one end of the range only.',
  ),
  'race.plan.profile.caption-fuel': tpl('Ticks: each hour of the middle of the expected time.'),
  'race.plan.profile.caption-cutoff': tpl('Diamonds: the cutoffs entered, with the time of day.'),
  'race.plan.profile.hint': tpl('Touch or move along the course to read a point.'),
  'race.plan.profile.readout-name': tpl('Readout', {}, { shape: 'label' }),
  'race.plan.profile.start': tpl('Start', {}, { shape: 'label' }),
  'race.plan.profile.finish': tpl('Finish', {}, { shape: 'label' }),
  'race.plan.profile.at': tpl(
    '{name}, {distance} in',
    { name: 'text', distance: 'distance' },
    { shape: 'label' },
  ),
  'race.plan.profile.above': tpl('{climb} above the start', { climb: 'climb' }, { shape: 'label' }),
  'race.plan.profile.below': tpl('{climb} below the start', { climb: 'climb' }, { shape: 'label' }),
  'race.plan.profile.level': tpl('level with the start', {}, { shape: 'label' }),
  'race.plan.profile.next': tpl(
    'Next: {name}, {distance} on',
    { name: 'text', distance: 'distance' },
    { shape: 'label' },
  ),
  'race.plan.profile.next-finish': tpl(
    'Next: the finish, {distance} on',
    { distance: 'distance' },
    { shape: 'label' },
  ),
  'race.plan.profile.cutoff-clock': tpl('Cutoff {clock}', { clock: 'text' }, { shape: 'label' }),
  'race.plan.profile.cutoff-elapsed': tpl(
    'Cutoff {elapsed} in',
    { elapsed: 'duration' },
    { shape: 'label' },
  ),
  'race.plan.profile.table-stops': tpl(
    'Course points, with the height at each',
    {},
    { shape: 'label' },
  ),
  'race.plan.profile.table-dark': tpl('Stretches in the dark', {}, { shape: 'label' }),
  'race.plan.profile.table-fuel': tpl('Hourly fuel marks', {}, { shape: 'label' }),
  'race.plan.profile.col-from': tpl('From ({unit})', { unit: 'text' }, { shape: 'label' }),
  'race.plan.profile.col-to': tpl('To ({unit})', { unit: 'text' }, { shape: 'label' }),
  'race.plan.profile.col-dark': tpl('Dark at', {}, { shape: 'label' }),
  'race.plan.profile.dark-firm': tpl('both ends of the range', {}, { shape: 'label' }),
  'race.plan.profile.dark-possible': tpl('one end of the range', {}, { shape: 'label' }),
  'race.plan.profile.col-hour': tpl('Hour', {}, { shape: 'label' }),
  'race.plan.profile.col-cutoff': tpl('Cutoff', {}, { shape: 'label' }),
} satisfies Record<string, Template>

export type RacePlanTemplateId = keyof typeof RACE_PLAN_TEMPLATES

const T = RACE_PLAN_TEMPLATES

function say<S extends SlotSpec>(
  template: Template<S>,
  slots: SlotValues<S>,
  units: Units,
): string {
  return render(template, slots, units)
}

const count = (n: number) => ({ kind: 'count', n }) as const
const minutes = (min: number) => ({ kind: 'minutes', min }) as const
const duration = (sec: number) => ({ kind: 'duration', sec }) as const
const percent = (pct: number) => ({ kind: 'percent', pct }) as const
const oneDecimal = (n: number): string => String(Math.round(n * 10) / 10)
const share = (fraction: number) => ({ kind: 'share', fraction }) as const

/** A whole number the way every figure of the plan reads. */
const roundTo = (value: number, step: number): number => Math.round(value / step) * step

/** "06:00", "06:00 the next day" or "06:00 on day 3": a clock time with the day it falls on. */
export function clockText(clock: RaceClock): string {
  if (clock.day === 0) return clock.time
  if (clock.day === 1) return `${clock.time} the next day`
  return `${clock.time} on day ${String(clock.day + 1)}`
}

/**
 * Two ends of a range on the clock: one time when both read alike ("17:10 the next day"), the day named
 * once when both fall on the same later day ("17:10 to 19:30 the next day"), each with its own day otherwise.
 */
export function clockRangeText(from: RaceClock, to: RaceClock): string {
  if (from.day === to.day && from.time === to.time) return clockText(from)
  if (from.day === to.day && from.day > 0) {
    return `${from.time} to ${clockText(to)}`
  }
  return `${clockText(from)} to ${clockText(to)}`
}

/** The label of the days to the race: "Race day", "1 day to go" or "9 days to go". */
export function daysToGoText(daysToRace: number, units: Units): string {
  if (daysToRace <= 0) return say(T['race.plan.race-day'], {}, units)
  if (daysToRace === 1) return say(T['race.plan.days-to-go-one'], {}, units)
  return say(T['race.plan.days-to-go'], { n: count(daysToRace) }, units)
}

const EMPTY_TEMPLATES = {
  'no-goal': T['race.plan.empty.no-goal'],
  'no-distance': T['race.plan.empty.no-distance'],
  'not-ultra': T['race.plan.empty.not-ultra'],
  'race-over': T['race.plan.empty.race-over'],
} satisfies Record<RacePlanReason, Template>

/** The line the page shows when there is no plan, and why. */
export function raceEmptyText(reason: RacePlanReason, units: Units): string {
  return say(EMPTY_TEMPLATES[reason], {}, units)
}

/**
 * The note for a plan read from the phone's copy: the time it was kept, in the phone's zone, with
 * the day when that is not today ("saved at 06:12", "saved on Fri 23 Oct at 21:50"). Without a time
 * (a payload that carries none) it says only that the copy is the phone's.
 */
export function raceCopyNoteText(
  savedAt: string | undefined,
  now: Date,
  units: Units,
  zone?: string,
): string {
  const saved = savedAt === undefined ? null : new Date(savedAt)
  if (saved === null || Number.isNaN(saved.getTime())) {
    return say(T['race.plan.offline.saved-phone'], {}, units)
  }
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(saved)
  const day = (at: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(at)
  if (day(saved) === day(now)) return say(T['race.plan.offline.saved'], { time }, units)
  return say(
    T['race.plan.offline.saved-earlier'],
    { date: { kind: 'date', iso: day(saved), style: 'weekday' }, time },
    units,
  )
}

/** The title of the page, the heading of the sheet block when it has no summary to show. */
export function raceTitleText(units: Units): string {
  return say(T['race.plan.title'], {}, units)
}

/** The label of every link to the page. */
export function raceOpenText(units: Units): string {
  return say(T['race.plan.open'], {}, units)
}

// ---------------------------------------------------------------------------------------------
// The words of one plan
// ---------------------------------------------------------------------------------------------

export interface RaceExpectedText {
  heading: string
  /** The time as one figure: the most likely time, or the goal's own. */
  figure: string
  /** Where the figure comes from, with its range when there is one. */
  source: string
  /** Start and finish clock; null without a start time. */
  clock: string | null
  /** How the range was widened or rounded, and the wide-on-purpose line. */
  notes: string[]
}

export interface RacePartText {
  label: string
  window: string
  clock: string | null
  /** The instruction repeated in each part: heart rate and effort. */
  instruction: string
  heat: string[]
  dark: string | null
  fuel: string
  /** The last part: what the corpus holds about late climbing and descending. */
  late: string[]
}

export interface RaceFuelText {
  heading: string
  rate: string
  basis: string
  certainty: string | null
  multiCarb: string | null
  fewHours: string | null
  hot: string | null
  total: string
  carry: string | null
  aid: string | null
  lock: string | null
  fluid: string
  /** The label of the link to the Fuel lab, shown when only the floor was tolerated. */
  labLink: string
  nausea: { heading: string; lines: string[]; open: boolean }
  eah: { heading: string; lines: string[] }
}

export interface RaceWeekText {
  heading: string
  carb: string
  carbMass: string
  days: string
  evidence: string
  shake: string
  heat: string[]
  fluid: string
}

export interface RacePlanText {
  title: string
  daysToGo: string
  sketch: string
  firmHeading: string
  aboutRanges: string
  notices: RaceNoticeText[]
  expected: RaceExpectedText
  effort: { heading: string; instruction: string; study: string; readingAid: string }
  parts: RacePartText[]
  climbing: { heading: string; lines: string[] } | null
  fuel: RaceFuelText
  heatHeading: string
  heat: string[]
  raceWeek: RaceWeekText | null
  dark: { heading: string; lines: string[] } | null
  /** What the recent runs hold of the night and downhill ask; null when the plan asks for neither. */
  rehearsal: { heading: string; lines: string[] } | null
}

function noticeText(notice: RaceNotice, units: Units): RaceNoticeText {
  switch (notice) {
    case 'no-prediction':
      return {
        text: say(T['race.plan.notice.no-prediction'], {}, units),
        link: say(T['race.plan.firm.link-prediction'], {}, units),
        to: 'goals',
      }
    case 'no-start-time':
      return {
        text: say(T['race.plan.notice.no-start-time'], {}, units),
        link: say(T['race.plan.firm.link-start-time'], {}, units),
        to: 'goals',
      }
    case 'no-heart-rate':
      return {
        text: say(T['race.plan.notice.no-heart-rate'], {}, units),
        link: say(T['race.plan.firm.link-heart-rate'], {}, units),
        to: 'profile',
      }
    case 'no-climate':
      return {
        text: say(T['race.plan.notice.no-climate'], {}, units),
        link: say(T['race.plan.firm.link-climate'], {}, units),
        to: 'goals',
      }
  }
}

/** One line of "How firm is this": what is missing, and the page that fills it in. */
export interface RaceNoticeText {
  text: string
  link: string
  to: 'goals' | 'profile'
}

/** The instruction repeated in every part: the heart rate ceiling and the effort, or the effort. */
function instructionText(effort: RacePlan['effort'], units: Units): string {
  const [low, high] = effort.rpe
  if (effort.hot)
    return say(T['race.plan.effort.hot'], { low: count(low), high: count(high) }, units)
  if (effort.ceilingBpm === null) {
    return say(T['race.plan.effort.effort-only'], { low: count(low), high: count(high) }, units)
  }
  return say(
    T['race.plan.effort.ceiling'],
    { bpm: { kind: 'bpm', bpm: effort.ceilingBpm }, low: count(low), high: count(high) },
    units,
  )
}

function expectedText(plan: RacePlan, units: Units): RaceExpectedText {
  const { expected } = plan
  const notes: string[] = []
  const figure = say(T['race.plan.expected.figure'], { duration: duration(expected.midSec) }, units)
  const source =
    expected.basis === 'prediction'
      ? say(
          T[
            expected.trainingSince == null
              ? 'race.plan.expected.source-range'
              : 'race.plan.expected.source-floor'
          ],
          { low: duration(expected.lowSec), high: duration(expected.highSec) },
          units,
        )
      : say(T['race.plan.expected.source-goal'], {}, units)
  const clock =
    expected.start === null || expected.finish === null
      ? null
      : say(
          T['race.plan.expected.clock'],
          {
            start: expected.start,
            range: clockRangeText(expected.finish.from, expected.finish.to),
          },
          units,
        )
  if (expected.range.wide) {
    notes.push(
      render(
        TODAY_TEMPLATES['today.race.wide'],
        { distance: { kind: 'distance', m: plan.distanceM }, grade: expected.range.grade },
        units,
      ),
    )
  }
  if (expected.trainingSince != null) {
    notes.push(
      say(
        T['race.plan.expected.training'],
        { date: { kind: 'date', iso: expected.trainingSince, style: 'short' } },
        units,
      ),
    )
  }
  if (expected.climb !== null) {
    notes.push(
      say(
        T['race.plan.expected.climb'],
        {
          runs: count(expected.climb.runs),
          shift: signedMinutes(expected.climb.shiftSec),
        },
        units,
      ),
      say(
        T['race.plan.expected.climb-how'],
        {
          faster: percent(P.l5.personalBlendFaster.value * 100),
          slower: percent(P.l5.personalBlendSlower.value * 100),
          max: percent(P.l5.personalBlendMaxShiftPct.value),
        },
        units,
      ),
    )
  }
  notes.push(
    say(T['race.plan.expected.round'], { step: minutes(P.r1.arrivalRoundMin.value) }, units),
  )
  return { heading: say(T['race.plan.expected.heading'], {}, units), figure, source, clock, notes }
}

function heatLines(plan: RacePlan, units: Units): string[] {
  const { heat } = plan
  if (heat.wbgtC === null) return []
  const lines = [say(T['race.plan.heat.climate'], { temp: { kind: 'temp', c: heat.wbgtC } }, units)]
  if (heat.hot) {
    lines.push(say(T['race.plan.heat.prediction'], {}, units))
    if (heat.lowConfidence) {
      lines.push(
        say(
          T['race.plan.heat.confidence'],
          { hours: count(P.i6.lowConfidenceEventHours.value) },
          units,
        ),
      )
    }
    if (plan.expected.start === null) lines.push(say(T['race.plan.heat.start-time'], {}, units))
  }
  return lines
}

function partText(plan: RacePlan, third: RaceThird, units: Units): RacePartText {
  const { heat, climbing } = plan
  const late: string[] = []
  if (third.late) {
    late.push(say(T['race.plan.part.late-climb'], {}, units))
    if (climbing !== null) {
      late.push(
        say(
          T['race.plan.part.late-descent'],
          { share: share(climbing.lateDescentCostIncrease) },
          units,
        ),
      )
    }
    late.push(say(T['race.plan.part.late-expect'], {}, units))
  }
  const hotLines: string[] = []
  if (heat.hot && third.startsInDaylight === true) {
    hotLines.push(say(T['race.plan.heat.daytime'], {}, units))
    if (heat.lowConfidence) {
      hotLines.push(
        say(
          T['race.plan.heat.confidence'],
          { hours: count(P.i6.lowConfidenceEventHours.value) },
          units,
        ),
      )
    }
  }
  return {
    label: say(
      T['race.plan.part'],
      { n: count(third.index + 1), total: count(plan.thirds.length) },
      units,
    ),
    window: say(
      T['race.plan.part.window'],
      { from: duration(third.fromSec), to: duration(third.toSec) },
      units,
    ),
    clock:
      third.clock === null
        ? null
        : say(
            T['race.plan.part.clock'],
            { range: clockRangeText(third.clock.from, third.clock.to) },
            units,
          ),
    instruction: instructionText(plan.effort, units),
    heat: hotLines,
    dark:
      third.darkMin === null || third.darkMin <= 0
        ? null
        : say(T['race.plan.part.dark'], { time: minutes(third.darkMin) }, units),
    fuel: say(
      T['race.plan.part.fuel'],
      {
        low: count(roundTo(third.fuelG[0], RACE_CARB_ROUND_G)),
        high: count(roundTo(third.fuelG[1], RACE_CARB_ROUND_G)),
      },
      units,
    ),
    late,
  }
}

/** The fuel lines, shared by the page and the race-day block of the session sheet. */
export function describeRaceFuel(
  plan: Pick<RacePlan, 'fuel' | 'fluid' | 'eahStronger' | 'supportLevel'>,
  units: Units,
): RaceFuelText {
  const { fuel } = plan
  const tier = count(P.h7.carbTier1GPerH.value)
  const multi = say(FUEL_TEMPLATES['fuel.multicarb'], { tier }, units)
  return {
    heading: say(T['race.plan.fuel.heading'], {}, units),
    rate: say(T['race.plan.fuel.rate'], { rate: rateText(fuel) }, units),
    basis:
      fuel.basis === 'locked'
        ? gutConditionLock()
        : fuel.basis === 'tolerated'
          ? say(T['race.plan.fuel.tolerated'], {}, units)
          : say(T['race.plan.fuel.floor'], {}, units),
    certainty: fuel.lowCertainty ? lowCertaintyLine() : null,
    multiCarb: fuel.multiCarbRequired ? multi : null,
    fewHours: fuel.basis === 'tolerated' ? say(T['race.plan.fuel.few-hours'], {}, units) : null,
    hot: fuel.hot && fuel.basis === 'tolerated' ? say(T['race.plan.fuel.hot'], {}, units) : null,
    total: say(
      T['race.plan.fuel.total'],
      {
        low: count(roundTo(fuel.totalG[0], RACE_CARB_ROUND_G)),
        high: count(roundTo(fuel.totalG[1], RACE_CARB_ROUND_G)),
      },
      units,
    ),
    carry: plan.supportLevel === 'self' ? say(T['race.plan.fuel.carry'], {}, units) : null,
    aid: plan.supportLevel === 'aided' ? say(T['race.plan.fuel.aid'], {}, units) : null,
    lock: fuel.basis === 'locked' ? gutConditionLock() : null,
    fluid: fluidLine(),
    labLink: say(T['race.plan.fuel.link'], {}, units),
    nausea: nauseaPlan(fuel.nauseaPlanOpen),
    eah: eahText(plan.eahStronger),
  }
}

/** The race-week lines (rule K6); the K6 line itself needs no weight, the grams do. */
export function describeRaceWeek(week: RaceWeek, units: Units): RaceWeekText {
  const [fromH, toH] = week.finalHours
  const [low, high] = week.carbGPerKgDay
  const grams =
    week.carbG === null || week.weightKg === null
      ? say(T['race.plan.week.no-weight'], {}, units)
      : say(
          T['race.plan.week.carb-mass'],
          {
            kg: count(Math.round(week.weightKg)),
            low: count(roundTo(week.carbG[0], RACE_CARB_ROUND_G)),
            high: count(roundTo(week.carbG[1], RACE_CARB_ROUND_G)),
          },
          units,
        )
  const heat = week.heatTopUp
    ? [
        say(T['race.plan.week.heat'], { credit: share(week.acclimationCredit) }, units),
        say(T['race.plan.week.heat-top-up'], {}, units),
      ]
    : []
  return {
    heading: say(T['race.plan.week.heading'], {}, units),
    carb: say(
      T['race.plan.week.carb'],
      { fromH: count(fromH), toH: count(toH), low: count(low), high: count(high) },
      units,
    ),
    carbMass: grams,
    days: say(
      T['race.plan.week.days'],
      {
        from: { kind: 'date', iso: week.from, style: 'weekday' },
        to: { kind: 'date', iso: week.to, style: 'weekday' },
      },
      units,
    ),
    evidence: `${say(T['race.plan.week.evidence'], {}, units)} ${say(T['race.plan.week.engine'], {}, units)}`,
    shake: say(
      T['race.plan.week.shake'],
      {
        min: minutes(week.shakeOut.maxMin),
        date: { kind: 'date', iso: week.shakeOut.easyFrom, style: 'weekday' },
      },
      units,
    ),
    heat,
    fluid: eahText(false).lines[0] ?? '',
  }
}

/** The Rehearsal block: the night and downhill counts of the recent runs, in plain facts. */
function rehearsalText(plan: RacePlan, units: Units): RacePlanText['rehearsal'] {
  const r = plan.rehearsal
  if (r === null) return null
  const date = { kind: 'date', iso: r.from, style: 'short' } as const
  const lines: string[] = []
  if (r.runs === 0) {
    lines.push(say(T['race.plan.rehearsal.no-runs'], { date }, units))
  } else {
    const night = r.night
    if (night !== null) {
      lines.push(
        night.runs === 0
          ? say(T['race.plan.rehearsal.night-none'], { date }, units)
          : say(
              T['race.plan.rehearsal.night'],
              { n: count(night.runs), date, time: minutes(night.darkMin) },
              units,
            ),
      )
      if (night.unplaced > 0) {
        lines.push(
          night.unplaced === 1
            ? say(T['race.plan.rehearsal.unplaced-one'], {}, units)
            : say(T['race.plan.rehearsal.unplaced'], { n: count(night.unplaced) }, units),
        )
      }
      lines.push(
        say(
          night.byRunStart > 0
            ? T['race.plan.rehearsal.dark-note-runs']
            : T['race.plan.rehearsal.dark-note'],
          { deg: count(Math.abs(P.r1.darkSunAltitudeDeg.value)) },
          units,
        ),
      )
    }
    const down = r.downhill
    if (down !== null) {
      const pct = percent(Math.abs(down.bandMaxPct))
      if (down.runsWithBins === 0) {
        lines.push(say(T['race.plan.rehearsal.no-altitude-all'], { date }, units))
      } else {
        lines.push(
          down.minutes === 0
            ? say(T['race.plan.rehearsal.downhill-none'], { pct }, units)
            : say(T['race.plan.rehearsal.downhill'], { time: minutes(down.minutes), pct }, units),
        )
        lines.push(
          say(
            T['race.plan.rehearsal.long'],
            { time: minutes(P.r1.sustainedDescentMin.value), n: count(down.longRuns) },
            units,
          ),
        )
        if (down.runsWithoutBins > 0) {
          lines.push(
            down.runsWithoutBins === 1
              ? say(T['race.plan.rehearsal.no-altitude-one'], {}, units)
              : say(
                  T['race.plan.rehearsal.no-altitude'],
                  { n: count(down.runsWithoutBins) },
                  units,
                ),
          )
        }
      }
    }
  }
  return { heading: say(T['race.plan.rehearsal.heading'], {}, units), lines }
}

/** Every sentence of the Race page for one plan. */
export function describeRacePlan(plan: RacePlan, units: Units): RacePlanText {
  const dark = plan.dark
  const darkLines: string[] = []
  if (dark !== null) {
    darkLines.push(
      dark.hours === null
        ? say(T['race.plan.dark.whole'], {}, units)
        : say(
            T['race.plan.dark.hours'],
            { low: count(Math.round(dark.hours[0])), high: count(Math.round(dark.hours[1])) },
            units,
          ),
    )
    darkLines.push(say(T['race.plan.dark.clock'], { dawn: dark.dawn, dusk: dark.dusk }, units))
    darkLines.push(
      say(
        T['race.plan.dark.lamp'],
        { low: count(dark.headlampRuns[0]), high: count(dark.headlampRuns[1]) },
        units,
      ),
    )
  }
  const climbing = plan.climbing
  return {
    title: say(T['race.plan.title'], {}, units),
    daysToGo: daysToGoText(plan.daysToRace, units),
    sketch: say(T['race.plan.sketch'], {}, units),
    firmHeading: say(T['race.plan.firm.heading'], {}, units),
    aboutRanges: say(T['race.plan.firm.about'], {}, units),
    notices: plan.notices.map((notice) => noticeText(notice, units)),
    expected: expectedText(plan, units),
    effort: {
      heading: say(T['race.plan.effort.heading'], {}, units),
      instruction: instructionText(plan.effort, units),
      study: say(T['race.plan.effort.study'], { share: percent(plan.effort.belowVt1Pct) }, units),
      readingAid: say(T['race.plan.effort.reading-aid'], {}, units),
    },
    parts: plan.thirds.map((third) => partText(plan, third, units)),
    climbing:
      climbing === null
        ? null
        : {
            heading: say(T['race.plan.climb.heading'], {}, units),
            lines: [
              say(T['race.plan.climb.effort'], {}, units),
              say(
                T['race.plan.climb.hike'],
                {
                  hike: percent(climbing.hikeGradePct),
                  walk: percent(climbing.walkCheaperGradePct),
                },
                units,
              ),
              say(
                T['race.plan.climb.reference'],
                { climb: { kind: 'climb', m: climbing.referenceMPerH } },
                units,
              ),
            ],
          },
    fuel: describeRaceFuel(plan, units),
    heatHeading: say(T['race.plan.heat.heading'], {}, units),
    heat: heatLines(plan, units),
    raceWeek: plan.raceWeek === null ? null : describeRaceWeek(plan.raceWeek, units),
    dark:
      dark === null
        ? null
        : { heading: say(T['race.plan.dark.heading'], {}, units), lines: darkLines },
    rehearsal: rehearsalText(plan, units),
  }
}

// ---------------------------------------------------------------------------------------------
// The words of the checkpoint table (step 4)
// ---------------------------------------------------------------------------------------------

export interface RacePointRowText {
  /** The runner's name for the point, or the word for the finish. */
  name: string
  finish: boolean
  distance: string
  /** The arrival range, as a clock with a start time and as time into the race without one. */
  arrival: string
  segment: string
  climb: string | null
  descent: string | null
  /** Day or night, climb by effort: short labels. */
  tags: string[]
  carry: string | null
  /** The cutoff, in the clock and in elapsed time with a start time: facts, never compared. */
  cutoff: string[]
}

export interface RacePointsText {
  heading: string
  /** The line for a plan with no rows. */
  empty: string
  edit: string
  list: string
  rows: RacePointRowText[]
  /** What the table leaves out or could not use: a count, a climb over the course. */
  notices: string[]
  /** How the ranges are made, in words. */
  notes: string[]
}

/** The text of the checkpoint table for a plan: the rows, or the empty state when there are none. */
export function describeRacePoints(plan: RacePlan, units: Units): RacePointsText {
  const self = plan.supportLevel === 'self'
  const splits = plan.splits
  const heading = self ? T['race.plan.points.heading-self'] : T['race.plan.points.heading']
  const edit = self ? T['race.plan.points.edit-self'] : T['race.plan.points.edit']
  const base = {
    heading: say(heading, {}, units),
    empty: say(self ? T['race.plan.points.empty-self'] : T['race.plan.points.empty'], {}, units),
    edit: say(edit, {}, units),
    list: say(T['race.plan.points.list'], {}, units),
  }
  if (splits === null) return { ...base, rows: [], notices: [], notes: [] }

  const tolerated = plan.fuel.basis === 'tolerated'
  const notices: string[] = []
  if (splits.ignored > 0) {
    notices.push(say(T['race.plan.points.ignored'], { n: count(splits.ignored) }, units))
  }
  if (splits.climbOverCourse) notices.push(say(T['race.plan.points.climb-over'], {}, units))
  if (splits.climbUnknown) notices.push(say(T['race.plan.points.climb-unknown'], {}, units))

  const notes = [
    say(T['race.plan.points.weights'], { n: count(P.l5.gainEquivalentM.value) }, units),
    ...(splits.climb === null ||
    oneDecimal(splits.climb.usedM) === oneDecimal(P.l5.gainEquivalentM.value)
      ? []
      : [
          say(
            T['race.plan.points.weights-own'],
            {
              runs: count(splits.climb.runs),
              n: oneDecimal(splits.climb.usedM),
              standard: count(P.l5.gainEquivalentM.value),
            },
            units,
          ),
        ]),
    say(T['race.plan.points.defaults'], {}, units),
    say(T['race.plan.points.late'], {}, units),
  ]
  if (splits.rows.some((row) => row.carryG !== null)) {
    notes.push(say(T['race.plan.points.carry-note'], {}, units))
    if (tolerated) notes.push(say(T['race.plan.fuel.few-hours'], {}, units))
  }
  return {
    ...base,
    rows: splits.rows.map((row) => pointRowText(row, units)),
    notices,
    notes,
  }
}

/** The arrival range, or one time when both ends are the same (a plan with no prediction). */
function arrivalText(row: SplitRow, units: Units): string {
  if (row.clock === null) {
    return row.lowSec === row.highSec
      ? say(T['race.plan.points.arrival-elapsed-at'], { at: duration(row.lowSec) }, units)
      : say(
          T['race.plan.points.arrival-elapsed'],
          { from: duration(row.lowSec), to: duration(row.highSec) },
          units,
        )
  }
  const at = clockText(row.clock.from)
  return at === clockText(row.clock.to)
    ? say(T['race.plan.points.arrival-clock-at'], { at }, units)
    : say(
        T['race.plan.points.arrival-clock'],
        { range: clockRangeText(row.clock.from, row.clock.to) },
        units,
      )
}

/** The climb line, chosen on the figure as it will be printed: a climb that rounds to 0 says nothing. */
function climbText(row: SplitRow, units: Units): string | null {
  const m = roundTo(row.gainM, row.gainEntered ? 1 : 10)
  if (m <= 0) return null
  return say(
    row.gainEntered ? T['race.plan.points.climb-entered'] : T['race.plan.points.climb-shared'],
    { climb: { kind: 'climb', m } },
    units,
  )
}

/** The grams to carry, each end rounded; nothing when the rounded high end is 0. */
function carryText(row: SplitRow, units: Units): string | null {
  if (row.carryG === null) return null
  const low = roundTo(row.carryG[0], RACE_CARB_ROUND_G)
  const high = roundTo(row.carryG[1], RACE_CARB_ROUND_G)
  if (high <= 0) return null
  return say(T['race.plan.points.carry'], { low: count(low), high: count(high) }, units)
}

function pointRowText(row: SplitRow, units: Units): RacePointRowText {
  const tags: string[] = []
  if (row.night !== null) {
    tags.push(say(row.night ? T['race.plan.points.night'] : T['race.plan.points.day'], {}, units))
  }
  if (row.climbByEffort) tags.push(say(T['race.plan.points.climb-tag'], {}, units))
  const cutoff: string[] = []
  if (row.cutoffSec !== null) {
    if (row.cutoffClock !== null) {
      cutoff.push(
        say(T['race.plan.points.cutoff-clock'], { clock: clockText(row.cutoffClock) }, units),
      )
    }
    cutoff.push(
      say(T['race.plan.points.cutoff-elapsed'], { elapsed: duration(row.cutoffSec) }, units),
    )
  }
  return {
    name: row.name ?? say(T['race.plan.points.finish'], {}, units),
    finish: row.finish,
    distance: say(
      T['race.plan.points.at'],
      { distance: { kind: 'distance', m: row.distanceM } },
      units,
    ),
    arrival: arrivalText(row, units),
    segment: say(
      T['race.plan.points.segment'],
      { distance: { kind: 'distance', m: row.segmentM } },
      units,
    ),
    climb: climbText(row, units),
    descent:
      row.lossM === null || row.lossM <= 0
        ? null
        : say(T['race.plan.points.descent'], { climb: { kind: 'climb', m: row.lossM } }, units),
    tags,
    carry: carryText(row, units),
    cutoff,
  }
}

// ---------------------------------------------------------------------------------------------
// The words of the race card
// ---------------------------------------------------------------------------------------------

export interface RaceCardBlockText {
  /** `start`, `point-<metres>` or `finish`: stable while the point stays where it is; the crew note's key. */
  key: string
  name: string
  /** The distance from the start; null on the start block. */
  distance: string | null
  /** The label over the figure: the expected arrival, or the start time on the start block. */
  windowLabel: string | null
  /** The window is elapsed time, so its label stays on paper. */
  windowElapsed: boolean
  /** The arrival window as the figure of the block ("13:25 to 14:00"); the start time on the start block. */
  window: string | null
  /** The cutoff, in the clock and in elapsed time with a start time: facts, never compared. */
  cutoff: string[]
  /** Said only where the plan holds that the arrival falls outside daylight. */
  headlamp: string | null
  /** The leg that starts here: where it goes and how far. Null on the finish block. */
  next: string | null
  /** The climb, descent and fuel of that leg, each one figure with its source in words. */
  facts: RaceCardFact[]
  noteLabel: string
}

export interface RaceCardFact {
  key: 'climb' | 'descent' | 'fuel'
  label: string
  value: string
  note: string
}

/** The split sheet at the head of the card: one row for each stop, from the same rows as the blocks. */
export interface RaceCardSheetRow {
  key: string
  name: string
  distance: string
  arrival: string | null
  cutoff: string[]
  /** The fuel for the leg after this stop; null on the finish and where the plan lists none. */
  fuel: string | null
}

export interface RaceCardSheet {
  caption: string
  stop: string
  distance: string
  arrival: string
  cutoff: string
  fuel: string
  /** What an empty cell says: a known absence, never a bare "None". */
  noCutoff: string
  noFuel: string
  /** The window figures are elapsed time (no start time). */
  elapsed: boolean
  /** A column nobody filled in is left out. */
  showCutoff: boolean
  showFuel: boolean
  rows: RaceCardSheetRow[]
}

export interface RaceCardText {
  heading: string
  intro: string
  print: string
  /** The switch between the plan and the card. */
  viewLabel: string
  viewPlan: string
  viewCard: string
  list: string
  /** The line for a plan with no checkpoint rows; the blocks are then empty. */
  empty: string
  sheet: RaceCardSheet | null
  blocks: RaceCardBlockText[]
  notes: string[]
  noteHint: string
  noteUnsaved: string
  /** The label a printed note carries in place of the field. */
  notePrint: string
}

/**
 * What a crew note is kept under: the stop's place to the nearest 100 m and its name, so a note
 * survives a re-import of the same course and a nudge of a few metres, and is left behind (not given
 * to another stop) when the stop is renamed or moved further.
 */
function pointKey(row: SplitRow): string {
  const slug = (row.name ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `point-${String(Math.round(row.distanceM / 100))}-${slug}`
}

/** The grams of a leg, each end rounded; nothing when the rounded high end is 0. */
function cardFuelValue(leg: SplitRow, units: Units): string | null {
  if (leg.carryG === null) return null
  const low = roundTo(leg.carryG[0], RACE_CARB_ROUND_G)
  const high = roundTo(leg.carryG[1], RACE_CARB_ROUND_G)
  if (high <= 0) return null
  if (low === high) return say(T['race.plan.card.value-fuel-at'], { g: count(high) }, units)
  return say(T['race.plan.card.value-fuel'], { low: count(low), high: count(high) }, units)
}

/** The climb, descent and fuel of a leg as figures; a figure that rounds to 0 is left out. */
function cardFacts(leg: SplitRow, units: Units): RaceCardFact[] {
  const facts: RaceCardFact[] = []
  const gain = roundTo(leg.gainM, leg.gainEntered ? 1 : 10)
  if (gain > 0) {
    facts.push({
      key: 'climb',
      label: say(T['race.plan.card.fact-climb'], {}, units),
      value: say(
        leg.gainEntered ? T['race.plan.card.value-climb'] : T['race.plan.card.value-climb-about'],
        { climb: { kind: 'climb', m: gain } },
        units,
      ),
      note: say(
        leg.gainEntered ? T['race.plan.card.note-entered'] : T['race.plan.card.note-shared'],
        {},
        units,
      ),
    })
  }
  if (leg.lossM !== null && leg.lossM > 0) {
    facts.push({
      key: 'descent',
      label: say(T['race.plan.card.fact-descent'], {}, units),
      value: say(
        T['race.plan.card.value-climb'],
        { climb: { kind: 'climb', m: leg.lossM } },
        units,
      ),
      note: say(T['race.plan.card.note-descent'], {}, units),
    })
  }
  const fuel = cardFuelValue(leg, units)
  if (fuel !== null) {
    facts.push({
      key: 'fuel',
      label: say(T['race.plan.card.fact-fuel'], {}, units),
      value: fuel,
      note: say(T['race.plan.card.note-carb'], {}, units),
    })
  }
  return facts
}

/** The expected-arrival window alone, with the label that says what it is. */
function cardWindow(row: SplitRow, units: Units): { label: string; window: string } {
  if (row.clock === null) {
    const window =
      row.lowSec === row.highSec
        ? say(T['race.plan.card.window-elapsed-at'], { at: duration(row.lowSec) }, units)
        : say(
            T['race.plan.card.window-elapsed'],
            { from: duration(row.lowSec), to: duration(row.highSec) },
            units,
          )
    return { label: say(T['race.plan.card.window-label-elapsed'], {}, units), window }
  }
  return {
    label: say(T['race.plan.card.window-label'], {}, units),
    window: clockRangeText(row.clock.from, row.clock.to),
  }
}

/**
 * The race card: one block for the start, each checkpoint and the finish, from the same rows as the
 * table (`plan.splits`), so a card cannot say what the table does not. What a block says about the
 * leg ahead (the distance, the carbohydrate, the climb) is read from the next row, whose segment it
 * is. The fuel is the plan's own (`raceFuelFor`, through the rate the rows were made with), so a card
 * never states a rate above the tolerated rung, and no block states a pace or a split (ADR 0018).
 */
export function describeRaceCard(plan: RacePlan, units: Units): RaceCardText {
  const self = plan.supportLevel === 'self'
  const splits = plan.splits
  const base = {
    heading: say(T['race.plan.card.title'], {}, units),
    intro: say(T['race.plan.card.intro'], {}, units),
    print: say(T['race.plan.card.print'], {}, units),
    viewLabel: say(T['race.plan.card.view'], {}, units),
    viewPlan: say(T['race.plan.card.view-plan'], {}, units),
    viewCard: say(T['race.plan.card.title'], {}, units),
    list: say(T['race.plan.card.list'], {}, units),
    empty: say(T['race.plan.card.empty'], {}, units),
    noteHint: say(T['race.plan.card.note-hint'], {}, units),
    noteUnsaved: say(T['race.plan.card.note-unsaved'], {}, units),
    notePrint: say(T['race.plan.card.note-print'], {}, units),
  }
  if (splits === null) return { ...base, sheet: null, blocks: [], notes: [] }

  const dark = plan.dark
  const label = (name: string) => say(T['race.plan.card.note-label'], { name }, units)
  const leg = (to: SplitRow | undefined) => {
    if (to === undefined) return { next: null, facts: [] }
    const distance = { kind: 'distance', m: to.segmentM } as const
    return {
      next: to.finish
        ? say(T['race.plan.card.next-finish'], { distance }, units)
        : say(T['race.plan.card.next'], { name: to.name ?? '', distance }, units),
      facts: cardFacts(to, units),
    }
  }

  const startName = say(T['race.plan.card.start'], {}, units)
  const start = plan.expected.start
  const blocks: RaceCardBlockText[] = [
    {
      key: 'start',
      name: startName,
      distance: null,
      windowLabel: start === null ? null : say(T['race.plan.card.start-label'], {}, units),
      windowElapsed: false,
      window: start,
      cutoff: [],
      headlamp:
        plan.thirds[0]?.startsInDaylight === false && dark !== null
          ? say(T['race.plan.card.headlamp'], { dusk: dark.dusk, dawn: dark.dawn }, units)
          : null,
      ...leg(splits.rows[0]),
      noteLabel: label(startName),
    },
    ...splits.rows.map((row, index): RaceCardBlockText => {
      const point = pointRowText(row, units)
      return {
        key: row.finish ? 'finish' : pointKey(row),
        name: point.name,
        distance: point.distance,
        windowLabel: cardWindow(row, units).label,
        windowElapsed: row.clock === null,
        window: cardWindow(row, units).window,
        cutoff: point.cutoff,
        headlamp:
          row.night === true && dark !== null
            ? say(T['race.plan.card.headlamp'], { dusk: dark.dusk, dawn: dark.dawn }, units)
            : null,
        ...leg(splits.rows[index + 1]),
        noteLabel: label(point.name),
      }
    }),
  ]

  const sheetRows: RaceCardSheetRow[] = blocks.map((block, index) => {
    const row = index === 0 ? null : splits.rows[index - 1]!
    const cutoff: string[] = []
    if (row?.cutoffSec != null) {
      if (row.cutoffClock !== null) cutoff.push(clockText(row.cutoffClock))
      cutoff.push(
        say(T['race.plan.card.sheet-cutoff-elapsed'], { elapsed: duration(row.cutoffSec) }, units),
      )
    }
    return {
      key: block.key,
      name: block.name,
      distance:
        row === null
          ? say(T['race.plan.card.sheet-at-start'], {}, units)
          : say(
              T['race.plan.card.sheet-distance-at'],
              { distance: { kind: 'distance', m: row.distanceM } },
              units,
            ),
      arrival: block.window ?? say(T['race.plan.card.sheet-start'], {}, units),
      cutoff,
      fuel: block.facts.find((fact) => fact.key === 'fuel')?.value ?? null,
    }
  })
  const showCutoff = sheetRows.some((row) => row.cutoff.length > 0)
  const showFuel = sheetRows.some((row) => row.fuel !== null)
  const elapsed = splits.rows[0]?.clock === null
  const captionKey = showCutoff
    ? showFuel
      ? 'race.plan.card.sheet-caption-both'
      : 'race.plan.card.sheet-caption-cutoff'
    : showFuel
      ? 'race.plan.card.sheet-caption-fuel'
      : 'race.plan.card.sheet-caption'
  const sheet: RaceCardSheet = {
    caption: say(T[captionKey], {}, units),
    stop: say(T['race.plan.card.sheet-stop'], {}, units),
    distance: say(T['race.plan.card.sheet-distance'], {}, units),
    arrival: say(
      elapsed ? T['race.plan.card.sheet-arrival-elapsed'] : T['race.plan.card.sheet-arrival'],
      {},
      units,
    ),
    cutoff: say(T['race.plan.card.sheet-cutoff'], {}, units),
    fuel: say(T['race.plan.card.sheet-fuel'], {}, units),
    noCutoff: say(T['race.plan.card.sheet-no-cutoff'], {}, units),
    noFuel: say(T['race.plan.card.sheet-no-fuel'], {}, units),
    elapsed,
    showCutoff,
    showFuel,
    rows: sheetRows,
  }

  const notes: string[] = []
  if (self) notes.push(say(T['race.plan.card.self-note'], {}, units))
  else if (splits.rows.some((row) => row.carryG !== null)) {
    notes.push(say(T['race.plan.card.estimate-note'], {}, units))
  }
  notes.push(say(T['race.plan.points.late'], {}, units))
  return { ...base, sheet, blocks, notes }
}

/** The labels, hints and refusals of the checkpoint editor sheet. */
export interface RacePointsEditorText {
  title: string
  hint: string
  add: string
  remove: string
  save: string
  saved: string
  saveFailed: string
  name: string
  distance: string
  gain: string
  loss: string
  /** The line under the climb and descent fields: since the previous point, in the runner's unit. */
  climbHint: string
  cutoff: string
  cutoffClock: string
  cutoffDay: string
  cutoffAs: string
  asElapsed: string
  asClock: string
  errName: string
  errDistance: string
  errDuplicate: string
  errMetres: string
  errCutoff: string
  errClock: string
  pointN: (n: number) => string
  dayN: (day: number) => string
  errCount: (max: number) => string
}

/** The words of the editor sheet; `self` calls the rows course points. */
export function describeRacePointsEditor(
  args: { supportLevel: 'aided' | 'self' },
  units: Units,
): RacePointsEditorText {
  const self = args.supportLevel === 'self'
  const climbUnit = units === 'mi' ? 'ft' : 'm'
  const climbUnitPlural = units === 'mi' ? 'feet' : 'metres'
  return {
    title: say(self ? T['race.plan.points.sheet-self'] : T['race.plan.points.sheet'], {}, units),
    hint: say(T['race.plan.points.sheet-hint'], {}, units),
    add: say(self ? T['race.plan.points.add-self'] : T['race.plan.points.add'], {}, units),
    remove: say(T['race.plan.points.remove'], {}, units),
    save: say(T['race.plan.points.save'], {}, units),
    saved: say(T['race.plan.points.saved'], {}, units),
    saveFailed: say(T['race.plan.points.save-failed'], {}, units),
    name: say(T['race.plan.points.field-name'], {}, units),
    distance: say(T['race.plan.points.field-distance'], { unit: units }, units),
    gain: say(T['race.plan.points.field-gain'], { unit: climbUnit }, units),
    loss: say(T['race.plan.points.field-loss'], { unit: climbUnit }, units),
    climbHint: say(T['race.plan.points.field-climb-hint'], { unit: climbUnitPlural }, units),
    cutoff: say(T['race.plan.points.field-cutoff'], {}, units),
    cutoffClock: say(T['race.plan.points.field-cutoff-clock'], {}, units),
    cutoffDay: say(T['race.plan.points.field-cutoff-day'], {}, units),
    cutoffAs: say(T['race.plan.points.cutoff-as'], {}, units),
    asElapsed: say(T['race.plan.points.cutoff-as-elapsed'], {}, units),
    asClock: say(T['race.plan.points.cutoff-as-clock'], {}, units),
    errName: say(T['race.plan.points.err-name'], {}, units),
    errDistance: say(T['race.plan.points.err-distance'], {}, units),
    errDuplicate: say(T['race.plan.points.err-duplicate'], {}, units),
    errMetres: say(
      T['race.plan.points.err-metres'],
      { unit: climbUnitPlural, example: units === 'mi' ? '2600' : '800' },
      units,
    ),
    errCutoff: say(T['race.plan.points.err-cutoff'], {}, units),
    errClock: say(T['race.plan.points.err-clock'], {}, units),
    pointN: (n) => say(T['race.plan.points.point-n'], { n: count(n) }, units),
    dayN: (day) =>
      day <= 0
        ? say(T['race.plan.points.day-0'], {}, units)
        : say(T['race.plan.points.day-n'], { n: count(day + 1) }, units),
    errCount: (max) => say(T['race.plan.points.err-count'], { n: count(max) }, units),
  }
}

// ---------------------------------------------------------------------------------------------
// The words of the course import
// ---------------------------------------------------------------------------------------------

/** The fixed words of the import: the button, the file field, the refusals and the sheet. */
export interface RaceCourseText {
  importLabel: string
  fileLabel: string
  reading: string
  errUnreadable: string
  errLarge: (mb: number) => string
  sheetTitle: string
  replaces: string
  notes: string
  pointName: (n: number) => string
  /** A later pass of a place the course passes again: "Station (2nd pass)". */
  passName: (name: string, pass: number) => string
}

/** "2nd", "3rd", "4th", "11th", "21st". */
function ordinalText(n: number): string {
  const tens = n % 100
  const suffix =
    tens >= 11 && tens <= 13
      ? 'th'
      : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th')
  return `${String(n)}${suffix}`
}

export function describeRaceCourse(units: Units): RaceCourseText {
  return {
    importLabel: say(T['race.plan.course.import'], {}, units),
    fileLabel: say(T['race.plan.course.file-label'], {}, units),
    reading: say(T['race.plan.course.reading'], {}, units),
    errUnreadable: say(T['race.plan.course.err-unreadable'], {}, units),
    errLarge: (mb) => say(T['race.plan.course.err-large'], { n: count(mb) }, units),
    sheetTitle: say(T['race.plan.course.sheet'], {}, units),
    replaces: say(T['race.plan.course.replaces'], {}, units),
    notes: say(T['race.plan.course.notes'], {}, units),
    pointName: (n) => say(T['race.plan.course.point-name'], { n: count(n) }, units),
    passName: (name, pass) =>
      say(T['race.plan.course.pass-name'], { name, ordinal: ordinalText(pass) }, units),
  }
}

/** What the proposal was made from, for the lines above the rows. */
export interface RaceCourseProposalFacts {
  distanceM: number
  gainM: number | null
  lossM: number | null
  basis: 'waypoints' | 'spaced'
  /** The waypoints the rows were made from. */
  waypoints: number
  /** The gap between the evenly spaced rows. */
  spacingM: number
  offTrack: number
  offTrackM: number
  merged: number
  mergeM: number
  edge: number
  /** Waypoints at or past the goal distance, left out: Save would refuse them. */
  beyondGoal: number
  /** Rows over the room for them, left out, and the room. */
  capped: number
  max: number
  /** The goal's distance in metres; null when the goal holds none. */
  goalDistanceM: number | null
  /** The track differs from the goal's distance by enough to say so. */
  lengthDiffers: boolean
}

export function describeRaceCourseProposal(
  facts: RaceCourseProposalFacts,
  units: Units,
): { summary: string; source: string; notices: string[] } {
  const distance = (m: number) => ({ kind: 'distance', m }) as const
  const summary =
    facts.gainM === null || facts.lossM === null
      ? say(T['race.plan.course.summary-flat'], { distance: distance(facts.distanceM) }, units)
      : say(
          T['race.plan.course.summary'],
          {
            distance: distance(facts.distanceM),
            gain: { kind: 'climb', m: facts.gainM },
            loss: { kind: 'climb', m: facts.lossM },
          },
          units,
        )
  const source =
    facts.basis === 'waypoints'
      ? say(T['race.plan.course.from-waypoints'], { n: count(facts.waypoints) }, units)
      : say(T['race.plan.course.spaced'], { spacing: distance(facts.spacingM) }, units)
  const notices: string[] = []
  if (facts.lengthDiffers && facts.goalDistanceM !== null) {
    notices.push(
      say(
        T['race.plan.course.length-differs'],
        { track: distance(facts.distanceM), goal: distance(facts.goalDistanceM) },
        units,
      ),
    )
  }
  if (facts.offTrack > 0) {
    notices.push(
      say(
        T['race.plan.course.off-track'],
        { distance: distance(facts.offTrackM), n: count(facts.offTrack) },
        units,
      ),
    )
  }
  if (facts.merged > 0) {
    notices.push(
      say(
        T['race.plan.course.merged'],
        { distance: distance(facts.mergeM), n: count(facts.merged) },
        units,
      ),
    )
  }
  if (facts.edge > 0) notices.push(say(T['race.plan.course.edge'], { n: count(facts.edge) }, units))
  if (facts.beyondGoal > 0 && facts.goalDistanceM !== null) {
    notices.push(
      say(
        T['race.plan.course.beyond-goal'],
        { goal: distance(facts.goalDistanceM), n: count(facts.beyondGoal) },
        units,
      ),
    )
  }
  if (facts.capped > 0) {
    notices.push(
      say(T['race.plan.course.capped'], { max: count(facts.max), n: count(facts.capped) }, units),
    )
  }
  return { summary, source, notices }
}

/** The labels of the elevation profile chart and its hidden tables. */
export interface RaceCourseProfileText {
  /** The picture's name for a screen reader, with its lowest and highest points. */
  label: string
  caption: string
  tableProfile: string
  tablePoints: string
  colDistance: string
  colElevation: string
  colName: string
  /** `km` or `mi`, and `m` or `ft`: the axes' units. */
  distanceUnit: string
  elevationUnit: string
}

export function describeRaceCourseProfile(
  range: { lowM: number; highM: number },
  units: Units,
): RaceCourseProfileText {
  const distanceUnit = units === 'mi' ? 'mi' : 'km'
  const elevationUnit = units === 'mi' ? 'ft' : 'm'
  return {
    label: say(
      T['race.plan.course.profile-label'],
      { low: { kind: 'climb', m: range.lowM }, high: { kind: 'climb', m: range.highM } },
      units,
    ),
    caption: say(
      T['race.plan.course.profile-caption'],
      { unit: elevationUnit, distanceUnit },
      units,
    ),
    tableProfile: say(T['race.plan.course.table-profile'], {}, units),
    tablePoints: say(T['race.plan.course.table-points'], {}, units),
    colDistance: say(T['race.plan.course.col-distance'], { unit: distanceUnit }, units),
    colElevation: say(T['race.plan.course.col-elevation'], { unit: elevationUnit }, units),
    colName: say(T['race.plan.course.col-name'], {}, units),
    distanceUnit,
    elevationUnit,
  }
}

/** The heading of the profile section on the Race page. */
export function describeRaceProfileHeading(units: Units): string {
  return say(T['race.plan.profile.heading'], {}, units)
}

/** The words of the profile on the Race page: its name, notes, tables and the readout row. */
export interface RaceProfileText {
  heading: string
  label: string
  /** The caption lines: the base line, then one for each mark that is drawn. */
  caption: string[]
  hint: string
  readoutName: string
  tableStops: string
  tableDark: string
  tableFuel: string
  colName: string
  colDistance: string
  colHeight: string
  colFrom: string
  colTo: string
  colDark: string
  colHour: string
  colCutoff: string
  darkFirm: string
  darkPossible: string
  start: string
  finish: string
  distanceUnit: string
  heightUnit: string
}

export function describeRaceProfile(
  facts: {
    lowM: number
    highM: number
    totalM: number
    hasDark: boolean
    hasFuel: boolean
    hasCutoff: boolean
  },
  units: Units,
): RaceProfileText {
  const distanceUnit = units === 'mi' ? 'mi' : 'km'
  const heightUnit = units === 'mi' ? 'ft' : 'm'
  return {
    heading: say(T['race.plan.profile.heading'], {}, units),
    label: say(
      T['race.plan.profile.label'],
      {
        distance: { kind: 'distance', m: facts.totalM },
        low: { kind: 'climb', m: facts.lowM },
        high: { kind: 'climb', m: facts.highM },
      },
      units,
    ),
    caption: [
      say(T['race.plan.profile.caption'], { unit: heightUnit }, units),
      ...(facts.hasDark ? [say(T['race.plan.profile.caption-dark'], {}, units)] : []),
      ...(facts.hasFuel ? [say(T['race.plan.profile.caption-fuel'], {}, units)] : []),
      ...(facts.hasCutoff ? [say(T['race.plan.profile.caption-cutoff'], {}, units)] : []),
    ],
    hint: say(T['race.plan.profile.hint'], {}, units),
    readoutName: say(T['race.plan.profile.readout-name'], {}, units),
    tableStops: say(T['race.plan.profile.table-stops'], {}, units),
    tableDark: say(T['race.plan.profile.table-dark'], {}, units),
    tableFuel: say(T['race.plan.profile.table-fuel'], {}, units),
    colName: say(T['race.plan.course.col-name'], {}, units),
    colDistance: say(T['race.plan.course.col-distance'], { unit: distanceUnit }, units),
    colHeight: say(T['race.plan.course.col-elevation'], { unit: heightUnit }, units),
    colFrom: say(T['race.plan.profile.col-from'], { unit: distanceUnit }, units),
    colTo: say(T['race.plan.profile.col-to'], { unit: distanceUnit }, units),
    colDark: say(T['race.plan.profile.col-dark'], {}, units),
    colHour: say(T['race.plan.profile.col-hour'], {}, units),
    colCutoff: say(T['race.plan.profile.col-cutoff'], {}, units),
    darkFirm: say(T['race.plan.profile.dark-firm'], {}, units),
    darkPossible: say(T['race.plan.profile.dark-possible'], {}, units),
    start: say(T['race.plan.profile.start'], {}, units),
    finish: say(T['race.plan.profile.finish'], {}, units),
    distanceUnit,
    heightUnit,
  }
}

/** A course point's cutoff as a short line: the time of day, else the time into the race; null without one. */
export function describeRaceProfileCutoff(
  stop: { cutoffClock: RaceClock | null; cutoffSec: number | null },
  units: Units,
): string | null {
  if (stop.cutoffClock !== null) {
    return say(T['race.plan.profile.cutoff-clock'], { clock: clockText(stop.cutoffClock) }, units)
  }
  if (stop.cutoffSec !== null) {
    return say(T['race.plan.profile.cutoff-elapsed'], { elapsed: duration(stop.cutoffSec) }, units)
  }
  return null
}

/**
 * The readout row for a point of the profile: where it is, its net height against the start, the
 * runner's cutoff there, and the next stop. Facts only; no pace and no time.
 */
export function describeRaceProfileReadout(
  at: {
    name: string
    distanceM: number
    relM: number
    cutoff: { cutoffClock: RaceClock | null; cutoffSec: number | null } | null
    next: { name: string | null; toGoM: number } | null
  },
  units: Units,
): string {
  const climb = (m: number) => ({ kind: 'climb', m }) as const
  const rounded = Math.round(at.relM)
  const height =
    rounded === 0
      ? say(T['race.plan.profile.level'], {}, units)
      : rounded > 0
        ? say(T['race.plan.profile.above'], { climb: climb(rounded) }, units)
        : say(T['race.plan.profile.below'], { climb: climb(-rounded) }, units)
  const parts = [
    say(
      T['race.plan.profile.at'],
      { name: at.name, distance: { kind: 'distance', m: at.distanceM } },
      units,
    ),
    height,
  ]
  const cutoff = at.cutoff === null ? null : describeRaceProfileCutoff(at.cutoff, units)
  if (cutoff !== null) parts.push(cutoff)
  if (at.next !== null) {
    const distance = { kind: 'distance', m: at.next.toGoM } as const
    parts.push(
      at.next.name === null
        ? say(T['race.plan.profile.next-finish'], { distance }, units)
        : say(T['race.plan.profile.next'], { name: at.next.name, distance }, units),
    )
  }
  return parts.join(' · ')
}

// ---------------------------------------------------------------------------------------------
// The words of the Today card and the race-day block
// ---------------------------------------------------------------------------------------------

export interface RaceSummaryText {
  heading: string
  daysToGo: string
  /** The K6 line, from the final window on; null before it. */
  carb: string | null
  open: string
  /** The race-day block: the instruction, the fuel lines, the fluid line and the safety card. */
  instruction: string
  fuel: RaceFuelText
}

/** The card Today shows in race week, and the block the race-day sheet adds to the session. */
export function describeRaceSummary(summary: RacePlanSummary, units: Units): RaceSummaryText {
  const week = summary.raceWeek
  return {
    heading: say(T['race.plan.week.heading'], {}, units),
    daysToGo: daysToGoText(summary.daysToRace, units),
    carb: summary.carbLineDue && week !== null ? describeRaceWeek(week, units).carb : null,
    open: say(T['race.plan.open'], {}, units),
    instruction: instructionText(summary.effort, units),
    fuel: describeRaceFuel(
      {
        fuel: summary.fuel,
        fluid: summary.fluid,
        eahStronger: summary.eahStronger,
        supportLevel: summary.supportLevel,
      },
      units,
    ),
  }
}
