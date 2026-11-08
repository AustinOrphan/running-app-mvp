import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { TodayView } from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi } from './helpers.ts'

// Today on a rest day: on a desktop the week strip and its meter sit under the "Next:" line in the
// left column, near the top of the page, with the check-in beside them; a phone keeps one column.

async function seedRunner(page: Page, baseURL: string | undefined) {
  const { today, lastWednesday, raceDate } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  for (let i = 0; i < 8; i += 1) {
    await api.post('/activities', {
      date: addDays(lastWednesday, -3 * i),
      type: 'run',
      durationSec: (35 + i) * 60,
      distanceM: 6000 + i * 300,
    })
  }
  await api.post('/activities', { date: today, type: 'run', durationSec: 40 * 60, distanceM: 7000 })
  const goal = (await api.post('/goals', {
    name: 'Rest day marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id })
  // Whatever the plan holds today, the page is read as a day with no session: the payload loses
  // its hero, and the next session is the one that follows it.
  await page.route('**/api/today*', async (route) => {
    const response = await route.fetch()
    const view = (await response.json()) as TodayView
    view.coach.hero = null
    await route.fulfill({ response, json: view })
  })
}

test.describe('a rest day at 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('puts the week strip under the Next line, within 600 px of the top', async ({
    page,
    baseURL,
  }) => {
    await seedRunner(page, baseURL)
    await page.goto('/')
    const week = page.getByRole('region', { name: 'This week' })
    await expect(week).toBeVisible()
    await expect(page.getByText('Nothing is planned today.')).toBeVisible()
    const next = await page.getByText(/^Next: /).boundingBox()
    const strip = await week.boundingBox()
    const check = await page
      .getByRole('button', { name: "Something hurts, or I'm ill" })
      .boundingBox()
    if (next === null || strip === null || check === null) throw new Error('A block has no box.')
    // Under the Next line, in the same column, and on the first screen.
    expect(strip.y).toBeGreaterThanOrEqual(next.y + next.height)
    expect(Math.abs(strip.x - next.x)).toBeLessThan(2)
    expect(strip.y).toBeLessThan(600)
    expect(strip.y + strip.height).toBeLessThan(800)
    // The check-in stands in the other column, to the right of the week.
    expect(check.x).toBeGreaterThan(strip.x + strip.width - 1)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('a rest day at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('keeps the session first: the Next line, the check-in, then the week', async ({
    page,
    baseURL,
  }) => {
    await seedRunner(page, baseURL)
    await page.goto('/')
    const week = page.getByRole('region', { name: 'This week' })
    await expect(week).toBeVisible()
    const next = await page.getByText(/^Next: /).boundingBox()
    const check = await page
      .getByRole('button', { name: "Something hurts, or I'm ill" })
      .boundingBox()
    const strip = await week.boundingBox()
    if (next === null || strip === null || check === null) throw new Error('A block has no box.')
    expect(next.y).toBeLessThan(check.y)
    expect(check.y).toBeLessThan(strip.y)
  })
})
