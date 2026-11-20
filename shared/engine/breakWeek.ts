// A loading week run at or under `e3.breakWeekMaxShare` of its target, with no rest window over it,
// counts as the cycle's recovery week; the week after it repeats the loading week [rules E3, G-6,
// J7; owner decision 2026-11-15]. Pure: the stored plan, the runs and the windows come from the input.
import { addDays } from '../dates.ts'
import { dayRulesIn, disruptionPlan, isDisruptedWeek, restartFraction } from './disruption.ts'
import { plannedMinOf } from './limits.ts'
import { P } from './params/index.ts'
import { isLoadingWeek, isProgrammeWeek } from './startWeeks.ts'
import type { BreakWeek, EngineInput } from './types.ts'

/** The flag of the week that repeats a loading week after one that counted as the recovery week. */
export const BREAK_REPEAT_FLAG = 'break-repeat'

/**
 * The short weeks that stay part weeks at the re-plan of `monday`: the week the input names as the
 * recovery week, and the week before every stored break-repeat week, since the flag is set only on
 * the week after the short week. Without the stored flag the short week would read as a plain
 * baseline from the second Monday after it on, and the weeks after the repeat would be held to a
 * ramp from its minutes [rule G-6]. Reads the flag and never decides: `breakWeekOf` stays the one
 * predicate. Sorted and without duplicates.
 */
export function breakPartWeeks(
  input: Pick<EngineInput, 'breakWeek' | 'existing'>,
  monday: string,
): string[] {
  const weeks = new Set<string>()
  if (input.breakWeek !== undefined && input.breakWeek.weekStart < monday) {
    weeks.add(input.breakWeek.weekStart)
  }
  for (const w of input.existing?.weeks ?? []) {
    if (w.flags.includes(BREAK_REPEAT_FLAG) && w.weekStart <= monday)
      weeks.add(addDays(w.weekStart, -7))
  }
  return [...weeks].sort()
}

/**
 * Whether the week of `weekStart` counts as the cycle's recovery week, and what its repeat may hold.
 * The week is a loading week of the stored plan (never a recovery, taper, race, post-race or
 * start-programme week, and none a window touched), it was run (a week with no running is sized by
 * the break rules, RF1), and the minutes run are at or under the share of its planned minutes.
 * `layoffDays` is the days since the last run, which J7 turns into the share of the planned week the
 * repeat may hold; the limits of G-1 and G-2 bind the repeat after that, measured from the last
 * loading week run before the break. Null when the week does not count.
 */
export function breakWeekOf(
  input: Pick<EngineInput, 'existing' | 'disruptions'>,
  weekStart: string,
  ranMin: number,
  layoffDays: number,
): BreakWeek | null {
  const week = input.existing?.weeks.find((w) => w.weekStart === weekStart)
  if (week === undefined || !isLoadingWeek(week) || isDisruptedWeek(week.flags)) return null
  if (week.flags.includes(BREAK_REPEAT_FLAG)) return null
  // the week after it must be one that can repeat the loading week: a loading or a recovery week of
  // the build, never a taper, race, post-race or programme week, or none
  const next = input.existing?.weeks.find((w) => w.weekStart === addDays(weekStart, 7))
  if (next === undefined || next.isTaper || next.phase === 'race') return null
  if (next.flags.includes('post-race') || isProgrammeWeek(next.flags)) return null
  const plannedMin = plannedMinOf(week)
  if (plannedMin <= 0 || ranMin <= 0) return null
  if (ranMin > plannedMin * P.e3.breakWeekMaxShare.value + 1e-9) return null
  const windows = disruptionPlan(input.disruptions ?? [])
  if (dayRulesIn(windows, { from: weekStart, to: addDays(weekStart, 6) }).length > 0) return null
  return {
    weekStart,
    plannedMin,
    ranMin,
    capMin: Math.round(plannedMin * restartFraction(layoffDays)),
  }
}
