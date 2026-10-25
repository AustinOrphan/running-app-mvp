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

export interface WeekStripInput {
  /** The runner's local day; the strip is the Monday to Sunday week that contains it. */
  today: string
  /** Sessions of the plan; those dated outside the week are ignored. */
  sessions: readonly PlanSessionView[]
  /** Activities; those outside the week and flagged duplicates are ignored. */
  activities: readonly WeekCore[]
  /** The plan week's run target in minutes, or null outside the plan. */
  targetRunMin: number | null
}

/**
 * The week strip for the week containing `today`. Run minutes count `run` activities, as the week
 * rows (`aggregateWeeks`) do, and leave out flagged duplicates. Throws a RangeError for a
 * malformed `today`.
 */
export function weekStrip(input: WeekStripInput): WeekStrip {
  const { today, targetRunMin } = input
  const weekStart = mondayOf(today)
  const dates = Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDays(weekStart, i))
  const weekEnd = dates[DAYS_IN_WEEK - 1]!

  const runSecByDate = new Map<string, number>()
  for (const activity of input.activities) {
    if (activity.type !== 'run') continue
    if (activity.duplicateStatus === 'possible' || activity.duplicateStatus === 'confirmed')
      continue
    if (activity.date < weekStart || activity.date > weekEnd) continue
    runSecByDate.set(activity.date, (runSecByDate.get(activity.date) ?? 0) + activity.durationSec)
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
    const marks = new Set(
      sessions
        .filter((s) => !NOT_A_RUN.has(s.kind))
        .map((s) => sessionMark(s.status, date, today, runMin)),
    )
    return { date, mark: dayMark(marks), isToday: date === today, runMin, sessions }
  })

  let totalSec = 0
  for (const sec of runSecByDate.values()) totalSec += sec
  const runMin = Math.round(totalSec / 60)
  return {
    weekStart,
    days,
    runMin,
    targetRunMin,
    remaining:
      targetRunMin === null
        ? null
        : remainingPlan({ today, weekStart, targetRunMin, runMinSoFar: runMin }),
    distanceEstimateM: weekDistanceEstimateM(days.flatMap((day) => day.sessions)),
  }
}
