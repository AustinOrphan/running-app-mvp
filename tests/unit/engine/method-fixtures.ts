// What the tests of the method presets [rules P1 to P4] share: the presets that are offered, what the
// resolver says of each matrix athlete at each, a matrix input asked for a preset, the plan as the
// digests read it, the run days of a plan, and the check that a preset plans no more than the
// default plan of the same input [rule G6].
import { mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { resolveMethod, type MethodPosition } from '../../../shared/engine/methods.ts'
import { withShape } from '../../../shared/engine/shape.ts'
import type { EngineInput, PlanDraft, PresetId, SessionKind } from '../../../shared/engine/types.ts'
import { planMinutes } from './disruption-fixtures.ts'
import { TODAY } from './matrix-fixtures.ts'

/** The presets a runner can ask for: `default` is the plan with no preset, and P3 is not offered. */
export const OFFERED = ['three-run-days', 'longer-base'] as const satisfies readonly PresetId[]

export type Offered = (typeof OFFERED)[number]

/** What the resolver says of each athlete: `applies`, or why the preset reads the default. */
export type Reading =
  'applies' | 'not-applicable' | 'novice' | 'no-base' | 'held:recent-injury' | 'held:reds-hold'

export const READING: Record<Offered, Record<string, Reading>> = {
  // goals of 5 km to the half marathon only; a novice keeps the novice days; a recent injury holds it
  'three-run-days': {
    'novice-5k': 'novice',
    half: 'applies',
    marathon: 'not-applicable',
    'trail-50k': 'not-applicable',
    'first-100-mile': 'not-applicable',
    masters: 'not-applicable',
    returning: 'applies',
    'prior-bsi': 'held:recent-injury',
    'hot-race': 'not-applicable',
    'sparse-100-mile': 'not-applicable',
    'reds-hold': 'not-applicable',
    'post-marathon-short-run': 'applies',
  },
  // every class; a plan with no base week of its own reads the default (a ladder that covers the
  // base, a novice plan with no base), and so does a plan held by a persistent condition
  'longer-base': {
    'novice-5k': 'no-base',
    half: 'applies',
    marathon: 'applies',
    'trail-50k': 'applies',
    'first-100-mile': 'applies',
    masters: 'applies',
    returning: 'applies',
    'prior-bsi': 'held:recent-injury',
    'hot-race': 'applies',
    'sparse-100-mile': 'applies',
    'reds-hold': 'held:reds-hold',
    'post-marathon-short-run': 'no-base',
  },
}

/** The input asking for `method`, the rest of it as it was. */
export const withMethod = (input: EngineInput, method: PresetId): EngineInput => ({
  ...input,
  options: { ...input.options, method },
})

/**
 * The plan as the digests read it: the version of the Params is left out, and so is the
 * `shape-<preset>` flag of a week (`shape.ts`). The flag records the shape a week was drawn under, for
 * the next re-plan; it is no part of what the week plans, so two plans with the same weeks and sessions
 * read the same whichever preset drew them.
 */
export const text = (plan: PlanDraft): string =>
  JSON.stringify({
    ...plan,
    paramsVersion: '',
    weeks: plan.weeks.map((week) => withShape(week, 'default')),
  })

/** The kinds that count as a run in a week. */
export const RUN_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'b2b',
])

/** The kinds the table of quality kinds by phase holds (`QUALITY_BY_PRESET`, `micro.ts`) [rule F2]. */
export const QUALITY_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'strides',
])

/** The most run days any week from today on holds. */
export function maxRunDays(plan: PlanDraft): number {
  const days = new Map<string, Set<string>>()
  for (const s of plan.sessions) {
    if (!RUN_KINDS.has(s.kind) || s.date < TODAY) continue
    const monday = mondayOf(s.date)
    days.set(monday, (days.get(monday) ?? new Set<string>()).add(s.date))
  }
  return Math.max(0, ...[...days.values()].map((d) => d.size))
}

/**
 * What a plan holds above the default plan [rule G6]: a week target, the running minutes planned in
 * a week and the peak week. Empty when the plan plans no more than the default in any week.
 */
export function aboveDefault(base: PlanDraft, plan: PlanDraft): string[] {
  const problems: string[] = []
  for (const week of plan.weeks) {
    const before = base.weeks.find((w) => w.weekStart === week.weekStart)
    if (before !== undefined && week.targetRunMin > before.targetRunMin) {
      problems.push(`target ${week.weekStart}: ${week.targetRunMin} against ${before.targetRunMin}`)
    }
  }
  const baseline = planMinutes(base)
  for (const [week, minutes] of planMinutes(plan)) {
    const before = baseline.get(week) ?? 0
    if (minutes > before) problems.push(`planned ${week}: ${minutes} against ${before}`)
  }
  const peak = (p: PlanDraft) => Math.max(0, ...p.weeks.map((w) => w.targetRunMin))
  if (peak(plan) > peak(base)) problems.push(`peak ${peak(plan)} against ${peak(base)}`)
  return problems
}

/** The preset that applies to `input` and why, as the engine reads it for the plan it built. */
export function positionOf(input: EngineInput, plan: PlanDraft): MethodPosition {
  return resolveMethod(input, estimateState(input), plan.weeks)
}
