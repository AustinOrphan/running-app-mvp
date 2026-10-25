// The property checks of the rebuild zone [rules g-8, proposal section 5.3], written from the
// finished plan and the Params alone: none of them calls the code that enforces the limit it
// checks (`rampLimits`, `rebuildZone`), so a mistake there cannot hide behind itself.
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { loadPosition } from '../../../shared/engine/loadSetting.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  EngineInput,
  PlanDraft,
  SessionKind,
  WeekDraft,
} from '../../../shared/engine/types.ts'

export type Position = 'steady' | 'standard' | 'upper'
export const POSITIONS: readonly Position[] = ['steady', 'standard', 'upper']

/** Sessions that count as running minutes in a week (a race and a hike do not). */
export const RUNNING: ReadonlySet<SessionKind> = new Set<SessionKind>([
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

/** The weekly step of the upper position: the rate at which two weeks meet the hard ceiling. */
export const UPPER_STEP = Math.sqrt(1 + P.g2.rampCeilingTwoWeeks.value) - 1

/** Running minutes by Monday: the completed runs and races, then the planned sessions. */
export function weeklyTotals(input: EngineInput, plan: PlanDraft): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of input.activities) {
    if (a.type !== 'run' && a.type !== 'race') continue
    out.set(mondayOf(a.date), (out.get(mondayOf(a.date)) ?? 0) + a.durationSec / 60)
  }
  for (const s of plan.sessions) {
    if (!RUNNING.has(s.kind)) continue
    out.set(mondayOf(s.date), (out.get(mondayOf(s.date)) ?? 0) + s.durationMin)
  }
  return out
}

/** The rebuild ceiling and step the rule gives this runner at a position, from the Params. */
export function expectedZone(input: EngineInput): { ceilingMin: number; step: number } | null {
  const state = estimateState(input)
  const { position } = loadPosition(input, state)
  if (position === 'steady' || state.history === null) return null
  const upper = position === 'upper'
  return {
    ceilingMin:
      (upper ? P.g8.creditUpper.value : P.g8.creditStandard.value) *
      state.history.taper *
      state.history.blockMin,
    step: upper ? UPPER_STEP : P.g8.stepStandard.value,
  }
}

/** A week the plan loads: not a recovery, taper, race, post-race or start-programme week. */
const isLoading = (w: WeekDraft): boolean =>
  !w.isRecovery &&
  !w.isTaper &&
  w.phase !== 'race' &&
  !w.flags.includes('post-race') &&
  !w.flags.includes('post-race-restart') &&
  !w.flags.includes('restart-floor') &&
  !w.flags.some((f) => f.startsWith('ladder') || f === 'injury-return')

export interface ZoneReport {
  /** Weeks checked against the zone's limit (two earlier loading weeks of the plan exist). */
  checked: number
  /** Weeks planned above the usual step over their baseline, which only the zone allows. */
  zoneWeeks: number
  problems: string[]
}

/**
 * Each loading week against its baseline, the highest of the two loading weeks before it: at most
 * the usual 10% step, or in the zone max(10% step, min(the position's step, R)) over a baseline
 * under R, and never more than the weekly rate of the hard ceiling. A tolerance of two minutes
 * covers the whole-minute rounding and the novice minimum step.
 */
export function zoneReport(input: EngineInput, plan: PlanDraft): ZoneReport {
  const totals = weeklyTotals(input, plan)
  const zone = expectedZone(input)
  const currentMonday = mondayOf(input.today)
  const loading = plan.weeks.filter((w) => w.weekStart > currentMonday && isLoading(w))
  const report: ZoneReport = { checked: 0, zoneWeeks: 0, problems: [] }
  const tolerance = 2
  for (let i = 2; i < loading.length; i += 1) {
    const week = loading[i]!
    const total = totals.get(week.weekStart) ?? 0
    const base = Math.max(
      totals.get(loading[i - 1]!.weekStart) ?? 0,
      totals.get(loading[i - 2]!.weekStart) ?? 0,
    )
    const usual = base * (1 + P.g2.rampSoft.value)
    const limit =
      zone !== null && base < zone.ceilingMin
        ? Math.max(usual, Math.min(base * (1 + zone.step), zone.ceilingMin))
        : usual
    report.checked += 1
    if (total > usual + tolerance) report.zoneWeeks += 1
    if (total > limit + tolerance) {
      report.problems.push(
        `${week.weekStart}: ${total.toFixed(1)} min over a baseline of ${base.toFixed(1)}, limit ${limit.toFixed(1)}${zone === null ? ' (no zone)' : ` (R ${zone.ceilingMin.toFixed(1)}, step ${zone.step.toFixed(4)})`}`,
      )
    }
    if (total > base * (1 + UPPER_STEP) + tolerance) {
      report.problems.push(
        `${week.weekStart}: ${total.toFixed(1)} min is above the ceiling's weekly rate`,
      )
    }
  }
  return report
}

/**
 * No week above 30% over the week two or three weeks before it (the hard ceiling of G-2). The
 * weeks that look back at the part week of today, or at weeks before the plan, are the checklist's
 * to judge (`planProblems`): this reads the plan's own weeks, four or more weeks in.
 */
export function ceilingProblems(input: EngineInput, plan: PlanDraft): string[] {
  const totals = weeklyTotals(input, plan)
  const at = (weekStart: string, back: number) => totals.get(addDays(weekStart, -7 * back)) ?? 0
  const floor = plan.weeks.find((w) => w.flags.includes('restart-floor'))
  const problems: string[] = []
  const from = addDays(mondayOf(input.today), 28)
  for (const w of plan.weeks) {
    if (w.weekStart < from || w.flags.includes('post-race')) continue
    const total = at(w.weekStart, 0)
    const afterFloor = floor !== undefined && daysBetween(floor.weekStart, w.weekStart) === 7
    const ceilingBase = Math.max(
      at(w.weekStart, 2),
      at(w.weekStart, 3),
      afterFloor ? at(w.weekStart, 1) : 0,
    )
    if (ceilingBase > 0 && total > ceilingBase * (1 + P.g2.rampCeilingTwoWeeks.value) + 2) {
      problems.push(
        `${w.weekStart}: ${total.toFixed(1)} min over ${ceilingBase.toFixed(1)} two weeks back`,
      )
    }
  }
  return problems
}

/** The checklist items that judge the load rules; the others (spacing, availability) do not. */
export const LOAD_ITEMS: readonly string[] = [
  'progression',
  'recovery-cadence',
  'taper',
  'break-restart',
  'spike-guard',
  'ultra-caps',
  'post-race-window',
]

/**
 * A failed item of the load rules, a failed item `baseline` (the same runner's plan at steady) does
 * not also fail, a run flagged for a spike or one that needs an override.
 */
export function planProblems(plan: PlanDraft, baseline: PlanDraft = plan): string[] {
  const known = new Set(baseline.checklist.filter((c) => !c.ok).map((c) => c.id))
  const problems = plan.checklist
    .filter((c) => !c.ok && (LOAD_ITEMS.includes(c.id) || !known.has(c.id)))
    .map((c) => `${c.id}: ${c.detail}`)
  for (const s of plan.sessions) {
    for (const flag of s.flags) {
      if (flag === 'spike-warn' || flag === 'override-required') problems.push(`${s.date} ${flag}`)
    }
  }
  return problems
}

/** The planned minutes of the first `count` weeks of the plan. */
export const cumulative = (plan: PlanDraft, count: number): number =>
  plan.weeks.slice(0, count).reduce((sum, w) => sum + w.targetRunMin, 0)

/** The number of weeks from the first one up to and including the first that reaches `minutes`. */
export function weeksToWeekly(plan: PlanDraft, minutes: number): number | null {
  const i = plan.weeks.findIndex((w) => w.targetRunMin >= minutes)
  return i < 0 ? null : i + 1
}

/**
 * The plan week (1 for the week of `firstMonday`) in which a single planned run first reaches
 * `minutes`, or null when none does.
 */
export function weeksToLong(plan: PlanDraft, firstMonday: string, minutes: number): number | null {
  let best: number | null = null
  for (const s of plan.sessions) {
    if (!RUNNING.has(s.kind) || s.durationMin < minutes) continue
    const n = daysBetween(firstMonday, mondayOf(s.date)) / 7 + 1
    best = best === null ? n : Math.min(best, n)
  }
  return best
}
