import { expect, test } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { relativeDates, resetData, signedInApi, toast } from './helpers.ts'

test('a weekly review of the finished week changes next week target on the plan page', async ({
  page,
  baseURL,
}) => {
  const { thisMonday, raceDate } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()

  // Preconditions through the API: four weeks of runs for the engine to plan from, then an active
  // plan. A version-2 plan starts this week, so the week under review is the one before the plan.
  for (let week = 1; week <= 4; week += 1) {
    for (const [day, minutes] of [
      [1, 40],
      [3, 45],
      [5, 35],
      [6, 70],
    ] as const) {
      await api.post('/activities', {
        date: addDays(thisMonday, -7 * week + day),
        type: 'run',
        durationSec: minutes * 60,
        distanceM: minutes * 160,
      })
    }
  }
  // Three check-ins in the week under review: the form offers them as its answers.
  for (const day of [0, 1, 2]) {
    await api.put(`/checkins/${addDays(thisMonday, -7 + day)}`, { fatigue: 3, soreness: 3 })
  }
  const goal = (await api.post('/goals', {
    name: 'Test marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  await api.post('/plan/generate', { goalId: goal.id, strengthPreference: 2 })

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
  // The check-ins fill fatigue and symptoms with one tap; nothing is typed by hand.
  const card = page.getByRole('region', { name: "From this week's check-ins" })
  await expect(
    card.getByText('Fatigue 5 of 10, from an average of 3 of 5 over 3 days.'),
  ).toBeVisible()
  await card.getByRole('button', { name: 'Looks right' }).click()
  await expect(card.getByText(/filled in from the check-ins/)).toBeVisible()
  await expect(
    page
      .getByRole('radiogroup', { name: 'Fatigue (1-10)' })
      .getByRole('radio', { name: '5', exact: true }),
  ).toBeChecked()
  await expect(
    page.getByRole('radiogroup', { name: 'Symptoms' }).getByRole('radio', { name: 'None' }),
  ).toBeChecked()

  // The week before a version-2 plan has no weekly decision to suggest.
  await expect(page.getByText('There is no plan for this week.')).toBeVisible()

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
