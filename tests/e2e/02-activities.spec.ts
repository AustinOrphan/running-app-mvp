import { expect, test } from '@playwright/test'
import { addDays } from '../../shared/dates.ts'
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
  // The history sections load when the foot of the page comes near the viewport.
  await page.getByRole('region', { name: 'Disclaimer' }).scrollIntoViewIfNeeded()
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

test('a long history pages 50 at a time, and Stats reads its totals from the server', async ({
  page,
  baseURL,
}) => {
  const { today } = relativeDates()
  const api = await signedInApi(page, baseURL ?? '')
  await resetData()
  for (let day = 0; day < 55; day += 1) {
    await api.post('/activities', {
      date: addDays(today, -day),
      type: 'run',
      durationSec: 1800,
      distanceM: 5000,
    })
  }
  const requested: string[] = []
  page.on('request', (request) => {
    requested.push(new URL(request.url()).pathname)
  })

  await page.goto('/activities')
  await expect(page.getByText('Showing 50 of 55 activities')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Run/ })).toHaveCount(50)
  await page.getByRole('button', { name: 'Show 5 more' }).click()
  await expect(page.getByText('55 activities', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Run/ })).toHaveCount(55)
  await expect(page.getByRole('button', { name: /^Show \d+ more$/ })).toHaveCount(0)

  requested.length = 0
  await page.goto('/stats')
  await expect(page.getByRole('table', { name: 'Monthly totals' })).toBeVisible()
  expect(requested).toContain('/api/stats')
  expect(requested).not.toContain('/api/activities')
})
