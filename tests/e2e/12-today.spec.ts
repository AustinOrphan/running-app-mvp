import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { PlanSession, PlanWithSessions } from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi, toast, type Api } from './helpers.ts'

// Today as the runner uses it: Not today and Done on the session's hero, then the one-tap check-in
// that survives a lost connection and a reload. The e2e server runs with NODE_ENV=development, which
// allows 20000 `/api` requests per 15 minutes per IP (1000 in production; static files are outside
// the count) and the whole suite spends about 940 of them, so the specs share one signed-in page
// (its cache keeps the assets), one plan, and as few page loads as the flows need to keep the run
// short and the count low.
test.describe.configure({ mode: 'serial' })

const RUN_KINDS = ['easy', 'recovery', 'long', 'threshold', 'intervals', 'hills', 'race-pace']

let page: Page
let api: Api
let planned: PlanSession

/** A few weeks of history, an active goal and a plan, with a run planned for today. */
async function planWithRunToday(origin: string): Promise<PlanSession> {
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
    name: 'Today marathon',
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

/** How many writes wait in the outbox, read from the IndexedDB the page itself keeps. */
async function queued(): Promise<number> {
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

const CHECKIN_WRITES = '**/api/checkins/*'

/** A connection that fails: the page believes it is online, the writes to the check-in never land. */
async function dropCheckinWrites(): Promise<void> {
  await page.route(CHECKIN_WRITES, async (route) => {
    if (route.request().method() === 'PUT') await route.abort('connectionfailed')
    else await route.continue()
  })
}

/** The connection returns: the page hears of it and the outbox sends what it holds. */
async function restoreConnection(): Promise<void> {
  await page.unroute(CHECKIN_WRITES)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'))
  })
}

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  page = await context.newPage()
  api = await signedInApi(page, baseURL ?? '')
  planned = await planWithRunToday(baseURL ?? '')
})

test.afterAll(async () => {
  await page.context().close()
})

test('Not today skips the session and says it is not made up later', async () => {
  await page.goto('/')
  const card = page.getByRole('article', { name: planned.title })
  await card.getByRole('button', { name: 'Not today' }).click()
  const sheet = page.getByRole('dialog', { name: 'Not today' })
  await expect(sheet.getByText('A skipped session is not made up later.')).toBeVisible()
  await sheet.getByRole('button', { name: 'Skip session' }).click()
  await expect(sheet.getByText('What would change')).toBeVisible()
  await sheet.getByRole('button', { name: 'Apply change' }).click()
  await expect(toast(page, /^Skipped /)).toBeVisible()
  await expect(sheet).toBeHidden()
  await expect(card.getByText('Skipped')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Not today' })).toBeHidden()
  await expect(card.getByRole('heading', { level: 2 })).toBeFocused()
  const after = (await api.get('/plan')) as PlanWithSessions
  expect(after.sessions.find((session) => session.id === planned.id)?.status).toBe('skipped')
  // Put it back with the action behind the session sheet's Restore session, so that Done has a
  // session to work on.
  await api.post(`/plan/sessions/${planned.id}/adjust`, { adjustment: { type: 'restore' } })
})

test('Done with no connection keeps a draft and turns Save off, then logs the run once', async () => {
  const { today } = relativeDates()
  await page.reload()
  const card = page.getByRole('article', { name: planned.title })
  await expect(card).toBeVisible()

  await page.context().setOffline(true)
  await card.getByRole('button', { name: 'Done' }).click()
  const sheet = page.getByRole('dialog', { name: "Log today's run" })
  await expect(
    sheet.getByText('Needs a connection. Your entries stay on this phone.'),
  ).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Save' })).toBeDisabled()
  await sheet.getByRole('textbox', { name: 'Duration' }).fill('37')
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(sheet).toBeHidden()

  // The connection is back: the sheet opens on the draft, Save works, and the run is posted once.
  await page.context().setOffline(false)
  await card.getByRole('button', { name: 'Done' }).click()
  await expect(sheet.getByRole('textbox', { name: 'Duration' })).toHaveValue('37')
  await expect(sheet.getByText(/^Planned: .* Change anything that differs\.$/)).toBeVisible()
  await sheet.getByRole('button', { name: 'RPE 4' }).click()
  await sheet.getByRole('button', { name: 'Save' }).dblclick()

  await expect(toast(page, 'Run saved')).toBeVisible()
  await expect(sheet).toBeHidden()
  await expect(card.getByText('Completed')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Done' })).toBeHidden()
  await expect(card.getByRole('heading', { level: 2 })).toBeFocused()

  const logged = (await api.get(`/activities?from=${today}&to=${today}`)) as {
    items: Array<{ durationSec: number; rpe: number | null; type: string }>
  }
  expect(logged.items).toHaveLength(1)
  expect(logged.items[0]).toMatchObject({ type: 'run', durationSec: 37 * 60, rpe: 4 })
  const after = (await api.get('/plan')) as PlanWithSessions
  expect(after.sessions.find((session) => session.id === planned.id)?.status).toBe('completed')
})

test('one tap saves the check-in, folds the row and moves focus to the verdict', async () => {
  const { today } = relativeDates()
  await page.goto('/')
  const read = page.getByRole('region', { name: 'Readiness' })
  const group = read.getByRole('radiogroup', { name: 'How do you feel today?' })
  await expect(group.getByRole('radio')).toHaveText(['Fresh', 'Good', 'Normal', 'Tired', 'Drained'])
  await group.getByRole('radio', { name: 'Tired' }).click()

  await expect(read.getByText('Checked in: tired.')).toBeVisible()
  await expect(read.getByRole('radiogroup')).toBeHidden()
  await expect(read.getByRole('status')).toBeFocused()
  await expect(read.getByRole('button', { name: 'Add more' })).toBeVisible()
  await expect(read.getByRole('button', { name: "Something hurts, or I'm ill" })).toBeVisible()
  // The row folds before the request is answered, so the server's copy is waited for.
  await expect
    .poll(
      async () => ((await api.get(`/checkins/${today}`)) as { fatigue: number } | null)?.fatigue,
    )
    .toBe(4)
  await expect.poll(queued).toBe(0)
  // The server's own read of the answer arrives, and the fold stays.
  await expect(read.getByText('Checked in: tired.')).toBeVisible()
  // The answer is cleared again for the next test.
  await api.put(`/checkins/${today}`, { fatigue: null })
})

test('a check-in tapped on a lost connection is kept, survives a reload and is sent once', async () => {
  const { today } = relativeDates()
  await dropCheckinWrites()
  await page.reload()
  const read = page.getByRole('region', { name: 'Readiness' })
  await read.getByRole('radio', { name: 'Drained' }).click()
  await expect(read.getByText('Checked in: drained. Saved on this phone.')).toBeVisible()
  expect(await queued()).toBe(1)
  // Cleared by the last test, so the server holds no check-in at all.
  expect(await api.get(`/checkins/${today}`)).toBeNull()

  // The queue is on the device: a reload finds it and still says so.
  await page.reload()
  await expect(
    page
      .getByRole('region', { name: 'Readiness' })
      .getByText('Checked in: drained. Saved on this phone.'),
  ).toBeVisible()
  expect(await queued()).toBe(1)

  // The connection returns; the page hears of it and sends the answer, once.
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().includes('/api/checkins/')) {
      writes.push(request.url())
    }
  })
  await restoreConnection()
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(
    page
      .getByRole('region', { name: 'Readiness' })
      .getByText('Checked in: drained.', { exact: true }),
  ).toBeVisible()
  await expect.poll(queued).toBe(0)
  expect(((await api.get(`/checkins/${today}`)) as { fatigue: number }).fatigue).toBe(5)
  expect(writes).toHaveLength(1)
})

test('the check-in sheet takes the full check-in, and queues it with no connection', async () => {
  const { today } = relativeDates()
  await page.getByRole('button', { name: "Something hurts, or I'm ill" }).click()
  const sheet = page.getByRole('dialog', { name: 'Check-in' })
  await expect(sheet.getByRole('checkbox', { name: 'Feeling ill' })).toBeFocused()
  await sheet.getByRole('checkbox', { name: 'Feeling ill' }).check()
  await sheet.getByRole('button', { name: 'Pain today 4' }).click()
  await sheet.getByRole('textbox', { name: 'Pain area' }).fill('left calf')
  await sheet.getByRole('button', { name: 'Soreness 4' }).click()
  await sheet.getByRole('button', { name: 'Save check-in' }).click()
  await expect(toast(page, 'Check-in saved')).toBeVisible()
  await expect(sheet).toBeHidden()
  expect(await api.get(`/checkins/${today}`)).toMatchObject({
    illness: true,
    painScore: 4,
    painArea: 'left calf',
    soreness: 4,
    fatigue: 5,
  })

  // The same sheet with the connection down keeps the change on the phone, then sends it.
  await dropCheckinWrites()
  await page.getByRole('button', { name: 'Add more' }).click()
  await sheet.getByRole('button', { name: 'Mood 2' }).click()
  await sheet.getByRole('button', { name: 'Save check-in' }).click()
  await expect(toast(page, 'Check-in saved on this phone')).toBeVisible()
  expect(await queued()).toBe(1)
  expect(((await api.get(`/checkins/${today}`)) as { mood: number | null }).mood).toBeNull()
  await restoreConnection()
  await expect.poll(queued).toBe(0)
  expect(((await api.get(`/checkins/${today}`)) as { mood: number }).mood).toBe(2)
})

test('signing out empties the outbox', async () => {
  await dropCheckinWrites()
  await page.getByRole('button', { name: "Something hurts, or I'm ill" }).click()
  const sheet = page.getByRole('dialog', { name: 'Check-in' })
  await sheet.getByRole('checkbox', { name: 'Feeling ill' }).uncheck()
  await sheet.getByRole('button', { name: 'Save check-in' }).click()
  await expect(toast(page, 'Check-in saved on this phone')).toBeVisible()
  expect(await queued()).toBe(1)

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await queued()).toBe(0)
})
