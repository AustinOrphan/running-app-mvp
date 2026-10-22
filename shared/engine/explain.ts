// Rationale lines: rule ids resolve to the parameters that carry them and the papers behind
// them. The UI's "why" drawer renders the result; nothing here is generated text.
import { paramsForRule } from './params/index.ts'
import type { Param } from './types.ts'

/**
 * Resolves rule ids to their parameters and the papers behind them. Ids are matched without regard
 * to case or hyphens ('g-1' and 'G1' are the same rule); an id repeated in the input is resolved
 * once, and one with no parameter yields an empty list rather than an error.
 */
export function explain(
  rules: string[],
): Array<{ rule: string; params: Array<Param<unknown>>; papers: string[] }> {
  const key = (id: string) => id.toLowerCase().replace(/-/g, '')
  const seen = new Set<string>()
  const out: Array<{ rule: string; params: Array<Param<unknown>>; papers: string[] }> = []
  for (const rule of rules) {
    if (seen.has(key(rule))) continue
    seen.add(key(rule))
    const params = paramsForRule(rule)
    const papers = [...new Set(params.flatMap((p) => p.evidence))].sort()
    out.push({ rule, params, papers })
  }
  return out
}
