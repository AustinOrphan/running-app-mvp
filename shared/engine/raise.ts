// The offer to raise the plan to match [rule E7]: when recent weeks were run above the plan, the weekly
// review asks whether to raise it. Pure; the condition here only decides whether to ask, and a yes
// is a re-plan with `raiseToLevel` under every limit of the ordinary one. Never automatic.
import { addDays, mondayOf } from '../dates.ts'
import { worstPainIn } from './adapt.ts'
import { isDisruptedWeek } from './disruption.ts'
import { plannedMinOf } from './limits.ts'
import { persistentHoldOf } from './holds.ts'
import { progressionHold } from './macro.ts'
import { P } from './params/index.ts'
import { checkinOn, poorSubjective } from './readiness.ts'
import type { AthleteState, EngineInput, WeekDraft } from './types.ts'

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

/** The weeks that are the plan's own loading weeks: not taper, race, or cut by a window. */
function countsAsLoading(week: WeekDraft): boolean {
  return !week.isTaper && week.phase !== 'race' && !isDisruptedWeek(week.flags)
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

/** A fatigue flag in the week: poor check-in days, a review that says so, or illness [rules J2, J5]. */
function fatigueIn(input: EngineInput, weekStart: string): boolean {
  let poorDays = 0
  for (let k = 0; k < 7; k++) {
    const checkin = checkinOn(input, addDays(weekStart, k))
    if (poorSubjective(checkin)) poorDays += 1
    if (checkin?.illness) return true
  }
  if (poorDays >= P.j5.subjectivePoorDays.value) return true
  const review = input.reviews.find((r) => r.weekStart === weekStart)
  return (
    review !== undefined &&
    ((review.fatigue !== null && review.fatigue >= P.j5.reviewFatigueDecline.value) ||
      review.symptoms === 'persistent')
  )
}

/**
 * Whether the weekly review asks "Your recent weeks were above plan. Raise the plan to match?" [rule
 * E7]. All of: at least `e7.raiseWeeksAbove` of the last `e7.raiseWeeksLooked` complete weeks run more
 * than `e7.raiseAbovePlanPct` % over the minutes they were planned at; no pain reported in those
 * weeks (any pain holds volume, J5) and no fatigue flag; no persistent or progression hold, no rest
 * or limited-running window reaching those weeks or after; no break of `j7.tier1Days` days; and the
 * current and the next week are neither taper nor race.
 */
export function raiseToMatchCheck(input: EngineInput, state: AthleteState): RaiseCheck {
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

  const last = addDays(currentMonday, -1)
  if (weekStarts.some((w) => worstPainIn(input, w, last) > 0)) return no('pain')
  if (weekStarts.some((w) => fatigueIn(input, w))) return no('fatigue')

  const aboveWeeks = weekStarts.filter((weekStart) => {
    const week = stored.get(weekStart)
    const ran = state.weeks.find((w) => w.weekStart === weekStart)?.runMin ?? 0
    return week !== undefined && countsAsLoading(week) && isAbovePlan(ran, plannedMinOf(week))
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
 * The first week from the current Monday on that the raised re-plan draws higher than the plan holds
 * it. Taper, race and recovery weeks are passed over: the figure shown is a loading week's.
 */
export function firstRise(
  stored: readonly Pick<WeekDraft, 'weekStart' | 'targetRunMin'>[],
  raised: readonly WeekDraft[],
  today: string,
): RaiseRise | null {
  const currentMonday = mondayOf(today)
  const before = new Map(stored.map((w) => [w.weekStart, w.targetRunMin]))
  for (const week of [...raised].sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))) {
    if (week.weekStart < currentMonday || week.isRecovery || week.isTaper) continue
    if (week.phase === 'race') continue
    const was = before.get(week.weekStart)
    if (was !== undefined && week.targetRunMin > was) {
      return { weekStart: week.weekStart, fromMin: was, toMin: week.targetRunMin }
    }
  }
  return null
}
