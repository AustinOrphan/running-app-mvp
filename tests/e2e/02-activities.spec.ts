import { expect, test } from '@playwright/test'
import { relativeDates, resetData, signedInApi, toast } from './helpers.ts'

test('logging a run from the Activities page shows it in the list and on the dashboard', async ({
  page,
  baseURL,
}) => {
  const { lastWednesday } = relativeDates()
  await signedInApi(page, baseURL ?? '')
  await resetData()

  await page.goto('/activities')
  await expect(page.getByRole('heading', { name: 'Activities' })).toBeVisible()
  await expect(page.getByText('No activities yet.')).toBeVisible()

  await page.getByRole('button', { name: 'Log activity' }).click()
  const sheet = page.getByRole('dialog', { name: 'Log activity' })
  await sheet.getByLabel('Date').fill(lastWednesday)
  await sheet.getByLabel('Duration').fill('45')
  await sheet.getByLabel('Distance (mi)').fill('5')
  await sheet.getByRole('button', { name: 'Save' }).click()

  await expect(toast(page, 'Run saved')).toBeVisible()
  await expect(sheet).toBeHidden()

  const row = page.getByRole('button', { name: /^Run 45:00 5\.00 mi/ })
  await expect(row).toBeVisible()
  await expect(page.getByText('1 activity')).toBeVisible()

  await page.getByRole('link', { name: 'Today' }).first().click()
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await expect(page.getByText('1 run, 5.00 mi in the last 28 days')).toBeVisible()

  // The edit sheet opens on the saved values and the row can be deleted again.
  await page.goto('/activities')
  await row.click()
  const edit = page.getByRole('dialog', { name: 'Edit activity' })
  await expect(edit.getByLabel('Duration')).toHaveValue('45:00')
  await edit.getByRole('button', { name: 'Delete', exact: true }).click()
  await edit.getByRole('button', { name: 'Delete activity' }).click()
  await expect(toast(page, 'Activity deleted')).toBeVisible()
  await expect(page.getByText('No activities yet.')).toBeVisible()
})

test('a duration the form cannot read is reported and nothing is saved', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()

  await page.goto('/activities')
  await page.getByRole('button', { name: 'Log activity' }).click()
  const sheet = page.getByRole('dialog', { name: 'Log activity' })
  await sheet.getByLabel('Duration').fill('soon')
  await sheet.getByRole('button', { name: 'Save' }).click()

  await expect(sheet.getByText('Enter minutes like 45, or 0:45:00')).toBeVisible()
  await sheet.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByText('No activities yet.')).toBeVisible()
})
