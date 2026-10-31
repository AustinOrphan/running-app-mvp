import { expect, type APIResponse, type Page } from '@playwright/test'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type {
  PlanSession,
  PlanWithSessions,
  StrengthWorkout,
  TodayView,
} from '../../shared/types.ts'
import { SESSION_COOKIE, signSession } from '../../server/auth/session.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'
import { clearUserData } from '../schemaModels.ts'
import { lb, makeWorkout, plank, rdl, squat } from '../web/strength-fixtures.ts'
import { E2E_DATABASE_URL } from './env.ts'

/** Synthetic account shared by every spec. */
export const RUNNER = {
  email: 'runner@example.com',
  password: 'correct horse battery',
}

/**
 * Local-day dates computed from the clock, never hard-coded. The server derives "today" from the
 * same machine clock, so the two agree.
 */
export function relativeDates() {
  const today = todayIso()
  const thisMonday = mondayOf(today)
  return {
    today,
    thisMonday,
    lastMonday: addDays(thisMonday, -7),
    /** The Wednesday of last week: always finished, always inside the last 28 days. */
    lastWednesday: addDays(thisMonday, -5),
    /** The Monday three weeks ago, used as the plan start. */
    planStart: addDays(thisMonday, -21),
    /** The Saturday 20 weeks ahead. */
    raceDate: addDays(thisMonday, 20 * 7 + 5),
  }
}

type Body = Record<string, unknown>

/**
 * JSON calls through the page's request context, so the session cookie is shared with the page.
 * Mutating requests carry an Origin, which the server's same-origin guard requires.
 */
export function apiFor(page: Page, origin: string) {
  const headers = { Origin: origin }
  async function ok(response: APIResponse): Promise<unknown> {
    expect(response.ok(), `${response.url()} answered ${String(response.status())}`).toBe(true)
    return response.status() === 204 ? null : response.json()
  }
  return {
    get: async (path: string) => ok(await page.request.get(`/api${path}`)),
    post: async (path: string, data?: Body) =>
      ok(await page.request.post(`/api${path}`, { headers, data })),
    put: async (path: string, data?: Body) =>
      ok(await page.request.put(`/api${path}`, { headers, data })),
    delete: async (path: string) => ok(await page.request.delete(`/api${path}`, { headers })),
  }
}

export type Api = ReturnType<typeof apiFor>

/** `SESSION_SECRET` of the e2e server; keep in step with `webServer.env` in playwright.config.ts. */
export const E2E_SESSION_SECRET = 'e2e-test-only-secret-0123456789abcdef!!'

/**
 * Makes the page signed in as the runner without driving the UI: creates the account on a fresh
 * database. Once the account exists it sets a session cookie signed with the server's secret
 * instead of calling the sign-in route, because that route allows 10 attempts per 15 minutes and
 * the specs together would exhaust it. A spec starts from here unless it is testing the auth
 * screens.
 */
export async function signedInApi(page: Page, origin: string): Promise<Api> {
  const api = apiFor(page, origin)
  const status = (await api.get('/setup')) as { needsSetup: boolean }
  if (status.needsSetup) {
    await api.post('/setup', RUNNER)
    return api
  }
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: RUNNER.email } })
    await page
      .context()
      .addCookies([
        { name: SESSION_COOKIE, value: signSession(user.id, E2E_SESSION_SECRET), url: origin },
      ])
  } finally {
    await prisma.$disconnect()
  }
  return api
}

/**
 * Empties everything the specs create, leaving the account, so each spec starts from a blank log
 * with no profile, check-ins, integrations or screenings left by an earlier spec.
 * It writes to the server's SQLite file directly: the API has no way to retire an active plan.
 * The table list is derived from `prisma/schema.prisma` (every model with a `userId` column
 * except `User`, children through their cascades, and the shared caches that have neither a
 * `userId` nor a parent), so a model added later is cleared without editing this function;
 * `tests/unit/server/resetData.test.ts` fails if one is skipped.
 */
export async function resetData() {
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await initSqlite(prisma)
    await clearUserData(prisma)
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * The toast region announces confirmations. Some pages add a status line of their own (the data
 * summary, the activity count), so the locator narrows by the message text.
 */
export function toast(page: Page, message: string | RegExp) {
  return page.getByRole('status').getByText(message)
}

/** One weekly prediction as the log holds it: made `daysBefore` days before the race. */
export interface SeededPrediction {
  daysBefore: number
  predictedSec: number
  lowSec: number
  highSec: number
}

/**
 * Writes `PredictionLog` rows for a goal whose race day has passed, straight through Prisma. The
 * API cannot produce them: only the plan writers and the ensure job write the log, on the day a
 * prediction is made, and `recordPrediction` writes nothing on or after race day. A spec that needs
 * the weekly history of a finished race can neither wait for it nor ask for it, so the rows are
 * written as the app would have written them then: `loggedOn` and `weekStart` from the day, and
 * `inputs` left at its default, so the course is unrecorded and counts as comparable (rule L7).
 * The account must exist, so call this after `signedInApi()`.
 */
export async function seedPredictionLogs(
  goalId: string,
  raceDay: string,
  predictions: readonly SeededPrediction[],
) {
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await initSqlite(prisma)
    const user = await prisma.user.findUniqueOrThrow({ where: { email: RUNNER.email } })
    for (const prediction of predictions) {
      const loggedOn = addDays(raceDay, -prediction.daysBefore)
      await prisma.predictionLog.create({
        data: {
          userId: user.id,
          goalId,
          method: 'Critical speed',
          predictedSec: prediction.predictedSec,
          lowSec: prediction.lowSec,
          highSec: prediction.highSec,
          weekStart: mondayOf(loggedOn),
          loggedOn,
        },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
}

/** The kinds of plan session that are a run, as opposed to rest, strength or cross-training. */
export const RUN_KINDS = [
  'easy',
  'recovery',
  'long',
  'threshold',
  'intervals',
  'hills',
  'race-pace',
]

/**
 * Empties the log, then gives it four weeks of history, an active goal called `goalName` and a
 * plan with a run on today, and returns that run. When the plan has no run today, the next one is
 * moved here, the way the runner would. `page` must be the signed-in page that `api` was made
 * from, and `origin` its base URL (the server's same-origin guard requires it on a write).
 */
export async function planWithRunToday(
  api: Api,
  page: Page,
  origin: string,
  goalName: string,
): Promise<PlanSession> {
  const { today, lastWednesday, raceDate } = relativeDates()
  await resetData()
  for (let i = 0; i < 4; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (30 + 5 * i) * 60,
      distanceM: 5000 + i * 500,
    })
  }
  const goal = (await api.post('/goals', {
    name: goalName,
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id, strengthPreference: 0 })

  const plan = (await api.get('/plan')) as PlanWithSessions
  const isRun = (session: PlanSession) => RUN_KINDS.includes(session.kind)
  const found = plan.sessions.find((session) => session.date === today && isRun(session))
  if (found !== undefined) return found
  // No run falls on today in this plan: move the next one here, the way the runner would.
  for (const candidate of plan.sessions.filter((s) => s.date > today && isRun(s))) {
    const response = await page.request.put(`/api/plan/sessions/${candidate.id}`, {
      headers: { Origin: origin },
      data: { date: today },
    })
    if (response.ok()) return (await response.json()) as PlanSession
  }
  throw new Error(`The plan has no run for ${today} and none could be moved there.`)
}

/**
 * How many writes wait in the outbox, read from the IndexedDB the page itself keeps. The database
 * and store names are those of `web/pwa/outbox.ts` (`rl-outbox`, `entries`); a browser context
 * cannot import them, so they are written out here, once for every spec.
 */
export function queued(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const databases = await indexedDB.databases()
    if (!databases.some((database) => database.name === 'rl-outbox')) return 0
    return new Promise<number>((resolve, reject) => {
      const open = indexedDB.open('rl-outbox')
      open.onerror = () => {
        reject(open.error ?? new Error('IndexedDB did not open.'))
      }
      open.onsuccess = () => {
        const db = open.result
        const count = db.transaction('entries').objectStore('entries').count()
        count.onsuccess = () => {
          db.close()
          resolve(count.result)
        }
        count.onerror = () => {
          reject(count.error ?? new Error('IndexedDB did not count.'))
        }
      }
    })
  })
}

// ---- A strength day (strength design 11.1, 13) ---------------------------------------------------

/**
 * A plan with strength sessions, and the first of them on today as the day's only session, or, with
 * `withRun`, beside the first run that is still ahead, moved here too. It starts over from an empty
 * log (`resetData`) and signs the page in again, because a spec may have signed out before it. The
 * move is a write through Prisma, as `seedPredictionLogs` does: the plan's own move is guarded by
 * the rules of F4 and may refuse the day, and the page only ever shows today. The server reads the
 * change on its next request (`PRAGMA data_version`).
 */
export async function strengthOnlyToday(
  page: Page,
  origin: string,
  withRun = false,
): Promise<PlanSession> {
  const { today, thisMonday, lastWednesday, raceDate } = relativeDates()
  await resetData()
  const api = await signedInApi(page, origin)
  for (let i = 0; i < 4; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (30 + 5 * i) * 60,
      distanceM: 5000 + i * 500,
    })
  }
  const goal = (await api.post('/goals', {
    name: 'Strength marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id, strengthPreference: 2 })
  const plan = (await api.get('/plan')) as PlanWithSessions
  const strength = plan.sessions.find((session) => session.kind === 'strength')
  if (strength === undefined) throw new Error('The plan has no strength session.')
  const run = withRun
    ? plan.sessions.find((session) => RUN_KINDS.includes(session.kind) && session.date >= today)
    : undefined
  if (withRun && run === undefined) throw new Error('The plan has no run to put beside it.')
  const prisma = createPrisma(E2E_DATABASE_URL)
  try {
    await initSqlite(prisma)
    await prisma.planSession.deleteMany({
      where: {
        planId: strength.planId,
        date: today,
        NOT: { id: { in: [strength.id, ...(run === undefined ? [] : [run.id])] } },
      },
    })
    for (const moved of [strength, run]) {
      if (moved === undefined) continue
      await prisma.planSession.update({
        where: { id: moved.id },
        data: { date: today, weekStart: thisMonday },
      })
    }
  } finally {
    await prisma.$disconnect()
  }
  return { ...strength, date: today, weekStart: thisMonday }
}

/** The request of the Today page, for a route that stands in for the server's answer. */
const TODAY_REQUEST = '**/api/today'

/**
 * Serves `GET /api/today` with the tallest strength day: the session's own payload with five rows
 * (three lifts with long names, the jumps and three trunk movements) on a day of lower readiness,
 * which adds the line and the switch to the usual load. The fold has to hold for it too. The route
 * stays until the page calls `unroute('**\/api/today')`.
 */
export async function serveTallestStrengthDay(
  page: Page,
  session: PlanSession,
): Promise<StrengthWorkout> {
  const tallest = makeWorkout({
    sessionId: session.id,
    date: session.date,
    lifts: [
      squat({
        sets: 3,
        targets: [5, 5, 4],
        loadG: lb(100),
        usualLoadG: lb(110),
        change: 'lighter-day',
      }),
      rdl({ sets: 2, targets: [6, 6] }),
      rdl({ exerciseId: 'standing-calf-raise', slot: 'calf', sets: 2, targets: [12, 12] }),
    ],
    plyo: { contacts: 60, movements: ['pogo-hop', 'line-hop'] },
    trunk: [plank(), plank({ exerciseId: 'dead-bug' }), plank({ exerciseId: 'pallof-press' })],
  })
  await page.route(TODAY_REQUEST, async (route) => {
    // The browser revalidates with the tag it holds; a 304 has no body to change.
    const headers = { ...route.request().headers() }
    delete headers['if-none-match']
    const response = await route.fetch({ headers })
    const view = (await response.json()) as TodayView
    const slots = { ...view.coach.slots, strength: tallest }
    await route.fulfill({ response, json: { ...view, coach: { ...view.coach, slots } } })
  })
  return tallest
}
