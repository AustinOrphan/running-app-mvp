// The offer to raise the plan to match [rule E7]: when recent weeks were run above the plan, the weekly
// review asks whether to raise it. Pure; the condition here only decides whether to ask, and a yes
// is a re-plan with `raiseToLevel` under every limit of the ordinary one. Never automatic.
import { addDays, mondayOf } from '../dates.ts'
import { worstPainIn, weeklyDecision, type WeeklyContext } from './adapt.ts'
import { plannedMinOf } from './limits.ts'
import { persistentHoldOf } from './holds.ts'
import { progressionHold } from './macro.ts'
import { P } from './params/index.ts'
import { isLoadingWeek } from './startWeeks.ts'
import type { AthleteState, EngineInput, PlanChange, WeekDraft } from './types.ts'

/** Why the offer is not made; `null` when it is. */
export type RaiseBlock =
  'no-plan' | 'break' | 'taper' | 'hold' | 'disruption' | 'pain' | 'fatigue' | 'not-above'

export interface RaiseCheck {
  /** The offer may be made. */
  met: boolean
  block: RaiseBlock | null
  /** The Mondays of the weeks read, oldest first (the last `e7.raiseWeeksLooked` complete weeks). */
  weekStarts: string[]
  /** The weeks among them run above plan. */
  aboveWeeks: string[]
}

/** The last `e7.raiseWeeksLooked` complete weeks before `today`, oldest first. */
export function raiseWeeksOf(today: string): string[] {
  const count = P.e7.raiseWeeksLooked.value
  const currentMonday = mondayOf(today)
  return Array.from({ length: count }, (_, i) => addDays(currentMonday, -7 * (count - i)))
}

/** True when `minutes` run are more than `e7.raiseAbovePlanPct` over `planned`. */
export function isAbovePlan(minutes: number, planned: number): boolean {
  return planned > 0 && minutes * 100 > planned * (100 + P.e7.raiseAbovePlanPct.value)
}

/** The J5 signals that are not about the plan being run short: a week run above plan cannot raise it. */
const NOT_A_BLOCK: ReadonlySet<string> = new Set(['completion-low'])
/** The J5 signals that are pain; every other one a decision reads blocks as fatigue. */
const PAIN_SIGNALS: ReadonlySet<string> = new Set(['pain', 'pain-mild'])

/**
 * Whether the weekly review asks "Your recent weeks were above plan. Raise the plan to match?" [rule
 * E7]. All of: at least `e7.raiseWeeksAbove` of the last `e7.raiseWeeksLooked` complete weeks run more
 * than `e7.raiseAbovePlanPct` % over the minutes they were planned at; no pain reported in those
 * weeks (any pain holds volume, J5) and no fatigue flag; no persistent or progression hold, no rest
 * or limited-running window reaching those weeks or after; no break of `j7.tier1Days` days; and the
 * current and the next week are neither taper nor race.
 */
export function raiseToMatchCheck(
  input: EngineInput,
  state: AthleteState,
  contextOf: (weekStart: string) => WeeklyContext = () => ({}),
): RaiseCheck {
  const weekStarts = raiseWeeksOf(input.today)
  const no = (block: RaiseBlock, aboveWeeks: string[] = []): RaiseCheck => ({
    met: false,
    block,
    weekStarts,
    aboveWeeks,
  })
  const stored = new Map((input.existing?.weeks ?? []).map((w) => [w.weekStart, w]))
  const currentMonday = mondayOf(input.today)
  const current = stored.get(currentMonday)
  if (input.existing === null || current === undefined) return no('no-plan')
  if (state.layoffDays >= P.j7.tier1Days.value) return no('break')
  const next = stored.get(addDays(currentMonday, 7))
  for (const week of [current, next]) {
    if (week !== undefined && (week.isTaper || week.phase === 'race')) return no('taper')
  }
  if (persistentHoldOf(input, state) !== null || progressionHold(input, state)) return no('hold')
  const from = weekStarts[0]!
  if ((input.disruptions ?? []).some((w) => w.endDate >= from)) return no('disruption')

  // Pain, illness or any signal the weekly decision (J5) reads in the weeks read or in the current
  // week so far blocks the offer, and so does the raise.
  const read = [...weekStarts, currentMonday]
  if (read.some((w) => worstPainIn(input, w, input.today) > 0)) return no('pain')
  for (const week of read) {
    const signals = weeklyDecision(input, week, contextOf(week)).signals.filter(
      (signal) => !NOT_A_BLOCK.has(signal.code),
    )
    if (signals.some((signal) => PAIN_SIGNALS.has(signal.code))) return no('pain')
    // a signal that only corroborates another (hrv) never stands alone
    if (signals.some((signal) => signal.code !== 'hrv-suppressed')) return no('fatigue')
  }

  const aboveWeeks = weekStarts.filter((weekStart) => {
    const week = stored.get(weekStart)
    const ran = state.weeks.find((w) => w.weekStart === weekStart)?.runMin ?? 0
    return week !== undefined && isLoadingWeek(week) && isAbovePlan(ran, plannedMinOf(week))
  })
  if (aboveWeeks.length < P.e7.raiseWeeksAbove.value) return no('not-above', aboveWeeks)
  return { met: true, block: null, weekStarts, aboveWeeks }
}

/** The first loading week from the current one on whose target the raise lifts, and by how much. */
export interface RaiseRise {
  weekStart: string
  fromMin: number
  toMin: number
}

/**
 * The first loading week from the current Monday on that the raised re-plan draws higher than the plan
 * holds it and whose sessions it rewrites with more running (`changes`, the re-plan's own list), so the
 * figures shown are the rows and sessions written. A settled current week whose row could rise while
 * its sessions cannot is passed over for the first week whose sessions do.
 */
export function firstRise(
  stored: readonly Pick<WeekDraft, 'weekStart' | 'targetRunMin'>[],
  raised: readonly WeekDraft[],
  today: string,
  changes: readonly Pick<PlanChange, 'weekStart' | 'field' | 'from' | 'to'>[],
): RaiseRise | null {
  const currentMonday = mondayOf(today)
  const before = new Map(stored.map((w) => [w.weekStart, w.targetRunMin]))
  const moreRunning = new Set(
    changes
      .filter(
        (c) =>
          c.field === 'plannedMin' &&
          typeof c.from === 'number' &&
          typeof c.to === 'number' &&
          c.to > c.from,
      )
      .map((c) => c.weekStart),
  )
  for (const week of [...raised].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))) {
    if (week.weekStart < currentMonday || !isLoadingWeek(week)) continue
    const was = before.get(week.weekStart)
    if (was !== undefined && week.targetRunMin > was && moreRunning.has(week.weekStart)) {
      return { weekStart: week.weekStart, fromMin: was, toMin: week.targetRunMin }
    }
  }
  return null
}
