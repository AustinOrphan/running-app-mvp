import { expect, test } from '@playwright/test'
import { relativeDates, resetData, signedInApi, toast } from './helpers.ts'

test('a weekly review of the finished week changes next week target on the plan page', async ({
  page,
  baseURL,
}) => {
  const { thisMonday, lastWednesday, planStart, raceDate } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()

  // Preconditions through the API: a run last week and an active plan that covers it.
  await api.post('/activities', {
    date: lastWednesday,
    type: 'run',
    durationSec: 45 * 60,
    distanceM: 8047,
  })
  const goal = (await api.post('/goals', {
    name: 'Test marathon',
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

  const currentTarget = page.locator(`tr[data-week="${thisMonday}"] [data-cell="target"]`)
  await page.goto('/plan')
  await expect(currentTarget).toBeVisible()
  const before = await currentTarget.innerText()
  expect(before).not.toContain('2.0 h')

  // The review opens on last week, the latest finished week without a completed review.
  await page.getByRole('link', { name: 'Review' }).first().click()
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible()
  await expect(page.getByText(/^Week of /)).toBeVisible()

  await page.getByRole('radio', { name: 'Data complete' }).click()
  await page
    .getByRole('radiogroup', { name: 'Fatigue (1-10)' })
    .getByRole('radio', { name: '3', exact: true })
    .click()
  await page
    .getByRole('radiogroup', { name: 'Symptoms' })
    .getByRole('radio', { name: 'None' })
    .click()

  const suggestion = page.getByRole('region', { name: 'Suggested action' })
  await expect(suggestion).toBeVisible()
  await expect(suggestion.getByText(/Suggested next week: \d+ min/)).toBeVisible()

  await page
    .getByRole('radiogroup', { name: 'Final decision' })
    .getByRole('radio', { name: 'Hold' })
    .click()
  await page.getByLabel('Next week minutes').fill('120')
  await page.getByRole('button', { name: 'Save review' }).click()
  await expect(toast(page, /^Week of .* saved$/)).toBeVisible()

  const history = page.getByRole('heading', { name: 'Reviewed weeks' }).locator('..')
  await expect(history.getByText('Hold')).toBeVisible()
  await expect(history.getByText('120 min next week')).toBeVisible()

  // The plan now shows the reviewed target for the current week, marked as coming from the review.
  await page.getByRole('link', { name: 'Plan' }).first().click()
  await expect(currentTarget.getByText('2.0 h')).toBeVisible()
  await expect(currentTarget.getByText('from review')).toBeVisible()
})
