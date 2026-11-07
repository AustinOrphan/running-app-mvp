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
  'race.plan.offline': tpl('The race plan needs a connection. Try again when you are back online.'),
  'race.plan.days-to-go': tpl('{n} days to go', { n: 'count' }, { shape: 'label' }),
  'race.plan.days-to-go-one': tpl('1 day to go', {}, { shape: 'label' }),
  'race.plan.race-day': tpl('Race day', {}, { shape: 'label' }),
  'race.plan.open': tpl('Open the race plan', {}, { shape: 'label' }),
  'race.plan.sketch': tpl(
    'Every line is a sketch from rules and your own runs. Ranges are wide on purpose.',
  ),

  // ---- Expected time (the range comes from `today.race.estimate` and `today.race.wide`) --------
  'race.plan.expected.heading': tpl('Expected time', {}, { shape: 'label' }),
  'race.plan.expected.estimate': tpl(
    'About {duration}, from the goal. A recent race or a few long runs would give a range.',
    { duration: 'duration' },
  ),
  'race.plan.expected.clock': tpl('Start {start}. Finish about {from} to {to}.', {
    start: 'text',
    from: 'text',
    to: 'text',
  }),
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
  'race.plan.part.clock': tpl(
    '{from} to {to} on the clock',
    { from: 'text', to: 'text' },
    {
      shape: 'label',
    },
  ),
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
  'race.plan.points.arrival-clock': tpl(
    'About {from} to {to}',
    { from: 'text', to: 'text' },
    { shape: 'label' },
  ),
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
  'race.plan.points.field-gain': tpl('Climb since the previous point (m)', {}, { shape: 'label' }),
  'race.plan.points.field-loss': tpl(
    'Descent since the previous point (m)',
    {},
    { shape: 'label' },
  ),
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
  'race.plan.points.err-metres': tpl('Enter whole metres, like 800.'),
  'race.plan.points.err-cutoff': tpl('Enter hours and minutes, like 9:30.'),
  'race.plan.points.err-clock': tpl('Enter a time of day that falls after the start.'),
  'race.plan.points.err-count': tpl('There is room for {n} points.', { n: 'count' }),
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
const share = (fraction: number) => ({ kind: 'share', fraction }) as const

/** A whole number the way every figure of the plan reads. */
const roundTo = (value: number, step: number): number => Math.round(value / step) * step

/** "06:00", "06:00 the next day" or "06:00 on day 3": a clock time with the day it falls on. */
export function clockText(clock: RaceClock): string {
  if (clock.day === 0) return clock.time
  if (clock.day === 1) return `${clock.time} the next day`
  return `${clock.time} on day ${String(clock.day + 1)}`
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

/** The line the page shows when the plan cannot be read. */
export function raceOfflineText(units: Units): string {
  return say(T['race.plan.offline'], {}, units)
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
  /** The range and the most likely time, or the goal's own estimate. */
  headline: string
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
  notices: string[]
  expected: RaceExpectedText
  effort: { heading: string; instruction: string; study: string; readingAid: string }
  parts: RacePartText[]
  climbing: { heading: string; lines: string[] } | null
  fuel: RaceFuelText
  heatHeading: string
  heat: string[]
  raceWeek: RaceWeekText | null
  dark: { heading: string; lines: string[] } | null
}

function noticeText(notice: RaceNotice, units: Units): string {
  switch (notice) {
    case 'no-prediction':
      return say(T['race.plan.notice.no-prediction'], {}, units)
    case 'no-start-time':
      return say(T['race.plan.notice.no-start-time'], {}, units)
    case 'no-heart-rate':
      return say(T['race.plan.notice.no-heart-rate'], {}, units)
    case 'no-climate':
      return say(T['race.plan.notice.no-climate'], {}, units)
  }
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
  const headline =
    expected.basis === 'prediction'
      ? render(
          TODAY_TEMPLATES['today.race.estimate'],
          {
            low: duration(expected.lowSec),
            high: duration(expected.highSec),
            likely: duration(expected.midSec),
          },
          units,
        )
      : say(T['race.plan.expected.estimate'], { duration: duration(expected.midSec) }, units)
  const clock =
    expected.start === null || expected.finish === null
      ? null
      : say(
          T['race.plan.expected.clock'],
          {
            start: expected.start,
            from: clockText(expected.finish.from),
            to: clockText(expected.finish.to),
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
  notes.push(
    say(T['race.plan.expected.round'], { step: minutes(P.r1.arrivalRoundMin.value) }, units),
  )
  return { heading: say(T['race.plan.expected.heading'], {}, units), headline, clock, notes }
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
            { from: clockText(third.clock.from), to: clockText(third.clock.to) },
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
    arrival:
      row.clock === null
        ? say(
            T['race.plan.points.arrival-elapsed'],
            { from: duration(row.lowSec), to: duration(row.highSec) },
            units,
          )
        : say(
            T['race.plan.points.arrival-clock'],
            { from: clockText(row.clock.from), to: clockText(row.clock.to) },
            units,
          ),
    segment: say(
      T['race.plan.points.segment'],
      { distance: { kind: 'distance', m: row.segmentM } },
      units,
    ),
    climb:
      row.gainM <= 0
        ? null
        : say(
            row.gainEntered
              ? T['race.plan.points.climb-entered']
              : T['race.plan.points.climb-shared'],
            { climb: { kind: 'climb', m: roundTo(row.gainM, row.gainEntered ? 1 : 10) } },
            units,
          ),
    descent:
      row.lossM === null || row.lossM <= 0
        ? null
        : say(T['race.plan.points.descent'], { climb: { kind: 'climb', m: row.lossM } }, units),
    tags,
    carry:
      row.carryG === null
        ? null
        : say(
            T['race.plan.points.carry'],
            {
              low: count(roundTo(row.carryG[0], RACE_CARB_ROUND_G)),
              high: count(roundTo(row.carryG[1], RACE_CARB_ROUND_G)),
            },
            units,
          ),
    cutoff,
  }
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
    gain: say(T['race.plan.points.field-gain'], {}, units),
    loss: say(T['race.plan.points.field-loss'], {}, units),
    cutoff: say(T['race.plan.points.field-cutoff'], {}, units),
    cutoffClock: say(T['race.plan.points.field-cutoff-clock'], {}, units),
    cutoffDay: say(T['race.plan.points.field-cutoff-day'], {}, units),
    cutoffAs: say(T['race.plan.points.cutoff-as'], {}, units),
    asElapsed: say(T['race.plan.points.cutoff-as-elapsed'], {}, units),
    asClock: say(T['race.plan.points.cutoff-as-clock'], {}, units),
    errName: say(T['race.plan.points.err-name'], {}, units),
    errDistance: say(T['race.plan.points.err-distance'], {}, units),
    errDuplicate: say(T['race.plan.points.err-duplicate'], {}, units),
    errMetres: say(T['race.plan.points.err-metres'], {}, units),
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
