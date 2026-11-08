import { expect, test } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import type { TodayView } from '../../shared/types.ts'
import { relativeDates, resetData, signedInApi } from './helpers.ts'

// The Illustrations switch (visual design, section 5): off by default, and a line drawing on an empty
// page only while it is on.

test('Illustrations: off by default, on draws art on an empty page, off draws none', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  const art = page.locator('svg[data-art]')

  await page.goto('/activities')
  await expect(page.getByText('No activities yet.')).toBeVisible()
  await expect(art).toHaveCount(0)

  await page.goto('/settings')
  const box = page.getByRole('checkbox', { name: 'Illustrations' })
  await expect(box).not.toBeChecked()
  await box.check()
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved')

  await page.goto('/activities')
  await expect(page.getByText('No activities yet.')).toBeVisible()
  await expect(art).toHaveCount(1)
  await expect(art).toHaveAttribute('data-art', 'runs')
  await expect(art).toHaveAttribute('aria-hidden', 'true')

  await page.goto('/settings')
  await expect(box).toBeChecked()
  await box.uncheck()
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved')

  await page.goto('/activities')
  await expect(page.getByText('No activities yet.')).toBeVisible()
  await expect(art).toHaveCount(0)
})

test('Illustrations: a runner with a full log sees the rest-day drawing only while it is on', async ({
  page,
  baseURL,
}) => {
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
  // Whatever the plan holds today, the page is read as a day with no session.
  await page.route('**/api/today*', async (route) => {
    const response = await route.fetch()
    const view = (await response.json()) as TodayView
    view.coach.hero = null
    await route.fulfill({ response, json: view })
  })
  const art = page.locator('svg[data-art]')

  await page.goto('/')
  await expect(page.getByText('Nothing is planned today.')).toBeVisible()
  await expect(art).toHaveCount(0)

  await page.goto('/settings')
  await page.getByRole('checkbox', { name: 'Illustrations' }).check()
  await expect(page.getByRole('status', { name: 'Save status' })).toHaveText('Saved')

  await page.goto('/')
  await expect(page.getByText('Nothing is planned today.')).toBeVisible()
  await expect(art).toHaveCount(1)
  await expect(art).toHaveAttribute('data-art', 'rest')
  await expect(art).toHaveAttribute('aria-hidden', 'true')
})
