// The data-health block of the Today payload (phase 3a design 7.4): three counts the page used to
// work out in the browser from four separate reads (activities, weeks, reviews, plan), and the
// notes that registered producers add (E3: sync paused, weekly update not run; E1: tomorrow's
// session not on the watch). The counts read the athlete snapshot only; a producer receives the
// snapshot too and may read a table of its own.
import { addDays, mondayOf } from '../../shared/dates.ts'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import { aggregateWeeks } from '../../shared/domain/weeks.ts'
import type { HealthNote, TodayHealth } from '../../shared/types.ts'
import { publishable } from '../../shared/workouts/labels.ts'
import type { Deps } from '../app.ts'
import { createLogger } from '../logger.ts'
import { safeMessage } from './syncLog.ts'
import type { AthleteContext } from './athleteState.ts'

/** Days of activities the duplicate count looks at: the window the Today page used to request. */
export const HEALTH_ACTIVITY_DAYS = 90
/** Weeks the unconfirmed-weeks count looks at, this week included: the old chart window. */
export const HEALTH_WEEKS = 12

/**
 * The counts, as of the snapshot's day. They are about the data, not about the viewed day, so a
 * preview of tomorrow carries today's counts.
 *
 * - `possibleDuplicates`: runs flagged `possible` in the last `HEALTH_ACTIVITY_DAYS` days.
 * - `pastUnconfirmedWeeks`: plan weeks among the last `HEALTH_WEEKS - 1` finished weeks whose
 *   review is not marked complete (a week with no stored review counts).
 * - `lastWeekReady`: last week has a plan week or a logged run and has not been reviewed.
 */
export function healthCounts(context: AthleteContext): Omit<TodayHealth, 'notes'> {
  const today = context.asOf
  const thisWeek = mondayOf(today)
  const lastWeek = addDays(thisWeek, -7)
  const planWeekStarts = new Set((context.existing()?.weeks ?? []).map((week) => week.weekStart))
  const reviewByWeek = new Map(context.reviews.map((review) => [review.weekStart, review]))

  const since = addDays(today, 1 - HEALTH_ACTIVITY_DAYS)
  const possibleDuplicates = context.activities.filter(
    (activity) => activity.date >= since && activity.duplicateStatus === 'possible',
  ).length

  let pastUnconfirmedWeeks = 0
  for (let back = 1; back < HEALTH_WEEKS; back += 1) {
    const weekStart = addDays(thisWeek, -7 * back)
    if (planWeekStarts.has(weekStart) && reviewByWeek.get(weekStart)?.dataStatus !== 'complete') {
      pastUnconfirmedWeeks += 1
    }
  }

  const lastWeekHasData =
    planWeekStarts.has(lastWeek) ||
    (aggregateWeeks(context.activities, [lastWeek])[0]?.runSessions ?? 0) > 0
  const lastWeekReady = lastWeekHasData && (reviewByWeek.get(lastWeek)?.reviewedAt ?? null) === null

  return { possibleDuplicates, pastUnconfirmedWeeks, lastWeekReady }
}

// ---------------------------------------------------------------------------------------------
// Note producers
// ---------------------------------------------------------------------------------------------

export interface HealthNoteArgs {
  deps: Deps
  userId: string
  /** The viewed day. */
  date: string
  context: AthleteContext
}

/**
 * Returns the notes it has for this runner, as template ids and slots (never prose). It reads the
 * snapshot or its own table and never the network. A throw or a rejection loses that producer's
 * notes only.
 */
export type HealthNoteProducer = (args: HealthNoteArgs) => HealthNote[] | Promise<HealthNote[]>

const producers: HealthNoteProducer[] = []

/**
 * Adds a producer; the notes of all producers come out in registration order. Returns the function
 * that removes it again, which tests use. A producer that reads a table the data version does not
 * cover registers a change stamp too (`registerTodayStamp` in `today.ts`), or the page's ETag
 * would hide its notes.
 */
export function registerHealthNoteProducer(producer: HealthNoteProducer): () => void {
  producers.push(producer)
  return () => {
    const at = producers.indexOf(producer)
    if (at >= 0) producers.splice(at, 1)
  }
}

/**
 * E1: tomorrow's run is not on the watch. Reads the publications of the sessions the plan has for
 * tomorrow (a table the data version does not cover, so `publish.ts` registers a change stamp for
 * it) and notes one that failed, is waiting for a retry or was sent with a Garmin Connect error.
 * Nothing is said for a session the runner deleted in intervals.icu, or for one that has not been
 * tried yet (the next run, within minutes, does that). Turning publishing off marks every row
 * withdrawn, so a runner who is not publishing has no row that qualifies and costs no extra read
 * when tomorrow holds no run.
 */
export const tomorrowNotOnWatch: HealthNoteProducer = async ({ deps, userId, context }) => {
  const { prisma } = deps
  // The channel name of the intervals.icu publisher (`CHANNEL` in `publish.ts`, which imports this
  // module and so cannot be imported here).
  const channel = 'intervals'
  const tomorrow = addDays(context.asOf, 1)
  const sessions = context.planSessions.filter(
    (s) => s.date === tomorrow && publishable(s.kind) && isToRun(s.status),
  )
  if (sessions.length === 0) return []
  const rows = await prisma.wristPublication.findMany({
    where: { userId, channel, externalId: { in: sessions.map((s) => s.externalId) } },
    select: { state: true, deviceMessage: true },
  })
  const problem = rows.some(
    (row) =>
      row.state === 'failed' ||
      row.state === 'pending' ||
      (row.state === 'sent' && row.deviceMessage !== null),
  )
  return problem
    ? [
        {
          code: 'wrist-tomorrow',
          template: 'publish.wrist.note-tomorrow',
          slots: {},
          href: '/plan',
        },
      ]
    : []
}

/** The notes of every registered producer. A failing producer is logged and skipped. */
export async function healthNotes(args: HealthNoteArgs): Promise<HealthNote[]> {
  const settled = await Promise.allSettled(producers.map(async (producer) => producer(args)))
  const notes: HealthNote[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      notes.push(...result.value)
    } else {
      createLogger(args.deps.config).warn(
        { reason: safeMessage(result.reason) },
        'a Today health-note producer failed',
      )
    }
  }
  return notes
}

/** The health block: the counts of the snapshot and the notes of the producers. */
export async function todayHealth(args: HealthNoteArgs): Promise<TodayHealth> {
  return { ...healthCounts(args.context), notes: await healthNotes(args) }
}
