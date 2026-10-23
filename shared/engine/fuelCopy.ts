// Every sentence the fuel ladder says (phase 3a design, section 10.5 and 10.6; rules H7 and H8;
// ADR 0010 and 0011). The sentences are templates, so the shared G5 lint and the copy-lint test
// cover them (`FUEL_TEMPLATES` is spread into `TEMPLATES`), and every number in them reaches the
// text through a slot that the functions below fill from the registry `P`. No sentence carries a
// digit, and the only fluid figure anywhere is the H8 reference range.
//
// The tone is a sketch, not a score: a run that sat badly on the gut is a result the ladder
// learns from, never a failure, and no sentence says otherwise. A language model writes none of
// this (ADR 0005, 0011).
//
// Pure: no clock, no I/O. None of these sentences holds a distance, pace or climb, so the
// runner's unit system never changes them and they render with one fixed system.
import { formatQuantity } from '../copy/quantity.ts'
import { render, tpl, type SlotSpec, type SlotValues, type Template } from '../copy/template.ts'
import { ratePerHour } from '../domain/fuel.ts'
import type { Units } from '../types.ts'
import { P } from './params/index.ts'
import type { CountReason, FuelTarget, LadderStep, RungRate, RungState } from './types.ts'

export const FUEL_TEMPLATES = {
  // The target: heading and the sentence that says why this rate.
  'fuel.target.heading': tpl(
    'Fuel target: {rate} of carbohydrate',
    { rate: 'text' },
    { shape: 'label', fallback: 'Fuel target' },
  ),
  'fuel.basis.start': tpl(
    'Start with {rate}, the tested range for long runs. A logged run that goes well opens the next step.',
    { rate: 'text' },
  ),
  'fuel.basis.next-up': tpl(
    'The last run that counted went well at {last}, so this run tries {rate}.',
    {
      last: 'text',
      rate: 'text',
    },
  ),
  'fuel.basis.repeat': tpl(
    'The last run at {rate} sat less well, so this run tries {rate} again.',
    {
      rate: 'text',
    },
  ),
  'fuel.basis.fell-back': tpl(
    'After runs that sat less well, the target is back at {rate}, the last rate that went well.',
    { rate: 'text' },
  ),
  'fuel.basis.at-ceiling': tpl(
    '{rate} went well. It is the highest rate open on your ladder for now.',
    { rate: 'text' },
  ),
  'fuel.basis.locked': tpl('A diagnosed gut condition keeps the target at {rate}.', {
    rate: 'text',
  }),
  'fuel.basis.warm-held': tpl(
    'Warm day: the target stays at {rate}, the last rate you tolerated, instead of stepping up to {next}.',
    { rate: 'text', next: 'text' },
  ),
  'fuel.basis.warm-repeat': tpl(
    'Warm day: the target stays at {rate}, the last rate you tolerated, instead of trying {next} again.',
    { rate: 'text', next: 'text' },
  ),
  'fuel.basis.warm-steady': tpl('Warm day: the target stays at {rate}, with no step up today.', {
    rate: 'text',
  }),

  // Beside every target above the floor, and the lock.
  'fuel.certainty': tpl(
    'Low certainty: above {floorHigh} g/h the evidence is thin. This is a rehearsal, not a promise.',
    { floorHigh: 'count' },
  ),
  'fuel.multicarb': tpl(
    'Above {tier} g/h, choose products with more than one kind of carbohydrate, such as glucose and fructose.',
    { tier: 'count' },
  ),
  'fuel.lock': tpl(
    'A diagnosed gut condition keeps the ladder at the floor and removes gut training. Ask a clinician before changing how you fuel.',
  ),

  // Fluid and sodium: thirst leads (rule H8). The reference range is the only fluid figure.
  'fuel.fluid.line': tpl(
    'Drink to thirst and never force fluids. {low} to {high} mL/h is a reference range, not a target.',
    { low: 'count', high: 'count' },
  ),
  'fuel.fluid.above': tpl(
    'That is above the {low} to {high} mL/h reference range. Drink to thirst; more is not better.',
    { low: 'count', high: 'count' },
  ),
  'fuel.sodium.line': tpl(
    'Sodium is for taste and comfort. It is not a way to prevent low blood sodium.',
  ),

  // The nausea plan, shown in a closed `<details>` and opened on a warm day or after a hard run.
  'fuel.nausea.heading': tpl('If your stomach turns', {}, { shape: 'label' }),
  'fuel.nausea.pace': tpl('Slow to an easy effort, or walk for a while.'),
  'fuel.nausea.fuel': tpl('Switch to simple, familiar fuel in small amounts and sip to thirst.'),
  'fuel.nausea.care': tpl('If vomiting continues or you feel worse, stop and get help.'),

  // The watch description: at most 60 characters, no symptom words.
  'fuel.watch.rate': tpl('Fuel {rate} g/h carbs. Drink to thirst.', { rate: 'count' }),
  'fuel.watch.range': tpl('Fuel {low} to {high} g/h carbs. Drink to thirst.', {
    low: 'count',
    high: 'count',
  }),

  // The safety card about drinking too much (exercise-associated hyponatraemia, rule n-7).
  'fuel.eah.heading': tpl('Low blood sodium from drinking too much', {}, { shape: 'label' }),
  'fuel.eah.thirst': tpl('Drink to thirst. Never force fluids, and do not drink on a schedule.'),
  'fuel.eah.sodium': tpl(
    'Salt tablets and salty drinks do not prevent low blood sodium during exercise.',
  ),
  'fuel.eah.symptoms': tpl(
    'Get medical care for a worsening headache, vomiting, confusion, swollen hands or feet, or quick weight gain during a long effort.',
  ),
  'fuel.eah.stronger': tpl(
    'On events over {hours} hours, or in heat, take extra care: drink only when thirsty, and get help early if symptoms start.',
    { hours: 'count' },
  ),

  // The log form's live line.
  'fuel.log.total': tpl('You took {carbs} g of carbohydrate in {time}: {rate} g/h.', {
    carbs: 'count',
    time: 'duration',
    rate: 'count',
  }),
  'fuel.log.total-target': tpl(
    'You took {carbs} g of carbohydrate in {time}: {rate} g/h. Target was {target}.',
    { carbs: 'count', time: 'duration', rate: 'count', target: 'text' },
  ),

  // Whether a logged run counted toward the ladder, and why not.
  'fuel.counts.counted': tpl('Counted toward your ladder.'),
  'fuel.counts.skipped': tpl(
    'Not logged this time, so this run does not count toward your ladder.',
  ),
  'fuel.counts.too-short': tpl(
    'The run was shorter than {min}, so it does not count toward your ladder.',
    { min: 'minutes' },
  ),
  'fuel.counts.below-target': tpl(
    'The carbohydrate rate was under {fraction} of the {rate} target, so this run does not count.',
    { fraction: 'share', rate: 'text' },
  ),
  'fuel.counts.multi-carb': tpl(
    'Above {tier} g/h, at least {share} of the carbohydrate must come from products with more than one kind of carbohydrate. This run does not count.',
    { tier: 'count', share: 'share' },
  ),

  // What a counted run did to the ladder: the history note and the toast after saving.
  'fuel.step.step-up': tpl('Tolerated at {rate}. Next long run: {next}.', {
    rate: 'text',
    next: 'text',
  }),
  'fuel.step.tolerated-top': tpl(
    'Tolerated at {rate}. That is the highest rate open on your ladder for now.',
    { rate: 'text' },
  ),
  'fuel.step.tolerated-more': tpl(
    'Tolerated at {rate}. Tolerated runs still needed before the next step: {left}.',
    { rate: 'text', left: 'count' },
  ),
  'fuel.step.warm-tolerated': tpl('Warm day: tolerated at {rate}. The target stays at {target}.', {
    rate: 'text',
    target: 'text',
  }),
  'fuel.step.hold': tpl(
    'Scored {score} of {max} at {rate}. The target holds there for the next long run.',
    { score: 'count', max: 'count', rate: 'text' },
  ),
  'fuel.step.fall-back': tpl(
    'Scored {score} of {max} at {rate}. The target is back at {target}, the last rate that went well.',
    { score: 'count', max: 'count', rate: 'text', target: 'text' },
  ),
  'fuel.step.fall-back-same': tpl(
    'Scored {score} of {max} at {rate}. The target stays at {target}.',
    { score: 'count', max: 'count', rate: 'text', target: 'text' },
  ),

  // The state of a rung in the tier ladder.
  'fuel.state.tolerated': tpl('Tolerated', {}, { shape: 'label' }),
  'fuel.state.next-up': tpl('Next up', {}, { shape: 'label' }),
  'fuel.state.repeat': tpl('Repeat', {}, { shape: 'label' }),
  'fuel.state.later': tpl('Later', {}, { shape: 'label' }),
  'fuel.state.opt-in': tpl('Opt in to open', {}, { shape: 'label' }),
  'fuel.state.opens-after': tpl(
    'Opens after {rate} g/h goes well',
    { rate: 'count' },
    { shape: 'label' },
  ),
  'fuel.state.gut-condition': tpl('Not available with a gut condition', {}, { shape: 'label' }),

  // Gut training: what may be said, and what may not (rule H7).
  'fuel.gut.claim': tpl(
    'Gut training may improve how well you tolerate carbohydrate during a run.',
  ),
  'fuel.gut.caveat': tpl(
    'It does not promise a faster time, and it has not been shown to protect the gut lining.',
  ),
  'fuel.disclaimer': tpl(
    'Fuel targets are decision support for one runner, not medical advice. A rehearsal in training does not promise how a race will go.',
  ),

  // What the fuel API says when it refuses a request (design 10.4): the message of a 400 or a 409.
  'fuel.api.advanced-locked': tpl('This opens after a run at {rate} g/h goes well.', {
    rate: 'count',
  }),
  'fuel.api.score': tpl('Use a whole number from {min} to {max}.', {
    min: 'count',
    max: 'count',
  }),
  'fuel.api.product-unknown': tpl('Choose a product from your list.'),
  'fuel.api.item-product-only': tpl(
    'A product from your list already has its name and amounts. Leave this field out.',
  ),
  'fuel.api.item-needs-food': tpl('Give the name and the carbohydrate of this food.'),
  'fuel.api.product-not-found': tpl('That product is not on your list.'),
  'fuel.api.product-name-taken': tpl(
    'A product called {name} is already on your list. Choose another name.',
    { name: 'text' },
  ),
  'fuel.api.products-full': tpl(
    'Your list holds up to {max} products. Archive one to add another.',
    {
      max: 'count',
    },
  ),
  'fuel.api.product-archived': tpl('An archived product cannot be changed. Add it again instead.'),
  'fuel.api.not-a-run': tpl('Fuel logs are for runs, and this activity is not a run.'),
  'fuel.api.log-exists': tpl(
    'This run already has a fuel log. Remove it before marking the run as not logged.',
  ),
} satisfies Record<string, Template>

export type FuelTemplateId = keyof typeof FUEL_TEMPLATES

const T = FUEL_TEMPLATES

/** None of the fuel sentences holds a distance, pace or climb, so one fixed system serves all. */
const UNITS: Units = 'km'

function say<S extends SlotSpec>(template: Template<S>, slots: SlotValues<S>): string {
  return render(template, slots, UNITS)
}

const count = (n: number) => ({ kind: 'count', n }) as const
const minutes = (min: number) => ({ kind: 'minutes', min }) as const
const share = (fraction: number) => ({ kind: 'share', fraction }) as const
const duration = (sec: number) => ({ kind: 'duration', sec }) as const
const short = (n: number): string => formatQuantity(count(n), UNITS)

/** "60 g/h", or "30 to 50 g/h" at the floor, with every number through the shared formatter. */
export function rateText(rate: RungRate): string {
  return rate.range === null
    ? `${short(rate.gPerH)} g/h`
    : `${short(rate.range[0])} to ${short(rate.range[1])} g/h`
}

// ---------------------------------------------------------------------------------------------
// The target
// ---------------------------------------------------------------------------------------------

/** The words around one fuel target, ready to show. */
export interface FuelTargetText {
  /** "Fuel target: 60 g/h of carbohydrate". */
  heading: string
  /** Why this rate. */
  basis: string
  /** The low-certainty label, for every rate above the floor. */
  certainty: string | null
  /** The advice about products with several kinds of carbohydrate, above the first higher tier. */
  multiCarb: string | null
  fluid: string
  sodium: string
  /** The clinician line for a diagnosed gut condition. */
  lock: string | null
  /** The nausea plan; `open` when a warm day or a hard run brings it forward. */
  nausea: { heading: string; lines: string[]; open: boolean }
  watch: string
}

function basisText(target: FuelTarget): string {
  const rate = rateText(target)
  const { lastTolerated, heldBack } = target
  switch (target.basis) {
    case 'next-up':
      return lastTolerated === null
        ? say(T['fuel.basis.start'], { rate })
        : say(T['fuel.basis.next-up'], { last: rateText(lastTolerated), rate })
    case 'repeat':
      return say(T['fuel.basis.repeat'], { rate })
    case 'fell-back':
      return say(T['fuel.basis.fell-back'], { rate })
    case 'at-ceiling':
      return say(T['fuel.basis.at-ceiling'], { rate })
    case 'locked':
      return say(T['fuel.basis.locked'], { rate })
    case 'warm-held':
      return heldBack === null
        ? say(T['fuel.basis.warm-steady'], { rate })
        : say(T['fuel.basis.warm-held'], { rate, next: rateText(heldBack) })
    case 'warm-repeat':
      return heldBack === null
        ? say(T['fuel.basis.warm-steady'], { rate })
        : say(T['fuel.basis.warm-repeat'], { rate, next: rateText(heldBack) })
    case 'warm-steady':
      return say(T['fuel.basis.warm-steady'], { rate })
    case 'start':
      return say(T['fuel.basis.start'], { rate })
  }
}

/** The one-line fluid advice: thirst leads, and the reference range is the only figure. */
export function fluidLine(): string {
  const [low, high] = P.h8.fluidReferenceMlPerH.value
  return say(T['fuel.fluid.line'], { low: count(low), high: count(high) })
}

/** The nausea plan and whether it is shown open. */
export function nauseaPlan(open: boolean): { heading: string; lines: string[]; open: boolean } {
  return {
    heading: say(T['fuel.nausea.heading'], {}),
    lines: [
      say(T['fuel.nausea.pace'], {}),
      say(T['fuel.nausea.fuel'], {}),
      say(T['fuel.nausea.care'], {}),
    ],
    open,
  }
}

/**
 * The line for the watch and the calendar description: the rate and thirst-led fluid wording in
 * at most 60 characters, with no symptom words.
 */
export function fuelWatchText(rate: RungRate): string {
  return rate.range === null
    ? say(T['fuel.watch.rate'], { rate: count(rate.gPerH) })
    : say(T['fuel.watch.range'], { low: count(rate.range[0]), high: count(rate.range[1]) })
}

/** Everything the words of one fuel target say. */
export function describeFuelTarget(target: FuelTarget): FuelTargetText {
  return {
    heading: say(T['fuel.target.heading'], { rate: rateText(target) }),
    basis: basisText(target),
    certainty: target.lowCertainty
      ? say(T['fuel.certainty'], { floorHigh: count(P.h7.carbFloorGPerH.value[1]) })
      : null,
    multiCarb: target.multiCarbRequired
      ? say(T['fuel.multicarb'], { tier: count(P.h7.carbTier1GPerH.value) })
      : null,
    fluid: fluidLine(),
    sodium: say(T['fuel.sodium.line'], {}),
    lock: target.locked ? say(T['fuel.lock'], {}) : null,
    nausea: nauseaPlan(target.nauseaPlanForward),
    watch: fuelWatchText(target),
  }
}

// ---------------------------------------------------------------------------------------------
// Safety card, general sentences
// ---------------------------------------------------------------------------------------------

/**
 * The card about drinking too much: thirst, sodium that does not prevent it, and the symptoms that
 * mean medical care. The stronger variant adds a line for events over `n7.eahStrongerAlertHours`
 * and for heat.
 */
export function eahText(stronger: boolean): { heading: string; lines: string[] } {
  const lines = [
    say(T['fuel.eah.thirst'], {}),
    say(T['fuel.eah.sodium'], {}),
    say(T['fuel.eah.symptoms'], {}),
  ]
  if (stronger) {
    lines.push(say(T['fuel.eah.stronger'], { hours: count(P.n7.eahStrongerAlertHours.value) }))
  }
  return { heading: say(T['fuel.eah.heading'], {}), lines }
}

/** The reference-range note for a logged fluid amount above the range; null at or below it. */
export function fluidReferenceNote(fluidMl: number, elapsedSec: number): string | null {
  const perHour = ratePerHour(fluidMl, elapsedSec)
  const [low, high] = P.h8.fluidReferenceMlPerH.value
  if (perHour === null || perHour <= high) return null
  return say(T['fuel.fluid.above'], { low: count(low), high: count(high) })
}

/** The gut-training claim and its two limits, in the only words the app uses for it. */
export function gutTrainingText(): string[] {
  return [say(T['fuel.gut.claim'], {}), say(T['fuel.gut.caveat'], {})]
}

export function fuelDisclaimer(): string {
  return say(T['fuel.disclaimer'], {})
}

/** The log form's live line; null when the run has no elapsed time. */
export function loggedTotalText(input: {
  carbsG: number
  elapsedSec: number
  target: RungRate | null
}): string | null {
  const rate = ratePerHour(input.carbsG, input.elapsedSec)
  if (rate === null) return null
  const slots = {
    carbs: count(Math.round(input.carbsG)),
    time: duration(input.elapsedSec),
    rate: count(Math.round(rate)),
  }
  return input.target === null
    ? say(T['fuel.log.total'], slots)
    : say(T['fuel.log.total-target'], { ...slots, target: rateText(input.target) })
}

/** The label of a rung's state in the tier ladder. */
export function rungStateLabel(state: RungState): string {
  switch (state) {
    case 'tolerated':
      return say(T['fuel.state.tolerated'], {})
    case 'next-up':
      return say(T['fuel.state.next-up'], {})
    case 'repeat':
      return say(T['fuel.state.repeat'], {})
    case 'later':
      return say(T['fuel.state.later'], {})
    case 'opt-in':
      return say(T['fuel.state.opt-in'], {})
    case 'opens-after-second-tier':
      return say(T['fuel.state.opens-after'], { rate: count(P.h7.carbTier2GPerH.value) })
    case 'gut-condition':
      return say(T['fuel.state.gut-condition'], {})
  }
}

// ---------------------------------------------------------------------------------------------
// A logged run
// ---------------------------------------------------------------------------------------------

function reasonText(reason: CountReason, step: LadderStep): string {
  switch (reason) {
    case 'counted':
      return say(T['fuel.counts.counted'], {})
    case 'skipped':
      return say(T['fuel.counts.skipped'], {})
    case 'too-short':
      return say(T['fuel.counts.too-short'], { min: minutes(step.requiredMin) })
    case 'below-target':
      return say(T['fuel.counts.below-target'], {
        fraction: share(P.h7.rungReachFraction.value),
        rate: rateText(step.rung),
      })
    case 'too-little-multi-carb':
      return say(T['fuel.counts.multi-carb'], {
        tier: count(P.h7.carbTier1GPerH.value),
        share: share(P.h7.multiCarbMinShare.value),
      })
  }
}

/** "Counted toward your ladder." or the reason the run did not count. */
export function countsLine(step: LadderStep): string {
  return reasonText(step.reason, step)
}

/**
 * What a logged run did to the ladder, in one sentence: the history note of its row and the toast
 * after saving ("Tolerated at 60 g/h. Next long run: 70 g/h."). A run that did not count says why.
 */
export function stepNote(step: LadderStep): string {
  const rate = rateText(step.rung)
  const target = rateText(step.next)
  const score = count(step.score)
  const max = count(P.h7.gutSymptomScaleMax.value)
  switch (step.outcome) {
    case 'not-counted':
      return countsLine(step)
    case 'step-up':
      return say(T['fuel.step.step-up'], { rate, next: target })
    case 'tolerated-top':
      return say(T['fuel.step.tolerated-top'], { rate })
    case 'tolerated-more':
      return say(T['fuel.step.tolerated-more'], { rate, left: count(step.toleratedLeft ?? 0) })
    case 'warm-tolerated':
      return say(T['fuel.step.warm-tolerated'], { rate, target })
    case 'hold':
      return say(T['fuel.step.hold'], { score, max, rate })
    case 'fall-back':
      return step.nextIndex === step.rungIndex
        ? say(T['fuel.step.fall-back-same'], { score, max, rate, target })
        : say(T['fuel.step.fall-back'], { score, max, rate, target })
  }
}

// ---------------------------------------------------------------------------------------------
// What the fuel API says when it refuses a request
// ---------------------------------------------------------------------------------------------

/** The advanced tier opens after a run at the second tier went well (400 on `optInAdvanced`). */
export function advancedLockedMessage(): string {
  return say(T['fuel.api.advanced-locked'], { rate: count(P.h7.carbTier2GPerH.value) })
}

/** A gut or nausea score outside the scale. */
export function scoreMessage(): string {
  return say(T['fuel.api.score'], { min: count(0), max: count(P.h7.gutSymptomScaleMax.value) })
}

/** A log item names a product that is not on the runner's list. */
export function productUnknownMessage(): string {
  return say(T['fuel.api.product-unknown'], {})
}

/** A log item names a product and also gives amounts of its own. */
export function itemProductOnlyMessage(): string {
  return say(T['fuel.api.item-product-only'], {})
}

/** A log item for "something else" lacks its name or carbohydrate. */
export function itemNeedsFoodMessage(): string {
  return say(T['fuel.api.item-needs-food'], {})
}

export function productNotFoundMessage(): string {
  return say(T['fuel.api.product-not-found'], {})
}

export function productNameTakenMessage(name: string): string {
  return say(T['fuel.api.product-name-taken'], { name })
}

export function productsFullMessage(max: number): string {
  return say(T['fuel.api.products-full'], { max: count(max) })
}

export function productArchivedMessage(): string {
  return say(T['fuel.api.product-archived'], {})
}

export function notARunMessage(): string {
  return say(T['fuel.api.not-a-run'], {})
}

export function logExistsMessage(): string {
  return say(T['fuel.api.log-exists'], {})
}
