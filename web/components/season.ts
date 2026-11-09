// What the season strip on the Plan page reads out of the stored plan: the weeks it has run so far,
// the runs of phase names it brackets, and the marks on the weeks. Pure; the figures are the
// plan's, as the week table prints them.
import type { SeasonRun } from '../../shared/copy/season.ts'
import { addDays } from '../../shared/dates.ts'
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

/** Round steps for the hour axis, in hours; the axis has two steps above zero (three ticks). */
const AXIS_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 100]
/** The tallest week sits this far under the top tick, so the race flag over it stays inside. */
const AXIS_HEADROOM = 1.1

/**
 * The y axis of the strip: three round ticks (0, half and the top, as the chart rules give a chart
 * this low) whose top is the smallest round figure at least a tenth above the tallest week, in
 * hours.
 */
export function hourAxis(peakHours: number): { max: number; ticks: number[] } {
  const need = Math.max(0, peakHours) * AXIS_HEADROOM
  const step =
    AXIS_STEPS.find((candidate) => candidate * 2 >= need) ?? Math.ceil(need / 2 / 100) * 100
  return { max: step * 2, ticks: [0, step, step * 2] }
}

/** The most month labels the time axis carries at a phone's width. */
const MAX_MONTH_LABELS = 5
/** What a letter of a month label takes at 16 px text, the tick before it, and the least space between two. */
const MONTH_CHAR_PX = 7
const MONTH_TICK_PX = 4
const MONTH_GAP_PX = 8

export interface MonthMark {
  /** The plan week the label stands at. */
  index: number
  /** 0 for January. */
  month: number
  /** The year of the week, drawn on a second line at the first label and at each January. */
  year: number
  showYear: boolean
  /** True when the label would run past the plot's right edge and is set against it instead. */
  end: boolean
}

export interface MonthMarkOptions {
  /** The text size against 16 px: a label is as wide as its letters. 1 when not given. */
  scale?: number
  /** The plan week of the race, whose month is always labelled, or null. */
  raceIndex?: number | null
}

/** The date a week belongs to by its Thursday, as the ISO week does. */
const thursdayOf = (weekStart: string): string => addDays(weekStart, 3)

/**
 * The month labels of the time axis: the first week and each week where the month turns. The first
 * month and the race month always stay; the others are thinned to every second, third... one until
 * at most five remain and none overlaps another. A label that would run past the plot is dropped,
 * except the race month's, which is set against the right edge. `width` is the plot's px for
 * `weekStarts.length` columns.
 */
export function monthMarks(
  weekStarts: readonly string[],
  width: number,
  { scale = 1, raceIndex = null }: MonthMarkOptions = {},
): MonthMark[] {
  const count = weekStarts.length
  if (count === 0 || width <= 0) return []
  const band = width / count
  const candidates: MonthMark[] = []
  weekStarts.forEach((weekStart, index) => {
    const day = thursdayOf(weekStart)
    const month = Number(day.slice(5, 7)) - 1
    const before = thursdayOf(weekStarts[index - 1] ?? weekStart)
    if (index === 0 || month !== Number(before.slice(5, 7)) - 1) {
      candidates.push({
        index,
        month,
        year: Number(day.slice(0, 4)),
        showYear: index === 0 || month === 0,
        end: false,
      })
    }
  })
  const widthOf = (mark: MonthMark) =>
    ((mark.showYear ? 4 : 3) * MONTH_CHAR_PX + MONTH_TICK_PX) * scale
  const leftOf = (mark: MonthMark) => (mark.end ? width - widthOf(mark) : mark.index * band)
  const raceCandidate =
    raceIndex === null ? -1 : candidates.findLastIndex((mark) => mark.index <= raceIndex)

  for (let stride = 1; stride <= candidates.length; stride += 1) {
    const chosen: MonthMark[] = []
    candidates.forEach((candidate, position) => {
      const kept = position === 0 || position === raceCandidate
      if (position % stride !== 0 && !kept) return
      if (candidate.index * band + widthOf(candidate) <= width) {
        chosen.push(candidate)
      } else if (position === raceCandidate) {
        chosen.push({ ...candidate, end: true })
      }
    })
    const apart = chosen.every((mark, position) => {
      const previous = chosen[position - 1]
      return (
        previous === undefined ||
        leftOf(mark) - leftOf(previous) - widthOf(previous) >= MONTH_GAP_PX
      )
    })
    if (chosen.length <= MAX_MONTH_LABELS && apart) return chosen
  }
  // Two kept labels that cannot both fit: the race month's alone says where the plan ends.
  const race = candidates[raceCandidate]
  if (race !== undefined) return [{ ...race, end: race.index * band + widthOf(race) > width }]
  return candidates.slice(0, 1)
}

/**
 * The brackets under the bars as columns: where each phase run starts (1-based, as a grid column)
 * and how many weeks it spans.
 */
export function bracketSpans(
  runs: ReadonlyArray<{ weeks: number }>,
): Array<{ start: number; span: number }> {
  let start = 1
  return runs.map((run) => {
    const placed = { start, span: run.weeks }
    start += run.weeks
    return placed
  })
}

/** The compact chart's plot margin in px: the page's axis ticks are laid against the same figures. */
export const SEASON_PLOT_MARGIN = { top: 4, right: 0, bottom: 9, left: 0 } as const
