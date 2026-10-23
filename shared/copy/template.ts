// Typed templates: a sentence with named slots, each slot declared as a kind of quantity (or free
// text). `tpl` builds one, `render` fills it. The registry of the app's own templates, and
// `renderFact` for stored facts, are in `templates.ts`.
//
// Failure rule: a missing or mistyped slot throws under test and renders the template's fallback
// everywhere else, so a page never shows "undefined" or "NaN".
import type { Quantity } from '../engine/types.ts'
import type { Units } from '../types.ts'
import { formatQuantity, quantityIssue } from './quantity.ts'

/** What a slot holds: one kind of `Quantity`, or `text` for words that are not numbers. */
export type SlotKind = Quantity['kind'] | 'text'
export type SlotSpec = Readonly<Record<string, SlotKind>>

/** The value a slot of kind `K` takes. */
export type SlotValue<K extends SlotKind> = K extends 'text'
  ? string
  : Extract<Quantity, { kind: K }>

/** The values `render` needs for a template with slots `S`; a template with no slots takes none. */
export type SlotValues<S extends SlotSpec> = [keyof S] extends [never]
  ? Readonly<Record<string, never>>
  : { readonly [N in keyof S]: SlotValue<S[N]> }

/**
 * `sentence`: ends with a full stop (or a question mark) and is at most `COPY_MAX_CHARS` long.
 * `label`: a heading, button or toast that is not a sentence ("Run saved"); the lint skips the stop.
 */
export type TemplateShape = 'sentence' | 'label'

export interface Template<S extends SlotSpec = SlotSpec> {
  /** Words with `{name}` placeholders. */
  readonly text: string
  readonly slots: S
  /** Rendered instead of `text` when a slot cannot be shown. Has no placeholders. */
  readonly fallback: string
  readonly shape: TemplateShape
}

export interface TemplateOptions {
  fallback?: string
  shape?: TemplateShape
}

/** Shown when a template has no fallback of its own and a slot cannot be shown. */
export const FALLBACK_TEXT = 'This could not be shown.'

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g

/** The distinct `{name}` placeholders of a template text, in order of first use. */
export function placeholdersOf(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(PLACEHOLDER)) {
    const name = match[1]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}

type Placeholders<T extends string> = T extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never

type NoSlots = Record<never, never>

/** Resolves to `unknown` (no constraint) when the slots and the placeholders match exactly. */
type SlotCheck<T extends string, S extends SlotSpec> = [Exclude<Placeholders<T>, keyof S>] extends [
  never,
]
  ? [Exclude<keyof S, Placeholders<T>>] extends [never]
    ? unknown
    : { 'declared but unused': Exclude<keyof S, Placeholders<T>> }
  : { 'used but not declared': Exclude<Placeholders<T>, keyof S> }

/**
 * Builds a template. The placeholders in `text` and the declared `slots` must match exactly; a
 * mismatch is a compile error (and the copy-lint test checks the registry again at run time).
 *
 *   tpl('Heart rate: under {limit}.', { limit: 'bpm' })
 *   tpl('Ready as planned.')
 */
export function tpl<const T extends string>(
  text: T & SlotCheck<T, NoSlots>,
  slots?: NoSlots,
  options?: TemplateOptions,
): Template<NoSlots>
export function tpl<const T extends string, const S extends SlotSpec>(
  text: T & SlotCheck<T, S>,
  slots: S,
  options?: TemplateOptions,
): Template<S>
export function tpl(
  text: string,
  slots: SlotSpec = {},
  options: TemplateOptions = {},
): Template<SlotSpec> {
  return {
    text,
    slots,
    fallback: options.fallback ?? FALLBACK_TEXT,
    shape: options.shape ?? 'sentence',
  }
}

/** A template that could not be filled, thrown under test. */
export class CopyError extends Error {
  readonly problems: readonly string[]
  constructor(subject: string, problems: readonly string[]) {
    super(`${subject}: ${problems.join('; ')}`)
    this.name = 'CopyError'
    this.problems = problems
  }
}

/**
 * Whether a copy problem throws. True under Vitest (`NODE_ENV` is `test`), false in the server and
 * the browser bundle, where a problem renders the fallback instead.
 */
export function isCopyStrict(): boolean {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'test'
}

/** Why `value` does not fit a slot of `kind`, or null when it does. */
function slotIssue(kind: SlotKind, value: unknown): string | null {
  if (kind === 'text') return typeof value === 'string' ? null : 'needs text'
  const issue = quantityIssue(value)
  if (issue !== null) return `needs a ${kind}: ${issue}`
  const actual = (value as { kind: string }).kind
  return actual === kind ? null : `needs a ${kind}, got a ${actual}`
}

/**
 * Fills a template in the runner's units. `slots` is checked against the template at compile time;
 * values that arrive as data (a stored fact) are checked again here.
 */
export function render<S extends SlotSpec>(
  template: Template<S>,
  slots: SlotValues<S>,
  units: Units,
): string {
  const values = slots as Readonly<Record<string, unknown>>
  const declared = template.slots as SlotSpec
  const problems: string[] = []
  const extras: string[] = []

  for (const [name, kind] of Object.entries(declared)) {
    const issue = slotIssue(kind, Object.hasOwn(values, name) ? values[name] : undefined)
    if (issue !== null) problems.push(`slot "${name}" ${issue}`)
  }
  for (const name of Object.keys(values)) {
    if (!Object.hasOwn(declared, name)) extras.push(`slot "${name}" is not declared`)
  }

  const text = template.text.replace(PLACEHOLDER, (_all, name: string) => {
    const kind = Object.hasOwn(declared, name) ? declared[name] : undefined
    if (kind === undefined) {
      problems.push(`placeholder "{${name}}" has no declared slot`)
      return ''
    }
    const value = values[name]
    if (slotIssue(kind, value) !== null) return '' // reported above
    return kind === 'text' ? (value as string) : formatQuantity(value as Quantity, units)
  })

  const strict = isCopyStrict()
  if (problems.length > 0 || (strict && extras.length > 0)) {
    if (strict) throw new CopyError(`Template "${template.text}"`, [...problems, ...extras])
    return template.fallback
  }
  return text
}

const SAMPLES: { readonly [K in SlotKind]: SlotValue<K> } = {
  pace: { kind: 'pace', secPerKm: 390 },
  speed: { kind: 'speed', kmh: 12 },
  distance: { kind: 'distance', m: 160934 },
  climb: { kind: 'climb', m: 1200 },
  duration: { kind: 'duration', sec: 99600 },
  minutes: { kind: 'minutes', min: 105 },
  bpm: { kind: 'bpm', bpm: 165 },
  percent: { kind: 'percent', pct: 12.5 },
  share: { kind: 'share', fraction: 0.825 },
  count: { kind: 'count', n: 240 },
  temp: { kind: 'temp', c: 24.5 },
  date: { kind: 'date', iso: '2026-10-19', style: 'long' },
  weekday: { kind: 'weekday', iso: '2026-10-19', style: 'long' },
  text: 'a short phrase of words',
}

/**
 * A valid, long-reading value for each slot of a template: the copy-lint test renders every
 * registered template with these to check its length and wording.
 */
export function sampleSlots(template: Template): Record<string, Quantity | string> {
  return Object.fromEntries(
    Object.entries(template.slots).map(([name, kind]) => [name, SAMPLES[kind]]),
  )
}
