// The catalogue of strength exercises (strength design 7, ADR 0014): 25 movements, each with the
// slot it fills, the equipment it can be done with, what else it needs, how it is counted, what a
// load means for it, the next harder movement and the rules it serves. The catalogue is closed:
// a runner cannot add a lift (decided 2026-10-24, strength design section 18, question 11), because selection,
// stepping, swapping and explaining all read this metadata, and a lift typed as text has none.
//
// The catalogue is content. It holds no engine number: reps, sets, contacts, efforts and starting
// fractions are Params (`f7`, `f8`, `flib`), so the numbers are graded and this file has no numeric
// literal. A test scans for one.
//
// An id is never renamed or reused, because logs store it. An exercise that leaves the catalogue
// stays in it, marked `retired`, so a history still renders (`exerciseById`) and the ladders and
// the feasibility test skip it.
import type { StrengthTemplateId } from '../copy/strengthTemplates.ts'
import type { EquipmentConfig, EquipmentKind, Slot } from '../types.ts'

export type ExerciseId =
  | 'back-squat'
  | 'leg-press'
  | 'goblet-squat'
  | 'split-squat'
  | 'step-up'
  | 'tempo-squat'
  | 'single-leg-box-squat'
  | 'romanian-deadlift'
  | 'dumbbell-rdl'
  | 'kettlebell-rdl'
  | 'leg-curl'
  | 'hip-thrust'
  | 'single-leg-rdl'
  | 'standing-calf-raise'
  | 'seated-calf-raise'
  | 'single-leg-calf-raise'
  | 'pogo-hop'
  | 'line-hop'
  | 'squat-jump'
  | 'single-leg-hop'
  | 'side-plank'
  | 'dead-bug'
  | 'banded-lateral-walk'
  | 'pallof-press'
  | 'farmer-carry'

/** What a set counts: repetitions, seconds held or ground contacts. */
export type Measure = 'reps' | 'seconds' | 'contacts'

/**
 * The rules an exercise is there for (design 7.1): `F-lib` the session-library rows, `F7` the
 * structure rule, `H10` knee-extensor and plantar-flexor work and the plyometric emphasis, `H5` the
 * slow lowering as the eccentric emphasis, `m-age` calf, Achilles and posterior-chain work from
 * age 40.
 */
export type RuleTag = 'F-lib' | 'F7' | 'H10' | 'H5' | 'm-age'

/**
 * What the load of an exercise means, the column of design 7.1. Where it depends on the implement
 * (`total-or-one-implement`, `by-implement`) `loadMeaning` resolves it.
 */
export type LoadBasis =
  | 'total-with-bar'
  | 'stack'
  | 'one-implement'
  | 'one-implement-a-hand'
  | 'total-or-one-implement'
  | 'by-implement'
  | 'added'
  | 'bodyweight'
  | 'band'

/**
 * What a load is once the implement is known (design 5.2), shown beside the field. `none` is a
 * movement with nothing to track: bodyweight, a band, or a bodyweight movement with nothing added.
 */
export type LoadMeaning = 'total-with-bar' | 'stack' | 'one-implement' | 'added' | 'none'

export interface Exercise {
  /** Never renamed or reused: logs store it. */
  id: ExerciseId
  slot: Slot
  /** The template of the exercise's name. */
  name: StrengthTemplateId
  /** How it is done: one or two sentences, no number. */
  cue: StrengthTemplateId
  /** Where a tempo or an effort matters. */
  note: StrengthTemplateId
  /**
   * The equipment it can be done with, any one of, best first. The first present in the saved
   * equipment is the implement of the load.
   */
  implements: readonly EquipmentKind[]
  /** Whether it can be done with no equipment at all (the "none" of the table). */
  bodyweight: boolean
  /** Equipment it needs in addition to an implement. */
  needs: readonly EquipmentKind[]
  /** Equipment that makes it easier or safer but is not required (a step for a hip thrust). */
  optionalNeeds: readonly EquipmentKind[]
  measure: Measure
  basis: LoadBasis
  /** The next harder movement, reached by progression, a swap or a pin and not by the ladder. */
  harder: ExerciseId | null
  serves: readonly RuleTag[]
  /** Left the catalogue: kept so a history renders, skipped by the ladders. */
  retired?: true
}

type ExerciseSpec = Omit<Exercise, 'id' | 'name' | 'cue'>

const LIFT: readonly RuleTag[] = ['F-lib', 'F7', 'H10', 'H5']
const HINGE: readonly RuleTag[] = ['F-lib', 'F7', 'H5', 'm-age']
const POSTERIOR: readonly RuleTag[] = ['F-lib', 'F7', 'm-age']
const CALF: readonly RuleTag[] = ['F-lib', 'F7', 'H10', 'm-age']
const JUMP: readonly RuleTag[] = ['F-lib', 'F7', 'H10']
const TRUNK: readonly RuleTag[] = ['F-lib', 'F7']

/** The catalogue in the order of design 7.1. The key is the id. */
const SPECS: Readonly<Record<ExerciseId, ExerciseSpec>> = {
  'back-squat': {
    slot: 'knee',
    note: 'strength.note.lower-stand',
    implements: ['barbell'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'total-with-bar',
    harder: null,
    serves: LIFT,
  },
  'leg-press': {
    slot: 'knee',
    note: 'strength.note.lower-return',
    implements: ['leg-press'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'stack',
    harder: null,
    serves: LIFT,
  },
  'goblet-squat': {
    slot: 'knee',
    note: 'strength.note.lower-stand',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'one-implement',
    harder: 'split-squat',
    serves: LIFT,
  },
  'split-squat': {
    slot: 'knee',
    note: 'strength.note.lower-stand',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: true,
    needs: [],
    optionalNeeds: ['step'],
    measure: 'reps',
    basis: 'one-implement-a-hand',
    harder: 'step-up',
    serves: LIFT,
  },
  'step-up': {
    slot: 'knee',
    note: 'strength.note.lower-stand',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: true,
    needs: ['step'],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'one-implement-a-hand',
    harder: 'single-leg-box-squat',
    serves: LIFT,
  },
  'tempo-squat': {
    slot: 'knee',
    note: 'strength.note.lower-stand',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'bodyweight',
    harder: 'split-squat',
    serves: LIFT,
  },
  'single-leg-box-squat': {
    slot: 'knee',
    note: 'strength.note.lower-stand',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: true,
    needs: ['step'],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'added',
    harder: null,
    serves: LIFT,
  },
  'romanian-deadlift': {
    slot: 'hip',
    note: 'strength.note.lower-stand',
    implements: ['barbell'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'total-with-bar',
    harder: null,
    serves: HINGE,
  },
  'dumbbell-rdl': {
    slot: 'hip',
    note: 'strength.note.lower-stand',
    implements: ['dumbbells'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'one-implement-a-hand',
    harder: 'single-leg-rdl',
    serves: HINGE,
  },
  'kettlebell-rdl': {
    slot: 'hip',
    note: 'strength.note.lower-stand',
    implements: ['kettlebells'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'one-implement',
    harder: 'single-leg-rdl',
    serves: HINGE,
  },
  'leg-curl': {
    slot: 'hip',
    note: 'strength.note.lower-return',
    implements: ['leg-curl'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'stack',
    harder: null,
    serves: POSTERIOR,
  },
  'hip-thrust': {
    slot: 'hip',
    note: 'strength.note.controlled',
    implements: ['barbell', 'dumbbells'],
    bodyweight: true,
    needs: [],
    optionalNeeds: ['step'],
    measure: 'reps',
    basis: 'total-or-one-implement',
    harder: 'single-leg-rdl',
    serves: POSTERIOR,
  },
  'single-leg-rdl': {
    slot: 'hip',
    note: 'strength.note.lower-stand',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'one-implement',
    harder: null,
    serves: HINGE,
  },
  'standing-calf-raise': {
    slot: 'calf',
    note: 'strength.note.calf',
    implements: ['calf-machine', 'barbell', 'dumbbells'],
    bodyweight: true,
    needs: [],
    optionalNeeds: ['step'],
    measure: 'reps',
    basis: 'by-implement',
    harder: 'single-leg-calf-raise',
    serves: CALF,
  },
  'seated-calf-raise': {
    slot: 'calf',
    note: 'strength.note.calf',
    implements: ['calf-machine', 'dumbbells'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'by-implement',
    harder: 'single-leg-calf-raise',
    serves: CALF,
  },
  'single-leg-calf-raise': {
    slot: 'calf',
    note: 'strength.note.calf',
    implements: ['dumbbells'],
    bodyweight: true,
    needs: ['step'],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'added',
    harder: null,
    serves: CALF,
  },
  'pogo-hop': {
    slot: 'plyo',
    note: 'strength.note.plyo',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'contacts',
    basis: 'bodyweight',
    harder: 'line-hop',
    serves: JUMP,
  },
  'line-hop': {
    slot: 'plyo',
    note: 'strength.note.plyo',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'contacts',
    basis: 'bodyweight',
    harder: 'squat-jump',
    serves: JUMP,
  },
  'squat-jump': {
    slot: 'plyo',
    note: 'strength.note.plyo',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'contacts',
    basis: 'bodyweight',
    harder: 'single-leg-hop',
    serves: JUMP,
  },
  'single-leg-hop': {
    slot: 'plyo',
    note: 'strength.note.plyo',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'contacts',
    basis: 'bodyweight',
    harder: null,
    serves: JUMP,
  },
  'side-plank': {
    slot: 'trunk',
    note: 'strength.note.controlled',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'seconds',
    basis: 'bodyweight',
    harder: null,
    serves: TRUNK,
  },
  'dead-bug': {
    slot: 'trunk',
    note: 'strength.note.controlled',
    implements: [],
    bodyweight: true,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'bodyweight',
    harder: null,
    serves: TRUNK,
  },
  'banded-lateral-walk': {
    slot: 'trunk',
    note: 'strength.note.controlled',
    implements: ['bands'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'band',
    harder: null,
    serves: TRUNK,
  },
  'pallof-press': {
    slot: 'trunk',
    note: 'strength.note.controlled',
    implements: ['bands'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'reps',
    basis: 'band',
    harder: null,
    serves: TRUNK,
  },
  'farmer-carry': {
    slot: 'trunk',
    note: 'strength.note.controlled',
    implements: ['dumbbells', 'kettlebells'],
    bodyweight: false,
    needs: [],
    optionalNeeds: [],
    measure: 'seconds',
    basis: 'one-implement-a-hand',
    harder: null,
    serves: TRUNK,
  },
}

/** The 25 exercises in the order of design 7.1. The name and cue templates are keyed by the id. */
export const EXERCISES: readonly Exercise[] = (Object.keys(SPECS) as ExerciseId[]).map((id) => ({
  id,
  name: `strength.name.${id}`,
  cue: `strength.cue.${id}`,
  ...SPECS[id],
}))

const BY_ID: ReadonlyMap<string, Exercise> = new Map(
  EXERCISES.map((exercise) => [exercise.id, exercise]),
)

/** Whether `id` is an exercise of the catalogue, retired ones included. */
export function isExerciseId(id: string): id is ExerciseId {
  return BY_ID.has(id)
}

/** The exercise with this id, or undefined for an id the catalogue has never held. */
export function exerciseById(id: string): Exercise | undefined {
  return BY_ID.get(id)
}

/** The exercises of a slot, in catalogue order. */
export function exercisesOfSlot(slot: Slot): Exercise[] {
  return EXERCISES.filter((exercise) => exercise.slot === slot)
}

// ---- Ladders (design 7.2) ---------------------------------------------------------------------

/** The slots that have a ladder: the three lifts. */
export type LadderSlot = 'knee' | 'hip' | 'calf'

/** Each slot's exercises, best supported first. The harder movements are not on a ladder. */
export const SLOT_LADDERS: Readonly<Record<LadderSlot, readonly ExerciseId[]>> = {
  knee: ['back-squat', 'leg-press', 'goblet-squat', 'tempo-squat'],
  hip: ['romanian-deadlift', 'dumbbell-rdl', 'kettlebell-rdl', 'leg-curl', 'hip-thrust'],
  calf: ['standing-calf-raise', 'seated-calf-raise', 'single-leg-calf-raise'],
}

/**
 * The exercise of each ladder that needs no equipment, so every slot has an answer: the squat to
 * a pace, a glute bridge on the floor, a calf raise on the floor.
 */
export const FLOOR_EXERCISE: Readonly<Record<LadderSlot, ExerciseId>> = {
  knee: 'tempo-squat',
  hip: 'hip-thrust',
  calf: 'standing-calf-raise',
}

/** The four movements of the plyometric ladder, low-amplitude and on the spot (design 7.1, 8.2). */
export const PLYO_LADDER: readonly ExerciseId[] = [
  'pogo-hop',
  'line-hop',
  'squat-jump',
  'single-leg-hop',
]

/** The ladder of a slot, or an empty list for the slots that choose by other rules. */
export function ladderFor(slot: Slot): readonly ExerciseId[] {
  switch (slot) {
    case 'knee':
    case 'hip':
    case 'calf':
      return SLOT_LADDERS[slot]
    case 'plyo':
    case 'trunk':
      return []
  }
}

// ---- Feasibility and substitutes (design 7.2, 7.3) --------------------------------------------

export interface FeasibilityOptions {
  /**
   * False leaves the barbell out as an implement: the ramp-in and return templates use no barbell
   * lift, whatever the lifting level (design 7.2, decided 2026-10-24, section 18, question 7). Default true.
   */
  barbell?: boolean
}

/**
 * The ways an exercise can be done with the saved equipment, best first: each implement of the
 * exercise that the equipment has, then `null` for the bodyweight form when the exercise has one.
 * Empty when it cannot be done: a required piece (a step) is missing, or it needs an implement
 * that is not there. A piece of equipment counts as present when its item is in the list; whether
 * it makes any load is the setup's validation, and `stepsFor` (weight.ts) returns null for none.
 */
export function usableImplements(
  id: ExerciseId,
  equipment: readonly EquipmentConfig[],
  options: FeasibilityOptions = {},
): Array<EquipmentKind | null> {
  const exercise = BY_ID.get(id)
  if (exercise === undefined || exercise.retired === true) return []
  const present = new Set<EquipmentKind>(equipment.map((item) => item.kind))
  if (!exercise.needs.every((kind) => present.has(kind))) return []
  const barbell = options.barbell ?? true
  const usable: Array<EquipmentKind | null> = exercise.implements.filter(
    (kind) => present.has(kind) && (barbell || kind !== 'barbell'),
  )
  return exercise.bodyweight ? [...usable, null] : usable
}

/**
 * Whether the exercise can be done: its implement is in the saved equipment or it needs none, and
 * anything else it needs is there. Bodyweight is always available, so the floor exercise of each
 * ladder is feasible with an empty list. A retired exercise is never feasible.
 */
export function isFeasible(
  id: ExerciseId,
  equipment: readonly EquipmentConfig[],
  options: FeasibilityOptions = {},
): boolean {
  const [best] = usableImplements(id, equipment, options)
  // the bodyweight form is `null`, which is a way to do it; only an empty list has no best
  return best !== undefined
}

/**
 * What the "Swap" list and the "Always use this" pin offer for an exercise: the feasible entries of
 * the slot's ladder, in ladder order, then the feasible exercises of the slot that are not on the
 * ladder (the harder movements: a split squat, a step-up, a single-leg box squat, a single-leg
 * Romanian deadlift), in catalogue order, without the exercise itself. Design 7.2 says the harder
 * movements are reached by their links and by a swap or a pin and not by the ladder, so a swap has
 * to be able to name them. The plyometric and trunk slots have no ladder and give an empty list.
 */
export function substitutes(
  id: ExerciseId,
  equipment: readonly EquipmentConfig[],
  options: FeasibilityOptions = {},
): ExerciseId[] {
  const exercise = BY_ID.get(id)
  if (exercise === undefined) return []
  const ladder = ladderFor(exercise.slot)
  const [lead] = ladder
  if (lead === undefined) return []
  const harder = exercisesOfSlot(exercise.slot)
    .map((other) => other.id)
    .filter((other) => !ladder.includes(other))
  return [...ladder, ...harder].filter(
    (other) => other !== id && isFeasible(other, equipment, options),
  )
}

// ---- What a load means ------------------------------------------------------------------------

/**
 * What the load of an exercise done with `implement` is (design 5.2): the total with the bar for a
 * barbell, the stack or plate total for a machine, the weight of one dumbbell or kettlebell, or
 * the added weight on a bodyweight movement. `none` for a band, for bodyweight and for a bodyweight
 * movement with nothing added: its load is null.
 */
export function loadMeaning(id: ExerciseId, implement: EquipmentKind | null): LoadMeaning {
  const exercise = BY_ID.get(id)
  if (exercise === undefined || implement === null) return 'none'
  if (exercise.basis === 'bodyweight' || exercise.basis === 'band') return 'none'
  switch (implement) {
    case 'barbell':
      return 'total-with-bar'
    case 'leg-press':
    case 'calf-machine':
    case 'leg-curl':
      return 'stack'
    case 'dumbbells':
    case 'kettlebells':
      return exercise.basis === 'added' ? 'added' : 'one-implement'
    case 'bands':
    case 'step':
      return 'none'
  }
}
