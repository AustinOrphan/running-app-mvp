// The data-health block of the Today payload (phase 3a design 7.4): three counts the page used to
// work out in the browser from four separate reads (activities, weeks, reviews, plan), and the
// notes that registered producers add (E3: sync paused, weekly update not run; E1: tomorrow's
// session not on the watch). The counts read the athlete snapshot only; a producer receives the
// snapshot too and may read a table of its own. The producer of the two notes of the job log is
// registered at the end of this file, and its ETag stamp in `today.ts`.
import { addDays, mondayOf } from '../../shared/dates.ts'
import { aggregateWeeks } from '../../shared/domain/weeks.ts'
import type { HealthNote, TodayHealth } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { REPLAN_SLOT, weekSlotStart, weeklyUpdateStatus } from '../jobs/scheduler.ts'
import { createLogger } from '../logger.ts'
import { latestJobRuns, safeMessage } from './syncLog.ts'
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

// ---------------------------------------------------------------------------------------------
// The notes of the job log (E3: sync paused, weekly update not run)
// ---------------------------------------------------------------------------------------------

/**
 * "Sync is paused" when the latest run of the sync job ended paused, and "This week's plan update
 * has not run yet" when the weekly update is due (`weeklyUpdateStatus`, the same answer as
 * `GET /api/jobs`). The two sentences are templates; neither carries a slot.
 */
export async function jobHealthNotes({ deps, userId }: HealthNoteArgs): Promise<HealthNote[]> {
  const { prisma } = deps
  const [jobs, weekly] = await Promise.all([
    latestJobRuns(prisma, userId),
    weeklyUpdateStatus(prisma, userId, new Date()),
  ])
  const notes: HealthNote[] = []
  if (jobs.some((job) => job.provider === 'sync' && job.status === 'paused')) {
    notes.push({
      code: 'sync-paused',
      template: 'today.health.sync-paused',
      slots: {},
      href: '/integrations',
    })
  }
  if (weekly.due) {
    notes.push({
      code: 'weekly-update-not-run',
      template: 'today.health.update-not-run',
      slots: {},
      href: '/plan',
    })
  }
  return notes
}

/**
 * What moves the page's ETag for the two notes above. `SyncRun` is outside the data version, so the
 * status of the latest sync run is read here: one indexed row. Whether the weekly update is due
 * depends on the plan, its revisions and the goal date, which the data version and the day already
 * cover, and on the clock, which this adds as the start of this week's update slot: it changes
 * once a week, when the slot comes, and moves the tag without any write.
 */
export async function jobNotesStamp({
  deps,
  userId,
}: {
  deps: Deps
  userId: string
}): Promise<string> {
  const latest = await deps.prisma.syncRun.findFirst({
    where: { userId, channel: 'job', provider: 'sync' },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    select: { status: true },
  })
  const slot = weekSlotStart(new Date(), REPLAN_SLOT)
  return `jobs:${latest?.status === 'paused' ? 'paused' : 'ok'}:${slot === null ? 'none' : String(slot.getTime())}`
}

registerHealthNoteProducer(jobHealthNotes)
