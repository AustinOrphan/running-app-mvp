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
import { addDays, mondayOf } from '../dates.ts'
import {
  FLOOR_EXERCISE,
  exerciseById,
  isExerciseId,
  ladderFor,
  loadMeaning,
  usableImplements,
  type ExerciseId,
  type LadderSlot,
} from '../domain/strengthLibrary.ts'
import { stepsFor } from '../domain/weight.ts'
import type { EquipmentConfig, EquipmentKind, LoadSteps, StrengthTemplate } from '../types.ts'
import { strengthBlockPosition } from './macro.ts'
import { P } from './params/index.ts'
import type { StrengthContext, StrengthSessionRef, StrengthWeek } from './types.ts'

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
