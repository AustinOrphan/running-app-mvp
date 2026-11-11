// The words of the strength logging sheet, rendered from the templates in
// `shared/copy/strengthTemplates.ts`. The sheet imports from here and never types a sentence of its
// own, so the shared G5 lint covers every word, and a load reads in the runner's weight unit: one
// place makes every sentence of the sheet in the unit it was given.
import { countPhrase } from '../../../shared/copy/quantity.ts'
import { mondayOf } from '../../../shared/dates.ts'
import {
  STRENGTH_TEMPLATES,
  type StrengthTemplateId,
} from '../../../shared/copy/strengthTemplates.ts'
import { render, type Template } from '../../../shared/copy/template.ts'
import { renderFact } from '../../../shared/copy/templates.ts'
import {
  exerciseById,
  implementHold,
  isExerciseId,
  loadMeaning,
  type Measure,
} from '../../../shared/domain/strengthLibrary.ts'
import { fromGrams, toGrams } from '../../../shared/domain/weight.ts'
import type { Quantity } from '../../../shared/engine/types.ts'
import type {
  EquipmentKind,
  StrengthNextLoad,
  StrengthTemplate,
  Units,
  WeightUnit,
  WorkoutLift,
} from '../../../shared/types.ts'

/** The "Next time" lines a save names, so a toast stays a few words (design 9.5). */
const NEXT_LINES_MAX = 3

/** The measure a set of an exercise counts; reps for an exercise the catalogue does not know. */
export function measureOf(exerciseId: string): Measure {
  return exerciseById(exerciseId)?.measure ?? 'reps'
}

/** Whether the catalogue has the exercise done on one side and then the other (the side plank). */
export function isEachSide(exerciseId: string): boolean {
  return exerciseById(exerciseId)?.eachSide === true
}

const count = (n: number): Quantity => ({ kind: 'count', n })
const load = (g: number): Quantity => ({ kind: 'load', g })

/** The implement a lift was done with, by exercise id; null when it is not known. */
export type ImplementOf = (exerciseId: string) => EquipmentKind | null

/** Whether a lift is done holding a pair of dumbbells or kettlebells (its load is each one's). */
export function holdsPair(exerciseId: string, implement: EquipmentKind | null): boolean {
  return isExerciseId(exerciseId) && implementHold(exerciseId, implement) === 'pair'
}

/**
 * A lift's prescribed load as a quantity: the weight of each implement of a pair reads "50 lb each",
 * so a pair's figure is never mistaken for the total; one implement, a barbell and a machine read as
 * they are.
 */
export function liftLoad(exerciseId: string, implement: EquipmentKind | null, g: number): Quantity {
  return holdsPair(exerciseId, implement) ? { kind: 'load', g, each: true } : { kind: 'load', g }
}

/**
 * The words of the sheet in the runner's units. `say` fills one template by id; the rest are the
 * sentences that take more than a template (a suggestion line, a name of a stepper, the loads of
 * "Next time").
 */
export function strengthWords(units: Units, weightUnit: WeightUnit) {
  function say(id: StrengthTemplateId, slots: Record<string, Quantity | string> = {}): string {
    return render(STRENGTH_TEMPLATES[id] as Template, slots as never, units, weightUnit)
  }

  /** The name of an exercise; the id itself for one the catalogue has never held. */
  function name(exerciseId: string): string {
    const exercise = exerciseById(exerciseId)
    return exercise === undefined ? exerciseId : say(exercise.name)
  }

  /** The unit loads are in, in words: "pounds". */
  function unitName(): string {
    return say(weightUnit === 'kg' ? 'strength.unit.kg' : 'strength.unit.lb')
  }

  /** What a stepper changes, in words: "load", "reps", "seconds", "contacts". */
  function measure(m: Measure): string {
    return say(`strength.measure.${m}`)
  }

  /** The unit beside a count where there is little room: "s" for seconds, the word for the rest. */
  function measureShort(m: Measure): string {
    return m === 'seconds' ? say('strength.measure.seconds-short') : measure(m)
  }

  /** The measure of a lift as the sentence says it: "reps", "seconds", "seconds each side". */
  function measureWithSide(lift: WorkoutLift): string {
    const word = measure(measureOf(lift.exerciseId))
    return isEachSide(lift.exerciseId) ? say('strength.row.each-side', { amount: word }) : word
  }

  /** The one-line suggestion of a lift, as design 9.1 words it. */
  function suggestion(lift: WorkoutLift): string {
    const { range, rir } = lift
    const slots: Record<string, Quantity | string> = {
      sets: countPhrase(lift.sets, 'set'),
      amount:
        range.min === range.max
          ? say('strength.sheet.amount-one', { n: count(range.min) })
          : say('strength.sheet.amount-range', { lo: count(range.min), hi: count(range.max) }),
      measure: measureWithSide(lift),
    }
    const carried: Record<string, Quantity | string> =
      lift.loadG === null ? {} : { load: liftLoad(lift.exerciseId, lift.implement, lift.loadG) }
    if (rir === null) {
      return say(
        lift.loadG === null
          ? 'strength.sheet.suggested-plain-bodyweight'
          : 'strength.sheet.suggested-plain',
        { ...slots, ...carried },
      )
    }
    slots['effort'] =
      rir.min === rir.max
        ? say('strength.sheet.effort-min', { n: count(rir.min) })
        : say('strength.sheet.effort-range', { lo: count(rir.min), hi: count(rir.max) })
    return say(
      lift.loadG === null ? 'strength.sheet.suggested-bodyweight' : 'strength.sheet.suggested',
      { ...slots, ...carried },
    )
  }

  /**
   * What a set counts, with its measure where it needs one: "6 to 8" for a lift that has a reps-left
   * target (the reserve says they are reps), "8 to 12 reps" and "30 to 45 seconds" for a movement that
   * has none, and "each side" after it for a movement done on one side and then the other (the
   * catalogue says which). `short` is for the hero's row, which has the room of one line: the range
   * is "30-45", a count of seconds is "s", and neither "reps" nor "each side" is said (the card and
   * the sheet say both).
   */
  function amountText(lift: WorkoutLift, short: boolean): string {
    const { range, rir } = lift
    const ends = { lo: count(range.min), hi: count(range.max) }
    const amount =
      range.min === range.max
        ? say('strength.sheet.amount-one', { n: count(range.min) })
        : say(short ? 'strength.hero.amount-range' : 'strength.sheet.amount-range', ends)
    const counted = measureOf(lift.exerciseId)
    // a lift with a reps-left target is counted in reps, and the reserve says so; the hero's row
    // leaves "reps" out of a trunk movement too, and names a hold's unit because "30" alone is not
    const named =
      counted === 'reps' && (rir !== null || short)
        ? amount
        : say('strength.row.amount-measure', {
            amount,
            measure: short ? measureShort(counted) : measure(counted),
          })
    return isEachSide(lift.exerciseId) && !short
      ? say('strength.row.each-side', { amount: named })
      : named
  }

  /**
   * A trunk movement of a hero row (Today and the session sheet): "Side plank 2x30-45 s" or "Dead
   * bug 2x8-12", with its sets and its amount, written close for the one line the row has.
   */
  function trunkItem(lift: WorkoutLift): string {
    return say('strength.hero.trunk-item', {
      exercise: name(lift.exerciseId),
      sets: count(lift.sets),
      amount: amountText(lift, true),
    })
  }

  /**
   * Trunk movements that share their sets and their amount, as one item of a hero row: "Banded
   * lateral walk and pallof press 2x8-12". `names` is the movements, already joined.
   */
  function trunkSharedItem(names: string, lift: WorkoutLift): string {
    return say('strength.hero.trunk-shared', {
      movements: names,
      sets: count(lift.sets),
      amount: amountText(lift, true),
    })
  }

  /** What the hero's row says of a trunk movement's amount ("30-45 s"): equal text is a shared dose. */
  function trunkAmount(lift: WorkoutLift): string {
    return amountText(lift, true)
  }

  /**
   * A lift as a row of the Strength page: its name, its load as a figure, the muted line under the
   * name ("2 sets of 6 to 8, 3 or more in reserve") and the one sentence of `suggestion`, which a
   * screen reader and the specs read in place of the figures. `reserved` says the line names the
   * reps left, which the page glosses once, under the first row that does.
   */
  function row(lift: WorkoutLift): LiftRowText {
    const { rir } = lift
    const prescription = say(lift.sets === 1 ? 'strength.row.sets-one' : 'strength.row.sets-many', {
      n: count(lift.sets),
      amount: amountText(lift, false),
    })
    const reserve =
      rir === null
        ? null
        : rir.min === rir.max
          ? say('strength.row.reserve-min', { n: count(rir.min) })
          : say('strength.row.reserve-range', { lo: count(rir.min), hi: count(rir.max) })
    return {
      name: name(lift.exerciseId),
      load:
        lift.loadG === null
          ? null
          : say('strength.row.load', {
              load: liftLoad(lift.exerciseId, lift.implement, lift.loadG),
            }),
      line: reserve === null ? prescription : say('strength.row.line', { prescription, reserve }),
      reserved: reserve !== null,
      sentence: suggestion(lift),
    }
  }

  /** The reason of a lift's load: its first fact, as the Why drawer words it; null when it has none. */
  function reason(lift: WorkoutLift): string | null {
    const [fact] = lift.basis.facts
    return fact === undefined ? null : renderFact(fact, units, weightUnit)
  }

  /** The heading of a session: "Strength, heavy A". */
  function heading(template: StrengthTemplate, variant: 'A' | 'B'): string {
    return say('strength.heading', { template: say(`strength.template.${template}`), variant })
  }

  /**
   * Where a log with no planned session starts from (design 9.1): the next planned session, or the
   * session of the week of `date`, named by the template the workout really has (a maintenance
   * week, but also a block week, the taper or a return week). `thisWeek` is whether that week is the
   * server's current one.
   */
  function startLine(
    start: 'next-planned' | 'maintenance',
    template: StrengthTemplate,
    date: string,
    thisWeek: boolean,
  ): string {
    if (start === 'next-planned') return say('strength.sheet.from-next')
    const monday: Quantity = { kind: 'date', iso: mondayOf(date), style: 'short' }
    const name = say(`strength.template.${template}`)
    if (template === 'maintenance') {
      return thisWeek
        ? say('strength.sheet.from-maintenance')
        : say('strength.sheet.from-maintenance-week', { date: monday })
    }
    return thisWeek
      ? say('strength.sheet.from-week', { template: name })
      : say('strength.sheet.from-week-of', { template: name, date: monday })
  }

  /** The accessible name of a stepper or a scale: "Back squat, set 2, load". */
  function stepperGroup(exerciseId: string, set: number, what: string): string {
    return say('strength.sheet.stepper-group', {
      exercise: name(exerciseId),
      set: count(set),
      what,
    })
  }

  /**
   * One lift of "Next time": "Back squat up to 115 lb", and "Dumbbell Romanian deadlift up to 45 lb
   * each" for a pair, which `implementOf` says (the implement of that lift in the log just saved;
   * the next-load payload carries none).
   */
  function nextLine(next: StrengthNextLoad, implementOf: ImplementOf): string {
    const exercise = name(next.exerciseId)
    if (next.change === 'variation') return say('strength.next.variation', { exercise })
    if (next.loadG === null) return say('strength.next.no-load', { exercise })
    const slots = {
      exercise,
      load: liftLoad(next.exerciseId, implementOf(next.exerciseId), next.loadG),
    }
    switch (next.change) {
      case 'increase':
        return say('strength.next.increase', slots)
      case 'hold':
        return say('strength.next.hold', slots)
      case 'reduce':
        return say('strength.next.reduce', slots)
      case 'return':
        return say('strength.next.return', slots)
      case 'start':
        return say('strength.next.start', slots)
      case 'lighter-day':
        return say('strength.next.at', slots)
    }
  }

  /**
   * What the toast of a saved log says: that it is saved, and for the lifts that move first and then
   * the ones that hold, the loads for next time (at most `NEXT_LINES_MAX`).
   */
  function saved(next: readonly StrengthNextLoad[], implementOf: ImplementOf): string {
    const ordered = [
      ...next.filter((item) => item.change !== 'hold'),
      ...next.filter((item) => item.change === 'hold'),
    ].slice(0, NEXT_LINES_MAX)
    if (ordered.length === 0) return say('strength.sheet.saved')
    return say('strength.sheet.saved-next', {
      lines: ordered.map((item) => nextLine(item, implementOf)).join(', '),
    })
  }

  return {
    say,
    weightUnit,
    name,
    unitName,
    measure,
    suggestion,
    reason,
    heading,
    startLine,
    stepperGroup,
    nextLine,
    saved,
    count,
    row,
    trunkItem,
    trunkSharedItem,
    trunkAmount,
    measureShort,
  }
}

export type StrengthWords = ReturnType<typeof strengthWords>

/** The parts of a lift's row on the Strength page (`StrengthWords.row`). */
export interface LiftRowText {
  name: string
  /** The load in the runner's unit; null for a lift with no added load. */
  load: string | null
  /** The prescription and the reps left, one muted line. */
  line: string
  /** Whether `line` names the reps left. */
  reserved: boolean
  /** The whole suggestion as one sentence. */
  sentence: string
}

/**
 * What a load of an exercise done with an implement means (design 5.2), as the line shown beside the
 * field: the total with the bar, the stack or plate total, the weight of each of a pair of
 * dumbbells or kettlebells ("Each dumbbell") or of the one held ("One dumbbell"), the added weight.
 * Null where there is no load to name (bodyweight, a band) and for an exercise the catalogue does not
 * hold. The logging sheet and the setup's starting points both read it here, so the two fields say
 * the same words for the same load.
 */
export function loadMeaningLine(
  words: Pick<StrengthWords, 'say'>,
  exerciseId: string,
  implement: EquipmentKind | null,
): string | null {
  if (!isExerciseId(exerciseId)) return null
  const meaning = loadMeaning(exerciseId, implement)
  if (meaning === 'none') return null
  if (meaning === 'one-implement') {
    const pair = implementHold(exerciseId, implement) === 'pair'
    const kettlebell = implement === 'kettlebells'
    return words.say(
      pair
        ? kettlebell
          ? 'strength.basis.pair-kettlebells'
          : 'strength.basis.pair-dumbbells'
        : kettlebell
          ? 'strength.basis.one-kettlebell'
          : 'strength.basis.one-dumbbell',
    )
  }
  return words.say(`strength.basis.${meaning}`)
}

/**
 * The two implements of a pair together, in the runner's unit ("100 lb in all"), worked out from the
 * figure that is shown for one. Null for one
 * implement, a barbell, a machine, an added weight and a load that is not a positive weight: the
 * load itself stays the weight of one implement and this line is display only.
 */
export function loadTotalLine(
  words: Pick<StrengthWords, 'say' | 'weightUnit'>,
  exerciseId: string,
  implement: EquipmentKind | null,
  loadG: number | null,
): string | null {
  if (loadG === null || !Number.isFinite(loadG) || loadG <= 0) return null
  if (!holdsPair(exerciseId, implement)) return null
  // twice the figure as it is shown ("22.75 kg" each is "45.5 kg"), not twice the stored grams
  // rounded on their own, so the two lines add up for a reader
  const shown = fromGrams(loadG, words.weightUnit)
  // a load too small for the display grid shows as 0, and "0 lb in all" says nothing
  if (shown <= 0) return null
  return words.say('strength.basis.total-in-all', {
    load: load(toGrams(shown * 2, words.weightUnit)),
  })
}
