import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { relativeDates, resetData, signedInApi } from './helpers.ts'

// A failed first read on Today, Plan and Review ends in "Try again", which reads again and draws
// the page. The route is aborted for the first read and its two automatic retries, as a phone with
// no signal would; the read that Try again makes goes through.

test.use({ viewport: { width: 390, height: 844 } })

async function seedRunner(page: Page, baseURL: string | undefined) {
  const { lastWednesday, raceDate } = relativeDates()
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
  const goal = (await api.post('/goals', {
    name: 'Retry marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id })
}

const PAGES = [
  { path: '/', failing: '**/api/today*', subject: 'Today' },
  { path: '/plan', failing: '**/api/plan', subject: 'The plan' },
  { path: '/review', failing: '**/api/reviews*', subject: 'The review' },
]

for (const entry of PAGES) {
  test(`${entry.subject}: Try again after the first read fails draws the page`, async ({
    page,
    baseURL,
  }) => {
    await seedRunner(page, baseURL)
    let aborted = 0
    await page.route(entry.failing, async (route) => {
      // The client reads a failed request twice more before it gives up (`createQueryClient`).
      if (aborted < 3) {
        aborted += 1
        await route.abort('connectionfailed')
      } else {
        await route.continue()
      }
    })
    await page.goto(entry.path)
    await expect(page.getByRole('alert')).toContainText(`${entry.subject} did not load.`)
    const retry = page.getByRole('button', { name: 'Try again' })
    // A thumb's size.
    const box = await retry.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    await retry.click()
    await expect(page.getByText(`${entry.subject} did not load.`)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
    expect(aborted).toBe(3)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
