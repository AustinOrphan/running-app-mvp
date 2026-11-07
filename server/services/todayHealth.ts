// The data-health block of the Today payload (phase 3a design 7.4): three counts the page used to
// work out in the browser from four separate reads (activities, weeks, reviews, plan), and the
// notes that registered producers add (E3: sync paused, weekly update not run; E1: tomorrow's
// session not on the watch; J10: a source that needs signing in or has stored no run for days). The
// counts read the athlete snapshot only; a producer receives the snapshot too and may read a table
// of its own. The producers of the job-log notes and of the source notes are registered at the end
// of this file, and their ETag stamps in `today.ts`.
import { addDays, daysBetween, mondayOf, todayIso } from '../../shared/dates.ts'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import { aggregateWeeks } from '../../shared/domain/weeks.ts'
import { P } from '../../shared/engine/params/index.ts'
import { RUN_KINDS } from '../../shared/engine/sessions.ts'
import type { HealthNote, TodayHealth } from '../../shared/types.ts'
import { publishable } from '../../shared/workouts/labels.ts'
import type { Deps } from '../app.ts'
import { REPLAN_SLOT, weekSlotStart, weeklyUpdateStatus } from '../jobs/weeklyUpdate.ts'
import { createLogger } from '../logger.ts'
import { PROVIDERS } from '../providers/registry.ts'
import type { PrismaClient } from '../db.ts'
import { latestJobRuns, safeMessage } from './syncLog.ts'
import type { AthleteContext } from './athleteState.ts'
import { readWristItems } from './wristItems.ts'

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
 * tomorrow through `readWristItems`, the read the Plan page and Today's watch line use, so the note
 * and the strip word a session alike: the note is made for a session whose item is `waiting` (a
 * pending send, a failure that will be retried, a send that moved with the session) or
 * `not-delivered` (a failure that waits for "Send again", a send with a Garmin Connect error). The
 * rows are in a table the data version does not cover, so `publish.ts` registers a change stamp
 * for it. Nothing is said for a session the runner deleted in intervals.icu, or for one that has
 * not been tried yet (the next run, within minutes, does that). Turning publishing off marks every
 * row withdrawn, so a runner who is not publishing has no row that qualifies and costs no extra
 * read when tomorrow holds no run.
 */
export const tomorrowNotOnWatch: HealthNoteProducer = async ({ deps, userId, context }) => {
  const tomorrow = addDays(context.asOf, 1)
  const sessions = context.planSessions.filter(
    (s) => s.date === tomorrow && publishable(s.kind) && isToRun(s.status),
  )
  if (sessions.length === 0) return []
  const items = await readWristItems(deps.prisma, {
    userId,
    planSessions: context.planSessions,
    range: { from: tomorrow, to: tomorrow },
    today: context.asOf,
    // No item for a session that has no publication yet, and no read of the channel: the Garmin
    // tick only tells `sent` from `on-watch`, and neither is a problem.
    enabled: false,
    garminLinked: false,
    now: new Date(),
  })
  const stuck = new Set(sessions.map((s) => s.externalId))
  const problem = items.some(
    (item) =>
      stuck.has(item.externalId) && (item.status === 'waiting' || item.status === 'not-delivered'),
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

// ---------------------------------------------------------------------------------------------
// The notes about a source (J10: needs signing in, has stored no run for days)
// ---------------------------------------------------------------------------------------------

/** What a source can stand for: a provider that brings runs in by pull, push or folder scan. */
const RUN_CHANNELS: ReadonlySet<string> = new Set(['pull', 'push', 'folder'])

/** The activity types a source is silent about: its runs and its races. */
const RUN_TYPES = ['run', 'race']

/**
 * The `Activity.source` values that a provider's runs are stored under, where they differ from the
 * provider's key: the watched folder stores its activities as `file` (`ingest` in `folder.ts`;
 * only its `ImportBatch` carries `folder`). A hand-uploaded activity file is stored as `file` too,
 * so it counts as a delivery from the folder. A pull or push provider stores its runs under its
 * key (`sync.ts`, `routes/ingest.ts`), so it needs no row here.
 */
const STORED_AS: Readonly<Record<string, readonly string[]>> = { folder: ['file'] }

function storedAs(provider: string): string[] {
  return [...(STORED_AS[provider] ?? [provider])]
}

interface SourceRow {
  provider: string
  label: string
  status: string
  pausedUntil: Date | null
  createdAt: Date
}

/**
 * The runner's `Integration` rows for the providers that bring runs in, in the registry's display
 * order. `Integration` is outside the data version, so a reader of these rows adds the change stamp
 * `sourceNotesStamp`. A row of a provider that is no longer registered, or that only publishes or
 * uploads, is not a source of runs and is left out.
 */
async function sourceRows(prisma: PrismaClient, userId: string): Promise<SourceRow[]> {
  const labels = new Map(
    Object.values(PROVIDERS)
      .filter(({ info }) => info.channels.some((channel) => RUN_CHANNELS.has(channel)))
      .map(({ info }) => [info.key, info.label]),
  )
  const rows = await prisma.integration.findMany({
    where: { userId, provider: { in: [...labels.keys()] } },
    select: { provider: true, status: true, pausedUntil: true, createdAt: true },
  })
  const order = [...labels.keys()]
  return rows
    .map((row) => ({ ...row, label: labels.get(row.provider) ?? row.provider }))
    .sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider))
}

/** A pull that a rate limit paused has `pausedUntil` in the future. */
function isPaused(row: SourceRow, now: Date): boolean {
  return row.pausedUntil !== null && row.pausedUntil.getTime() > now.getTime()
}

/**
 * J10: a source whose connection needs signing in is named at once, and a connected source that
 * has stored no run for more than `j10.silentDays` days is named when the stored plan asked for
 * at least two runs since its last one. One note per source, each leading to the integrations page.
 * Nothing is said for a connection in `error` (the integrations page shows it), a source paused by
 * a rate limit, or a runner with no such connection. The sentence asks whether a run was made and
 * never says it was not: the runner may have rested, and a note that asks costs less than a plan
 * that waits (G6), so no other reader (the weekly decision, the layoff reading, the brief, the
 * review) looks at the silence.
 *
 * The newest run of a source is one row read by the `[userId, date]` index (`findFirst`, newest
 * date first), at most one per source and one source per provider that brings runs in, so five
 * rows at most. It is not a read of the engine window: that is a snapshot of every source at once,
 * which cannot say which source stored a run. A source that has stored none is counted from the
 * day it was connected. The notes carry the snapshot's day, so a day-ahead preview shows today's.
 */
export async function sourceHealthNotes({
  deps,
  userId,
  context,
}: HealthNoteArgs): Promise<HealthNote[]> {
  const { prisma } = deps
  const rows = await sourceRows(prisma, userId)
  if (rows.length === 0) return []
  const now = new Date()
  const today = context.asOf
  const silentDays = P.j10.silentDays.value
  const plannedRuns = (context.existing()?.sessions ?? [])
    .filter((session) => RUN_KINDS.has(session.kind) || session.kind === 'race')
    .map((session) => session.date)

  const notes = await Promise.all(
    rows.map(async (row): Promise<HealthNote | null> => {
      if (row.status === 'needs_auth') {
        return {
          code: 'source-needs-auth',
          template: 'today.health.source-needs-auth',
          slots: { source: row.label },
          href: '/integrations',
        }
      }
      if (row.status !== 'connected' || isPaused(row, now)) return null
      const newest = await prisma.activity.findFirst({
        where: { userId, source: { in: storedAs(row.provider) }, type: { in: RUN_TYPES } },
        orderBy: { date: 'desc' },
        select: { date: true },
      })
      const since = newest?.date ?? todayIso(row.createdAt)
      if (daysBetween(since, today) <= silentDays) return null
      if (plannedRuns.filter((date) => date > since && date <= today).length < 2) return null
      return {
        code: 'source-silent',
        template: 'today.health.source-silent',
        slots: { source: row.label, since: { kind: 'date', iso: since, style: 'short' } },
        href: '/integrations',
      }
    }),
  )
  return notes.filter((note) => note !== null)
}

/**
 * What moves the page's ETag for the source notes. `Integration` is outside the data version, so
 * each source's status, `pausedUntil` (and whether it is still in the future, which changes with
 * the clock and no write), and `createdAt` (the day a source with no run counts from) are read
 * here. The newest run of a source is not: `Activity` is a state model, so the data version already
 * moves for any run written, and a stamp of it would repeat that. A status that flips to
 * `needs_auth` with no other write moves the tag.
 */
export async function sourceNotesStamp({
  deps,
  userId,
}: {
  deps: Deps
  userId: string
}): Promise<string> {
  const { prisma } = deps
  const rows = await sourceRows(prisma, userId)
  if (rows.length === 0) return 'sources:none'
  const now = new Date()
  const parts = rows.map((row) =>
    [
      row.provider,
      row.status,
      row.pausedUntil === null ? 'none' : String(row.pausedUntil.getTime()),
      isPaused(row, now) ? 'paused' : 'open',
      String(row.createdAt.getTime()),
    ].join('.'),
  )
  return `sources:${parts.join(',')}`
}

registerHealthNoteProducer(jobHealthNotes)
registerHealthNoteProducer(sourceHealthNotes)
