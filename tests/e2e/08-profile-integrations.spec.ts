import { expect, test } from '@playwright/test'
import { resetData, signedInApi, toast } from './helpers.ts'

test('the profile is saved and comes back after a reload', async ({ page, baseURL }) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()

  await page.getByLabel('Birth year').fill('1985')
  await page.getByLabel('Sex').selectOption('female')
  await page.getByLabel('Height (cm)').fill('172')
  await page.getByLabel('Weight (kg)').fill('64.5')
  await page.getByLabel('Maximum heart rate', { exact: true }).fill('188')
  await page.getByLabel('Maximum heart rate source').selectOption('measured')
  await page.getByLabel('Resting heart rate').fill('48')
  await page.getByLabel('Threshold heart rate').fill('168')
  await page.getByLabel('Long-run day').selectOption('sun')
  await page.getByLabel('Trails').check()
  await page.getByLabel('Home latitude').fill('0.01')
  await page.getByLabel('Home longitude').fill('0.02')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(toast(page, 'Profile saved')).toBeVisible()

  await page.reload()
  await expect(page.getByLabel('Birth year')).toHaveValue('1985')
  await expect(page.getByLabel('Sex')).toHaveValue('female')
  await expect(page.getByLabel('Height (cm)')).toHaveValue('172')
  await expect(page.getByLabel('Weight (kg)')).toHaveValue('64.5')
  await expect(page.getByLabel('Maximum heart rate', { exact: true })).toHaveValue('188')
  await expect(page.getByLabel('Maximum heart rate source')).toHaveValue('measured')
  await expect(page.getByLabel('Resting heart rate')).toHaveValue('48')
  await expect(page.getByLabel('Threshold heart rate')).toHaveValue('168')
  await expect(page.getByLabel('Long-run day')).toHaveValue('sun')
  await expect(page.getByLabel('Trails')).toBeChecked()
  await expect(page.getByLabel('Home latitude')).toHaveValue('0.01')
  await expect(page.getByLabel('Home longitude')).toHaveValue('0.02')
})

test('the integrations page lists every provider without calling out to any of them', async ({
  page,
  baseURL,
}) => {
  await signedInApi(page, baseURL ?? '')
  await resetData()
  await page.goto('/more')
  await page.getByRole('link', { name: /^Integrations/ }).click()
  await expect(page.getByRole('heading', { name: 'Integrations', level: 1 })).toBeVisible()

  const providers = ['intervals.icu', 'Strava', 'Garmin Connect', 'Apple Health', 'Watched folder']
  for (const name of providers) {
    const card = page.getByRole('region', { name })
    await expect(card).toBeVisible()
    await expect(card.getByText('Not connected')).toBeVisible()
  }

  // Garmin is experimental and says so; the others carry no such badge.
  const garmin = page.getByRole('region', { name: 'Garmin Connect' })
  await expect(garmin.getByText('Experimental')).toBeVisible()
  await expect(page.getByText('Experimental', { exact: true })).toHaveCount(1)

  // Each pull or folder provider offers its connect form straight away.
  const intervals = page.getByRole('region', { name: 'intervals.icu' })
  await expect(intervals.getByLabel('API key')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Strava' }).getByLabel('Client id')).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Watched folder' }).getByLabel('Folder path'),
  ).toBeVisible()
})
