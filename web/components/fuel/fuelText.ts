// The words of the fuel surfaces, rendered from the templates in `shared/copy/fuelUi.ts` (and the
// ladder's own sentences in `shared/engine/fuelCopy.ts`, which the server sends ready to show).
// A page imports from here and never types a sentence of its own, so the shared G5 lint covers
// every word. None of these sentences holds a distance except the prompt line, which takes the
// runner's units.
import { FUEL_UI_TEMPLATES } from '../../../shared/copy/fuelUi.ts'
import {
  render,
  type SlotSpec,
  type SlotValues,
  type Template,
} from '../../../shared/copy/template.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { Units } from '../../../shared/types.ts'

const T = FUEL_UI_TEMPLATES

const FIXED_UNITS: Units = 'km'

function say<S extends SlotSpec>(
  template: Template<S>,
  slots: SlotValues<S>,
  units: Units = FIXED_UNITS,
): string {
  return render(template, slots, units)
}

const count = (n: number) => ({ kind: 'count', n }) as const

/** The words of the scale, from none up to the top of `h7.gutSymptomScaleMax`. */
const SCALE_WORDS = [
  say(T['fuel.ui.scale-0'], {}),
  say(T['fuel.ui.scale-1'], {}),
  say(T['fuel.ui.scale-2'], {}),
  say(T['fuel.ui.scale-3'], {}),
  say(T['fuel.ui.scale-4'], {}),
]

/** The word for a score, or the number itself when the scale grows past the words written for it. */
export function scaleWord(score: number): string {
  return SCALE_WORDS[score] ?? String(score)
}

/** The scores of the gut and nausea scales, `0` to `h7.gutSymptomScaleMax`. */
export function scaleScores(): number[] {
  return Array.from({ length: P.h7.gutSymptomScaleMax.value + 1 }, (_, score) => score)
}

export const fuelText = {
  logHeading: () => say(T['fuel.ui.log-heading'], {}),
  productsLegend: () => say(T['fuel.ui.products-legend'], {}),
  addOne: (name: string) => say(T['fuel.ui.add-one'], { name }),
  removeOne: (name: string) => say(T['fuel.ui.remove-one'], { name }),
  taken: (servings: number) => say(T['fuel.ui.taken'], { servings: count(servings) }),
  sameAsLast: () => say(T['fuel.ui.same-as-last'], {}),
  noProducts: () => say(T['fuel.ui.no-products'], {}),

  somethingElse: () => say(T['fuel.ui.something-else'], {}),
  foodName: () => say(T['fuel.ui.food-name'], {}),
  foodCarbs: () => say(T['fuel.ui.food-carbs'], {}),
  foodAdd: () => say(T['fuel.ui.food-add'], {}),
  foodInvalid: () => say(T['fuel.ui.food-invalid'], {}),
  foodRow: (servings: number, name: string, carbsG: number) =>
    say(T['fuel.ui.food-row'], { servings: count(servings), name, carbs: count(carbsG) }),
  foodRemove: (name: string) => say(T['fuel.ui.food-remove'], { name }),

  fluidLegend: () => say(T['fuel.ui.fluid-legend'], {}),
  fluidInput: () => say(T['fuel.ui.fluid-input'], {}),
  fluidHint: () => say(T['fuel.ui.fluid-hint'], {}),
  fluidChip: (ml: number) => say(T['fuel.ui.fluid-chip'], { ml: count(ml) }),
  fluidInvalid: () => say(T['fuel.ui.fluid-invalid'], {}),
  fluidLogged: (ml: number) => say(T['fuel.ui.fluid-logged'], { ml: count(ml) }),

  gutLegend: () => say(T['fuel.ui.gut-legend'], {}),
  gutHint: () => say(T['fuel.ui.gut-hint'], {}),
  gutRequired: () => say(T['fuel.ui.gut-required'], {}),
  nauseaLegend: () => say(T['fuel.ui.nausea-legend'], {}),
  nauseaTerm: () => say(T['fuel.ui.nausea-term'], {}),
  scoreValue: (score: number) =>
    say(T['fuel.ui.score-value'], {
      word: scaleWord(score),
      score: count(score),
      max: count(P.h7.gutSymptomScaleMax.value),
    }),

  hot: () => say(T['fuel.ui.hot'], {}),
  hotDay: () => say(T['fuel.ui.hot-day'], {}),
  weatherMissing: () => say(T['fuel.ui.weather-missing'], {}),
  weatherHot: () => say(T['fuel.ui.weather-hot'], {}),

  save: () => say(T['fuel.ui.save'], {}),
  skip: () => say(T['fuel.ui.skip'], {}),
  saved: () => say(T['fuel.ui.saved'], {}),
  savedQueued: () => say(T['fuel.ui.saved-queued'], {}),
  notSaved: (reason: string) => say(T['fuel.ui.not-saved'], { reason }),
  notMarked: (reason: string) => say(T['fuel.ui.not-marked'], { reason }),
  loadError: () => say(T['fuel.ui.load-error'], {}),
  sectionError: () => say(T['fuel.ui.section-error'], {}),

  promptLead: () => say(T['fuel.ui.prompt-lead'], {}),
  /** "Wed 18 Mar, 3 h, 30.0 km" for the run a prompt is about, in the runner's units. */
  promptRun: (
    run: { date: string; durationSec: number; distanceM: number | null },
    units: Units,
  ): string => {
    const date = { kind: 'date', iso: run.date, style: 'weekday' } as const
    const duration = { kind: 'duration', sec: run.durationSec } as const
    return run.distanceM === null
      ? say(T['fuel.ui.prompt-run-time'], { date, duration }, units)
      : say(
          T['fuel.ui.prompt-run'],
          { date, duration, distance: { kind: 'distance', m: run.distanceM } },
          units,
        )
  },
  logFuel: () => say(T['fuel.ui.log-fuel'], {}),
  logFor: (run: string) => say(T['fuel.ui.log-for'], { run }),
  skipFor: (run: string) => say(T['fuel.ui.skip-for'], { run }),

  sectionHeading: () => say(T['fuel.ui.section-heading'], {}),
  tomorrow: (rate: string) => say(T['fuel.ui.tomorrow'], { rate }),

  noneYet: () => say(T['fuel.ui.none-yet'], {}),
  edit: () => say(T['fuel.ui.edit'], {}),
  itemLine: (servings: number, name: string) =>
    say(T['fuel.ui.item-line'], { servings: count(servings), name }),
}
