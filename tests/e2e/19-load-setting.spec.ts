import { expect, test } from '@playwright/test'
import type { PlanWithSessions } from '../../shared/types.ts'
import { runsOn, s3Runs } from '../unit/engine/history-fixtures.ts'
import { relativeDates, resetData, signedInApi, toast, type Api } from './helpers.ts'

// The load setting [rules g-8]: the Generate form offers Steady, Standard and Upper band, the
// choice reaches the plan, the Plan page names the position in effect, and "Update plan from latest
// data" keeps it. The runner is the synthetic one of appendix A of the load-progression proposal:
// one year of running, a summer block of about 280 minutes a week that ended eight weeks ago, then
// sparse weeks. Steady starts from 3 x 20 minutes; Standard lifts the start to 3 x 30 from the block.

/** One synthetic runner, placed against this week's Monday. */
async function seedRunner(api: Api, thisMonday: string) {
  // 41 years old this year, under the age rule of upper whatever year the clock reads
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

test('choose Standard on the form, see it on the Plan page, and keep it through a re-plan', async ({
  page,
  baseURL,
}) => {
  const { today, thisMonday, raceDate } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  await seedRunner(api, thisMonday)
  const goal = (await api.post('/goals', {
    name: 'Synthetic marathon',
    priority: 'A',
    targetDate: raceDate,
    distanceM: 42_195,
    goalType: 'finish',
  })) as { id: string }
  await api.post(`/goals/${goal.id}/activate`)

  // The form: three positions, Steady chosen, its hint and the trade-off line under it.
  await page.goto('/plan')
  const load = page.getByRole('radiogroup', { name: 'Load' })
  await expect(load.getByRole('radio')).toHaveText(['Steady', 'Standard', 'Upper band'])
  await expect(load.getByRole('radio', { name: 'Steady' })).toBeChecked()
  await expect(page.getByText("Adds up to 10% a week, the plan's usual step.")).toBeVisible()
  await expect(
    page.getByText(/^A faster step brings the earlier weekly level back sooner\./),
  ).toBeVisible()
  await expect(page.getByText(/Staying with 10% is the more cautious choice\.$/)).toBeVisible()

  // Each position has its own hint.
  await load.getByRole('radio', { name: 'Upper band' }).click()
  await expect(
    page.getByText(/^Adds up to 14% a week while rebuilding, the most the plan allows/),
  ).toBeVisible()
  await expect(page.getByText('At age 45 or over, Upper band is held at Standard.')).toBeVisible()
  await load.getByRole('radio', { name: 'Standard' }).click()
  await expect(
    page.getByText(
      /^Adds up to \d+(\.\d)?% a week while rebuilding toward a level held in the last 12 weeks\./,
    ),
  ).toBeVisible()
  await expect(page.getByText('At age 45 or over, Upper band is held at Standard.')).toBeHidden()

  // Generate at Steady first (the default), to see the start the setting changes.
  await load.getByRole('radio', { name: 'Steady' }).click()
  await page.getByRole('button', { name: 'Generate plan' }).click()
  await expect(toast(page, 'Plan generated')).toBeVisible()
  const panel = page.getByRole('region', { name: 'Load setting' })
  await expect(panel.getByText('Steady', { exact: true })).toBeVisible()
  const steady = (await api.get('/plan')) as PlanWithSessions
  expect(steady.load).toEqual({
    requested: 'steady',
    position: 'steady',
    held: null,
    ageCapped: false,
  })

  // Regenerate at Standard: the sheet starts from the position the plan was set to.
  await page.getByRole('button', { name: 'Regenerate plan' }).click()
  const sheet = page.getByRole('dialog', { name: 'Regenerate plan' })
  await expect(sheet.getByRole('radio', { name: 'Steady' })).toBeChecked()
  await sheet.getByRole('radio', { name: 'Standard' }).click()
  await sheet.getByRole('button', { name: 'Generate plan' }).click()
  await expect(sheet).toBeHidden()

  // The Plan page shows the position in effect, with no reason, and the plan starts higher.
  await expect(panel.getByText('Standard', { exact: true })).toBeVisible()
  await expect(panel.getByText(/was set to|applies for now|is held at/)).toHaveCount(0)
  const standard = (await api.get('/plan')) as PlanWithSessions
  expect(standard.id).not.toBe(steady.id)
  expect(standard.load).toEqual({
    requested: 'standard',
    position: 'standard',
    held: null,
    ageCapped: false,
  })
  expect(standard.weeks[0]!.targetRunMin).toBeGreaterThan(steady.weeks[0]!.targetRunMin)

  // New data arrives, then "Update plan from latest data" re-plans; the position is kept.
  await api.post('/activities', {
    date: today,
    type: 'run',
    durationSec: 75 * 60,
    distanceM: 12_000,
    rpe: 3,
  })
  await page.reload()
  await page.getByRole('button', { name: 'Update plan from latest data' }).click()
  const replan = page.getByRole('dialog', { name: 'Update plan from latest data' })
  await expect(replan).toBeVisible()
  await replan.getByRole('button', { name: 'Apply to my plan' }).click()
  await expect(replan.getByRole('heading', { name: 'Plan updated' })).toBeVisible()
  await replan.getByRole('button', { name: 'Done' }).click()
  await expect(replan).toBeHidden()

  await expect(panel.getByText('Standard', { exact: true })).toBeVisible()
  const kept = (await api.get('/plan')) as PlanWithSessions
  expect(kept.id).toBe(standard.id)
  expect(kept.load).toEqual(standard.load)
  expect(kept.weeks[0]!.targetRunMin).toBeGreaterThan(steady.weeks[0]!.targetRunMin)

  // Change the setting from the Plan page, without a new plan: the panel's Change action opens the
  // form's field on the position the plan is set to, and Apply stays off until another is chosen.
  await panel.getByRole('button', { name: 'Change' }).click()
  const change = page.getByRole('dialog', { name: 'Change load setting' })
  const field = change.getByRole('radiogroup', { name: 'Load' })
  await expect(field.getByRole('radio')).toHaveText(['Steady', 'Standard', 'Upper band'])
  await expect(field.getByRole('radio', { name: 'Standard' })).toBeChecked()
  await expect(change.getByRole('button', { name: 'Apply' })).toBeDisabled()
  await field.getByRole('radio', { name: 'Steady' }).click()
  await expect(change.getByText("Adds up to 10% a week, the plan's usual step.")).toBeVisible()
  await change.getByRole('button', { name: 'Apply' }).click()
  await expect(change).toBeHidden()

  // The panel names Steady, the weeks ahead follow it, and "What changed" lists the revision.
  await expect(toast(page, 'Load setting changed')).toBeVisible()
  await expect(panel.getByText('Steady', { exact: true })).toBeVisible()
  const lowered = (await api.get('/plan')) as PlanWithSessions
  expect(lowered.id).toBe(standard.id)
  expect(lowered.load).toEqual(steady.load)
  const targets = (plan: PlanWithSessions) => plan.weeks.map((week) => week.targetRunMin)
  expect(targets(lowered)).not.toEqual(targets(kept))
  const changed = page.getByRole('region', { name: 'What changed' })
  await changed.getByText('What changed', { exact: true }).click()
  const revision = changed
    .locator('[data-revision]')
    .filter({ hasText: 'Load setting changed to Steady: weeks ahead add up to 10% a week.' })
  await expect(revision).toBeVisible()

  // Undo puts the position and the weeks back.
  await revision.getByRole('button', { name: 'Undo update' }).click()
  const undo = page.getByRole('dialog', { name: 'Undo this update' })
  await undo.getByRole('button', { name: 'Undo update' }).click()
  await expect(undo).toBeHidden()
  await expect(panel.getByText('Standard', { exact: true })).toBeVisible()
  const restored = (await api.get('/plan')) as PlanWithSessions
  expect(restored.load).toEqual(kept.load)
  expect(targets(restored)).toEqual(targets(kept))
})
