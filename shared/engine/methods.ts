// The method presets of a plan [rules P1 to P4]: which preset applies to a runner and a plan today,
// why one that was asked for does not, and the effective value of each of the four values a preset
// may override [methods proposal, sections 4.3 to 4.5]. Pure: the same input gives the same answer.
//
// The readers (macro, micro, goal, postRace, explainInputs) call `effective` where they read
// `P.<id>.value` of an overridable value, as `tidFor` takes `polarized`. `P` is never swapped, so a
// module-level snapshot of it cannot go stale. The resolution below is made once per plan and its
// `effective` preset is what the readers pass. It imports no macro, post-race or load-setting code
// (holds.ts instead), so every reader can import it.
import { persistentHoldOf, type PersistentHold } from './holds.ts'
import { P } from './params/index.ts'
import { PRESET_OVERRIDES, type NumericOverrideId } from './params/p-methods.ts'
import {
  isPresetId,
  type AthleteState,
  type EngineInput,
  type GoalModel,
  type Param,
  type PresetId,
} from './types.ts'

/** The default of each numeric overridable value: the only reads of these Params outside the registry. */
const DEFAULTS: Readonly<Record<NumericOverrideId, Param<number>>> = {
  'f5.mastersMaxRunDays': P.f5.mastersMaxRunDays,
  'macroDesign.longRunShareOfWeek': P.macroDesign.longRunShareOfWeek,
  'macroDesign.buildWeeks': P.macroDesign.buildWeeks,
}

/**
 * The value of an overridable id under a preset: the preset's own grade D Param when it overrides
 * the id, else the default. `method` is the preset that applies (`MethodPosition.effective`), never
 * the one that was asked for: the applicability and hold rules are made once, by `resolveMethod`.
 */
export function effective(method: PresetId, id: NumericOverrideId): number {
  return (PRESET_OVERRIDES[method][id] ?? DEFAULTS[id]).value
}

type DistanceClass = GoalModel['distanceClass']

/**
 * The goal classes a preset names [rules P2, P4]; a preset not listed applies to every class. P2
 * is for goals from 5 km to the half marathon (decision 6 of the methods proposal): a marathon or
 * longer goal reads the default.
 */
const PRESET_CLASSES: Readonly<Partial<Record<PresetId, readonly DistanceClass[]>>> = {
  'three-run-days': ['5k', '10k', 'half'],
}

/** Whether a preset names the goal class. */
export function appliesToClass(method: PresetId, distanceClass: DistanceClass): boolean {
  return PRESET_CLASSES[method]?.includes(distanceClass) ?? true
}

/**
 * Why a preset that was asked for reads as the default, in the order the rules are tried:
 * - `not-applicable`: the goal class is not one the preset names (a goal switch carries the choice
 *   to another class);
 * - `held:<hold>`: a persistent hold of the load setting applies (see holds.ts);
 * - `novice`: the preset only lowers the run-day cap, and a novice already runs the novice days
 *   (`f5.noviceRunDays`) whatever the cap;
 * - `no-base`: the plan has no base week to lengthen [rule P4].
 */
export type MethodReason = 'not-applicable' | `held:${PersistentHold}` | 'novice' | 'no-base'

/** The preset a plan asked for, the one that applies today, and why they differ. */
export interface MethodPosition {
  /** What the plan asks for (`options.method`); `default` when the option is absent or unknown. */
  requested: PresetId
  /** What applies today; the default when `reason` is set, and always for `default` itself. */
  effective: PresetId
  /** Why `requested` reads as the default; null when it does not, and always null for `default`. */
  reason: MethodReason | null
}

/**
 * The preset that applies to this runner and plan today [rules P1 to P4]. The default is today's
 * engine. A preset is held at the default, with the reason, for a goal class it does not name, while
 * a persistent hold of the load setting lasts (a recent injury, a bone stress injury, BSI factors,
 * a RED-S hold, bone pain), for a novice whose only override is the run-day cap, and for a plan
 * with no base week to lengthen. The transient holds (a rest window, the window of a past race) do
 * not hold it: they open and close between weekly re-plans, and a preset that followed them would
 * switch run days in the middle of a plan. The E6 start paths plan their own weeks first, and the
 * preset applies to the weeks after them.
 *
 * `weeks` are the weeks of the plan, past and planned, when they are known: the check for a base
 * week reads them. Without them the check is skipped, which is right where the phases are still
 * being drawn (a plan with no base week draws the same phases as the default).
 */
export function resolveMethod(
  input: EngineInput,
  state: AthleteState,
  weeks?: ReadonlyArray<{ readonly phase: string }>,
): MethodPosition {
  const requested = isPresetId(input.options.method) ? input.options.method : 'default'
  const reads = (reason: MethodReason): MethodPosition => ({
    requested,
    effective: 'default',
    reason,
  })
  if (requested === 'default') return { requested, effective: 'default', reason: null }
  if (!appliesToClass(requested, input.goal.distanceClass)) return reads('not-applicable')
  const hold = persistentHoldOf(input, state)
  if (hold !== null) return reads(`held:${hold}`)
  const overrides = PRESET_OVERRIDES[requested]
  const onlyRunDays =
    overrides.qualityByPhase !== true &&
    Object.keys(overrides).every((id) => id === 'f5.mastersMaxRunDays')
  if (onlyRunDays && state.experience === 'novice') return reads('novice')
  const needsBase =
    overrides['macroDesign.buildWeeks'] !== undefined || overrides.qualityByPhase === true
  if (needsBase && weeks !== undefined && !weeks.some((w) => w.phase === 'base')) {
    return reads('no-base')
  }
  return { requested, effective: requested, reason: null }
}
