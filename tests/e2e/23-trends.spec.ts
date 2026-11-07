import { expect, test, type Page } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { relativeDates, resetData, signedInApi } from './helpers.ts'

// The Trends page at a phone's 360 px: months of running read by role, the range switch, the hidden
// table of the same numbers, and a page that never scrolls sideways.

test.use({ viewport: { width: 360, height: 740 } })

type Api = Awaited<ReturnType<typeof signedInApi>>

/** The page's reach past the viewport sideways, in pixels. */
async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
}

/** Runs every third day for 20 weeks, a race and two strength sessions in the middle. */
async function seedRunning(api: Api): Promise<void> {
  const { thisMonday } = relativeDates()
  await resetData()
  for (let i = 0; i < 46; i += 1) {
    await api.post('/activities', {
      date: addDays(thisMonday, -7 - 3 * i),
      type: 'run',
      durationSec: (35 + (i % 5) * 6) * 60,
      distanceM: 6000 + (i % 5) * 900,
    })
  }
  await api.post('/activities', {
    date: addDays(thisMonday, -7 * 6 - 5),
    type: 'race',
    durationSec: 50 * 60,
    distanceM: 10_000,
  })
  for (const back of [7 * 4 + 1, 7 * 4 + 3]) {
    await api.post('/activities', {
      date: addDays(thisMonday, -back),
      type: 'strength',
      durationSec: 30 * 60,
    })
  }
}

test('Trends reads by role, switches range and stays inside 360 px', async ({ page, baseURL }) => {
  const api = await signedInApi(page, baseURL ?? '')
  await seedRunning(api)

  // From More, as a phone reaches it.
  await page.goto('/more')
  await page.getByRole('link', { name: /^Trends/ }).click()
  await expect(page).toHaveURL(/\/trends$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Trends' })).toBeVisible()
  await expect(page.getByText('Nothing here is a target.')).toBeVisible()

  // The 12-month chart, with its lazy chunk drawn, and its hidden table of the same weeks.
  const chart = page.getByRole('img', { name: /^Run hours per week, last 12 months\./ })
  await expect(chart).toBeVisible()
  const table = page.getByRole('table', { name: /^Run hours per week, last 12 months\./ })
  await expect(table.getByRole('row')).toHaveCount(1 + 52)
  await expect(table.getByRole('row', { name: /Yes$/ })).toHaveCount(1)

  // Strength squares stand under the weeks that held a session.
  const squares = page.getByTestId('strength-squares')
  await expect(squares.locator('[data-strength="2"]')).toHaveCount(1)
  expect(await overflow(page)).toBeLessThanOrEqual(0)

  // 24 months, then 6, each with its own hidden table; the page stays inside the window.
  const range = page.getByRole('radiogroup', { name: 'Range' })
  await range.getByRole('radio', { name: '24 months' }).click()
  const wide = page.getByRole('table', { name: /^Run hours per week, last 24 months\./ })
  await expect(wide.getByRole('row')).toHaveCount(1 + 104)
  await expect(page.getByRole('img', { name: /last 24 months/ })).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
  await range.getByRole('radio', { name: '6 months' }).click()
  await expect(
    page.getByRole('table', { name: /^Run hours per week, last 6 months\./ }).getByRole('row'),
  ).toHaveCount(1 + 26)

  // The choice is remembered on this device.
  await page.reload()
  await expect(
    page.getByRole('radiogroup', { name: 'Range' }).getByRole('radio', { name: '6 months' }),
  ).toBeChecked()

  // Distance, in the runner's unit.
  await page
    .getByRole('radiogroup', { name: 'Show' })
    .getByRole('radio', { name: 'Distance' })
    .click()
  await expect(page.getByText('Bars are run distance per week.')).toBeVisible()
  await expect(
    page.getByRole('img', { name: /^Run distance per week, last 6 months\./ }),
  ).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})

test('Trends says there are no runs when the range holds none', async ({ page, baseURL }) => {
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  await api.get('/settings')
  await page.goto('/trends')
  await expect(page.getByText('No runs in this range yet.')).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: 'Range' })).toBeVisible()
  expect(await overflow(page)).toBeLessThanOrEqual(0)
})
