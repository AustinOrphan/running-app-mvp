import { expect, test } from '@playwright/test'
import { relativeDates, resetData, signedInApi } from './helpers.ts'

// A phone-width viewport: nothing may be clipped out of reach or push the page sideways.
test.use({ viewport: { width: 360, height: 740 } })

test('every Fatigue rating sits inside its control at 360 px and can be chosen', async ({
  page,
  baseURL,
}) => {
  const { lastWednesday, planStart, raceDate } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
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

test('the Activities type filter needs no scrolling at 360 px', async ({ page, baseURL }) => {
  await signedInApi(page, baseURL ?? '')
  await page.goto('/activities')
  const group = page.getByRole('radiogroup', { name: /type/i })
  await expect(group).toBeVisible()
  const overflow = await group.evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the Stats page does not scroll sideways at 360 px; wide tables scroll inside', async ({
  page,
  baseURL,
}) => {
  const { lastWednesday } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
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
