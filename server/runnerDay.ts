import { isoDateInZone } from '../shared/dates.ts'
import { isValidTimezone } from '../shared/domain/timezone.ts'
import type { PrismaClient } from './db.ts'

/**
 * A runner's day (D10, ADR 0021): the calendar date in the runner's zone. `now` is read once, so a
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
 * The zone a runner's days follow. Step 5 of D10 makes this `chosenZone(stored) ?? serverTimeZone()`;
 * until then every runner's day is the server's, so no day changes.
 */
export function runnerZone(stored: string | null | undefined): string {
  void stored
  return serverTimeZone()
}

/** The runner's day at `now` for a stored zone. */
export function runnerDay(now: Date, stored: string | null | undefined): RunnerDay {
  const tz = runnerZone(stored)
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
  return runnerDay(now, profile?.timezone)
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
  return new Map(users.map((user) => [user.id, runnerDay(now, user.profile?.timezone)]))
}

/**
 * Which runners' days will move when D10's step 5 makes `runnerZone` follow the stored zone:
 * `moving` have chosen a zone other than the server's; `unset` have chosen none and keep the
 * server's. A runner who chose the server's own zone is in neither.
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
    else if (zone !== server) moving.push(user.id)
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
