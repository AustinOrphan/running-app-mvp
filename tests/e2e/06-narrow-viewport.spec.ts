import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { relativeDates, resetData, signedInApi } from './helpers.ts'

// A phone-width viewport: nothing may be clipped out of reach or push the page sideways.
// One shared signed-in page keeps the specs within the login limiter's 10 attempts per window.
test.describe.configure({ mode: 'serial' })

let page: Page
let api: Awaited<ReturnType<typeof signedInApi>>

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 740 } })
  page = await context.newPage()
  api = await signedInApi(page, baseURL ?? '')
})

test.afterAll(async () => {
  await page.context().close()
})

test('every Fatigue rating sits inside its control at 360 px and can be chosen', async () => {
  const { lastWednesday, raceDate } = relativeDates()
  await resetData()
  await api.post('/activities', {
    date: lastWednesday,
    type: 'run',
    durationSec: 45 * 60,
    distanceM: 8047,
  })
  const goal = (await api.post('/goals', {
    name: 'Narrow marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', {
    goalId: goal.id,
    strengthPreference: 2,
  })

  await page.goto('/review')
  const group = page.getByRole('radiogroup', { name: 'Fatigue (1-10)' })
  await expect(group).toBeVisible()
  const groupBox = await group.boundingBox()
  expect(groupBox).not.toBeNull()
  for (const rating of ['1', '9', '10']) {
    const radio = group.getByRole('radio', { name: rating, exact: true })
    const box = await radio.boundingBox()
    expect(box, `rating ${rating}`).not.toBeNull()
    if (!box || !groupBox) continue
    expect(box.x, `rating ${rating} left edge`).toBeGreaterThanOrEqual(groupBox.x - 0.5)
    expect(box.x + box.width, `rating ${rating} right edge`).toBeLessThanOrEqual(
      groupBox.x + groupBox.width + 0.5,
    )
  }
  await group.getByRole('radio', { name: '10', exact: true }).click()
  await expect(group.getByRole('radio', { name: '10', exact: true })).toBeChecked()
})

test('the Activities type filter needs no scrolling at 360 px', async () => {
  await resetData()
  await api.post('/activities', {
    date: relativeDates().lastWednesday,
    type: 'run',
    durationSec: 45 * 60,
    distanceM: 8047,
  })
  await page.goto('/activities')
  const group = page.getByRole('radiogroup', { name: /type/i })
  await expect(group).toBeVisible()
  const overflow = await group.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the Stats page does not scroll sideways at 360 px; wide tables scroll inside', async () => {
  const { lastWednesday } = relativeDates()
  await resetData()
  await api.post('/activities', {
    date: lastWednesday,
    type: 'run',
    durationSec: 45 * 60,
    distanceM: 8047,
  })

  await page.goto('/stats')
  await expect(page.getByRole('heading', { name: 'Weekly history' })).toBeVisible()
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(pageOverflow).toBeLessThanOrEqual(0)
  const region = page.getByRole('region', { name: 'Weekly history table' })
  const scrollable = await region.evaluate((el) => el.scrollWidth > el.clientWidth)
  expect(scrollable).toBe(true)
})

/** True when the element's centre is the element itself or inside it, so nothing sits on top. */
async function isUncovered(locator: ReturnType<Page['locator']>): Promise<boolean> {
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect()
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return top !== null && el.contains(top)
  })
}

/** How far the page reaches past the viewport sideways, in pixels. */
async function pageOverflow(): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

test('Integrations with Recent syncs open does not scroll sideways at 360 px', async () => {
  const { lastWednesday } = relativeDates()
  await resetData()
  // A connected source with two runs in its log: the same push twice.
  const issued = (await api.post('/integrations/apple-health/push-token')) as { token: string }
  const workouts = [6, 7, 8].map((hour) => ({
    id: `narrow-${String(hour)}`,
    name: 'Outdoor Run',
    start: `${lastWednesday} 0${String(hour)}:00:00 +0000`,
    end: `${lastWednesday} 0${String(hour)}:30:00 +0000`,
    distance: { qty: 5, units: 'km' },
  }))
  for (let push = 0; push < 2; push += 1) {
    const res = await page.request.post('/api/ingest/apple-health', {
      headers: { Authorization: `Bearer ${issued.token}` },
      data: { data: { metrics: [], workouts } },
    })
    expect(res.ok(), `push ${String(push)} answered ${String(res.status())}`).toBe(true)
  }

  await page.goto('/integrations')
  const card = page.getByRole('region', { name: 'Apple Health' })
  await expect(card).toBeVisible()
  const history = card.locator('details').filter({ hasText: 'Recent syncs' })
  await history.getByText('Recent syncs').click()
  const runs = history.getByRole('listitem')
  await expect(runs).toHaveCount(2)
  await expect(runs.first()).toContainText('Stored 3 new activities')
  expect(await pageOverflow()).toBeLessThanOrEqual(0)
  // Every line of the log stays inside the card.
  const cardBox = await card.boundingBox()
  expect(cardBox).not.toBeNull()
  for (const run of await runs.all()) {
    const box = await run.boundingBox()
    expect(box).not.toBeNull()
    if (!box || !cardBox) continue
    expect(box.x).toBeGreaterThanOrEqual(cardBox.x - 0.5)
    expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5)
  }
})

test('the Goals question for Make active fits at 360 px and clears the tab bar', async () => {
  const { lastWednesday, thisMonday } = relativeDates()
  await resetData()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  const longName = 'The narrow viewport marathon with a rather long name to wrap'
  const first = (await api.post('/goals', {
    name: longName,
    priority: 'A',
    targetDate: addDays(thisMonday, 7 * 14 + 5),
    distanceM: 42_195,
    goalType: 'finish',
  })) as { id: string }
  await api.post('/goals', {
    name: 'Narrow 10K',
    priority: 'B',
    // Later than the plan's race, so its card is the last one and the question ends the page.
    targetDate: addDays(thisMonday, 7 * 16 + 5),
    distanceM: 10_000,
    goalType: 'finish',
  })
  await api.post(`/goals/${first.id}/activate`)
  await api.post('/plan/generate', { goalId: first.id })

  await page.goto('/goals')
  const card = page.getByRole('article', { name: 'Narrow 10K' })
  await card.getByRole('button', { name: 'Make active' }).click()
  const question = card.getByRole('group', { name: /^The plan follows/ })
  await expect(question).toBeVisible()
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight)
  })

  expect(await pageOverflow()).toBeLessThanOrEqual(0)
  const viewport = page.viewportSize()
  const navHeight = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())?.height
  const limit = (viewport?.height ?? 0) - (navHeight ?? 0)
  const questionBox = await question.boundingBox()
  expect(questionBox).not.toBeNull()
  expect((questionBox?.x ?? 0) + (questionBox?.width ?? 0)).toBeLessThanOrEqual(
    (viewport?.width ?? 0) + 0.5,
  )
  for (const name of ['Build plan for Narrow 10K', 'Cancel']) {
    const button = question.getByRole('button', { name })
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box, name).not.toBeNull()
    expect((box?.x ?? 0) + (box?.width ?? 0), `${name} right edge`).toBeLessThanOrEqual(
      (viewport?.width ?? 0) + 0.5,
    )
    expect((box?.y ?? 0) + (box?.height ?? 0), `${name} bottom edge`).toBeLessThanOrEqual(limit)
    expect(await isUncovered(button), name).toBe(true)
  }
  await question.getByRole('button', { name: 'Cancel' }).click()
  await expect(question).toBeHidden()
})

for (const size of [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
]) {
  const name = `${String(size.width)}x${String(size.height)}`

  test(`the fixed tab bar never covers the end of a long page or a sheet's Save at ${name}`, async () => {
    const { lastWednesday, raceDate } = relativeDates()
    await resetData()
    // One run a day for two weeks: a long list, and a history the engine can plan from.
    for (let i = 0; i < 14; i += 1) {
      await api.post('/activities', {
        date: addDays(lastWednesday, -i),
        type: 'run',
        durationSec: (30 + i) * 60,
        distanceM: 5000 + i * 100,
      })
    }
    const goal = (await api.post('/goals', {
      name: 'Tab bar marathon',
      priority: 'A',
      targetDate: raceDate,
      distanceM: 42_195,
    })) as { id: string }
    await api.post(`/goals/${goal.id}/activate`)
    await api.post('/plan/generate', {
      goalId: goal.id,
      strengthPreference: 2,
    })
    await page.setViewportSize(size)
    const navHeight = (await page.getByRole('navigation', { name: 'Primary' }).boundingBox())
      ?.height
    expect(navHeight).toBeGreaterThan(0)
    const limit = size.height - (navHeight ?? 0)

    // Last row of a long Activities list, scrolled as far as the page goes.
    await page.goto('/activities')
    const lastRow = page.getByRole('main').getByRole('listitem').last()
    await expect(lastRow).toBeVisible()
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    const rowBox = await lastRow.boundingBox()
    expect(rowBox, 'last activity row').not.toBeNull()
    expect((rowBox?.y ?? 0) + (rowBox?.height ?? 0)).toBeLessThanOrEqual(limit)
    expect(await isUncovered(lastRow)).toBe(true)

    // The Review page's Save button, at the very end of its form.
    await page.goto(`/review`)
    await expect(page.getByText(`Week of`).first()).toBeVisible()
    const save = page.getByRole('button', { name: 'Save review' })
    await save.scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight)
    })
    const saveBox = await save.boundingBox()
    expect(saveBox, 'Save review').not.toBeNull()
    expect((saveBox?.y ?? 0) + (saveBox?.height ?? 0)).toBeLessThanOrEqual(limit)
    expect(await isUncovered(save)).toBe(true)

    // A sheet sits above the tab bar: its Save button is fully on screen and not covered.
    await page.goto('/activities?new=1')
    const sheet = page.getByRole('dialog')
    await expect(sheet).toBeVisible()
    // Measure after the slide-up animation ends.
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    const sheetSave = sheet.getByRole('button', { name: 'Save' })
    await expect(sheetSave).toBeVisible()
    const sheetBox = await sheetSave.boundingBox()
    expect(sheetBox, 'sheet Save').not.toBeNull()
    expect((sheetBox?.y ?? 0) + (sheetBox?.height ?? 0)).toBeLessThanOrEqual(size.height)
    expect(await isUncovered(sheetSave)).toBe(true)
  })
}
