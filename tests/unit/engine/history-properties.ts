// The property checks of the rebuild zone and the response to weeks run above plan [rules g-8,
// proposal section 5.3], written from the finished plan, the raw activities and the Params alone:
// none of them calls the code that enforces the limit it checks (`rampLimits`, `rebuildZone`,
// `responseBasis`), so a mistake there cannot hide behind itself.
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import {
  disruptionPlan,
  holdRestartWeeks,
  windowedWeeks,
} from '../../../shared/engine/disruption.ts'
import { loadPosition } from '../../../shared/engine/loadSetting.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { plannedMinOf } from '../../../shared/engine/limits.ts'
import type {
  EngineInput,
  HistoryBlock,
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

/** Running minutes by Monday, from the raw activities alone (races and duplicates are not runs). */
function runMinutesByWeek(input: EngineInput): Map<string, number> {
  const out = new Map<string, number>()
  for (const a of input.activities) {
    if (a.duplicateStatus === 'possible' || a.duplicateStatus === 'confirmed') continue
    if (a.type === 'run') {
      out.set(mondayOf(a.date), (out.get(mondayOf(a.date)) ?? 0) + a.durationSec / 60)
    }
  }
  return out
}

/**
 * The first Monday of the plan being continued, from the stored plan alone: the earliest week of
 * the plan when it holds the current week and the break is shorter than `j7.tier1Days`; null for a
 * new plan or one that restarts after a break.
 */
export function continuedSince(input: EngineInput): string | null {
  const weeks = input.existing?.weeks ?? []
  const current = mondayOf(input.today)
  if (!weeks.some((w) => w.weekStart === current)) return null
  if (estimateState(input).layoffDays >= P.j7.tier1Days.value) return null
  return weeks.map((w) => w.weekStart).reduce((a, b) => (a < b ? a : b))
}

/**
 * The block the rebuild zone reads at a `credit` [rules g-8]: for a plan being continued, the block
 * of the athlete state on the plan's first Monday (the same input dated there), until a complete
 * week since that Monday has run at or above credit x taper x H of it; else the block of the state
 * today. The first Monday is found by running the state estimate on that date, and the weeks run
 * are summed from the raw activities, so nothing here calls the code that chooses the block.
 */
export function expectedBlock(input: EngineInput, credit: number): HistoryBlock | null {
  const own = estimateState(input).history
  const first = continuedSince(input)
  const current = mondayOf(input.today)
  if (first === null || first >= current) return own
  const opened = estimateState({ ...input, today: first }).history
  if (opened === null) return own
  const ceiling = credit * opened.taper * opened.blockMin
  const minutes = runMinutesByWeek(input)
  for (let monday = first; monday < current; monday = addDays(monday, 7)) {
    if ((minutes.get(monday) ?? 0) >= ceiling) return own
  }
  return opened
}

/** The rebuild ceiling and step the rule gives this runner at a position, from the Params. */
export function expectedZone(input: EngineInput): { ceilingMin: number; step: number } | null {
  const state = estimateState(input)
  const { position } = loadPosition(input, state)
  if (position === 'steady') return null
  const upper = position === 'upper'
  const credit = upper ? P.g8.creditUpper.value : P.g8.creditStandard.value
  const block = expectedBlock(input, credit)
  if (block === null) return null
  return {
    ceilingMin: credit * block.taper * block.blockMin,
    step: upper ? UPPER_STEP : P.g8.stepStandard.value,
  }
}

/**
 * The weeks of the response, from the raw activities: the minutes run in each of the last
 * `g8.responseWeeks` complete weeks that hold no race and fall in none of the `skip` weeks (a
 * reported rest window), newest first. A week holds the whole minutes of its runs, as the athlete
 * state counts them; races and duplicates are not runs.
 */
export function eligibleWeeks(input: EngineInput, skip: ReadonlySet<string> = new Set()): number[] {
  return eligibleWeekList(input, skip).map((w) => w.runMin)
}

/** `eligibleWeeks` with the Monday of each week, newest first. */
export function eligibleWeekList(
  input: EngineInput,
  skip: ReadonlySet<string> = new Set(),
): Array<{ weekStart: string; runMin: number }> {
  const seconds = new Map<string, number>()
  const raced = new Set<string>()
  for (const a of input.activities) {
    if (a.duplicateStatus === 'possible' || a.duplicateStatus === 'confirmed') continue
    const monday = mondayOf(a.date)
    if (a.type === 'race') raced.add(monday)
    if (a.type === 'run') seconds.set(monday, (seconds.get(monday) ?? 0) + a.durationSec)
  }
  const current = mondayOf(input.today)
  const out: Array<{ weekStart: string; runMin: number }> = []
  for (let k = 1; k <= 16 && out.length < P.g8.responseWeeks.value; k += 1) {
    const monday = addDays(current, -7 * k)
    if (raced.has(monday) || skip.has(monday)) continue
    out.push({ weekStart: monday, runMin: Math.round((seconds.get(monday) ?? 0) / 60) })
  }
  return out
}

/**
 * The weeks a window of `[startDate, endDate]` touches, for the windows whose days end with the
 * window (a limited window): the tail days of an illness or a niggle are not counted here.
 */
export function windowWeeksOf(input: EngineInput): Set<string> {
  const out = new Set<string>()
  for (const w of input.disruptions ?? []) {
    for (let day = w.startDate; day <= w.endDate; day = addDays(day, 1)) out.add(mondayOf(day))
  }
  return out
}

/**
 * What the response to weeks run above plan gives this runner, from the raw activities and the
 * Params: null when it does not apply (steady or held at steady, a new plan or one that restarts
 * after a break, which have no plan to run above), else `meanMin`, the mean of the minutes run over
 * the eligible weeks, and the largest of those weeks. `meanMin` is null when fewer than
 * `g8.responseWeeks` weeks exist and when the newest of them was run under the minutes the stored
 * plan held for it (or the plan held none): a week run under its target is never a reason to lift.
 * `weeksMean` is the mean of the weeks whatever the newest week did, null only without four weeks.
 */
export function expectedResponse(input: EngineInput): {
  meanMin: number | null
  maxWeekMin: number | null
  weeksMean: number | null
} | null {
  const state = estimateState(input)
  if (continuedSince(input) === null) return null
  if (loadPosition(input, state).position === 'steady') return null
  const weeks = eligibleWeekList(input, windowWeeksOf(input))
  if (weeks.length < P.g8.responseWeeks.value) {
    return { meanMin: null, maxWeekMin: null, weeksMean: null }
  }
  const mean = weeks.reduce((sum, w) => sum + w.runMin, 0) / weeks.length
  const newest = weeks[0]!
  const stored = input.existing!.weeks.find((w) => w.weekStart === newest.weekStart)
  const atTarget = stored !== undefined && newest.runMin >= plannedMinOf(stored)
  return {
    meanMin: atTarget ? mean : null,
    maxWeekMin: Math.max(...weeks.map((w) => w.runMin)),
    weeksMean: mean,
  }
}

/**
 * The baseline a loading week is stepped from when the response reads `meanMin` over the planned
 * baseline `planned` [rules g-8]: the mean when it is higher, and never more than the planned
 * baseline stepped by the ceiling of two weeks (the novice minimum step is left to the tolerance of
 * the callers).
 */
export function expectedBaseline(planned: number, meanMin: number | null): number {
  if (meanMin === null || meanMin <= planned) return planned
  return Math.min(meanMin, planned * (1 + P.g2.rampCeilingTwoWeeks.value))
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
 * Each loading week against its baseline, the highest of the two loading weeks before it (or, at
 * standard and upper in a continued plan, the mean of the weeks run when that is higher): at most
 * the usual 10% step, or in the zone max(10% step, min(the position's step, R)) over a baseline
 * under R, and never more than the weekly rate of the hard ceiling. A tolerance of two minutes
 * covers the whole-minute rounding and the novice minimum step.
 */
export function zoneReport(input: EngineInput, plan: PlanDraft): ZoneReport {
  const totals = weeklyTotals(input, plan)
  const zone = expectedZone(input)
  // at standard and upper in a continued plan the baseline may be the mean of the weeks run
  const mean = expectedResponse(input)?.meanMin ?? null
  const currentMonday = mondayOf(input.today)
  // the restart week of a long hold that the J7 share holds is a baseline whether or not the cadence
  // made it a recovery week [rules J7, J9]
  const targets = new Map(plan.weeks.map((w) => [w.weekStart, w.targetRunMin]))
  const restart = holdRestartWeeks(
    disruptionPlan(input.disruptions ?? []),
    (weekStart) => totals.get(weekStart),
    (weekStart) => targets.get(weekStart),
  )
  const loading = plan.weeks.filter(
    (w) => w.weekStart > currentMonday && (isLoading(w) || restart.includes(w.weekStart)),
  )
  const report: ZoneReport = { checked: 0, zoneWeeks: 0, problems: [] }
  const tolerance = 2
  for (let i = 2; i < loading.length; i += 1) {
    const week = loading[i]!
    // the restart week is exempt from the ramp up to its J7 share [rule J9]
    if (restart.includes(week.weekStart)) continue
    const total = totals.get(week.weekStart) ?? 0
    const planned = Math.max(
      totals.get(loading[i - 1]!.weekStart) ?? 0,
      totals.get(loading[i - 2]!.weekStart) ?? 0,
    )
    const base = expectedBaseline(planned, mean)
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
  // the weeks a window took days from [rule J9]: part weeks, a baseline beside another week and
  // never alone, so the weeks before them count when one of the two is such a week
  const touched = new Set(windowedWeeks(disruptionPlan(input.disruptions ?? [])))
  const problems: string[] = []
  const from = addDays(mondayOf(input.today), 28)
  for (const w of plan.weeks) {
    if (w.weekStart < from || w.flags.includes('post-race')) continue
    const total = at(w.weekStart, 0)
    const afterFloor = floor !== undefined && daysBetween(floor.weekStart, w.weekStart) === 7
    const partial = [2, 3].some((back) => touched.has(addDays(w.weekStart, -7 * back)))
    const ceilingBase = Math.max(
      at(w.weekStart, 2),
      at(w.weekStart, 3),
      afterFloor ? at(w.weekStart, 1) : 0,
      partial ? Math.max(at(w.weekStart, 4), at(w.weekStart, 5)) : 0,
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
