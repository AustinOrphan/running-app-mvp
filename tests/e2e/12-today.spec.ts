import { expect, test, type Locator, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { PlanSession, PlanWithSessions, TodayHeat, TodayView } from '../../shared/types.ts'
import { SLOT_BUDGETS_PX } from '../../web/components/today/slots.ts'
import { relativeDates, resetData, signedInApi, toast, type Api } from './helpers.ts'

// Today as the runner uses it: Not today and Done on the session's hero, then the one-tap check-in
// that survives a lost connection and a reload. The e2e server runs with NODE_ENV=development, which
// allows 20000 `/api` requests per 15 minutes per IP (1000 in production; static files are outside
// the count) and the whole suite spends about 1,170 of them, so the specs share one signed-in page
// (its cache keeps the assets), one plan, and as few page loads as the flows need to keep the run
// short and the count low. The fold and layout tests come before Done, because a logged run takes
// the Done button away.
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

/** The slots that draw nothing while the page shows the phone's copy: they need the server. */
const OFFLINE_EMPTY_SLOTS = ['watch', 'brief']

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

// ---- The first screen: the measured fold and the two-column layout (spec 7.6) ----------------

/** The tab bar under the content on a phone (`--tabbar-h`). */
const TAB_BAR_PX = 56
const TODAY_REQUEST = '**/api/today'

/**
 * A warm day as the server reports one. It gives the hero its cooler start line and its closed
 * "What to know today" row, the tallest ordinary day, which the e2e data would not produce by
 * itself (the e2e server has no forecast).
 */
const WARM_DAY: TodayHeat = {
  wbgtC: 25,
  note: 'Warm and humid this afternoon. Run by effort and drink early.',
  coolerHour: '06:00',
  peakHour: 15,
  coolerValue: 17,
  index: 'wbgt',
  hotForSteering: false,
}

/** Serves `GET /api/today` as the server sends it, on a warm day. */
async function serveWarmDay(): Promise<void> {
  await page.route(TODAY_REQUEST, async (route) => {
    // The browser revalidates with the tag it holds; a 304 has no body to change.
    const headers = { ...route.request().headers() }
    delete headers['if-none-match']
    const response = await route.fetch({ headers })
    const view = (await response.json()) as TodayView
    await route.fulfill({ response, json: { ...view, heat: WARM_DAY } })
  })
}

/** The default desktop window of the other tests, and the real payload again. */
async function restoreDesktop(): Promise<void> {
  await page.unroute(TODAY_REQUEST)
  await page.setViewportSize({ width: 1280, height: 720 })
}

/**
 * Fills every budgeted slot to its budget (`SLOT_BUDGETS_PX`), the most its owning epic's content
 * may take at 360 px. A slot that already holds content gets the budget as its minimum height and
 * must not be taller than it; a slot nobody has mounted yet gets a stub of exactly the budget, in
 * the place the page gives it. Both measure alike, so this test keeps holding as E1, E4 and E5
 * mount their content. `except` names slots that draw nothing in the state under test (the watch
 * and brief lines need the server, so they are empty while the page shows the phone's copy).
 */
async function fillSlotsToBudget(except: readonly string[] = []): Promise<void> {
  const all: Array<[string, number | null]> = Object.entries(SLOT_BUDGETS_PX)
  const budgets = all.filter(
    (entry): entry is [string, number] => entry[1] !== null && !except.includes(entry[0]),
  )
  await page.evaluate((entries) => {
    const columns = document.querySelector('[data-layout]')
    const hero = document.querySelector('article')
    const done = Array.from(hero?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent.trim() === 'Done',
    )
    // Where the page puts each slot: the top of the session group, under the targets, under the
    // actions, under the week strip.
    const place: Record<string, (stub: HTMLElement) => void> = {
      disruption: (stub) => columns?.firstElementChild?.prepend(stub),
      fuel: (stub) => hero?.querySelector('dl')?.after(stub),
      watch: (stub) => done?.parentElement?.after(stub),
      brief: (stub) => document.querySelector('section[aria-label="This week"]')?.after(stub),
    }
    for (const [name, budget] of entries) {
      const present = document.querySelector<HTMLElement>(`[data-slot="${name}"]`)
      if (present !== null) {
        if (present.getBoundingClientRect().height > budget + 0.5) {
          throw new Error(`The ${name} slot is taller than its ${String(budget)} px budget.`)
        }
        present.style.minHeight = `${String(budget)}px`
        continue
      }
      const stub = document.createElement('div')
      stub.dataset['slot'] = name
      stub.dataset['budgetPx'] = String(budget)
      stub.style.height = `${String(budget)}px`
      place[name]?.(stub)
      if (!stub.isConnected) throw new Error(`The ${name} slot has no place on the page.`)
    }
  }, budgets)
}

/** The server's own read of the answer has replaced the first guess: a verdict and its signal. */
async function settled(read: Locator): Promise<void> {
  await expect(read.getByRole('status')).not.toHaveText(/No readiness signals yet/)
  await expect(read.getByRole('list', { name: 'Readiness signals' })).toBeVisible()
}

/** The bottom edge of the hero's Done button, in pixels from the top of the viewport. */
async function doneBottom(): Promise<number> {
  const box = await page
    .getByRole('article', { name: planned.title })
    .getByRole('button', { name: 'Done', exact: true })
    .boundingBox()
  if (box === null) throw new Error('Done has no box on the page.')
  return box.y + box.height
}

/** Attaches the viewport as the report's picture of the layout, and records the measurement. */
async function attachScreenshot(name: string, doneAt?: number): Promise<void> {
  const info = test.info()
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
  if (doneAt !== undefined) {
    info.annotations.push({ type: name, description: `Done ends at ${String(doneAt)} px` })
  }
}

/** Whether the page is wider than the window. */
async function scrollsSideways(): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
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

test('at 360 px the recent weeks wait for the foot of the page, and nothing scrolls sideways', async () => {
  // A short window, so the foot of the page is more than the 240 px look-ahead below it.
  const height = 600
  await page.setViewportSize({ width: 360, height })
  await serveWarmDay()
  const weeks: string[] = []
  const onRequest = (request: { url: () => string }) => {
    if (new URL(request.url()).pathname === '/api/weeks') weeks.push(request.url())
  }
  page.on('request', onRequest)
  try {
    await page.goto('/')
    await expect(page.getByRole('article', { name: planned.title })).toBeVisible()
    await expect(page.getByRole('region', { name: 'This week' })).toBeVisible()
    // The disclaimer follows the history sections; the page is long enough to test the wait.
    const disclaimer = await page.getByRole('region', { name: 'Disclaimer' }).boundingBox()
    expect(disclaimer?.y).toBeGreaterThan(height + 240)
    expect(weeks).toHaveLength(0)
    expect(await scrollsSideways()).toBe(false)

    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    await expect(page.getByRole('img', { name: 'Run hours per week, last 12 weeks' })).toBeVisible()
    expect(weeks).toHaveLength(1)
    // With the history sections in view the page is as narrow as the rest.
    expect(await scrollsSideways()).toBe(false)
    await page.evaluate(() => {
      window.scrollTo(0, 0)
    })
  } finally {
    page.off('request', onRequest)
  }
})

// The next three tests keep the page the one before loaded and change its window, so the server
// sees one load of Today for the whole measurement; the check-in is unanswered until the third.

test('at 390 x 844 and 360 x 740 Done is inside the fold with the check-in unanswered and every slot filled', async () => {
  const card = page.getByRole('article', { name: planned.title })
  await expect(page.getByRole('radiogroup', { name: 'How do you feel today?' })).toBeVisible()
  await expect(card.getByText(/^Cooler start: /)).toBeVisible()
  await fillSlotsToBudget()
  await expect(page.locator('[data-slot][data-budget-px]')).toHaveCount(4)

  // A phone in a browser: the viewport above the 56 px tab bar.
  await page.setViewportSize({ width: 390, height: 844 })
  const tall = await doneBottom()
  await attachScreenshot('today-390x844-unanswered', tall)
  await expect(card.getByRole('heading', { level: 2 })).toBeInViewport()
  expect(tall).toBeLessThanOrEqual(844 - TAB_BAR_PX)

  await page.setViewportSize({ width: 360, height: 740 })
  const narrow = await doneBottom()
  await attachScreenshot('today-360x740-unanswered', narrow)
  expect(narrow).toBeLessThanOrEqual(740)
  expect(await scrollsSideways()).toBe(false)
})

test('once the check-in is answered Done is inside the viewport at 360 x 740 and at 390 x 707', async () => {
  const { today } = relativeDates()
  const read = page.getByRole('region', { name: 'Readiness' })
  await read.getByRole('radio', { name: 'Normal' }).click()
  await expect(read.getByText('Checked in: normal.')).toBeVisible()
  await expect(read.getByRole('radiogroup')).toBeHidden()
  await settled(read)
  await fillSlotsToBudget()

  const narrow = await doneBottom()
  await attachScreenshot('today-360x740-answered', narrow)
  expect(narrow).toBeLessThanOrEqual(740)
  expect(await scrollsSideways()).toBe(false)

  // An installed app on a shorter screen.
  await page.setViewportSize({ width: 390, height: 707 })
  const installed = await doneBottom()
  await attachScreenshot('today-390x707-answered', installed)
  expect(installed).toBeLessThanOrEqual(707)

  // The answer is cleared again for the tests after this one.
  await expect
    .poll(
      async () => ((await api.get(`/checkins/${today}`)) as { fatigue: number } | null)?.fatigue,
    )
    .toBe(3)
  await expect.poll(queued).toBe(0)
  await api.put(`/checkins/${today}`, { fatigue: null })
})

test('with the connection gone and the offline note on the page Done keeps both limits', async () => {
  const { today } = relativeDates()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  const card = page.getByRole('article', { name: planned.title })
  const read = page.getByRole('region', { name: 'Readiness' })
  await expect(read.getByRole('radiogroup', { name: 'How do you feel today?' })).toBeVisible()
  await expect(card.getByText(/^Cooler start: /)).toBeVisible()

  // The signal goes after the page has loaded, as it does in a pocket: the page keeps what it has
  // and says so under the session.
  await page.context().setOffline(true)
  try {
    const note = page.getByText(/^Offline\. Showing the session saved at \d{2}:\d{2}\.$/)
    await expect(note).toBeVisible()
    await fillSlotsToBudget(OFFLINE_EMPTY_SLOTS)

    const tall = await doneBottom()
    await attachScreenshot('today-390x844-offline-unanswered', tall)
    expect(tall).toBeLessThanOrEqual(844 - TAB_BAR_PX)
    // The note is below Done, never above it, and its first line is on the first screen.
    const noteBox = await note.boundingBox()
    if (noteBox === null) throw new Error('The offline note has no box on the page.')
    expect(noteBox.y).toBeGreaterThanOrEqual(tall)
    expect(noteBox.y).toBeLessThan(844 - TAB_BAR_PX)

    await page.setViewportSize({ width: 360, height: 740 })
    const narrow = await doneBottom()
    await attachScreenshot('today-360x740-offline-unanswered', narrow)
    expect(narrow).toBeLessThanOrEqual(740)
    expect(await scrollsSideways()).toBe(false)

    // The answer is kept on the phone, and the page measures again with the folded line.
    await read.getByRole('radio', { name: 'Normal' }).click()
    await expect(read.getByText('Checked in: normal. Saved on this phone.')).toBeVisible()
    await expect(read.getByRole('radiogroup')).toBeHidden()
    await fillSlotsToBudget(OFFLINE_EMPTY_SLOTS)
    const answered = await doneBottom()
    await attachScreenshot('today-360x740-offline-answered', answered)
    expect(answered).toBeLessThanOrEqual(740)

    await page.setViewportSize({ width: 390, height: 707 })
    const installed = await doneBottom()
    await attachScreenshot('today-390x707-offline-answered', installed)
    expect(installed).toBeLessThanOrEqual(707)
    expect(await scrollsSideways()).toBe(false)
  } finally {
    await page.context().setOffline(false)
  }

  // The connection is back: the kept answer goes out, and is cleared again for the tests after this.
  await expect.poll(queued).toBe(0)
  await expect
    .poll(
      async () => ((await api.get(`/checkins/${today}`)) as { fatigue: number } | null)?.fatigue,
    )
    .toBe(3)
  await api.put(`/checkins/${today}`, { fatigue: null })
})

test('at 1280 x 800 Today stands in two columns, the session first and the week beside it', async () => {
  try {
    await page.setViewportSize({ width: 1280, height: 800 })
    // The page takes the two columns when the 900 px media query reports the change, a frame after
    // the window has grown, so a measurement made at once can still see the one-column page.
    await expect(page.locator('[data-layout="two"]')).toBeVisible()
    const card = page.getByRole('article', { name: planned.title })
    const strip = page.getByRole('region', { name: 'This week' })
    await expect(card).toBeVisible()
    await expect(strip).toBeVisible()
    await fillSlotsToBudget()

    const cardBox = await card.boundingBox()
    const stripBox = await strip.boundingBox()
    if (cardBox === null || stripBox === null) throw new Error('The hero or the strip has no box.')
    // The strip is in the right column, level with the hero, and on the screen.
    expect(stripBox.x).toBeGreaterThanOrEqual(cardBox.x + cardBox.width)
    expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(800)
    expect(stripBox.y).toBeLessThan(cardBox.y + cardBox.height)
    expect(await scrollsSideways()).toBe(false)
    await attachScreenshot('today-1280x800')

    // Tab order follows the picture: the hero's actions come before anything in the week.
    await page.getByRole('main').focus()
    const order: string[] = []
    for (let step = 0; step < 30; step += 1) {
      await page.keyboard.press('Tab')
      const focus = await page.evaluate(() => {
        const element = document.activeElement
        return {
          name: element?.getAttribute('aria-label') ?? (element?.textContent ?? '').trim(),
          inWeek: element?.closest('section[aria-label="This week"]') != null,
        }
      })
      order.push(focus.name)
      if (focus.inWeek) break
    }
    expect(order.at(-1)).toMatch(/\d{1,2}/) // a day of the week
    expect(order.slice(0, -1)).toEqual(expect.arrayContaining(['Done', 'Explain', 'Not today']))
    expect(order.indexOf('Done')).toBeLessThan(order.length - 1)
  } finally {
    await restoreDesktop()
  }
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

test('Today words a distance estimate beside the minutes and for the week, from the recent pace until the zones hold one', async () => {
  // Four logged runs and no tested threshold pace: the zones hold no pace, so the recent logged
  // pace stands in. A tested threshold pace then gives the zones one, and the easy pace takes over.
  const recent = (await api.get('/today')) as TodayView
  expect(recent.coach.next?.distanceEstimate?.basis).toBe('recent')
  await api.put('/profile', { thresholdPaceSecPerKm: 330 })
  const view = (await api.get('/today')) as TodayView
  expect(view.coach.next?.distanceEstimate?.basis).not.toBe('recent')
  expect(view.coach.weekStrip?.distanceEstimateM ?? 0).toBeGreaterThan(0)

  await page.goto('/')
  const week = page.getByRole('region', { name: 'This week' })
  await expect(
    week.getByText(/^The week's planned runs come to about \d+(\.\d)? (mi|km)\.$/),
  ).toBeVisible()
  // The earlier cases left the day a rest day (an illness check-in), so the hero names the next
  // session instead, with its estimate after the minutes.
  await expect(page.getByText(/^Next: .+, about \d+(\.\d)? (mi|km)\.$/)).toBeVisible()
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
