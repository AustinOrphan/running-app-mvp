// The private calendar feed (phase 3a design 6.4 and 6.5, ADR 0008): the next 28 days of the
// active plan as an iCalendar document, behind a token. The feed is not a provider and has no
// account to connect, so it is one `DeliveryChannel` row (channel `calendar`) holding only the
// SHA-256 of the token; the token itself is shown once, when it is made, and never stored.
//
// The feed reads the athlete snapshot and the deliverable builder, nothing else: the runs come from
// `buildDeliverables` (the one builder of the watch, the file and the feed, so an eased day or a
// move reads the same everywhere), and the days that are not a run (a race, strength, mobility,
// cross-training) come from the snapshot's sessions, by the title and length of `publicTitle`. A
// session that is done or skipped is not listed, nor is a rest day or a run that readiness takes
// off today. Every write here is to a non-state table, so none moves the data version.
import { workoutExternalId } from '../../shared/domain/sessionIdentity.ts'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import { addDays } from '../../shared/dates.ts'
import { publicTitle, publishable } from '../../shared/workouts/labels.ts'
import type { Deps } from '../app.ts'
import { hashToken, newToken, tokensEqual, userTagOf } from '../crypto.ts'
import { loadAthleteContext } from './athleteState.ts'
import { icsOutline, icsUid, renderIcs, type IcsEvent } from './ics.ts'
import { buildDeliverables } from './workouts.ts'

/** The days of the feed, today included: the calendar shows a month, the watch gets two weeks. */
export const CALENDAR_DAYS = 28

/** `DeliveryChannel.channel` of the feed. */
export const CALENDAR_CHANNEL = 'calendar'

/** A token as `newToken` makes it: 32 random bytes in base64url. Anything else is not looked up. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

/** The stamp of a feed with no session in it; no event carries it. */
const NO_STAMP = '1970-01-01T00:00:00.000Z'

/** Where a feed is served. The router is mounted at `/api/calendar` (server/app.ts). */
export function calendarPath(token: string): string {
  return `/api/calendar/${token}/plan.ics`
}

// ---------------------------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------------------------

export interface IssuedCalendarToken {
  /** The only time the token exists in the clear. */
  token: string
  /** The feed's path on this server; the client adds its own origin. */
  path: string
  createdAt: string
}

/**
 * Makes the user's feed token, or replaces it: the old link stops working at once, because only
 * the hash of the newest token is kept. Returns the plain token, once.
 */
export async function issueCalendarToken(
  deps: Pick<Deps, 'prisma'>,
  userId: string,
): Promise<IssuedCalendarToken> {
  const token = newToken()
  const createdAt = new Date()
  const data = { enabled: true, tokenHash: hashToken(token), tokenCreatedAt: createdAt }
  await deps.prisma.deliveryChannel.upsert({
    where: { userId_channel: { userId, channel: CALENDAR_CHANNEL } },
    create: { userId, channel: CALENDAR_CHANNEL, ...data },
    update: data,
  })
  return { token, path: calendarPath(token), createdAt: createdAt.toISOString() }
}

/** Turns the feed off: the hash is dropped, so no link opens it. Nothing to do without one. */
export async function revokeCalendarToken(
  deps: Pick<Deps, 'prisma'>,
  userId: string,
): Promise<void> {
  await deps.prisma.deliveryChannel.updateMany({
    where: { userId, channel: CALENDAR_CHANNEL },
    data: { enabled: false, tokenHash: null, tokenCreatedAt: null },
  })
}

/**
 * The user whose feed `token` opens, or null for a token that is not one, is unknown, was
 * replaced or was revoked. The row is found by the hash and the hashes are then compared in
 * constant time, as for the push token.
 */
export async function userForCalendarToken(
  deps: Pick<Deps, 'prisma'>,
  token: string,
): Promise<string | null> {
  if (!TOKEN_SHAPE.test(token)) return null
  const hash = hashToken(token)
  const row = await deps.prisma.deliveryChannel.findUnique({ where: { tokenHash: hash } })
  if (
    row === null ||
    row.channel !== CALENDAR_CHANNEL ||
    !row.enabled ||
    row.tokenHash === null ||
    !tokensEqual(hash, row.tokenHash)
  ) {
    return null
  }
  return row.userId
}

// ---------------------------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------------------------

/** The zone as the calendar's own, or null for a name the runtime does not know. */
function knownZone(name: string): string | null {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name })
    return name
  } catch {
    return null
  }
}

type Entry = IcsEvent & { order: number }

/** Day, then the order within the day, then the UID, so that the same plan lists the same way. */
function byDay(a: Entry, b: Entry): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.order !== b.order) return a.order - b.order
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0
}

/**
 * The feed of a user from `today` for `CALENDAR_DAYS` days, as iCalendar text. The same plan gives
 * the same bytes: UIDs come from the session identity, DTSTAMP is the newest update of a session in
 * the window, and nothing reads the clock. One deliverable build and no network.
 */
export async function calendarFeed(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<string> {
  const { userId, today } = args
  const to = addDays(today, CALENDAR_DAYS - 1)
  const workouts = await buildDeliverables(deps, userId, { from: today, to, today })
  const context = await loadAthleteContext(deps, { userId, today })
  const inWindow = context.planSessions.filter((s) => s.date >= today && s.date <= to)

  const tag = userTagOf(userId)
  const uidOf = (externalId: string): string => icsUid(workoutExternalId(externalId, tag))
  const entries: Entry[] = []
  for (const d of workouts) {
    // a run that readiness takes off today is withdrawn from the watch, so it is left out here too
    if (d.action !== 'send') continue
    entries.push({
      uid: uidOf(d.externalId),
      date: d.date,
      order: d.order,
      title: d.plan.title,
      description: icsOutline(d.plan),
    })
  }
  for (const s of inWindow) {
    if (publishable(s.kind) || s.kind === 'rest' || !isToRun(s.status)) continue
    entries.push({
      uid: uidOf(s.externalId),
      date: s.date,
      order: s.order,
      title: publicTitle(s),
      description: null,
    })
  }
  entries.sort(byDay)

  return renderIcs({
    timeZone: knownZone(context.profile.timezone),
    stamp: inWindow.reduce((newest, s) => (s.updatedAt > newest ? s.updatedAt : newest), NO_STAMP),
    events: entries.map(({ uid, date, title, description }) => ({ uid, date, title, description })),
  })
}
