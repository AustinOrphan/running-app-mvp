// The strength engine (phase 3b, E14-4; ADR 0014; rules F7 to F9): the template of a session, the
// lift of each slot, the load of each lift, the one derived workout and the history behind it.
// The prescription is derived on every read and never stored (ADR 0014): equipment, the exercises
// left out and the logged sets all change without a re-plan, so a stored copy would be stale.
//
// Pure and deterministic: no clock, no I/O, no randomness. `today`, the viewed day's readiness and
// every row of history arrive in the `StrengthContext`; lists are sorted as copies, so the order of
// the rows never matters and the frozen snapshot is never touched. Every number comes from the
// registry `P` (`f7`, `f8`, `f9` and the `flib`, `f5`, `j5` and `pain` Params they lean on); the
// two counts the rules text fixes in prose, the movements of the trunk finisher, are the shape of
// the code and not a number in it. A source scan in `strength.test.ts` holds both to that.
//
// The words are not here. Every reason is a template id of `shared/copy/strengthTemplates.ts` with
// its slots (ADR 0010), as `explainInputs` does; the surfaces render them in the runner's units.
import { countPhrase } from '../copy/quantity.ts'
import { STRENGTH_TEMPLATES, type StrengthTemplateId } from '../copy/strengthTemplates.ts'
import { addDays, daysBetween, mondayOf } from '../dates.ts'
import {
  FLOOR_EXERCISE,
  PLYO_LADDER,
  exerciseById,
  isExerciseId,
  ladderFor,
  loadMeaning,
  usableImplements,
  type ExerciseId,
  type LadderSlot,
} from '../domain/strengthLibrary.ts'
import { fromGrams, lightestLoad, roundDownToStep, stepFrom, stepsFor } from '../domain/weight.ts'
import type {
  EquipmentConfig,
  EquipmentKind,
  LoadSteps,
  PlyoDose,
  Slot,
  StrengthTemplate,
  StrengthWorkout,
  SuggestionBasis,
  WeightUnit,
  WorkoutLift,
} from '../types.ts'
import { strengthBlockPosition } from './macro.ts'
import { P } from './params/index.ts'
import type {
  LoggedSet,
  Quantity,
  StrengthAnchor,
  StrengthContext,
  StrengthLogEntry,
  StrengthMode,
  StrengthReadiness,
  StrengthSessionRef,
  StrengthWeek,
} from './types.ts'

// ---------------------------------------------------------------------------------------------
// The week, the block and the template (rules F7, E5)
// ---------------------------------------------------------------------------------------------

/** Where a week stands in its strength block: week k of n, and the length of the ramp-in. */
export interface BlockPosition {
  week: number
  of: number
  /** Zero when a regenerate skipped the ramp-in (`f7.blockCreditWeeks`). */
  rampInWeeks: number
}

/** The flags of the start paths (E6, G-3): weeks of reduced running that lift as a return. */
const RETURN_FLAG = /^(?:injury-return|injury-level-\d+|restart-floor|run-walk|ladder-\d+)$/

const isRecoveryWeek = (week: Pick<StrengthWeek, 'flags' | 'isRecovery'>): boolean =>
  week.isRecovery || week.flags.includes('recovery')

const isReturnWeek = (week: Pick<StrengthWeek, 'flags'>): boolean =>
  week.flags.some((flag) => RETURN_FLAG.test(flag)) || week.flags.includes('post-race')

/**
 * Whether a regenerate may skip the ramp-in of the block that starts on `blockStart` (design 8.3):
 * a block session (`heavy` or `ramp-in` in the snapshot) was logged in each of the
 * `f7.blockCreditWeeks` weeks before it, so the loads continue from the logs (G6 is met by that).
 */
function hasBlockCredit(ctx: StrengthContext, blockStart: string): boolean {
  const needed = P.f7.blockCreditWeeks.value
  const logged = new Set(
    ctx.logs
      .filter((log) => log.template === 'heavy' || log.template === 'ramp-in')
      .map((log) => mondayOf(log.date)),
  )
  for (let back = 1; back <= needed; back += 1) {
    if (!logged.has(addDays(blockStart, -7 * back))) return false
  }
  return needed > 0
}

/**
 * The weeks of the ramp-in (design 8.2): `flib.heavyRampInWeeks` by default, the short end of its
 * range for a runner who is experienced and lifting now, the long end for a new lifter or a runner
 * of `f5.mastersMinAge` or older (the longer wins: G6), and the default until the setup is saved.
 * With `blockStart`, the Monday the block began, a regenerate that follows logged block weeks
 * skips it (zero).
 */
export function rampInWeeks(ctx: StrengthContext, blockStart: string | null = null): number {
  const param = P.flib.heavyRampInWeeks
  if (blockStart !== null && hasBlockCredit(ctx, blockStart)) return 0
  if (!ctx.setup.saved) return param.value
  const [shortest, longest] = param.range ?? [param.value, param.value]
  const { age } = ctx.athlete
  const masters = age !== null && age >= P.f5.mastersMinAge.value
  if (ctx.setup.level === 'new' || masters) return longest
  if (ctx.setup.level === 'experienced' && ctx.setup.currentlyLifting) return shortest
  return param.value
}

/**
 * Week k of n of the strength block the week belongs to, with the ramp-in length; null outside a
 * block. The run of flagged weeks is counted by `strengthBlockPosition` over the stored plan, the
 * one block counter (design 8.3), so no column holds it.
 */
export function blockPosition(ctx: StrengthContext, weekStart: string): BlockPosition | null {
  const at = strengthBlockPosition(ctx.weeks, weekStart)
  if (at === null) return null
  const blockStart = addDays(weekStart, -7 * (at.week - 1))
  return { ...at, rampInWeeks: rampInWeeks(ctx, blockStart) }
}

/**
 * The template of a week (design 8.1), a pure function of its flags, its phase and its place in
 * the block. The first that applies wins, the more conservative first (G6):
 *
 * 1. `return`: an injury-return, ladder, run-walk or restart-floor week, or a post-race week.
 * 2. In the block: `lighter-week` in a running recovery week, `ramp-in` in the first weeks,
 *    `heavy` after them.
 * 3. Outside it: `taper` in a taper or race week, `maintenance` otherwise.
 */
export function strengthTemplate(
  week: Pick<StrengthWeek, 'flags' | 'phase' | 'isRecovery'>,
  position: BlockPosition | null,
): StrengthTemplate {
  if (isReturnWeek(week)) return 'return'
  if (position !== null) {
    if (isRecoveryWeek(week)) return 'lighter-week'
    return position.week <= position.rampInWeeks ? 'ramp-in' : 'heavy'
  }
  const tapering =
    week.flags.includes('taper') ||
    week.flags.includes('race-week') ||
    week.phase === 'taper' ||
    week.phase === 'race'
  return tapering ? 'taper' : 'maintenance'
}

/**
 * Session A or B (design 8.1). With two or more sessions in the week they alternate in the order
 * of the week; with one, the weeks alternate. A leads with the knee lift and B with the hip lift.
 */
export function sessionVariant(
  ctx: StrengthContext,
  session: Pick<StrengthSessionRef, 'id' | 'date' | 'order'>,
): 'A' | 'B' {
  const weekStart = mondayOf(session.date)
  const mates = ctx.sessions.filter(
    (other) => other.id !== session.id && mondayOf(other.date) === weekStart,
  )
  const week = [...mates, session].sort(
    (a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id.localeCompare(b.id),
  )
  if (week.length > 1) {
    return week.findIndex((other) => other.id === session.id) & 1 ? 'B' : 'A'
  }
  return ctx.weeks.filter((w) => w.weekStart < weekStart).length & 1 ? 'B' : 'A'
}

// ---------------------------------------------------------------------------------------------
// The lift of each slot (rule F7, design 7.2)
// ---------------------------------------------------------------------------------------------

/** One way to do an exercise with the saved equipment. */
export interface LiftWay {
  /** The implement the load is for; null for the bodyweight form. */
  implement: EquipmentKind | null
  /** The loads the implement can make; null for bodyweight, a band, or an item that makes none. */
  steps: LoadSteps | null
}

/** The lift chosen for a slot, with the way it is done. */
export interface LiftChoice extends LiftWay {
  exerciseId: ExerciseId
  /** True when every feasible exercise of the slot was left out and the floor one stands in. */
  floor: boolean
}

const BODYWEIGHT: LiftWay = { implement: null, steps: null }

/** The saved equipment, or none until the setup is saved: the workout is then bodyweight only. */
const equipmentOf = (ctx: StrengthContext): readonly EquipmentConfig[] =>
  ctx.setup.saved ? ctx.setup.equipment : []

/** The exercises the runner left out; nothing is left out until the setup is saved. */
const avoidedBy = (ctx: StrengthContext): ReadonlySet<string> =>
  new Set(ctx.setup.saved ? ctx.setup.avoid : [])

/** The barbell is allowed in every template but the ramp-in and the return (design 7.2). */
export const barbellAllowed = (template: StrengthTemplate): boolean =>
  template !== 'ramp-in' && template !== 'return'

/**
 * The ways an exercise can be done with the saved equipment, best first. An implement that carries
 * a load but makes none (an empty list of dumbbells) is no way to do it; the bodyweight form comes
 * last, for the exercises that have one. Empty when the exercise cannot be done.
 */
export function waysFor(ctx: StrengthContext, id: ExerciseId, barbell = true): LiftWay[] {
  const equipment = equipmentOf(ctx)
  const ways: LiftWay[] = []
  for (const implement of usableImplements(id, equipment, { barbell })) {
    if (implement === null) {
      ways.push(BODYWEIGHT)
      continue
    }
    const steps = stepsFor(equipment, implement, ctx.weightUnit)
    if (steps === null && loadMeaning(id, implement) !== 'none') continue
    ways.push({ implement, steps })
  }
  return ways
}

/** The exercise the runner always uses in a slot, when it is in the catalogue and in that slot. */
function pinnedFor(ctx: StrengthContext, slot: LadderSlot): ExerciseId | null {
  if (!ctx.setup.saved) return null
  const id = ctx.setup.pinned[slot]
  if (id === undefined || !isExerciseId(id)) return null
  return exerciseById(id)?.slot === slot ? id : null
}

export interface PickOptions {
  /** False in the ramp-in and the return templates (default true). */
  barbell?: boolean
  /** The calf slot takes the first feasible entry on A and the second on B (default A). */
  variant?: 'A' | 'B'
}

/**
 * The lift of a slot (design 7.2): the pinned exercise when it is feasible, else the first entry of
 * the slot's ladder that is feasible and not left out. Feasible is the equipment test of the
 * catalogue plus a way to make its load. Bodyweight is always possible, so a slot always has an
 * answer: when everything feasible was left out, the floor exercise stands in (`floor`). Both
 * weekly sessions use the same knee and hip lift; the calf slot takes the second feasible entry on
 * session B, and the first again when only one is feasible.
 */
export function pickLift(
  slot: LadderSlot,
  ctx: StrengthContext,
  options: PickOptions = {},
): LiftChoice {
  const barbell = options.barbell ?? true
  const avoided = avoidedBy(ctx)
  const choose = (exerciseId: ExerciseId, floor: boolean): LiftChoice => ({
    exerciseId,
    floor,
    ...(waysFor(ctx, exerciseId, barbell)[0] ?? BODYWEIGHT),
  })
  const pin = pinnedFor(ctx, slot)
  if (pin !== null && !avoided.has(pin) && waysFor(ctx, pin, barbell).length > 0) {
    return choose(pin, false)
  }
  const candidates = ladderFor(slot).filter(
    (id) => !avoided.has(id) && waysFor(ctx, id, barbell).length > 0,
  )
  const pick =
    slot === 'calf' && options.variant === 'B' ? (candidates[1] ?? candidates[0]) : candidates[0]
  return pick === undefined ? choose(FLOOR_EXERCISE[slot], true) : choose(pick, false)
}

// ---------------------------------------------------------------------------------------------
// The estimated maximum (rule F8, design 6.3)
// ---------------------------------------------------------------------------------------------

/**
 * The estimated maximum of one set, in whole grams: `load x (1 + (reps + reps left) / divisor)`
 * with `f8.e1rmDivisor` (design 6.3, gap S11). A label and never a test: it is used for a first
 * load, for the ceiling no suggestion passes and for a figure beside a load, and the app never asks
 * for a maximal attempt. A set with no count of reps left is read as 0 left, the lowest estimate
 * (G6). Null for a set that gives none: no load, or fewer than one rep.
 *
 * The corpus advises a linear equation only up to 10 repetitions to the limit
 * (`reynolds-2006-1rm-prediction`, rule F8), which the label covers. No cutoff is applied here
 * because the registry holds no Param for one, and a number of the rules is a Param or it is not
 * used (E14-4 report: the cutoff needs `f8.e1rmMaxReps` through the research update).
 */
export function estimateOneRm(loadG: number, reps: number, rir: number | null): number | null {
  if (!Number.isFinite(loadG) || loadG <= 0) return null
  if (!Number.isInteger(reps) || reps < 1) return null
  const spare = rir !== null && Number.isFinite(rir) ? Math.max(rir, 0) : 0
  return Math.round(loadG * (1 + (reps + spare) / P.f8.e1rmDivisor.value))
}

/** The estimate an anchor gives: a known maximum stands as it is, a recent set is estimated. */
export function anchorEstimate(anchor: StrengthAnchor): number | null {
  if (anchor.kind === 'max') {
    return Number.isFinite(anchor.loadG) && anchor.loadG > 0 ? Math.round(anchor.loadG) : null
  }
  return estimateOneRm(anchor.loadG, anchor.reps, anchor.rir)
}

/** A load as a whole percent of the estimated maximum, for "about 83% of the estimated maximum". */
export function percentOfMax(loadG: number, estimateG: number): number | null {
  if (!(loadG > 0) || !(estimateG > 0)) return null
  return Math.round((loadG / estimateG) * 100)
}

/** The anchor of an exercise: the most recent when there are several, which the store prevents. */
function anchorOf(ctx: StrengthContext, exerciseId: string): StrengthAnchor | null {
  const own = ctx.anchors.filter((anchor) => anchor.exerciseId === exerciseId)
  const newest = [...own].sort((a, b) => b.asOf.localeCompare(a.asOf))[0]
  return newest ?? null
}

// ---------------------------------------------------------------------------------------------
// The logged history of one exercise
// ---------------------------------------------------------------------------------------------

/** One logged session of one exercise, read for the rules. */
interface LoggedSession {
  logId: string
  date: string
  mode: StrengthMode
  /** The sets of the exercise, in the order they were done. */
  sets: LoggedSet[]
  /** The load used in most sets, the lower on a tie; null for a movement with no added load. */
  base: number | null
  /** The working load the snapshot recorded; undefined when the log has no snapshot of the lift. */
  shownBase: number | null | undefined
  /** The estimated maximum of the best set; null when no set gives one. */
  estimate: number | null
}

const bySetOrder = (a: LoggedSet, b: LoggedSet): number =>
  a.position - b.position ||
  (a.loadG ?? 0) - (b.loadG ?? 0) ||
  a.count - b.count ||
  (a.rir ?? -1) - (b.rir ?? -1)

/** The load used in most of the sets, the lower on a tie; null when that is no load at all. */
function workingLoad(sets: readonly LoggedSet[]): number | null {
  const tally = new Map<number, number>()
  for (const set of sets) tally.set(set.loadG ?? 0, (tally.get(set.loadG ?? 0) ?? 0) + 1)
  let best = 0
  let most = 0
  for (const [load, n] of [...tally].sort((a, b) => a[0] - b[0])) {
    if (n > most) {
      best = load
      most = n
    }
  }
  return best > 0 ? best : null
}

function bestEstimate(sets: readonly LoggedSet[]): number | null {
  let best: number | null = null
  for (const set of sets) {
    if (set.loadG === null) continue
    const estimate = estimateOneRm(set.loadG, set.count, set.rir)
    if (estimate !== null && (best === null || estimate > best)) best = estimate
  }
  return best
}

/**
 * The sessions of an exercise, oldest first. With an `implement`, a session whose snapshot shows
 * another implement is left out: a load on a calf machine is not a load on a dumbbell, so a change
 * of equipment starts the lift again (design 6.5); a log with no snapshot of the lift counts for
 * any implement. `until` keeps the history to the sessions before a day (or through it).
 */
function loggedSessions(
  logs: readonly StrengthLogEntry[],
  exerciseId: string,
  implement: EquipmentKind | null | undefined,
  until: { date: string; inclusive: boolean } | null,
): LoggedSession[] {
  const out: LoggedSession[] = []
  for (const entry of logs) {
    if (until !== null && (until.inclusive ? entry.date > until.date : entry.date >= until.date)) {
      continue
    }
    const sets = entry.sets.filter((set) => set.exerciseId === exerciseId).sort(bySetOrder)
    if (sets.length === 0) continue
    const shown = entry.lifts.find((lift) => lift.exerciseId === exerciseId)
    if (shown !== undefined && implement !== undefined && shown.implement !== implement) continue
    out.push({
      logId: entry.id,
      date: entry.date,
      mode: entry.mode,
      sets,
      base: workingLoad(sets),
      shownBase: shown === undefined ? undefined : shown.baseLoadG,
      estimate: bestEstimate(sets),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.logId.localeCompare(b.logId))
}

/**
 * The history a session on `date` reads (design 8.2, 10.2): a session on or before today is judged
 * on the sessions before it, so it shows what the rules said then; a session ahead is shown as it
 * would be now ("as of today"), on every session through today. `ref` is the day the gap counts to.
 */
function historyWindow(
  ctx: StrengthContext,
  date: string,
): { date: string; inclusive: boolean; ref: string } {
  return date <= ctx.today
    ? { date, inclusive: false, ref: date }
    : { date: ctx.today, inclusive: true, ref: ctx.today }
}

// ---------------------------------------------------------------------------------------------
// The structure of a lift: sets, repetitions and reps left (rule F7, design 8.1, 10.3)
// ---------------------------------------------------------------------------------------------

/** The sets, the range and the reps left of a lift. */
export interface Structure {
  range: { min: number; max: number }
  sets: number
  /** Null for a movement with no effort target (the trunk). */
  rir: { min: number; max: number } | null
}

/** A structure for a lift with added load and one without (the bodyweight path, design 7.4). */
export interface StructureSet {
  loaded: Structure
  unloaded: Structure
}

/** The lead lift (4 sets in the heavy template) or any other. */
export type LiftRole = 'lead' | 'other'

const build = (
  range: readonly [number, number],
  sets: number,
  rir: readonly [number, number],
): Structure => ({
  range: { min: range[0], max: range[1] },
  sets,
  rir: { min: rir[0], max: rir[1] },
})

/**
 * The structure of a lift in a template and of its first session (design 8.1 and 10.3). The first
 * session of any exercise is a ramp-in session whatever the week: `f7.rampInSets` (the first
 * value), `f7.rampInReps` and `f7.easyRir` or more left. A movement with no added load takes the
 * bodyweight range of `f7.bodyweightReps` in place of the repetitions of the template, and its
 * reps left are the template's.
 *
 * `blockWeek` is the week in the block; the first ramp-in week has fewer sets.
 */
export function structuresFor(
  template: StrengthTemplate,
  role: LiftRole,
  blockWeek: number | null = null,
): { template: StructureSet; first: StructureSet } {
  const ramp = P.f7.rampInReps.value
  const bodyweight = P.f7.bodyweightReps.value
  const heavyReps = P.flib.heavyReps.range ?? [P.flib.heavyReps.value, P.flib.heavyReps.value]
  const heavySets = P.flib.heavySets.range ?? [P.flib.heavySets.value, P.flib.heavySets.value]
  const [firstSets, laterSets] = P.f7.rampInSets.value
  const easy: [number, number] = [P.f7.easyRir.value, P.f7.easyRir.value]
  const heavyRir = P.f7.heavyRir.value
  const pair = (sets: number, reps: readonly [number, number], rir: readonly [number, number]) => ({
    loaded: build(reps, sets, rir),
    unloaded: build(bodyweight, sets, rir),
  })
  const first = pair(firstSets, ramp, easy)
  switch (template) {
    case 'ramp-in':
      return { first, template: pair(blockWeek === 1 ? firstSets : laterSets, ramp, easy) }
    case 'return':
      return { first, template: first }
    case 'heavy':
      return {
        first,
        template: pair(role === 'lead' ? heavySets[1] : heavySets[0], heavyReps, heavyRir),
      }
    case 'lighter-week':
    case 'maintenance':
      return { first, template: pair(P.f7.maintenanceSets.value, heavyReps, heavyRir) }
    case 'taper':
      return { first, template: pair(P.f7.maintenanceSets.value, heavyReps, easy) }
  }
}

// ---------------------------------------------------------------------------------------------
// The load of a lift (rules F8.1 to F8.7)
// ---------------------------------------------------------------------------------------------

type Fact = SuggestionBasis['facts'][number]

const count = (n: number): Quantity => ({ kind: 'count', n })
const percent = (pct: number): Quantity => ({ kind: 'percent', pct })
const load = (g: number): Quantity => ({ kind: 'load', g })
const share = (fraction: number): Quantity => ({ kind: 'share', fraction })

const fact = (
  template: StrengthTemplateId,
  slots: Record<string, Quantity | string> = {},
): Fact => ({ template, slots })

/** The name of an exercise as a `text` slot takes it: the catalogue's own label. */
function nameOf(id: string): string {
  const exercise = exerciseById(id)
  return exercise === undefined ? id : STRENGTH_TEMPLATES[exercise.name].text
}

/** The rule of the table in design 10.2 that decided a suggestion. */
export type F8Rule = 'F8.1' | 'F8.2' | 'F8.3' | 'F8.4' | 'F8.5' | 'F8.6' | 'F8.7'

/** Which structure the suggestion asks for: the template's, a first session's or a return's. */
export type StructureKind = 'template' | 'first' | 'return'

export interface LoadRequest {
  exerciseId: ExerciseId
  /** The implement the load is for; null for the bodyweight form. */
  implement: EquipmentKind | null
  /** The day of the session the load is for. */
  date: string
  /** The structures of the session's template and of a first session of the exercise. */
  template: StructureSet
  first: StructureSet
  /**
   * The template keeps the load (maintenance, lighter week, taper, return): a load is never raised
   * and an exercise never changed, but a set short of the range still lowers it (G6).
   */
  keepLoad?: boolean
  /** The harder movement is feasible, not left out, and the exercise is not pinned (F8.7). */
  canVary?: boolean
}

export interface LoadSuggestion {
  rule: F8Rule
  change: Exclude<WorkoutLift['change'], 'lighter-day'>
  /** Grams; null for a movement with no added load. */
  loadG: number | null
  /** The loads the equipment can make for the implement; null without a way to load. */
  steps: LoadSteps | null
  structure: StructureKind
  sets: number
  range: { min: number; max: number }
  rir: { min: number; max: number } | null
  /** The count to aim at in each set. */
  targets: number[]
  /** The reasons, as templates and slots. */
  facts: Fact[]
  /** For a `variation`: the harder movement that takes over. */
  moveTo: ExerciseId | null
  /** The estimated maximum the ceiling and the share beside a load read; null when none. */
  estimateG: number | null
}

/** The rung at or above a load: the load itself on a rung, else the next one up. */
function rungAtOrAbove(steps: LoadSteps, loadG: number, unit: WeightUnit): number | null {
  const down = roundDownToStep(steps, loadG, unit)
  if (down === null) return null
  return fromGrams(down, unit) === fromGrams(loadG, unit) ? down : stepFrom(steps, loadG, 1, unit)
}

/** What one step up from the working load comes to (rules F8.4, F8.5, design 10.2). */
interface StepUp {
  /** One step, or null when it is not usable. */
  one: number | null
  /** Two steps, or null when they are not usable. */
  two: number | null
  /** Why there is no usable step; null when there is one. */
  blocked: 'none' | 'cap' | 'ceiling' | null
}

/**
 * The step up from `base`: usable when the equipment has a heavier load, the step is within
 * `f8.maxStepPct` of the base and the load stays at or under the top of the range of
 * `flib.heavyMinPct1rm` of the estimated maximum. Two steps need each step within the cap.
 */
function stepUp(
  steps: LoadSteps | null,
  base: number | null,
  estimateG: number | null,
  unit: WeightUnit,
  wantTwo: boolean,
): StepUp {
  if (steps === null || base === null) return { one: null, two: null, blocked: 'none' }
  const first = stepFrom(steps, base, 1, unit)
  if (first === null) return { one: null, two: null, blocked: 'none' }
  const ceilingPct = P.flib.heavyMinPct1rm.range?.[1] ?? P.flib.heavyMinPct1rm.value
  const ceiling = estimateG === null ? Infinity : (estimateG * ceilingPct) / 100
  // in the units the runner sees, where the half pound and the quarter kilogram are exact
  const within = (from: number, to: number): boolean =>
    (fromGrams(to, unit) - fromGrams(from, unit)) * 100 <=
    P.f8.maxStepPct.value * fromGrams(base, unit)
  if (!within(base, first)) return { one: null, two: null, blocked: 'cap' }
  if (first > ceiling) return { one: null, two: null, blocked: 'ceiling' }
  let two: number | null = null
  if (wantTwo) {
    const second = stepFrom(steps, first, 1, unit)
    if (second !== null && within(first, second) && second <= ceiling) two = second
  }
  return { one: first, two, blocked: null }
}

/**
 * The first load of an exercise with no logged session (rule F8.1, design 10.3), in order: 70%
 * (`f8.startPctOf1rm`) of the estimated maximum of an anchor the runner entered; else a fraction of
 * the body weight from the table `f8.startFractionBodyweight`, rounded down to a step. Where the
 * product is below the lightest load the equipment makes, or the body weight is not on the
 * Profile, the lightest load stands; a bodyweight movement, and a movement the table starts with no
 * added load (a fraction of zero), has none. The history of a related exercise is not converted.
 */
function firstLoad(
  ctx: StrengthContext,
  exerciseId: ExerciseId,
  steps: LoadSteps | null,
): { loadG: number | null; facts: Fact[] } {
  const exercise = nameOf(exerciseId)
  const unit = ctx.weightUnit
  if (steps === null) {
    return { loadG: null, facts: [fact('strength.reason.start-unloaded', { exercise })] }
  }
  const lightest = lightestLoad(steps, unit)
  const lightestFact = fact('strength.reason.start-lightest', { exercise })
  if (lightest === null) return { loadG: null, facts: [lightestFact] }
  const anchor = anchorOf(ctx, exerciseId)
  const estimate = anchor === null ? null : anchorEstimate(anchor)
  if (estimate !== null) {
    const target = Math.round((estimate * P.f8.startPctOf1rm.value) / 100)
    if (target < lightest) return { loadG: lightest, facts: [lightestFact] }
    return {
      loadG: roundDownToStep(steps, target, unit) ?? lightest,
      facts: [
        fact('strength.reason.start-anchor', { exercise, pct: percent(P.f8.startPctOf1rm.value) }),
      ],
    }
  }
  const fraction = P.f8.startFractionBodyweight.value[exerciseId]
  if (fraction === 0) {
    return { loadG: null, facts: [fact('strength.reason.start-unloaded', { exercise })] }
  }
  const weightKg = ctx.athlete.weightKg
  if (fraction === undefined || weightKg === null || !(weightKg > 0)) {
    return { loadG: lightest, facts: [lightestFact] }
  }
  const target = Math.round(weightKg * 1000 * fraction)
  if (target < lightest) return { loadG: lightest, facts: [lightestFact] }
  return {
    loadG: roundDownToStep(steps, target, unit) ?? lightest,
    facts: [fact('strength.reason.start-bodyweight', { exercise })],
  }
}

/**
 * The next load of one lift, by the rules of design 10.2 (F8.1 to F8.7), the first that applies:
 *
 * 1. F8.1 no logged session: the first load, in the ramp-in structure.
 * 2. F8.2 the latest session of any mode was `f8.layoffDays` or more days ago: the last working
 *    load times `f8.layoffLoadFraction`, rounded down to a step, at the low end of the range.
 * 3. F8.3 a set below the range: the working load less `f8.reducePct`, rounded to a step, at least
 *    one step.
 * 4. F8.4 every set at the top with at least `f8.bigStepRir` left, all recorded: two steps.
 * 5. F8.5 every set at the top with at least `f8.progressMinRir` left, all recorded: one step.
 * 6. F8.7 no usable step for `f8.ceilingSessions` sessions in a row: the harder movement.
 * 7. F8.6 otherwise: the working load, each set aiming one rep above the last.
 *
 * The working load is that of the latest `normal` session; a session in another mode neither
 * raises nor lowers it (design 10.4). The rules judge the load that was lifted, not the load that
 * was suggested. A load always lands on a rung the equipment makes.
 */
export function suggestLoad(ctx: StrengthContext, req: LoadRequest): LoadSuggestion {
  const unit = ctx.weightUnit
  const steps = req.implement === null ? null : stepsFor(equipmentOf(ctx), req.implement, unit)
  const window = historyWindow(ctx, req.date)
  const sessions = loggedSessions(ctx.logs, req.exerciseId, req.implement, window)
  const latest = sessions.at(-1)
  const anchor = anchorOf(ctx, req.exerciseId)
  const estimateG =
    latest === undefined ? (anchor === null ? null : anchorEstimate(anchor)) : latest.estimate
  const exercise = nameOf(req.exerciseId)
  const easy = P.f7.easyRir.value

  const pick = (set: StructureSet, loaded: boolean): Structure =>
    loaded ? set.loaded : set.unloaded
  const make = (
    rule: F8Rule,
    change: LoadSuggestion['change'],
    loadG: number | null,
    kind: StructureKind,
    shape: Structure,
    targets: number[],
    facts: Fact[],
    moveTo: ExerciseId | null = null,
  ): LoadSuggestion => ({
    rule,
    change,
    loadG,
    steps,
    structure: kind,
    sets: shape.sets,
    range: shape.range,
    rir: shape.rir,
    targets,
    facts,
    moveTo,
    estimateG,
  })
  const fill = (shape: Structure, at: number): number[] =>
    Array.from({ length: shape.sets }, () => at)
  const onLadder = (g: number | null): number | null =>
    steps === null || g === null ? null : roundDownToStep(steps, g, unit)

  // F8.1: no logged session of the exercise
  if (latest === undefined) {
    const first = firstLoad(ctx, req.exerciseId, steps)
    const shape = pick(req.first, first.loadG !== null)
    return make(
      'F8.1',
      'start',
      first.loadG,
      'first',
      shape,
      fill(shape, shape.range.min),
      first.facts,
    )
  }

  const normal = sessions.filter((session) => session.mode === 'normal')
  const lastNormal = normal.at(-1)
  const gap = daysBetween(latest.date, window.ref)
  const base =
    lastNormal !== undefined
      ? lastNormal.base
      : latest.shownBase !== undefined
        ? latest.shownBase
        : latest.base
  const loaded = steps !== null && base !== null

  // F8.2: a gap
  if (gap >= P.f8.layoffDays.value) {
    const returned =
      base === null ? null : onLadder(Math.round(base * P.f8.layoffLoadFraction.value))
    const own = pick(req.template, loaded)
    const shape = { ...own, rir: own.rir === null ? null : { min: easy, max: easy } }
    const facts = loaded
      ? [
          fact('strength.reason.return', {
            exercise,
            days: count(gap),
            share: share(P.f8.layoffLoadFraction.value),
          }),
        ]
      : []
    return make('F8.2', 'return', returned, 'return', shape, fill(shape, shape.range.min), facts)
  }

  // only a lighter session of the exercise so far: it is still new to the body, at the load shown
  if (lastNormal === undefined) {
    const held = onLadder(base)
    const shape = pick(req.first, held !== null)
    return make('F8.6', 'hold', held, 'first', shape, fill(shape, shape.range.min), [])
  }

  const shape = pick(req.template, loaded)
  const { min: lo, max: hi } = shape.range
  const held = onLadder(base)
  const counts = lastNormal.sets.map((set) => set.count)

  // F8.3: a set below the range
  const lowest = Math.min(...counts)
  if (lowest < lo) {
    let lowered = held
    let moved = false
    if (steps !== null && base !== null) {
      const oneDown = stepFrom(steps, base, -1, unit)
      if (oneDown !== null) {
        const pct = 1 - P.f8.reducePct.value / 100
        const rounded = rungAtOrAbove(steps, Math.round(base * pct), unit)
        lowered = Math.min(oneDown, rounded ?? oneDown)
        moved = true
      }
    }
    const set = count(counts.indexOf(lowest) + 1)
    const facts = !moved
      ? []
      : lowest === 1
        ? [
            fact('strength.reason.reduce-one', {
              set,
              exercise,
              lo: count(lo),
              hi: count(hi),
            }),
          ]
        : [
            fact('strength.reason.reduce', {
              set,
              exercise,
              count: count(lowest),
              lo: count(lo),
              hi: count(hi),
            }),
          ]
    return make(
      'F8.3',
      moved ? 'reduce' : 'hold',
      lowered,
      'template',
      shape,
      fill(shape, lo),
      facts,
    )
  }

  // a movement with no effort target (the trunk) has no reps left to read, so no step up: the
  // load holds and each set aims one rep, or one second, above the last
  const aimAbove = (): number[] =>
    Array.from({ length: shape.sets }, (_, i) => {
      const last = counts[Math.min(i, counts.length - 1)] ?? lo
      return Math.max(lo, Math.min(hi, last + 1))
    })
  if (shape.rir === null) return make('F8.6', 'hold', held, 'template', shape, aimAbove(), [])

  // F8.4, F8.5, F8.7: every set at the top, with reps left, all recorded
  const allTop = counts.every((c) => c >= hi)
  const spare = lastNormal.sets.flatMap((set) => (set.rir === null ? [] : [set.rir]))
  const recorded = spare.length === lastNormal.sets.length
  const minRir = recorded ? Math.min(...spare) : null
  const atTop = (session: LoggedSession): boolean => {
    const left = session.sets.flatMap((set) => (set.rir === null ? [] : [set.rir]))
    return (
      session.sets.every((set) => set.count >= hi) &&
      left.length === session.sets.length &&
      Math.min(...left) >= P.f8.progressMinRir.value
    )
  }
  const eligible = allTop && minRir !== null && minRir >= P.f8.progressMinRir.value
  const bigStep = minRir !== null && minRir >= P.f8.bigStepRir.value
  // The ceiling reads the estimate of the session the rules judge, the latest normal one, so a
  // lighter session after it, which neither raises nor lowers the base, cannot lower the ceiling.
  // The estimate shown beside a load stays that of the latest session (design 6.3).
  const move = stepUp(steps, base, lastNormal.estimate, unit, bigStep)
  if (eligible && move.blocked === null && req.keepLoad !== true) {
    const next = move.two ?? move.one
    const twice = move.two !== null
    return make(twice ? 'F8.4' : 'F8.5', 'increase', next, 'template', shape, fill(shape, lo), [
      twice
        ? fact('strength.reason.increase-two', {
            exercise,
            top: count(hi),
            rir: count(P.f8.bigStepRir.value),
          })
        : fact('strength.reason.increase', { exercise, top: count(hi) }),
    ])
  }

  // F8.7: no usable step in a row of sessions at the top of the range
  const harder = exerciseById(req.exerciseId)?.harder ?? null
  if (eligible && move.blocked !== null && req.keepLoad !== true && req.canVary === true) {
    const needed = P.f8.ceilingSessions.value
    const recent = normal.slice(-needed)
    const stuck =
      recent.length === needed &&
      recent.every(
        (session, i) =>
          i === recent.length - 1 ||
          (atTop(session) &&
            stepUp(steps, session.base, session.estimate, unit, false).blocked !== null),
      )
    if (stuck && harder !== null) {
      const next = pick(req.first, false)
      return make(
        'F8.7',
        'variation',
        held,
        'first',
        next,
        fill(next, next.range.min),
        [
          fact('strength.reason.variation', {
            exercise,
            sessions: count(needed),
            next: nameOf(harder),
          }),
        ],
        harder,
      )
    }
  }

  // F8.6: the working load, each set aiming one rep above the last
  const targets = aimAbove()
  let facts: Fact[]
  if (!allTop) {
    facts = [fact('strength.reason.hold-range', { exercise, top: count(hi) })]
  } else if (!recorded) {
    facts = [fact('strength.reason.hold-unrecorded')]
  } else if (!eligible) {
    facts = [
      fact('strength.reason.hold-effort', {
        exercise,
        top: count(hi),
        reps: countPhrase(P.f8.progressMinRir.value, 'rep'),
      }),
    ]
  } else if (req.keepLoad === true || base === null) {
    facts = []
  } else if (move.blocked === 'cap') {
    facts = [
      fact('strength.reason.hold-step', { load: load(base), pct: percent(P.f8.maxStepPct.value) }),
    ]
  } else if (move.blocked === 'ceiling') {
    const ceilingPct = P.flib.heavyMinPct1rm.range?.[1] ?? P.flib.heavyMinPct1rm.value
    facts = [fact('strength.reason.hold-ceiling', { pct: percent(ceilingPct) })]
  } else {
    facts = []
  }
  return make('F8.6', 'hold', held, 'template', shape, targets, facts)
}

// ---------------------------------------------------------------------------------------------
// The jump dose (rule F7, design 8.2)
// ---------------------------------------------------------------------------------------------

/** Whether a finished week was a completed running week (design 8.2, rule J5). */
function completedRunningWeek(week: StrengthWeek): boolean {
  // a week a rest window touched is not completed; so is a week with nothing planned to complete
  if (week.flags.includes('disrupted') || week.flags.includes('disruption-return')) return false
  return (
    week.plannedRunMin > 0 && week.runMin / week.plannedRunMin >= P.j5.completionHoldShare.value
  )
}

/**
 * The steps of contacts and the rung of the jump ladder reached before the week of `before`, read
 * from the finished weeks of the stored plan and never stored. Each block week after the ramp-in
 * counts toward the next step (`f7.plyoStepEveryWeeks`) and the next rung (`f7.plyoRungWeeks`), and
 * a step or a move is taken only at the end of a completed running week; an incomplete week holds
 * the dose and the step is taken at the first completed week after it. Return weeks and ramp-in
 * weeks hold the dose and count toward nothing.
 */
function plyoLadder(ctx: StrengthContext, before: string): { steps: number; rung: number } {
  const finished = ctx.weeks
    .filter((w) => w.weekStart < before && addDays(w.weekStart, 7) <= ctx.today)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  let steps = 0
  let rung = 0
  let sinceStep = 0
  let sinceRung = 0
  for (const w of finished) {
    const at = blockPosition(ctx, w.weekStart)
    if (at === null || isReturnWeek(w) || at.week <= at.rampInWeeks) continue
    sinceStep += 1
    sinceRung += 1
    if (!completedRunningWeek(w)) continue
    if (sinceStep >= P.f7.plyoStepEveryWeeks.value) {
      steps += 1
      sinceStep = 0
    }
    if (sinceRung >= P.f7.plyoRungWeeks.value) {
      rung += 1
      sinceRung = 0
    }
  }
  return { steps, rung: Math.min(rung, PLYO_LADDER.length - 1) }
}

/**
 * The jump dose of a session (design 8.1, 8.2): none in a taper or a return; the start of the
 * ladder in the ramp-in; `min(cap, start + step x steps)` contacts on the rung reached in the heavy
 * weeks; half of that in a lighter week; `f7.maintenancePlyoContacts` on the rung reached in
 * maintenance. The dose is multiplied by `f7.reducedPlyoShare` once, whichever of these applies: a
 * goal pace faster than `flib.plyoEmphasisPaceKmh`, a bone stress history, a recent injury, or a
 * lighter week (G6: the most conservative of the cases that collide, not their product). A bone
 * stress history or a recent injury also stops the ladder at its second rung.
 */
function plyoFor(
  ctx: StrengthContext,
  template: StrengthTemplate,
  weekStart: string,
): PlyoDose | null {
  if (template === 'taper' || template === 'return') return null
  const cap = P.flib.plyoContactsMax.value
  const { steps, rung } =
    template === 'ramp-in' ? { steps: 0, rung: 0 } : plyoLadder(ctx, weekStart)
  const injured = ctx.athlete.risk.priorBsi || ctx.athlete.risk.recentInjury
  const reached = injured ? Math.min(rung, 1) : rung
  const dose =
    template === 'maintenance'
      ? P.f7.maintenancePlyoContacts.value
      : P.f7.plyoStartContacts.value + P.f7.plyoStepContacts.value * steps
  const fast = ctx.goal.paceKmh !== null && ctx.goal.paceKmh > P.flib.plyoEmphasisPaceKmh.value
  const reduced = fast || injured || template === 'lighter-week'
  const contacts = Math.min(cap, reduced ? Math.round(dose * P.f7.reducedPlyoShare.value) : dose)
  // the movement of the rung, or the nearest easier one the runner has not left out, else a harder
  const avoided = avoidedBy(ctx)
  const easier = [...PLYO_LADDER.slice(0, reached + 1)].reverse()
  const movement = [...easier, ...PLYO_LADDER.slice(reached + 1)].find((id) => !avoided.has(id))
  return movement === undefined ? null : { contacts, movements: [movement] }
}

// ---------------------------------------------------------------------------------------------
// Lighter days and weeks, the taper and the return (rule F9, design 10.4)
// ---------------------------------------------------------------------------------------------

/**
 * Whether the viewed day's readiness is lower than usual (design 10.4): the readiness read is not
 * `normal`, or a pain report at or above `pain.flagScore` is recent, or an illness is in its
 * easy-only phase (the rest phase counts as well, for a caller that still shows the session). The
 * tests are those rule J3 already applies to runs: no second test and no new threshold. Readiness
 * never adds load. A preview or a past day has no read (`null`) and no reduction.
 */
export function isLowReadiness(readiness: StrengthReadiness | null): boolean {
  if (readiness === null) return false
  return (
    readiness.state !== 'normal' ||
    (readiness.pain !== null && readiness.pain >= P.pain.flagScore.value) ||
    readiness.illness !== 'clear'
  )
}

/** Templates that keep the load: it is never raised and the exercise never changes (G6). */
const keepsLoad = (template: StrengthTemplate): boolean =>
  template === 'lighter-week' ||
  template === 'maintenance' ||
  template === 'taper' ||
  template === 'return'

/** The reason a template that keeps the load gives for the unchanged load, as a fact. */
function keptFact(template: StrengthTemplate): Fact | null {
  const sets = countPhrase(P.f7.maintenanceSets.value, 'set')
  switch (template) {
    case 'lighter-week':
      return fact('strength.reason.lighter-week', { sets })
    case 'taper':
      return fact('strength.reason.taper', { sets })
    case 'maintenance':
      return fact('strength.reason.maintenance', { sets })
    case 'ramp-in':
    case 'heavy':
    case 'return':
      return null
  }
}

// ---------------------------------------------------------------------------------------------
// The lifts of a workout
// ---------------------------------------------------------------------------------------------

/** What every lift of one session shares. */
interface SessionPlan {
  session: Pick<StrengthSessionRef, 'id' | 'date' | 'durationMin' | 'rules'>
  weekStart: string
  position: BlockPosition | null
  template: StrengthTemplate
  variant: 'A' | 'B'
  /** The viewed day's readiness is lower than usual. */
  lowReadiness: boolean
}

/** The harder movement of an exercise, as a lift, when the runner can do it and has not left it out. */
function harderChoice(
  ctx: StrengthContext,
  plan: SessionPlan,
  id: ExerciseId,
  slot: Slot,
): LiftChoice | null {
  const harder = exerciseById(id)?.harder ?? null
  if (harder === null || avoidedBy(ctx).has(harder)) return null
  if (slot !== 'trunk' && slot !== 'plyo' && pinnedFor(ctx, slot) === id) return null
  const way = waysFor(ctx, harder, barbellAllowed(plan.template))[0]
  return way === undefined ? null : { exerciseId: harder, floor: false, ...way }
}

/** One lift of the workout from the way it is done and the suggestion for its load. */
function liftFrom(
  ctx: StrengthContext,
  plan: SessionPlan,
  choice: LiftChoice,
  slot: Slot,
  suggestion: LoadSuggestion,
  trail: Fact[],
): WorkoutLift {
  const kept = suggestion.change === 'hold' ? keptFact(plan.template) : null
  let change: WorkoutLift['change'] = suggestion.change
  let facts = suggestion.facts
  let rule: SuggestionBasis['rule'] = facts.length > 0 ? 'F8' : 'F7'
  if (suggestion.change === 'start' && trail.length > 0) {
    change = 'variation'
    facts = [...trail, ...facts]
  }
  if (kept !== null) {
    facts = [kept]
    rule = 'F9'
  }
  let sets = suggestion.sets
  let targets = suggestion.targets
  let loadG = suggestion.loadG
  let usualLoadG: number | null = null

  // a lower-readiness day: one set fewer (at least the fewest sets of any template remain) and a
  // lighter load, rounded down to a step; the usual load stays one tap away
  if (plan.lowReadiness && slot !== 'trunk') {
    const fewest = P.f7.maintenanceSets.value
    const fewer = Math.max(sets - P.f9.lowReadinessSetsCut.value, Math.min(sets, fewest))
    const lighter =
      loadG === null || suggestion.steps === null
        ? loadG
        : Math.min(
            loadG,
            roundDownToStep(
              suggestion.steps,
              Math.round(loadG * (1 - P.f9.lowReadinessLoadPct.value / 100)),
              ctx.weightUnit,
            ) ?? loadG,
          )
    if (fewer !== sets || lighter !== loadG) {
      usualLoadG = loadG
      loadG = lighter
      sets = fewer
      targets = targets.slice(0, fewer)
      change = 'lighter-day'
      facts = [
        fact('strength.reason.lighter-day', {
          sets: countPhrase(P.f9.lowReadinessSetsCut.value, 'set'),
        }),
        ...facts,
      ]
      rule = 'F9'
    }
  }
  return {
    exerciseId: choice.exerciseId,
    slot,
    implement: choice.implement,
    sets,
    range: suggestion.range,
    targets,
    loadG,
    steps: suggestion.steps,
    rir: suggestion.rir,
    change,
    usualLoadG,
    basis: { rule, facts },
  }
}

/** The request for the load of a lift of this session. */
function requestFor(
  ctx: StrengthContext,
  plan: SessionPlan,
  choice: LiftChoice,
  slot: Slot,
  role: LiftRole,
): LoadRequest {
  if (slot === 'trunk') {
    const seconds = exerciseById(choice.exerciseId)?.measure === 'seconds'
    const [min, max] = seconds ? P.f7.trunkHoldSec.value : P.f7.trunkReps.value
    const shape: Structure = { range: { min, max }, sets: P.f7.trunkSets.value, rir: null }
    const both = { loaded: shape, unloaded: shape }
    return {
      exerciseId: choice.exerciseId,
      implement: choice.implement,
      date: plan.session.date,
      template: both,
      first: both,
      keepLoad: true,
    }
  }
  const shapes = structuresFor(plan.template, role, plan.position?.week ?? null)
  return {
    exerciseId: choice.exerciseId,
    implement: choice.implement,
    date: plan.session.date,
    ...shapes,
    keepLoad: keepsLoad(plan.template),
    canVary: harderChoice(ctx, plan, choice.exerciseId, slot) !== null,
  }
}

/**
 * The lift of a slot with its load. When the rules move an exercise on to its harder movement
 * (F8.7) the harder movement takes the place: its own history decides its load, and its first
 * session carries the reason for the move. A movement that carries no load and no effort target
 * (a plank, a band) is counted and never loaded.
 */
function buildLift(
  ctx: StrengthContext,
  plan: SessionPlan,
  start: LiftChoice,
  slot: Slot,
  role: LiftRole,
): WorkoutLift {
  let choice = start
  let trail: Fact[] = []
  const seen = new Set<ExerciseId>()
  for (;;) {
    seen.add(choice.exerciseId)
    const request = requestFor(ctx, plan, choice, slot, role)
    if (slot === 'trunk' && choice.steps === null) {
      const shape = request.template.unloaded
      return {
        exerciseId: choice.exerciseId,
        slot,
        implement: choice.implement,
        sets: shape.sets,
        range: shape.range,
        targets: Array.from({ length: shape.sets }, () => shape.range.min),
        loadG: null,
        steps: null,
        rir: null,
        change: 'hold',
        usualLoadG: null,
        basis: { rule: 'F7', facts: [] },
      }
    }
    const suggestion = suggestLoad(ctx, request)
    const next =
      suggestion.change === 'variation' && suggestion.moveTo !== null
        ? harderChoice(ctx, plan, choice.exerciseId, slot)
        : null
    if (next === null || seen.has(next.exerciseId)) {
      return liftFrom(ctx, plan, choice, slot, suggestion, trail)
    }
    trail = [...trail, ...suggestion.facts]
    choice = next
  }
}

/** The trunk movements of a session: the preferred two of the variant, one in the taper. */
const TRUNK_ORDER: Readonly<Record<'A' | 'B', readonly ExerciseId[]>> = {
  A: ['side-plank', 'dead-bug', 'banded-lateral-walk', 'pallof-press', 'farmer-carry'],
  B: ['banded-lateral-walk', 'pallof-press', 'farmer-carry', 'side-plank', 'dead-bug'],
}

function trunkOf(ctx: StrengthContext, plan: SessionPlan): WorkoutLift[] {
  const avoided = avoidedBy(ctx)
  const chosen = TRUNK_ORDER[plan.variant].flatMap((id): LiftChoice[] => {
    const way = avoided.has(id) ? undefined : waysFor(ctx, id)[0]
    return way === undefined ? [] : [{ exerciseId: id, floor: false, ...way }]
  })
  const [first, second] = chosen
  const movements = plan.template === 'taper' ? [first] : [first, second]
  return movements.flatMap((choice) =>
    choice === undefined ? [] : [buildLift(ctx, plan, choice, 'trunk', 'other')],
  )
}

/** The lifts of a session in order: the lead lift, the other lift of the pair, then the calf. */
function liftsOf(ctx: StrengthContext, plan: SessionPlan): WorkoutLift[] {
  const lead: LadderSlot = plan.variant === 'A' ? 'knee' : 'hip'
  const other: LadderSlot = plan.variant === 'A' ? 'hip' : 'knee'
  const taper = plan.template === 'taper'
  const order: LadderSlot[] = taper ? [lead, 'calf', other] : [lead, other, 'calf']
  const wanted = taper ? P.f7.taperLifts.value : P.flib.heavyExercises.value
  return order.slice(0, wanted).map((slot) => {
    const choice = pickLift(slot, ctx, {
      barbell: barbellAllowed(plan.template),
      variant: plan.variant,
    })
    return buildLift(ctx, plan, choice, slot, slot === lead ? 'lead' : 'other')
  })
}

/** The plan of a session: its week, its place in the block, its template and its variant. */
function planOf(ctx: StrengthContext, session: StrengthSessionRef): SessionPlan {
  const weekStart = mondayOf(session.date)
  const week = ctx.weeks.find((w) => w.weekStart === weekStart)
  const position = blockPosition(ctx, weekStart)
  const readiness = ctx.readiness
  return {
    session,
    weekStart,
    position,
    template: strengthTemplate(week ?? { flags: [], phase: '', isRecovery: false }, position),
    variant: sessionVariant(ctx, session),
    lowReadiness:
      readiness !== null && readiness.date === session.date && isLowReadiness(readiness),
  }
}

/**
 * The one derived workout of a strength session (design 5.1): the lifts with sets, repetitions,
 * reps left and loads in grams, the jump dose, the trunk movements and the reasons, as templates
 * and slots. A pure function of the stored plan, the saved setup and the logged sets; nothing is
 * stored and the same inputs give the same workout. Every surface renders this object.
 */
export function workoutFor(ctx: StrengthContext, session: StrengthSessionRef): StrengthWorkout {
  const plan = planOf(ctx, session)
  return {
    sessionId: session.id,
    date: session.date,
    template: plan.template,
    variant: plan.variant,
    block: plan.position === null ? null : { ...plan.position },
    budgetMin: session.durationMin,
    setupSaved: ctx.setup.saved,
    lifts: liftsOf(ctx, plan),
    plyo: plyoFor(ctx, plan.template, plan.weekStart),
    trunk: trunkOf(ctx, plan),
    rules: [...session.rules],
  }
}

/**
 * A lift of a catalogue exercise in this session's place, for a swap or an added lift (design
 * 7.3, 9.1): the exercise's way of being done with the saved equipment and its load as the rules
 * give it (a first session for an exercise with no history). Null for a jump, which is a dose, and
 * for an exercise the runner cannot do.
 */
export function liftFor(
  ctx: StrengthContext,
  session: StrengthSessionRef,
  exerciseId: ExerciseId,
): WorkoutLift | null {
  const exercise = exerciseById(exerciseId)
  if (exercise === undefined || exercise.slot === 'plyo') return null
  const plan = planOf(ctx, session)
  const way = waysFor(ctx, exerciseId, barbellAllowed(plan.template))[0]
  if (way === undefined) return null
  const lead = plan.variant === 'A' ? 'knee' : 'hip'
  return buildLift(
    ctx,
    plan,
    { exerciseId, floor: false, ...way },
    exercise.slot,
    exercise.slot === lead ? 'lead' : 'other',
  )
}

/**
 * How the session is logged (design 9.3, 10.4): `lighter-day` when the readiness cut a lift,
 * `return` in a return week or when a lift came back after a gap, `taper` and `lighter-week` in
 * those templates, else `normal`. Only a `normal` session moves the working load of a lift.
 */
export function modeOf(workout: Pick<StrengthWorkout, 'template' | 'lifts'>): StrengthMode {
  if (workout.template === 'return' || workout.lifts.some((lift) => lift.change === 'return')) {
    return 'return'
  }
  if (workout.lifts.some((lift) => lift.change === 'lighter-day')) return 'lighter-day'
  if (workout.template === 'taper') return 'taper'
  if (workout.template === 'lighter-week') return 'lighter-week'
  return 'normal'
}

/** The words of an exercise as templates and slots: its name, its cue and its tempo or effort note. */
export function liftTexts(exerciseId: string): { name: Fact; cue: Fact; note: Fact } | null {
  const exercise = exerciseById(exerciseId)
  if (exercise === undefined) return null
  const noteSlots = Object.keys(STRENGTH_TEMPLATES[exercise.note].slots)
  return {
    name: fact(exercise.name),
    cue: fact(exercise.cue),
    note: fact(
      exercise.note,
      noteSlots.includes('seconds') ? { seconds: count(P.f7.lowerSeconds.value) } : {},
    ),
  }
}

// ---------------------------------------------------------------------------------------------
// History and the tracking behind it (design 6.4, 12.1, 12.2, 12.4)
// ---------------------------------------------------------------------------------------------

/** One set as the history shows it. */
export interface HistorySet {
  position: number
  loadG: number | null
  count: number
  rir: number | null
}

/** One logged session of one exercise: the line of the history table. */
export interface HistorySession {
  logId: string
  date: string
  mode: StrengthMode
  sets: HistorySet[]
  /** The heaviest set: the greatest load, and of equals the most reps; null with no loaded set. */
  heaviest: { loadG: number; count: number } | null
  /** The load used in most sets, the lower on a tie; null for a movement with no added load. */
  workingLoadG: number | null
  /** The estimated maximum of the session's best set, a label and never a test. */
  estimateG: number | null
}

/** One exercise of the Lifts list and its history. */
export interface LiftHistory {
  exerciseId: string
  /** Newest first. */
  sessions: HistorySession[]
  /** The date of the latest session of any mode. */
  lastDate: string
  /** Days from the latest session to today; the gap rule counts from here (F8.2). */
  gapDays: number
  /** The working load of the latest normal session. */
  workingLoadG: number | null
  /** From the anchor until the first log, then from the best set of the latest session. */
  estimateG: number | null
  /** The last move of the working load between two normal sessions; null when it has not moved. */
  lastChange: { fromG: number; toG: number; date: string } | null
}

/** One week of the review: sessions planned and logged, sets, and the lifts that moved. */
export interface WeekHistory {
  weekStart: string
  planned: number
  logged: number
  sets: number
  /** Lifts whose working load differs from the one before the week ("Back squat 110 lb to 115 lb"). */
  moved: Array<{ exerciseId: string; fromG: number; toG: number }>
}

export interface HistorySummary {
  /** Exercises with a logged set, the latest first. */
  lifts: LiftHistory[]
  /** Weeks with a planned or a logged session, oldest first. */
  weeks: WeekHistory[]
  /** Finished weeks in a row, the latest first, with fewer sessions logged than planned. */
  lowCountWeeks: number
  /** The page may ask whether to plan fewer a week (`f9.countPromptWeeks`, design 12.4). */
  countPrompt: boolean
}

function historySession(session: LoggedSession): HistorySession {
  const loaded = session.sets.filter((set) => set.loadG !== null && set.loadG > 0)
  const heaviest = [...loaded].sort(
    (a, b) => (b.loadG ?? 0) - (a.loadG ?? 0) || b.count - a.count || a.position - b.position,
  )[0]
  return {
    logId: session.logId,
    date: session.date,
    mode: session.mode,
    sets: session.sets.map((set) => ({
      position: set.position,
      loadG: set.loadG,
      count: set.count,
      rir: set.rir,
    })),
    heaviest:
      heaviest === undefined || heaviest.loadG === null
        ? null
        : { loadG: heaviest.loadG, count: heaviest.count },
    workingLoadG: session.base,
    estimateG: session.estimate,
  }
}

/**
 * What the Strength page and the weekly review read, computed from the logs and the stored plan on
 * every read (design 6.4, 12): the sessions of each exercise with their heaviest set and estimated
 * maximum, the last move of each working load, and for each week the sessions planned and logged,
 * the sets and the lifts that moved. The history of an exercise is every session of it, whatever
 * implement it was done with. A session counts as a log, so the history cannot disagree with it.
 * Nothing is stored; the order of the rows does not matter.
 */
export function summariseHistory(ctx: StrengthContext): HistorySummary {
  const ids = [...new Set(ctx.logs.flatMap((entry) => entry.sets.map((set) => set.exerciseId)))]
  const lifts: LiftHistory[] = []
  for (const exerciseId of ids) {
    const sessions = loggedSessions(ctx.logs, exerciseId, undefined, null)
    const latest = sessions.at(-1)
    if (latest === undefined) continue
    const normal = sessions.filter((session) => session.mode === 'normal')
    const lastNormal = normal.at(-1)
    const before = normal.slice(0, -1).at(-1)
    const from = before?.base ?? null
    const to = lastNormal?.base ?? null
    lifts.push({
      exerciseId,
      sessions: sessions.map(historySession).reverse(),
      lastDate: latest.date,
      gapDays: daysBetween(latest.date, ctx.today),
      workingLoadG: to,
      estimateG: latest.estimate,
      lastChange:
        lastNormal !== undefined && from !== null && to !== null && from !== to
          ? { fromG: from, toG: to, date: lastNormal.date }
          : null,
    })
  }
  lifts.sort(
    (a, b) => b.lastDate.localeCompare(a.lastDate) || a.exerciseId.localeCompare(b.exerciseId),
  )

  const mondays = new Set([
    ...ctx.sessions.map((session) => mondayOf(session.date)),
    ...ctx.logs.map((entry) => mondayOf(entry.date)),
  ])
  const weeks: WeekHistory[] = [...mondays].sort().map((weekStart) => {
    const inWeek = ctx.logs.filter((entry) => mondayOf(entry.date) === weekStart)
    const moved: WeekHistory['moved'] = []
    for (const exerciseId of ids) {
      const all = loggedSessions(ctx.logs, exerciseId, undefined, null).filter(
        (session) => session.mode === 'normal',
      )
      const during = all.filter((session) => mondayOf(session.date) === weekStart).at(-1)
      const earlier = all.filter((session) => session.date < weekStart).at(-1)
      const to = during?.base ?? null
      const from = earlier?.base ?? null
      if (to !== null && from !== null && to !== from)
        moved.push({ exerciseId, fromG: from, toG: to })
    }
    return {
      weekStart,
      planned: ctx.sessions.filter((session) => mondayOf(session.date) === weekStart).length,
      logged: inWeek.length,
      sets: inWeek.reduce((total, entry) => total + entry.sets.length, 0),
      moved,
    }
  })

  // Finished weeks in a row, the latest first, with fewer sessions logged than planned (design
  // 12.4). The calendar is walked back from the week before this one, so a week with nothing
  // planned ends the run instead of being skipped.
  let lowCountWeeks = 0
  const earliest = weeks[0]?.weekStart
  for (
    let start = addDays(mondayOf(ctx.today), -7);
    earliest !== undefined && start >= earliest;
    start = addDays(start, -7)
  ) {
    const week = weeks.find((w) => w.weekStart === start)
    if (week === undefined || !(week.planned > 0 && week.logged < week.planned)) break
    lowCountWeeks += 1
  }
  return {
    lifts,
    weeks,
    lowCountWeeks,
    countPrompt: lowCountWeeks >= P.f9.countPromptWeeks.value,
  }
}
