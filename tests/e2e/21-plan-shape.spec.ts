import { expect, test } from '@playwright/test'
import type { PlanWithSessions } from '../../shared/types.ts'
import { runsOn, s3Runs } from '../unit/engine/history-fixtures.ts'
import { relativeDates, resetData, signedInApi, toast, type Api } from './helpers.ts'

// The plan shape [rules P1 to P4, ADR 0017]: the Generate form offers the plan's own shape, three
// run days a week and a longer base; the choice reaches the plan, the Plan page names the shape in
// effect, and the Why drawer states what the shape sets against the plan's own value. Three run days
// is for goals up to the half marathon: a marathon goal shows it disabled. The runner is the
// synthetic one of the load-setting spec: 41 years old, a year of running and a summer block.

/** One synthetic runner, placed against this week's Monday. */
async function seedRunner(api: Api, thisMonday: string) {
  const year = Number(thisMonday.slice(0, 4))
  await api.put('/profile', { birthYear: year - 41, runningSinceYear: year - 1 })
  for (const run of runsOn(thisMonday, s3Runs())) {
    await api.post('/activities', {
      date: run.date,
      type: 'run',
      durationSec: run.durationSec,
      distanceM: run.distanceM,
      rpe: 3,
    })
  }
}

/** An active goal of `distanceM` with its race date 20 weeks ahead. */
async function seedGoal(api: Api, name: string, distanceM: number) {
  const { raceDate } = relativeDates()
  const goal = (await api.post('/goals', {
    name,
    priority: 'A',
    targetDate: raceDate,
    distanceM,
    goalType: 'finish',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)
  return goal
}

test('choose three run days on a 10 km goal, see it on the Plan page and in the Why drawer', async ({
  page,
  baseURL,
}) => {
  const { thisMonday } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  await seedRunner(api, thisMonday)
  await seedGoal(api, 'Synthetic 10 km', 10_000)

  // The form: the three shapes beside the load setting, the plan's own shape chosen, the grade line.
  await page.goto('/plan')
  const shape = page.getByRole('radiogroup', { name: 'Plan shape' })
  await expect(shape.getByRole('radio')).toHaveCount(3)
  await expect(shape.getByRole('radio', { name: "The plan's own shape" })).toBeChecked()
  await expect(shape.getByRole('radio', { name: 'Three run days a week' })).toBeEnabled()
  await expect(shape.getByRole('radio', { name: 'A longer base' })).toBeEnabled()
  await expect(shape.getByText('A choice, not a better plan (grade D).')).toBeVisible()
  // the days open come from the profile, which has all seven days available by default
  await expect(shape.getByText(/^You have \d days open; three run days /)).toBeVisible()

  // Choose three run days and generate.
  await shape.getByRole('radio', { name: 'Three run days a week' }).check()
  await page.getByRole('button', { name: 'Generate plan' }).click()
  await expect(toast(page, 'Plan generated')).toBeVisible()

  // The plan carries the choice, and no week has more than three run days.
  const plan = (await api.get('/plan')) as PlanWithSessions
  expect(plan.method).toEqual({
    requested: 'three-run-days',
    effective: 'three-run-days',
    reason: null,
  })
  expect(plan.weeks.length).toBeGreaterThan(0)
  expect(Math.max(...plan.weeks.map((week) => week.runDays))).toBeLessThanOrEqual(3)

  // The Plan page names the shape in effect, with no reason, and the week table says three at most.
  const panel = page.getByRole('region', { name: 'Plan shape' })
  await expect(panel.getByText('Three run days a week', { exact: true })).toBeVisible()
  await expect(panel.getByText('A choice, not a better plan (grade D).')).toBeVisible()
  await expect(panel.getByText(/read as the plan's own shape/)).toHaveCount(0)
  const runDays = await page.locator('[data-cell="run-days"]').allTextContents()
  expect(runDays.length).toBeGreaterThan(0)
  expect(Math.max(...runDays.map(Number))).toBeLessThanOrEqual(3)
  expect(Math.max(...runDays.map(Number))).toBeGreaterThan(0)

  // Why this shape opens the drawer on a run-days fact: the cap against the plan's own, with grades.
  await panel.getByRole('button', { name: 'Why this shape' }).click()
  const drawer = page.getByRole('dialog', { name: 'Why this?' })
  const choice = drawer.getByRole('group', { name: 'Three run days' })
  await expect(choice.getByText('Plan shape chosen: Three run days a week.')).toBeVisible()
  await expect(
    choice.getByText(
      "Run days: at most 3 a week (grade D), against 6 in the plan's own shape (grade D).",
    ),
  ).toBeVisible()
  await expect(
    drawer
      .getByRole('group', { name: 'Run frequency and availability' })
      .getByText('Your plan shape, Three run days a week, caps run days at 3 a week.'),
  ).toBeVisible()
  await drawer.getByRole('button', { name: 'Close' }).click()
  await expect(drawer).toBeHidden()

  // Regenerate plan starts from the shape the plan has.
  await page.getByRole('button', { name: 'Regenerate plan' }).click()
  const sheet = page.getByRole('dialog', { name: 'Regenerate plan' })
  await expect(sheet.getByRole('radio', { name: 'Three run days a week' })).toBeChecked()
})

test('a marathon goal shows three run days disabled and offers the longer base', async ({
  page,
  baseURL,
}) => {
  const { thisMonday } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  await seedRunner(api, thisMonday)
  await seedGoal(api, 'Synthetic marathon', 42_195)

  await page.goto('/plan')
  const shape = page.getByRole('radiogroup', { name: 'Plan shape' })
  const three = shape.getByRole('radio', { name: 'Three run days a week' })
  await expect(three).toBeDisabled()
  await expect(shape.getByText('Not for a marathon or longer')).toBeVisible()
  await expect(shape.getByRole('radio', { name: "The plan's own shape" })).toBeChecked()
  await expect(shape.getByRole('radio', { name: 'A longer base' })).toBeEnabled()

  // The longer base is offered and reaches the plan; the Plan page names it.
  await shape.getByRole('radio', { name: 'A longer base' }).check()
  await page.getByRole('button', { name: 'Generate plan' }).click()
  await expect(toast(page, 'Plan generated')).toBeVisible()
  const plan = (await api.get('/plan')) as PlanWithSessions
  expect(plan.method?.requested).toBe('longer-base')
  const panel = page.getByRole('region', { name: 'Plan shape' })
  await expect(panel.getByText('A longer base', { exact: true })).toBeVisible()
})
