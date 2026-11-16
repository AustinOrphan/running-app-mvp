import { clockInZone, isoDateInZone } from '../shared/dates.ts'
import { isValidTimezone } from '../shared/domain/timezone.ts'
import type { PrismaClient } from './db.ts'

/**
 * A runner's day (D10, ADR 0022): the calendar date in the runner's zone. `now` is read once, so a
 * request or a job that straddles midnight never mixes two days.
 */
export interface RunnerDay {
  tz: string
  today: string
  now: Date
}

/** The server's IANA zone (`TZ`): the fallback zone, the backup slot's zone and the log clock's. */
export function serverTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/**
 * The zone a runner has chosen: the stored zone as stored (never canonicalised: `Intl` resolves
 * `Etc/UTC` to `UTC`, and `Etc/UTC` is how a runner asks for UTC days) when the server's ICU knows
 * it and it is not the literal `'UTC'`; otherwise null. `'UTC'` is the column default and already
 * reads as "not chosen" on the Profile page, so it, no profile row and an unknown zone all mean
 * the runner has not chosen.
 */
export function chosenZone(stored: string | null | undefined): string | null {
  if (stored === null || stored === undefined) return null
  if (stored === 'UTC' || !isValidTimezone(stored)) return null
  return stored
}

/**
 * Called once per process and runner for a stored zone the server's ICU rejects, with the runner's
 * id and nothing else. `server/index.ts` points it at the logger; unset, nothing is reported.
 */
let unknownZoneReporter: ((userId: string) => void) | null = null
const reportedUnknown = new Set<string>()

export function setUnknownZoneReporter(report: ((userId: string) => void) | null): void {
  unknownZoneReporter = report
  reportedUnknown.clear()
}

/**
 * The zone a runner's days follow (D10 step 5, ADR 0022): `chosenZone(stored)` when the runner has
 * chosen one, the server's zone otherwise. A stored zone the server's ICU rejects reads as not
 * chosen and is reported once per process (`userId` names whose, when the caller has it).
 */
export function runnerZone(stored: string | null | undefined, userId?: string): string {
  const chosen = chosenZone(stored)
  if (chosen !== null) return chosen
  if (
    userId !== undefined &&
    stored !== null &&
    stored !== undefined &&
    stored !== 'UTC' &&
    !reportedUnknown.has(userId)
  ) {
    reportedUnknown.add(userId)
    unknownZoneReporter?.(userId)
  }
  return serverTimeZone()
}

/** The runner's day at `now` for a stored zone. */
export function runnerDay(
  now: Date,
  stored: string | null | undefined,
  userId?: string,
): RunnerDay {
  const tz = runnerZone(stored, userId)
  return { tz, today: isoDateInZone(now, tz), now }
}

/** The runner's day, reading the stored zone. */
export async function loadRunnerDay(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<RunnerDay> {
  const profile = await prisma.athleteProfile.findUnique({
    where: { userId },
    select: { timezone: true },
  })
  return runnerDay(now, profile?.timezone, userId)
}

/** The day of each runner in `userIds` (every runner when omitted), from one query. */
export async function runnerDays(
  prisma: PrismaClient,
  now: Date,
  userIds?: string[],
): Promise<Map<string, RunnerDay>> {
  const users = await prisma.user.findMany({
    ...(userIds === undefined ? {} : { where: { id: { in: userIds } } }),
    select: { id: true, profile: { select: { timezone: true } } },
  })
  return new Map(users.map((user) => [user.id, runnerDay(now, user.profile?.timezone, user.id)]))
}

const SAMPLE_START = Date.UTC(2026, 0, 1, 0, 7)
const SAMPLE_DAYS = 366

/**
 * True when two zone names keep the same wall clock at every sample instant of a year (one a day,
 * at an odd minute), so aliases (`Asia/Kolkata` and `Asia/Calcutta`, `Etc/UTC` and `UTC`) read as
 * one zone while zones that differ in offset or in daylight saving do not.
 */
function sameClock(a: string, b: string): boolean {
  if (a === b) return true
  for (let day = 0; day < SAMPLE_DAYS; day += 1) {
    const at = new Date(SAMPLE_START + day * 86_400_000 + (day % 24) * 3_600_000)
    const x = clockInZone(at, a)
    const y = clockInZone(at, b)
    if (x.date !== y.date || x.minute !== y.minute) return false
  }
  return true
}

/**
 * Which runners' days moved when D10's step 5 made `runnerZone` follow the stored zone (the
 * start-up line): `moving` have chosen a zone other than the server's; `unset` have chosen none and keep the
 * server's. A runner who chose the server's own zone, under any alias of its name, is in neither.
 */
export async function zoneCutoverReport(
  prisma: PrismaClient,
): Promise<{ moving: string[]; unset: number }> {
  const users = await prisma.user.findMany({
    select: { id: true, profile: { select: { timezone: true } } },
    orderBy: { id: 'asc' },
  })
  const server = serverTimeZone()
  const moving: string[] = []
  let unset = 0
  for (const user of users) {
    const zone = chosenZone(user.profile?.timezone)
    if (zone === null) unset += 1
    else if (!sameClock(zone, server)) moving.push(user.id)
  }
  return { moving, unset }
}

/** The one start-up line of `zoneCutoverReport`; ids only, no email and no zone. */
export function describeZoneCutover(report: { moving: string[]; unset: number }): string {
  const moving =
    report.moving.length === 0
      ? '0 runners'
      : `${report.moving.length} runner(s) (${report.moving.join(', ')})`
  return `D10: ${moving} will follow a zone other than the server's; ${report.unset} runner(s) have no zone chosen and keep the server's day`
}
