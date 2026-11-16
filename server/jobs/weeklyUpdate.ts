// The slot of the weekly plan update and whether this week's update is due. Today's health note
// (`todayHealth.ts`) reads these, and the scheduler imports the publisher, which registers with
// Today's modules at load: the helpers live here, below both, so that those imports form no cycle.
// `scheduler.ts` re-exports them for its callers.
import {
  addDays,
  clockInZone,
  instantAtWallTime,
  isoDateInZone,
  mondayOf,
} from '../../shared/dates.ts'
import type { WeeklyUpdateStatus } from '../../shared/types.ts'
import type { PrismaClient } from '../db.ts'
import { runnerDays, type RunnerDay } from '../runnerDay.ts'

export interface DailySlot {
  /** 0 Sunday .. 6 Saturday, in the slot's zone; every day when absent. */
  weekday?: number
  hour: number
  minute: number
}

/**
 * The slot's occurrence in the current Monday-based week, on the wall clock of `tz` (the runner's
 * zone, ADR 0022), or null when it has not come yet this week. A wall time a spring-forward night
 * skips is the first instant after the gap.
 */
export function weekSlotStart(
  now: Date,
  slot: DailySlot & { weekday: number },
  tz: string,
): Date | null {
  const clock = clockInZone(now, tz)
  const daysSinceMonday = (clock.weekday + 6) % 7
  const slotOffset = (slot.weekday + 6) % 7
  const date = addDays(clock.date, slotOffset - daysSinceMonday)
  const start = instantAtWallTime(date, slot.hour * 60 + slot.minute, tz)
  return start.getTime() <= now.getTime() ? start : null
}

/** Revisions that count as the week's automatic update; the weekly brief describes one of them. */
export const WEEKLY_REASONS = ['weekly', 'break']

/**
 * Whether the week of `day` already has its automatic update, read only. True when either the
 * runner's `WeeklyBrief` for `mondayOf(today)` links a weekly or break revision (the brief names
 * the local week it was written for, so this holds across a move of any size), or the plan has such
 * a revision since Monday 00:00 of the runner's week that no brief of another week links (a
 * revision carries no zone, so this signal needs no brief but cannot tell a week by itself; the
 * clause on another week's brief keeps last week's late catch-up from counting for this one).
 */
export async function weekUpdated(
  prisma: PrismaClient,
  args: { userId: string; planId: string; day: RunnerDay },
): Promise<boolean> {
  const weekStart = mondayOf(args.day.today)
  // A brief that cannot be read never stops the update (design 8.7): the revision signal decides.
  const brief = await prisma.weeklyBrief
    .findFirst({
      where: {
        userId: args.userId,
        weekStart,
        revision: { is: { reason: { in: WEEKLY_REASONS } } },
      },
      select: { id: true },
    })
    .catch(() => null)
  if (brief !== null) return true
  const since = {
    planId: args.planId,
    reason: { in: WEEKLY_REASONS },
    createdAt: { gte: instantAtWallTime(weekStart, 0, args.day.tz) },
  }
  const revision = await prisma.planRevision
    .findFirst({
      where: { ...since, OR: [{ brief: { is: null } }, { brief: { is: { weekStart } } }] },
      select: { id: true },
    })
    // The clause on another week's brief needs the brief table; without it the revision alone counts.
    .catch(() => prisma.planRevision.findFirst({ where: since, select: { id: true } }))
  return revision !== null
}

/**
 * Users whose weekly update is due: an active version-2 plan whose goal date has not passed on the
 * runner's day, this week's `REPLAN_SLOT` has come on the runner's clock, the plan is older than
 * the slot, and the week has no update yet (`weekUpdated`). A plan built after the slot (generated,
 * switched to another goal) was made from this week's data, so the update has nothing left to do
 * for it. `userId` narrows the answer to one user; `days` gives each runner's day (read from the
 * profiles when absent, so a test fills it with other zones).
 */
export async function usersDueForWeeklyUpdate(
  prisma: PrismaClient,
  now: Date,
  userId?: string,
  days?: ReadonlyMap<string, RunnerDay>,
): Promise<string[]> {
  const plans = await prisma.plan.findMany({
    where: {
      ...(userId === undefined ? {} : { userId }),
      status: 'active',
      generatorVersion: { gte: 2 },
    },
    select: { id: true, userId: true, createdAt: true, goal: { select: { targetDate: true } } },
  })
  const known = days ?? (await runnerDays(prisma, now, [...new Set(plans.map((p) => p.userId))]))
  const due = new Set<string>()
  for (const plan of plans) {
    const day = known.get(plan.userId)
    if (day === undefined || due.has(plan.userId)) continue
    const start = weekSlotStart(now, REPLAN_SLOT, day.tz)
    if (start === null || plan.createdAt.getTime() >= start.getTime()) continue
    if (plan.goal.targetDate < day.today) continue
    if (await weekUpdated(prisma, { userId: plan.userId, planId: plan.id, day })) continue
    due.add(plan.userId)
  }
  return [...due]
}

/**
 * Whether this week's automatic plan update has run, for `GET /api/jobs` and Today's health note;
 * `tz` is the runner's zone.
 */
export async function weeklyUpdateStatus(
  prisma: PrismaClient,
  userId: string,
  now: Date,
  tz: string,
): Promise<WeeklyUpdateStatus> {
  const last = await prisma.planRevision.findFirst({
    where: { reason: { in: WEEKLY_REASONS }, plan: { userId, status: 'active' } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  const days = new Map([[userId, { tz, today: isoDateInZone(now, tz), now }]])
  const due = (await usersDueForWeeklyUpdate(prisma, now, userId, days)).length > 0
  return { due, lastRevisionAt: last ? last.createdAt.toISOString() : null }
}

/** The Monday re-plan: Monday, 03:00 local time of the runner's zone. */
export const REPLAN_SLOT = { weekday: 1, hour: 3, minute: 0 } satisfies DailySlot
