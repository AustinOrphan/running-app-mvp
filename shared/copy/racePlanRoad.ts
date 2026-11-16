// The words of the road race plan (rule H15, ADR 0023, ADR 0010): every sentence a template over the
// facts of `roadRacePlanFor`, so the shared G5 lint renders each one in both unit systems. The Race
// page, the Today card and the race-day block all call `describeRoadRacePlan` or
// `describeRoadRaceSummary`, so none can say something the others do not.
//
// Rules of the copy, beyond the lint:
// - A plan is a sketch. Ranges, "about", and no sentence that sets a pace, a split or a push. The
//   pace block is an average over the race; the first-half figure is where slowing was more common
//   in a population, never a limit and never a pace to run.
// - A sentence that states a finding names its population and says no more than its records do: the
//   first half rests on one study (smyth-2020), the pace direction on observational finish lists,
//   the heat shape on three elite-to-sub-elite women's races, and the half marathon has no pacing,
//   heat-time or first-half figure of its own.
// - The race heat is the climate normal, never a forecast: the engine's "forecast" warning text is
//   not used here.
// - No sentence compares the goal time with the range, or says "behind", "minimum" or "limit".
//
// Pure. The fuel, fluid and race-week sentences the ultra plan already has are reused, not
// written again; the ultra "few hours" label is not (it is false for a road race).
import { eahText, fluidLine } from '../engine/fuelCopy.ts'
import { signedMinutes } from '../engine/predict.ts'
import type { RoadRacePlan, RoadRacePlanSummary, RoadRaceNotice } from '../engine/racePlanRoad.ts'
import { P } from '../engine/params/index.ts'
import type { Units } from '../types.ts'
import {
  clockRangeText,
  daysToGoText,
  describeRaceFuel,
  describeRaceWeek,
  RACE_PLAN_TEMPLATES,
  type RaceFuelText,
  type RaceWeekText,
} from './racePlan.ts'
import { render, tpl, type SlotSpec, type SlotValues, type Template } from './template.ts'
import { raceEstimateSlots } from './today.ts'

export const RACE_PLAN_ROAD_TEMPLATES = {
  // ---- Expected time ----------------------------------------------------------------------------
  'race.plan.road.expected.round': tpl(
    'Times are rounded as the countdown on Today rounds them, and the range is the prediction’s own.',
  ),
  'race.plan.road.expected.goal': tpl('Goal time {time}, an average of {pace}.', {
    time: 'duration',
    pace: 'pace',
  }),

  // ---- Average pace -----------------------------------------------------------------------------
  'race.plan.road.pace.heading': tpl('Average pace', {}, { shape: 'label' }),
  'race.plan.road.pace.range': tpl(
    'Over the course, the range is an average of {fast} to {slow}. It is not a pace for any one kilometre.',
    { fast: 'pace', slow: 'pace' },
  ),
  'race.plan.road.pace.marathon': tpl(
    'In 1.7 million recreational marathon runners, a start or a finish run too fast both went with slower finish times.',
  ),
  'race.plan.road.pace.half': tpl(
    'That finding is of marathon runners. In one mass-participation field, the half marathon was paced more evenly than the marathon.',
  ),
  'race.plan.road.pace.ten': tpl(
    'In a city 10 km race of 16,315 runners over four editions, runners were on average slower later in the race.',
  ),

  // ---- First half (marathon only) ----------------------------------------------------------------
  'race.plan.road.first-half.heading': tpl('First half', {}, { shape: 'label' }),
  'race.plan.road.first-half.population': tpl(
    'In more than 25,000 recreational marathon runners, a first half faster than {fraction} of critical speed went more often with a second half over a quarter slower.',
    { fraction: 'share' },
  ),
  'race.plan.road.first-half.figure': tpl(
    'From your critical speed, that is a first-half average faster than about {pace}. It is where slowing was more common, not a pace to run.',
    { pace: 'pace' },
  ),
  'race.plan.road.first-half.training': tpl(
    'Your critical speed comes from training, so this figure may be slower than one from a race or a short test.',
  ),

  // ---- Heat -------------------------------------------------------------------------------------
  'race.plan.road.heat.minutes': tpl(
    'About {time} of this range is the usual weather for the date.',
    {
      time: 'minutes',
    },
  ),
  'race.plan.road.heat.above-model': tpl(
    'The usual WBGT for the date is above {temp}, past the heat model’s range, so this range is optimistic. WBGT screens heat risk; it is no safety guarantee.',
    { temp: 'temp' },
  ),
  'race.plan.road.heat.i5-population': tpl(
    'In three Japanese women’s championship marathons (elite to sub-elite, air 5 to 21 °C), warm air slowed the winners and the 25th place more, late in the race.',
  ),
  'race.plan.road.heat.i5-midpack': tpl(
    'The 50th and 100th places lost their time to a slower pace from the start, not to more slowing late.',
  ),
  'race.plan.road.heat.no-shape': tpl(
    'The range is already slower throughout for heat, and the plan sets no pacing shape for it.',
  ),
  'race.plan.road.heat.medical': tpl(
    'In one marathon, medical encounters and non-finishers rose quickly above a start WBGT of 13 °C. Several races met a mass-casualty incident above 21 °C.',
  ),
  'race.plan.road.heat.medical-note': tpl(
    'Those records count medical care in unacclimatised northern fields, not finish times.',
  ),

  // ---- Fuel and fluid ---------------------------------------------------------------------------
  'race.plan.road.fuel.short': tpl(
    'The fuel ladder counts runs of {min} or more, so it gives no race rate for a race this short.',
    { min: 'minutes' },
  ),
  'race.plan.road.fuel.short-source': tpl(
    'The studies the plan draws on name no carbohydrate rate for a race of one to two hours.',
  ),

  // ---- Race week --------------------------------------------------------------------------------
  'race.plan.road.week.half-load': tpl(
    'In trained runners, a raised glycogen store did not shorten a 20.9 km run. The abstract gives no number of runners.',
  ),

  // ---- Notices ----------------------------------------------------------------------------------
  'race.plan.road.notice.no-cs': tpl(
    'No critical speed is fitted yet, so the plan has no first-half line.',
  ),
  'race.plan.road.notice.cs-dated': tpl(
    'Your critical speed rests on efforts older than three months, so the plan has no first-half line.',
  ),
  'race.plan.road.notice.course-not-flat': tpl(
    'This course is trail or mixed, so the plan gives no average pace and no first-half line.',
  ),
  'race.plan.road.notice.heat-not-in-range': tpl(
    'The usual weather is warm, but the prediction holds no heat adjustment, so the range says nothing about heat.',
  ),

  // ---- Not in this plan -------------------------------------------------------------------------
  'race.plan.road.not-in.heading': tpl('Not in this plan', {}, { shape: 'label' }),
  'race.plan.road.not-in.split': tpl(
    'A pace for each kilometre or a split table: no study in the records gives a best shape.',
  ),
  'race.plan.road.not-in.slowing': tpl(
    'How much a runner slows late: no study in the records gives a size by finishing time.',
  ),
  'race.plan.road.not-in.rate': tpl(
    'A carbohydrate rate above what training tolerated, or any rate for a race under {min}.',
    { min: 'minutes' },
  ),
  'race.plan.road.not-in.timing': tpl(
    'When to take fuel: no study in the records gives it for a road race.',
  ),
  'race.plan.road.not-in.effort': tpl(
    'A heart rate or an effort number: no study in the records gives one for a road race.',
  ),
  'race.plan.road.not-in.warm-up': tpl(
    'A warm-up or pre-cooling: no study in the records covers them.',
  ),
  'race.plan.road.not-in.target': tpl('A finish target. The plan shows a range, never a target.'),
  'race.plan.road.not-in.hold': tpl(
    'How long the race rate has held on training runs. The fuel lab shows that.',
  ),
} satisfies Record<string, Template>

export type RacePlanRoadTemplateId = keyof typeof RACE_PLAN_ROAD_TEMPLATES

const T = RACE_PLAN_ROAD_TEMPLATES
const U = RACE_PLAN_TEMPLATES

function say<S extends SlotSpec>(
  template: Template<S>,
  slots: SlotValues<S>,
  units: Units,
): string {
  return render(template, slots, units)
}

const minutes = (min: number) => ({ kind: 'minutes', min }) as const
const pace = (secPerKm: number) => ({ kind: 'pace', secPerKm }) as const
const share = (fraction: number) => ({ kind: 'share', fraction }) as const
const SEC_PER_MIN = 60

// ---------------------------------------------------------------------------------------------
// The words of one plan
// ---------------------------------------------------------------------------------------------

export interface RoadExpectedText {
  heading: string
  /** The most likely time as one figure. */
  figure: string
  /** The range, or "from the goal" for an estimate. */
  source: string
  /** Start and finish clock; null without a start time. */
  clock: string | null
  /** The goal time and its pace, for a time goal. Plain fact beside the range. */
  goal: string | null
  /** How the range was drawn (A6, L5) and how the times are rounded. */
  notes: string[]
}

export interface RoadNoticeText {
  text: string
  /** The label and page of the link that fills the gap in; null when nothing the runner adds fills it. */
  link: string | null
  to: 'goals' | 'profile' | null
}

export interface RoadFluidText {
  heading: string
  /** The fact lines of a race the ladder gives no rate for; empty when there is a rate. */
  short: string[]
  fluid: string
  eah: { heading: string; lines: string[] }
  labLink: string
}

export interface RoadRacePlanText {
  title: string
  daysToGo: string
  sketch: string
  firmHeading: string
  aboutRanges: string
  notices: RoadNoticeText[]
  expected: RoadExpectedText
  pace: { heading: string; range: string; finding: string; notes: string[] } | null
  firstHalf: { heading: string; population: string; figure: string; notes: string[] } | null
  heatHeading: string
  heat: string[]
  /** The tolerated rate, for a race of `h7.logMinDurationMin` or more; null otherwise. */
  fuel: RaceFuelText | null
  /** The fluid line and safety card when `fuel` is null; null for a 10 km and when `fuel` is set. */
  fluid: RoadFluidText | null
  raceWeek: (RaceWeekText & { extra: string | null }) | null
  notIn: { heading: string; items: string[] }
}

function noticeText(notice: RoadRaceNotice, units: Units): RoadNoticeText {
  switch (notice) {
    case 'no-prediction':
      return {
        text: say(U['race.plan.notice.no-prediction'], {}, units),
        link: say(U['race.plan.firm.link-prediction'], {}, units),
        to: 'goals',
      }
    case 'no-start-time':
      return {
        text: say(U['race.plan.notice.no-start-time'], {}, units),
        link: say(U['race.plan.firm.link-start-time'], {}, units),
        to: 'goals',
      }
    case 'no-climate':
      return {
        text: say(U['race.plan.notice.no-climate'], {}, units),
        link: say(U['race.plan.firm.link-climate'], {}, units),
        to: 'goals',
      }
    case 'no-cs':
      return { text: say(T['race.plan.road.notice.no-cs'], {}, units), link: null, to: null }
    case 'cs-dated':
      return { text: say(T['race.plan.road.notice.cs-dated'], {}, units), link: null, to: null }
    case 'course-not-flat':
      return {
        text: say(T['race.plan.road.notice.course-not-flat'], {}, units),
        link: null,
        to: null,
      }
    case 'short-for-ladder':
      return {
        text: say(
          T['race.plan.road.fuel.short'],
          { min: minutes(P.h7.logMinDurationMin.value) },
          units,
        ),
        link: null,
        to: null,
      }
    case 'heat-not-in-range':
      return {
        text: say(T['race.plan.road.notice.heat-not-in-range'], {}, units),
        link: null,
        to: null,
      }
  }
}

function expectedText(plan: RoadRacePlan, units: Units): RoadExpectedText {
  const { expected } = plan
  const slots = raceEstimateSlots({
    lowSec: expected.lowSec,
    highSec: expected.highSec,
    predictedSec: expected.midSec,
  })
  const figure = say(U['race.plan.expected.figure'], { duration: slots.likely }, units)
  const source =
    expected.basis === 'prediction'
      ? say(
          U[
            expected.trainingSince === null || expected.trainingWidened
              ? 'race.plan.expected.source-range'
              : 'race.plan.expected.source-floor'
          ],
          { low: slots.low, high: slots.high },
          units,
        )
      : say(U['race.plan.expected.source-goal'], {}, units)
  const clock =
    expected.start === null || expected.finish === null
      ? null
      : say(
          U['race.plan.expected.clock'],
          {
            start: expected.start,
            range: clockRangeText(expected.finish.from, expected.finish.to),
          },
          units,
        )
  const notes: string[] = []
  if (expected.trainingSince !== null) {
    notes.push(
      say(
        U[
          expected.trainingWidened
            ? 'race.plan.expected.training-widened'
            : 'race.plan.expected.training'
        ],
        { date: { kind: 'date', iso: expected.trainingSince, style: 'short' } },
        units,
      ),
    )
  }
  if (expected.climb !== null) {
    notes.push(
      say(
        U['race.plan.expected.climb'],
        {
          runs: { kind: 'count', n: expected.climb.runs },
          shift: signedMinutes(expected.climb.shiftSec),
        },
        units,
      ),
      say(
        U['race.plan.expected.climb-how'],
        {
          faster: { kind: 'percent', pct: P.l5.personalBlendFaster.value * 100 },
          slower: { kind: 'percent', pct: P.l5.personalBlendSlower.value * 100 },
          max: { kind: 'percent', pct: P.l5.personalBlendMaxShiftPct.value },
        },
        units,
      ),
    )
  }
  notes.push(say(T['race.plan.road.expected.round'], {}, units))
  return {
    heading: say(U['race.plan.expected.heading'], {}, units),
    figure,
    source,
    clock,
    goal:
      plan.goal === null
        ? null
        : say(
            T['race.plan.road.expected.goal'],
            {
              time: { kind: 'duration', sec: plan.goal.timeSec },
              pace: pace(plan.goal.paceSecPerKm),
            },
            units,
          ),
    notes,
  }
}

function paceText(plan: RoadRacePlan, units: Units): RoadRacePlanText['pace'] {
  if (plan.pace === null) return null
  const notes: string[] = []
  let finding: string
  if (plan.distanceClass === '10k') {
    finding = say(T['race.plan.road.pace.ten'], {}, units)
  } else {
    finding = say(T['race.plan.road.pace.marathon'], {}, units)
    if (plan.distanceClass === 'half') notes.push(say(T['race.plan.road.pace.half'], {}, units))
  }
  return {
    heading: say(T['race.plan.road.pace.heading'], {}, units),
    range: say(
      T['race.plan.road.pace.range'],
      { fast: pace(plan.pace.fastSecPerKm), slow: pace(plan.pace.slowSecPerKm) },
      units,
    ),
    finding,
    notes,
  }
}

function firstHalfText(plan: RoadRacePlan, units: Units): RoadRacePlanText['firstHalf'] {
  const { firstHalf } = plan
  if (firstHalf === null) return null
  return {
    heading: say(T['race.plan.road.first-half.heading'], {}, units),
    population: say(
      T['race.plan.road.first-half.population'],
      { fraction: share(firstHalf.csFraction) },
      units,
    ),
    figure: say(T['race.plan.road.first-half.figure'], { pace: pace(firstHalf.secPerKm) }, units),
    notes: firstHalf.fromTraining ? [say(T['race.plan.road.first-half.training'], {}, units)] : [],
  }
}

function heatLines(plan: RoadRacePlan, units: Units): string[] {
  const { heat } = plan
  if (heat.wbgtC === null) return []
  const lines = [say(U['race.plan.heat.climate'], { temp: { kind: 'temp', c: heat.wbgtC } }, units)]
  if (heat.inRangeSec !== null) {
    const min = Math.round(heat.inRangeSec / SEC_PER_MIN)
    if (min >= 1) lines.push(say(T['race.plan.road.heat.minutes'], { time: minutes(min) }, units))
  }
  if (heat.aboveModel) {
    lines.push(
      say(
        T['race.plan.road.heat.above-model'],
        { temp: { kind: 'temp', c: P.i9.warnWbgtC.value } },
        units,
      ),
    )
  }
  if (heat.paceShapeFinding) {
    lines.push(
      say(T['race.plan.road.heat.i5-population'], {}, units),
      say(T['race.plan.road.heat.i5-midpack'], {}, units),
      say(T['race.plan.road.heat.no-shape'], {}, units),
      say(T['race.plan.road.heat.medical'], {}, units),
      say(T['race.plan.road.heat.medical-note'], {}, units),
    )
  }
  return lines
}

/** The tolerated rate with the ultra-only lines removed: its "few hours" label is false for a road race. */
function fuelText(plan: RoadRacePlan | RoadRacePlanSummary, units: Units): RaceFuelText | null {
  if (plan.fuel === null || plan.fluid === null) return null
  const text = describeRaceFuel(
    {
      fuel: plan.fuel,
      fluid: plan.fluid,
      eahStronger: plan.eahStronger,
      supportLevel: plan.supportLevel,
    },
    units,
  )
  return { ...text, fewHours: null, carry: null, aid: null }
}

/** The fluid line and the safety card, with the fact that the ladder gives no rate, for a race with no rate. */
function fluidText(plan: RoadRacePlan | RoadRacePlanSummary, units: Units): RoadFluidText | null {
  if (plan.fluid === null || plan.fuel !== null) return null
  return {
    heading: say(U['race.plan.fuel.heading'], {}, units),
    short: [
      say(T['race.plan.road.fuel.short'], { min: minutes(P.h7.logMinDurationMin.value) }, units),
      say(T['race.plan.road.fuel.short-source'], {}, units),
    ],
    fluid: fluidLine(),
    eah: eahText(plan.eahStronger),
    labLink: say(U['race.plan.fuel.link'], {}, units),
  }
}

function raceWeekText(
  plan: Pick<RoadRacePlan | RoadRacePlanSummary, 'raceWeek' | 'distanceClass'>,
  units: Units,
): RoadRacePlanText['raceWeek'] {
  if (plan.raceWeek === null) return null
  return {
    ...describeRaceWeek(plan.raceWeek, units),
    extra:
      plan.distanceClass === 'half' ? say(T['race.plan.road.week.half-load'], {}, units) : null,
  }
}

function notInItems(plan: RoadRacePlan, units: Units): string[] {
  const items = [
    say(T['race.plan.road.not-in.split'], {}, units),
    say(T['race.plan.road.not-in.slowing'], {}, units),
  ]
  if (plan.distanceClass !== '10k') {
    items.push(
      say(T['race.plan.road.not-in.rate'], { min: minutes(P.h7.logMinDurationMin.value) }, units),
      say(T['race.plan.road.not-in.timing'], {}, units),
    )
  }
  items.push(
    say(T['race.plan.road.not-in.effort'], {}, units),
    say(T['race.plan.road.not-in.warm-up'], {}, units),
    say(T['race.plan.road.not-in.target'], {}, units),
  )
  if (plan.distanceClass !== '10k') items.push(say(T['race.plan.road.not-in.hold'], {}, units))
  return items
}

/** Everything the words of one road race plan say. */
export function describeRoadRacePlan(plan: RoadRacePlan, units: Units): RoadRacePlanText {
  return {
    title: say(U['race.plan.title'], {}, units),
    daysToGo: daysToGoText(plan.daysToRace, units),
    sketch: say(U['race.plan.sketch'], {}, units),
    firmHeading: say(U['race.plan.firm.heading'], {}, units),
    aboutRanges: say(U['race.plan.firm.about'], {}, units),
    notices: plan.notices.map((notice) => noticeText(notice, units)),
    expected: expectedText(plan, units),
    pace: paceText(plan, units),
    firstHalf: firstHalfText(plan, units),
    heatHeading: say(U['race.plan.heat.heading'], {}, units),
    heat: heatLines(plan, units),
    fuel: fuelText(plan, units),
    fluid: fluidText(plan, units),
    raceWeek: raceWeekText(plan, units),
    notIn: {
      heading: say(T['race.plan.road.not-in.heading'], {}, units),
      items: notInItems(plan, units),
    },
  }
}

// ---------------------------------------------------------------------------------------------
// The words of the Today card and the race-day block
// ---------------------------------------------------------------------------------------------

export interface RoadRaceSummaryText {
  heading: string
  daysToGo: string
  /** The K6 line, from the final window on; null before it. */
  carb: string | null
  open: string
  /** The expected range as one line. */
  expected: string
  fuel: RaceFuelText | null
  fluid: RoadFluidText | null
}

/** The card Today shows in race week, and the block the race-day sheet adds to the session. */
export function describeRoadRaceSummary(
  summary: RoadRacePlanSummary,
  units: Units,
): RoadRaceSummaryText {
  const week = summary.raceWeek
  const slots = raceEstimateSlots({
    lowSec: summary.expected.lowSec,
    highSec: summary.expected.highSec,
    predictedSec: summary.expected.midSec,
  })
  return {
    heading: say(U['race.plan.week.heading'], {}, units),
    daysToGo: daysToGoText(summary.daysToRace, units),
    carb: summary.carbLineDue && week !== null ? describeRaceWeek(week, units).carb : null,
    open: say(U['race.plan.open'], {}, units),
    expected:
      summary.expected.basis === 'prediction'
        ? say(U['race.plan.expected.source-range'], { low: slots.low, high: slots.high }, units)
        : say(U['race.plan.expected.source-goal'], {}, units),
    fuel: fuelText(summary, units),
    fluid: fluidText(summary, units),
  }
}
