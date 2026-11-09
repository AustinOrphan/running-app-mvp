// The week strip on Today: seven days, Monday first, each with a mark, and the run time logged so
// far against the plan week's target. Pure: `today` is an argument.
//
// The strip describes; it never grades. A past day with a run still to be done and no run logged
// reads "planned, no run logged" (`unlogged`), and every mark is neutral.
import { addDays, mondayOf } from '../dates.ts'
import { weekDistanceEstimateM } from '../engine/distanceEstimate.ts'
import type { SessionKind } from '../engine/types.ts'
import type {
  PlanSessionStatus,
  PlanSessionView,
  WeekStrip,
  WeekStripDay,
  WeekStripMark,
} from '../types.ts'
import { remainingPlan } from './adaptation.ts'
import { isToRun } from './sessionStatus.ts'
import type { WeekCore } from './weeks.ts'

/**
 * What a session's status says about its day. One exhaustive map, so a status added to
 * `PlanSessionStatus` is a compile error here until it has a mark. A status
 * that is still to run (`isToRun`) reads `planned` here; the date decides what that means.
 */
const STATUS_MARK: Record<PlanSessionStatus, WeekStripMark> = {
  planned: 'planned',
  moved: 'planned',
  downgraded: 'planned',
  adjusted: 'planned',
  completed: 'done',
  partial: 'partial',
  skipped: 'skipped',
}

/** Sessions that are not a run: they never colour a day. */
const NOT_A_RUN: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'strength',
  'mobility',
  'rest',
  'cross',
])

const DAYS_IN_WEEK = 7

/**
 * The mark of one session on `date`. A settled session keeps its status mark. A session still to
 * run is `planned` from today on; on a past day it is `done` when a run was logged that day
 * (the activity is not matched to it yet) and `unlogged` when none was.
 */
function sessionMark(
  status: PlanSessionStatus,
  date: string,
  today: string,
  runMin: number,
): WeekStripMark {
  const mark = STATUS_MARK[status]
  if (!isToRun(status) || date >= today) return mark
  return runMin > 0 ? 'done' : 'unlogged'
}

/** The mark of a day from the marks of its run sessions; a day with none is `free`. */
function dayMark(marks: ReadonlySet<WeekStripMark>): WeekStripMark {
  if (marks.size === 0) return 'free'
  if (marks.has('planned')) return 'planned'
  if (marks.has('unlogged')) return 'unlogged'
  if (marks.has('partial') || (marks.has('done') && marks.has('skipped'))) return 'partial'
  return marks.has('skipped') ? 'skipped' : 'done'
}

/** The minutes logged on a day that the strip draws: runs and a race (`WeekStripDay.raceMin`). */
export function loggedMin(day: Pick<WeekStripDay, 'runMin' | 'raceMin'>): number {
  return day.runMin + (day.raceMin ?? 0)
}

export interface WeekStripInput {
  /** The runner's local day; the strip is the Monday to Sunday week that contains it. */
  today: string
  /** Sessions of the plan; those dated outside the week are ignored. */
  sessions: readonly PlanSessionView[]
  /** Activities; those outside the week and flagged duplicates are ignored. */
  activities: readonly WeekCore[]
  /**
   * The plan week's run target in minutes, or null outside the plan. A week run past its plan is
   * given at the planned minutes, not the raised stored target (`plannedWeek`).
   */
  targetRunMin: number | null
  /** The plan week was run past its plan and taken as run. Defaults to false. */
  overshoot?: boolean
}

/**
 * The week strip for the week containing `today`. Run minutes count `run` activities, as the week
 * rows (`aggregateWeeks`) do, and leave out flagged duplicates. A logged race is kept apart in
 * `raceMin`: it is not in the week's run minutes, but the day's mark and bars count it. Throws a RangeError for a
 * malformed `today`.
 */
export function weekStrip(input: WeekStripInput): WeekStrip {
  const { today, targetRunMin } = input
  const weekStart = mondayOf(today)
  const dates = Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(weekStart, i))
  const weekEnd = dates[DAYS_IN_WEEK - 1]!

  const runSecByDate = new Map<string, number>()
  const raceSecByDate = new Map<string, number>()
  for (const activity of input.activities) {
    if (activity.type !== 'run' && activity.type !== 'race') continue
    if (activity.duplicateStatus === 'possible' || activity.duplicateStatus === 'confirmed')
      continue
    if (activity.date < weekStart || activity.date > weekEnd) continue
    const into = activity.type === 'run' ? runSecByDate : raceSecByDate
    into.set(activity.date, (into.get(activity.date) ?? 0) + activity.durationSec)
  }

  const sessionsByDate = new Map<string, PlanSessionView[]>()
  for (const session of input.sessions) {
    if (session.date < weekStart || session.date > weekEnd) continue
    const day = sessionsByDate.get(session.date) ?? []
    day.push(session)
    sessionsByDate.set(session.date, day)
  }

  const days: WeekStripDay[] = dates.map((date) => {
    const sessions = [...(sessionsByDate.get(date) ?? [])].sort((a, b) => a.order - b.order)
    const runMin = Math.round((runSecByDate.get(date) ?? 0) / 60)
    const raceMin = Math.round((raceSecByDate.get(date) ?? 0) / 60)
    const marks = new Set(
      sessions
        .filter((s) => !NOT_A_RUN.has(s.kind))
        .map((s) => sessionMark(s.status, date, today, runMin + raceMin)),
    )
    return { date, mark: dayMark(marks), isToday: date === today, runMin, raceMin, sessions }
  })

  let totalSec = 0
  for (const sec of runSecByDate.values()) totalSec += sec
  const runMin = Math.round(totalSec / 60)
  return {
    weekStart,
    days,
    runMin,
    targetRunMin,
    overshoot: input.overshoot ?? false,
    remaining:
      targetRunMin === null
        ? null
        : remainingPlan({ today, weekStart, targetRunMin, runMinSoFar: runMin }),
    distanceEstimateM: weekDistanceEstimateM(days.flatMap((day) => day.sessions)),
  }
}

export interface WeekAdvisoryGate {
  /** A pain, illness or injury window is open. */
  windowOpen: boolean
  /** The kind of the day's main session; null when nothing is planned. */
  heroKind: SessionKind | null
  /** The readiness verdict's code, or null when the day has none. */
  verdictCode: string | null
}

/**
 * Whether the week strip may say what reaching the weekly target would take. The line is a sketch,
 * not a quota, so it stays out of the days when the plan itself asks for less: a window is open,
 * the day is a rest day, or readiness says an easy run, a rest day or a lighter week is the better
 * choice.
 */
export function showWeekAdvisory(gate: WeekAdvisoryGate): boolean {
  if (gate.windowOpen) return false
  if (gate.heroKind === 'rest') return false
  return (
    gate.verdictCode !== 'easy' &&
    gate.verdictCode !== 'rest' &&
    gate.verdictCode !== 'lighter-week'
  )
}

/**
 * The minutes of run sessions still to do from today to Sunday, as the plan stands: a description
 * of what is planned, not what the target would take. Strength, mobility, cross and rest sessions
 * are not run time and are left out, as are sessions already done, skipped or moved away.
 */
export function plannedRestOfWeekMin(strip: Pick<WeekStrip, 'days'>): number {
  let total = 0
  let reached = false
  for (const day of strip.days) {
    if (day.isToday) reached = true
    if (!reached) continue
    for (const session of day.sessions) {
      if (!NOT_A_RUN.has(session.kind) && isToRun(session.status)) total += session.durationMin
    }
  }
  return total
}

/** One day's column of the week bars: minutes, and the heights as shares of the week's tallest bar. */
export interface WeekBar {
  date: string
  plannedMin: number
  runMin: number
  /** 0 to 1 of the tallest bar of the week; 0 for no minutes. */
  plannedShare: number
  runShare: number
}

/**
 * The week as proportional bars: each day's planned run minutes (the day's run sessions, supporting
 * work left out) as the outline and the run minutes logged as the solid bar, both against the
 * week's largest figure. A week with no minutes has every share 0. Planned minutes describe the
 * plan; a day with more run than plan simply has the taller solid bar.
 */
export function weekBars(strip: Pick<WeekStrip, 'days'>): WeekBar[] {
  const days = strip.days.map((day) => ({
    date: day.date,
    runMin: loggedMin(day),
    plannedMin: day.sessions
      .filter((s) => !NOT_A_RUN.has(s.kind))
      .reduce((sum, s) => sum + s.durationMin, 0),
  }))
  const tallest = Math.max(0, ...days.map((d) => Math.max(d.plannedMin, d.runMin)))
  const share = (min: number): number => (tallest === 0 ? 0 : min / tallest)
  return days.map((d) => ({
    ...d,
    plannedShare: share(d.plannedMin),
    runShare: share(d.runMin),
  }))
}
