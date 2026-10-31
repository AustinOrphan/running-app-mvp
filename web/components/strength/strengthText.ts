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
  isExerciseId,
  loadMeaning,
  type Measure,
} from '../../../shared/domain/strengthLibrary.ts'
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

const count = (n: number): Quantity => ({ kind: 'count', n })
const load = (g: number): Quantity => ({ kind: 'load', g })

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

  /** The one-line suggestion of a lift, as design 9.1 words it. */
  function suggestion(lift: WorkoutLift): string {
    const { range, rir } = lift
    const slots: Record<string, Quantity | string> = {
      sets: countPhrase(lift.sets, 'set'),
      amount:
        range.min === range.max
          ? say('strength.sheet.amount-one', { n: count(range.min) })
          : say('strength.sheet.amount-range', { lo: count(range.min), hi: count(range.max) }),
      measure: measure(measureOf(lift.exerciseId)),
    }
    const carried: Record<string, Quantity | string> =
      lift.loadG === null ? {} : { load: load(lift.loadG) }
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

  /** One lift of "Next time": "Back squat up to 115 lb". */
  function nextLine(next: StrengthNextLoad): string {
    const exercise = name(next.exerciseId)
    if (next.change === 'variation') return say('strength.next.variation', { exercise })
    if (next.loadG === null) return say('strength.next.no-load', { exercise })
    const slots = { exercise, load: load(next.loadG) }
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
  function saved(next: readonly StrengthNextLoad[]): string {
    const ordered = [
      ...next.filter((item) => item.change !== 'hold'),
      ...next.filter((item) => item.change === 'hold'),
    ].slice(0, NEXT_LINES_MAX)
    if (ordered.length === 0) return say('strength.sheet.saved')
    return say('strength.sheet.saved-next', { lines: ordered.map(nextLine).join(', ') })
  }

  return {
    say,
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
  }
}

export type StrengthWords = ReturnType<typeof strengthWords>

/**
 * What a load of an exercise done with an implement means (design 5.2), as the line shown beside the
 * field: the total with the bar, the stack or plate total, the weight of one implement, the added
 * weight. Null where there is no load to name (bodyweight, a band) and for an exercise the catalogue
 * does not hold. The logging sheet and the setup's starting points both read it here, so the two
 * fields say the same words for the same load.
 */
export function loadMeaningLine(
  words: StrengthWords,
  exerciseId: string,
  implement: EquipmentKind | null,
): string | null {
  if (!isExerciseId(exerciseId)) return null
  const meaning = loadMeaning(exerciseId, implement)
  return meaning === 'none' ? null : words.say(`strength.basis.${meaning}`)
}
