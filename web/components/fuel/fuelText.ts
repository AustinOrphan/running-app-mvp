// The words of the fuel surfaces, rendered from the templates in `shared/copy/fuelUi.ts` (and the
// ladder's own sentences in `shared/engine/fuelCopy.ts`, which the server sends ready to show).
// A page imports from here and never types a sentence of its own, so the shared G5 lint covers
// every word. None of these sentences holds a distance except the prompt line, which takes the
// runner's units.
import { FUEL_UI_TEMPLATES, type FuelUiTemplateId } from '../../../shared/copy/fuelUi.ts'
import { formatQuantity } from '../../../shared/copy/quantity.ts'
import {
  render,
  type SlotSpec,
  type SlotValues,
  type Template,
} from '../../../shared/copy/template.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { FuelProductKind, Units } from '../../../shared/types.ts'

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

/** The template of each kind of product in the pick list. */
const KIND_TEMPLATES = {
  gel: 'fuel.lab.kind-gel',
  drink: 'fuel.lab.kind-drink',
  chew: 'fuel.lab.kind-chew',
  bar: 'fuel.lab.kind-bar',
  food: 'fuel.lab.kind-food',
  electrolyte: 'fuel.lab.kind-electrolyte',
  other: 'fuel.lab.kind-other',
} as const satisfies Record<FuelProductKind, FuelUiTemplateId>

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

const date = (iso: string, style: 'short' | 'weekday' | 'long' = 'weekday') =>
  ({ kind: 'date', iso, style }) as const
const duration = (sec: number) => ({ kind: 'duration', sec }) as const

/**
 * The words of the Fuel lab page. The figures that restate a rule (the length of a run that can be
 * logged, the tiers a switch opens, the shortest run of a gut-training week) are read from the
 * registry here; every other figure arrives in the payload.
 */
export const labText = {
  title: () => say(T['fuel.lab.title'], {}),
  context: () => say(T['fuel.lab.context'], {}),
  loadError: () => say(T['fuel.lab.load-error'], {}),

  targetHeading: () => say(T['fuel.lab.target-heading'], {}),
  /** "Long run, Wed 18 Mar, 2 h 30 min": the planned run a target belongs to. */
  targetRun: (session: { title: string; date: string; durationMin: number }) =>
    say(T['fuel.lab.target-run'], {
      title: session.title,
      date: date(session.date),
      duration: duration(session.durationMin * 60),
    }),
  targetEmpty: () =>
    say(T['fuel.lab.target-empty'], { duration: duration(P.h7.logMinDurationMin.value * 60) }),

  ladderHeading: () => say(T['fuel.lab.ladder-heading'], {}),
  ladderIntro: () => say(T['fuel.lab.ladder-intro'], {}),
  ladderLabel: () => say(T['fuel.lab.ladder-label'], {}),
  lowCertainty: () => say(T['fuel.lab.low-certainty'], {}),

  historyHeading: () => say(T['fuel.lab.history-heading'], {}),
  historyLabel: () => say(T['fuel.lab.history-label'], {}),
  historyEmpty: () => say(T['fuel.lab.history-empty'], {}),
  historyNote: () => say(T['fuel.lab.history-note'], {}),
  colRun: () => say(T['fuel.lab.col-run'], {}),
  colRate: () => say(T['fuel.lab.col-rate'], {}),
  colTarget: () => say(T['fuel.lab.col-target'], {}),
  colResult: () => say(T['fuel.lab.col-result'], {}),
  runDate: (iso: string) => formatQuantity(date(iso), FIXED_UNITS),
  rateCell: (gPerH: number) => say(T['fuel.lab.rate-cell'], { rate: count(Math.round(gPerH)) }),
  notRecorded: () => say(T['fuel.lab.not-recorded'], {}),
  notAnswered: () => say(T['fuel.lab.not-answered'], {}),

  productsHeading: () => say(T['fuel.lab.products-heading'], {}),
  productsLead: () => say(T['fuel.lab.products-lead'], {}),
  productsEmpty: () => say(T['fuel.lab.products-empty'], {}),
  productAmounts: (product: { servingLabel: string; carbsG: number; sodiumMg: number | null }) =>
    product.sodiumMg === null
      ? say(T['fuel.lab.product-amounts'], {
          serving: product.servingLabel,
          carbs: count(product.carbsG),
        })
      : say(T['fuel.lab.product-amounts-sodium'], {
          serving: product.servingLabel,
          carbs: count(product.carbsG),
          sodium: count(product.sodiumMg),
        }),
  multiCarbTag: () => say(T['fuel.lab.multi-carb-tag'], {}),
  addProduct: () => say(T['fuel.lab.add-product'], {}),
  edit: () => say(T['fuel.lab.edit'], {}),
  editProduct: (name: string) => say(T['fuel.lab.edit-product'], { name }),
  archive: () => say(T['fuel.lab.archive'], {}),
  archiveProduct: (name: string) => say(T['fuel.lab.archive-product'], { name }),
  archived: (name: string) => say(T['fuel.lab.archived'], { name }),
  archiveFailed: (reason: string) => say(T['fuel.lab.archive-failed'], { reason }),
  productName: () => say(T['fuel.lab.product-name'], {}),
  productKind: () => say(T['fuel.lab.product-kind'], {}),
  productServing: () => say(T['fuel.lab.product-serving'], {}),
  productServingHint: () => say(T['fuel.lab.product-serving-hint'], {}),
  productCarbs: () => say(T['fuel.lab.product-carbs'], {}),
  productSodium: () => say(T['fuel.lab.product-sodium'], {}),
  productKcal: () => say(T['fuel.lab.product-kcal'], {}),
  productMulti: () => say(T['fuel.lab.product-multi'], {}),
  productSave: () => say(T['fuel.lab.product-save'], {}),
  productCancel: () => say(T['fuel.lab.product-cancel'], {}),
  productSaved: () => say(T['fuel.lab.product-saved'], {}),
  productNameRequired: () => say(T['fuel.lab.product-name-required'], {}),
  productServingRequired: () => say(T['fuel.lab.product-serving-required'], {}),
  productCarbsInvalid: () => say(T['fuel.lab.product-carbs-invalid'], {}),
  productNumberInvalid: () => say(T['fuel.lab.product-number-invalid'], {}),
  productNotSaved: (reason: string) => say(T['fuel.lab.product-not-saved'], { reason }),
  /** The label of a product kind in the pick list. */
  kind: (kind: FuelProductKind) => say(T[KIND_TEMPLATES[kind]], {}),

  blockHeading: () => say(T['fuel.lab.block-heading'], {}),
  blockPlanned: (from: string, to: string) =>
    say(T['fuel.lab.block-planned'], { from: date(from), to: date(to) }),
  blockWeek: (monday: string) => say(T['fuel.lab.block-week'], { date: date(monday) }),
  blockCounts: () =>
    say(T['fuel.lab.block-counts'], {
      duration: duration(P.h7.gutTrainingSessionMinMin.value * 60),
    }),
  blockNone: () => say(T['fuel.lab.block-none'], {}),
  blockOff: () => say(T['fuel.lab.block-off'], {}),
  blockLocked: () => say(T['fuel.lab.block-locked'], {}),
  blockRemoval: () => say(T['fuel.lab.block-removal'], {}),

  settingsHeading: () => say(T['fuel.lab.settings-heading'], {}),
  settingsLegend: () => say(T['fuel.lab.settings-legend'], {}),
  /** The first opt-in opens the rungs above the first higher tier, up to the second. */
  opt90: () =>
    say(T['fuel.lab.opt-90'], {
      from: count(P.h7.carbTier1GPerH.value),
      to: count(P.h7.carbTier2GPerH.value),
    }),
  /** The second opens the rungs above the second tier, up to the top of the advanced range. */
  optAdvanced: () =>
    say(T['fuel.lab.opt-advanced'], {
      from: count(P.h7.carbTier2GPerH.value),
      to: count(P.h7.carbAdvancedGPerH.value[1]),
    }),
  optHint: () => say(T['fuel.lab.opt-hint'], {}),
  giDisease: () => say(T['fuel.lab.gi-disease'], {}),
  giHint: () => say(T['fuel.lab.gi-hint'], {}),
  gutBlock: () => say(T['fuel.lab.gut-block'], {}),
  settingsNote: () => say(T['fuel.lab.settings-note'], {}),
  settingsSave: () => say(T['fuel.lab.settings-save'], {}),
  settingsSaved: () => say(T['fuel.lab.settings-saved'], {}),
  /** The other switches were saved and the highest tier was left off, as the server refused it. */
  settingsSavedWithoutHighest: () =>
    say(T['fuel.lab.settings-saved-partial'], { rate: count(P.h7.carbTier2GPerH.value) }),
  settingsNotSaved: (reason: string) => say(T['fuel.lab.settings-not-saved'], { reason }),
}
