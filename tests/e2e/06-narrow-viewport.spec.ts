import { expect, test, type Page } from '@playwright/test'
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
  const { lastWednesday, planStart, raceDate } = relativeDates()
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
    baselineRunMin: 150,
    startDate: planStart,
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
