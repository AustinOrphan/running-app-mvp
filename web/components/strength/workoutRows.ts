// The rows a surface shows for one strength workout (design 11.1, 11.2): one per lift, one for the
// jumps and one for the trunk movements, at most five. The Today hero and the session sheet both
// read them from here, in the runner's units, so the two say the same words about the same lifts
// (`tests/unit/engine/strengthSurfaces.test.ts` renders this builder and reads the figures back).
// Every sentence is a template of `shared/copy/strengthTemplates.ts`.
import { countPhrase } from '../../../shared/copy/quantity.ts'
import type { Quantity } from '../../../shared/engine/types.ts'
import type { StrengthWorkout, Units, WeightUnit, WorkoutLift } from '../../../shared/types.ts'
import { strengthWords, type StrengthWords } from './strengthText.ts'

/** The most rows a hero shows: three lifts, the jumps and the trunk movements. */
export const WORKOUT_ROWS_MAX = 5

/** One row of a workout. */
export interface WorkoutRow {
  /** Stable within a workout. */
  key: string
  text: string
  /** The exercise of a lift row, so a surface can ask why; null for the jumps and the trunk. */
  exerciseId: string | null
  /** The rule behind the load of a lift row (`F7`, `F8` or `F9`); null for the jumps and the trunk. */
  rule: string | null
}

export interface WorkoutRowOptions {
  /**
   * Show the usual load of a lighter day where a lift has one (the hero's "Use the usual load");
   * the cut in sets stays.
   */
  usual?: boolean
}

const count = (n: number): Quantity => ({ kind: 'count', n })

/** "Side plank", "Side plank and dead bug", "Side plank, dead bug and pallof press". */
function joinNames(names: string[]): string {
  const lowered = names.map((name, index) =>
    index === 0 ? name : `${name.charAt(0).toLowerCase()}${name.slice(1)}`,
  )
  const last = lowered.pop()
  if (last === undefined) return ''
  return lowered.length === 0 ? last : `${lowered.join(', ')} and ${last}`
}

/** The load a row states: the usual load of a lighter day when asked for and there is one. */
function shownLoad(lift: WorkoutLift, usual: boolean): number | null {
  return usual && lift.usualLoadG !== null ? lift.usualLoadG : lift.loadG
}

/**
 * The sentence of one lift. An easy template asks for the same reps left in every set, so a range
 * of one value reads "leave 2 or more"; a lift with no load has no load part, and one with no
 * effort target (not one the engine makes outside the trunk) reads as a trunk row.
 */
function liftRow(words: StrengthWords, lift: WorkoutLift, usual: boolean): string {
  const exercise = words.name(lift.exerciseId)
  const { rir } = lift
  if (rir === null) {
    return words.say('strength.hero.trunk-row', { movements: exercise, sets: count(lift.sets) })
  }
  const base = {
    exercise,
    sets: count(lift.sets),
    lo: count(lift.range.min),
    hi: count(lift.range.max),
  }
  const loadG = shownLoad(lift, usual)
  const easy = rir.min === rir.max
  const efforts: Record<string, Quantity> = easy
    ? { rir: count(rir.min) }
    : { rirLo: count(rir.min), rirHi: count(rir.max) }
  if (loadG === null) {
    return words.say(
      easy
        ? 'strength.hero.workout-row-bodyweight-leave-min'
        : 'strength.hero.workout-row-bodyweight',
      { ...base, ...efforts },
    )
  }
  return words.say(easy ? 'strength.hero.workout-row-leave-min' : 'strength.hero.workout-row', {
    ...base,
    ...efforts,
    load: { kind: 'load', g: loadG },
  })
}

/**
 * The rows of a workout, in the order of the session: the lifts, then the jumps, then the trunk
 * movements as one row. When a workout holds more than `WORKOUT_ROWS_MAX` rows it is the lifts that
 * give way, so the jumps and the trunk work are never left out of what the session asks for.
 */
export function workoutRows(
  workout: StrengthWorkout,
  units: Units,
  weightUnit: WeightUnit,
  options: WorkoutRowOptions = {},
): WorkoutRow[] {
  const words = strengthWords(units, weightUnit)
  const usual = options.usual === true
  const extras = (workout.plyo === null ? 0 : 1) + (workout.trunk.length === 0 ? 0 : 1)
  const rows: WorkoutRow[] = workout.lifts.slice(0, WORKOUT_ROWS_MAX - extras).map((lift) => ({
    key: `lift-${lift.exerciseId}`,
    text: liftRow(words, lift, usual),
    exerciseId: lift.exerciseId,
    rule: lift.basis.rule,
  }))
  const { plyo } = workout
  if (plyo !== null) {
    rows.push({
      key: 'plyo',
      text: words.say('strength.hero.plyo-row', {
        movement: joinNames(plyo.movements.map((id) => words.name(id))),
        contacts: count(plyo.contacts),
      }),
      exerciseId: null,
      rule: null,
    })
  }
  const [firstTrunk] = workout.trunk
  if (firstTrunk !== undefined) {
    rows.push({
      key: 'trunk',
      text: words.say('strength.hero.trunk-row', {
        movements: joinNames(workout.trunk.map((lift) => words.name(lift.exerciseId))),
        sets: count(firstTrunk.sets),
      }),
      exerciseId: null,
      rule: null,
    })
  }
  return rows
}

/** "40 minutes": the planned time of a workout in words, for an accessible name. */
export function minutesPhrase(minutes: number): string {
  return countPhrase(minutes, 'minute')
}
