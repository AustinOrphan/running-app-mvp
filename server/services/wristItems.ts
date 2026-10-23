// The items of the wrist status (phase 3a design 6.4): one per run session of a range, as the
// publisher's rows and the plan say it stands on its way to the watch. `GET /api/wrist/status`
// (the Plan page, the session sheet, the settings) and the Today `watch` slot read it through here,
// so the two cannot word a session differently. This module imports neither `publish.ts` nor
// `today.ts`, which import each other's neighbours, so the Today slot can use it.
import { addDays } from '../../shared/dates.ts'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import type { PlanSession, TodayWatch, WristItem } from '../../shared/types.ts'
import { PUBLISH_HORIZON_DAYS } from '../../shared/workouts/horizon.ts'
import { publishable } from '../../shared/workouts/labels.ts'
import type { PrismaClient, WristPublication } from '../db.ts'
import { toWristItem, wristItemStatus } from '../serialize.ts'
import type { AthleteContext } from './athleteState.ts'

/**
 * The `DeliveryChannel.channel` and `WristPublication.channel` of the intervals.icu publisher: the
 * one place the name is written. This module imports neither `publish.ts` nor `today.ts`, so
 * `publish.ts` and `todayHealth.ts` can take the name from here.
 */
export const WRIST_CHANNEL = 'intervals'

/** What the items of a range depend on besides the plan and the stored rows. */
export interface WristItemsArgs {
  userId: string
  /** The sessions of the active plan (the snapshot's), publishable or not. */
  planSessions: readonly PlanSession[]
  /** The first and last day of the range, both included. */
  range: { from: string; to: string }
  /** The snapshot's day: only a session of today or later is announced as not sent yet. */
  today: string
  /** Sending is on. */
  enabled: boolean
  /** The runner ticked that intervals.icu uploads planned workouts to Garmin Connect. */
  garminLinked: boolean
  now: Date
}

/** The publications of the range's run sessions, with the plan's join by `externalId`. */
async function publicationsOf(
  prisma: Pick<PrismaClient, 'wristPublication'>,
  args: WristItemsArgs,
  sessions: readonly PlanSession[],
): Promise<WristPublication[]> {
  return prisma.wristPublication.findMany({
    where: {
      userId: args.userId,
      channel: WRIST_CHANNEL,
      OR: [
        { date: { gte: args.range.from, lte: args.range.to } },
        { externalId: { in: sessions.map((s) => s.externalId) } },
      ],
    },
  })
}

/**
 * One item per publication of the range, joined to its session by `externalId`, in day and plan
 * order. While sending is on, a run session of today to +13 that is still to be run and has no
 * publication yet is listed as `not-sent`.
 */
export async function readWristItems(
  prisma: Pick<PrismaClient, 'wristPublication'>,
  args: WristItemsArgs,
): Promise<WristItem[]> {
  const { range, today, enabled, garminLinked, now } = args
  const sessions = args.planSessions.filter(
    (s) => s.date >= range.from && s.date <= range.to && publishable(s.kind),
  )
  const rows = await publicationsOf(prisma, args, sessions)
  const sessionByExt = new Map(args.planSessions.map((s) => [s.externalId, s]))
  const items: Array<{ item: WristItem; order: number }> = []
  const seen = new Set<string>()
  for (const row of rows) {
    const session = sessionByExt.get(row.externalId)
    seen.add(row.externalId)
    const date = session?.date ?? row.date
    if (date < range.from || date > range.to) continue
    items.push({
      item: toWristItem(row, {
        sessionId: session?.id ?? null,
        date,
        status: wristItemStatus(row, { garminLinked, now, sessionDate: session?.date ?? null }),
      }),
      order: session?.order ?? 0,
    })
  }
  if (enabled) {
    const last = addDays(today, PUBLISH_HORIZON_DAYS - 1)
    for (const session of sessions) {
      if (seen.has(session.externalId)) continue
      if (session.date < today || session.date > last) continue
      if (!isToRun(session.status)) continue
      items.push({
        item: {
          externalId: session.externalId,
          sessionId: session.id,
          date: session.date,
          kind: session.kind,
          title: '',
          variant: 'planned',
          status: 'not-sent',
          failCode: null,
          failMessage: null,
          deviceMessage: null,
          warnings: [],
          retryAt: null,
          sentAt: null,
        },
        order: session.order,
      })
    }
  }
  items.sort(
    (a, b) =>
      a.item.date.localeCompare(b.item.date) ||
      a.order - b.order ||
      a.item.externalId.localeCompare(b.item.externalId),
  )
  return items.map(({ item }) => item)
}

/**
 * `GET /api/today` slot `watch`: the items of the viewed day, or null while sending is off or when
 * the day holds no run. The rows are in a table the data version does not cover, so the page's
 * change stamp follows them (`publish.ts`, `registerTodayStamp`).
 */
export async function todayWatchSlot(
  prisma: Pick<PrismaClient, 'deliveryChannel' | 'wristPublication'>,
  args: { userId: string; date: string; today: string; context: AthleteContext; now?: Date },
): Promise<TodayWatch | null> {
  const { userId, date, today, context } = args
  if (!context.planSessions.some((s) => s.date === date && publishable(s.kind))) return null
  const channel = await prisma.deliveryChannel.findUnique({
    where: { userId_channel: { userId, channel: WRIST_CHANNEL } },
    select: { enabled: true, garminLinked: true },
  })
  if (channel?.enabled !== true) return null
  const items = await readWristItems(prisma, {
    userId,
    planSessions: context.planSessions,
    range: { from: date, to: date },
    today,
    enabled: true,
    garminLinked: channel.garminLinked,
    now: args.now ?? new Date(),
  })
  return items.length === 0 ? null : { items }
}
