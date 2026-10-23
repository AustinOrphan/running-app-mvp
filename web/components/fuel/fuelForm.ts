// What the fuel log form holds between taps, and the plain functions that turn it into a request
// and into the draft kept on the device. No React and no requests here, so the rules (what a tap on
// a product does, which items go by id, what a stored draft may hold) are readable on their own.
import { P } from '../../../shared/engine/params/index.ts'
import { FUEL_FLUID_MAX_ML, FUEL_ITEMS_MAX, FUEL_SERVINGS_MAX } from '../../../shared/limits.ts'
import type { FuelLogItem, FuelLogView, FuelProduct } from '../../../shared/types.ts'
import type { FuelItemBody, FuelLogBody } from '../../api/fuel.ts'
import { FUEL_DRAFT_PREFIX } from '../../pwa/drafts.ts'

/** A thing eaten, as the form holds it: a list product or food of the runner's own. */
export interface FormItem {
  /** The list product this is, or null for food that is not on the list. */
  productId: string | null
  name: string
  carbsG: number
  sodiumMg: number | null
  kcal: number | null
  multiCarb: boolean
  servings: number
}

/** What the runner has entered so far; this is also what the kept draft holds. */
export interface FormState {
  items: FormItem[]
  /** The fluid field as typed; empty is none. */
  fluid: string
  gut: number | null
  nausea: number | null
  /** The runner's own answer to "it was hot"; null leaves it to the weather. */
  hot: boolean | null
}

const EMPTY: FormState = { items: [], fluid: '', gut: null, nausea: null, hot: null }

// ---------------------------------------------------------------------------------------------
// From a log or a product, to the form
// ---------------------------------------------------------------------------------------------

export function itemFromSnapshot(item: FuelLogItem): FormItem {
  return {
    productId: item.productId,
    name: item.name,
    carbsG: item.carbsG,
    sodiumMg: item.sodiumMg,
    kcal: item.kcal,
    multiCarb: item.multiCarb,
    servings: item.servings,
  }
}

function itemFromProduct(product: FuelProduct): FormItem {
  return {
    productId: product.id,
    name: product.name,
    carbsG: product.carbsG,
    sodiumMg: product.sodiumMg,
    kcal: product.kcal,
    multiCarb: product.multiCarb,
    servings: 1,
  }
}

/** A saved log as form state; a run with none, or one marked "not this time", starts empty. */
export function stateFromLog(log: FuelLogView | null): FormState {
  if (log === null || log.skipped) return EMPTY
  return {
    items: log.items.map(itemFromSnapshot),
    fluid: log.fluidMl === null ? '' : String(log.fluidMl),
    gut: log.gut,
    nausea: log.nausea,
    hot: log.hot,
  }
}

/** The fluid text of a log, as the field holds it. */
export function fluidText(fluidMl: number | null): string {
  return fluidMl === null ? '' : String(fluidMl)
}

// ---------------------------------------------------------------------------------------------
// What a tap does
// ---------------------------------------------------------------------------------------------

/** One more serving of a list product: a new item the first time, a step up after that. */
export function withOneMore(state: FormState, product: FuelProduct): FormState {
  const index = state.items.findIndex((item) => item.productId === product.id)
  if (index === -1) {
    return state.items.length >= FUEL_ITEMS_MAX
      ? state
      : { ...state, items: [...state.items, itemFromProduct(product)] }
  }
  return {
    ...state,
    items: state.items.map((item, at) =>
      at === index ? { ...item, servings: Math.min(item.servings + 1, FUEL_SERVINGS_MAX) } : item,
    ),
  }
}

/** One serving fewer; the item leaves when none is left. */
export function withOneLess(state: FormState, product: FuelProduct): FormState {
  const index = state.items.findIndex((item) => item.productId === product.id)
  const found = state.items[index]
  if (found === undefined) return state
  return {
    ...state,
    items:
      found.servings <= 1
        ? state.items.filter((_, at) => at !== index)
        : state.items.map((item, at) =>
            at === index ? { ...item, servings: item.servings - 1 } : item,
          ),
  }
}

/** Food that is not on the list, added once. */
export function withFood(state: FormState, food: FormItem): FormState {
  return state.items.length >= FUEL_ITEMS_MAX ? state : { ...state, items: [...state.items, food] }
}

export function withoutItem(state: FormState, item: FormItem): FormState {
  return { ...state, items: state.items.filter((candidate) => candidate !== item) }
}

/** The servings of a list product that are in the form. */
export function servingsOf(state: FormState, productId: string): number {
  return state.items
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + item.servings, 0)
}

/** The fluid field as an amount: null for empty, `'invalid'` for anything but a whole number. */
export function parseFluid(text: string): number | null | 'invalid' {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const ml = Number(trimmed)
  return Number.isInteger(ml) && ml >= 0 && ml <= FUEL_FLUID_MAX_ML ? ml : 'invalid'
}

// ---------------------------------------------------------------------------------------------
// From the form, to a request
// ---------------------------------------------------------------------------------------------

/** True when the form's item still says what the list product says now. */
function sameAsProduct(item: FormItem, product: FuelProduct): boolean {
  return (
    item.name === product.name &&
    item.carbsG === product.carbsG &&
    item.sodiumMg === product.sodiumMg &&
    item.kcal === product.kcal &&
    item.multiCarb === product.multiCarb
  )
}

/**
 * The request for the state. A product that is still on the list, and that the item still matches,
 * goes by its id: the server copies the product's amounts, which are the ones on screen. Anything
 * else goes with the amounts the form holds: food of the runner's own, a product archived since,
 * and an item whose product was edited after the log (or the run it is repeated from) was saved.
 * The server copies a product's amounts at every save, so sending that item by id would replace
 * what was eaten with what the product says today, and the total on screen would not be the total
 * saved. `kept` is what the form has no field for and must not lose when it replaces a log: the
 * sodium and the notes the log already had.
 */
export function toBody(
  state: FormState,
  gut: number,
  fluidMl: number | null,
  live: ReadonlyMap<string, FuelProduct>,
  kept: { sodiumMg: number | null; notes: string | null },
): FuelLogBody {
  const items: FuelItemBody[] = state.items.map((item) => {
    const product = item.productId === null ? undefined : live.get(item.productId)
    return product !== undefined && sameAsProduct(item, product)
      ? { productId: product.id, servings: item.servings }
      : {
          name: item.name,
          carbsG: item.carbsG,
          sodiumMg: item.sodiumMg,
          kcal: item.kcal,
          multiCarb: item.multiCarb,
          servings: item.servings,
        }
  })
  return {
    items,
    fluidMl,
    sodiumMg: kept.sodiumMg,
    gut,
    nausea: state.nausea,
    hot: state.hot,
    notes: kept.notes,
  }
}

// ---------------------------------------------------------------------------------------------
// The kept draft: a half-filled form survives a dropped connection (design 10.6)
// ---------------------------------------------------------------------------------------------

function draftKey(activityId: string): string {
  return `${FUEL_DRAFT_PREFIX}${activityId}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNumberOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value))

function parseItem(value: unknown): FormItem | null {
  if (!isRecord(value)) return null
  const { productId, name, carbsG, sodiumMg, kcal, multiCarb, servings } = value
  if (
    (productId !== null && typeof productId !== 'string') ||
    typeof name !== 'string' ||
    typeof carbsG !== 'number' ||
    !Number.isFinite(carbsG) ||
    !isNumberOrNull(sodiumMg) ||
    !isNumberOrNull(kcal) ||
    typeof multiCarb !== 'boolean' ||
    typeof servings !== 'number' ||
    !(servings > 0 && servings <= FUEL_SERVINGS_MAX)
  ) {
    return null
  }
  return { productId, name, carbsG, sodiumMg, kcal, multiCarb, servings }
}

function parseScore(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= P.h7.gutSymptomScaleMax.value
    ? value
    : null
}

/** A draft from storage, or null when it is not one this form wrote. */
function parseDraft(value: unknown): FormState | null {
  if (!isRecord(value) || !Array.isArray(value['items']) || typeof value['fluid'] !== 'string') {
    return null
  }
  const items = value['items'].map(parseItem)
  return {
    items: items.filter((item): item is FormItem => item !== null),
    fluid: value['fluid'],
    gut: parseScore(value['gut']),
    nausea: parseScore(value['nausea']),
    hot: typeof value['hot'] === 'boolean' ? value['hot'] : null,
  }
}

/** Storage can be blocked or full (a private window); the form then simply keeps no draft. */
export function readDraft(activityId: string): FormState | null {
  try {
    const text = window.localStorage.getItem(draftKey(activityId))
    return text === null ? null : parseDraft(JSON.parse(text))
  } catch {
    return null
  }
}

export function writeDraft(activityId: string, state: FormState): void {
  try {
    window.localStorage.setItem(draftKey(activityId), JSON.stringify(state))
  } catch {
    // Blocked or full: the entries stay in the form, and only the safety copy is lost.
  }
}

export function clearDraft(activityId: string): void {
  try {
    window.localStorage.removeItem(draftKey(activityId))
  } catch {
    // Nothing was kept, or storage is blocked.
  }
}
