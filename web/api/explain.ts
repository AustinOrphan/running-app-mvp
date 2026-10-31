import { useQuery } from '@tanstack/react-query'
import { EXPLAIN_MAX_RULES } from '../../shared/copy/limits.ts'
import type { ExplainRequest, ExplainView } from '../../shared/engine/types.ts'
import { api, keys, qs } from './client.ts'

/**
 * What a Why button asks about: a session, a week, a decision, readiness, the zones, a prediction,
 * a run, a brief or a list of rule ids. It is the query of `GET /api/explain` as a value, so a call
 * site states the subject and the drawer asks the server for the figures behind it.
 */
export type ExplainRef = ExplainRequest

/**
 * The reference for rule ids alone: the figures of each rule the engine can show, and the rule text
 * for the others. Duplicates (any case) are dropped and the list is cut at the route's limit.
 */
export function rulesRef(rules: readonly string[]): ExplainRef {
  const seen = new Set<string>()
  const unique = rules.filter((rule) => {
    const key = rule.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { subject: 'rules', rules: unique.slice(0, EXPLAIN_MAX_RULES) }
}

/** What a Why button opens the drawer on: the rule ids and the subject whose figures come first. */
export interface WhyTarget {
  rules: string[]
  explain: ExplainRef
}

/** The target for rule ids alone (`rulesRef`). */
export function ruleTarget(rules: string[]): WhyTarget {
  return { rules, explain: rulesRef(rules) }
}

/** The request path of a reference, relative to `/api`. */
export function explainPath(ref: ExplainRef): string {
  switch (ref.subject) {
    case 'session':
    case 'activity':
      return `/explain${qs({ subject: ref.subject, id: ref.id })}`
    case 'week':
    case 'decision':
    case 'brief':
      return `/explain${qs({ subject: ref.subject, weekStart: ref.weekStart })}`
    case 'readiness':
      return `/explain${qs({ subject: ref.subject })}`
    case 'zone':
      return `/explain${qs({ subject: ref.subject, boundary: ref.boundary })}`
    case 'prediction':
      return `/explain${qs({ subject: ref.subject, goalId: ref.goalId })}`
    case 'strength':
      return `/explain${qs({ subject: ref.subject, id: ref.id, exercise: ref.exercise })}`
    case 'rules':
      return `/explain${qs({ subject: ref.subject, rules: ref.rules.join(',') })}`
  }
}

/**
 * The figures behind a Why, as `ExplainView`. The request runs only while `enabled` (the drawer is
 * open). The key holds the whole reference, so each subject and id has its own entry. The server
 * sends no validator for this route, so every opening asks again and shows the earlier figures
 * until the new ones arrive: a figure never outlives the write that changed it.
 */
export function useExplain(ref: ExplainRef, options: { enabled: boolean }) {
  return useQuery({
    queryKey: [keys.explain, ref],
    queryFn: () => api<ExplainView>('GET', explainPath(ref)),
    enabled: options.enabled,
    staleTime: 0,
  })
}
