// The sentences of the method presets [rules P1 to P4, ADR 0017]: the "Plan shape" choice on the
// Generate form with its help and fit notes, what the Plan page says about the shape in effect and
// why a chosen one reads as the plan's own, and the facts of the Why drawer. A preset is a choice
// and not a better plan: no study compares the plans these methods describe, so every sentence says
// what a shape does and none says it is better. Every figure is read from the Params (the override
// of `p2.runDays` and `p4.buildWeeks`, the default value it replaces) and every grade from the
// Param that carries the value, never written here (ADR 0010). The page reads the shape in effect
// and the reason from the plan payload (`PlanWithSessions.method`), never from its own sums.
//
// Ids are `method.<name>`; the set is spread into `TEMPLATES`.
import type { PersistentHold } from '../engine/holds.ts'
import type { LoadHold, LoadPosition } from '../engine/loadSetting.ts'
import {
  appliesToClass,
  effective,
  type MethodPosition,
  type MethodReason,
} from '../engine/methods.ts'
import { allParams } from '../engine/params/index.ts'
import { PRESET_OVERRIDES } from '../engine/params/p-methods.ts'
import { PRESET_IDS, type Grade, type GoalModel, type PresetId } from '../engine/types.ts'
import type { Availability, Units } from '../types.ts'
import { loadHoldReason } from './load.ts'
import { numberWord } from './quantity.ts'
import { render, tpl, type Template } from './template.ts'

export const METHOD_TEMPLATES = {
  // The field and its three choices.
  'method.field': tpl('Plan shape', {}, { shape: 'label' }),
  'method.name.default': tpl("The plan's own shape", {}, { shape: 'label' }),
  'method.name.three-run-days': tpl('{days} a week', { days: 'text' }, { shape: 'label' }),
  'method.name.longer-base': tpl('A longer base', {}, { shape: 'label' }),

  // The help under each choice, one line, in the words of rules P1, P2 and P4.
  'method.help.default': tpl(
    'Run days follow your weekly minutes and the days you have free, and the base comes first.',
  ),
  'method.help.three-run-days': tpl(
    "At most {days} a week. The long run and the quality runs stay, and no week plans more minutes than the plan's own shape.",
    { days: 'text' },
  ),
  'method.help.longer-base': tpl(
    "Strides only in the base, for up to {weeks} more weeks, then hills and threshold runs. No week plans more minutes than the plan's own shape.",
    { weeks: 'text' },
  ),

  // Under the choices: what a shape is, and the facts the page has about fit.
  'method.grade': tpl('A choice, not a better plan (grade {grade}).', { grade: 'text' }),
  'method.not-for': tpl('Not for a marathon or longer', {}, { shape: 'label' }),
  'method.fit.more': tpl('You have {open} open; {days} leave {free} free.', {
    open: 'text',
    days: 'text',
    free: 'text',
  }),
  'method.fit.all': tpl('You have {open} open; {days} use all of them.', {
    open: 'text',
    days: 'text',
  }),
  'method.fit.fewer': tpl('You have {open} open, fewer than {days}.', {
    open: 'text',
    days: 'text',
  }),
  'method.held': tpl(
    "Held at the plan's own shape while {reason}.",
    { reason: 'text' },
    { fallback: "Held at the plan's own shape for now." },
  ),

  // The Plan page: the shape in effect, and why the one chosen does not apply.
  'method.panel.read': tpl(
    "{choice}, read as the plan's own shape: {reason}.",
    { choice: 'text', reason: 'text' },
    { fallback: "The shape chosen is read as the plan's own shape." },
  ),
  'method.panel.why': tpl('Why this shape', {}, { shape: 'label' }),
  'method.reason.not-applicable': tpl('not for this goal', {}, { shape: 'label' }),
  'method.reason.held': tpl(
    'held while {hold}',
    { hold: 'text' },
    { shape: 'label', fallback: 'held for now' },
  ),
  'method.reason.novice': tpl('the start weeks keep their novice days', {}, { shape: 'label' }),
  'method.reason.no-base': tpl('there is no base to lengthen', {}, { shape: 'label' }),

  // The Why drawer: the shape chosen, each override against the plan's own value with the grade of
  // each, and what the plan's own shape is.
  'method.fact.own': tpl("This plan has the plan's own shape; no other shape was chosen."),
  'method.fact.chosen': tpl('Plan shape chosen: {shape}.', { shape: 'text' }),
  'method.fact.read-default': tpl(
    "Plan shape chosen: {shape}, read as the plan's own shape: {reason}.",
    { shape: 'text', reason: 'text' },
    { fallback: "The plan shape chosen is read as the plan's own shape." },
  ),
  'method.fact.other': tpl('Plan shape chosen: {shape}. This rule is about another shape.', {
    shape: 'text',
  }),
  'method.fact.days': tpl(
    "Run days: at most {n} a week (grade {grade}), against {cap} in the plan's own shape (grade {capGrade}).",
    { n: 'count', grade: 'text', cap: 'count', capGrade: 'text' },
  ),
  'method.fact.build': tpl(
    "Build phase: at most {n} weeks (grade {grade}), against {weeks} in the plan's own shape (grade {weeksGrade}).",
    { n: 'count', grade: 'text', weeks: 'count', weeksGrade: 'text' },
  ),
  'method.fact.base': tpl(
    'The base takes the difference: up to {more} more weeks before the build.',
    {
      more: 'count',
    },
  ),
  'method.fact.kinds': tpl(
    'Quality runs: strides only in the base, then hills and threshold runs in the build (grade {grade}).',
    { grade: 'text' },
  ),
  'method.fact.grade': tpl(
    'A choice, not a better plan (grade {grade}): no study compares these plans.',
    {
      grade: 'text',
    },
  ),
  'method.fact.own-days': tpl("The plan's own shape caps run days at {cap} (grade {grade}).", {
    cap: 'count',
    grade: 'text',
  }),
  'method.fact.own-build': tpl(
    "The plan's own build phase is {weeks} weeks (grade {grade}), and the base comes before it.",
    { weeks: 'count', grade: 'text' },
  ),
  'method.fact.own-long': tpl(
    "The plan's own long run is about {share} of a week's running (grade {grade}).",
    { share: 'share', grade: 'text' },
  ),
  'method.fact.long-run': tpl(
    "Every plan shape keeps the long run at about {share} of a week's running; a shorter share is not offered.",
    { share: 'share' },
  ),
  // F5: the run-day cap, when the shape sets it.
  'method.fact.f5-cap': tpl('Your plan shape, {shape}, caps run days at {n} a week.', {
    shape: 'text',
    n: 'count',
  }),
} satisfies Record<string, Template>

const T = METHOD_TEMPLATES

/** Counts and words read the same in either unit system. */
const UNITS: Units = 'km'

/** The rule that explains each shape: P1 the plan's own, P2 three run days, P4 a longer base. */
const PRESET_RULES: Readonly<Record<PresetId, 'P1' | 'P2' | 'P4'>> = {
  default: 'P1',
  'three-run-days': 'P2',
  'longer-base': 'P4',
}

/** The shapes in the order the form offers them: the plan's own first. */
export const PLAN_SHAPES: readonly PresetId[] = PRESET_IDS

/** The rule id of a shape, for the Why drawer. */
export const presetRule = (preset: PresetId): 'P1' | 'P2' | 'P4' => PRESET_RULES[preset]

const capitalised = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** "three run days": a number of run days in words, from the Param that sets it. */
function runDaysPhrase(n: number): string {
  return `${numberWord(n)} run day${n === 1 ? '' : 's'}`
}

const cap = (preset: PresetId): number => effective(preset, 'f5.mastersMaxRunDays')
const buildWeeks = (preset: PresetId): number => effective(preset, 'macroDesign.buildWeeks')

/** The weeks of base a shape adds to the plan's own: its build is shorter by this many. */
const extraBaseWeeks = (preset: PresetId): number => buildWeeks('default') - buildWeeks(preset)

// ---------------------------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------------------------

const REGISTRY: ReadonlyMap<string, Grade> = new Map(allParams().map((p) => [p.id, p.grade]))

/**
 * The grade of the Param that carries a value. An id the registry does not hold reads D, the lowest
 * grade, so a gap never raises a claim; a test lists the ids this file asks for.
 */
const gradeOf = (id: string): Grade => REGISTRY.get(id) ?? 'D'

/** The grades in the order of strength, A the strongest. */
const GRADES: readonly Grade[] = ['A', 'B', 'C', 'D']

/**
 * The grade of a shape as a choice: that of its weakest override. The plan's own shape has no
 * override of its own and is a choice at grade D (rule P1). A shape never reads above its weakest
 * part, and no study shows a shape to be better than another.
 */
export function presetGrade(preset: PresetId): Grade {
  const grades = Object.values(PRESET_OVERRIDES[preset]).flatMap((override) =>
    typeof override === 'object' ? [override.grade] : [],
  )
  return grades.reduce<Grade>(
    (worst, grade) => (GRADES.indexOf(grade) > GRADES.indexOf(worst) ? grade : worst),
    'D',
  )
}

/** The grade a shape is held to as a choice; the same for every shape (rule P1 and every preset). */
const choiceGrade = (): Grade =>
  PLAN_SHAPES.reduce<Grade>((worst, preset) => {
    const grade = presetGrade(preset)
    return GRADES.indexOf(grade) > GRADES.indexOf(worst) ? grade : worst
  }, 'D')

// ---------------------------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------------------------

/** The label of the field. */
export const planShapeFieldLabel = (): string => render(T['method.field'], {}, UNITS)

/** The label of a shape: "The plan's own shape", "Three run days a week", "A longer base". */
export function planShapeLabel(preset: PresetId): string {
  switch (preset) {
    case 'default':
      return render(T['method.name.default'], {}, UNITS)
    case 'three-run-days':
      return render(
        T['method.name.three-run-days'],
        { days: capitalised(runDaysPhrase(cap('three-run-days'))) },
        UNITS,
      )
    case 'longer-base':
      return render(T['method.name.longer-base'], {}, UNITS)
  }
}

/** One line of what a shape does. The figures are the Params the plan reads. */
export function planShapeHelp(preset: PresetId): string {
  switch (preset) {
    case 'default':
      return render(T['method.help.default'], {}, UNITS)
    case 'three-run-days':
      return render(
        T['method.help.three-run-days'],
        { days: runDaysPhrase(cap('three-run-days')) },
        UNITS,
      )
    case 'longer-base':
      return render(
        T['method.help.longer-base'],
        { weeks: numberWord(extraBaseWeeks('longer-base')) },
        UNITS,
      )
  }
}

/** "A choice, not a better plan (grade D)." The one line every shape carries. */
export const planShapeGradeLine = (): string =>
  render(T['method.grade'], { grade: choiceGrade() }, UNITS)

/** Whether a shape is offered for a goal of this class; a goal with no distance reads as offered. */
export function planShapeOffered(
  preset: PresetId,
  distanceClass: GoalModel['distanceClass'] | null,
): boolean {
  return distanceClass === null || appliesToClass(preset, distanceClass)
}

/** Why a shape is shown disabled for a goal it is not for. */
export const planShapeNotFor = (): string => render(T['method.not-for'], {}, UNITS)

/** "You have 5 days open" as the page counts them, the days the runner marked available. */
export function openDaysOf(availability: Availability): number {
  return Object.values(availability).filter((day) => day.available).length
}

const daysOpen = (n: number): string => `${String(n)} ${n === 1 ? 'day' : 'days'}`

/**
 * What the days the runner has open say about three run days: a fact the page already holds, never
 * a score ("You have 5 days open; three run days leave two free."). Null for a shape that does not
 * cap the run days.
 */
export function planShapeFitNote(preset: PresetId, openDays: number): string | null {
  if (PRESET_OVERRIDES[preset]['f5.mastersMaxRunDays'] === undefined) return null
  const limit = cap(preset)
  const days = runDaysPhrase(limit)
  const open = daysOpen(openDays)
  if (openDays > limit) {
    return render(T['method.fit.more'], { open, days, free: numberWord(openDays - limit) }, UNITS)
  }
  return openDays === limit
    ? render(T['method.fit.all'], { open, days }, UNITS)
    : render(T['method.fit.fewer'], { open, days }, UNITS)
}

/** One row of the choice: the shape, its help and the notes that belong to it. */
export interface PlanShapeRow {
  value: PresetId
  label: string
  help: string
  /** What the page knows about fit; "Not for a marathon or longer" on a shape that is not offered. */
  notes: string[]
  disabled: boolean
}

/**
 * The rows of the choice for the goal chosen and the days the runner has free. A shape that is not
 * for the goal's distance stays in the list, disabled and saying so, so nobody wonders where it
 * went; the days open are read from the profile when it has loaded.
 */
export function planShapeRows(
  distanceClass: GoalModel['distanceClass'] | null,
  availability: Availability | null,
): PlanShapeRow[] {
  return PLAN_SHAPES.map((value) => {
    const offered = planShapeOffered(value, distanceClass)
    const fit =
      offered && availability !== null ? planShapeFitNote(value, openDaysOf(availability)) : null
    return {
      value,
      label: planShapeLabel(value),
      help: planShapeHelp(value),
      notes: offered ? (fit === null ? [] : [fit]) : [planShapeNotFor()],
      disabled: !offered,
    }
  })
}

/** "Held at the plan's own shape while a recent injury is on file." */
export function planShapeHeldLine(hold: PersistentHold): string {
  return render(T['method.held'], { reason: loadHoldReason(hold) }, UNITS)
}

const HELD_PREFIX = 'held:'

/** The persistent hold behind a reason, or null when the reason is another. */
function holdOfReason(reason: MethodReason): PersistentHold | null {
  return reason.startsWith(HELD_PREFIX)
    ? (reason.slice(HELD_PREFIX.length) as PersistentHold)
    : null
}

const TRANSIENT_HOLDS: ReadonlySet<LoadHold> = new Set<LoadHold>(['rest-window', 'post-race'])

/**
 * The persistent hold the server reports for the runner, from the plan payload: the reason of the
 * shape the plan was generated with, else the hold of its load setting when that is one of the
 * persistent conditions (a rest window or a past race's window holds the load and not a shape).
 * Null when none is reported, and without a plan.
 */
export function planShapeHold(
  method: MethodPosition | null,
  load: LoadPosition | null,
): PersistentHold | null {
  const fromMethod = method?.reason == null ? null : holdOfReason(method.reason)
  if (fromMethod !== null) return fromMethod
  const held = load?.held ?? null
  return held === null || TRANSIENT_HOLDS.has(held) ? null : (held as PersistentHold)
}

// ---------------------------------------------------------------------------------------------
// The Plan page
// ---------------------------------------------------------------------------------------------

/** Why a shape reads as the plan's own, as the end of "...read as the plan's own shape: ...". */
export function methodReasonText(reason: MethodReason): string {
  switch (reason) {
    case 'not-applicable':
      return render(T['method.reason.not-applicable'], {}, UNITS)
    case 'novice':
      return render(T['method.reason.novice'], {}, UNITS)
    case 'no-base':
      return render(T['method.reason.no-base'], {}, UNITS)
    case 'held:recent-injury':
    case 'held:bone-stress':
    case 'held:bsi-factors':
    case 'held:reds-hold':
    case 'held:bone-pain':
      return render(
        T['method.reason.held'],
        { hold: loadHoldReason(reason.slice(HELD_PREFIX.length) as PersistentHold) },
        UNITS,
      )
  }
}

/** The label of the Plan page's panel. */
export const planShapePanelTitle = (): string => planShapeFieldLabel()

/** The label of the panel's Why button. */
export const planShapeWhyLabel = (): string => render(T['method.panel.why'], {}, UNITS)

/** The rule ids the panel's Why opens on, for the shape the plan has and the one it asked for. */
export function planShapeWhyRules(method: MethodPosition): string[] {
  if (method.requested === 'default') return [PRESET_RULES.default]
  if (method.reason !== null) return [PRESET_RULES.default, PRESET_RULES[method.requested]]
  return [PRESET_RULES[method.requested], method.requested === 'three-run-days' ? 'F5' : 'E2']
}

/** The first line of the panel when the shape chosen does not apply: the choice leads. */
export interface PlanShapeLead {
  choice: string
  rest: string
}

/** What the Plan page says about the shape in effect. */
export interface PlanShapePanelText {
  /** The shape in effect: "The plan's own shape", "Three run days a week", "A longer base". */
  name: string
  /** One line of what it does. */
  help: string
  /** Set when the shape chosen reads as the plan's own: the choice and why, in one sentence. */
  lead: PlanShapeLead | null
  /** "A choice, not a better plan (grade D)." */
  grade: string
}

/** The text of the Plan page's panel for the shape the plan payload names. */
export function planShapePanelText(method: MethodPosition): PlanShapePanelText {
  const choice = planShapeLabel(method.requested)
  let sentence: string | null = null
  if (method.reason !== null) {
    sentence = render(
      T['method.panel.read'],
      { choice, reason: methodReasonText(method.reason) },
      UNITS,
    )
  }
  // A template that fell back to its generic sentence does not begin with the choice: nothing is bold.
  const lead =
    sentence === null
      ? null
      : sentence.startsWith(choice)
        ? { choice, rest: sentence.slice(choice.length) }
        : { choice: '', rest: sentence }
  return {
    name: planShapeLabel(method.effective),
    help: planShapeHelp(method.effective),
    lead,
    grade: planShapeGradeLine(),
  }
}

// ---------------------------------------------------------------------------------------------
// The Why drawer: the builders of `explainInputs.ts` store these as facts (a template id and its
// slots) and `renderFact` words them when they are read.
// ---------------------------------------------------------------------------------------------

/** The values a shape may override that the drawer states, by the id the Params use. */
type ValueId = 'f5.mastersMaxRunDays' | 'macroDesign.buildWeeks' | 'macroDesign.longRunShareOfWeek'

/**
 * The grade of the plan's own value of `id`: the Param that carries it, read from the registry, so
 * the drawer states the grade of the value a shape replaces beside the value.
 */
export const defaultGrade = (id: ValueId): Grade => gradeOf(id)

/** The grade of a shape's own override of `id`; D when the shape does not override it. */
export const overrideGrade = (
  preset: PresetId,
  id: 'f5.mastersMaxRunDays' | 'macroDesign.buildWeeks',
): Grade => PRESET_OVERRIDES[preset][id]?.grade ?? 'D'

/** The long run's share of the week under every shape: P3 is not offered, so none lowers it. */
export const longRunShare = (): number => effective('default', 'macroDesign.longRunShareOfWeek')

export { extraBaseWeeks }
