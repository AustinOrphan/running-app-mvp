import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { relativeDates, resetData, signedInApi, type Api } from './helpers.ts'

// Today's countdown with the course silhouette under it and the week as proportional bars, at 360
// px, the narrowest phone the app is checked at, with the text at 100 % and at 150 %. The course
// points are synthetic. A goal without course points shows no silhouette.

test.describe.configure({ mode: 'serial' })

let page: Page
let api: Api

async function scrollsSideways(): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL })
  page = await context.newPage()
  await page.setViewportSize({ width: 360, height: 740 })
  api = await signedInApi(page, baseURL ?? '')
  const { today, lastWednesday } = relativeDates()
  await resetData()
  for (let i = 0; i < 6; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (60 + 10 * i) * 60,
      distanceM: 9000 + i * 1000,
    })
  }
  const goal = (await api.post('/goals', {
    name: 'Course ultra',
    priority: 'A',
    targetDate: addDays(today, 7 * 20),
    distanceM: 80_467,
    gainM: 2400,
    lossM: 2400,
    surface: 'trail',
    goalType: 'finish',
    supportLevel: 'aided',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id, strengthPreference: 0 })
})

test.afterAll(async () => {
  await page.context().close()
})

test('a goal with no course points shows the countdown and no silhouette', async () => {
  await page.goto('/')
  const race = page.getByRole('region', { name: 'Race' })
  await expect(race.getByRole('link', { name: /days to the race/ })).toBeVisible()
  await expect(race.locator('svg')).toHaveCount(0)
})

test('with course points the silhouette shows, and 360 px holds at 100 % and 150 % text', async () => {
  await api.put('/race/checkpoints', {
    checkpoints: [
      { name: 'Point A', distanceM: 20_000, gainM: 600, lossM: 100, cutoffSec: null },
      { name: 'Point B', distanceM: 50_000, gainM: 300, lossM: 700, cutoffSec: null },
    ],
  })
  await page.goto('/')
  const race = page.getByRole('region', { name: 'Race' })
  await expect(race.locator('svg[aria-hidden="true"]')).toHaveCount(1)
  await expect(race.getByRole('img')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'This week' })).toBeVisible()
  expect(await scrollsSideways()).toBe(false)
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '150%'
  })
  expect(await scrollsSideways()).toBe(false)
})
