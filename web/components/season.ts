// What the season strip on the Plan page reads out of the stored plan: the weeks it has run so far,
// the runs of phase names it brackets, and the marks on the weeks. Pure; the figures are the
// plan's, as the week table prints them.
import type { SeasonRun } from '../../shared/copy/season.ts'
import { shownTargetMin } from '../../shared/domain/plannedWeek.ts'
import type { PlanWeek } from '../../shared/types.ts'
import type { WeekMark } from './charts/WeeklyHoursChart.tsx'
import { plannedStrokeWidth } from './charts/theme.ts'
import { weekPhaseLabel } from './format.ts'

type PlanSpan = { weeks: readonly Pick<PlanWeek, 'weekStart'>[]; startDate: string }

/** Monday of the plan's first and last week; a plan with no weeks stands on its start date. */
export function planSpan(plan: PlanSpan): { first: string; last: string } {
  const first = plan.weeks[0]?.weekStart ?? plan.startDate
  const last = plan.weeks[plan.weeks.length - 1]?.weekStart ?? first
  return { first, last }
}

/**
 * The weeks to read the minutes run for: from the plan's first week to this Monday, held inside the
 * plan. The week table and the strip ask for the same range, so the page makes one request.
 */
export function actualRange(plan: PlanSpan, currentMonday: string): { from: string; to: string } {
  const { first, last } = planSpan(plan)
  const to = currentMonday < first ? first : currentMonday > last ? last : currentMonday
  return { from: first, to }
}

/** The race week itself, not a week after it (those keep the phase `race` and carry `post-race`). */
export function isRaceWeek(week: Pick<PlanWeek, 'phase' | 'flags'>): boolean {
  return week.phase === 'race' && !week.flags.includes('post-race')
}

/** A week after the race. */
export function isPostRace(week: Pick<PlanWeek, 'flags'>): boolean {
  return week.flags.includes('post-race')
}

/**
 * Runs of consecutive weeks that read the same phase name, in order: the groups the week table
 * heads and the strip brackets.
 */
export function seasonRuns(weeks: readonly PlanWeek[]): SeasonRun[] {
  const runs: SeasonRun[] = []
  for (const week of weeks) {
    const label = weekPhaseLabel(week)
    const run = runs[runs.length - 1]
    if (run?.label === label) {
      run.lastWeek = week.weekStart
      run.weeks += 1
    } else {
      runs.push({
        label,
        kind: isRaceWeek(week) ? 'race' : isPostRace(week) ? 'after' : 'phase',
        firstWeek: week.weekStart,
        lastWeek: week.weekStart,
        weeks: 1,
      })
    }
  }
  return runs
}

/** The marks the compact chart draws: this week, the race week, and the weeks after the race. */
export function seasonMarks(
  weeks: readonly PlanWeek[],
  currentMonday: string,
): Record<string, WeekMark> {
  return Object.fromEntries(
    weeks.map((week): [string, WeekMark] => [
      week.weekStart,
      {
        current: week.weekStart === currentMonday,
        race: isRaceWeek(week),
        muted: isPostRace(week),
      },
    ]),
  )
}

/** What the chart draws for each week: the plan's figure, and the minutes run where there are any. */
export function seasonFigures(
  weeks: readonly PlanWeek[],
  actual: ReadonlyMap<string, number>,
): {
  weeks: Array<{ weekStart: string; runMin: number }>
  planned: Array<{ weekStart: string; targetRunMin: number }>
} {
  return {
    weeks: weeks.map((week) => ({
      weekStart: week.weekStart,
      runMin: actual.get(week.weekStart) ?? 0,
    })),
    planned: weeks.map((week) => ({
      weekStart: week.weekStart,
      targetRunMin: shownTargetMin(week),
    })),
  }
}

/** The share of a week's column the outlined bar takes, and the limits of its width in px. */
const PLANNED_SHARE = 0.72
const PLANNED_MIN = 6
const PLANNED_MAX = 24
/** The solid bar is half the outline; both stay readable at the narrowest and the widest. */
const ACTUAL_MIN = 3
const ACTUAL_MAX = 12

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * The widths of the two bars for a column `band` px wide. The outline takes about three quarters of
 * its column, from 6 px at a phone's 11 px a week to 24 px on a wide screen; its floor gives way to
 * the column less the outline's own stroke, so the outlines of a long plan never touch. The solid
 * bar is half the outline and never wider than it.
 */
export function seasonBarSizes(band: number): { planned: number; actual: number } {
  const room = Math.max(1, Math.floor(band - plannedStrokeWidth))
  const planned = Math.min(room, Math.round(clamp(band * PLANNED_SHARE, PLANNED_MIN, PLANNED_MAX)))
  const actual = Math.min(planned, Math.round(clamp(planned / 2, ACTUAL_MIN, ACTUAL_MAX)))
  return { planned, actual }
}
