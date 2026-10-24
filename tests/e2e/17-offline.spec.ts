import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { PlanSession, PlanWithSessions } from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi, type Api } from './helpers.ts'

// The installed app with no connection (phase 3a design 7.6, ADR 0012): the service worker keeps the
// shell and the answers Today needs, the page opens with the network off, a check-in tapped there is
// kept on the phone and sent when the connection returns, and signing out or a 401 empties what the
// device kept. This is the only spec that lets the worker run: the config blocks service workers
// everywhere else, because a worker warms caches and spends the shared request budget.
//
// One signed-in page, one plan and serial tests, as in `12-today.spec.ts`: each test continues from
// the state the one before left (the worker installed, the answers kept).
test.describe.configure({ mode: 'serial' })

const RUN_KINDS = ['easy', 'recovery', 'long', 'threshold', 'intervals', 'hills', 'race-pace']
const API_CACHE = 'rl-api-v1'
/** Time for the worker to install, take the page over and fill its cache. */
const WARM_TIMEOUT = 20_000

let page: Page
let api: Api
let origin = ''
let planned: PlanSession

/** A few weeks of history, an active goal and a plan, with a run planned for today. */
async function planWithRunToday(): Promise<PlanSession> {
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
    name: 'Offline marathon',
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

/** The names in Cache Storage, read from the page's own origin. */
function cacheNames(): Promise<string[]> {
  return page.evaluate(() => caches.keys())
}

/** The paths (with their query) that a cache holds; none when the cache does not exist. */
function kept(name: string): Promise<string[]> {
  return page.evaluate(async (cacheName) => {
    if (!(await caches.has(cacheName))) return []
    const cache = await caches.open(cacheName)
    return (await cache.keys()).map((request) => {
      const url = new URL(request.url)
      return `${url.pathname}${url.search}`
    })
  }, name)
}

/** How many writes wait in the outbox, read from the IndexedDB the page itself keeps. */
function queued(): Promise<number> {
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

/** Waits until the worker controls the page and has filled its cache for offline use. */
async function waitForKeptAnswers(): Promise<void> {
  const { today } = relativeDates()
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
  await expect
    .poll(() => kept(API_CACHE), { timeout: WARM_TIMEOUT })
    .toEqual(
      expect.arrayContaining([
        '/api/auth/me',
        '/api/setup',
        '/api/settings',
        '/api/today',
        '/api/research/params',
        `/api/today?date=${addDays(today, 1)}`,
      ]),
    )
}

test.beforeAll(async ({ browser, baseURL }) => {
  origin = baseURL ?? ''
  // The config blocks workers for every spec; this context asks for them.
  const context = await browser.newContext({ baseURL, serviceWorkers: 'allow' })
  page = await context.newPage()
  api = await signedInApi(page, origin)
  planned = await planWithRunToday()
})

test.afterAll(async () => {
  await page.context().close()
})

test('a context built the way the other specs build theirs cannot register a worker', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL })
  try {
    const other = await context.newPage()
    await other.goto('/login')
    // Playwright blocks a worker by making `register` do nothing, so a context that is blocked
    // has no registration afterwards, and one that is not has one.
    const registrations = await other.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js')
      return (await navigator.serviceWorker.getRegistrations()).length
    })
    expect(registrations).toBe(0)
  } finally {
    await context.close()
  }
})

test('the worker and the manifest are served to be checked on every load', async () => {
  for (const path of ['/sw.js', '/manifest.webmanifest', '/']) {
    const response = await page.request.get(path)
    expect(response.status(), path).toBe(200)
    expect(response.headers()['cache-control'], path).toBe('no-cache')
  }
  const manifest = (await (await page.request.get('/manifest.webmanifest')).json()) as {
    id: string
    shortcuts: unknown[]
  }
  expect(manifest.id).toBe('/')
  expect(manifest.shortcuts).toHaveLength(2)
})

test('the first visit installs the shell and keeps the answers Today needs', async () => {
  await page.goto('/')
  await expect(page.getByRole('article', { name: planned.title })).toBeVisible()
  await waitForKeptAnswers()

  const names = await cacheNames()
  expect(names.filter((name) => name.startsWith('rl-shell-'))).toHaveLength(1)
  expect(names).toEqual(expect.arrayContaining([API_CACHE, 'rl-meta']))
  // The page, its entry chunk, the chunk of every sheet that opens on a tap (read from
  // `lazySheets.tsx`, so a sheet added later is held to it), the chart and the corpus that the
  // Explain drawer reads.
  const shell = await kept(names.find((name) => name.startsWith('rl-shell-')) ?? '')
  expect(shell).toContain('/index.html')
  expect(shell).toContain('/manifest.webmanifest')
  const sheets = [
    ...readFileSync('web/components/lazySheets.tsx', 'utf8').matchAll(
      /import\('[^']*\/(\w+)\.tsx'\)/g,
    ),
  ].map((match) => match[1] ?? '')
  expect(sheets.length).toBeGreaterThanOrEqual(7)
  for (const chunk of ['index', 'charts', 'researchBundle', ...sheets]) {
    expect(
      shell.some((path) => new RegExp(`^/assets/${chunk}-[^/]*\\.js$`).test(path)),
      chunk,
    ).toBe(true)
  }

  await page.goto('/settings')
  await expect(page.getByText('Offline use: ready.')).toBeVisible()
})

test("opens today's session with no connection, says when it was saved, and explains it", async () => {
  await page.goto('/')
  const card = page.getByRole('article', { name: planned.title })
  await expect(card).toBeVisible()
  await waitForKeptAnswers()

  await page.context().setOffline(true)
  // The worker answers from the phone's copy: marked as such, with no watch line (a kept "On your
  // watch" would be false), which is not what the network would have said.
  const offline = await page.evaluate(async () => {
    const response = await fetch('/api/today')
    return (await response.json()) as {
      servedFromCache?: boolean
      date: string
      coach: { slots: { watch: unknown } }
    }
  })
  expect(offline.servedFromCache).toBe(true)
  expect(offline.date).toBe(relativeDates().today)
  expect(offline.coach.slots.watch).toBeNull()

  await page.reload()
  await expect(card).toBeVisible()
  await expect(
    page.getByText(/^Offline\. Showing the session saved at \d{2}:\d{2}\.$/),
  ).toBeVisible()
  await expect(card.getByRole('button', { name: 'Done' })).toBeVisible()

  // The figures behind the session need a connection; the rule, its parameters and its papers are
  // the phone's own (the parameters from the kept answer, the papers from the kept corpus).
  await card.getByRole('button', { name: 'Explain' }).click()
  const drawer = page.getByRole('dialog', { name: 'Why this?' })
  await expect(drawer.getByText('The rule and its evidence')).toBeVisible({ timeout: 15_000 })
  await expect(
    drawer.getByText(/^Your figures could not be loaded\. The rule and papers below still apply\./),
  ).toBeVisible()
  await expect(drawer.getByRole('alert')).toHaveCount(1)
  await expect(drawer.getByText('Papers', { exact: true }).first()).toBeVisible()
  await drawer.getByRole('button', { name: 'Close' }).click()
  await expect(drawer).toBeHidden()
})

test('a check-in tapped with no connection is kept on the phone and sent when it returns', async () => {
  const { today } = relativeDates()
  const read = page.getByRole('region', { name: 'Readiness' })
  await read.getByRole('radio', { name: 'Tired' }).click()
  await expect(read.getByText('Checked in: tired. Saved on this phone.')).toBeVisible()
  expect(await queued()).toBe(1)
  expect(await api.get(`/checkins/${today}`)).toBeNull()

  // It is on the device, not in the page: a reload with the network still off finds it.
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: 'Readiness' })
      .getByText('Checked in: tired. Saved on this phone.'),
  ).toBeVisible()
  expect(await queued()).toBe(1)

  await page.context().setOffline(false)
  await expect.poll(queued).toBe(0)
  expect(((await api.get(`/checkins/${today}`)) as { fatigue: number }).fatigue).toBe(4)
  // The fresh answer replaces the phone's copy, and the note goes with it.
  await expect(page.getByText(/^Offline\./)).toBeHidden()
  await expect(
    page
      .getByRole('region', { name: 'Readiness' })
      .getByText('Checked in: tired.', { exact: true }),
  ).toBeVisible()
  await api.put(`/checkins/${today}`, { fatigue: null })
})

test('a check-in tapped just after the connection went, on a page that stays open, is kept too', async () => {
  const { today } = relativeDates()
  await page.goto('/')
  const read = page.getByRole('region', { name: 'Readiness' })
  await expect(read.getByRole('radiogroup', { name: 'How do you feel today?' })).toBeVisible()

  // The browser reports the loss (`offline` event) while the page is open. The app's query client
  // must not pause the save: a paused one waits in memory, where a closed tab loses it.
  await page.context().setOffline(true)
  await read.getByRole('radio', { name: 'Drained' }).click()
  await expect(read.getByText('Checked in: drained. Saved on this phone.')).toBeVisible()
  await expect.poll(queued).toBe(1)

  await page.context().setOffline(false)
  await expect.poll(queued).toBe(0)
  expect(((await api.get(`/checkins/${today}`)) as { fatigue: number }).fatigue).toBe(5)
  await api.put(`/checkins/${today}`, { fatigue: null })
})

test('a 401 empties what the worker kept', async () => {
  await waitForKeptAnswers()
  // The session ends on the server (another device, an expiry); the page does not know yet.
  await api.post('/auth/logout')
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect
    .poll(() => kept(API_CACHE), { timeout: WARM_TIMEOUT })
    .not.toEqual(expect.arrayContaining(['/api/today']))
  const left = await kept(API_CACHE)
  for (const path of left) expect(path, 'health data left in the cache').toBe('/api/setup')
})

test('signing out empties the cache and the queue, and leaves the shell', async () => {
  await signedInApi(page, origin)
  await page.goto('/')
  await expect(page.getByRole('article', { name: planned.title })).toBeVisible()
  await waitForKeptAnswers()

  // A check-in on its way (the connection drops after the tap) is health data on the device too.
  await page.route('**/api/checkins/*', async (route) => {
    if (route.request().method() === 'PUT') await route.abort('connectionfailed')
    else await route.continue()
  })
  await page
    .getByRole('region', { name: 'Readiness' })
    .getByRole('radio', { name: 'Drained' })
    .click()
  await expect.poll(queued).toBe(1)

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)

  await expect.poll(queued).toBe(0)
  const left = await kept(API_CACHE)
  for (const path of left) expect(path, 'health data left in the cache').toBe('/api/setup')
  const names = await cacheNames()
  expect(names.some((name) => name.startsWith('rl-shell-'))).toBe(true)
  await page.unroute('**/api/checkins/*')
})
