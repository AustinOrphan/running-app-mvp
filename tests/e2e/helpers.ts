import { expect, type APIResponse, type Page } from '@playwright/test'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { SESSION_COOKIE, signSession } from '../../server/auth/session.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'
import { clearUserData } from '../schemaModels.ts'
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
    delete: async (path: string) => ok(await page.request.delete(`/api${path}`, { headers })),
  }
}

export type Api = ReturnType<typeof apiFor>

/** `SESSION_SECRET` of the e2e server; keep in step with `webServer.env` in playwright.config.ts. */
const E2E_SESSION_SECRET = 'e2e-test-only-secret-0123456789abcdef!!'

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

/** The toast region announces confirmations; it is the one `role="status"` on a signed-in page. */
export function toast(page: Page, message: string | RegExp) {
  return page.getByRole('status').getByText(message)
}
