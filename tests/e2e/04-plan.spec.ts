import { expect, test } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
import { relativeDates, resetData, signedInApi, toast } from './helpers.ts'

test('create a goal, activate it, generate a plan and edit one week with a note', async ({
  page,
  baseURL,
}) => {
  const { thisMonday, planStart, raceDate } = relativeDates()
  await signedInApi(page, baseURL ?? '')
  await resetData()

  // Goal
  await page.goto('/goals')
  await expect(page.getByText('No goals yet.')).toBeVisible()
  await page.getByRole('button', { name: 'Add goal' }).click()
  const goalSheet = page.getByRole('dialog', { name: 'Add goal' })
  await goalSheet.getByLabel('Name').fill('Test marathon')
  await goalSheet.getByRole('radio', { name: 'A', exact: true }).click()
  await goalSheet.getByLabel('Race date').fill(raceDate)
  await goalSheet.getByRole('button', { name: 'Marathon' }).click()
  await goalSheet.getByRole('button', { name: 'Save goal' }).click()
  await expect(toast(page, 'Goal saved')).toBeVisible()

  const goal = page.getByRole('article', { name: 'Test marathon' })
  await expect(goal.getByText('Priority A')).toBeVisible()
  await goal.getByRole('button', { name: 'Make active' }).click()
  await expect(goal.getByText('Active goal')).toBeVisible()

  // Plan
  await page.goto('/plan')
  await expect(page.getByText('No plan yet.').first()).toBeVisible()
  await page.getByLabel('Weekly run minutes').fill('150')
  await page.getByLabel('Plan start (Monday)').fill(planStart)
  await page.getByRole('button', { name: 'Generate plan' }).click()
  await expect(toast(page, 'Plan generated')).toBeVisible()

  const table = page.getByRole('table', { name: 'Weekly plan, target and actual run hours' })
  await expect(table).toBeVisible()
  await expect(table.getByText('Restart', { exact: true }).first()).toBeVisible()
  await expect(table.getByRole('row', { name: /Race week/ })).toBeVisible()
  await expect(table.getByRole('row', { name: /Race week/ })).toHaveAttribute('data-race', 'true')

  // Edit a future week: a changed target needs a note.
  const week = addDays(thisMonday, 7)
  const row = table.locator(`tr[data-week="${week}"]`)
  const before = await row.locator('[data-cell="target"]').innerText()
  await row.getByRole('button', { name: /^Edit week of/ }).click()
  const edit = page.getByRole('dialog', { name: /^Edit week of/ })
  await edit.getByLabel('Target (minutes)').fill('200')
  await edit.getByRole('button', { name: 'Save week' }).click()
  await expect(edit.getByText('Add a note explaining the change')).toBeVisible()

  await edit.getByLabel('Override note').fill('Visiting family, one long day instead of two')
  await edit.getByRole('button', { name: 'Save week' }).click()
  await expect(toast(page, /^Week of .* saved$/)).toBeVisible()
  await expect(edit).toBeHidden()

  const target = row.locator('[data-cell="target"]')
  await expect(target.getByText('3.3 h')).toBeVisible()
  await expect(target.getByRole('button', { name: 'edited' })).toBeVisible()
  expect(before).not.toContain('3.3 h')

  // The note shows on demand and survives a reload.
  await page.reload()
  const reloaded = page.locator(`tr[data-week="${week}"] [data-cell="target"]`)
  await reloaded.getByRole('button', { name: 'edited' }).focus()
  await expect(reloaded.getByRole('note')).toHaveText(
    'Visiting family, one long day instead of two',
  )
})
