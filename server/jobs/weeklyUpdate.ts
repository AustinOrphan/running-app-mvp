// The slot of the weekly plan update and whether this week's update is due. Today's health note
// (`todayHealth.ts`) reads these, and the scheduler imports the publisher, which registers with
// Today's modules at load: the helpers live here, below both, so that those imports form no cycle.
// `scheduler.ts` re-exports them for its callers.
import { todayIso } from '../../shared/dates.ts'
import type { WeeklyUpdateStatus } from '../../shared/types.ts'
import type { PrismaClient } from '../db.ts'

export interface DailySlot {
  /** 0 Sunday .. 6 Saturday, in the server's local time; every day when absent. */
  weekday?: number
  hour: number
  minute: number
}

/**
 * The slot's occurrence in the current Monday-based week, in the server's local time (ADR 0003), or
 * null when it has not come yet this week.
 */
export function weekSlotStart(now: Date, slot: DailySlot & { weekday: number }): Date | null {
  const daysSinceMonday = (now.getDay() + 6) % 7
  const slotOffset = (slot.weekday + 6) % 7
  const start = new Date(now)
  start.setDate(now.getDate() - daysSinceMonday + slotOffset)
  start.setHours(slot.hour, slot.minute, 0, 0)
  return start.getTime() <= now.getTime() ? start : null
}

/** Revisions that count as the week's automatic update. */
const WEEKLY_REASONS = ['weekly', 'break']

/**
 * Users whose weekly update is due: an active version-2 plan whose goal date has not passed, this
 * week's `REPLAN_SLOT` has come, the plan is older than the slot, and no `weekly` or `break`
 * revision exists since it. A plan built after the slot (generated, switched to another goal) was
 * made from this week's data, so the update has nothing left to do for it. `userId` narrows the
 * answer to one user.
 */
export async function usersDueForWeeklyUpdate(
  prisma: PrismaClient,
  now: Date,
  userId?: string,
): Promise<string[]> {
  const start = weekSlotStart(now, REPLAN_SLOT)
  if (start === null) return []
  const plans = await prisma.plan.findMany({
    where: {
      ...(userId === undefined ? {} : { userId }),
      status: 'active',
      generatorVersion: { gte: 2 },
      goal: { targetDate: { gte: todayIso(now) } },
      createdAt: { lt: start },
      revisions: { none: { reason: { in: WEEKLY_REASONS }, createdAt: { gte: start } } },
    },
    select: { userId: true },
  })
  return [...new Set(plans.map((plan) => plan.userId))]
}

/** Whether this week's automatic plan update has run, for `GET /api/jobs` and Today's health note. */
export async function weeklyUpdateStatus(
  prisma: PrismaClient,
  userId: string,
  now: Date,
): Promise<WeeklyUpdateStatus> {
  const last = await prisma.planRevision.findFirst({
    where: { reason: { in: WEEKLY_REASONS }, plan: { userId, status: 'active' } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  const due = (await usersDueForWeeklyUpdate(prisma, now, userId)).length > 0
  return { due, lastRevisionAt: last ? last.createdAt.toISOString() : null }
}

/** The Monday re-plan: Monday, 03:00 local time. */
export const REPLAN_SLOT = { weekday: 1, hour: 3, minute: 0 } satisfies DailySlot
