import type { Grade, Param } from '../types.ts'

interface Extras<T> {
  range?: [T, T]
  unit?: string
  note?: string
}

/**
 * Builds one parameter record. `id` is `<group>.<name>`, the path under `P`; `rule` is the id of
 * the rule in `research/engine-rules.md` ('g-1', 'H4'); `evidence` lists paper ids from
 * `research/papers/`. A grade D parameter needs a `note` that says it is a default (a unit test
 * enforces it).
 */
export function param<T = number>(
  id: string,
  value: T,
  grade: Grade,
  rule: string,
  evidence: string[],
  extras: Extras<T> = {},
): Param<T> {
  const out: Param<T> = { id, value, grade, rule, evidence }
  if (extras.range) out.range = extras.range
  if (extras.unit) out.unit = extras.unit
  if (extras.note) out.note = extras.note
  return out
}

/** One section file exports groups of parameters; each group is named after its rule. */
export type ParamGroups = Record<string, Record<string, Param<unknown>>>
